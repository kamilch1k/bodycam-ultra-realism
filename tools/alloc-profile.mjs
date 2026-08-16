/**
 * WHO allocates during play, by function, via Chrome's sampling heap profiler.
 *
 * Measured at ~870 KB per frame with GC running on half of all frames, which at
 * 60 fps is ~52 MB/s of garbage. That is the "outside" time in the hitch log:
 * frames with almost no JavaScript cost and no GPU allocation, where the
 * collector stopped the world. Frame TIMINGS here are fiction, but allocation
 * volume and its call stacks are ordinary deterministic JS and read the same on
 * any machine.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=holdout&menu=0';
const SECONDS = Number(process.argv[3] ?? 20);

const b = await chromium.launch({
  headless: true,
  args: ['--mute-audio', '--enable-precise-memory-info'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(1500);

const cdp = await p.context().newCDPSession(p);
await cdp.send('HeapProfiler.enable');
// 8 KB interval: fine enough to attribute a per-frame allocator, coarse enough
// not to distort the run.
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192 });

await p.evaluate(
  (secs) =>
    new Promise((done) => {
      const inp = window.__ENGINE__.ctx.input;
      const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
      let held = null;
      const t0 = performance.now();
      const tick = () => {
        const t = performance.now() - t0;
        const w = keys[Math.floor(t / 1000) % 4];
        if (w !== held) {
          if (held) inp._pendingUp.add(held);
          inp._pendingDown.add(w);
          held = w;
        }
        if (t % 800 < 16) inp._pendingDown.add('Mouse0');
        else if (t % 800 > 350 && t % 800 < 366) inp._pendingUp.add('Mouse0');
        inp._rawLook.x += 4;
        if (t > secs * 1000) {
          if (held) inp._pendingUp.add(held);
          inp._pendingUp.add('Mouse0');
          done();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
  SECONDS
);

const { profile } = await cdp.send('HeapProfiler.stopSampling');

const totals = new Map();
let grand = 0;
const walk = (node) => {
  const f = node.callFrame ?? {};
  const file = String(f.url || '').split('/').pop() || '(native)';
  const name = f.functionName || '(anonymous)';
  const key = `${name}  ${file}:${f.lineNumber ?? '?'}`;
  const self = node.selfSize ?? 0;
  if (self > 0) {
    totals.set(key, (totals.get(key) ?? 0) + self);
    grand += self;
  }
  for (const c of node.children ?? []) walk(c);
};
walk(profile.head);

const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log(`total sampled: ${(grand / 1048576).toFixed(1)} MB over ${SECONDS}s of play\n`);
console.log(`${'KB'.padStart(9)}  ${'%'.padStart(5)}  function`);
console.log('-'.repeat(72));
for (const [key, bytes] of rows) {
  const pct = ((bytes / grand) * 100).toFixed(1);
  console.log(`${(bytes / 1024).toFixed(0).padStart(9)}  ${pct.padStart(5)}  ${key}`);
}
await b.close();
