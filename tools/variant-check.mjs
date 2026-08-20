/**
 * Every enemy variant must build, move and be killable.
 *
 * A variant is data, so a typo in one does not fail the build — it throws the
 * first time a wave happens to roll that body, which in a horde mode means it
 * ships and then explodes on wave 4 in front of a player. This spawns each one
 * deliberately and confirms it exists, has the stats it claims, and dies.
 *
 *   node tools/variant-check.mjs
 */
import { chromium } from 'playwright';

const WANT = ['ghoul', 'runt', 'brute', 'flatty'];

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});

await p.goto('http://127.0.0.1:5181/?map=miami&menu=0&q=high', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(2000);

const rows = await p.evaluate(async (want) => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');
  const render = ctx.peek('render');
  const realRender = render.render;
  render.render = () => {};
  const out = [];

  /**
   * Despawn everything between variants.
   *
   * `clearAll` lives on the MODE, not on the ai system, so calling it here was
   * a silent no-op and bodies piled up across variants — which is why the first
   * run reported twelve ghouls from a six-body populate and then zero runts.
   * Same teardown the mode does.
   */
  const clearAll = () => {
    for (const a of ai.agents ?? []) {
      a.alive = false;
      try {
        a.dispose?.();
      } catch {
        /* a body that will not despawn must not stop the next variant */
      }
    }
    if (ai.agents) ai.agents.length = 0;
  };

  for (const v of want) {
    clearAll();
    const made = ai.populate({ squads: 2, perSquad: 3, variants: [v] });
    let t = performance.now();
    for (let i = 0; i < 240; i++) e.step((t += 16.6));

    // BY VARIANT, not live[0]: the level's garrison is still standing around,
    // and measuring one of those instead of the requested body is exactly how
    // an earlier pass "proved" ghouls do not rush.
    const live = (ai.agents ?? []).filter((x) => x.alive && x.variantName === v);
    const a = live[0];
    const row = { v, spawned: live.length, made };
    if (a) {
      row.hp = a.maxHealth;
      row.rush = !!a.rush;
      row.rushSpeed = a.rushSpeed;
      // A billboard hides the skinned mesh and adds a sprite in its place.
      row.flat = !!a.billboard;
      row.meshHidden = a.mesh ? !a.mesh.visible : null;
      // Did it actually move under its own steam?
      const p0 = a.position.clone();
      for (let i = 0; i < 300; i++) e.step((t += 16.6));
      row.moved = +a.position.distanceTo(p0).toFixed(1);
      // And can it be killed without throwing?
      try {
        a.die?.(null, null, 30);
        row.dies = !a.alive;
      } catch (err) {
        row.dies = 'THREW: ' + err.message;
      }
    }
    out.push(row);
  }
  render.render = realRender;
  return out;
}, WANT);

await b.close();

const bad = [];
for (const r of rows) {
  if (!r.spawned) bad.push(`${r.v}: nothing spawned`);
  else if (r.dies !== true) bad.push(`${r.v}: death ${r.dies}`);
  else if (!(r.moved > 1)) bad.push(`${r.v}: moved only ${r.moved}m`);
  if (r.v === 'flatty' && !(r.flat && r.meshHidden)) {
    bad.push(`flatty: sprite=${r.flat} rigHidden=${r.meshHidden} — expected both`);
  }
}

for (const r of rows) {
  console.log(
    `  ${r.v.padEnd(7)} x${r.spawned}(made ${r.made})  hp ${String(r.hp).padStart(3)}  ` +
      `rush ${r.rush ? r.rushSpeed : '-'}  moved ${r.moved}m  ` +
      `${r.flat ? 'FLAT ' : ''}dies ${r.dies}`
  );
}
if (errors.length) console.log(`\npage errors (${errors.length}):\n  ` + errors.slice(0, 6).join('\n  '));
console.log(bad.length ? `\nFAIL: ${bad.join('; ')}` : '\nok — all variants build, move and die');
process.exit(bad.length || errors.length ? 1 : 0);
