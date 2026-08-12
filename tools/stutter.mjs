/**
 * Stutter probe: record a per-frame timeline from the moment the game is
 * playable, and attribute every spike to what the renderer allocated on that
 * frame. A hitch that coincides with new geometries/textures/programs is lazy
 * construction; one that does not is real work.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5180/?map=yard&menu=0';
const W = Number(process.argv[3] ?? 1280);
const H = Number(process.argv[4] ?? 720);
const FRAMES = Number(process.argv[5] ?? 900);

const b = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const p = await b.newPage({ viewport: { width: W, height: H } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 90000 });

const r = await p.evaluate(
  ({ N }) =>
    new Promise((done) => {
      const e = window.__ENGINE__;
      const info = e.ctx.get('render').renderer.info;
      const rows = [];
      let last = performance.now();
      const t0 = last;
      let prevGeo = info.memory.geometries;
      let prevTex = info.memory.textures;
      let prevProg = info.programs ? info.programs.length : 0;
      let i = 0;
      const tick = () => {
        const now = performance.now();
        const dt = now - last;
        last = now;
        const g = info.memory.geometries;
        const t = info.memory.textures;
        const pr = info.programs ? info.programs.length : 0;
        rows.push([
          +(now - t0).toFixed(0),
          +dt.toFixed(2),
          g - prevGeo,
          t - prevTex,
          pr - prevProg,
          info.render.calls,
          info.render.triangles,
        ]);
        prevGeo = g;
        prevTex = t;
        prevProg = pr;
        if (++i >= N) done(rows);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
  { N: FRAMES }
);

const ms = r.map((x) => x[1]).sort((a, b) => a - b);
const pct = (q) => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))];
const spikes = r.filter((x) => x[1] > 33).slice(0, 25);

console.log(
  JSON.stringify(
    {
      url: URL,
      res: `${W}x${H}`,
      frames: r.length,
      medianMs: +pct(0.5).toFixed(2),
      p95Ms: +pct(0.95).toFixed(2),
      p99Ms: +pct(0.99).toFixed(2),
      worstMs: +ms[ms.length - 1].toFixed(2),
      medianFps: Math.round(1000 / pct(0.5)),
      framesOver33ms: r.filter((x) => x[1] > 33).length,
      framesOver16ms: r.filter((x) => x[1] > 16.7).length,
      spikes: spikes.map(([t, dt, dg, dtex, dp, calls, tris]) => ({
        atMs: t,
        ms: dt,
        newGeo: dg,
        newTex: dtex,
        newProg: dp,
        calls,
        tris,
      })),
    },
    null,
    2
  )
);
await b.close();
