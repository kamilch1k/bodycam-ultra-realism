import * as THREE from 'three';

/**
 * Death camera.
 *
 * The camera stops being a camera and becomes a THING: it is handed to the
 * rigid-body world as a small dense box with the momentum you had, plus the
 * shove from whatever killed you, and from then on the frame is wherever that
 * box ended up. It hits the floor, it tumbles, it comes to rest against a wall
 * at whatever angle it likes, and it keeps recording — which is the one death
 * a body camera actually has.
 *
 * Deliberately NOT a ragdoll. The engine has PBD ragdolls (see physics/ragdoll)
 * and the AI use them, but a ragdoll needs a skeleton to hang off and the player
 * has no body mesh — you would be simulating fifteen joints to read one of them.
 * A single box with the right mass and friction gives the same footage.
 *
 * ponytail: one box, not a skeleton. Give the player a first-person body and
 * this becomes a head-bone follow instead.
 */
export class DeathCam {
  constructor(ctx) {
    this.ctx = ctx;
    this.body = null;
    this.t = 0;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  get active() {
    return !!this.body;
  }

  /**
   * @param {THREE.Camera} camera  where the eye was at the moment of death
   * @param {THREE.Vector3|null} from  world position of whatever killed you
   * @param {THREE.Vector3|null} velocity  what you were doing at the time
   */
  start(camera, from, velocity) {
    const phys = this.ctx.peek('physics');
    if (!phys?.addRigidBody || this.body) return false;
    this.t = 0;

    // Falls from the eye, not from the feet: a camera on a chest starts its
    // fall about where it was worn.
    const p = camera.position;
    const v = this._v.set(0, -0.4, 0);
    if (velocity) v.addScaledVector(velocity, 0.55);
    if (from) {
      // Pushed AWAY from the shot, and never upward: being shot does not
      // launch you, it takes your legs out.
      const dx = p.x - from.x;
      const dz = p.z - from.z;
      const d = Math.hypot(dx, dz) || 1;
      v.x += (dx / d) * 1.15;
      v.z += (dz / d) * 1.15;
    }

    this.body = phys.addRigidBody({
      shape: 'box',
      halfExtents: { x: 0.11, y: 0.11, z: 0.11 },
      radius: 0.11,
      // Heavy and dead: a light box skitters like a dropped can, and a bouncy
      // one turns a death into a cartoon.
      mass: 5.5,
      restitution: 0.05,
      friction: 0.85,
      linearDamping: 0.05,
      angularDamping: 0.72,
      ccd: true,
      surfaceType: 'concrete',
    });
    this.body.position.copy(p);
    this.body.prevPosition.copy(p);
    this.body.quaternion.copy(camera.quaternion);
    this.body.prevQuaternion.copy(camera.quaternion);
    this.body.linearVelocity.copy(v);
    // Tumble mostly about the fall axis, so it goes over sideways rather than
    // pirouetting. Deterministic per death via the engine rng.
    const rng = this.ctx.rng;
    const r = () => (rng?.signed?.() ?? Math.random() * 2 - 1);
    this.body.angularVelocity.set(r() * 1.6, r() * 0.9, -2.2 - Math.abs(r()) * 1.4);
    return true;
  }

  update(dt, camera) {
    const b = this.body;
    if (!b) return;
    this.t += dt;
    camera.position.copy(b.position);
    /**
     * The camera does NOT snap to the box's orientation on the first frame —
     * the impulse that killed you is a hard rotation and cutting to it reads as
     * a glitch rather than as a fall. It catches up over about a fifth of a
     * second and is welded to it after that.
     */
    camera.quaternion.slerp(this._q.copy(b.quaternion), Math.min(1, dt * 5.5));
  }

  stop() {
    if (this.body) this.ctx.peek('physics')?.removeRigidBody?.(this.body);
    this.body = null;
    this.t = 0;
  }
}
