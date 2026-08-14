/**
 * Drive both modes through a full cycle.
 *
 * A mode that boots proves nothing — the interesting states are the transitions:
 * squad cleared -> round scored -> next round populated, and player killed ->
 * round lost -> player back on their feet rather than stuck dead. Both are
 * reachable by killing the agents directly and stepping frames, so neither needs
 * a GPU or a human.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5181/';
const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
let bad = 0;
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
  if (!c) bad++;
};

for (const [mode, map] of [
  ['strike', 'strike'],
  ['horde', 'holdout'],
]) {
  console.log(`\n--- ${mode} ---`);
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await p.goto(`${BASE}?map=${map}&mode=${mode}&menu=0`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 240000 });
  await p.waitForTimeout(1200);

  const r = await p.evaluate(
    ({ mode }) =>
      new Promise((done) => {
        const e = window.__ENGINE__;
        const ai = e.ctx.peek('ai');
        const m = e.ctx.peek('mode')?.mode;
        if (!m) return done({ error: 'no mode object' });

        const out = { start: { ...e.ctx.match }, steps: [] };
        const killAll = () => {
          for (const a of ai.agents) {
            if (!a.alive) continue;
            try {
              a.kill?.({ damage: 999 }) ?? a.die?.();
            } catch {
              a.alive = false;
            }
            a.alive = false;
          }
        };

        let frame = 0;
        const tick = () => {
          // Wipe the squad on frame 5, then let the break elapse and the next
          // round populate; 4 s of break at 60 fps is ~240 frames.
          if (frame === 5) killAll();
          if (frame === 10) out.afterKill = { ...e.ctx.match, alive: ai.agents.filter((a) => a.alive).length };
          if (frame === 400) {
            out.afterBreak = { ...e.ctx.match, alive: ai.agents.filter((a) => a.alive).length };
            // Now test the death path.
            const pl = e.ctx.peek('player');
            out.hadPlayer = !!pl;
            // applyDamage, not `pl.health = 0`: health is a Health object and
            // assigning a number to it destroys the subsystem.
            if (pl) pl.applyDamage?.(9999, null, { source: 'test' });
          }
          if (frame === 420) {
            const pl = e.ctx.peek('player');
            out.afterDeath = { ...e.ctx.match, dead: !!pl?.dead, frac: pl?.healthFraction ?? null };
          }
          if (++frame >= 440) return done(out);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { mode }
  );

  if (r.error) {
    ok(false, `${mode}: ${r.error}`);
  } else {
    ok(r.start.mode === (mode === 'strike' ? 'STRIKE' : 'HOLDOUT'), `${mode}  match bar labelled ${r.start.mode}`);
    ok(r.afterKill?.alive === 0, `${mode}  squad cleared (alive ${r.afterKill?.alive})`);
    ok((r.afterBreak?.alive ?? 0) > 0, `${mode}  next round repopulated (alive ${r.afterBreak?.alive})`);
    if (mode === 'strike') {
      ok(r.afterBreak?.scoreUs >= 1, `strike  round scored (us ${r.afterBreak?.scoreUs})`);
      ok(r.afterDeath?.scoreThem >= 1, `strike  death scores for them (them ${r.afterDeath?.scoreThem})`);
    } else {
      ok(r.afterBreak?.scoreUs >= 2, `horde   wave advanced (wave ${r.afterBreak?.scoreUs})`);
      ok(r.afterDeath?.scoreUs === 1, `horde   death resets to wave 1 (wave ${r.afterDeath?.scoreUs})`);
    }
    ok(r.afterDeath?.dead === false, `${mode}  player revived (dead ${r.afterDeath?.dead}, hp ${r.afterDeath?.frac})`);
  }
  ok(errors.length === 0, `${mode}  no console errors${errors.length ? `: ${errors[0].slice(0, 80)}` : ''}`);
  await p.close();
}

await b.close();
console.log(bad ? `\n${bad} check(s) FAILED` : '\nboth modes cycle correctly');
process.exit(bad ? 1 : 0);
