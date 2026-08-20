/**
 * Does the survivors loop actually run in the game?
 *
 * progression-check.mjs proves the arithmetic; this proves the WIRING — that a
 * body dying reaches the perk system, that the card appears, that a pickup can
 * be walked onto and does something. Those are four separate systems talking
 * through events, and every one of them can be individually correct while the
 * chain is broken.
 *
 * Frames are pumped by hand rather than left to rAF: headless has no GPU and
 * runs about 2 fps, so a "30 second" test would be 60 frames. See warp-check.
 *
 *   node tools/play-check.mjs [map]
 */
import { chromium } from 'playwright';

const MAP = process.argv[2] ?? 'miami';

const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 506 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await p.goto(`http://127.0.0.1:5181/?map=${MAP}&menu=0&q=high`, {
  waitUntil: 'domcontentloaded',
});
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 600000 });
await p.waitForTimeout(2500);

const out = await p.evaluate(async () => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const perks = ctx.perks;
  const ai = ctx.peek('ai');
  const r = { steps: [] };

  r.hasPerks = !!perks;
  r.hasPanel = !!document.querySelector('.ow-surv');
  r.startLevel = perks?.plevel;

  // --- kills must feed XP -------------------------------------------------
  // Kill real agents rather than faking the event, so the whole path is
  // exercised: agent.die -> actor:death -> PerkSystem -> Perks.addXp.
  ai?.populate?.({ squads: 3, perSquad: 5, variants: ['ghoul'] });
  for (let i = 0; i < 4; i++) e.step(performance.now() + 16 * i);

  const before = perks.kills;
  const victims = (ai.agents ?? []).filter((a) => a.alive).slice(0, 8);
  for (const a of victims) a.die?.(null, null, 30);
  for (let i = 0; i < 6; i++) e.step(performance.now() + 100 + 16 * i);

  r.killsCredited = perks.kills - before;
  r.levelAfter = perks.plevel;
  r.pickupsOnGround = ctx.peek('perks')?.chests?.length ?? 0;

  // --- the upgrade card has to actually appear ----------------------------
  r.cardVisible = !!document.querySelector('.ow-perkcard, [class*="perk"]');

  // --- armour has to soak before health ------------------------------------
  const player = ctx.peek('player');
  const health = player?.health;
  if (health && perks) {
    health.value = health.max;
    perks.armor = 0;
    perks.addArmor(45);
    const hp0 = health.value;
    health.damage(30, null, {});
    r.armorSoaked = perks.armor;
    r.healthLostBehindArmor = hp0 - health.value;
    // And once the plate is gone, health must start taking it again.
    perks.armor = 0;
    health.damage(30, null, {});
    r.healthLostBareD = hp0 - health.value;
  }

  // --- ammo pickup must refuse when full ----------------------------------
  const ps = ctx.peek('perks');
  r.ammoWhenFull = ps?.collect?.('ammo');

  return r;
});

// --- do the enemies actually come for you? --------------------------------
const chase = await p.evaluate(async () => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');
  const player = ctx.peek('player');

  /**
   * UNFREEZE FIRST.
   *
   * The kill phase above levels the player, which opens the perk card, which
   * holds time.scale at zero and takes control away — correctly, that is what
   * the card is for. Measuring a chase after that reported 28 of 28 enemies
   * "wedged on geometry" when in fact the whole game was paused and nothing had
   * moved a millimetre. A pathfinding result measured through a stopped clock
   * is not a pathfinding result.
   */
  ctx.peek('ui')?.perkCard?.close?.();
  ctx.time.scale = 1;
  player?.setControlEnabled?.(true);

  ai?.populate?.({ squads: 3, perSquad: 5, variants: ['ghoul'] });
  for (let i = 0; i < 4; i++) e.step(performance.now() + 16 * i);

  const live = () => (ai.agents ?? []).filter((a) => a.alive);
  const distOf = (a) => a.position.distanceTo(player.position);

  /**
   * TRACK EACH AGENT FROM WHEN IT APPEARS, NOT FROM ONE SNAPSHOT.
   *
   * Holdout runs its own wave logic during the sim: it clears a dead wave and
   * populates a new one, so over 25 seconds the roster turns over completely.
   * A single snapshot taken at the start therefore compares against bodies that
   * no longer exist, and every survivor has an undefined starting distance —
   * which is how this reported "0 of 28 closed distance" while six enemies were
   * in fact standing on the player at 1.2 m, in combat. The AI was never the
   * problem; the measurement was.
   *
   * Recording first/closest per agent id also answers the real question better:
   * whether a body ever got to the player, not where it happened to be when the
   * clock stopped.
   */
  const seen = new Map(); // id -> { first, closest }
  const sample = () => {
    for (const a of live()) {
      const d = distOf(a);
      const rec = seen.get(a.id);
      if (!rec) seen.set(a.id, { first: d, closest: d });
      else if (d < rec.closest) rec.closest = d;
    }
  };

  /**
   * ~25 s of simulation with DRAWING STUBBED.
   *
   * Headless has no GPU, so every frame is software-rasterised and the page
   * manages about 2 fps — 25 seconds of real time would be 50 frames, which is
   * nowhere near enough for a pathfinder to show whether it gets anywhere. The
   * question here is entirely about simulation (positions, nav, steering), and
   * none of that reads a pixel, so skipping the draw costs nothing and buys
   * three orders of magnitude. Same technique as warp-check.
   */
  const render = ctx.peek('render');
  const realRender = render.render;
  render.render = () => {};
  let t = performance.now();
  sample();
  for (let i = 0; i < 1500; i++) {
    t += 16.6;
    e.step(t);
    if (i % 10 === 0) sample();
  }
  sample();
  render.render = realRender;

  let closed = 0;
  let stuck = 0;
  let reached = 0;
  for (const rec of seen.values()) {
    if (rec.closest < rec.first - 2) closed++;
    // Never got within melee of a player who never moved = wedged on geometry.
    if (rec.closest > 6 && rec.first - rec.closest < 1) stuck++;
    if (rec.closest < 4) reached++;
  }
  const states = {};
  for (const a of live()) states[a.state] = (states[a.state] ?? 0) + 1;
  const firsts = [...seen.values()].map((r) => r.first);
  const closests = [...seen.values()].map((r) => r.closest).sort((a, c) => a - c);
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

  return {
    total: seen.size,
    closed,
    stuck,
    reached,
    aliveNow: live().length,
    playerDead: !!player?.dead,
    timeScale: ctx.time.scale,
    d0: mean(firsts).toFixed(1),
    d1: mean(closests).toFixed(1),
    nearest: closests[0]?.toFixed(1),
    states,
  };
});

await b.close();

const bad = [];
if (!out.hasPerks) bad.push('no ctx.perks');
if (!out.hasPanel) bad.push('survivor HUD panel missing');
if (out.killsCredited < 8) bad.push(`only ${out.killsCredited}/8 kills credited`);
if (out.levelAfter <= out.startLevel) bad.push('8 kills produced no level');
if (out.healthLostBehindArmor > 0) bad.push(`armour leaked ${out.healthLostBehindArmor} damage to health`);
if (!(out.healthLostBareD > 0)) bad.push('health took nothing once armour was gone');
if (out.ammoWhenFull !== false) bad.push('a full ammo pickup was consumed anyway');
if (chase.closed < chase.total * 0.5) bad.push(`only ${chase.closed}/${chase.total} closed distance`);
if (chase.stuck > chase.total * 0.25) bad.push(`${chase.stuck}/${chase.total} wedged on geometry`);

console.log(`map ${MAP}`);
console.log(`  kills credited     ${out.killsCredited}`);
console.log(`  level              ${out.startLevel} -> ${out.levelAfter}`);
console.log(`  pickups dropped    ${out.pickupsOnGround}`);
console.log(`  armour soak        ${45 - out.armorSoaked} absorbed, ${out.healthLostBehindArmor} reached health`);
console.log(`  bare hit           ${out.healthLostBareD} health lost`);
console.log(`  full ammo pickup   ${out.ammoWhenFull === false ? 'left on ground (correct)' : 'CONSUMED'}`);
console.log(`  chase              ${chase.closed}/${chase.total} closed, ${chase.reached} reached, ${chase.stuck} stuck`);
console.log(`  distance           spawned at mean ${chase.d0}m, closed to mean ${chase.d1}m, nearest ${chase.nearest}m`);
console.log(`  agents             ${chase.total} seen, ${chase.aliveNow} alive now, states ${JSON.stringify(chase.states)}`);
console.log(`  sim                playerDead=${chase.playerDead} timeScale=${chase.timeScale}`);
if (errors.length) console.log(`\npage errors (${errors.length}):\n  ` + errors.slice(0, 8).join('\n  '));
console.log(bad.length ? `\nFAIL: ${bad.join('; ')}` : '\nok — loop wired, armour correct, enemies closing');
process.exit(bad.length || errors.length ? 1 : 0);
