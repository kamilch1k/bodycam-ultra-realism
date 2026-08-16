/**
 * Does a `paint()` tint actually produce the colour it names?
 *
 * The shader multiplies the tint onto the baked plaster albedo, so the only way
 * to know a wall will look white is to redo that multiply here. This catches
 * the exact bug that made every neon surface render as concrete: a tint that
 * cannot exceed 1 can only darken a 0.316 base, so `neon_white` was arriving at
 * the screen as 0.28 linear no matter which near-white hex it was given.
 *
 *   node tools/paint-check.mjs
 */
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { PALETTE } from '../src/world/palette.js';

const PLASTER_ALBEDO = 0.316; // must track the constant in palette.js
const NEON = {
  neon_white: 0xd1def5,
  neon_pink: 0xff2e88,
  neon_cyan: 0x15d8e0,
  neon_purple: 0x8a2be2,
  neon_orange: 0xff6a13,
  neon_teal: 0x00b899,
};
// paint() trims to 0.9 so the plaster's bright trowel patches stay under 1.0.
const LIFT = 0.9;

let worst = 0;
for (const [key, hex] of Object.entries(NEON)) {
  const tint = PALETTE[key].opts.tint;
  assert.ok(tint?.isColor, `${key}: tint must be a THREE.Color gain, not a hex`);

  // What the shader does: alb = base * tint, on the mean plaster albedo.
  const got = tint.clone().multiplyScalar(PLASTER_ALBEDO);
  const want = new THREE.Color(hex).multiplyScalar(LIFT);

  for (const ch of ['r', 'g', 'b']) {
    worst = Math.max(worst, Math.abs(got[ch] - want[ch]));
    // Nothing may clip: a channel at 1.0 is a flat blown-out patch with no
    // texture left in it, which is how "stylised" turns into "untextured".
    assert.ok(got[ch] <= 1.0, `${key}.${ch} clips at ${got[ch].toFixed(3)}`);
  }
  assert.ok(
    Math.abs(got.r - want.r) < 1e-6 &&
      Math.abs(got.g - want.g) < 1e-6 &&
      Math.abs(got.b - want.b) < 1e-6,
    `${key}: renders ${got.getHexString()} but names ${hex.toString(16)}`
  );
  console.log(`  ${key.padEnd(12)} tint x${tint.r.toFixed(2)} -> albedo ${got.getHexString()}`);
}

/**
 * The one that matters: white has to arrive on SCREEN white.
 *
 * Albedo alone does not decide that — the sun is warm (measured b/r 0.755 at
 * Miami's hour, see tools/hour-sweep.mjs) and the eye sees albedo times light.
 * `neon_white` is therefore authored cool ON PURPOSE, so checking its red
 * channel is bright would be checking the wrong thing and would fail a correct
 * paint. What has to hold is that the product is bright AND neutral.
 */
const SUN = new THREE.Color(1, 0.87, 0.7); // hour 13, from tools/look-probe.mjs
const lit = PALETTE.neon_white.opts.tint.clone().multiplyScalar(PLASTER_ALBEDO).multiply(SUN);
const luma = 0.2126 * lit.r + 0.7152 * lit.g + 0.0722 * lit.b;
const cast = Math.max(lit.r, lit.g, lit.b) - Math.min(lit.r, lit.g, lit.b);

assert.ok(luma > 0.45, `neon_white lights to ${luma.toFixed(3)} linear — too dark to read as white`);
assert.ok(cast < 0.06, `neon_white lights to a ${cast.toFixed(3)} colour cast — that is the sand look`);

console.log(
  `  neon_white under the sun: luma ${luma.toFixed(3)}, cast ${cast.toFixed(3)} (want > 0.45, < 0.06)`
);
console.log(`ok — 6 surfaces, worst channel error ${worst.toExponential(1)}`);
