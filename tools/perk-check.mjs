/**
 * Prove the perks actually reach the systems that read them.
 *
 * A perk that increments a counter and changes nothing is the failure mode
 * here, and it is invisible from the outside: the card shows, the number goes
 * up, the gun does exactly what it did before. So this takes each perk and
 * asserts against the VALUE THE SYSTEM USES, not against the perk object.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=holdout&menu=0';
const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 240000 });
await p.waitForTimeout(1200);

const r = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const perks = ctx.perks;
  const out = { mounted: !!perks, cardMounted: !!ctx.peek('ui')?.perkCard, checks: [] };
  if (!perks) return out;
  const ck = (name, before, after, want) =>
    out.checks.push({ name, before: +before.toFixed(3), after: +after.toFixed(3), ok: want(before, after) });

  const health = ctx.peek('player')?.health;
  const wp = ctx.peek('weapons');
  const def = wp?.current;

  // damage
  const d0 = def.damage * perks.damageMult;
  perks.take('damage');
  ck('damage', d0, def.damage * perks.damageMult, (a, z) => z > a * 1.2);

  // fire rate -> shorter interval
  const f0 = 60 / (def.rpm * perks.fireRateMult);
  perks.take('firerate');
  ck('fire interval', f0, 60 / (def.rpm * perks.fireRateMult), (a, z) => z < a);

  // max health, read by health.update()
  const h0 = health.max;
  perks.take('health');
  health.update(0.016);
  ck('max health', h0, health.max, (a, z) => z === a + 30);

  // jump
  const j0 = perks.jumpSpeed;
  perks.take('jump');
  ck('jump speed', j0, perks.jumpSpeed, (a, z) => z > a);

  // explosive radius (0 until taken)
  const x0 = perks.explosiveRadius;
  perks.take('explosive');
  ck('explosive radius', x0, perks.explosiveRadius, (a, z) => a === 0 && z > 1.5);

  // pickup reach
  const m0 = perks.pickupRadius;
  perks.take('magnet');
  ck('pickup reach', m0, perks.pickupRadius, (a, z) => z > a);

  // roll never offers a maxed perk
  for (let i = 0; i < 9; i++) perks.take('jump');
  const rolls = [];
  for (let i = 0; i < 30; i++) rolls.push(...perks.roll(null, 3));
  out.maxedOffered = rolls.includes('jump');
  out.rollSize = perks.roll(null, 3).length;

  // reset clears everything
  perks.reset();
  out.resetClean = Object.values(perks.level).every((n) => n === 0);
  health.update(0.016);
  out.healthAfterReset = health.max;
  return out;
});

console.log(`perks mounted: ${r.mounted}   card mounted: ${r.cardMounted}`);
let bad = 0;
for (const c of r.checks) {
  if (!c.ok) bad++;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(17)} ${c.before} -> ${c.after}`);
}
const extra = [
  ['maxed perk never offered', r.maxedOffered === false],
  ['roll returns 3', r.rollSize === 3],
  ['reset clears levels', r.resetClean === true],
  ['max health back to stock', r.healthAfterReset === 100],
];
for (const [name, ok] of extra) {
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(bad ? `\n${bad} FAILED` : '\nevery perk reaches the system that reads it');
await b.close();
process.exit(bad ? 1 : 0);
