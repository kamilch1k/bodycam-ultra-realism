/**
 * Swappable optics.
 *
 * Every optic is its own {@link Assembly}, built once at load and toggled by
 * VISIBILITY at runtime. That is the whole design decision, and it is forced by
 * the numbers: a full weapon build costs ~2.7 s (see the `[weapons]` boot line),
 * which is not something you can do when the player clicks a sight in a menu.
 * Five optics are twenty small parts on top of a receiver that never changes,
 * so building them all up front costs a fraction of one rebuild and switching
 * afterwards costs a boolean.
 *
 * MAGNIFICATION IS NOT PICTURE-IN-PICTURE. There is no second render target and
 * no scope camera. The world camera's ADS field of view is divided by the
 * optic's magnification and the VIEWMODEL camera is left alone — which is what
 * a telescopic sight physically does. You look through a tube whose apparent
 * size never changes, and the scene inside it is magnified. A PiP pass would
 * cost a full extra scene render for a result that, at these magnifications,
 * looks the same.
 *
 * The 1-6x is one optic with a `magRange`; the mouse wheel drives it while the
 * sights are up. See `Weapons.adsMagnification`.
 */

import { Assembly } from './geometry.js';
import { buildOptic, buildMiniReflex, addRail } from './parts.js';

/**
 * Menu order, cheapest sight first. `irons` is not an object at all — it is the
 * absence of one, and it aims with the weapon's own back-up iron sights.
 */
export const OPTIC_ORDER = ['irons', 'reddot', 'okp7', 'acog', 'vari'];

/**
 * Build every optic for a flat-top rail.
 *
 * @param {object} o
 * @param {number} o.railTop  rail deck height in weapon space
 * @param {number} o.opticY   optical axis height for a standard tube mount
 * @param {number} o.z        mount centre along the weapon
 * @param {number} [o.compact] shrink for an SMG-length receiver
 * @returns {Object<string, {asm: Assembly|null, glass: object|null, mag: number,
 *   magRange: [number, number]|null, label: string, adsScale: number,
 *   reticle: string}>}
 */
export function buildOpticSet(o) {
  const railTop = o.railTop;
  /**
   * The optical axis, not the rail deck. 38 mm over the deck is a standard
   * absolute-co-witness mount height and it is the number the whole ADS
   * framing was measured against — put the glass on the rail itself and the
   * sight picture sits below the eye axis.
   */
  const opticY = o.opticY ?? railTop + 0.0384;
  const z = o.z ?? 0;
  const k = o.compact ? 0.88 : 1;
  const out = {};

  /**
   * IRON SIGHTS. No assembly, no glass, no reticle geometry — the weapon's own
   * BUIS is already modelled and always present. Fastest to raise, and the only
   * option with nothing between the eye and the target.
   */
  out.irons = {
    asm: null,
    glass: null,
    mag: 1,
    magRange: null,
    label: 'Iron Sights',
    adsScale: 0.88,
    reticle: 'none',
  };

  /**
   * RED DOT — a 31 mm tube. This is the sight the rest of the game was tuned
   * against, so its numbers are the ones already measured in buildOptic: 52 mm
   * of tube, a belled objective, and an ocular aperture wide enough that the
   * ADS frame is 69% sight picture rather than a length of drainpipe.
   */
  {
    const asm = new Assembly('optic-reddot');
    const glass = buildOptic(asm, {
      rTube: 0.0155 * k,
      len: 0.052 * k,
      hood: 0.007,
      y: opticY,
      z,
      railTop,
      matBody: 'alu_fine',
      matSteel: 'steel',
    });
    out.reddot = {
      asm,
      glass,
      mag: 1,
      magRange: null,
      label: 'Red Dot',
      adsScale: 1,
      reticle: 'dot',
    };
  }

  /**
   * OKP-7 — the Russian open-frame reflex. Its whole point is that it is NOT a
   * tube: a canted glass plate in an open bracket offset to the LEFT of the
   * bore, because it was designed to clear an AK's rear sight block. That
   * offset is the recognisable thing about it, so it is kept even though this
   * receiver has a flat-top rail and does not need it.
   */
  {
    /**
     * A CIRCULAR sight, not an open reflex frame.
     *
     * The OKP-7 is a tube: you look through a round window, not over a flat
     * plate. It was built with buildMiniReflex, which produces the rectangular
     * open frame of a mini red dot, and that is simply the wrong sight. A short
     * fat tube — 24 mm glass in a 40 mm body — is the read, and it sits lower
     * and shorter than the reddot so the two are not the same object twice.
     */
    const asm = new Assembly('optic-okp7');
    const glass = buildOptic(asm, {
      rTube: 0.0142 * k,
      len: 0.04 * k,
      y: opticY - 0.002,
      z: z + 0.004,
      railTop,
      matBody: 'alu_fine',
    });
    out.okp7 = {
      asm,
      glass,
      mag: 1,
      magRange: null,
      label: 'OKP-7',
      // An open frame has nothing to align but the dot, so it comes up faster
      // than a tube and slower than irons.
      adsScale: 0.95,
      reticle: 'chevron',
    };
  }

  /**
   * ACOG-pattern 4x. A short fat body with a big objective bell and a raised
   * mount — at 4x the exit pupil is small, so the ocular has to sit further
   * back, which is why the eye relief in `defs.js` is generous.
   */
  {
    const asm = new Assembly('optic-acog');
    // Riser: 4x glass sits high enough to need one, and it reads at a glance.
    addRail(asm, 'alu_fine', z - 0.05, z + 0.05, railTop + 0.012, 0, { top: false });
    const glass = buildOptic(asm, {
      rTube: 0.0205 * k,
      len: 0.086 * k,
      hood: 0.011,
      // A 41 mm objective needs more clearance over the rail than a 31 mm tube.
      y: opticY + 0.006,
      z,
      railTop: railTop + 0.012,
      matBody: 'alu_fine',
      matSteel: 'steel',
    });
    out.acog = {
      asm,
      glass,
      mag: 4,
      magRange: null,
      label: 'ACOG 4x',
      // Magnified glass is slow to get behind: you have to find the eyebox.
      adsScale: 1.34,
      reticle: 'chevron',
    };
  }

  /**
   * VARIABLE 1-6x. The longest tube on the list, with a throw lever bump on the
   * magnification ring. Scroll the wheel while aimed to change power — the
   * range lives in `magRange` and nothing else in the game needs to know that
   * this optic is special.
   */
  {
    const asm = new Assembly('optic-vari');
    addRail(asm, 'alu_fine', z - 0.062, z + 0.062, railTop + 0.01, 0, { top: false });
    const glass = buildOptic(asm, {
      rTube: 0.019 * k,
      len: 0.126 * k,
      hood: 0.013,
      y: opticY + 0.005,
      z,
      railTop: railTop + 0.01,
      matBody: 'alu_fine',
      matSteel: 'steel',
    });
    out.vari = {
      asm,
      glass,
      mag: 1,
      magRange: [1, 6],
      label: 'Variable 1-6x',
      adsScale: 1.28,
      reticle: 'chevron',
    };
  }

  return out;
}
