/**
 * Weapon skins.
 *
 * A skin is an albedo TINT, not a texture set. Everything in this game is
 * procedurally baked at load, and a second set of maps per skin would multiply
 * the texture bake — already the largest single item in boot time — by the
 * number of skins. A multiplier over the existing albedo gets a Cerakote finish
 * for the cost of three floats, keeps every wear, grime and AO mask exactly
 * where it was, and adds nothing to load.
 *
 * The tints are multiplicative over a base that is already near-black on most
 * parts, so anything that reads as "colour" has to be well above 1 to show at
 * all. That is why these numbers look extreme next to the paint names.
 */

/**
 * Material classes that are NOT painted.
 *
 * Glass, lens coatings and the dark bore cavity are optical rather than
 * finished, and tinting them puts the skin colour into the sight picture — an
 * FDE rifle should not look through tan glass.
 */
export const UNPAINTED = new Set([
  'cavity',
  'glass',
  'lens_ring',
  'lens_vig',
  'optic_tube',
  // The hands are not part of the weapon.
  'glove',
  'glove_pad',
  'glove_seam',
  'sleeve',
]);

/** Menu order. */
export const SKIN_ORDER = ['black', 'fde', 'od', 'urban', 'bronze'];

export const SKINS = {
  /** Issue black. The identity tint — this is what everything was authored as. */
  black: { label: 'Black', tint: [1, 1, 1] },

  /** Flat Dark Earth: the standard modern furniture colour. */
  fde: { label: 'FDE', tint: [3.2, 2.45, 1.55] },

  /** OD green, cooler and darker than FDE so the two never read as one skin. */
  od: { label: 'OD Green', tint: [1.9, 2.35, 1.35] },

  /** Urban grey — a wolf-grey Cerakote. Neutral, so only the value moves. */
  urban: { label: 'Urban', tint: [2.5, 2.55, 2.6] },

  /** Burnt bronze. Warm and dark; the one that still reads at night. */
  bronze: { label: 'Bronze', tint: [2.7, 1.75, 0.95] },
};
