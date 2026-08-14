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

export class Perks {
  constructor() {
    this.level = {};
    this.reset();
  }

  reset() {
    for (const id of Object.keys(PERKS)) this.level[id] = 0;
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
 *  CHESTS
 * ====================================================================== */

/** How far a chest floats above the ground point it was placed on. */
const CHEST_Y = 0.55;

/**
 * A supply chest. Deliberately a single emissive box rather than a model: it has
 * to be readable across a 60 m map at a glance, and the thing that makes it
 * readable is that it GLOWS and BOBS, not that it has hinges.
 */
function makeChest() {
  const g = new THREE.BoxGeometry(0.7, 0.55, 0.5);
  const m = new THREE.MeshStandardMaterial({
    color: 0xffc23a,
    emissive: 0xff8c1a,
    emissiveIntensity: 1.5,
    roughness: 0.45,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'perk-chest';
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

    // A chest per wave, dropped where the wave died rather than on a schedule:
    // the reward should be where the fight was.
    this._offWave = ctx.events.on('wave:cleared', (e) => this.spawnChest(e?.position));
    this._offDeath = ctx.events.on('player:respawn', () => this.reset());

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
    for (const c of this.chests) c.parent?.remove(c);
    this.chests.length = 0;
  }

  /** @param {THREE.Vector3} [near] where the wave died; falls back to a spawn point. */
  spawnChest(near) {
    const ctx = this.ctx;
    let p = near;
    if (!p) {
      const spawns = ctx.peek('world')?.spawnPoints ?? [];
      p = spawns.length ? spawns[(Math.random() * spawns.length) | 0].position : null;
    }
    if (!p) return;
    const mesh = makeChest();
    mesh.position.set(p.x, p.y + CHEST_Y, p.z);
    mesh.userData.baseY = mesh.position.y;
    ctx.scene.add(mesh);
    this.chests.push(mesh);
  }

  update(dt) {
    this._t += dt;
    if (!this.chests.length) return;
    const player = this.ctx.peek('player');
    const pos = player?.position;
    const reach = this.perks.pickupRadius;

    for (let i = this.chests.length - 1; i >= 0; i--) {
      const c = this.chests[i];
      // Bob and spin — the entire reason it reads as a pickup and not as scenery.
      c.position.y = c.userData.baseY + Math.sin(this._t * 2.2) * 0.09;
      c.rotation.y += dt * 1.1;
      if (!pos) continue;
      this._v.set(c.position.x - pos.x, 0, c.position.z - pos.z);
      if (this._v.lengthSq() > reach * reach) continue;
      c.parent?.remove(c);
      this.chests.splice(i, 1);
      this.offer();
    }
  }

  /** Put three cards up and freeze the fight until one is taken. */
  offer() {
    const ui = this.ctx.peek('ui');
    const ids = this.perks.roll(this.ctx.rng);
    if (!ids.length) return;
    if (!ui?.perkCard) {
      // No UI (capture harness, headless probe): take the first rather than
      // dropping the reward on the floor.
      this.perks.take(ids[0]);
      return;
    }
    ui.perkCard.show(
      ids.map((id) => ({ id, label: PERKS[id].label, desc: PERKS[id].desc(this.perks.level[id] + 1) })),
      (id) => this.perks.take(id)
    );
  }

  dispose() {
    this._offWave?.();
    this._offDeath?.();
    this._offImpact?.();
    for (const c of this.chests) c.parent?.remove(c);
    this.chests.length = 0;
    if (this.ctx) this.ctx.perks = null;
  }
}
