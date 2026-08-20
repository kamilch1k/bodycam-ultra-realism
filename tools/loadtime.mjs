/**
 * Time-to-playable probe — the number both portals actually grade on.
 *
 * CrazyGames measures "time to reach gameplay" (<=20 s hard, <10 s to hit
 * their 80% conversion benchmark). Yandex has no stated limit but ranks on
 * the same behaviour. Neither cares what the archive weighs once it is cached.
 *
 * Breaks the wait into the two things that cost us: transfer+parse of the one
 * inlined file, and the procedural asset build that runs before __ENGINE__
 * exists. Run against `vite preview` (the real build), not the dev server —
 * dev serves 157 unbundled modules and its numbers mean nothing.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5181/';
const RUNS = Number(process.argv[3] ?? 3);

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });

for (const q of ['?map=yard&menu=0&prewarm=0', '?map=yard&menu=0&prewarm=1']) {
  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    const p = await b.newPage({ viewport: { width: 1024, height: 576 } });
    let bytes = 0;
    p.on('response', async (r) => {
      const len = Number(r.headers()['content-length'] ?? 0);
      if (len) bytes += len;
    });
    const t0 = Date.now();
    await p.goto(BASE + q, { waitUntil: 'domcontentloaded' });
    const domMs = Date.now() - t0;
    await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 180000 });
    rows.push({ domMs, readyMs: Date.now() - t0, bytes });
    await p.close();
  }
  const med = (k) => rows.map((r) => r[k]).sort((a, c) => a - c)[Math.floor(RUNS / 2)];
  console.log(
    JSON.stringify({
      q,
      domMs: med('domMs'),
      readyMs: med('readyMs'),
      buildMs: med('readyMs') - med('domMs'),
      kb: Math.round(med('bytes') / 1024),
      runs: rows.map((r) => r.readyMs),
    })
  );
}
await b.close();
