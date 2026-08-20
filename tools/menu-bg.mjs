/**
 * Regenerate src/ui/menubg.js — the menu backdrop.
 *
 * Captures a real frame of the game with the HUD hidden and writes it into a
 * module as a base64 data URI. It has to be embedded rather than rendered live:
 * the menu is DOM and paints on the browser's first frame, twelve seconds before
 * a WebGL context exists.
 *
 * Needs a server serving the build — `vite preview --port 5181`.
 *
 *   node tools/menu-bg.mjs [baseUrl] [map]
 */
import { chromium } from 'playwright';
import { writeFileSync, statSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5181/';
const MAP = process.argv[3] ?? 'strike';
const W = 1600;
const H = 900;
/** q72: it sits under an opaque scrim, so detail beyond this costs bytes for nothing. */
const QUALITY = 72;

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
// `q=ultra` on purpose — the menu is the one place the game may look more
// expensive than it runs.
await p.goto(`${BASE}?map=${MAP}&menu=0&q=ultra`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 300000 });
await p.waitForTimeout(2500);

await p.evaluate(() => {
  document.querySelector('.ow-hud')?.style.setProperty('display', 'none', 'important');
});
// A held trigger, so the shot has muzzle smoke and a casing in the air rather
// than being a static prop photo.
await p.evaluate(() => window.__ENGINE__.ctx.input._pendingDown.add('Mouse0'));
await p.waitForTimeout(200);

const jpg = await p.screenshot({ type: 'jpeg', quality: QUALITY });
await b.close();

const out = new URL('../src/ui/menubg.js', import.meta.url);
const enc = jpg.toString('base64');
writeFileSync(
  out,
  `/**
 * Menu backdrop — a real frame from the game, not stock art.
 *
 * Embedded rather than rendered live: the menu is DOM and paints on the
 * browser's FIRST frame, long before a WebGL context exists. Showing the game
 * there at all means showing a picture of it.
 *
 * ${W}x${H} JPEG q${QUALITY}, HUD hidden, ~${Math.round(enc.length / 1024)} KB as base64.
 * It sits under an opaque scrim, so more detail would cost bytes for nothing.
 *
 * Regenerate: node tools/menu-bg.mjs
 */
export const MENU_BG = 'data:image/jpeg;base64,${enc}';
`
);
console.log(`wrote src/ui/menubg.js  ${Math.round(statSync(out).size / 1024)} KB`);
