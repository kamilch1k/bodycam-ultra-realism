/**
 * Walk the player at an enemy and record what each frame allocates.
 *
 * "It lags hard when approaching enemies" is the second reported hitch. The
 * theory to test is lazy construction: a soldier whose geometry, textures or
 * shader variant is only built the first time he is close enough to draw at
 * full detail.
 *
 * Same rules as the other probes here — frame TIMES from headless are fiction
 * (no GPU, software rasterisation), allocation counts are real and
 * GPU-independent. A geometry or program created on the frame an enemy comes
 * into view is a hitch on real hardware.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=swat&menu=0';
const FRAMES = Number(process.argv[3] ?? 320);

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 240000 });
await p.waitForTimeout(1500);

const r = await p.evaluate(
  ({ N }) =>
    new Promise((done) => {
      const e = window.__ENGINE__;
      const info = e.ctx.get('render').renderer.info;
      const ai = e.ctx.peek('ai');
      const player = e.ctx.peek('player');
      const cam = e.ctx.camera;

      const target = ai?.agents?.find((a) => a.alive);
      if (!target || !player) return done({ error: 'no target or no player' });

      const start = { x: player.position.x, y: player.position.y, z: player.position.z };
      const rows = [];
      let g = info.memory.geometries;
      let t = info.memory.textures;
      let pr = info.programs?.length ?? 0;
      let i = 0;

      const tick = () => {
        // Ease from the spawn point to 2 m short of the enemy over the run, so
        // every distance band between them is crossed.
        const k = i / (N - 1);
        const tx = target.position.x;
        const tz = target.position.z;
        const dx = tx - start.x;
        const dz = tz - start.z;
        const d = Math.hypot(dx, dz) || 1;
        const stop = Math.max(0, d - 2) / d;
        const px = start.x + dx * stop * k;
        const pz = start.z + dz * stop * k;
        if (player.setPosition) player.setPosition(px, start.y, pz);
        else player.position.set(px, start.y, pz);
        // Look at him, so view-frustum culling actually admits him.
        cam?.lookAt?.(tx, target.position.y + 1.2, tz);

        const g2 = info.memory.geometries;
        const t2 = info.memory.textures;
        const p2 = info.programs?.length ?? 0;
        const dist = Math.hypot(tx - px, tz - pz);
        rows.push([i, +dist.toFixed(1), g2 - g, t2 - t, p2 - pr, info.render.calls, info.render.triangles]);
        g = g2;
        t = t2;
        pr = p2;
        if (++i >= N) return done({ rows });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
  { N: FRAMES }
);

if (r.error) {
  console.log('probe void:', r.error);
} else {
  const events = r.rows.filter((x) => x[2] || x[3] || x[4]);
  const sum = (k) => r.rows.reduce((a, x) => a + Math.max(0, x[k]), 0);
  console.log(`frames ${r.rows.length}   approach ${r.rows[0][1]} m -> ${r.rows[r.rows.length - 1][1]} m`);
  console.log(`created during approach:  geo +${sum(2)}   tex +${sum(3)}   programs +${sum(4)}`);
  console.log(`draw calls ${r.rows[0][5]} -> ${r.rows[r.rows.length - 1][5]}   tris ${Math.round(r.rows[0][6] / 1000)}k -> ${Math.round(r.rows[r.rows.length - 1][6] / 1000)}k`);
  console.log('\nframe   dist  +geo  +tex  +prog  calls');
  for (const [f, d, dg, dt, dp, c] of events.slice(0, 40)) {
    console.log(
      `${String(f).padStart(5)}  ${String(d).padStart(5)}  ${String(dg).padStart(4)}  ${String(dt).padStart(4)}  ${String(dp).padStart(5)}  ${String(c).padStart(5)}${dp > 0 ? '   <-- SHADER COMPILE' : ''}`
    );
  }
  if (!events.length) console.log('  (nothing allocated — the hitch is not construction)');
}
await b.close();
