/**
 * Weapon skins.
 *
 * A skin is a REPAINT of the albedo, not a texture set and not a tint.
 *
 * The first attempt multiplied `material.color`, and it was wrong in a way that
 * only showed up in-game: the base albedo is near black (0.03-0.05) and the wear
 * masks paint bright metal on every chamfer, so a 3.2x multiplier left the body
 * black and blew the speckles past 1.0 into saturated red and green. The gun did
 * not turn tan, it grew confetti. Multiply is simply the wrong operator when the
 * thing you want to change is nearly zero.
 *
 * The finish is applied in the shader instead, over the sampled albedo:
 *
 *   lum  = luminance(albedo)
 *   skin = paint * (FLOOR + GAIN * lum)
 *   out  = mix(albedo, skin, amount)
 *
 * The paint supplies the colour and the map supplies all the variation, so wear,
 * grime, AO and moulded texture come through as light and shade in the new
 * colour. That is also what a real Cerakote job looks like: the finish is opaque
 * and the surface underneath still reads. Everything in this game is
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

/**
 * `paint` is the finish's own albedo. `amount` is how completely it covers.
 *
 * NOT a multiplier — see the note at the top of the file for why that failed.
 * The shader rebuilds the albedo as `paint * (floor + gain * luminance)`, so the
 * finish supplies the colour and the original map supplies every variation:
 * wear, grime, AO and the moulded texture all survive as light and shade in the
 * new colour instead of being scaled into confetti.
 */
export const SKINS = {
  /** Issue black — the authored finish. amount 0 leaves the albedo untouched. */
  black: { label: 'Black', paint: [1, 1, 1], amount: 0 },

  /** Flat Dark Earth. Real FDE furniture sits near 0.34 albedo. */
  fde: { label: 'FDE', paint: [0.44, 0.34, 0.21], amount: 0.92 },

  /** OD green: darker and much cooler, so it never reads as FDE in shade. */
  od: { label: 'OD Green', paint: [0.22, 0.26, 0.15], amount: 0.92 },

  /** Wolf grey. Neutral — only the value moves, which is the point of it. */
  urban: { label: 'Urban', paint: [0.36, 0.37, 0.38], amount: 0.9 },

  /** Burnt bronze. Warm and dark; the one that still reads at night. */
  bronze: { label: 'Bronze', paint: [0.3, 0.19, 0.1], amount: 0.94 },

  /* ---------------------------------------------------------------- loud --
   * Everything above is a real firearm finish, and real finishes are dark:
   * the brightest of them sits near 0.44 albedo because a gun you can see from
   * a mile away is a bad gun. These are the opposite on purpose — arcade
   * finishes for an arcade game, in the 0.75-0.95 range where they read as
   * SATURATED rather than merely light.
   *
   * `amount: 1` because a partial blend toward a bright paint over a near-black
   * receiver lands in the muddy middle instead of on the colour asked for.
   * -------------------------------------------------------------------- */
  hotpink: { label: 'Hot Pink', paint: [0.95, 0.18, 0.62], amount: 1 },
  cyan: { label: 'Electric Blue', paint: [0.13, 0.62, 0.98], amount: 1 },
  orange: { label: 'Sunset', paint: [1.0, 0.45, 0.08], amount: 1 },
  arctic: { label: 'Arctic', paint: [0.93, 0.95, 0.97], amount: 1 },
  acid: { label: 'Acid', paint: [0.68, 0.95, 0.13], amount: 1 },
  violet: { label: 'Violet', paint: [0.62, 0.28, 0.98], amount: 1 },
};

/** Luminance floor and gain — see the shader hook in viewmodel.setSkin. */
export const PAINT_FLOOR = 0.55;
export const PAINT_GAIN = 2.6;
