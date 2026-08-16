/**
 * Catch the player teleporting, by simulating far more play than a human could.
 *
 * The first version of this drove the game through requestAnimationFrame and
 * found nothing — headless Chromium runs the loop at about 2 fps, so a "40
 * second" run was roughly 80 frames against the 3600 a player gets in a minute.
 * It was not that the bug did not reproduce; the test barely ran.
 *
 * A teleport is a SIMULATION bug, so rendering is not needed to find it.
 * `Engine.step()` is exposed for pumping frames by hand, so this stops the rAF
 * loop, stubs the render pass, and drives tens of thousands of movement frames
 * at a fixed 60 Hz — running, sprinting, jumping and crouching into geometry,
 * which is where mantles, step-ups and depenetration all live.
 *
 * A discontinuity is defined, not eyeballed: a position step larger than
 * `velocity * dt` can explain. Every hit records what wrote to the player.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=holdout&menu=0';
const FRAMES = Number(process.argv[3] ?? 30000);

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(1500);

const res = await p.evaluate((frames) => {
  const e = window.__ENGINE__;
  const inp = e.ctx.input;
  const pl = e.ctx.peek('player');
  const m = pl.movement;

  // Stop the rAF loop and the render pass: position and yaw do not depend on
  // anything being drawn, and rendering is what makes headless crawl.
  e.stop();
  const render = e.registry.peek('render');
  const realRender = render.render;
  render.render = () => {};
  // The warp logger in PlayerSystem would print thousands of lines here.
  const realWarp = pl._reportWarp;
  pl._reportWarp = () => {};

  const hits = [];
  /**
   * Every large jump lands on the same coordinate with velocity zero, which is a
   * spawn point rather than anything physics did. Wrap the two functions that
   * can put the player there, so the report names the CALLER instead of leaving
   * "something teleported you" as the conclusion.
   */
  const calls = [];
  for (const fn of ['respawn', 'teleport']) {
    const real = pl[fn].bind(pl);
    pl[fn] = (...a) => {
      calls.push({
        fn,
        frame: frameNo,
        health: pl.health?.value,
        dead: !!pl.dead,
        stack: (new Error().stack || '').split('\n').slice(1, 5).join(' <- '),
      });
      return real(...a);
    };
  }
  let frameNo = 0;
  const DT = 1000 / 60;
  let now = performance.now();
  let seed = 0x2f6e2b1;
  const rnd = () => (((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 8) % 10000) / 10000;

  let prev = { x: m.position.x, y: m.position.y, z: m.position.z };
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  let held = 'KeyW';
  inp._pendingDown.add(held);
  let sprint = false;

  for (let i = 0; i < frames; i++) {
    frameNo = i;
    // change direction, sprint, jump and crouch on their own cadences so the
    // run keeps colliding with the level rather than settling into a groove
    if (i % 37 === 0) {
      inp._pendingUp.add(held);
      held = keys[Math.floor(rnd() * 4)];
      inp._pendingDown.add(held);
    }
    if (i % 53 === 0) {
      sprint = rnd() < 0.5;
      if (sprint) inp._pendingDown.add('ShiftLeft');
      else inp._pendingUp.add('ShiftLeft');
    }
    if (i % 29 === 0) inp._pendingDown.add('Space');
    if (i % 29 === 4) inp._pendingUp.add('Space');
    if (i % 91 === 0) inp._pendingDown.add('ControlLeft');
    if (i % 91 === 20) inp._pendingUp.add('ControlLeft');
    // keep turning so the run sweeps the whole map
    inp._rawLook.x += (rnd() - 0.5) * 40;

    now += DT;
    e.step(now);

    const pos = m.position;
    const v = m.velocity;
    const speed = Math.hypot(v.x, v.y, v.z);
    const dt = e.time.dt;
    const moved = Math.hypot(pos.x - prev.x, pos.y - prev.y, pos.z - prev.z);
    const budget = speed * dt * 3 + 0.15;
    if (moved > budget && hits.length < 30) {
      hits.push({
        frame: i,
        moved: +moved.toFixed(2),
        budget: +budget.toFixed(2),
        dy: +(pos.y - prev.y).toFixed(2),
        speed: +speed.toFixed(2),
        state: m.state ?? null,
        mantle: !!m.mantleMotion?.active,
        grounded: !!m.grounded,
        stepped: !!m.character?.steppedUp,
        blocked: !!m.character?.lastMoveBlocked,
        from: [+prev.x.toFixed(1), +prev.y.toFixed(1), +prev.z.toFixed(1)],
        to: [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)],
      });
    }
    prev = { x: pos.x, y: pos.y, z: pos.z };
  }

  render.render = realRender;
  pl._reportWarp = realWarp;
  e.start();
  return { hits, calls: calls.slice(0, 12), nCalls: calls.length, frames };
}, FRAMES);

console.log(`simulated ${res.frames} frames (${(res.frames / 60).toFixed(0)}s of play)\n`);
if (!res.hits.length) {
  console.log('no position discontinuity');
} else {
  for (const h of res.hits) console.log(JSON.stringify(h));
  console.log(`\n${res.hits.length} teleports`);
}
if (res.nCalls) {
  console.log(`\n${res.nCalls} respawn/teleport call(s) — the caller is the bug:`);
  for (const c of res.calls) {
    console.log(`  ${c.fn}() frame ${c.frame}  health=${c.health}  dead=${c.dead}`);
    console.log(`    ${c.stack}`);
  }
}
await b.close();
process.exit(res.hits.length ? 1 : 0);
