/**
 * The survivors economy, checked without a browser.
 *
 * Pacing is the whole design here and it is entirely arithmetic: how many kills
 * to the first upgrade, whether a run keeps levelling at a rate the wave sizes
 * can actually feed, and whether the curve flattens into "never again" later.
 * All of that is decidable from the numbers, so it should not need a play test.
 *
 *   node tools/progression-check.mjs
 */
import assert from 'node:assert/strict';
import { Perks, PERKS, PICKUPS } from '../src/game/perks.js';

const p = new Perks();

// ---- the first upgrade has to land inside the first wave ------------------
// Wave 1 is 3 squads of 2 = 6 bodies. An upgrade that arrives after it is over
// makes the opening feel like a normal horde mode.
assert.equal(p.xpToNext, 4, `first level costs ${p.xpToNext} kills, wanted 4`);
assert.ok(p.xpToNext <= 6, 'first upgrade must be reachable within wave 1');

// ---- levelling against the real wave sizes --------------------------------
// HordeMode: `per = min(8, 1 + ceil(wave / 2))` bodies per squad, 3 squads.
const bodies = (w) => 3 * Math.min(8, 1 + Math.ceil(w / 2));
let levels = 0;
const at = {};
for (let w = 1; w <= 12; w++) {
  levels += p.addXp(bodies(w));
  at[w] = p.plevel;
}
assert.ok(at[1] >= 2, `wave 1 ended at level ${at[1]}, wanted the run to have moved`);
assert.ok(at[5] >= 6, `wave 5 ended at level ${at[5]}, too slow to feel like progression`);

// The perk pool is finite; the curve must not still be handing out cards long
// after everything is maxed, or the card becomes an empty interruption.
const cap = Object.values(PERKS).reduce((n, d) => n + d.max, 0);
assert.ok(p.plevel - 1 <= cap * 1.6, `level ${p.plevel} vs ${cap} total perk levels — curve too flat`);
console.log(`  12 waves = ${bodies(12)} bodies in the last one, ${p.kills} kills total`);
console.log(`  level after wave 1/5/12: ${at[1]} / ${at[5]} / ${at[12]}  (perk pool is ${cap})`);

// ---- roll() must never offer a maxed perk ---------------------------------
const q = new Perks();
for (const id of Object.keys(PERKS)) for (let i = 0; i < PERKS[id].max; i++) q.take(id);
assert.equal(q.roll(null).length, 0, 'a fully maxed run must offer nothing');
assert.equal(q.take('damage'), false, 'a maxed perk must refuse to level again');

// ---- armour ---------------------------------------------------------------
const a = new Perks();
assert.equal(a.addArmor(45), 45);
assert.equal(a.addArmor(999), a.armorMax - 45, 'armour must clamp to its cap');
assert.equal(a.addArmor(10), 0, 'a full plate must report taking nothing, so the pickup survives');

// ---- the drop table -------------------------------------------------------
const total = Object.values(PICKUPS).reduce((n, s) => n + s.chance, 0);
assert.ok(total > 0.2 && total < 0.34, `drop rate ${total.toFixed(2)} — want roughly 1 body in 3`);
assert.ok(PICKUPS.chest.chance < PICKUPS.ammo.chance, 'the instant upgrade must be the rare one');

// ---- death resets the run -------------------------------------------------
const r = new Perks();
r.addXp(50);
r.addArmor(70);
r.take('damage');
r.reset();
assert.equal(r.plevel, 1);
assert.equal(r.armor, 0);
assert.equal(r.kills, 0);
assert.equal(r.level.damage, 0, 'perks must not survive a death');

console.log(`  drop rate ${(total * 100).toFixed(0)}% per kill`);
console.log('ok — progression, armour, drops and reset');
