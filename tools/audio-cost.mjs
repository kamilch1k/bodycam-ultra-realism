/**
 * Count the Web Audio nodes a gunshot builds.
 *
 * The noise buffers are baked once at construction, so runtime synthesis was
 * never the cost — but every shot still assembles a voice out of fresh nodes,
 * and node construction is main-thread work that shows up nowhere in
 * renderer.info and nowhere in usedJSHeapSize (audio backing stores live outside
 * the JS heap, which is why an earlier flat-heap reading did not clear audio).
 *
 * `--autoplay-policy=no-user-gesture-required` matters: without a gesture an
 * AudioContext stays suspended, the voices never build, and this would measure
 * a silent game and report zero.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=swat&menu=0';
const FRAMES = Number(process.argv[3] ?? 200);

const b = await chromium.launch({
  headless: true,
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });

// Instrument before any app code runs.
await p.addInitScript(() => {
  window.__AUDIO_COUNTS__ = {};
  const proto = (globalThis.BaseAudioContext ?? globalThis.AudioContext)?.prototype;
  if (!proto) return;
  for (const k of Object.getOwnPropertyNames(proto)) {
    if (!k.startsWith('create')) continue;
    const orig = proto[k];
    if (typeof orig !== 'function') continue;
    proto[k] = function (...a) {
      window.__AUDIO_COUNTS__[k] = (window.__AUDIO_COUNTS__[k] ?? 0) + 1;
      return orig.apply(this, a);
    };
  }
  // connect() is the other per-voice cost and is not a create* call.
  const ap = globalThis.AudioNode?.prototype;
  if (ap) {
    const oc = ap.connect;
    ap.connect = function (...a) {
      window.__AUDIO_COUNTS__.connect = (window.__AUDIO_COUNTS__.connect ?? 0) + 1;
      return oc.apply(this, a);
    };
  }
});

await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 240000 });

/**
 * A REAL click, not a queued input code. The audio graph is built on the first
 * user gesture and `input._pendingDown` is not one — an earlier run of this
 * probe fired 31 shots and counted zero audio operations, which looked like
 * "audio is free" and actually meant "audio never started".
 */
await p.mouse.click(640, 360);
await p.waitForFunction(
  () => {
    const a = window.__ENGINE__?.ctx?.peek('audio');
    return !!a?.actx && a.actx.state === 'running';
  },
  null,
  { timeout: 15000 }
).catch(() => console.log('WARNING: audio graph never reached "running"'));
await p.waitForTimeout(1500);

const r = await p.evaluate(
  ({ N }) =>
    new Promise((done) => {
      const e = window.__ENGINE__;
      const inp = e.ctx.input;
      const actx = e.ctx.peek('audio')?.actx ?? e.ctx.peek('audio')?.ctx ?? null;
      const snap = () => JSON.parse(JSON.stringify(window.__AUDIO_COUNTS__ ?? {}));
      const before = snap();
      let shots = 0;
      const offFire = e.events.on('weapon:fire', () => shots++);
      let i = 0;
      const tick = () => {
        if (i === 10) inp._pendingDown.add('Mouse0');
        if (i === N - 40) inp._pendingUp.add('Mouse0');
        if (++i >= N) {
          offFire?.();
          const after = snap();
          const delta = {};
          for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
            const d = (after[k] ?? 0) - (before[k] ?? 0);
            if (d) delta[k] = d;
          }
          done({ delta, shots, state: actx?.state ?? 'unknown' });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
  { N: FRAMES }
);

console.log(`audio context state: ${r.state}   shots fired: ${r.shots}`);
if (!r.shots) {
  console.log('NO SHOTS — the trigger path did not fire; this measurement is void.');
} else {
  const total = Object.values(r.delta).reduce((a, x) => a + x, 0);
  console.log(`\nWeb Audio operations during ${r.shots} shots:`);
  for (const [k, v] of Object.entries(r.delta).sort((a, c) => c[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(6)}   ${(v / r.shots).toFixed(1)} per shot`);
  }
  console.log(`  ${'TOTAL'.padEnd(28)} ${String(total).padStart(6)}   ${(total / r.shots).toFixed(1)} per shot`);
}
await b.close();
