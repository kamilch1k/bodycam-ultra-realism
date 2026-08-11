/**
 * Swappable muzzle devices.
 *
 * Same design as optics.js — every device is its own {@link Assembly}, built at
 * load and switched by visibility, because a weapon rebuild costs ~2.7 s.
 *
 * Unlike an optic, a muzzle device changes WHERE THE MUZZLE IS: a 165 mm can
 * puts the crown 103 mm further downrange than a 62 mm brake. The flash, the
 * smoke, the tracer origin and the shell-port geometry all hang off that node,
 * so `Viewmodel.setMuzzle` moves it rather than leaving the flash floating
 * inside the tube.
 *
 * `loudness` is the one that matters for play. `ai` hears every gunshot at a
 * flat 90 m today, which means suppressed and unsuppressed fire alert exactly
 * the same people — the device would be pure decoration. Carrying the radius on
 * the shot event lets a can be worth fitting: 26 m is inside one building
 * rather than across the map, so a suppressed weapon lets you clear a room
 * without the rest of the garrison converging on it.
 */

import { Assembly } from './geometry.js';
import { addMuzzleDevice } from './parts.js';

/** Menu order: bare, then progressively more device. */
export const MUZZLE_ORDER = ['bare', 'a2', 'brake', 'comp', 'can'];

/**
 * @param {object} o
 * @param {number} o.zBarrelEnd  barrel crown before any device
 * @param {number} o.rBarrel
 * @param {number} o.bore        bore axis height
 * @param {string} [o.mat]       steel material key
 */
export function buildMuzzleSet(o) {
  const { zBarrelEnd, rBarrel, bore } = o;
  const mat = o.mat ?? 'steel_soot';
  const out = {};

  /**
   * A bare threaded muzzle. Nothing is built — the barrel already ends here —
   * so this is the lightest, loudest, flashiest option and the crown is the
   * barrel's own.
   */
  out.bare = {
    asm: null,
    crownZ: zBarrelEnd,
    label: 'Bare',
    loudness: 105,
    flashScale: 1.25,
    recoil: 1.06,
    spread: 1.0,
  };

  const device = (id, kind, spec) => {
    const asm = new Assembly(`muzzle-${id}`);
    const m = addMuzzleDevice(asm, mat, 'cavity', kind, zBarrelEnd, rBarrel, bore);
    out[id] = { asm, crownZ: m.crownZ, ...spec };
  };

  // A2 birdcage: the issue device. Cheap, quiet-ish, no real recoil benefit —
  // it exists to stop dust signature, not to tame the gun.
  device('a2', 'a2', {
    label: 'A2 Flash Hider',
    loudness: 95,
    flashScale: 0.62,
    recoil: 1.0,
    spread: 1.0,
  });

  // Three-port brake: the loudest thing you can screw onto a rifle, and the
  // flattest-shooting. That trade is the whole point of the part.
  device('brake', 'brake', {
    label: 'Muzzle Brake',
    loudness: 120,
    flashScale: 1.15,
    recoil: 0.82,
    spread: 1.0,
  });

  // Compensator: vents up, so it fights climb rather than rearward recoil.
  device('comp', 'comp', {
    label: 'Compensator',
    loudness: 108,
    flashScale: 0.95,
    recoil: 0.88,
    spread: 0.94,
  });

  /**
   * Suppressor. 165 mm and 400 g on the end of a 14.5" barrel, so it is slower
   * to bring onto target and it is not free — but it is the only device that
   * changes who knows you are there.
   */
  device('can', 'can', {
    label: 'Suppressor',
    loudness: 26,
    flashScale: 0.18,
    recoil: 0.9,
    spread: 0.96,
    adsScale: 1.16,
  });

  return out;
}
