/**
 * Can the player still shoot, aim and move after boot?
 *
 * Added because a prewarm change left `weapons.debugMode = 'idle'` behind, and
 * `WeaponSystem.update` gates every live input on `debugMode === null`. Firing
 * and aiming were dead for the entire session, the game booted perfectly, every
 * other probe passed, and nothing caught it — the shader probes count programs,
 * the map probes count triangles, and none of them pull the trigger.
 *
 * So this asserts the controls themselves: state that must be clean after boot,
 * and behaviour that must actually happen when the input says so.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=holdout&menu=0';
const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 300000 });
await p.waitForTimeout(1500);

const r = await p.evaluate(
  () =>
    new Promise((done) => {
      const e = window.__ENGINE__;
      const ctx = e.ctx;
      const wp = ctx.peek('weapons');
      const pl = ctx.peek('player');
      const inp = ctx.input;

      const out = {
        // `null ?? x` yields x — read the field directly or null reads as absent.
        debugMode: wp ? wp.debugMode : 'NO WEAPON SYSTEM',
        inputFrozen: !!inp?.frozen,
        inputEnabled: inp?.enabled !== false,
        controlEnabled: pl?.controlEnabled !== false,
        timeScale: ctx.time.scale,
        health: pl?.health?.value ?? null,
        maxHealth: pl?.health?.max ?? null,
        ammoBefore: wp?.ammo?.mag ?? null,
        ammoAfter: null,
        adsReached: 0,
        touchMode: !!ctx.input?.touchMode,
        assistEnabled: !!pl?.assist?.enabled,
        moved: 0,
      };

      const start = pl?.position ? { x: pl.position.x, z: pl.position.z } : null;
      let i = 0;
      const tick = () => {
        // hold fire for 30 frames, then aim for 30, then walk forward for 30
        if (i === 2) inp._pendingDown.add('Mouse0');
        if (i === 32) {
          inp._pendingUp.add('Mouse0');
          inp._pendingDown.add('Mouse2');
        }
        if (i === 62) {
          inp._pendingUp.add('Mouse2');
          inp._pendingDown.add('KeyW');
        }
        if (i > 32 && i < 62) out.adsReached = Math.max(out.adsReached, pl?.adsAmount ?? 0);
        if (++i >= 95) {
          inp._pendingUp.add('KeyW');
          out.ammoAfter = wp?.ammo?.mag ?? null;
          if (start && pl?.position) {
            out.moved = Math.hypot(pl.position.x - start.x, pl.position.z - start.z);
          }
          done(out);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })
);

/**
 * The three guards against a hitch turning into a teleport or a spin. These are
 * pure logic, so unlike frame timings they mean exactly the same thing headless
 * as they do on real hardware — call the methods directly rather than trying to
 * stage a real stall.
 */
const guards = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const inp = e.ctx.input;
  inp.enabled = true;
  inp.frozen = false;

  // 1. an absurd pointer delta must not become an absurd rotation
  const clampedBefore = inp.lookClamped;
  inp._rawLook.x = 500000;
  inp._rawLook.y = 0;
  inp.beginFrame();
  const spikeRad = Math.abs(inp.look.x);
  const spikeClamped = inp.lookClamped > clampedBefore;

  // 2. the first move after a lock is the browser's centring jump — drop it
  inp.pointerLocked = true;
  inp._freshLock = true;
  inp._rawLook.x = 0;
  inp._onMouseMove({ movementX: 4000, movementY: 0 });
  const lockDropped = inp._rawLook.x === 0;
  inp._onMouseMove({ movementX: 10, movementY: 0 });
  const lockThenAccepts = inp._rawLook.x === 10;
  inp._rawLook.x = 0;

  // 3. a five-second stall must not be simulated as five seconds
  e.step(performance.now() + 5000);
  const stallDt = e.time.dt;
  const stallSteps = e.time.steps;

  return { spikeRad, spikeClamped, lockDropped, lockThenAccepts, stallDt, stallSteps };
});

const checks = [
  ['weapons.debugMode is null', r.debugMode === null, r.debugMode],
  ['input not frozen', !r.inputFrozen, r.inputFrozen],
  ['input enabled', r.inputEnabled, r.inputEnabled],
  ['player control enabled', r.controlEnabled, r.controlEnabled],
  ['time.scale is 1', r.timeScale === 1, r.timeScale],
  ['health restored to full', r.health === r.maxHealth, `${r.health}/${r.maxHealth}`],
  ['FIRING consumed ammo', r.ammoAfter !== null && r.ammoAfter < r.ammoBefore, `${r.ammoBefore} -> ${r.ammoAfter}`],
  ['AIMING raised ads', r.adsReached > 0.3, r.adsReached?.toFixed?.(2)],
  ['MOVING changed position', r.moved > 0.5, r.moved?.toFixed?.(2)],
  // The assist must be OFF on a desktop: applied to a mouse it swings the view.
  ['aim assist off on desktop', r.assistEnabled === false, r.assistEnabled],
  ['touch mode off on desktop', r.touchMode === false, r.touchMode],
  // 500k counts unclamped would be ~1100 radians of yaw in a single frame. The
  // clamp is a RATE, so a 60 Hz frame allows ~1.2 rad (69 degrees) — well under
  // the pitch limit, which a swing this size used to reach in one frame.
  ['look spike clamped', guards.spikeClamped && guards.spikeRad <= 1.3, `${guards.spikeRad.toFixed(2)} rad`],
  ['first move after lock dropped', guards.lockDropped, guards.lockDropped],
  ['later moves still accepted', guards.lockThenAccepts, guards.lockThenAccepts],
  ['5s stall clamped to <=50ms', guards.stallDt <= 0.0501, `${(guards.stallDt * 1000).toFixed(1)}ms`],
  ['stall stays under substep cap', guards.stallSteps < 8, `${guards.stallSteps} steps`],
];

let bad = 0;
for (const [name, ok, val] of checks) {
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} ${val}`);
}
console.log(bad ? `\n${bad} FAILED` : '\ncontrols are live after boot');
await b.close();
process.exit(bad ? 1 : 0);
