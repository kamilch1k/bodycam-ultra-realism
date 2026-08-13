/**
 * Pre-publish sweep: boot every map, prove it is playable, and report the two
 * numbers a portal cares about. Anything that throws, spawns no enemies, or
 * renders nothing is a demo that embarrasses you in front of a moderator.
 *
 * Frame TIME is deliberately not reported. This runs headless with no GPU, so
 * it software-rasterises and any ms figure it produced would be fiction; what
 * it can honestly measure is boot cost, scene size, and whether the thing works.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5181/';
const MAPS = ['strike', 'holdout'];

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
let bad = 0;

for (const map of MAPS) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const t0 = Date.now();
  await p.goto(`${BASE}?map=${map}&menu=0`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 240000 });
  const bootMs = Date.now() - t0;

  // Let a few frames land so the renderer's counters are real.
  await p.waitForTimeout(1200);

  const s = await p.evaluate(() => {
    const e = window.__ENGINE__;
    const info = e.ctx.get('render').renderer.info;
    const ai = e.ctx.peek('ai');
    const wp = e.ctx.peek('weapons');
    const pl = e.ctx.peek('player');
    return {
      calls: info.render.calls,
      tris: info.render.triangles,
      programs: info.programs?.length ?? 0,
      textures: info.memory.textures,
      agents: ai?.agents?.length ?? 0,
      alive: ai?.agents?.filter((a) => a.alive).length ?? 0,
      weapon: wp?.current?.label ?? wp?.current?.id ?? null,
      health: pl?.health ?? null,
    };
  });

  // Fire a burst: the single most likely thing to throw is the shot path.
  const shotErr = await p.evaluate(() => {
    try {
      const wp = window.__ENGINE__.ctx.peek('weapons');
      for (let i = 0; i < 5; i++) wp.tryFire?.() ?? wp.fire?.();
      return null;
    } catch (e) {
      return e.message;
    }
  });

  const problems = [];
  if (errors.length) problems.push(`${errors.length} error(s): ${errors[0].slice(0, 90)}`);
  if (shotErr) problems.push(`fire threw: ${shotErr}`);
  if (s.calls === 0 || s.tris === 0) problems.push('renders nothing');
  if (s.alive === 0) problems.push('no live enemies');
  if (!s.weapon) problems.push('no weapon');
  if (problems.length) bad++;

  console.log(
    `${problems.length ? 'FAIL' : 'PASS'}  ${map.padEnd(7)} boot ${String(bootMs).padStart(6)}ms  ` +
      `${String(s.calls).padStart(4)} calls  ${String(Math.round(s.tris / 1000)).padStart(4)}k tris  ` +
      `${String(s.programs).padStart(3)} progs  ${s.textures} tex  ${s.alive}/${s.agents} enemies  ${s.weapon}`
  );
  for (const x of problems) console.log(`        ${x}`);
  await p.close();
}

await b.close();
console.log(bad ? `\n${bad} map(s) FAILED` : '\nevery map boots, renders, arms and populates');
process.exit(bad ? 1 : 0);
