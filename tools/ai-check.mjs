/**
 * Do enemies actually come and kill the player, or do they grind into walls?
 *
 * Reported as "enemies just go straight into walls". That is measurable rather
 * than a matter of taste: an agent that wants to reach the player and cannot is
 * one whose distance stops falling while it is still trying to move. So this
 * pins the player in place, pumps the simulation at a fixed 60 Hz (rendering
 * stubbed — pathing does not need pixels), and reports per agent whether it
 * closed, whether it ever got within striking range, and whether it spent the
 * run pressed against geometry.
 *
 * Pure simulation, so it reads the same here as on real hardware.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=holdout&menu=0';
const FRAMES = Number(process.argv[3] ?? 3600); // 60 s of game time

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(1500);

const res = await p.evaluate((frames) => {
  const e = window.__ENGINE__;
  const pl = e.ctx.peek('player');
  const ai = e.ctx.peek('ai');

  e.stop();
  const rs = e.registry.peek('render');
  const realRender = rs.render;
  rs.render = () => {};
  const realWarp = pl._reportWarp;
  pl._reportWarp = () => {};

  // Immortal, stationary target: the question is whether they can reach it.
  const realDamage = pl.health.damage.bind(pl.health);
  let hitsOnPlayer = 0;
  pl.health.damage = (amt, from, opts) => {
    hitsOnPlayer++;
    return 0;
  };

  // Spawn the HORDE, not the garrison. The starting six are cover-and-shoot
  // soldiers that hold position on purpose; measuring them says nothing about
  // whether the wave enemies charge.
  ai.populate?.({ squads: 3, perSquad: 5, variants: ['ghoul'] });

  const px = pl.movement.position.x;
  const pz = pl.movement.position.z;
  const track = new Map();
  let now = performance.now();
  const DT = 1000 / 60;

  for (let i = 0; i < frames; i++) {
    now += DT;
    e.step(now);

    for (const a of ai.agents ?? []) {
      if (!a || a.dead) continue;
      const d = Math.hypot(a.position.x - px, a.position.z - pz);
      let t = track.get(a);
      if (!t) {
        t = { v: a.variantName ?? a.variant?.name ?? a.variant ?? '?', start: d, min: d, last: d, stuckFrames: 0, lastX: a.position.x, lastZ: a.position.z };
        track.set(a, t);
      }
      const moved = Math.hypot(a.position.x - t.lastX, a.position.z - t.lastZ);
      // "wants to move but isn't": barely displaced while not already adjacent
      if (moved < 0.004 && d > 3) t.stuckFrames++;
      t.lastX = a.position.x;
      t.lastZ = a.position.z;
      t.min = Math.min(t.min, d);
      t.last = d;
    }
  }

  rs.render = realRender;
  pl._reportWarp = realWarp;
  pl.health.damage = realDamage;
  e.start();

  const rows = [...track.values()].map((t) => ({
    v: String(t.v).slice(0, 10),
    start: +t.start.toFixed(1),
    min: +t.min.toFixed(1),
    end: +t.last.toFixed(1),
    closed: +(t.start - t.min).toFixed(1),
    stuckPct: Math.round((t.stuckFrames / frames) * 100),
  }));
  return { rows, hitsOnPlayer, frames, agents: (ai.agents ?? []).length };
}, FRAMES);

console.log(`${res.frames} frames (${(res.frames / 60).toFixed(0)}s), ${res.rows.length} agents tracked\n`);
console.log(`${'variant'.padEnd(11)}${'start'.padStart(7)}${'closest'.padStart(9)}${'end'.padStart(7)}${'closed'.padStart(8)}${'stuck%'.padStart(8)}`);
console.log('-'.repeat(50));
for (const r of res.rows) {
  console.log(
    `${String(r.v).padEnd(11)}${String(r.start).padStart(7)}${String(r.min).padStart(9)}${String(r.end).padStart(7)}${String(r.closed).padStart(8)}${String(r.stuckPct).padStart(8)}`
  );
}
const reached = res.rows.filter((r) => r.min < 2.5).length;
const stuck = res.rows.filter((r) => r.stuckPct > 40).length;
console.log(`\nreached striking range (<2.5m): ${reached}/${res.rows.length}`);
console.log(`stuck >40% of the run:          ${stuck}/${res.rows.length}`);
console.log(`attacks landed on the player:   ${res.hitsOnPlayer}`);
await b.close();
