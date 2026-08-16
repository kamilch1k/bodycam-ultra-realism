/**
 * Sun colour and sky brightness against time of day.
 *
 * Picking an hour by eye is how this map ended up beige: the sun tint is driven
 * by altitude, so "late afternoon for long shadows" also means "everything
 * white renders as sand". This prints the trade directly — sun neutrality
 * versus how much of the frame is sky — so the hour can be chosen on numbers.
 *
 *   node tools/hour-sweep.mjs [map]
 */
import { chromium } from 'playwright';

const MAP = process.argv[2] ?? 'miami';

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 480, height: 270 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`http://127.0.0.1:5181/?map=${MAP}&menu=0&q=high`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(2000);

const rows = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const sky = e.ctx.peek('sky');
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.viewScene.visible = false;

  // Look UP at the sky rather than down at the deck: the question here is what
  // colour the dome is, and the deck angle barely shows any of it.
  const c = e.camera;
  c.position.set(30, 12, 20);
  c.up.set(0, 1, 0);
  c.lookAt(0, 40, 0);
  c.updateMatrixWorld(true);

  const cv = e.ctx.peek('render').renderer.domElement;
  const t = document.createElement('canvas');
  const out = [];

  for (let h = 6; h <= 20; h += 0.5) {
    sky.setTimeOfDay(h);
    for (let i = 0; i < 3; i++) e.step(performance.now() + 16 * i);
    t.width = cv.width;
    t.height = cv.height;
    const g = t.getContext('2d');
    g.drawImage(cv, 0, 0);
    const d = g.getImageData(t.width >> 1, Math.round(t.height * 0.3), 1, 1).data;
    const s = sky.sunLight.color;
    out.push({
      h,
      alt: +((sky.sunAltitude * 180) / Math.PI).toFixed(1),
      // 1.0 = perfectly neutral sun. This is the number that decides whether a
      // surface painted white can ever arrive on screen white.
      neutral: +(s.b / s.r).toFixed(3),
      sky: [d[0], d[1], d[2]],
    });
  }
  return out;
});

console.log(' hour   alt   sun b/r   sky rgb            sky luma  sky sat');
for (const r of rows) {
  const [x, y, z] = r.sky;
  const mx = Math.max(x, y, z);
  const sat = mx === 0 ? 0 : (mx - Math.min(x, y, z)) / mx;
  console.log(
    `${String(r.h).padStart(5)} ${String(r.alt).padStart(6)}   ${r.neutral.toFixed(3)}   ` +
      `rgb(${String(x).padStart(3)},${String(y).padStart(3)},${String(z).padStart(3)})   ` +
      `${String(Math.round(0.2126 * x + 0.7152 * y + 0.0722 * z)).padStart(6)}    ${sat.toFixed(2)}`
  );
}
await b.close();
