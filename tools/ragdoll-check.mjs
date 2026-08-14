/**
 * Kill an agent and watch the ragdoll for divergence.
 *
 * The reported bug is a corpse whose mesh explodes into long stretched
 * triangles. That is the signature of a skinned mesh whose BONES have left the
 * body — a constraint solver going unstable, or one NaN poisoning the chain.
 *
 * Unlike frame timing, this is measurable here: bone matrices are CPU data. The
 * probe reports, per frame, the furthest any bone sits from the body's centre
 * and whether any component is non-finite. A healthy ragdoll settles at roughly
 * a body radius (under ~1.5 m). Divergence shows as a number that climbs without
 * bound; a NaN shows as `nonFinite`.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=holdout&menu=0';
const FRAMES = Number(process.argv[3] ?? 180);

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
      const ai = e.ctx.peek('ai');
      const target = ai?.agents?.find((a) => a.alive);
      if (!target) return done({ error: 'no live agent' });

      const centre = { x: target.position.x, y: target.position.y, z: target.position.z };
      // Kill him the way a bullet would, so the ragdoll gets a real impulse.
      const pt = { x: centre.x, y: centre.y + 1.2, z: centre.z };
      const dir = { x: 0.2, y: 0.05, z: 1 };
      try {
        target.die(pt, dir, 120);
      } catch (err) {
        return done({ error: 'die() threw: ' + err.message });
      }

      const rows = [];
      let i = 0;
      const tick = () => {
        let maxD = 0;
        let nonFinite = 0;
        let bones = 0;
        target.mesh?.skeleton?.bones?.forEach((bone) => {
          bones++;
          bone.updateMatrixWorld?.(true);
          const m = bone.matrixWorld.elements;
          const x = m[12];
          const y = m[13];
          const z = m[14];
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            nonFinite++;
            return;
          }
          const d = Math.hypot(x - centre.x, y - centre.y, z - centre.z);
          if (d > maxD) maxD = d;
        });
        rows.push([i, +maxD.toFixed(2), nonFinite, bones]);
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
  const last = r.rows[r.rows.length - 1];
  const peak = r.rows.reduce((a, x) => Math.max(a, x[1]), 0);
  const nan = r.rows.reduce((a, x) => a + x[2], 0);
  console.log(`bones ${last[3]}   frames ${r.rows.length}`);
  console.log(`furthest bone from body centre:  peak ${peak} m   final ${last[1]} m`);
  console.log(`non-finite bone positions: ${nan}`);
  console.log('\nframe  maxDist  nonFinite');
  for (const [f, d, nf] of r.rows.filter((_, k) => k % 12 === 0 || _[2] > 0).slice(0, 22)) {
    console.log(`${String(f).padStart(5)}  ${String(d).padStart(7)}  ${nf}`);
  }
  const verdict =
    nan > 0 ? 'NaN in the skeleton' : peak > 4 ? 'DIVERGING — bones leave the body' : 'stable';
  console.log(`\nverdict: ${verdict}`);
}
await b.close();
