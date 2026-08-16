/**
 * What does spawning a wave actually allocate?
 *
 * Frame TIMINGS headless are software-rasteriser fiction and are ignored here.
 * What is machine-independent, and what this measures, is COUNTS — how many
 * textures, programs and geometries a wave adds to the GPU — plus the CPU cost
 * of the spawn call itself, which for a procedurally drawn enemy is real canvas
 * work that happens on any machine.
 *
 * A count that grows with the number of bodies is the bug. A count that grows
 * once and then flattens is a cache doing its job.
 *
 *   node tools/spawn-cost.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message.split('\n')[0]));
await p.goto('http://127.0.0.1:5181/?map=miami&menu=0&q=high', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(2500);

const rows = await p.evaluate(async () => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');
  const info = () => {
    const i = ctx.peek('render').renderer.info;
    return { tex: i.memory.textures, geo: i.memory.geometries, prog: i.programs?.length ?? 0 };
  };
  const clearAll = () => {
    for (const a of ai.agents ?? []) {
      a.alive = false;
      try {
        a.dispose?.();
      } catch {}
    }
    if (ai.agents) ai.agents.length = 0;
  };

  const out = [];
  // Draw one frame between rounds so anything lazy has been forced already.
  const settle = () => {
    let t = performance.now();
    for (let i = 0; i < 4; i++) e.step((t += 16.6));
  };

  for (const variant of ['flatty', 'ghoul']) {
    // Round 1 pays for whatever is genuinely one-off; round 2 and 3 are the
    // ones that matter, because in a real game every wave after the first is
    // a "round 2".
    for (let round = 1; round <= 3; round++) {
      clearAll();
      settle();
      const a0 = info();
      const t0 = performance.now();
      ai.populate({ squads: 3, perSquad: 4, variants: [variant] });
      const spawnMs = performance.now() - t0;
      settle();
      const a1 = info();
      out.push({
        variant,
        round,
        bodies: (ai.agents ?? []).filter((x) => x.alive).length,
        spawnMs: +spawnMs.toFixed(1),
        dTex: a1.tex - a0.tex,
        dGeo: a1.geo - a0.geo,
        dProg: a1.prog - a0.prog,
      });
    }
  }

  // And the pickups, which also build a mesh + material each.
  const ps = ctx.peek('perks');
  const pk = [];
  for (let round = 1; round <= 3; round++) {
    const a0 = info();
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) ps.spawnChest?.(ctx.peek("player").position, "ammo");
    const ms = performance.now() - t0;
    settle();
    const a1 = info();
    pk.push({ round, ms: +ms.toFixed(1), dTex: a1.tex - a0.tex, dGeo: a1.geo - a0.geo, dProg: a1.prog - a0.prog });
  }

  return { out, pk };
});

await b.close();

console.log('wave spawn (3 squads x 4):');
console.log('  variant  round  bodies  spawn ms   +tex  +geo  +prog');
for (const r of rows.out) {
  console.log(
    `  ${r.variant.padEnd(8)} ${String(r.round).padStart(5)} ${String(r.bodies).padStart(7)} ` +
      `${String(r.spawnMs).padStart(9)}   ${String(r.dTex).padStart(4)} ${String(r.dGeo).padStart(5)} ${String(r.dProg).padStart(6)}`
  );
}
console.log('\n10 pickups:');
console.log('  round     ms   +tex  +geo  +prog');
for (const r of rows.pk) {
  console.log(
    `  ${String(r.round).padStart(5)} ${String(r.ms).padStart(6)}   ${String(r.dTex).padStart(4)} ${String(r.dGeo).padStart(5)} ${String(r.dProg).padStart(6)}`
  );
}

const flatSteady = rows.out.filter((r) => r.variant === 'flatty' && r.round > 1);
const bad = [];
for (const r of flatSteady) if (r.dTex > 0) bad.push(`flatty round ${r.round} still uploads ${r.dTex} textures`);
for (const r of rows.pk.slice(1)) if (r.dGeo > 0) bad.push(`pickups round ${r.round} still uploads ${r.dGeo} geometries`);
console.log(bad.length ? `\nFAIL: ${bad.join('; ')}` : '\nok — steady-state waves allocate nothing');
