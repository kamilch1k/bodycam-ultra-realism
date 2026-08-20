/**
 * Front end — the menu that is on screen BEFORE any 3D exists.
 *
 * This is plain DOM on purpose. Nothing here touches THREE, the engine, the
 * renderer or a WebGL context, so it paints on the browser's first frame while
 * the ~12-25 s of procedural generation and shader compilation has not started
 * yet. Booting the engine first and drawing a menu afterwards is what produced
 * the "black screen for half a minute and then a frozen tab" experience.
 *
 * THE LOADING BAR IS ANIMATED WITH `transform`, DELIBERATELY.
 * Level build and shader translation block the main thread solid — a bar driven
 * by rAF or by width/left would freeze at its first frame and look hung. A CSS
 * animation on `transform` runs on the compositor, so it keeps moving while the
 * main thread is wedged. It is an indeterminate barber-pole rather than a real
 * percentage for the same reason: progress callbacks cannot be delivered from a
 * thread that is not running.
 */

import { t, rankName } from '../core/i18n.js';
import { career, level, nextUnlock } from '../core/save.js';
import * as fs from '../core/fullscreen.js';
import { MENU_BG } from './menubg.js';

/**
 * Names and blurbs are i18n KEYS resolved at paint time, not strings: the
 * language is not known when this module is evaluated, only after the portal
 * SDK has answered.
 */
/**
 * Order is the default: MAPS[0] is what a player who never touches the list
 * gets. That used to be `street`, the full production map — so the very first
 * thing anyone did was press Play and wait through the slowest load in the
 * game, on the one screen where CrazyGames measures whether they stay. Fast
 * maps first, `street` kept but demoted to what it is: the big one.
 */
/**
 * TWO MAPS, and only these two.
 *
 * `holdout` and `strike` still build and still load via `?map=`, but they are
 * the older arenas: they never got the lighting and palette pass these two did,
 * so next to Miami they are the grey concrete the whole look was fixed to get
 * away from. Shipping them would put the weakest thing in the game one click
 * from the front page. Re-add an entry here when a map has had the pass.
 */
export const MAPS = [{ id: 'miami' }, { id: 'outpost' }, { id: 'zone' }];

/**
 * Two modes, one map each, and the map list is now those two maps. Five maps
 * across two modes meant most combinations were a level being played the way it
 * was not designed for — the horde map has one keep and three doors because a
 * horde arrives from everywhere, and that shape is meaningless in a round.
 * `tdm` and `sandbox` still exist for `?mode=`; they are just not a choice a
 * portal player has to make before they have played once.
 */
/**
 * ONE mode for now. Strike still works via `?mode=strike` and its rules are
 * intact, but a portal player choosing between two modes before playing either
 * is a choice made on no information — and Holdout is the one with a hook.
 * With a single entry the column is not rendered at all, so the menu is a map
 * choice and a Play button.
 */
export const MODES = [{ id: 'horde' }];

const CSS = `
.ow-fe{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:2.2rem;
  /* Scrim FIRST, photo second, flat colour last. The scrim is not decoration:
     the shot is a bright concrete wall and white 11px labels on it are
     unreadable, which is a moderation fail on both portals. The flat colour
     underneath means a failed image decode degrades to the old dark menu
     rather than to black text on nothing. */
  background:
    linear-gradient(105deg,rgba(5,8,12,.94) 0%,rgba(5,8,12,.80) 45%,rgba(5,8,12,.62) 100%),
    url("${MENU_BG}") center/cover no-repeat,
    radial-gradient(120% 90% at 50% 0%,#243040 0%,#0d1116 60%,#05070a 100%);
  color:#e8eaed;font:400 15px/1.5 "Inter","Helvetica Neue",Arial,sans-serif;
  letter-spacing:.02em;user-select:none}
/* Panels get their own ground so they read as UI sitting ON the photo rather
   than as text floating in it. */
.ow-fe .ow-col,.ow-fe .ow-career{background:rgba(9,13,19,.72);
  border:1px solid rgba(45,58,74,.9);border-radius:10px;padding:1rem 1.1rem;
  backdrop-filter:blur(3px)}
.ow-fe .ow-career{padding:.7rem 1.4rem}
.ow-fe h1{font-size:clamp(28px,5vw,54px);font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:#fff;text-shadow:0 2px 30px rgba(90,160,255,.25)}
/* max(), not a bare em: the subtitle is 0.28 of a title that itself shrinks with
   the viewport, so on a small phone it compounded down to 8.6px. */
.ow-fe h1 span{display:block;font-size:max(9.5px,.28em);letter-spacing:.42em;font-weight:400;
  color:#7d8896;margin-top:.6em}
.ow-fe .ow-cols{display:flex;gap:2.5rem;flex-wrap:wrap;justify-content:center}
.ow-fe .ow-col{min-width:270px}
.ow-fe h2{font-size:11px;letter-spacing:.28em;text-transform:uppercase;
  color:#6f7a88;margin-bottom:.85rem;font-weight:600}
.ow-fe button{display:block;width:100%;text-align:left;margin-bottom:.5rem;
  padding:.7rem .9rem;border:1px solid #2a3442;border-radius:6px;
  background:#151b23;color:#c9d1d9;cursor:pointer;font:inherit;
  transition:border-color .12s,background .12s}
.ow-fe button:hover{background:#1c242e;border-color:#3d4c60}
.ow-fe button[aria-pressed="true"]{background:#1d2b3d;border-color:#5b8ec9;color:#fff}
.ow-fe button b{display:block;font-weight:600;font-size:14px}
.ow-fe button i{display:block;font-style:normal;font-size:11.5px;color:#78828f;margin-top:.15rem}
.ow-fe .ow-play{width:auto;padding:.85rem 3.4rem;text-align:center;font-weight:700;
  letter-spacing:.2em;text-transform:uppercase;background:#2f6fb5;border-color:#4d8ad0;color:#fff}
.ow-fe .ow-play:hover{background:#3b82cf}
.ow-fe .ow-foot{font-size:11px;color:#5b6472}
.ow-load{gap:1.4rem}
.ow-load .ow-bar{width:min(420px,70vw);height:3px;background:#1b222c;overflow:hidden;border-radius:2px}
.ow-load .ow-bar i{display:block;height:100%;width:38%;border-radius:2px;
  background:linear-gradient(90deg,transparent,#5b9ae0,transparent);
  animation:ow-slide 1.15s linear infinite}
@keyframes ow-slide{from{transform:translateX(-110%)}to{transform:translateX(370%)}}
.ow-load .ow-what{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#6f7a88}
.ow-fe .ow-career{display:flex;gap:2rem;align-items:center;flex-wrap:wrap;
  justify-content:center;padding:.7rem 1.4rem;border:1px solid #232c38;border-radius:8px;
  background:rgba(13,18,25,.6)}
.ow-fe .ow-career div{text-align:center}
.ow-fe .ow-career k{display:block;font-size:10px;letter-spacing:.22em;text-transform:uppercase;
  color:#6f7a88;margin-bottom:.25rem}
.ow-fe .ow-career v{display:block;font-size:15px;font-weight:600;color:#dbe3ec}
.ow-fe .ow-fsbtn{position:fixed;top:14px;right:16px;width:auto;margin:0;padding:.45rem .8rem;
  font-size:11px;letter-spacing:.14em;text-transform:uppercase}

/* ------------------------------------------------------------- responsive
 * The menu is the first thing moderation sees, on whatever window they happen
 * to have open. It centres while it fits and SCROLLS when it does not — the
 * previous fixed centring pushed the Play button off the bottom of anything
 * shorter than about 700px, which on a phone in landscape meant the game could
 * not be started at all. */
.ow-fe{overflow-y:auto;overflow-x:hidden;padding:
  max(1.2rem,env(safe-area-inset-top)) max(1.2rem,env(safe-area-inset-right))
  max(1.2rem,env(safe-area-inset-bottom)) max(1.2rem,env(safe-area-inset-left))}
@media (max-height:700px){
  .ow-fe{justify-content:flex-start;gap:1.1rem}
  .ow-fe h1{font-size:clamp(22px,4.6vw,34px)}
  .ow-fe h1 span{margin-top:.35em}
  .ow-fe .ow-career{padding:.5rem 1rem;gap:1.1rem}
  .ow-fe button{padding:.5rem .8rem;margin-bottom:.35rem}
  .ow-fe button i{display:none}
  .ow-fe .ow-play{padding:.7rem 2.6rem}
}
@media (max-width:720px){
  .ow-fe .ow-cols{gap:1.2rem;width:100%}
  .ow-fe .ow-col{min-width:0;width:100%;max-width:420px}
  .ow-fe .ow-career{gap:1.1rem;width:100%;max-width:420px;justify-content:space-around}
  .ow-fe .ow-foot{text-align:center}
}
/* Touch: 44px minimum on everything the thumb has to hit. */
@media (pointer:coarse){
  .ow-fe button{min-height:44px}
  .ow-fe .ow-fsbtn{min-height:40px}
}
`;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/**
 * Paint the menu and return a controller immediately.
 *
 * Returning before Play is important: the selected map can initialise and
 * pre-warm in paced jobs BEHIND this DOM layer while the player can still read
 * the career panel, change map, use fullscreen and press Play. The old Promise
 * API made that overlap structurally impossible.
 * @param {{map?:string, mode?:string}} initial  pre-selection from the URL
 * @returns {{choice:{map:string,mode:string}, play:Promise<object>,
 *   changed:(fn:Function)=>Function, setBusy:(busy:boolean)=>void, done:()=>void}}
 */
export function showMainMenu(initial = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let map = MAPS.some((m) => m.id === initial.map) ? initial.map : MAPS[0].id;
  let mode = MODES.some((m) => m.id === initial.mode) ? initial.mode : MODES[0].id;

  const list = (items, sel, prefix) =>
    items
      .map(
        (o) =>
          `<button type="button" data-id="${o.id}" aria-pressed="${o.id === sel}">
             <b>${t(`${prefix}.${o.id}`)}</b><i>${t(`${prefix}.${o.id}.blurb`)}</i>
           </button>`
      )
      .join('');

  const c = career();
  const next = nextUnlock();
  const stat = (k, v) => `<div><k>${k}</k><v>${v}</v></div>`;
  const touch = matchMedia?.('(pointer: coarse)')?.matches;

  const root = el(`
    <div class="ow-fe">
      <h1>Hotline Strike<span>${t('menu.subtitle')}</span></h1>
      <div class="ow-career">
        ${stat(t('career.rank'), rankName(level()))}
        ${stat(t('career.kills'), c.kills)}
        ${stat(t('career.best'), c.best)}
        ${stat(
          t('career.next'),
          next ? t('career.next.at', { n: next.at - c.kills }) : t('career.complete')
        )}
      </div>
      <div class="ow-cols">
        <div class="ow-col" id="ow-maps"><h2>${t('menu.map')}</h2>${list(MAPS, map, 'map')}</div>
        ${MODES.length > 1
          ? `<div class="ow-col" id="ow-modes"><h2>${t('menu.mode')}</h2>${list(MODES, mode, 'mode')}</div>`
          : ''}
      </div>
      <button type="button" class="ow-play">${t('menu.play')}</button>
      <div class="ow-foot">${t(touch ? 'menu.controls.touch' : 'menu.controls')}</div>
      ${fs.supported() ? `<button type="button" class="ow-fsbtn">${t('menu.fullscreen')}</button>` : ''}
    </div>
  `);
  document.body.appendChild(root);
  root.querySelector('.ow-fsbtn')?.addEventListener('click', () => fs.toggle());

  const listeners = new Set();
  const choice = () => ({ map, mode });
  const changed = () => {
    const value = choice();
    for (const fn of listeners) fn(value);
  };

  const pick = (container, onPick) => {
    // A column that was not rendered is a legitimate state, not a bug: with one
    // mode there is nothing to choose between, so `#ow-modes` is absent and this
    // is called with null. Without the guard the menu threw on every paint.
    if (!container) return;
    container.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (!b) return;
      const before = `${map}\0${mode}`;
      for (const other of container.querySelectorAll('button[data-id]')) {
        other.setAttribute('aria-pressed', String(other === b));
      }
      onPick(b.dataset.id);
      if (`${map}\0${mode}` !== before) changed();
    });
  };
  pick(root.querySelector('#ow-maps'), (id) => (map = id));
  pick(root.querySelector('#ow-modes'), (id) => (mode = id));

  let busy = false;
  let played = false;
  let resolvePlay;
  const play = new Promise((resolve) => (resolvePlay = resolve));
  const go = () => {
    if (busy || played) return;
    played = true;
    /**
     * Play is the last user gesture before the match, and a gesture is the only
     * moment a browser will grant fullscreen. On touch that is not optional:
     * Yandex requires the game to already BE fullscreen during gameplay, and
     * the browser chrome otherwise eats the thumb rests. Deliberately not
     * awaited — a device that refuses must still start the match.
     */
    if (matchMedia?.('(pointer: coarse)')?.matches) fs.request();
    resolvePlay(choice());
  };
  root.querySelector('.ow-play').addEventListener('click', go);
  const onKey = (e) => {
    if (e.key === 'Enter' && root.isConnected) go();
  };
  addEventListener('keydown', onKey);

  return {
    get choice() {
      return choice();
    },
    play,
    changed(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setBusy(next) {
      busy = !!next;
      root.setAttribute('aria-busy', String(busy));
      for (const button of root.querySelectorAll('.ow-play, button[data-id]')) {
        button.disabled = busy;
      }
    },
    done() {
      removeEventListener('keydown', onKey);
      listeners.clear();
      root.remove();
      style.remove();
    },
  };
}

/** Full-screen loading state. Returns a handle with `.done()`. */
export function showLoading(mapName) {
  const root = el(`
    <div class="ow-fe ow-load">
      <div class="ow-what">${t('load.loading')} ${mapName}</div>
      <div class="ow-bar"><i></i></div>
      <div class="ow-foot">${t('load.note')}</div>
    </div>
  `);
  document.body.appendChild(root);
  return {
    done() {
      root.remove();
    },
  };
}
