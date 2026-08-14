/**
 * Career progress — the reason to come back tomorrow.
 *
 * CrazyGames grades a Basic Launch on three numbers: 10+ minute sessions, 10-15%
 * next-day return, and 80% of players reaching one minute. A round-based shooter
 * with nothing to keep satisfies none of them, however good the shooting is. So
 * eliminations accumulate across sessions and spend themselves on the attachment
 * sets that ALREADY EXIST — muzzles, magazines, stocks and paint. No new content
 * had to be built for this; it was all sitting there available from frame one,
 * which is exactly why gating it is the cheapest progression the game can have.
 *
 * CrazyGames additionally requires the Data module for progress saving at Full
 * Launch and Yandex has its own player storage. Both are async and both can be
 * absent, so localStorage is the source of truth and the portal is a mirror:
 * writes go to both, reads prefer the portal (it survives a new device) and fall
 * back to local. A portal that fails can therefore never lose a career.
 */

import { portal } from './portal.js';

const KEY = 'hs.career';

/**
 * What each attachment costs, in career eliminations.
 *
 * The four defaults are free so the gun is complete before the first shot — a
 * first-session player must never see a stripped weapon and read it as broken.
 * After that the curve is deliberately front-loaded: the first unlock lands
 * inside session one (~10 kills is a couple of matches), which is what teaches
 * that the system exists at all. The tail is long enough to still have something
 * left at 1000.
 */
export const UNLOCKS = [
  { slot: 'muzzle', id: 'bare', at: 0 },
  { slot: 'mag', id: 'std', at: 0 },
  { slot: 'stock', id: 'standard', at: 0 },
  { slot: 'skin', id: 'black', at: 0 },

  { slot: 'muzzle', id: 'a2', at: 10 },
  { slot: 'skin', id: 'fde', at: 25 },
  { slot: 'stock', id: 'collapsed', at: 45 },
  { slot: 'mag', id: 'ext', at: 70 },
  { slot: 'muzzle', id: 'comp', at: 110 },
  { slot: 'skin', id: 'od', at: 160 },
  { slot: 'stock', id: 'extended', at: 220 },
  { slot: 'muzzle', id: 'brake', at: 300 },
  { slot: 'mag', id: 'short', at: 400 },
  { slot: 'skin', id: 'urban', at: 520 },
  { slot: 'muzzle', id: 'can', at: 680 },
  { slot: 'skin', id: 'bronze', at: 900 },

  // The loud finishes. Cheaper than the tail of the realistic set on purpose:
  // they are the ones a player actually wants to show off, so they should land
  // while they are still playing rather than at 900 kills.
  { slot: 'skin', id: 'cyan', at: 55 },
  { slot: 'skin', id: 'orange', at: 130 },
  { slot: 'skin', id: 'hotpink', at: 260 },
  { slot: 'skin', id: 'acid', at: 380 },
  { slot: 'skin', id: 'violet', at: 600 },
  { slot: 'skin', id: 'arctic', at: 780 },
];

/** Career level thresholds, in eliminations. Index lines up with rankName(). */
const LEVELS = [0, 25, 90, 220, 500, 900];

const BLANK = { kills: 0, sessions: 0, best: 0, seconds: 0 };

let state = { ...BLANK };

function clean(raw) {
  if (!raw || typeof raw !== 'object') return { ...BLANK };
  const n = (v) => (Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : 0);
  return { kills: n(raw.kills), sessions: n(raw.sessions), best: n(raw.best), seconds: n(raw.seconds) };
}

/** Load the career. Call once, before the menu paints. */
export async function loadCareer() {
  let local = null;
  try {
    local = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    local = null;
  }
  const remote = await portal.getData(KEY);
  /**
   * Prefer whichever has more eliminations rather than blindly preferring the
   * portal: a player who played offline after their last sync would otherwise
   * watch the portal copy overwrite the newer local one.
   */
  const a = clean(local);
  const b = clean(remote);
  state = b.kills > a.kills ? b : a;
  return state;
}

export function career() {
  return state;
}

/** @returns {number} career level index, for rankName() */
export function level(kills = state.kills) {
  let i = 0;
  while (i + 1 < LEVELS.length && kills >= LEVELS[i + 1]) i++;
  return i;
}

/** @returns {boolean} whether this attachment has been earned */
export function isUnlocked(slot, id) {
  const u = UNLOCKS.find((x) => x.slot === slot && x.id === id);
  // Anything not in the table is not gated — a new attachment is free until it
  // is deliberately given a price.
  return !u || state.kills >= u.at;
}

/** @returns {number} eliminations this attachment costs; 0 when it is not gated */
export function unlockPrice(slot, id) {
  return UNLOCKS.find((x) => x.slot === slot && x.id === id)?.at ?? 0;
}

/** @returns {{slot:string,id:string,at:number}|null} the cheapest thing still locked */
export function nextUnlock(kills = state.kills) {
  let best = null;
  for (const u of UNLOCKS) {
    if (kills >= u.at) continue;
    if (!best || u.at < best.at) best = u;
  }
  return best;
}

/**
 * Bank a finished SESSION, not a match — this game has no round end, and the
 * event that reliably fires for every player is the tab going away. Called from
 * the pagehide/visibilitychange pair in main.js.
 *
 * @param {{kills:number, best:number, seconds:number}} result
 * @returns {Array} attachments this session unlocked
 */
export function bankSession({ kills = 0, best = 0, seconds = 0 } = {}) {
  const before = state.kills;
  state = {
    kills: state.kills + Math.max(0, Math.floor(kills)),
    sessions: state.sessions + 1,
    best: Math.max(state.best, Math.floor(best)),
    seconds: state.seconds + Math.max(0, Math.floor(seconds)),
  };
  persist();
  return UNLOCKS.filter((u) => u.at > before && u.at <= state.kills);
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private browsing, or storage full. The portal mirror may still take it,
    // and a career that cannot be saved must not stop a match from ending.
  }
  portal.setData(KEY, state);
}

/** Wipe the career. Only reachable from the pause menu, behind a confirm. */
export function resetCareer() {
  state = { ...BLANK };
  persist();
}

/** ponytail: self-check, run with `node src/core/save.js`. */
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('save.js')) {
  const assert = (c, m) => {
    if (!c) throw new Error(m);
  };
  state = { ...BLANK };
  assert(level(0) === 0 && level(24) === 0 && level(25) === 1, 'level thresholds');
  assert(level(1e6) === LEVELS.length - 1, 'level caps at the last rank');
  assert(nextUnlock(0).at === 10, 'cheapest locked item first');
  assert(nextUnlock(1e6) === null, 'nothing left at the top');
  assert(isUnlocked('muzzle', 'bare') && !isUnlocked('muzzle', 'a2'), 'gating at zero kills');
  assert(isUnlocked('muzzle', 'nonexistent'), 'ungated attachments are free');
  assert(clean({ kills: -5, best: 'x' }).kills === 0, 'garbage is scrubbed');
  const got = UNLOCKS.filter((u) => u.at > 0 && u.at <= 30).map((u) => u.id);
  assert(got.join() === 'a2,fde', `unlock window: ${got}`);
  console.log('save.js ok');
}
