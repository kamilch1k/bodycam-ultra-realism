/**
 * Find what a SHOT allocates.
 *
 * Frame times from this harness are fiction — headless has no GPU and
 * software-rasterises. Allocation counters are not: a geometry, texture or
 * shader program created on the frame you pull the trigger is a real hitch on
 * real hardware, and it is GPU-independent, so this measures the thing that can
 * actually be measured here.
 *
 * The pattern to look for is a burst of `newProg` on the first shot, the first
 * impact, the first blood, the first shell — each one a shader the prewarm pass
 * missed, each one a freeze the first time that effect happens in a firefight.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=swat&menu=0';
const FRAMES = Number(process.argv[3] ?? 260);

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 240000 });
await p.waitForTimeout(1500);

const rows = await p.evaluate(
  ({ N }) =>
    new Promise((done) => {
      const e = window.__ENGINE__;
      const info = e.ctx.get('render').renderer.info;
      const inp = e.ctx.input;
      const out = [];
      let g = info.memory.geometries;
      let t = info.memory.textures;
      let pr = info.programs?.length ?? 0;
      let i = 0;

      // Hold the trigger from frame 20 so there are quiet frames either side to
      // compare against.
      const tick = () => {
        if (i === 20) inp._pendingDown.add('Mouse0');
        if (i === 200) inp._pendingUp.add('Mouse0');
        const g2 = info.memory.geometries;
        const t2 = info.memory.textures;
        const p2 = info.programs?.length ?? 0;
        out.push([i, g2 - g, t2 - t, p2 - pr, info.render.calls]);
        g = g2;
        t = t2;
        pr = p2;
        if (++i >= N) return done(out);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
  { N: FRAMES }
);

const events = rows.filter((r) => r[1] || r[2] || r[3]);
const sum = (k) => rows.reduce((a, r) => a + Math.max(0, r[k]), 0);

console.log(`frames ${rows.length}   trigger held 20..200`);
console.log(`total created while firing:  geo +${sum(1)}   tex +${sum(2)}   programs +${sum(3)}`);
console.log('\nframe  +geo  +tex  +prog  calls');
for (const [f, dg, dt, dp, c] of events.slice(0, 40)) {
  const flag = dp > 0 ? '   <-- SHADER COMPILE' : '';
  console.log(
    `${String(f).padStart(5)}  ${String(dg).padStart(4)}  ${String(dt).padStart(4)}  ${String(dp).padStart(5)}  ${String(c).padStart(5)}${flag}`
  );
}
if (!events.length) console.log('  (nothing allocated on any frame — the hitch is not construction)');

await b.close();
