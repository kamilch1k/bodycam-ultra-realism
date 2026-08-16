/**
 * A level-up must not stop the game.
 *
 * The old card held `time.scale` at zero, took control and released the pointer
 * lock. The whole point of the roll is that none of that happens, and "none of
 * that happens" is exactly the kind of claim that rots silently — so this levels
 * the player mid-simulation and asserts the clock, the control flag and the
 * lock are all untouched, and that the world actually kept moving.
 *
 *   node tools/nopause-check.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 506 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 160));
});
await p.goto('http://127.0.0.1:5181/?map=miami&menu=0&q=high', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(2500);

const r = await p.evaluate(async () => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');
  const perks = ctx.perks;
  const player = ctx.peek('player');
  const render = ctx.peek('render');
  const real = render.render;
  render.render = () => {};

  ai.populate({ squads: 3, perSquad: 5, variants: ['ghoul'] });
  let t = performance.now();
  for (let i = 0; i < 30; i++) e.step((t += 16.6));

  const out = { levelsSeen: 0 };
  const lvl0 = perks.plevel;

  // Enough kills to guarantee several levels, in one burst — the worst case,
  // because it is also the one that used to stack modal cards.
  const victims = (ai.agents ?? []).filter((a) => a.alive).slice(0, 12);
  for (const a of victims) a.die?.(null, null, 30);

  // Sample the clock and control flags across the frames right after.
  let minScale = Infinity;
  let controlLost = false;
  let lockSuppressed = false;
  const enemyStart = (ai.agents ?? []).filter((a) => a.alive)[0]?.position.clone();
  for (let i = 0; i < 200; i++) {
    e.step((t += 16.6));
    minScale = Math.min(minScale, ctx.time.scale);
    if (player?.controlEnabled === false) controlLost = true;
    if (ctx.input?.lockSuppressed) lockSuppressed = true;
  }
  const enemyEnd = (ai.agents ?? []).filter((a) => a.alive)[0]?.position;

  out.levelsSeen = perks.plevel - lvl0;
  out.minScale = minScale;
  out.controlLost = controlLost;
  out.lockSuppressed = lockSuppressed;
  // Did the world keep running while levels were being awarded?
  out.enemyMoved = enemyStart && enemyEnd ? +enemyStart.distanceTo(enemyEnd).toFixed(2) : null;
  // Perks must actually have been granted, not merely announced.
  out.perksTaken = Object.values(perks.level).reduce((s, n) => s + n, 0);
  // And the modal card must never have been shown.
  out.cardOnScreen = !!document.querySelector('.ow-perkcard');
  out.rollExists = !!document.querySelector('.ow-roll');

  render.render = real;
  return out;
});

await b.close();

const bad = [];
if (r.levelsSeen < 2) bad.push(`only ${r.levelsSeen} levels from 12 kills`);
if (r.minScale !== 1) bad.push(`time.scale dipped to ${r.minScale} — the game paused`);
if (r.controlLost) bad.push('control was taken away');
if (r.lockSuppressed) bad.push('pointer lock was suppressed');
if (!(r.enemyMoved > 0.5)) bad.push(`world stalled: nearest enemy moved ${r.enemyMoved}m`);
if (r.perksTaken < r.levelsSeen) bad.push(`${r.levelsSeen} levels but only ${r.perksTaken} perks taken`);
if (r.cardOnScreen) bad.push('the modal perk card was shown');
if (!r.rollExists) bad.push('no roll widget in the DOM');

console.log(`  levels            ${r.levelsSeen}`);
console.log(`  perks granted     ${r.perksTaken}`);
console.log(`  min time.scale    ${r.minScale}   (must stay 1)`);
console.log(`  control taken     ${r.controlLost}`);
console.log(`  lock suppressed   ${r.lockSuppressed}`);
console.log(`  enemy kept moving ${r.enemyMoved}m`);
console.log(`  modal card shown  ${r.cardOnScreen}`);
if (errors.length) console.log(`\npage errors (${errors.length}):\n  ` + errors.slice(0, 5).join('\n  '));
console.log(bad.length ? `\nFAIL: ${bad.join('; ')}` : '\nok — levels granted without pausing anything');
process.exit(bad.length || errors.length ? 1 : 0);
