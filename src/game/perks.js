import * as THREE from 'three';
import { HEALTH, JUMP_SPEED } from '../player/tuning.js';

/**
 * PERKS — the Vampire Survivors loop, on Holdout's wave rhythm.
 *
 * The thing that makes that genre work is not the upgrades themselves, it is
 * that a run CHANGES SHAPE while you are inside it. A wave you barely survived
 * becomes a wave you walk through, and the reason is a choice you made rather
 * than a number that went up on its own. So every perk is a visible change in
 * how the gun or the body behaves, offered three at a time, and the run resets
 * when you die.
 *
 * MULTIPLIERS, NOT MUTATED TUNING. Every perk is a scalar this module owns, and
 * the systems multiply by it at the point of use. Nothing here writes into
 * tuning.js or into a weapon def: those are shared, module-level constants, so a
 * perk that edited them would persist across a death, across a map change, and
 * into every other mode — the classic "why is my pistol still doing 4x damage"
 * bug. Death resets this object and every system is instantly back to stock.
 *
 * WHY THESE SEVEN. Each one has a single clean hook and a legible effect:
 *
 *   damage / firerate   weapons/index.js, at the shot
 *   health              player/health.js, via a bonus the max is derived from
 *   jump                player/index.js, at the impulse
 *   regen               player/health.js, on the regen rate
 *   explosive           an `explosion` event on impact — the one that changes
 *                       how the gun FEELS rather than what it scores
 *   magnet              the pickup radius, so chests stop being a chore
 */

export const PERKS = {
  damage: {
    label: 'Hollow Point',
    desc: (n) => `+${n * 25}% bullet damage`,
    max: 6,
  },
  health: {
    label: 'Field Plate',
    desc: (n) => `+${n * 30} maximum health`,
    max: 5,
  },
  firerate: {
    label: 'Match Trigger',
    desc: (n) => `+${n * 12}% fire rate`,
    max: 5,
  },
  jump: {
    label: 'Spring Legs',
    desc: (n) => `+${n * 18}% jump height`,
    max: 3,
  },
  regen: {
    label: 'Trauma Kit',
    desc: (n) => `heal ${1 + n * 0.6}x faster, sooner`,
    max: 3,
  },
  explosive: {
    label: 'Explosive Rounds',
    desc: (n) => `rounds detonate · ${(1.6 + n * 0.7).toFixed(1)} m`,
    max: 3,
  },
  magnet: {
    label: 'Scavenger',
    desc: (n) => `+${n * 100}% pickup reach`,
    max: 2,
  },
};

/**
 * Kills needed for the next level.
 *
 * Flat-per-level would make the tenth upgrade as cheap as the first while the
 * waves get bigger, so the run peaks early and then just repeats. Growing the
 * cost keeps the shape of the genre: fast, obvious change at the start, and a
 * later run where a level is an event. The numbers are small on purpose —
 * 4 kills to the first upgrade means wave one already changes the run.
 */
const XP_BASE = 4;
const XP_STEP = 2;

/** Plate capacity. One armour pickup is a bit under half of it. */
const ARMOR_MAX = 100;

export class Perks {
  constructor() {
    this.level = {};
    this.reset();
  }

  reset() {
    for (const id of Object.keys(PERKS)) this.level[id] = 0;
    this.xp = 0;
    this.plevel = 1;
    this.armor = 0;
    this.kills = 0;
  }

  get xpToNext() {
    return XP_BASE + (this.plevel - 1) * XP_STEP;
  }

  get armorMax() {
    return ARMOR_MAX;
  }

  addArmor(n) {
    const add = Math.min(n, ARMOR_MAX - this.armor);
    this.armor += add;
    return add;
  }

  /**
   * Credit a kill. Returns how many levels it caused, which is nearly always 0
   * or 1 but can be more if a perk offer was pending while a crowd died — the
   * caller queues them rather than dropping the extras on the floor.
   */
  addXp(n = 1) {
    this.kills += n;
    this.xp += n;
    let gained = 0;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.plevel++;
      gained++;
    }
    return gained;
  }

  take(id) {
    if (!PERKS[id]) return false;
    if (this.level[id] >= PERKS[id].max) return false;
    this.level[id]++;
    return true;
  }

  /** Three offers, never a maxed perk, never a duplicate within the offer. */
  roll(rng, n = 3) {
    const pool = Object.keys(PERKS).filter((id) => this.level[id] < PERKS[id].max);
    const out = [];
    while (out.length < n && pool.length) {
      const k = Math.floor((rng?.float?.() ?? Math.random()) * pool.length) % pool.length;
      out.push(pool.splice(k, 1)[0]);
    }
    return out;
  }

  /* ---- derived scalars, read by the systems ------------------------- */
  get damageMult() {
    return 1 + this.level.damage * 0.25;
  }
  get fireRateMult() {
    return 1 + this.level.firerate * 0.12;
  }
  get healthBonus() {
    return this.level.health * 30;
  }
  get maxHealth() {
    return HEALTH.max + this.healthBonus;
  }
  get jumpSpeed() {
    return JUMP_SPEED * (1 + this.level.jump * 0.18);
  }
  get regenMult() {
    return 1 + this.level.regen * 0.6;
  }
  /** Seconds shaved off the regen delay — the half of "heal sooner" that matters. */
  get regenDelayCut() {
    return this.level.regen * 0.9;
  }
  get explosiveRadius() {
    return this.level.explosive ? 1.6 + this.level.explosive * 0.7 : 0;
  }
  get pickupRadius() {
    return 2.2 * (1 + this.level.magnet);
  }

  /** Compact line for the HUD. */
  summary() {
    return Object.entries(this.level)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `${PERKS[id].label} ${n}`)
      .join(' · ');
  }
}

/* ====================================================================== *
 *  PICKUPS
 * ====================================================================== */

/**
 * Seconds between consecutive level-up rolls. Long enough that two levels read
 * as two events, short enough that a backlog drains while it still matters.
 */
const ROLL_SPACING = 0.75;

/** How far a pickup floats above the ground point it was placed on. */
const CHEST_Y = 0.55;

/**
 * Seconds a dropped pickup survives, and the most that may exist at once.
 *
 * 45 s is long enough to finish the fight you are in and then go and get it,
 * which is the decision a drop is supposed to create. 20 is well above what a
 * player can have in flight during a normal wave, so the cap only ever catches
 * the runaway case.
 */
const PICKUP_TTL = 45;
const PICKUP_MAX = 20;

/**
 * The drop table.
 *
 * `chance` is the per-kill probability, and they are deliberately low enough that
 * the sum is under a third: a pickup has to be worth crossing the map for, and
 * something that drops off every second body is just a slower reload. Colour is
 * the entire identity of these things at 40 m, so the three are as far apart on
 * the wheel as the palette allows — gold, blue, orange.
 */
export const PICKUPS = {
  ammo: { chance: 0.16, color: 0xffe14a, emissive: 0xffab00, size: [0.5, 0.34, 0.36] },
  armor: { chance: 0.1, color: 0x5ad1ff, emissive: 0x1470c8, size: [0.46, 0.56, 0.22] },
  /** The instant upgrade. Rare, because it skips the whole XP economy. */
  chest: { chance: 0.035, color: 0xffc23a, emissive: 0xff8c1a, size: [0.7, 0.55, 0.5] },
};

/**
 * A pickup. Deliberately a single emissive box rather than a model: it has to be
 * readable across a 60 m map at a glance, and the thing that makes it readable
 * is that it GLOWS and BOBS, not that it has hinges.
 */
/**
 * ONE geometry and ONE material per kind, for every pickup ever spawned.
 *
 * These used to be built per drop and then only ever removed from the scene —
 * `parent.remove()` unhooks a mesh but disposes nothing — so each pickup leaked
 * a geometry and a material for the rest of the session. Measured at 10 fresh
 * geometries per 10 drops with no ceiling, and drops are on a kill, so a long
 * run bled GPU objects continuously. That is what the harsh late-run stutter
 * was: not one expensive event, an ever-growing pile.
 *
 * Sharing removes both the allocation and the need to dispose anything, since
 * a mesh holding a borrowed geometry owns nothing. Prewarmed at boot too, so
 * the first drop of a run does not pay the compile.
 */
const PICKUP_GEO = {};
const PICKUP_MAT = {};

export function prewarmPickups() {
  for (const kind of Object.keys(PICKUPS)) makePickup(kind);
}

/**
 * A menu map change tears down one renderer before constructing the next. The
 * shared caches must follow that renderer lifetime: otherwise the next
 * MaterialPatcher wraps an already-patched material (duplicate GLSL), while the
 * old renderer keeps the geometry/texture handles resident until context loss.
 */
function disposePickupResources() {
  for (const resource of Object.values(PICKUP_GEO)) resource?.dispose?.();
  for (const resource of Object.values(PICKUP_MAT)) resource?.dispose?.();
  for (const key of Object.keys(PICKUP_GEO)) delete PICKUP_GEO[key];
  for (const key of Object.keys(PICKUP_MAT)) delete PICKUP_MAT[key];
}

function makePickup(kind) {
  const spec = PICKUPS[kind] ?? PICKUPS.chest;
  PICKUP_GEO[kind] ??= new THREE.BoxGeometry(...spec.size);
  PICKUP_MAT[kind] ??= new THREE.MeshStandardMaterial({
    name: `pickup-${kind}`,
    color: spec.color,
    emissive: spec.emissive,
    emissiveIntensity: 1.5,
    roughness: 0.45,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(PICKUP_GEO[kind], PICKUP_MAT[kind]);
  mesh.name = `pickup-${kind}`;
  mesh.userData.kind = kind;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export class PerkSystem {
  static id = 'perks';
  static deps = ['player', 'ui'];

  init(ctx) {
    this.ctx = ctx;
    this.perks = new Perks();
    ctx.perks = this.perks;
    this.chests = [];
    this._t = 0;
    this._v = new THREE.Vector3();
    /** Levels earned but not yet spent — the card is modal, kills are not. */
    this._queue = 0;
    this._rollCd = 0;

    // A chest per wave, dropped where the wave died rather than on a schedule:
    // the reward should be where the fight was.
    this._offWave = ctx.events.on('wave:cleared', (e) => this.spawnChest(e?.position));
    this._offDeath = ctx.events.on('player:respawn', () => this.reset());

    /**
     * KILLS ARE THE PROGRESSION.
     *
     * Before this, the only source of upgrades was one chest per wave clear, so
     * a run's shape changed about once a minute and killing things fed nothing.
     * That is the difference between a horde mode and a survivors mode: here the
     * fight itself is what levels you, and the drops mean a body is worth
     * walking to.
     *
     * Guarded on `alive === false` because `actor:death` is also how a corpse
     * announces itself to the ragdoll path; only real kills should score.
     */
    this._offKill = ctx.events.on('actor:death', (e) => {
      const actor = e?.actor;
      if (!actor || actor.__scored) return;
      actor.__scored = true;
      this._queue += this.perks.addXp(1);
      this._offerNext();
      this.rollDrop(e?.point ?? actor.position);
    });

    /**
     * Explosive rounds. Hooked here rather than in the weapon so that the perk
     * owns its own behaviour completely — nothing in the shot path knows perks
     * exist, and removing this file removes the feature.
     */
    this._offImpact = ctx.events.on('bullet:impact', (p) => {
      const r = this.perks.explosiveRadius;
      if (!r || !p?.point) return;
      ctx.events.emit('explosion', {
        position: new THREE.Vector3(p.point.x, p.point.y, p.point.z),
        radius: r,
        // Modest: this fires on EVERY round, so grenade damage here would make
        // the rifle a rocket launcher and the perk an instant win.
        damage: 18 + this.perks.level.explosive * 10,
        source: null,
      });
    });
  }

  reset() {
    this.perks.reset();
    this._queue = 0;
    this._rollCd = 0;
    for (const c of this.chests) c.parent?.remove(c);
    this.chests.length = 0;
  }

  /** One roll against the drop table, at the body. */
  rollDrop(at) {
    if (!at) return;
    // Nothing drops out of a man you shot. A pick-one-of-three card in the
    // middle of a firefight is the arcade fork's fantasy of being powerful;
    // this one's is that the room is dangerous. The system stays registered and
    // wired — armour and ammo still resolve through it — it just stops handing
    // out upgrades. See DIRECTION.md.
    if (this.ctx.config.hardcore) return;
    const r = this.ctx.rng?.float?.() ?? Math.random();
    let acc = 0;
    for (const [kind, spec] of Object.entries(PICKUPS)) {
      acc += spec.chance;
      if (r < acc) return this.spawnChest(at, kind);
    }
  }

  /**
   * @param {THREE.Vector3} [near] where it died; falls back to a spawn point.
   * @param {string} [kind] one of PICKUPS; defaults to the wave-clear chest.
   */
  spawnChest(near, kind = 'chest') {
    const ctx = this.ctx;
    let p = near;
    if (!p) {
      const spawns = ctx.peek('world')?.spawnPoints ?? [];
      p = spawns.length ? spawns[(Math.random() * spawns.length) | 0].position : null;
    }
    if (!p) return;

    /**
     * A HARD CAP, oldest first.
     *
     * Pickups had no lifetime, so every one the player never walked over stayed
     * for the rest of the run. Measured over 20 waves: 110 of them still on the
     * map, and the scene node count climbing 22 a wave with no ceiling. They are
     * cheap individually — a shared geometry and one draw call — but each one is
     * also bobbed and spun and distance-checked every single frame, so the cost
     * is per-frame and it only goes up.
     *
     * A cap rather than only a timer because the cap is what actually bounds
     * the work: a bad run can drop faster than the timer clears them.
     */
    while (this.chests.length >= PICKUP_MAX) {
      const old = this.chests.shift();
      old.parent?.remove(old);
    }

    const mesh = makePickup(kind);
    mesh.userData.born = this._t;
    mesh.position.set(p.x, p.y + CHEST_Y, p.z);
    mesh.userData.baseY = mesh.position.y;
    ctx.scene.add(mesh);
    this.chests.push(mesh);
  }

  /**
   * Apply a pickup. Returns false when it should be left on the ground —
   * walking over a full ammo box must not silently consume it.
   */
  collect(kind) {
    if (kind === 'ammo') return (this.ctx.peek('weapons')?.resupply?.(60) ?? 0) > 0;
    if (kind === 'armor') return this.perks.addArmor(45) > 0;
    this._queue++;
    this._offerNext();
    return true;
  }

  update(dt) {
    this._t += dt;

    // Drain queued level-ups on a timer rather than all at once. Nothing here
    // blocks, so this runs while the player keeps fighting.
    if (this._rollCd > 0) this._rollCd -= dt;
    if (this._rollCd <= 0 && this._queue > 0 && !this.ctx.config.hardcore) this._offerNext();

    if (!this.chests.length) return;
    const player = this.ctx.peek('player');
    const pos = player?.position;
    const reach = this.perks.pickupRadius;

    for (let i = this.chests.length - 1; i >= 0; i--) {
      const c = this.chests[i];

      // Expire. A drop from six waves ago is not a reward any more, it is a
      // scene node being animated forever for nothing.
      if (this._t - (c.userData.born ?? 0) > PICKUP_TTL) {
        c.parent?.remove(c);
        this.chests.splice(i, 1);
        continue;
      }

      // Bob and spin — the entire reason it reads as a pickup and not as scenery.
      c.position.y = c.userData.baseY + Math.sin(this._t * 2.2) * 0.09;
      c.rotation.y += dt * 1.1;
      if (!pos) continue;
      this._v.set(c.position.x - pos.x, 0, c.position.z - pos.z);
      if (this._v.lengthSq() > reach * reach) continue;
      if (!this.collect(c.userData.kind ?? 'chest')) continue;
      c.parent?.remove(c);
      this.chests.splice(i, 1);
    }
  }

  /**
   * Show the next pending upgrade, if any and if the card is free.
   *
   * The card is modal but kills are not: a grenade that levels you twice, or a
   * chest grabbed while a level-up is already on screen, would otherwise have
   * the second offer overwrite the first and quietly lose an upgrade. Draining
   * a queue one card at a time is the whole fix.
   */
  _offerNext() {
    if (this._rollCd > 0 || this._queue <= 0) return;
    const ids = this.perks.roll(this.ctx.rng);
    if (!ids.length) {
      this._queue = 0; // everything is maxed; stop pretending there is a reward
      return;
    }
    this._queue--;

    /**
     * GRANTED FIRST, SHOWN SECOND — and never asked about.
     *
     * The upgrade is applied immediately, before anything is drawn, so the reel
     * under the compass is a readout of something that has already happened
     * rather than a prompt the game is waiting on. That ordering is what lets
     * the whole thing be non-blocking: there is no state where play is paused
     * pending a decision, because there is no decision.
     */
    const id = ids[0];
    this.perks.take(id);

    const ui = this.ctx.peek('ui');
    ui?.levelRoll?.show?.(
      `LEVEL ${this.perks.plevel}`,
      PERKS[id].label,
      PERKS[id].desc(this.perks.level[id]),
      ids.map((x) => PERKS[x].label)
    );

    /**
     * Space consecutive levels out instead of drawing them on one frame. A
     * grenade can level you twice at once, and two rolls starting together
     * would show one of them for a single frame.
     */
    this._rollCd = ROLL_SPACING;
  }

  /** Kept for callers that just want "give me an upgrade now". */
  offer() {
    this._queue++;
    this._offerNext();
  }

  /**
   * Called by core/prewarm.js. Builds the shared pickup geometry and materials
   * at boot so the first drop of a run is not the frame that compiles them.
   */
  async prewarmMaterials() {
    prewarmPickups();
    const render = this.ctx.peek('render');
    const renderer = render?.renderer;
    if (!renderer) return { ok: false, reason: 'no renderer' };

    const before = renderer.info.programs?.length ?? 0;
    const scratch = new THREE.Scene();
    scratch.fog = this.ctx.scene.fog;
    scratch.environment = this.ctx.scene.environment;
    scratch.environmentIntensity = this.ctx.scene.environmentIntensity;
    if (scratch.environmentRotation && this.ctx.scene.environmentRotation) {
      scratch.environmentRotation.copy(this.ctx.scene.environmentRotation);
    }
    // Match the light permutation of the real world draw. Passing the gameplay
    // scene as compileAsync's `targetScene` while ALSO borrowing its lights
    // double-counted them and warmed a program gameplay never used.
    this.ctx.peek('world')?._stabiliseLightCount?.(this.ctx);
    this.ctx.camera.updateMatrixWorld(true);
    // _syncSun reads RenderSystem's collected directional-light list. At boot
    // that list is still empty, so calling it directly leaves the fallback sun
    // visible alongside sky-sun + sky-moon and warms NUM_DIR_LIGHTS=3. The first
    // gameplay frame collects first, hides the fallback, and draws with 2 — a
    // distinct program that ANGLE then translated on the first pickup (414 ms on
    // RTX 4080). Mirror the real render ordering before borrowing the light set.
    render?._collect?.(this.ctx.scene);
    render?._syncSun?.(this.ctx.camera);
    const camPos = new THREE.Vector3();
    this.ctx.camera.getWorldPosition(camPos);
    render?._cullLights?.(camPos);
    // The actual draw that forces ANGLE translation needs the real light set.
    // Borrow references without re-parenting them; gameplay stays untouched.
    this.ctx.scene.traverse((object) => {
      if (!object.isLight || !object.visible) return;
      for (let p = object.parent; p && p !== this.ctx.scene; p = p.parent) {
        if (!p.visible) return;
      }
      scratch.children.push(object);
    });
    for (const kind of Object.keys(PICKUPS)) {
      const mesh = makePickup(kind);
      mesh.frustumCulled = false;
      scratch.children.push(mesh);
      render?.patcher?.patch?.(mesh.material);
    }

    const prevRt = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace?.() ?? 0;
    const prevMip = renderer.getActiveMipmapLevel?.() ?? 0;
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    try {
      renderer.setRenderTarget(rt);
      try {
        await renderer.compileAsync(scratch, this.ctx.camera);
      } catch {
        renderer.compile(scratch, this.ctx.camera);
      }
      // Creating the program is not enough on ANGLE/D3D: translation can stay
      // pending until GetProgramiv on the first real draw. Draw the borrowed
      // meshes into a 1 px target now so the first mid-wave drop is cheap.
      renderer.render(scratch, this.ctx.camera);
    } catch (err) {
      return { ok: false, reason: String(err?.message ?? err) };
    } finally {
      renderer.setRenderTarget(prevRt, prevFace, prevMip);
      scratch.children.length = 0;
      rt.dispose();
    }
    return {
      ok: true,
      materials: Object.keys(PICKUPS).length,
      compiled: (renderer.info.programs?.length ?? 0) - before,
    };
  }

  dispose() {
    this._offWave?.();
    this._offDeath?.();
    this._offImpact?.();
    this._offKill?.();
    for (const c of this.chests) c.parent?.remove(c);
    this.chests.length = 0;
    // Engines are replaced serially by the front menu, so no live scene still
    // borrows these module-level resources when this system is disposed.
    disposePickupResources();
    if (this.ctx) this.ctx.perks = null;
  }
}
