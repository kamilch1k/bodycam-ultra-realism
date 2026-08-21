import * as THREE from 'three';
import { Arm, HAND_POSES } from './hands.js';
import { buildClips, makeSampleResult } from './clips.js';
import { triCount, mergeAll } from './geometry.js';
import { SKINS, UNPAINTED, PAINT_FLOOR, PAINT_GAIN } from './skins.js';
import {
  Spring,
  Spring3,
  Noise1,
  clamp,
  clamp01,
  lerp,
  damp,
  smootherstep,
  wrapPi,
  TAU,
} from './mathx.js';

/**
 * THE VIEWMODEL RIG.
 *
 * Everything the player looks at for the whole game happens in this file. It is
 * a stack of *additive procedural layers* over one base pose — no baked clips
 * for anything continuous:
 *
 *   base      hip / ADS / sprint / low-ready pose blend
 *   sway      layered incommensurate noise, so idle never visibly loops
 *   bob       stride-driven figure-eight, scaled by speed and stance
 *   lag       the gun TRAILS camera rotation on a spring, overshoots, settles.
 *             This is the single detail that makes a viewmodel feel real.
 *   recoil    per-shot rotational + positional impulse, spring-damper return
 *   clip      keyframed reload / inspect / draw additive offset
 *
 * ADS alignment is computed, not authored: the rig solves for the translation
 * that puts the weapon's sight node exactly on the camera axis at the right eye
 * relief, so the optic is pixel-centred at full ADS whatever the weapon.
 *
 * The scene graph:
 *   viewScene
 *     anchor          <- copies the world camera transform every frame, so the
 *                        gun is lit and shadowed as if it were in the world
 *       rig           <- the animation stack writes here
 *         weapon      <- body meshes + moving-part groups
 *         armL/armR   <- two-bone IK, hands welded to the weapon's grips
 *       reticle       <- collimated dot, placed on the optical axis in camera
 *                        space so it behaves like real glass
 */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'XYZ');
const _m = new THREE.Matrix4();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

/**
 * Re-shape the curvature vertex masks baked by `materials.bakeMasks`.
 *
 * bakeMasks writes a LINEAR convexity ramp into vColor.rgb (wear / grime / AO).
 * On architecture that is right — a wall has interior vertices for the ramp to
 * fall off against. On chamfered hard-surface geometry there are none, so the
 * ramp runs from the chamfer to the middle of the panel and the whole face
 * reads as worn metal. Raising the exponent collapses that ramp back onto the
 * chamfer's own vertices, which is the outer 1-2 mm of the edge — the only place
 * a rifle actually polishes through.
 *
 * @param {THREE.BufferGeometry} geo   must already carry a `color` attribute
 */
function shapeMasks(geo, o) {
  const col = geo.getAttribute('color');
  if (!col) return geo;
  const a = col.array;
  const amp = [o.wearAmp ?? 1, o.grimeAmp ?? 1, o.aoAmp ?? 1];
  const exp = [o.wearExp ?? 1, o.grimeExp ?? 1, o.aoExp ?? 1];
  for (let i = 0; i < a.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = a[i + k];
      a[i + k] = v <= 0 ? 0 : amp[k] * Math.pow(v > 1 ? 1 : v, exp[k]);
    }
  }
  col.needsUpdate = true;
  return geo;
}

/** Right-handed hand basis from a finger direction and a back-of-hand direction. */
function handBasis(out, finger, back) {
  _v.set(-finger[0], -finger[1], -finger[2]).normalize(); // hand +Z
  _v2.set(back[0], back[1], back[2]);
  _v2.addScaledVector(_v, -_v2.dot(_v));
  if (_v2.lengthSq() < 1e-8) _v2.set(0, 1, 0).addScaledVector(_v, -_v.y);
  _v2.normalize(); // hand +Y
  _v3.crossVectors(_v2, _v).normalize(); // hand +X
  _m.makeBasis(_v3, _v2, _v);
  return out.setFromRotationMatrix(_m);
}

export class Viewmodel {
  constructor(ctx, mats) {
    this.ctx = ctx;
    this.mats = mats;
    this.rng = ctx.rng.fork();

    this.anchor = new THREE.Object3D();
    this.anchor.name = 'ow-viewmodel-anchor';
    this.rig = new THREE.Object3D();
    this.rig.name = 'ow-viewmodel-rig';
    this.anchor.add(this.rig);
    ctx.viewScene.add(this.anchor);

    // ---- arms -------------------------------------------------------------
    /**
     * SIMPLE GLOVE on mobile: one material for the shell, the pad and the seam,
     * which lets each finger joint merge to a single mesh (see buildFinger).
     *
     * The two arms were 106 of the frame's ~146 visible meshes — more than the
     * world (11) and the gun (29) put together — and three.js issues a draw call
     * per mesh regardless of shared materials. The seam and pad GEOMETRY is
     * still built either way, so the ridges and swells that separate the fingers
     * remain; what is lost is only their distinct shading, which the file's own
     * note measures at about one pixel per boundary. On a phone that pixel is
     * not there to lose.
     */
    const ov = ctx.config?.gloveOverride;
    const simpleGlove =
      ov === 'simple' ? true : ov === 'full' ? false : ctx.config?.q?.simpleGlove === true;
    const glove = mats.get('glove');
    const handMats = {
      glove,
      pad: simpleGlove ? glove : mats.get('glove_pad'),
      seam: simpleGlove ? glove : mats.get('glove_seam'),
      sleeve: mats.get('sleeve'),
      simple: simpleGlove,
    };
    // Shoulder joints in CAMERA space: ~200 mm lateral, ~210 mm below the eye
    // and only just behind it.
    //
    // Two constraints fight here. Too far BACK and a 570 mm arm cannot reach the
    // handguard, so the two-bone solve clamps and the elbow locks dead straight
    // — the "broomstick arm". Too far FORWARD (a properly bladed stance) and the
    // upper arm itself lands inside the near frustum, so a 100 mm-wide sleeve
    // fills half the screen. The support hand is therefore placed on the REAR of
    // the handguard instead, which buys the reach without moving the joint into
    // shot.
    this.armR = new Arm(1, handMats, {
      scale: 1,
      shoulderX: 0.205,
      shoulderY: -0.2,
      shoulderZ: 0.06,
      pose: 'grip',
    });
    // The shoulders stay BEHIND the eye. Blading the support shoulder forward to
    // reach the handguard was tried and measured: at z=-0.075 the 89 mm forearm
    // sleeve crosses the frame diagonally and hides the barrel and the muzzle,
    // which is precisely the failure the note above warns about. The reach is
    // bought by cheating the bones 10% long instead — see hands.js L_UPPER.
    this.armL = new Arm(-1, handMats, {
      scale: 0.97,
      shoulderX: 0.2,
      shoulderY: -0.22,
      shoulderZ: 0.02,
      pose: 'clamp',
      /**
       * ELBOW SWING, MEASURED AGAINST THE WRIST ANGLE.
       *
       * The wrist is not free: the hand target is welded to the handguard by the
       * build-time contact solve, so the only thing that decides how far the
       * wrist is bent is where the elbow sits on the IK circle — which is what
       * this pole picks.
       *
       * The shared default (side*0.46, -0.86, 0.22) drops the elbow to
       * (-0.236, -0.093, -0.013) and leaves 64.4 deg between the forearm axis
       * and the hand's metacarpal axis. A wrist does about 70 deg of extension
       * and 30 deg of ulnar deviation, so 64 deg of the two combined is at the
       * limit, and on screen the sleeve and the glove meet at a hard corner that
       * reads as a broken joint rather than a wrist.
       *
       * Swept the pole over the down/outboard hemisphere and measured the angle
       * at each: taking the elbow 59 mm further OUTBOARD and 66 mm up puts it at
       * (-0.295, -0.027, -0.018) for 46.9 deg — comfortably inside the envelope.
       * The elbow stays outboard of the shoulder and behind the near plane
       * (z -0.018), so it does not enter frame; only the forearm does, which is
       * the same limb that was in frame before.
       */
      pole: [-1.2, -0.4, 0],
    });
    this.rig.add(this.armR.root);
    this.rig.add(this.armL.root);
    /**
     * The arms get the SAME curvature-mask treatment the weapon does. Without
     * this every wear/grime/AO number in `sleeve`, `glove`, `glove_pad` and
     * `glove_seam` is dead code — see Arm.bakeSurfaceMasks. It has to happen
     * before `_fitSupportHand` runs, because that adds contact AO into the same
     * attribute with Math.max and would otherwise be overwritten.
     */
    const bakeArms = this.mats.lib?.bakeMasks?.bind(this.mats.lib) ?? null;
    if (bakeArms) {
      this.armR.bakeSurfaceMasks(bakeArms, shapeMasks, this.rng);
      this.armL.bakeSurfaceMasks(bakeArms, shapeMasks, this.rng);
    }
    // Body-fixed shoulders, expressed in camera space and re-based into rig
    // space every frame so the elbows do not swing when the gun moves.
    this.shoulderR = new THREE.Vector3(0.205, -0.2, 0.06);
    this.shoulderL = new THREE.Vector3(-0.2, -0.22, 0.02);

    // ---- reticle ----------------------------------------------------------
    this.reticle = new THREE.Object3D();
    this.reticle.name = 'ow-reticle';
    this.anchor.add(this.reticle);
    /**
     * A 2 MOA dot with a soft halo, a dark keyline and a 12-segment outer ring.
     *
     * All four are authored at UNIT radius and scaled together by the dot's
     * angular size in `_updateReticle`, so the whole reticle is one shape that
     * grows and shrinks as a unit — proportions can never drift.
     *
     *   core     the emitter. 0xff1a08 at intensity 1.35, and the intensity is
     *            measured — twice, because the first analysis was wrong.
     *
     *            The old note here reasoned about how much GREEN the emitter adds
     *            and concluded 3.2 was safe. It is not, and the reason is the tone
     *            curve, not the additive maths: the frame is graded with AgX (see
     *            render/composite.js), and AgX's whole signature is that it
     *            DESATURATES as it approaches display white. A pixel whose red
     *            channel is 3.2 over a mid-grey background comes out of the curve
     *            at rgb(255,248,239) whatever its green and blue were — measured on
     *            ads.png, a white dot, exactly what the previous note said it had
     *            fixed. There is no colour available up there.
     *            0.95 keeps the core on the near-linear part of the curve, where a
     *            saturated red stays a saturated red, and the halo + ring below are
     *            what carry the "it is an emitter" read instead of raw radiance.
     *   halo     1.6x the core radius, ~6% alpha. This is the bloom seed and the
     *            reason the dot looks like it is BEHIND glass. It has to stay
     *            tight; the old 0.0095 rad / 0.34 alpha halo was 23 px across and
     *            was what actually read on screen — a soft salmon blob.
     *   rim      a NORMALLY blended dark keyline. Additive blending cannot draw
     *            anything darker than what is behind it, so without a separate
     *            ring the dot dissolves the moment it crosses a blown-out sky.
     *   ring     12 arc segments at 3.2x the dot radius, 35% of its radiance.
     *            A bare dot at 8 px is indistinguishable from a dead subpixel;
     *            the segmented ring is what makes it read as an EMITTER, and it
     *            is the standard 65 MOA circle-dot every modern sight ships.
     */
    const core = new THREE.CircleGeometry(1, 32);
    const halo = new THREE.CircleGeometry(1.6, 32);
    const rim = new THREE.RingGeometry(1, 1.42, 32, 1);
    const RING_SEGS = 12;
    const ringArcs = [];
    for (let i = 0; i < RING_SEGS; i++) {
      const a0 = (i / RING_SEGS) * TAU;
      ringArcs.push(new THREE.RingGeometry(2.98, 3.42, 4, 1, a0, (TAU / RING_SEGS) * 0.56));
    }
    const ring = mergeAll(ringArcs);
    this._reticleGeo = [core, halo, rim, ring];
    this.dotCore = new THREE.Mesh(core, mats.reticle(0xff1206, 0.95));
    this.dotHalo = new THREE.Mesh(halo, mats.reticle(0xff2a0c, 0.34));
    this.dotRim = new THREE.Mesh(rim, mats.reticleOutline(0.85));
    this.dotRing = new THREE.Mesh(ring, mats.reticle(0xff1206, 0.95 * 0.5));
    this.dotHalo.renderOrder = 19;
    this.dotRim.renderOrder = 20;
    this.dotRing.renderOrder = 20;
    this.dotCore.renderOrder = 21;
    // Centre dot only. The 65 MOA segmented ring and the bloom halo are what a
    // real tube sight ships, but on screen they are twelve extra bright marks
    // around the exact spot you are trying to read, so they come off. The dark
    // keyline stays: without it the dot vanishes against a blown-out sky.
    this.dotHalo.visible = false;
    this.dotRing.visible = false;
    this.reticle.add(this.dotRim);
    this.reticle.add(this.dotCore);

    /**
     * GREEN CHEVRON with ranging points — the OKP-7's reticle.
     *
     * A Russian collimator does not show a red dot. It shows an illuminated
     * green chevron with aiming points stepped below it: you hold the tip on a
     * close target and drop to a lower point as range increases. Green because
     * the eye is most sensitive there, which is why Warsaw Pact optics used it.
     *
     * Authored at UNIT radius like the dot and scaled by the same angular size,
     * so both reticles are the same apparent size and swapping optics never
     * changes how big the aiming mark reads.
     */
    const chevBars = [];
    for (const side of [-1, 1]) {
      const bar = new THREE.PlaneGeometry(2.9, 0.62);
      bar.rotateZ(side * 0.62);
      bar.translate(side * 1.0, 0.95, 0);
      chevBars.push(bar);
    }
    // Two ranging points below the tip, stepped and shrinking with range.
    for (let i = 0; i < 2; i++) {
      const d = new THREE.CircleGeometry(0.58 - i * 0.12, 12);
      d.translate(0, -2.1 - i * 2.1, 0);
      chevBars.push(d);
    }
    const chevGeo = mergeAll(chevBars);
    this._reticleGeo.push(chevGeo);
    this.chevron = new THREE.Mesh(chevGeo, mats.reticle(0x2bff4a, 0.9));
    this.chevron.renderOrder = 21;
    this.chevron.visible = false;
    this.chevron.frustumCulled = false;
    this.chevron.userData.owNoPrepass = true;
    this.chevron.userData.owNoShadow = true;
    this.reticle.add(this.chevron);
    for (const m of [this.dotCore, this.dotHalo, this.dotRim, this.dotRing]) {
      m.frustumCulled = false;
      m.userData.owNoPrepass = true;
      m.userData.owNoShadow = true;
    }

    // ---- animation state --------------------------------------------------
    this.weapons = new Map();
    this.active = null;

    this.adsT = 0;
    this.adsTarget = 0;
    this.sprintT = 0;
    this.lowReadyT = 0;
    this.bobPhase = 0;
    /** Damped bob amplitude — see the movement bob in `update`. */
    this.bobWeight = 0;
    this.stepT = 0;
    this.noiseT = 0;
    this.triggerT = 0;
    this.triggerTarget = 0;

    this.lag = new Spring3(5.4, 0.46);
    this.lagRot = new Spring3(6.2, 0.42);
    this.recPos = new Spring3(9, 0.42);
    this.recRot = new Spring3(9, 0.42);
    this.jumpSpring = new Spring(5.5, 0.5);
    this.landSpring = new Spring(7.5, 0.55);
    this.settle = new Spring3(2.2, 0.7);

    this.noise = [];
    for (let i = 0; i < 6; i++) this.noise.push(new Noise1(this.rng, 512));
    this.noiseRates = [0.13, 0.19, 0.271, 0.083, 0.117, 0.163];

    this._angVel = { yaw: 0, pitch: 0 };
    this._prevYaw = 0;
    this._prevPitch = 0;
    this._hasPrev = false;

    // clip playback
    this.clip = null;
    this.clipT = 0;
    this.clipPrevT = 0;
    this.clipResult = makeSampleResult();
    this.onClipEvent = null;

    // moving-part drive
    this.boltCycle = 0; // 0..1, driven by firing
    this.boltHold = 0; // 1 = locked back (empty)
    this.magInHand = 0;
    this.magVisible = true;

    // preallocated working state
    this._basePos = new THREE.Vector3();
    this._baseQuat = new THREE.Quaternion();
    this._adsPos = new THREE.Vector3();
    this._adsQuat = new THREE.Quaternion();
    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._handPos = new THREE.Vector3();
    this._handQuat = new THREE.Quaternion();
    this._handPosL = new THREE.Vector3();
    this._handQuatL = new THREE.Quaternion();
    this._sightLocal = new THREE.Vector3();
    this._lhandTarget = new THREE.Vector3();
    this._lhandFinger = [0, 0, 0];
    this._lhandBack = [0, 0, 0];
    this._muzzleWorld = new THREE.Vector3();
    this._muzzleDir = new THREE.Vector3();
    this._ejectWorld = new THREE.Vector3();
    this._ejectVel = new THREE.Vector3();

    this.debugFrozen = false;
    /** Set false by the preview harness to leave the cameras alone. */
    this.trackCamera = true;
    this.rigOverride = null;
    this._scriptedFire = -1;
    this._scriptShots = 0;
  }

  /* ====================================================================== */
  /*  construction                                                          */
  /* ====================================================================== */

  /**
   * Turn a model description (body + moving assemblies + nodes) into meshes.
   * One mesh per material per assembly: a whole rifle lands in 7-9 draw calls.
   */
  addWeapon(model, def) {
    const group = new THREE.Object3D();
    group.name = `weapon-${model.id}`;
    group.visible = false;
    this.rig.add(group);

    let tris = 0;
    const meshes = [];
    const bake = this.mats.lib?.bakeMasks?.bind(this.mats.lib) ?? null;

    const build = (asm, parent, wearScale = 1) => {
      const map = asm.build();
      for (const [matKey, geo] of map) {
        // Curvature masks: convex chamfers wear to bright metal, creases fill
        // with grime. This is what stops the gun reading as clean plastic.
        if (bake) {
          /**
           * Chamfered hard-surface geometry has no interior vertices on a face,
           * so a per-vertex edge mask interpolates linearly from the chamfer all
           * the way to the far side of the panel: a rail tooth, a mount top face
           * or a handguard slat comes out uniformly worn, which is what turned
           * the rail teeth into flat near-white bars and the mount into beige MDF.
           *
           * Bake the mask at full amplitude and then SHAPE it (below): raising the
           * exponent is the only knob that pulls a vertex-interpolated ramp back
           * onto the outer millimetre or two of the edge, because it pushes
           * everything below the chamfer's own vertices toward zero.
           */
          const soft = matKey === 'polymer' || matKey === 'rubber' || matKey === 'polymer_tan';
          bake(geo, { wear: 1, grime: 1, ao: 1, edgeThreshold: 0.16, rng: this.rng });
          shapeMasks(geo, {
            /**
             * wearAmp comes DOWN and grimeAmp goes UP.
             *
             * With the viewmodel recalibrated to be diffuse-dominant (see
             * materials.js `alu`), the wear layer's contrast against the base
             * albedo is what decides whether a chamfer reads as polished alloy or
             * as a white pencil line, and on small parts — where every vertex is
             * convex — it decides whether a takedown pin reads as steel or as a
             * cream plastic cube. 0.9 -> 0.62 on hard surfaces.
             *
             * Grime is the opposite: it is the only mask that paints the CONCAVE
             * side of the geometry, so it is what puts dirt in the magwell corners,
             * the trigger-guard fillet, the rail slots and the seam between the
             * handguard panels. Those creases were reading perfectly clean, which
             * is a large part of "props read as pasted-on decals" applied to a gun.
             */
            wearAmp: (soft ? 0.42 : 0.62) * wearScale,
            wearExp: soft ? 3.4 : 2.8,
            grimeAmp: 1.15,
            grimeExp: 1.25,
            aoAmp: 1.0,
            aoExp: 1.15,
          });
        }
        const mesh = new THREE.Mesh(geo, this.mats.get(matKey));
        // Skins tint by material class, so the class has to survive the merge.
        mesh.userData.matKey = matKey;
        mesh.name = `${asm.name}-${matKey}`;
        // The viewmodel does not cast into the cascades (it is not in the world
        // scene), but it absolutely must RECEIVE the sun shadow: without this the
        // gun is lit at full sun while the street around it is in shade, which is
        // the single most obvious "pasted-on sticker" tell.
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        parent.add(mesh);
        meshes.push(mesh);
        tris += triCount(geo);
      }
    };

    build(model.body, group);

    const parts = {};
    for (const [name, asm] of Object.entries(model.moving)) {
      const sub = new THREE.Object3D();
      sub.name = `${model.id}-${name}`;
      group.add(sub);
      build(asm, sub, name === 'magazine' ? 0.8 : 1);
      parts[name] = sub;
    }

    /**
     * SWAPPABLE OPTICS — every one built now, all but one hidden.
     *
     * A weapon build costs ~2.7 s, so rebuilding when the player picks a sight
     * is not on the table. Five optics are twenty small parts on a receiver that
     * never changes: build them all here and switching afterwards is a boolean.
     */
    const optics = {};
    if (model.optics) {
      for (const [name, spec] of Object.entries(model.optics)) {
        let sub = null;
        if (spec.asm) {
          sub = new THREE.Object3D();
          sub.name = `${model.id}-optic-${name}`;
          sub.visible = false;
          group.add(sub);
          build(spec.asm, sub);
        }
        optics[name] = { ...spec, group: sub };
      }
    }

    /** Swappable stocks — same build-all/toggle scheme as the optics. */
    const stocks = {};
    if (model.stocks) {
      for (const [name, spec] of Object.entries(model.stocks)) {
        const sub = new THREE.Object3D();
        sub.name = `${model.id}-stock-${name}`;
        sub.visible = false;
        group.add(sub);
        build(spec.asm, sub);
        stocks[name] = { ...spec, group: sub };
      }
    }

    /** Swappable muzzle devices — same build-all/toggle scheme as the optics. */
    const muzzles = {};
    if (model.muzzles) {
      for (const [name, spec] of Object.entries(model.muzzles)) {
        let sub = null;
        if (spec.asm) {
          sub = new THREE.Object3D();
          sub.name = `${model.id}-muzzle-${name}`;
          sub.visible = false;
          group.add(sub);
          build(spec.asm, sub);
        }
        muzzles[name] = { ...spec, group: sub };
      }
    }

    /**
     * Swappable magazines. Unlike an optic or a muzzle device, a magazine is a
     * MOVING part — the empty-reload clip drops it — so the variants cannot
     * hang off the weapon body. They hang off a seat group, and `parts.magazine`
     * is set to that seat so every existing consumer (the reload clip, the
     * drop, `magVisible`) drives it without knowing anything changed.
     */
    const mags = {};
    if (model.mags) {
      const seat = new THREE.Object3D();
      seat.name = `${model.id}-magseat`;
      group.add(seat);
      parts.magazine = seat;
      for (const [name, spec] of Object.entries(model.mags)) {
        const sub = new THREE.Object3D();
        sub.name = `${model.id}-mag-${name}`;
        sub.visible = false;
        seat.add(sub);
        build(spec.asm, sub);
        mags[name] = { ...spec, group: sub };
      }
    }

    // Seat the moving parts at their rest transforms.
    const n = model.nodes;
    if (parts.magazine && n.magSeat) applyNode(parts.magazine, n.magSeat);
    if (parts.charging && n.chargeRest) applyNode(parts.charging, n.chargeRest);
    if (parts.bolt && n.boltRest) applyNode(parts.bolt, n.boltRest);
    if (parts.slide && n.slideRest) applyNode(parts.slide, n.slideRest);
    if (parts.trigger && n.triggerPivot) applyNode(parts.trigger, n.triggerPivot);
    if (parts.selector && n.selectorPivot) applyNode(parts.selector, n.selectorPivot);

    const entry = {
      id: model.id,
      def,
      model,
      group,
      parts,
      meshes,
      tris,
      clips: buildClips(model.nodes, def),
      // the sight point and its axis, in weapon space
      sight: new THREE.Vector3().fromArray(model.nodes.sight),
      ironSight: new THREE.Vector3().fromArray(model.nodes.ironSight ?? model.nodes.sight),
      muzzle: new THREE.Vector3().fromArray(model.nodes.muzzle),
      eject: new THREE.Vector3().fromArray(model.nodes.eject),
      ejectDir: new THREE.Vector3().fromArray(model.nodes.ejectDir ?? [1, 0.4, 0.2]).normalize(),
      optic: model.nodes.opticGlass ?? null,
      magSeatPos: new THREE.Vector3().fromArray(model.nodes.magSeat.pos),
      magSeatQuat: new THREE.Quaternion().setFromEuler(
        new THREE.Euler().fromArray(model.nodes.magSeat.rot)
      ),
      gripR: model.nodes.gripR,
      gripL: model.nodes.gripL,
      chargePull: new THREE.Vector3().fromArray(model.nodes.chargePull ?? [0, 0, 0]),
      boltTravel: new THREE.Vector3().fromArray(model.nodes.boltTravel ?? [0, 0, 0]),
      slideTravel: new THREE.Vector3().fromArray(model.nodes.slideTravel ?? [0, 0, 0]),
      triggerPull: model.nodes.triggerPull ?? -0.3,
      magLen: model.magSize?.len ?? 0.2,
      shell: model.shell,
      lhandPose: model.id === 'pistol' ? 'cup' : 'clamp',
      optics,
      opticId: null,
      muzzles,
      muzzleId: null,
      mags,
      magId: null,
      stocks,
      stockId: null,
      skinId: 'black',
    };
    this._fitSupportHand(entry);
    this.weapons.set(model.id, entry);
    // Default to the sight the ADS framing was measured against.
    if (optics.reddot) this.setOptic(entry.id, 'reddot');
    // ...and the device the muzzle node was authored around.
    if (muzzles.trilug) this.setMuzzle(entry.id, 'trilug');
    else if (muzzles.brake) this.setMuzzle(entry.id, 'brake');
    // ...and the magazine every pose and animation was authored against.
    if (mags.std) this.setMag(entry.id, 'std');
    // ...and the length of pull the recoil numbers were authored against.
    if (stocks.standard) this.setStock(entry.id, 'standard');
    return entry;
  }

  /**
   * Fit a different sight. Visibility only — nothing is rebuilt.
   *
   * The aim point moves with it: `sight` is what the ADS solve lands on the eye
   * axis (see the ADS pose block in `update`), so swapping the optic swaps where
   * the weapon has to be held, and a taller mount automatically raises the gun
   * into the eyeline instead of needing an authored pose per sight.
   *
   * @returns {boolean} false if this weapon has no such optic
   */
  setOptic(weaponId, opticId) {
    const w = this.weapons.get(weaponId);
    const spec = w?.optics?.[opticId];
    if (!spec) return false;
    for (const [name, o] of Object.entries(w.optics)) {
      if (o.group) o.group.visible = name === opticId;
    }
    w.opticId = opticId;
    w.optic = spec.glass;
    // Irons have no glass, so they aim with the weapon's own BUIS node.
    w.sight.copy(spec.glass ? _v.set(0, spec.glass.center[1], spec.glass.lensZ) : w.ironSight);
    return true;
  }

  /**
   * Fit a different muzzle device.
   *
   * Unlike an optic this MOVES THE MUZZLE: a 165 mm suppressor puts the crown
   * 103 mm further downrange than the 62 mm brake, and the flash, the smoke and
   * the tracer all spawn at that node. Leave it where it was and a suppressed
   * shot flashes from inside the can.
   *
   * @returns {boolean} false if this weapon has no such device
   */
  setMuzzle(weaponId, muzzleId) {
    const w = this.weapons.get(weaponId);
    const spec = w?.muzzles?.[muzzleId];
    if (!spec) return false;
    for (const [name, m] of Object.entries(w.muzzles)) {
      if (m.group) m.group.visible = name === muzzleId;
    }
    w.muzzleId = muzzleId;
    w.muzzle.z = spec.crownZ;
    return true;
  }

  /**
   * Fit a different magazine. Visibility only — the seat and therefore the
   * reload animation are untouched.
   *
   * @returns {boolean} false if this weapon has no such magazine
   */
  setMag(weaponId, magId) {
    const w = this.weapons.get(weaponId);
    const spec = w?.mags?.[magId];
    if (!spec) return false;
    for (const [name, m] of Object.entries(w.mags)) m.group.visible = name === magId;
    w.magId = magId;
    return true;
  }

  /**
   * Fit a different stock. Visibility only — the butt moves, nothing else does.
   *
   * @returns {boolean} false if this weapon has no such stock
   */
  setStock(weaponId, stockId) {
    const w = this.weapons.get(weaponId);
    const spec = w?.stocks?.[stockId];
    if (!spec) return false;
    for (const [name, st] of Object.entries(w.stocks)) st.group.visible = name === stockId;
    w.stockId = stockId;
    return true;
  }

  /**
   * Apply a skin to a weapon.
   *
   * Materials are CACHED AND SHARED across all three weapons — `mats.get('polymer')`
   * hands the same instance to the rifle, the SMG and the pistol — so tinting one
   * in place would repaint the whole armoury. Each weapon therefore gets its own
   * clone of every material class it uses, made once on the first skin change and
   * reused after. A clone shares the program and the maps, so this costs uniforms
   * and nothing else: no recompile, no extra draw calls.
   *
   * The original albedo is captured on that first clone and every skin multiplies
   * FROM it, so skins never compound and there is no "reset" special case.
   *
   * @returns {boolean} false if there is no such skin
   */
  setSkin(weaponId, skinId) {
    const w = this.weapons.get(weaponId);
    const skin = SKINS[skinId];
    if (!w || !skin) return false;
    if (!w._skinMats) w._skinMats = new Map();

    w.group.traverse((o) => {
      const key = o.userData?.matKey;
      if (!o.isMesh || !key) return;
      let rec = w._skinMats.get(key);
      if (rec === undefined) {
        // Leave glass, lens coatings and bore cavities alone: they are optical,
        // not painted, and repainting them turns the sight picture green.
        if (UNPAINTED.has(key)) {
          w._skinMats.set(key, null);
          return;
        }
        const mat = o.material.clone();
        const uniforms = {
          uSkinPaint: { value: new THREE.Vector3(1, 1, 1) },
          uSkinAmount: { value: 0 },
        };
        /**
         * The hook is installed ONCE, at clone time, and later skin changes only
         * write the uniform values. Installing it per change would mean
         * `needsUpdate = true` and a recompile of every material on the weapon in
         * the middle of a match — fourteen programs on the carbine, which is a
         * visible hitch for a menu click.
         */
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uSkinPaint = uniforms.uSkinPaint;
          shader.uniforms.uSkinAmount = uniforms.uSkinAmount;
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
               uniform vec3 uSkinPaint;
               uniform float uSkinAmount;`
            )
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
               if (uSkinAmount > 0.0) {
                 float skinLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                 vec3 painted = uSkinPaint * (${PAINT_FLOOR.toFixed(3)} + ${PAINT_GAIN.toFixed(3)} * skinLum);
                 diffuseColor.rgb = mix(diffuseColor.rgb, painted, uSkinAmount);
               }`
            );
        };
        // Force a distinct program so the hook is honoured rather than the
        // uncustomised cached one being reused.
        mat.customProgramCacheKey = () => `skin-${weaponId}-${key}`;
        rec = { mat, uniforms };
        w._skinMats.set(key, rec);
      }
      if (!rec) return;
      o.material = rec.mat;
    });

    for (const rec of w._skinMats.values()) {
      if (!rec) continue;
      rec.uniforms.uSkinPaint.value.set(skin.paint[0], skin.paint[1], skin.paint[2]);
      rec.uniforms.uSkinAmount.value = skin.amount;
    }
    w.skinId = skinId;
    return true;
  }

  /** The fitted stock's spec, or null. */
  stockSpec(weaponId) {
    const w = this.weapons.get(weaponId);
    return w?.stocks?.[w.stockId] ?? null;
  }

  /** The fitted magazine's spec, or null. */
  magSpec(weaponId) {
    const w = this.weapons.get(weaponId);
    return w?.mags?.[w.magId] ?? null;
  }

  /** The fitted device's spec, or null. */
  muzzleSpec(weaponId) {
    const w = this.weapons.get(weaponId);
    return w?.muzzles?.[w.muzzleId] ?? null;
  }

  /** The magnification currently in front of the eye, 1 when hipfiring. */
  opticSpec(weaponId) {
    const w = this.weapons.get(weaponId);
    return w?.optics?.[w.opticId] ?? null;
  }

  /**
   * GROUND THE SUPPORT HAND ON THE HANDGUARD — once, at build time.
   *
   * Two halves, and both are needed: geometry alone still reads as two floating
   * objects, and AO alone cannot close a 10 mm gap.
   *
   *  1. `Arm.fitToCylinder` searches each distal joint for the rotation that puts
   *     that fingertip's contact patch on the handguard surface (<=1 mm off, up
   *     to 1.5 mm buried), measured through the real transform chain rather than
   *     derived analytically — see the note there for why the analytic version
   *     was 8-14 mm out in every frame despite the maths being right.
   *  2. The contact points that come back are then used to bake a contact-AO
   *     gradient into BOTH sides of the interface: the handguard here, the glove
   *     in `Arm.bakeContactAO`. 0.55 multiply at the contact, easing to 1.0 over
   *     12 mm.
   *
   * The AO mask lives in vColor.b, which the library's shader turns into
   * `orm.r *= 1 - vColor.b * wear[2]`; wear[2] is 0.5 on every weapon material,
   * so a mask of 0.9 is the 0.55 multiply asked for.
   */
  _fitSupportHand(w) {
    /**
     * Either a handguard tube or a vertical foregrip post — whichever the
     * weapon actually presents to the support hand.
     *
     * The rifle and the SMG both moved to a foregrip and neither declared a
     * cylinder afterwards, so this returned early and the hand kept the
     * authored `clamp` curls. Those are solved for a 47 mm handguard; the post
     * is 29 mm across. Every finger therefore closed about 10 mm short of the
     * thing it was holding and the fist never shut, which is the daylight
     * visible all around the glove.
     */
    const hg = w.model.nodes.handguard ?? w.model.nodes.foregrip;
    const gL = w.gripL;
    if (!hg || !gL || w.id === 'pistol') return;
    this._handPosL.fromArray(gL.pos);
    handBasis(this._handQuatL, gL.finger ?? [0.82, 0.5, -0.28], gL.back ?? [-0.5, 0.32, -0.8]);
    const poseName = `clamp:${w.id}`;
    this.armL.setPose('clamp');
    const contacts = this.armL.fitToCylinder(
      this._handPosL,
      this._handQuatL,
      hg.axis,
      hg.dir,
      hg.r,
      { clearance: 0.001, poseName }
    );
    w.lhandPose = poseName;
    // Only keep contacts that actually landed on the part's own extent — a
    // fingertip that overshot past the end cap must not paint AO on the barrel.
    // A handguard is bounded in Z, a foregrip post in Y.
    const along = hg.z0 !== undefined ? 'z' : 'y';
    const a0 = along === 'z' ? hg.z0 : hg.y0;
    const a1 = along === 'z' ? hg.z1 : hg.y1;
    const hi = Math.max(a0, a1);
    const lo = Math.min(a0, a1);
    const kept = contacts.filter((p) => p[along] <= hi + 0.012 && p[along] >= lo - 0.012);
    this.armL.bakeContactAO(kept, 0.012, 0.7);
    this._bakeContactAOOnWeapon(w, kept, 0.012, 0.9);
    this.armL.setPose(poseName);
  }

  /**
   * The weapon side of the same contact gradient. The handguard geometry already
   * carries wear/grime/AO masks from `bakeMasks`, so this only ever RAISES the
   * AO channel — the edge-wear and grime layers are untouched.
   */
  _bakeContactAOOnWeapon(w, contacts, radius, peak) {
    if (!contacts.length) return;
    const r2 = radius * radius;
    for (const mesh of w.meshes) {
      const geo = mesh.geometry;
      const pos = geo.getAttribute('position');
      const col = geo.getAttribute('color');
      if (!pos || !col) continue;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i);
        let closest = Infinity;
        for (const c of contacts) {
          const d2 = _v.distanceToSquared(c);
          if (d2 < closest) closest = d2;
        }
        if (closest > r2) continue;
        const t = 1 - Math.sqrt(closest) / radius;
        const s = t * t * t * (t * (t * 6 - 15) + 10);
        const k = i * 3 + 2;
        col.array[k] = Math.max(col.array[k], peak * s);
      }
      col.needsUpdate = true;
    }
  }

  setActive(id) {
    const w = this.weapons.get(id);
    if (!w || w === this.active) return this.active;
    if (this.active) this.active.group.visible = false;
    this.active = w;
    w.group.visible = true;
    this.recPos.reset();
    this.recRot.reset();
    this.settle.reset();
    this.boltCycle = 0;
    this.boltHold = 0;
    this.magInHand = 0;
    this.magVisible = true;
    this.armR.setPose('grip');
    // The FITTED clamp for this weapon, not the authored one — see _fitSupportHand.
    this.armL.setPose(w.lhandPose ?? (id === 'pistol' ? 'cup' : 'clamp'));
    return w;
  }

  /* ====================================================================== */
  /*  clip playback                                                         */
  /* ====================================================================== */

  play(name) {
    const w = this.active;
    if (!w) return 0;
    const clip = w.clips[name];
    if (!clip) return 0;
    this.clip = clip;
    this.clipT = 0;
    this.clipPrevT = -1;
    return clip.duration;
  }

  stopClip() {
    this.clip = null;
    this.clipResult.active = false;
    this.clipResult.lhand.weight = 0;
  }

  get clipPlaying() {
    return this.clip !== null;
  }

  get clipName() {
    return this.clip?.name ?? null;
  }

  /* ====================================================================== */
  /*  impulses                                                              */
  /* ====================================================================== */

  /**
   * Per-shot viewmodel kick. `pitch`/`yaw` are the aim-space recoil for this
   * shot (from the deterministic pattern) so the visual climb matches where the
   * bullets are actually going.
   */
  addRecoil(pitch, yaw, first = false) {
    const w = this.active;
    if (!w) return;
    const r = w.def.recoil;
    const ads = this.adsT;
    /**
     * AIMED FIRE IS A CLEAN PUSH ALONG THE BARREL. NOTHING ELSE.
     *
     * Every axis here was a separate source of the "shaky, weird" feel, and
     * damping one of them (the pitch kick) was not enough — with the eye on the
     * optic, ANY motion that is not straight back reads as the sight picture
     * coming apart. Six things contribute and all six are taken out together at
     * full ADS:
     *
     *   vertical position   the muzzle lifting off the target        -> 0
     *   rotational pitch    the muzzle flipping up                   -> 0
     *   lateral position    a random left/right shove every shot     -> 8%
     *   roll                a random cant every shot                 -> 12%
     *   yaw                 random horizontal wander                 -> 25%
     *   per-shot jitter     random MAGNITUDE, so no two kicks match  -> none
     *
     * The last one matters as much as the rest: a kick that varies 0.86-1.16x
     * shot to shot cannot be anticipated, and an impulse you cannot anticipate
     * is exactly what "shaky" means. Aimed, every shot now kicks identically.
     *
     * DAMPING is the sixth fix and the least obvious. The return spring used to
     * run at the def's z=0.42 in hipfire — underdamped, so the weapon does not
     * return to rest, it OVERSHOOTS and oscillates about it. That was sold as
     * "life"; at 800 rpm it is a second kick arriving out of phase with the next
     * shot, and it is the single biggest reason hipfire read as harsh. Hipfire
     * now runs at 0.74 (still visibly springy, but it settles), aimed at 0.92.
     *
     * Hipfire keeps the CHARACTER of the full kick — flip, cant, wander — at
     * roughly half the old amplitude, and the random per-shot magnitude is
     * narrowed to +-7% (was +-15%). Randomness you cannot anticipate is what
     * "unsmooth" means; a little is texture, a lot is noise.
     */
    // See config.recoilScale / adsFlipKeep: this fork keeps a share of the
    // flip under the sights, because a rifle that does not move when you fire
    // it aimed is the whole reason the gun read as weightless.
    const cfg = this.ctx.config;
    const keep = cfg.adsFlipKeep ?? 0;
    const heft = cfg.recoilScale ?? 1;
    const scale = lerp(1, 0.54, ads) * (first ? 1.18 : 1) * heft;
    const backScale = lerp(1, 1.22, ads) * (first ? 1.18 : 1) * heft;
    const upScale = lerp(1, keep, ads) * (first ? 1.18 : 1) * heft;
    const pitchScale = lerp(1, keep, ads) * (first ? 1.18 : 1) * heft;
    const lateralScale = lerp(0.5, 0.08, ads);
    // Hipfire cant was overdone: the gun visibly tipped on every shot.
    const rollScale = lerp(0.26, 0.12, ads);
    const yawScale = lerp(0.62, 0.25, ads);
    const driftScale = lerp(0.55, 0.12, ads);
    // 1.0 = no shot-to-shot variation.
    const jitter = lerp(0.93 + this.rng.float() * 0.14, 1, ads);

    this.recPos.f = r.freq;
    this.recPos.z = lerp(0.74, 0.92, ads);
    this.recRot.f = r.freq * 0.92;
    this.recRot.z = lerp(0.74, 0.92, ads);
    // A velocity impulse of v0 on a spring of angular frequency w peaks at
    // roughly v0/w, so the kick amplitudes below are in real metres/radians.
    const wp = TAU * this.recPos.f;
    const wr = TAU * this.recRot.f;
    this.recPos.kick(
      this.rng.signed() * r.kickBack * 0.2 * lateralScale * scale * wp,
      r.kickUp * upScale * jitter * wp,
      r.kickBack * backScale * jitter * wp
    );
    this.recRot.kick(
      (pitch * 5.5 + r.pitch * 1.4) * pitchScale * jitter * wr,
      (-yaw * 4.5 - this.rng.signed() * r.yaw * 0.8) * yawScale * scale * wr,
      (this.rng.signed() * 0.4 + 0.6) * r.roll * rollScale * scale * wr
    );
    // Slow settling drift after a burst — the muzzle keeps wandering a little.
    const ws = TAU * this.settle.f;
    this.settle.kick(
      this.rng.signed() * 0.0012 * driftScale * scale * ws,
      0.0018 * driftScale * scale * ws,
      this.rng.signed() * 0.003 * driftScale * scale * ws
    );
    this.boltCycle = 1;
  }

  jump() {
    this.jumpSpring.kick(-1.2);
  }

  land(speed = 3) {
    this.landSpring.kick(clamp(speed * 0.45, 0.4, 3.4));
  }

  /* ====================================================================== */
  /*  frame update                                                          */
  /* ====================================================================== */

  /**
   * @param {number} dt
   * @param {object} s  { ads, sprint, lowReady, speed, crouch, airborne,
   *                      trigger, empty, cycleTime }
   */
  update(dt, s) {
    const w = this.active;
    if (!w) return;
    const def = w.def;
    // Defensive: a non-positive or absurd dt would integrate the whole
    // animation stack backwards (a negative step snaps ADS straight to 1).
    dt = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;

    /* -------- camera-relative anchor ---------------------------------- */
    const cam = this.ctx.camera;
    const vcam = this.ctx.viewCamera;
    if (this.trackCamera) {
      cam.updateMatrixWorld();
      this.anchor.position.setFromMatrixPosition(cam.matrixWorld);
      this.anchor.quaternion.setFromRotationMatrix(cam.matrixWorld);
      // Keep the viewmodel camera coincident with the world camera: the renderer
      // uses that to decide the gun can share the world's shadow cascades.
      vcam.position.copy(this.anchor.position);
      vcam.quaternion.copy(this.anchor.quaternion);
    }

    /* -------- angular velocity for the lag layer ---------------------- */
    // Safe against the camera's roll: the rig composes YXZ and this decomposes
    // YXZ, so the bank cancels exactly and never shows up as a phantom turn.
    _e.setFromQuaternion(this.anchor.quaternion, 'YXZ');
    const yaw = _e.y;
    const pitch = _e.x;
    if (this._hasPrev && dt > 1e-5) {
      const dy = wrapPi(yaw - this._prevYaw) / dt;
      const dp = wrapPi(pitch - this._prevPitch) / dt;
      // Low-pass, then clamp: a teleport must not throw the gun off screen.
      // 18 -> 11: a slower low-pass on a noisy per-frame estimate. The lag
      // layer is meant to trail the camera, not to track its jitter.
      this._angVel.yaw = damp(this._angVel.yaw, clamp(dy, -9, 9), 11, dt);
      this._angVel.pitch = damp(this._angVel.pitch, clamp(dp, -9, 9), 11, dt);
    } else {
      this._angVel.yaw = 0;
      this._angVel.pitch = 0;
    }
    this._prevYaw = yaw;
    this._prevPitch = pitch;
    this._hasPrev = true;

    /* -------- blends --------------------------------------------------- */
    const adsRate = 1 / Math.max(0.05, def.adsTime * (this.ctx.config.adsScale ?? 1));
    const wantAds = this.clip && this.clip.name !== 'draw' ? 0 : s.ads ? 1 : 0;
    this.adsTarget = wantAds;
    // Linear rate with a smootherstep shaping: a spring here reads as mushy.
    this.adsT = clamp01(this.adsT + (wantAds ? adsRate : -adsRate * 1.25) * dt);
    const ads = smootherstep(0, 1, this.adsT);

    const sprintTarget = s.sprint && !this.clip ? 1 : 0;
    this.sprintT = damp(this.sprintT, sprintTarget, 9, dt);
    this.lowReadyT = damp(this.lowReadyT, s.lowReady ? 1 : 0, 8, dt);

    this.triggerTarget = s.trigger ? 1 : 0;
    this.triggerT = damp(this.triggerT, this.triggerTarget, 26, dt);

    /* -------- base pose ------------------------------------------------ */
    const hipP = def.hipPos;
    const hipR = def.hipRot;
    this._basePos.set(hipP[0], hipP[1], hipP[2]);
    _e.set(hipR[0], hipR[1], hipR[2], 'XYZ');
    this._baseQuat.setFromEuler(_e);

    // Sprint / low-ready poses replace the hip pose.
    if (this.sprintT > 1e-3) {
      const p = def.sprintPos;
      const r = def.sprintRot;
      this._tmpPos.set(p[0], p[1], p[2]);
      _e.set(r[0], r[1], r[2], 'XYZ');
      this._tmpQuat.setFromEuler(_e);
      this._basePos.lerp(this._tmpPos, this.sprintT);
      this._baseQuat.slerp(this._tmpQuat, this.sprintT);
    }
    if (this.lowReadyT > 1e-3) {
      const p = def.lowReadyPos;
      const r = def.lowReadyRot;
      this._tmpPos.set(p[0], p[1], p[2]);
      _e.set(r[0], r[1], r[2], 'XYZ');
      this._tmpQuat.setFromEuler(_e);
      this._basePos.lerp(this._tmpPos, this.lowReadyT);
      this._baseQuat.slerp(this._tmpQuat, this.lowReadyT);
    }

    /* -------- ADS pose: solved, not authored --------------------------- */
    if (ads > 1e-4) {
      const cant = def.adsCant;
      _e.set(cant[0], cant[1], cant[2], 'XYZ');
      this._adsQuat.setFromEuler(_e);
      // sight point in rig space, then the translation that lands it on axis
      this._sightLocal.copy(w.sight).applyQuaternion(this._adsQuat);
      this._adsPos.set(0, 0, -def.eyeRelief).sub(this._sightLocal);
      this._basePos.lerp(this._adsPos, ads);
      this._baseQuat.slerp(this._adsQuat, ads);
    }

    /* -------- additive layers ------------------------------------------ */
    const swayScale = def.swayScale * lerp(1, 0.22, ads) * lerp(1, 1.5, this.sprintT);
    this.noiseT += dt;
    const n = this.noise;
    const nr = this.noiseRates;
    const t = this.noiseT;
    // Layered, incommensurate rates: the pattern does not repeat in a session.
    const swayX = n[0].fbm(t * nr[0], 3) * 0.55 + n[3].fbm(t * nr[3] * 2.3, 2) * 0.45;
    const swayY = n[1].fbm(t * nr[1], 3) * 0.55 + n[4].fbm(t * nr[4] * 2.1, 2) * 0.45;
    const swayZ = n[2].fbm(t * nr[2], 2) * 0.6 + n[5].fbm(t * nr[5] * 1.7, 2) * 0.4;
    // Breathing: a slow 0.22 Hz cycle under the noise.
    const breath = Math.sin(t * 1.38) * 0.5 + Math.sin(t * 0.61 + 1.1) * 0.25;

    let px = swayX * 0.0075 * swayScale;
    let py = (swayY * 0.006 + breath * 0.0022) * swayScale;
    let pz = swayZ * 0.004 * swayScale;
    let rx = (swayY * 0.021 + breath * 0.006) * swayScale;
    let ry = swayX * 0.028 * swayScale;
    let rz = swayZ * 0.017 * swayScale;

    /* -------- movement bob --------------------------------------------- */
    const speed = s.speed ?? 0;
    /**
     * The AMPLITUDE IS DAMPED, not taken from the instantaneous speed.
     *
     * This was the jitter when reversing a strafe while aimed, and it was not
     * the recoil, the lag layer or the camera bank. Reversing direction takes
     * the ground speed down to ~0 and back inside 75 ms; an amplitude read
     * straight off that speed collapses and recovers with it, which put a
     * V-shaped notch of 1.4 mm and 0.16 deg into the weapon's pose with a hard
     * corner at the bottom. Small, but through an optic it is a visible twitch,
     * and it fires every time you change direction.
     *
     * The camera's own bob has always damped its weight (CAMERA.bob.airFade);
     * this one simply never did. tau ~0.125 s: the bob now fades out and back
     * across the reversal instead of snapping with the speed trace. It also
     * fixes the same notch on every stop, start and sprint transition.
     */
    const bobTarget =
      def.bobScale * clamp01(speed / 4.0) * lerp(1, 0.28, ads) * (s.airborne ? 0.25 : 1);
    this.bobWeight = damp(this.bobWeight, bobTarget, 8, dt);
    const bobAmt = this.bobWeight;
    if (speed > 0.05) {
      // Stride frequency scales with speed; sprint takes longer strides.
      this.bobPhase += dt * (3.1 + speed * 0.72) * (s.sprint ? 1.05 : 1);
      if (this.bobPhase > TAU * 64) this.bobPhase -= TAU * 64;
    }
    const bp = this.bobPhase;
    px += Math.sin(bp) * 0.0165 * bobAmt;
    py += (Math.abs(Math.cos(bp)) - 0.6) * 0.0125 * bobAmt;
    pz += Math.sin(bp * 2) * 0.0055 * bobAmt;
    rz += Math.sin(bp) * 0.031 * bobAmt;
    rx += Math.cos(bp * 2) * 0.014 * bobAmt;
    ry += Math.sin(bp + 0.6) * 0.019 * bobAmt;

    /* -------- weapon lag ---------------------------------------------- */
    /**
     * Lag is halved again when aimed. It is driven by a per-frame angular
     * velocity, and a mouse delivers whole-pixel deltas, so at high frame rates
     * that signal is noisy shot to shot. Hipfire hides it; through the sights
     * the magnified picture turns it into a visible jitter while turning.
     */
    // A rifle held by a man who is turning is not a rifle bolted to a camera:
    // it trails, then swings past, then settles. The arcade fork wants that
    // small enough to shoot through; this one wants to feel the weight of it.
    const lagScale = lerp(1, 0.2, ads) * (this.ctx.config.bodycam ? 1.75 : 1);
    const av = this._angVel;
    this.lag.step(
      dt,
      clamp(-av.yaw * 0.019, -0.05, 0.05) * lagScale,
      clamp(av.pitch * 0.014, -0.04, 0.04) * lagScale,
      clamp(-Math.abs(av.yaw) * 0.006, -0.03, 0.03) * lagScale
    );
    this.lagRot.step(
      dt,
      clamp(-av.pitch * 0.075, -0.24, 0.24) * lagScale,
      clamp(av.yaw * 0.085, -0.3, 0.3) * lagScale,
      clamp(-av.yaw * 0.055, -0.2, 0.2) * lagScale
    );
    px += this.lag.x;
    py += this.lag.y;
    pz += this.lag.z;
    rx += this.lagRot.x;
    ry += this.lagRot.y;
    rz += this.lagRot.z;

    /* -------- recoil + settle ----------------------------------------- */
    this.recPos.step(dt, 0, 0, 0);
    this.recRot.step(dt, 0, 0, 0);
    this.settle.step(dt, 0, 0, 0);
    px += this.recPos.x;
    py += this.recPos.y;
    pz += this.recPos.z;
    rx += this.recRot.x + this.settle.y;
    ry += this.recRot.y + this.settle.x;
    rz += this.recRot.z + this.settle.z;

    /* -------- jump / land --------------------------------------------- */
    this.jumpSpring.step(dt, 0);
    this.landSpring.step(dt, 0);
    py -= this.landSpring.x * 0.014 + this.jumpSpring.x * 0.006;
    rx -= this.landSpring.x * 0.05;

    /* -------- clip (reload / inspect / draw) -------------------------- */
    const res = this.clipResult;
    if (this.clip) {
      this.clipT += dt;
      const c = this.clip;
      const tt = clamp(this.clipT, 0, c.duration);
      c.sample(tt, res);
      for (const ev of c.events) {
        if (ev.t > this.clipPrevT && ev.t <= tt) this.onClipEvent?.(ev.name, c.name);
      }
      this.clipPrevT = tt;
      px += res.pos[0];
      py += res.pos[1];
      pz += res.pos[2];
      rx += res.rot[0];
      ry += res.rot[1];
      rz += res.rot[2];
      if (this.clipT >= c.duration) {
        this.stopClip();
      }
    }

    /* -------- compose -------------------------------------------------- */
    this.rig.position.set(
      this._basePos.x + px,
      this._basePos.y + py,
      this._basePos.z + pz
    );
    _e.set(rx, ry, rz, 'XYZ');
    _q.setFromEuler(_e);
    this.rig.quaternion.copy(this._baseQuat).multiply(_q);
    // The standalone preview harness pins the rig so the weapon can be framed
    // in its own space; everything downstream reads the composed transform.
    if (this.rigOverride) {
      this.rig.position.copy(this.rigOverride.position);
      this.rig.quaternion.copy(this.rigOverride.quaternion);
    }
    this.rig.updateMatrix();
    this.rig.updateMatrixWorld(true);

    /* -------- hands (first: the magazine can be held by one) ---------- */
    this._solveHands(w, res);

    /* -------- moving parts -------------------------------------------- */
    this._updateParts(w, dt, s, res);

    /* -------- reticle -------------------------------------------------- */
    this._updateReticle(w, ads);

    /* -------- viewmodel FOV ------------------------------------------- */
    const fovBase = 60;
    const targetFov = fovBase * lerp(1, def.viewFov, ads);
    if (Math.abs(vcam.fov - targetFov) > 1e-3) {
      vcam.fov = targetFov;
      vcam.updateProjectionMatrix();
    }
  }

  /* ---------------------------------------------------------------------- */

  _updateParts(w, dt, s, res) {
    const p = w.parts;

    // Bolt / slide cycle: a fast rearward stroke and a slightly slower return.
    if (this.boltCycle > 0) {
      const cycle = Math.max(0.045, (w.def.cycleTime ?? 60 / w.def.rpm) * 0.62);
      this.boltCycle = Math.max(0, this.boltCycle - dt / cycle);
    }
    const cyc = this.boltCycle;
    // 1 -> 0 over the cycle: out fast, back with a small bounce.
    const stroke = cyc > 0.55 ? (1 - cyc) / 0.45 : cyc / 0.55;
    const clipBolt = res.active ? res.parts.bolt : 0;
    const boltOff = Math.max(stroke, this.boltHold, clipBolt * this.boltHold);

    if (p.bolt) {
      p.bolt.position.set(
        w.model.nodes.boltRest.pos[0] + w.boltTravel.x * boltOff,
        w.model.nodes.boltRest.pos[1] + w.boltTravel.y * boltOff,
        w.model.nodes.boltRest.pos[2] + w.boltTravel.z * boltOff
      );
    }
    if (p.slide) {
      p.slide.position.set(
        w.model.nodes.slideRest.pos[0] + w.slideTravel.x * boltOff,
        w.model.nodes.slideRest.pos[1] + w.slideTravel.y * boltOff,
        w.model.nodes.slideRest.pos[2] + w.slideTravel.z * boltOff
      );
    }
    if (p.charging) {
      const pull = res.active ? res.parts.charge : 0;
      const rest = w.model.nodes.chargeRest.pos;
      p.charging.position.set(
        rest[0] + w.chargePull.x * pull,
        rest[1] + w.chargePull.y * pull,
        rest[2] + w.chargePull.z * pull
      );
    }
    if (p.trigger) {
      p.trigger.rotation.x = w.triggerPull * this.triggerT;
    }
    if (p.selector) {
      p.selector.rotation.x = lerp(-0.95, 0, clamp01(this.selectorLive ?? 1));
    }

    // Magazine: seated, in the support hand, or hidden.
    if (p.magazine) {
      const inHand = res.active ? res.parts.mag : 0;
      this.magVisible = res.active ? res.parts.magVisible : true;
      p.magazine.visible = this.magVisible;
      if (inHand > 1e-4) {
        // Follow the support hand: the magazine is gripped by its spine.
        this._magFromHand(w, p.magazine, inHand);
      } else {
        p.magazine.position.copy(w.magSeatPos);
        p.magazine.quaternion.copy(w.magSeatQuat);
      }
    }
  }

  _magFromHand(w, magGroup, weight) {
    // The hand target is a WRIST in weapon space, so the magazine has to be
    // offset into the palm (about 62 mm along the hand's -Z, the metacarpal
    // axis) before the along-the-magazine offset — otherwise the mag is gripped
    // by thin air behind the hand.
    _q.copy(this._handQuatL);
    _v.copy(this._handPosL);
    _v2.set(0, w.magLen * 0.62, -0.062).applyQuaternion(_q);
    _v.add(_v2);
    magGroup.position.lerpVectors(w.magSeatPos, _v, weight);
    _q2.copy(w.magSeatQuat).slerp(_q, weight);
    magGroup.quaternion.copy(_q2);
  }

  _solveHands(w, res) {
    // Shoulders are body-fixed: express the camera-space anchor in rig space.
    _q.copy(this.rig.quaternion).invert();
    _v.copy(this.shoulderR).sub(this.rig.position).applyQuaternion(_q);
    this.armR.shoulder.copy(_v);
    _v.copy(this.shoulderL).sub(this.rig.position).applyQuaternion(_q);
    this.armL.shoulder.copy(_v);

    // ---- shooting hand: welded to the grip ----
    const gR = w.gripR;
    this._handPos.fromArray(gR.pos);
    handBasis(this._handQuat, gR.finger ?? [0, -0.35, -0.94], gR.back ?? [0.95, 0.25, 0.18]);
    this.armR.solve(this._handPos, this._handQuat);
    this.armR.setTrigger(this.triggerT);

    // ---- support hand: grip, or wherever the clip puts it ----
    const gL = w.gripL;
    let pos = gL.pos;
    let finger = gL.finger ?? [0.82, 0.5, -0.28];
    let back = gL.back ?? [-0.5, 0.32, -0.8];
    let pose = w.lhandPose ?? (w.id === 'pistol' ? 'cup' : 'clamp');
    if (res.active && res.lhand.weight > 0.5) {
      pos = res.lhand.pos;
      finger = res.lhand.finger;
      back = res.lhand.back;
      pose = res.lhand.pose;
    }
    this._handPosL.set(pos[0], pos[1], pos[2]);
    handBasis(this._handQuatL, finger, back);
    if (pose !== this.armL.pose) this.armL.setPose(pose);
    this.armL.solve(this._handPosL, this._handQuatL);
  }

  /**
   * The collimated dot.
   *
   * A red dot sight is a collimator: the reticle sits at optical infinity along
   * the tube axis, so its apparent direction from the eye is the tube axis —
   * independent of where the eye is. Reproducing that exactly (rather than
   * gluing a sprite to the glass) is why the dot stays on target while the
   * weapon sways, and why it vignettes out when you look through the tube from
   * an angle.
   */
  _updateReticle(w, ads) {
    const optic = w.optic;
    if (!optic) {
      this.reticle.visible = false;
      return;
    }
    // Optic axis and lens centre, both in camera space. The weapon group is a
    // child of the rig which is a child of the anchor, so camera space is just
    // the rig transform applied to the weapon-local values — no inverses, no
    // allocation.
    _v.fromArray(optic.center).applyQuaternion(this.rig.quaternion).add(this.rig.position);
    _v3.set(0, 0, -1).applyQuaternion(this.rig.quaternion).normalize();

    // Where the axis ray from the eye crosses the lens plane.
    const s = _v.dot(_v3);
    if (s <= 0.02) {
      this.reticle.visible = false;
      return;
    }
    _v2.copy(_v3).multiplyScalar(s); // dot position in camera space
    // Vignette: how far off the lens centre the apparent dot lands.
    const offX = _v2.x - _v.x;
    const offY = _v2.y - _v.y;
    const off = Math.hypot(offX, offY);
    const apertureR = optic.apertureR ?? 0.01;
    let alpha = 1 - smootherstep(apertureR * 0.5, apertureR * 1.05, off);
    alpha *= lerp(0.55, 1, ads); // brighter once the eye is behind the glass

    if (alpha <= 0.01) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.visible = true;
    /**
     * Which mark is lit. The optic's `reticle` field selects it, so an OKP-7
     * shows its green chevron and everything else shows the dot — and the dark
     * keyline goes with the dot, since the chevron is large enough to survive a
     * blown-out sky on its own.
     */
    const chev = w.optics?.[w.opticId]?.reticle === 'chevron';
    if (this.chevron) this.chevron.visible = chev;
    this.dotCore.visible = !chev;
    this.dotRim.visible = !chev;
    this.reticle.position.copy(_v2);
    this.reticle.lookAt(this.anchor.getWorldPosition(_v));
    /**
     * SIZE. Angular, so it is FOV-independent within a stance — but not constant
     * across stances, because the requirement is a fixed number of PIXELS.
     *
     * A geometrically honest 2 MOA emitter subtends 0.58 mrad, which at the
     * viewmodel camera's 0.97 mrad/px (60 deg over 1080 px) is 0.6 px: a dead
     * subpixel, which is exactly what the old 0.0012 rad dot measured as. Every
     * shipped red dot cheats this, and cheats it in the same direction — the
     * reticle is drawn at a legible size and grows as you come into the glass,
     * because that is the perceptual experience of putting your eye behind a
     * collimator. So:
     *   hipfire  0.00385 rad -> 4.0 px radius,  7.9 px dot
     *   ADS      0.00655 rad -> 7.9 px radius, 15.7 px dot   (0.83 mrad/px)
     * with the halo at 1.6x and the segmented ring at 3.2x, both scaled off the
     * same number so the reticle never changes shape.
     */
    // Halved from 0.00385/0.00655: with the ring and halo gone the dot is the
    // only mark on screen, so it can be precise instead of legible-at-a-glance.
    const coreR = s * lerp(0.00205, 0.0033, ads);
    this.dotCore.scale.setScalar(coreR);
    this.dotRim.scale.setScalar(coreR);
    /**
     * The chevron scales off the SAME coreR, so both reticles read at the same
     * apparent size. Scale is applied per-mesh here, not on the parent group —
     * miss this and the chevron stays at unit radius, which is a metre wide at
     * the reticle's distance and fills the screen with green.
     */
    if (this.chevron) this.chevron.scale.setScalar(coreR);
    this.dotHalo.scale.setScalar(coreR);
    this.dotRing.scale.setScalar(coreR);
    this.dotCore.material.opacity = alpha;
    this.dotRim.material.opacity = alpha * 0.8;
    this.dotRing.material.opacity = alpha;
    // The halo is a bloom seed, not a glow: 6% at 1.6x the core radius adds ~1 px
    // of soft falloff and nothing else.
    this.dotHalo.material.opacity = alpha * 0.06;
  }

  /* ====================================================================== */
  /*  world-space queries for firing                                        */
  /* ====================================================================== */

  /** Muzzle position in WORLD space (for the flash and the shell). */
  muzzleWorld(out) {
    const w = this.active;
    if (!w) return out.set(0, 0, 0);
    w.group.updateMatrixWorld();
    out.copy(w.muzzle).applyMatrix4(w.group.matrixWorld);
    // viewScene space == world space because the anchor tracks the camera.
    return out;
  }

  ejectWorld(out) {
    const w = this.active;
    if (!w) return out.set(0, 0, 0);
    w.group.updateMatrixWorld();
    out.copy(w.eject).applyMatrix4(w.group.matrixWorld);
    return out;
  }

  ejectVelocity(out, speed = 2.6) {
    const w = this.active;
    if (!w) return out.set(0, 0, 0);
    out.copy(w.ejectDir).transformDirection(w.group.matrixWorld).multiplyScalar(speed);
    return out;
  }

  /** Bore direction in world space. */
  boreDir(out) {
    const w = this.active;
    if (!w) return out.set(0, 0, -1);
    out.set(0, 0, -1).transformDirection(w.group.matrixWorld).normalize();
    return out;
  }

  dispose() {
    for (const w of this.weapons.values()) {
      for (const m of w.meshes) m.geometry.dispose();
    }
    this.weapons.clear();
    this.armL.dispose();
    this.armR.dispose();
    for (const g of this._reticleGeo) g.dispose();
    this.anchor.removeFromParent();
  }
}

function applyNode(obj, node) {
  obj.position.fromArray(node.pos);
  if (node.rot) obj.rotation.fromArray(node.rot);
}
