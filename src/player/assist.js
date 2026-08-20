import * as THREE from 'three';

/**
 * AIM ASSIST AND AUTO-FIRE — the thing that makes this playable with a thumb.
 *
 * A touch player cannot track. There is no wrist, no surface, no 400 dpi; there
 * is one thumb dragging on glass with roughly a tenth of the precision a mouse
 * gives. Ship the desktop aim requirements to that player and the game is not
 * hard, it is broken — you lose fights you never had the input bandwidth to
 * win. So the assist here is deliberately POTENT, and unapologetically so: this
 * is the arcade half of the split (see DIRECTION.md), and the fantasy it sells
 * is being competent, not being tested.
 *
 * Three layers, weakest to strongest:
 *
 *   magnetism   a rotational pull toward the target, strongest when the
 *               reticle is already close. It never moves the view on its own —
 *               it scales with how much the player is already turning, so a
 *               resting thumb keeps a resting camera and the assist can never
 *               drag the aim off something the player deliberately chose.
 *   slowdown    the look delta is damped inside the sticky cone, so the reticle
 *               resists sliding off a target it has found.
 *   auto-fire   inside a tight cone with line of sight, the trigger is held for
 *               the player.
 *
 * All of it is gated on `enabled`, which is set from the touch detection, so a
 * desktop player is never touched by any of it.
 */

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _eye = new THREE.Vector3();

/** Angles in radians. */
const DEG = Math.PI / 180;

export const ASSIST = {
  /** Cone within which a target is considered at all. */
  acquireCone: 26 * DEG,
  /** Inside this, the pull is at full strength and the look damping applies. */
  stickyCone: 11 * DEG,
  /** Inside this, with line of sight, the gun fires itself. */
  autoFireCone: 7.5 * DEG,
  /** Maximum engagement range for any of it. */
  maxRange: 90,
  /**
   * Peak angular pull, rad/s, scaled by proximity to the target and by how fast
   * the player is already turning. 5.2 closes a 10 deg gap in about 40 ms of
   * held drag, which reads as the reticle "snapping on" without ever taking the
   * camera somewhere the thumb was not already going.
   */
  pull: 5.2,
  /** Look delta multiplier inside the sticky cone. Lower = harder to slide off. */
  slowdown: 0.55,
  /** Aim at the chest, not the origin: feet-height targets read as misses. */
  aimHeight: 1.25,
};

export class AimAssist {
  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = false;
    /** Set true when a target sits inside `autoFireCone` with clear line of sight. */
    this.autoFire = false;
    /** The agent currently being helped toward, for HUD/debug. */
    this.target = null;
    this._angle = Infinity;
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera   already at this frame's transform
   * @returns {{yaw:number, pitch:number, slow:number}} rotational nudge and the
   *          look-damping factor to apply to this frame's input delta
   */
  update(dt, camera) {
    this.target = null;
    this.autoFire = false;
    this._angle = Infinity;
    const out = { yaw: 0, pitch: 0, slow: 1 };
    if (!this.enabled) return out;

    const ai = this.ctx.peek?.('ai');
    const agents = ai?.agents;
    if (!agents || !agents.length) return out;

    camera.getWorldPosition(_eye);
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);

    let best = null;
    let bestAngle = ASSIST.acquireCone;
    let bestDist = 0;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (!a.alive) continue;
      _v.copy(a.position);
      _v.y += ASSIST.aimHeight;
      _v.sub(_eye);
      const dist = _v.length();
      if (dist < 0.6 || dist > ASSIST.maxRange) continue;
      _v.multiplyScalar(1 / dist);
      const dot = _v.dot(_fwd);
      if (dot <= 0) continue;
      const ang = Math.acos(Math.min(1, dot));
      /**
       * Nearest by ANGLE, not by distance. Distance picks whoever is closest to
       * your feet, which on a map with a corridor is routinely someone behind
       * you that you are not looking at; angle picks whoever you are pointing
       * nearest to, which is the one you meant.
       */
      if (ang >= bestAngle) continue;
      // Line of sight last: it is the expensive test, so only for a candidate
      // that already won on angle.
      const phys = this.ctx.peek?.('physics');
      if (phys?.lineOfSight) {
        _v.copy(a.position);
        _v.y += ASSIST.aimHeight;
        if (!phys.lineOfSight(_eye, _v, phys.MASK.SIGHT)) continue;
      }
      best = a;
      bestAngle = ang;
      bestDist = dist;
    }
    if (!best) return out;

    this.target = best;
    this._angle = bestAngle;

    // Direction to the target, in yaw/pitch terms.
    _v.copy(best.position);
    _v.y += ASSIST.aimHeight;
    _v.sub(_eye);
    const tYaw = Math.atan2(-_v.x, -_v.z);
    const tPitch = Math.asin(Math.max(-1, Math.min(1, _v.y / _v.length())));
    const cYaw = Math.atan2(-_fwd.x, -_fwd.z);
    const cPitch = Math.asin(Math.max(-1, Math.min(1, _fwd.y)));

    let dYaw = tYaw - cYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = tPitch - cPitch;

    /**
     * Strength ramps from 0 at the edge of the acquire cone to 1 inside the
     * sticky cone, so a target drifting into view pulls gently and one you are
     * nearly on pulls hard. A hard edge here is felt as a tug.
     */
    const t = 1 - Math.min(1, Math.max(0, (bestAngle - ASSIST.stickyCone) /
      (ASSIST.acquireCone - ASSIST.stickyCone)));
    const k = Math.min(1, ASSIST.pull * t * dt);
    out.yaw = dYaw * k;
    out.pitch = dPitch * k;
    if (bestAngle < ASSIST.stickyCone) out.slow = ASSIST.slowdown;

    // Auto-fire: tight cone, and the LOS test above already passed.
    if (bestAngle < ASSIST.autoFireCone && bestDist <= ASSIST.maxRange) {
      this.autoFire = true;
    }
    return out;
  }
}
