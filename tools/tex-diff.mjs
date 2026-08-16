/**
 * WHICH textures does a wave upload?
 *
 * spawn-cost.mjs says ghouls add four every wave forever; this says what they
 * are. Counting is enough to know there is a leak, but not enough to fix one —
 * `info.memory.textures` is a single number with no names attached, so this
 * walks the live scene graph before and after and diffs the actual objects,
 * reporting the owning material and mesh for anything new.
 *
 *   node tools/tex-diff.mjs [variant]
 */
import { chromium } from 'playwright';

const VARIANT = process.argv[2] ?? 'ghoul';

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message.split('\n')[0]));
await p.goto('http://127.0.0.1:5181/?map=miami&menu=0&q=high', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(2500);

const out = await p.evaluate(async (variant) => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');

  const snap = () => {
    const found = new Map(); // uuid -> description
    ctx.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture) {
            found.set(v.uuid, `${o.name || o.type}.${m.name || m.type}.${k} ${v.image?.width ?? '?'}px`);
          }
        }
        // Extension uniforms hold textures too, and they are the ones a plain
        // material-property walk misses.
        const u = m.userData?.owUniforms;
        for (const k of Object.keys(u ?? {})) {
          const v = u[k]?.value;
          if (v && v.isTexture) found.set(v.uuid, `${o.name || o.type}.uniform:${k}`);
        }
      }
    });
    return found;
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
  const settle = () => {
    let t = performance.now();
    for (let i = 0; i < 4; i++) e.step((t += 16.6));
  };

  const rounds = [];
  for (let r = 1; r <= 3; r++) {
    clearAll();
    settle();
    const before = snap();
    ai.populate({ squads: 3, perSquad: 4, variants: [variant] });
    settle();
    const after = snap();
    const added = [];
    for (const [uuid, desc] of after) if (!before.has(uuid)) added.push(desc);
    rounds.push({
      round: r,
      sceneBefore: before.size,
      sceneAfter: after.size,
      added: added.slice(0, 8),
      addedCount: added.length,
      gpu: ctx.peek('render').renderer.info.memory.textures,
      /**
       * The uuids themselves, because "+21 textures" is not by itself a leak.
       * Despawning takes the bodies out of the scene, so a CACHED texture
       * legitimately looks new when the next wave puts it back — the only way
       * to tell a cache from a rebuild is whether the same OBJECTS come back,
       * which means comparing identity across rounds rather than within one.
       */
      uuids: [...after.keys()].filter((u) => !before.has(u)),
    });
  }
  return rounds;
}, VARIANT);

await b.close();

console.log(`variant: ${VARIANT}`);
for (const r of out) {
  console.log(
    `\n  round ${r.round}: scene textures ${r.sceneBefore} -> ${r.sceneAfter}` +
      `  (+${r.addedCount})   gpu total ${r.gpu}`
  );
  for (const d of r.added) console.log(`      + ${d}`);
}
// Identity across rounds is the actual verdict.
for (let i = 1; i < out.length; i++) {
  const prev = new Set(out[i - 1].uuids);
  const reused = out[i].uuids.filter((u) => prev.has(u)).length;
  const fresh = out[i].uuids.length - reused;
  console.log(
    `\n  round ${i} -> ${i + 1}: ${reused} of ${out[i].uuids.length} textures REUSED, ${fresh} rebuilt` +
      `   (gpu ${out[i - 1].gpu} -> ${out[i].gpu})`
  );
}
const last = out[out.length - 1];
const prev = new Set(out[out.length - 2].uuids);
const rebuilt = last.uuids.filter((u) => !prev.has(u)).length;
console.log(
  rebuilt
    ? `\nFAIL: a steady-state wave rebuilds ${rebuilt} textures that should be cached`
    : '\nok — every wave reuses the same texture objects'
);
