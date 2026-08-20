/**
 * WHAT are the boot shader programs, and which permutations cause them?
 *
 * boot-profile.mjs showed 115 programs compiled before the game is playable,
 * dwarfing every procedural bake put together. Program COUNT is the useful
 * lever because it is machine-independent: headless milliseconds for a compile
 * are fiction, but "115 programs" is 115 programs on the player's machine too,
 * and each one is a D3D translation stall the first time ANGLE draws with it.
 *
 * This groups them by what actually varies. If one axis (shadow variants, a
 * lighting define, a map slot) is multiplying the count, that is where the load
 * time is, and collapsing that axis is worth more than any asset change.
 *
 *   node tools/program-census.mjs [map]
 */
import { chromium } from 'playwright';

const MAP = process.argv[2] ?? 'miami';

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message.split('\n')[0]));
await p.goto(`http://127.0.0.1:5181/?map=${MAP}&menu=0&q=high`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(3000);

const out = await p.evaluate(() => {
  const r = window.__ENGINE__.ctx.peek('render').renderer;
  const progs = [...(r.info.programs ?? [])];

  /**
   * The cache key is `<shaderName>|<customCacheKey>|<...defines/params>`. What
   * matters is which SEGMENT differs across programs — a key that is identical
   * except for one field means that field is the multiplier.
   */
  const rows = progs.map((pr) => ({
    name: pr.name ?? '?',
    key: String(pr.cacheKey ?? ''),
    uses: pr.usedTimes ?? 0,
  }));

  const byName = {};
  for (const x of rows) byName[x.name] = (byName[x.name] ?? 0) + 1;

  // Programs compiled but never actually drawn with are pure boot cost.
  const unused = rows.filter((x) => x.uses === 0);

  return {
    total: rows.length,
    byName: Object.entries(byName).sort((a, c) => c[1] - a[1]),
    unusedCount: unused.length,
    unusedNames: Object.entries(
      unused.reduce((m, x) => ((m[x.name] = (m[x.name] ?? 0) + 1), m), {})
    ).sort((a, c) => c[1] - a[1]),
    sampleKeys: rows.slice(0, 3).map((x) => x.key.slice(0, 220)),
  };
});

await b.close();

console.log(`map ${MAP}: ${out.total} programs compiled at boot\n`);
console.log('  count  shader');
for (const [name, n] of out.byName) console.log(`  ${String(n).padStart(5)}  ${name}`);

console.log(`\n  ${out.unusedCount} of ${out.total} were never drawn with (pure boot cost):`);
for (const [name, n] of out.unusedNames) console.log(`  ${String(n).padStart(5)}  ${name}`);

console.log('\nsample cache keys (what varies between permutations):');
for (const k of out.sampleKeys) console.log(`  ${k}`);
