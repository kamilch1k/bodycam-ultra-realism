/**
 * What a FIREFIGHT costs per frame, by subsystem.
 *
 * The approach hitch allocates nothing — no geometry, no textures, no shader
 * programs, and draw calls stay flat. So it is not construction; it is work.
 * This counts the three things that scale when enemies engage: Web Audio graph
 * operations, physics raycasts, and voices built.
 *
 * Enemy gunfire is the prime suspect. The voice bake deliberately covers only
 * the first-person shot, because `weaponShot` rebalances its layers by range and
 * a buffer baked at zero metres is dishonest at fifty. That left every ENEMY
 * shot on the 547-operation procedural path — fine when they are a few voices a
 * second across the map, potentially not fine with six of them shooting at you.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5181/?map=swat&menu=0';
const FRAMES = Number(process.argv[3] ?? 300);

const b = await chromium.launch({
  headless: true,
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });

await p.addInitScript(() => {
  window.__AC__ = { total: 0 };
  const proto = (globalThis.BaseAudioContext ?? globalThis.AudioContext)?.prototype;
  if (proto) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      if (!k.startsWith('create') || typeof proto[k] !== 'function') continue;
      const orig = proto[k];
      proto[k] = function (...a) {
        window.__AC__.total++;
        return orig.apply(this, a);
      };
    }
  }
  const ap = globalThis.AudioNode?.prototype;
  if (ap) {
    const oc = ap.connect;
    ap.connect = function (...a) {
      window.__AC__.total++;
      return oc.apply(this, a);
    };
  }
});

await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 240000 });
await p.mouse.click(640, 360);
await p.waitForFunction(() => window.__AUDIO__?.running === true, null, { timeout: 20000 }).catch(() => {});
// Let the bake land so it is not counted as firefight cost.
await p.waitForFunction(() => window.__AUDIO__?.voiceBank?.banks?.size >= 7, null, { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(500);

const r = await p.evaluate(
  ({ N }) =>
    new Promise((done) => {
      const e = window.__ENGINE__;
      const ai = e.ctx.peek('ai');
      const phys = e.ctx.peek('physics');
      const audio = window.__AUDIO__;
      const player = e.ctx.peek('player');

      // Count raycasts and voice builds without changing behaviour.
      let rays = 0;
      if (phys?.raycast) {
        const o = phys.raycast.bind(phys);
        phys.raycast = (...a) => {
          rays++;
          return o(...a);
        };
      }
      const kinds = {};
      if (audio?._build) {
        const o = audio._build.bind(audio);
        audio._build = (k, ...a) => {
          kinds[k] = (kinds[k] ?? 0) + 1;
          return o(k, ...a);
        };
      }

      const target = ai?.agents?.find((a) => a.alive);
      const start = { x: player.position.x, y: player.position.y, z: player.position.z };
      const a0 = window.__AC__.total;
      const r0 = 0;
      let i = 0;
      const phase = { far: { ac: 0, rays: 0 }, near: { ac: 0, rays: 0 } };
      let lastAc = a0;
      let lastRays = 0;

      const tick = () => {
        const k = i / (N - 1);
        if (target) {
          const dx = target.position.x - start.x;
          const dz = target.position.z - start.z;
          const d = Math.hypot(dx, dz) || 1;
          const stop = Math.max(0, d - 3) / d;
          const px = start.x + dx * stop * k;
          const pz = start.z + dz * stop * k;
          if (player.setPosition) player.setPosition(px, start.y, pz);
          else player.position.set(px, start.y, pz);
          e.ctx.camera?.lookAt?.(target.position.x, target.position.y + 1.2, target.position.z);
        }
        const bucket = k < 0.5 ? phase.far : phase.near;
        bucket.ac += window.__AC__.total - lastAc;
        bucket.rays += rays - lastRays;
        lastAc = window.__AC__.total;
        lastRays = rays;

        if (++i >= N) {
          done({
            frames: N,
            audioOps: window.__AC__.total - a0,
            rays: rays - r0,
            kinds,
            phase,
            alive: ai?.agents?.filter((x) => x.alive).length ?? 0,
          });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
  { N: FRAMES }
);

const half = r.frames / 2;
console.log(`frames ${r.frames}   enemies alive ${r.alive}`);
console.log(`\n                      far half     near half`);
console.log(
  `audio graph ops   ${String(r.phase.far.ac).padStart(10)}  ${String(r.phase.near.ac).padStart(12)}` +
    `   (${(r.phase.far.ac / half).toFixed(1)} vs ${(r.phase.near.ac / half).toFixed(1)} per frame)`
);
console.log(
  `physics raycasts  ${String(r.phase.far.rays).padStart(10)}  ${String(r.phase.near.rays).padStart(12)}` +
    `   (${(r.phase.far.rays / half).toFixed(1)} vs ${(r.phase.near.rays / half).toFixed(1)} per frame)`
);
console.log('\nvoices built during approach:');
for (const [k, v] of Object.entries(r.kinds).sort((a, c) => c[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(5)}`);
}
await b.close();
