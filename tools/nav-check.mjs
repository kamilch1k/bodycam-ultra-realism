/**
 * Does the navigation actually work on this map?
 *
 * "Enemies just go straight into walls" has two very different causes and they
 * need different fixes:
 *
 *   NO PATH      the nav grid says the player is unreachable, so the agent falls
 *                back to steering straight at them and grinds on whatever is in
 *                between. Shows up as a low path success rate.
 *   BAD GRID     the grid says a cell is walkable where there is in fact a wall,
 *                so the path itself runs through geometry. Shows up as a path
 *                whose segments fail a line-of-sight test.
 *
 * Both are measurable here — the grid and the solver are plain CPU data — so
 * this samples agent-to-player paths and reports which one is happening.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=holdout&menu=0';
const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 240000 });
await p.waitForTimeout(1500);

const r = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const grid = ai?.grid;
  if (!grid) return { error: 'no nav grid' };

  const out = {
    cells: `${grid.nx}x${grid.nz ?? grid.ny ?? '?'}`,
    walkable: 0,
    total: grid.floor?.length ?? 0,
    api: Object.getOwnPropertyNames(Object.getPrototypeOf(grid)).filter((k) => k !== 'constructor'),
    samples: [],
  };
  // `walkable` is a METHOD taking cell indices; the raw data is `flags`.
  // Counting `grid.walkable.length` reported zero and meant nothing.
  const flags = grid.flags;
  if (flags) for (let i = 0; i < flags.length; i++) if (flags[i] !== 0) out.walkable++;

  /**
   * Sample a ring of start points around the map and ask for a path to the
   * middle of the keep — the exact query a horde makes every frame.
   */
  const target = { x: 0, y: 1.2, z: 0 };
  const R = 26;
  let ok = 0;
  let tries = 0;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const sx = Math.cos(ang) * R;
    const sz = Math.sin(ang) * R;
    tries++;
    // findPath(from, to, out) writes into `out` and returns the NODE COUNT.
    const buf = [];
    let len = 0;
    try {
      len = grid.findPath({ x: sx, y: 0.2, z: sz }, target, buf) ?? 0;
    } catch (err) {
      out.samples.push({ ang: a, error: err.message });
      continue;
    }
    if (len > 0) ok++;
    // A path is only honest if its segments stay on walkable ground: a grid that
    // marks a wall walkable produces a path that runs through it.
    let through = 0;
    for (let k = 1; k < len; k++) {
      const A = buf[k - 1];
      const B = buf[k];
      if (A && B && grid.lineOfWalk && !grid.lineOfWalk(A, B)) through++;
    }
    out.samples.push({ from: [sx | 0, sz | 0], nodes: len, throughWalls: through });
  }
  out.pathOk = ok;
  out.pathTries = tries;
  return out;
});

if (r.error) {
  console.log('probe void:', r.error);
} else {
  console.log(`grid ${r.cells}   walkable ${r.walkable} / ${r.total}`);
  console.log(`paths to the keep: ${r.pathOk}/${r.pathTries}`);
  console.log(`grid api: ${r.api.join(', ')}`);
  const bad = r.samples.reduce((a, s) => a + (s.throughWalls ?? 0), 0);
  console.log(`path segments crossing unwalkable ground: ${bad}`);
  const dead = r.samples.filter((s) => !s.nodes);
  if (dead.length) {
    console.log('\nno path from:');
    for (const s of dead.slice(0, 10)) console.log(`  ${JSON.stringify(s.from ?? s)}`);
  }
}
await b.close();
