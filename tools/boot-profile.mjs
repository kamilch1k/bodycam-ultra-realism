/**
 * Where does boot time actually go?
 *
 * Everything in this game is generated at load — surface textures, character
 * geometry, the level, every shader — and "reduce load times" is meaningless
 * until it is known which of those dominates. This collects the timing lines
 * the subsystems already print, buckets them, and reports the total against
 * the portal budget.
 *
 * The RELATIVE split is the useful output. Absolute milliseconds here are a
 * software rasteriser with no GPU, so shader compiles and uploads are inflated
 * against a real machine while pure CPU work (procedural bakes, mesh building,
 * navigation) is roughly honest.
 *
 *   node tools/boot-profile.mjs [map]
 */
import { chromium } from 'playwright';

const MAP = process.argv[2] ?? 'miami';

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const lines = [];
p.on('console', (m) => {
  const t = m.text();
  if (/^\[(boot|materials|ai|world|sky|fx|render|physics|audio)\]/.test(t)) lines.push(t);
});
p.on('pageerror', (e) => console.log('[pageerror]', e.message.split('\n')[0]));

const t0 = Date.now();
await p.goto(`http://127.0.0.1:5181/?map=${MAP}&menu=0&q=high`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
// Let the tail of the boot log land.
await p.waitForTimeout(3000);
const wall = Date.now() - t0;

const gpu = await p.evaluate(() => {
  const i = window.__ENGINE__.ctx.peek('render').renderer.info;
  return { tex: i.memory.textures, geo: i.memory.geometries, prog: i.programs?.length ?? 0 };
});
await b.close();

// Pull every "<n>ms" out of the collected lines and bucket by subsystem.
const buckets = new Map();
for (const l of lines) {
  const sys = l.match(/^\[(\w+)\]/)?.[1] ?? '?';
  for (const m of l.matchAll(/(\d+(?:\.\d+)?)\s*ms/g)) {
    buckets.set(sys, (buckets.get(sys) ?? 0) + parseFloat(m[1]));
  }
}
const playable = lines.find((l) => l.includes('playable in'))?.match(/(\d+)\s*ms/)?.[1];

console.log(`map ${MAP}   wall ${wall} ms   reported playable ${playable ?? '?'} ms`);
console.log(`gpu at boot: ${gpu.tex} textures, ${gpu.geo} geometries, ${gpu.prog} programs\n`);

const rows = [...buckets.entries()].sort((a, c) => c[1] - a[1]);
const total = rows.reduce((s, r) => s + r[1], 0);
console.log('  subsystem      ms      share');
for (const [sys, ms] of rows) {
  const share = total ? (ms / total) * 100 : 0;
  const bar = '#'.repeat(Math.round(share / 3));
  console.log(`  ${sys.padEnd(10)} ${ms.toFixed(0).padStart(7)}   ${share.toFixed(1).padStart(5)}%  ${bar}`);
}
console.log(`  ${'TOTAL'.padEnd(10)} ${total.toFixed(0).padStart(7)}`);

console.log('\nslowest reported steps:');
const timed = lines
  .map((l) => ({ l, ms: Math.max(0, ...[...l.matchAll(/(\d+(?:\.\d+)?)\s*ms/g)].map((m) => parseFloat(m[1]))) }))
  .filter((x) => x.ms > 0)
  .sort((a, c) => c.ms - a.ms)
  .slice(0, 14);
for (const x of timed) console.log(`  ${String(Math.round(x.ms)).padStart(6)} ms  ${x.l.slice(0, 110)}`);
