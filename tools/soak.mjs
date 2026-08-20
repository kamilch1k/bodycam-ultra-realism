/**
 * Does anything grow without bound over a long run?
 *
 * The harsh stutter turned out to be a leak — geometries and materials
 * allocated per pickup and never freed — and the reason it read as "stutters
 * are back" rather than "one hitch" is that a leak gets worse the longer you
 * play. A single wave looks fine in every other test; only duration exposes it.
 *
 * So this plays properly: many waves, kills, drops, levels, deaths and
 * respawns, sampling the GPU object counts throughout. Counts are the right
 * measure because they are machine-independent — headless frame times are
 * software-raster fiction, but a geometry count that climbs for twenty waves
 * climbs on the player's machine too.
 *
 * The verdict is the SLOPE over the back half. Early growth is caches filling,
 * which is fine and expected; growth that is still going at wave 20 is a leak.
 *
 *   node tools/soak.mjs [waves]
 */
import { chromium } from 'playwright';

const WAVES = Number(process.argv[2] ?? 20);

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 506 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 160));
});
await p.goto('http://127.0.0.1:5181/?map=miami&menu=0&q=high', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(2500);

const out = await p.evaluate(async (waves) => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');
  const perks = ctx.perks;
  const render = ctx.peek('render');

  // Drawing stubbed: this is about what is ALLOCATED, and 20 waves of software
  // rasterisation would take an hour. Allocation happens on spawn/kill paths
  // that do not read a pixel.
  const real = render.render;
  render.render = () => {};

  const info = () => {
    const i = render.renderer.info;
    return {
      tex: i.memory.textures,
      geo: i.memory.geometries,
      prog: i.programs?.length ?? 0,
      // Scene node count catches anything added and never removed even when it
      // shares its geometry — a leak of Object3Ds rather than of GPU objects.
      nodes: (() => {
        let n = 0;
        ctx.scene.traverse(() => n++);
        return n;
      })(),
    };
  };

  const samples = [];
  let t = performance.now();
  const run = (frames) => {
    for (let i = 0; i < frames; i++) e.step((t += 16.6));
  };

  run(30);
  samples.push({ wave: 0, ...info(), kills: perks.kills, level: perks.plevel });

  /**
   * Clear the dead between waves, exactly as HordeMode.begin does.
   *
   * Calling populate() directly skips the mode, and the mode is what despawns
   * corpses — so without this the soak reports a corpse pile that the real game
   * never accumulates, and blames the game for the harness. Bodies ARE the bulk
   * of the per-wave node churn, so getting this wrong makes every other number
   * unreadable.
   */
  const clearDead = () => {
    const live = [];
    for (const a of ai.agents ?? []) {
      if (a.alive) live.push(a);
      else
        try {
          a.dispose?.();
        } catch {}
    }
    if (ai.agents) ai.agents.length = 0;
    if (ai.agents) ai.agents.push(...live);
  };

  for (let w = 1; w <= waves; w++) {
    // A wave: spawn, let them close, kill them all, let drops settle and be
    // collected, then the next one. This is the real cycle, not a synthetic one.
    clearDead();
    ai.populate({ squads: 3, perSquad: 4, variants: ['ghoul', 'runt', 'flatty'] });
    run(60);
    for (const a of (ai.agents ?? []).filter((x) => x.alive)) a.die?.(null, null, 30);
    run(90);
    samples.push({ wave: w, ...info(), kills: perks.kills, level: perks.plevel });
  }

  render.render = real;
  return { samples, pickupsLeft: ctx.peek('perks')?.chests?.length ?? 0 };
}, WAVES);

await b.close();

const s = out.samples;
console.log('  wave   textures  geometries  programs   nodes   kills  lvl');
for (const x of s) {
  if (x.wave % Math.max(1, Math.round(WAVES / 10)) === 0 || x.wave === WAVES) {
    console.log(
      `  ${String(x.wave).padStart(4)}   ${String(x.tex).padStart(8)}  ${String(x.geo).padStart(10)}` +
        `  ${String(x.prog).padStart(8)}  ${String(x.nodes).padStart(6)}  ${String(x.kills).padStart(6)}  ${String(x.level).padStart(3)}`
    );
  }
}

// Slope over the back half only: the front half is caches filling, which is
// growth that stops. A leak is growth that does not.
const half = s.slice(Math.floor(s.length / 2));
const slope = (key) => {
  const a = half[0][key];
  const z = half[half.length - 1][key];
  return (z - a) / Math.max(1, half.length - 1);
};
const per = { textures: slope('tex'), geometries: slope('geo'), programs: slope('prog'), nodes: slope('nodes') };

console.log('\ngrowth per wave over the back half (0 = stable):');
for (const [k, v] of Object.entries(per)) console.log(`  ${k.padEnd(12)} ${v >= 0 ? '+' : ''}${v.toFixed(2)}`);
console.log(`\nuncollected pickups still on the map: ${out.pickupsLeft}`);

const bad = [];
for (const [k, v] of Object.entries(per)) if (v > 0.5) bad.push(`${k} still growing ${v.toFixed(2)}/wave`);
if (errors.length) console.log(`\npage errors (${errors.length}):\n  ` + errors.slice(0, 5).join('\n  '));
console.log(bad.length ? `\nFAIL: ${bad.join('; ')}` : `\nok — nothing grows over ${WAVES} waves`);
process.exit(bad.length ? 1 : 0);
