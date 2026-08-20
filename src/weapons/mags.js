/**
 * Swappable magazines.
 *
 * Third instance of the pattern in optics.js and muzzles.js — build every
 * variant at load, switch by visibility, because a weapon rebuild costs ~2.7 s.
 *
 * A magazine is the one attachment that is also a MOVING PART: it drops on an
 * empty reload and the clip animates it. So the variants are not parented to
 * the weapon body like an optic — they hang off a seat group that the reload
 * animation drives, and only one of them is visible at a time. See
 * `Viewmodel.addWeapon`, which now owns that seat.
 *
 * The stats are the trade, and they are the real ones: a 20-round stick is
 * shorter, lighter and faster onto the shoulder; a 45 costs you draw and reload
 * speed for fourteen extra rounds you do not have to stop for.
 */

import { Assembly } from './geometry.js';
import { buildMagazine } from './parts.js';

/**
 * Hardcore magazine-level ammo. Ammunition is a pouch of magazines, not a pool
 * of loose rounds: a reload swaps the whole thing and the partial you just
 * pulled goes to the BACK of the pouch with whatever was left in it, so it
 * comes round again later and you find out how short it is by running dry.
 *
 * Mutates `pouch` and returns the rounds now in the gun.
 * @param {number[]} pouch    magazines on the chest, front first
 * @param {number} inMag      rounds in the magazine coming out
 * @param {number} magSize    capacity of the current magazine well
 */
export function swapMagazine(pouch, inMag, magSize) {
  if (!pouch.length) return inMag;
  const fresh = Math.min(pouch.shift(), magSize);
  const keep = Math.min(inMag, magSize);
  if (keep > 0) pouch.push(keep);
  return fresh;
}

/** ponytail: one check, not a suite — the pouch is the only new state here. */
export function magSelfTest() {
  const p = [30, 30, 30];
  let mag = swapMagazine(p, 7, 30); // reload with 7 left
  console.assert(mag === 30, 'fresh mag is full');
  console.assert(p.join() === '30,30,7', 'the partial went to the back');
  mag = swapMagazine(p, 30, 30); // a pointless reload loses nothing
  console.assert(mag === 30 && p.join() === '30,7,30', 'no rounds invented or lost');
  console.assert(swapMagazine([], 4, 30) === 4, 'empty pouch keeps what is in the gun');
  console.assert(swapMagazine([45], 0, 30) === 30, 'a 45 in a 30 well fills the well');
  return true;
}

/** Menu order: shortest to longest. */
export const MAG_ORDER = ['short', 'std', 'ext'];

/**
 * @param {object} base    the weapon's default magazine geometry options
 *                         (w/d/curve/segs/witness/poly), taken from the model so
 *                         each weapon's mags stay in its own calibre and profile
 * @param {object} [rounds] capacities per slot. Defaults are the carbine's; the
 *                         SMG carries more because 9x19 is a smaller cartridge
 *                         in the same envelope.
 */
export function buildMagSet(base, rounds = { short: 20, std: 30, ext: 45 }) {
  const out = {};

  const mag = (id, spec, geo) => {
    const asm = new Assembly(`mag-${id}`);
    buildMagazine(asm, null, { ...base, ...geo });
    out[id] = { asm, ...spec };
  };

  /**
   * 20-round. The original AR magazine, and it sits flush enough to go prone
   * behind. Faster on every count, and you stop to reload half again as often.
   */
  mag(
    'short',
    {
      label: `${rounds.short}-round`,
      rounds: rounds.short,
      reload: 0.92,
      ads: 0.95,
      draw: 0.94,
    },
    { len: base.len * 0.7, curve: base.curve * 0.62, witness: 3 }
  );

  // 30-round: the issue magazine, and the one every pose and animation in the
  // game was authored against. Nothing scales.
  mag(
    'std',
    {
      label: `${rounds.std}-round`,
      rounds: rounds.std,
      reload: 1,
      ads: 1,
      draw: 1,
    },
    {}
  );

  /**
   * 45-round extended. Long enough to be visible in the sight picture from
   * below and long enough to notice on the reload, which is the point — the
   * cost has to be felt or the choice is not a choice.
   */
  mag(
    'ext',
    {
      label: `${rounds.ext}-round`,
      rounds: rounds.ext,
      reload: 1.16,
      ads: 1.07,
      draw: 1.09,
    },
    { len: base.len * 1.42, curve: base.curve * 1.5, witness: 6, segs: 10 }
  );

  return out;
}
