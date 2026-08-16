/**
 * What colour is the map ACTUALLY rendering, and what did the sky actually get?
 *
 * Screenshots are for judging a look; this is for settling arguments about one.
 * It reads the live tint uniforms off the real materials and samples the real
 * framebuffer, so "the walls are grey" becomes a number instead of a squint.
 *
 *   node tools/look-probe.mjs [map]
 */
import { chromium } from 'playwright';

const MAP = process.argv[2] ?? 'miami';

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`http://127.0.0.1:5181/?map=${MAP}&menu=0&q=high`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(2000);

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const sky = e.ctx.peek('sky');

  // Every distinct surface material in the level, with the tint it will apply.
  const mats = new Map();
  e.ctx.peek('world')?.root?.traverse?.((o) => {
    const m = o.material;
    if (!m || mats.has(m.name)) return;
    const t = m.userData?.owUniforms?.owTintCol?.value;
    mats.set(m.name, {
      name: m.name,
      tint: t ? [+t.r.toFixed(3), +t.g.toFixed(3), +t.b.toFixed(3)] : null,
      tris: 0,
    });
  });
  // Size matters: a wrong tint on one bollard is not what anyone is complaining
  // about. Weight each material by how much of the map it actually covers.
  e.ctx.peek('world')?.root?.traverse?.((o) => {
    const rec = o.material && mats.get(o.material.name);
    if (rec && o.geometry) rec.tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  });

  /**
   * Sample the real framebuffer.
   *
   * The camera is parked overhead-oblique (the angle the map screenshots use)
   * so the same three things are always under the same probes: sky at the top
   * of frame, the deck in the middle, a wall face lower down. Reading the
   * canvas rather than the material is the only way to include lighting,
   * exposure and tone mapping — which is where a correct albedo can still
   * arrive on screen as grey.
   */
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.viewScene.visible = false;
  const c = e.camera;
  c.position.set(46, 30, 10);
  c.up.set(0, 1, 0);
  c.lookAt(-2, 0, 2);
  c.updateMatrixWorld(true);
  for (let i = 0; i < 6; i++) e.step(performance.now() + 16 * i);

  const cv = e.ctx.peek('render').renderer.domElement;
  const t = document.createElement('canvas');
  t.width = cv.width;
  t.height = cv.height;
  t.getContext('2d').drawImage(cv, 0, 0);
  const g2 = t.getContext('2d');
  const at = (fx, fy) => {
    const d = g2.getImageData(Math.round(fx * t.width), Math.round(fy * t.height), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const px = {
    'sky zenith': at(0.5, 0.03),
    'sky horizon': at(0.12, 0.16),
    'deck centre': at(0.5, 0.62),
    'deck far': at(0.5, 0.42),
    'wall face': at(0.28, 0.78),
  };

  const r = e.ctx.peek('render');
  const light = sky && {
    sunAltDeg: +((sky.sunAltitude * 180) / Math.PI).toFixed(1),
    sunI: +sky.sunLight.intensity.toFixed(3),
    sunCol: [sky.sunLight.color.r, sky.sunLight.color.g, sky.sunLight.color.b].map((v) => +v.toFixed(3)),
    ambient: [sky.ambientColor.r, sky.ambientColor.g, sky.ambientColor.b].map((v) => +v.toFixed(3)),
    indirect: +sky.indirectScale.toFixed(3),
    exposureBias: +sky.exposureBias.toFixed(3),
    rendererExposure: +r.renderer.toneMappingExposure.toFixed(3),
    toneMapping: r.renderer.toneMapping,
  };

  return {
    light,
    hour: sky?.hour,
    weather: sky ? { ...sky.weather } : null,
    fog: sky ? { scatter: sky.fog.scatter, extinction: sky.fog.extinction } : null,
    materials: [...mats.values()].sort((a, c) => c.tris - a.tris).slice(0, 12),
    px,
  };
});

console.log('light:', out.light);
console.log(`map=${MAP}  hour=${out.hour?.toFixed(2)}`);
console.log('weather:', out.weather);
console.log('fog:', out.fog);
console.log('\nbiggest surfaces (tint = linear multiply onto the baked albedo):');
for (const m of out.materials) {
  console.log(`  ${String(Math.round(m.tris)).padStart(7)} tris  ${(m.tint ?? []).join(', ').padEnd(22)}  ${m.name}`);
}
/**
 * Saturation is the number that matters for "is it grey". A neutral pixel has
 * max==min however bright it is, and every complaint about this map so far has
 * been a bright-enough surface with a saturation near zero.
 */
console.log('\nrendered pixels (sRGB 0-255):');
for (const [k, [r, g, bl]] of Object.entries(out.px)) {
  const mx = Math.max(r, g, bl);
  const sat = mx === 0 ? 0 : (mx - Math.min(r, g, bl)) / mx;
  console.log(
    `  ${k.padEnd(12)} rgb(${String(r).padStart(3)},${String(g).padStart(3)},${String(bl).padStart(3)})` +
      `  luma ${Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bl)
        .toString()
        .padStart(3)}  sat ${sat.toFixed(2)}`
  );
}
await b.close();
