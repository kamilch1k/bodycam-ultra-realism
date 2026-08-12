/**
 * End-to-end check for the compliance + progression work.
 *
 * Drives the real event bus rather than shooting anyone: a kill is a
 * `damage:dealt` with `killed`, so emitting those is the same input the tracker
 * sees in a match, and it makes the unlock curve testable without an aimbot.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5181/';
const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const fail = [];
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  if (!cond) fail.push(name);
};

// ── 1. menu: localisation and the career panel ─────────────────────────────
for (const [lang, want] of [['en', 'Eliminations'], ['ru', 'Устранено']]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(`${BASE}?lang=${lang}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.ow-career', { timeout: 30000 });
  const txt = await p.textContent('.ow-fe');
  const htmlLang = await p.getAttribute('html', 'lang');
  ok(`menu localised to ${lang}`, txt.includes(want), `lang="${htmlLang}"`);
  ok(`${lang}: no untranslated keys leaked`, !/\bmap\.\w+|career\.\w+/.test(txt));
  await p.close();
}

// ── 2. career tracking, banking and unlocks ────────────────────────────────
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', (e) => ok('no page error', false, e.message));
await p.goto(`${BASE}?map=box&menu=0`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('!!window.__ENGINE__', null, { timeout: 180000 });

const emit = (n, killed = true) =>
  p.evaluate(
    ({ n, killed }) => {
      const ev = window.__ENGINE__.events;
      for (let i = 0; i < n; i++) ev.emit('damage:dealt', { target: { id: i }, amount: 99, killed });
    },
    { n, killed }
  );

// A non-kill hit must not count, and a kill ON the player must break the streak.
await emit(3, false);
await p.evaluate(() =>
  window.__ENGINE__.events.emit('damage:dealt', { target: 'player', amount: 99, killed: true })
);
await emit(12);

// Banking happens on pause, and the gunsmith raises the same `ui:pause` the
// pause menu does — so opening the loadout is what banks and re-gates.
await p.evaluate(() => window.__ENGINE__.ctx.peek('ui').gunsmith.show());
await p.waitForTimeout(150);

const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('hs.career') ?? 'null'));
ok('career persisted to localStorage', !!saved, JSON.stringify(saved));
ok('only killed=true counted', saved?.kills === 12, `kills=${saved?.kills}`);
ok('streak survives a player death', saved?.best === 12, `best=${saved?.best}`);

// 12 kills clears the 10-kill muzzle but not the 25-kill skin.
const gate = await p.evaluate(() => {
  const g = window.__ENGINE__.ctx.peek('ui').gunsmith;
  const grab = (slot) =>
    g.slots.find((s) => s.slot === slot).btns.map(([b, id]) => [id, b.disabled]);
  return { muzzle: grab('muzzle'), skin: grab('skin') };
});
const dis = (rows, id) => rows.find((r) => r[0] === id)?.[1];
ok('free attachment unlocked', dis(gate.muzzle, 'bare') === false);
ok('10-kill muzzle unlocked at 12', dis(gate.muzzle, 'a2') === false);
ok('25-kill skin still locked at 12', dis(gate.skin, 'fde') === true);
ok('900-kill skin still locked', dis(gate.skin, 'bronze') === true);

// Banking must drain, not latch: more kills after a bank still count.
await emit(20);
await p.evaluate(() => {
  const g = window.__ENGINE__.ctx.peek('ui').gunsmith;
  g.close();
  g.show();
});
await p.waitForTimeout(150);
const after = await p.evaluate(() => JSON.parse(localStorage.getItem('hs.career')));
ok('second bank accumulates', after?.kills === 32, `kills=${after?.kills}`);
ok('one session, not one per bank', after?.sessions === 2, `sessions=${after?.sessions}`);

// ── 3. the touch pause path ────────────────────────────────────────────────
const edge = await p.evaluate(() => {
  const inp = window.__ENGINE__.ctx.input;
  inp._pendingDown.add('Escape');
  inp.beginFrame();
  return inp.actionPressed('pause');
});
ok('queued button produces a press edge', edge === true);

await p.close();
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
process.exit(fail.length ? 1 : 0);
