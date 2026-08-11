/**
 * Swappable stocks.
 *
 * `addCarbineStock` is parameterised by where the butt sits, which is exactly
 * the variable that matters: length of pull. A collapsed stock is faster to
 * shoulder and shorter to swing through a doorway; an extended one gives the
 * shoulder a longer lever against the recoil impulse. That is the whole trade
 * and it needs no new geometry, just three positions of the same part.
 *
 * `recoil` multiplies the deterministic climb pattern rather than the
 * viewmodel kick, because the climb is the part a player fights.
 */

import { Assembly } from './geometry.js';
import { addCarbineStock } from './parts.js';

/** Menu order: shortest to longest. */
export const STOCK_ORDER = ['collapsed', 'standard', 'extended'];

/**
 * @param {object} base  the model's stock options — bore, zFront, y, and the
 *                       zRear the weapon's pose was authored against
 */
export function buildStockSet(base) {
  const out = {};

  const stock = (id, zRear, spec) => {
    const asm = new Assembly(`stock-${id}`);
    addCarbineStock(asm, 'alu', 'polymer', 'rubber', { ...base, zRear });
    out[id] = { asm, zRear, ...spec };
  };

  /**
   * Fully collapsed. 47 mm shorter, which you feel getting onto the sights and
   * clearing corners, and pay for in climb — there is less stock in the pocket
   * to resist it.
   */
  stock('collapsed', base.zRear - 0.047, {
    label: 'Collapsed',
    recoil: 1.12,
    ads: 0.93,
    sway: 1.08,
  });

  // The length every pose, animation and recoil number in the game was
  // authored against. Nothing scales.
  stock('standard', base.zRear, {
    label: 'Standard',
    recoil: 1,
    ads: 1,
    sway: 1,
  });

  /**
   * Fully extended. A longer length of pull is slower onto the target and
   * slower to transition, and it is the steadiest thing you can put on the
   * back of the rifle.
   */
  stock('extended', base.zRear + 0.047, {
    label: 'Extended',
    recoil: 0.88,
    ads: 1.08,
    sway: 0.9,
  });

  return out;
}
