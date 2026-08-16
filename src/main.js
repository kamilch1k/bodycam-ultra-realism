import { Engine } from './core/engine.js';
import { createConfig, DEFAULTS } from './core/config.js';

import { RenderSystem } from './render/index.js';
import { MaterialSystem } from './materials/index.js';
import { SkySystem } from './sky/index.js';
import { WorldSystem } from './world/index.js';
import { PhysicsSystem } from './physics/index.js';
import { PlayerSystem } from './player/index.js';
import { WeaponSystem } from './weapons/index.js';
import { FxSystem } from './fx/index.js';
import { AiSystem } from './ai/index.js';
import { ModeSystem } from './modes/index.js';
import { PerkSystem } from './game/perks.js';
import { UiSystem } from './ui/index.js';
import { AudioSystem } from './audio/index.js';

import { installShotApi } from './dev/shots.js';
import { prewarm } from './core/prewarm.js';
import { showMainMenu, showLoading } from './ui/mainmenu.js';
import { portal } from './core/portal.js';
import { TouchControls, isTouchDevice } from './core/touch.js';
import { AimAssist } from './player/assist.js';
import { setLang, t } from './core/i18n.js';
import { loadCareer, bankSession } from './core/save.js';
import { armFirstGesture } from './core/fullscreen.js';

const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
// Deterministic shutter for the pixel gate: the engine does not schedule its own
// frames, the driver advances exactly N of them through window.__PUMP__. Opt-in,
// because tools that measure real frame pacing (tools/perf.mjs) need the loop to
// free-run. See the long comment in src/dev/shots.js.
const lockstep = capture && params.get('lockstep') === '1';

/**
 * FRONT END FIRST, ENGINE SECOND.
 *
 * Nothing 3D is constructed until the player has picked a map. The menu is DOM
 * and paints on the browser's first frame; the 12-25 s of procedural generation
 * and shader translation then happens behind a compositor-animated loading
 * screen instead of behind a black canvas.
 *
 * The menu is SKIPPED for `?capture=1` (the pixel harness drives boot itself),
 * whenever `?map=` names a level outright (so every tool, probe and deep link
 * still boots straight into the game), and for `?menu=0`.
 */
/**
 * Attach the games-portal SDK before the menu, not after.
 *
 * Yandex and CrazyGames both show their own loading screen until the game says
 * it is ready, and both want that call as early as the game is genuinely
 * playable — which here is the main menu, not the first rendered frame of a
 * map. Awaiting it costs nothing off-portal (`init` returns immediately when no
 * portal is configured) and is capped by a timeout on-portal, so a slow SDK can
 * never be the reason the game does not start.
 */
await portal.init();

/**
 * Language and career must both be settled BEFORE the menu paints: the menu
 * shows rank and progress, and Yandex requires the language come from the SDK
 * rather than from a picker. `?lang=` overrides for testing the RU build without
 * a Russian browser.
 */
setLang(params.get('lang') ?? portal.lang);
await loadCareer();

const skipMenu = capture || params.has('map') || params.get('menu') === '0';
const choice = skipMenu
  ? { map: params.get('map') ?? DEFAULTS.map, mode: params.get('mode') ?? DEFAULTS.mode }
  : await showMainMenu({ map: params.get('map'), mode: params.get('mode') });

// Put the loading screen up and let it actually paint before anything blocks:
// engine.init() holds the main thread, so a frame has to land first or the
// overlay never appears.
const loading = skipMenu ? null : showLoading(t(`map.${choice.map}`));
if (loading) {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

const config = createConfig({
  // Keep the launch path friendly to browser portals. Use ?q=ultra when
  // comparing the full desktop-quality renderer.
  // `mobile` is the shipping profile: no cascade pass, contact shadows instead.
  // Desktop players can still opt into ?q=low/medium/high/ultra.
  quality: params.get('q') ?? 'mobile',
  map: choice.map,
  mode: choice.mode,
  // ?skin= applies a weapon finish at boot — the only way to review one under
  // the real sun, since the weapons preview studio backlights every view.
  skin: params.get('skin') ?? null,
  // Same reason: an attachment can only be judged in the game's own light.
  muzzle: params.get('muzzle') ?? null,
  mag: params.get('mag') ?? null,
  stock: params.get('stock') ?? null,
  optic: params.get('optic') ?? null,
  deterministic: capture,
  // ?glove=full|simple overrides the preset, so the two can be A/B captured
  // from an identical camera instead of across a rebuild.
  gloveOverride: params.get('glove') ?? null,
});

const canvas = document.getElementById('game');

const engine = new Engine({ canvas, config });

// Registration order is irrelevant — Registry topo-sorts on static deps.
engine
  .add(RenderSystem)
  .add(MaterialSystem)
  .add(SkySystem)
  .add(WorldSystem)
  .add(PhysicsSystem)
  .add(PlayerSystem)
  .add(WeaponSystem)
  .add(FxSystem)
  .add(AiSystem)
  .add(UiSystem)
  .add(ModeSystem)
  .add(PerkSystem)
  .add(AudioSystem);

try {
  await engine.init();
} catch (err) {
  console.error('[boot] init failed', err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:0;padding:2rem;color:#f66;background:#000;
       font:12px/1.5 ui-monospace,monospace;overflow:auto;z-index:9999;white-space:pre-wrap">
BOOT FAILURE\n\n${err.stack ?? err.message}</pre>`
  );
  throw err;
}

const shotApi = installShotApi(engine, { capture, lockstep });

// Compile every shader permutation before the frame loop starts. Measured: without
// this, 86 programs compile lazily during play, up to 30 on one frame, producing
// 3.1-3.9 SECOND stalls. See src/core/prewarm.js.
//
// ON BY DEFAULT since the capture path was made frame-deterministic; opt out with
// `?prewarm=0`. It is now PROVEN pixel-neutral: `tools/baseline.mjs` with
// `--query=prewarm=0` vs `--query=prewarm=1` reports identical:true on all 11
// shots (0 changed pixels, maxDelta 0). The two things that previously made the
// ~1.4 s pre-warm spend look like a visual change were both boot-duration
// couplings OUTSIDE the subsystems: (1) the shutter frame index was latency-bound
// because the engine kept stepping through the driver's round trips — fixed by
// lockstep in src/dev/shots.js; (2) `will-change: transform` on the compass strip
// cached a composited-layer raster taken at a wall-clock-dependent moment — fixed
// in src/ui/style.js.
// OFF by default. This was tried both ways and MEASURED both ways.
//
//   prewarm on   boot 48 s, worst in-play frame 69 ms
//   prewarm off  boot  5 s, worst in-play frame 1005 ms
//
// The pre-warm does what it claims — it removes the multi-second compile stalls
// described above — but it costs a flat ~20 s of BLOCKED MAIN THREAD (134
// programs at ~150 ms each; it is already parallel inside each batch, so that is
// simply what ANGLE charges for shaders this size). A player does not experience
// that as a loading screen, they experience it as a dead page: nothing renders,
// the menu does not respond to clicks, and the tab looks hung.
//
// One 1-second hitch beats 48 seconds of frozen tab, so the default is a fast
// boot. `?prewarm=1` buys the stall-free run for anyone profiling or recording.
//
// The real fix is neither flag: it is FEWER AND SIMPLER PROGRAMS (206 live, 134
// pre-warmed), or a pre-warm that runs incrementally across frames once the
// game is already interactive. Both are bigger than a config change — see
// CLAUDE_HANDOFF.md.
/**
 * PREWARM IS ON for the arcade maps and off for the street.
 *
 * It was disabled globally after it cost 47 s on the street map, whose material
 * set is enormous — but that verdict was never re-measured against the greybox
 * levels this game actually ships. On `yard` it costs 442 ms of boot (10,370 ->
 * 10,812 ms) and compiles 54 extra programs, 49 -> 103.
 *
 * Those 54 are not free work avoided. They are programs that otherwise compile
 * the first time you fire, the first time a round hits concrete, the first time
 * a grenade goes off — one hitch each, mid-fight, on a phone. Paying for them
 * behind the loading screen is the entire point of a prewarm.
 *
 * `?prewarm=0` forces it off, `?prewarm=1` forces it on even on the street.
 */
const prewarmParam = params.get('prewarm');
const wantPrewarm =
  prewarmParam === '1' || (prewarmParam !== '0' && config.map !== 'street');
const warmup = wantPrewarm
  /**
   * `transients: 'full'` — warm every transient state, not a subset.
   *
   * `'lite'` warmed only the stages a program-COUNT probe caught compiling, and
   * that measurement was too narrow to be safe: three creates the program object
   * during compile(), but ANGLE defers the D3D translation to the first real
   * DRAW, so a program can already exist — leaving `info.programs.length` flat —
   * while the first trigger pull still pays to translate it. A counter that does
   * not move is not the same as work that is not happening.
   *
   * Measured end to end with tools/warm-cost.mjs, allocations during 20 s of
   * play: lite +8 geometries, play +6, full +0 +0 +0.
   *
   * NOT `full`, despite it being the only set that reaches zero. Full adds the
   * `ai` stage, whose reset is `ai.debugStage('none')` — and debugStage returns
   * early for every name except 'firefight', so that reset does nothing at all.
   * It leaves six staged agents alive and the sky at 17.9 instead of 16.5:
   * phantom enemies and visibly different lighting. `play` is everything the
   * first seconds of a fight can trigger, with a reset that actually runs.
   */
  ? await prewarm(engine, { transients: capture ? false : (params.get('warm') ?? 'play') })
  : { ok: false, reason: `off for map "${config.map}" — ?prewarm=1 to force` };
console.info('[boot] prewarm', warmup);
window.__PREWARM__ = warmup;

/**
 * TOUCH BUILD. `?touch=1` forces it on for testing from a desktop and `?touch=0`
 * forces it off on a phone; otherwise it follows the device. Everything it turns
 * on — the on-screen controls, the aim assist and the auto-fire — is gated here,
 * so a desktop player never gets any of it.
 */
const touchMode = params.get('touch') === '1' || (params.get('touch') !== '0' && isTouchDevice());
// Printed because the aim assist rides on this flag, and a wrong answer here is
// felt as the camera moving on its own rather than as a missing button.
console.log(`[input] touch mode: ${touchMode} (aim assist ${touchMode ? 'ON' : 'off'})`);
if (touchMode) {
  engine.input.touchMode = true;
  const controls = new TouchControls(document.body, engine.input);
  const player = engine.ctx.peek('player');
  if (player) {
    player.assist = new AimAssist(engine.ctx);
    player.assist.enabled = true;
  }
  // The overlay must not sit over the pause menu — it would eat every tap.
  engine.events.on('ui:pause', ({ paused }) => controls.setVisible(!paused));
  window.__TOUCH__ = controls;
  /**
   * Covers the deep-link path. The menu's Play button is normally the gesture
   * that buys fullscreen, but `?map=` skips the menu entirely and Yandex still
   * requires a mobile game to be fullscreen during gameplay — so on that path
   * the first tap has to do it instead.
   */
  if (skipMenu) armFirstGesture();
}

engine.start();
loading?.done();

/**
 * Portal handshake. `loaded()` takes the portal's own loading screen down, and
 * the gameplay bracket has to follow real play rather than the page lifetime —
 * both portals use it for session analytics and Yandex certification checks it.
 */
/**
 * What an ad has to do to the game: stop the clock, stop the gameplay bracket
 * and mute the master bus. Injected rather than imported, so core/portal.js
 * stays free of any dependency on audio or ui.
 */
portal.onPause = () => {
  portal.gameplayStop();
  // `time`, not `t` — `t` is the i18n lookup at module scope and shadowing it
  // here reads like a bug even though it is not one.
  const time = engine.ctx.time;
  portal._adScale = time.scale;
  time.scale = 0;
  engine.ctx.peek('audio')?.setMasterVolume?.(0);
};
portal.onResume = () => {
  const time = engine.ctx.time;
  time.scale = portal._adScale ?? 1;
  engine.ctx.peek('audio')?.setMasterVolume?.(1);
  if (!engine.ctx.peek('ui')?.menu?.open) portal.gameplayStart();
};

// The dev server appends ?t= for HMR, which makes a dynamic import of the same
// path a DIFFERENT module instance. Expose the real singleton so the ad path can
// actually be exercised from the console.
window.__PORTAL__ = portal;

portal.loaded();
portal.gameplayStart();
engine.events.on('ui:pause', ({ paused }) => {
  if (paused) portal.gameplayStop();
  else portal.gameplayStart();
});
/**
 * Bank on pause as well as on leaving. Without this an unlock earned during a
 * session would not appear until the player closed the tab and came back, so the
 * pause menu — the one place the loadout lives — would show the reward a whole
 * session late. `bank()` is declared below and hoisted.
 */
engine.events.on('ui:pause', ({ paused }) => {
  if (paused) bank();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) portal.gameplayStop();
  else if (!engine.ctx.peek('ui')?.menu?.open) portal.gameplayStart();
});

/**
 * CAREER BANKING.
 *
 * There is no round end to hang this off — a TDM match here runs until the
 * player leaves — so the session is banked when the tab goes away. `pagehide`
 * plus `visibilitychange` is the pair that actually covers mobile: iOS Safari
 * frequently never fires `pagehide` when the app is backgrounded or the tab is
 * discarded, and `beforeunload` is unreliable on every mobile browser. Banking
 * is idempotent through `_banked`, so firing both costs nothing.
 *
 * A kill is a `damage:dealt` with `killed` whose target is NOT the player —
 * enemies killing each other in a crossfire are somebody's kill, but not ours.
 */
const session = { kills: 0, streak: 0, best: 0, start: performance.now() };
engine.events.on('damage:dealt', (e) => {
  if (!e?.killed) return;
  const target = e.target;
  const isPlayer = target === 'player' || target === engine.ctx.peek('player') || target?.isPlayer === true;
  if (isPlayer) {
    session.streak = 0;
    return;
  }
  session.kills++;
  session.streak++;
  if (session.streak > session.best) session.best = session.streak;
});

/**
 * Idempotent through the zero-kill guard rather than a one-shot flag: a player
 * who tabs away and comes back must keep earning, so what is banked is drained
 * instead of latched. The live streak survives the drain — the player is still
 * alive and still on it.
 */
function bank() {
  if (session.kills === 0) return;
  bankSession({
    kills: session.kills,
    best: session.best,
    seconds: (performance.now() - session.start) / 1000,
  });
  session.kills = 0;
  session.best = session.streak;
  session.start = performance.now();
}
addEventListener('pagehide', bank);
// Exit-to-menu navigates away, and `pagehide` ordering is not something a career
// should depend on. The pause menu emits this so the drain happens first.
engine.ctx.events.on('session:bank', bank);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) bank();
});


// Capture harness handshake: only flag ready once a frame has actually landed.
//
// BOOT_FRAMES is deliberately a frame COUNT, not a rAF race. In lockstep mode the
// engine has no loop of its own, so we hand-pump exactly this many frames and only
// then raise __READY__; the shot is therefore always applied at engine frame 3, no
// matter how long boot (or pre-warm) took in wall-clock terms.
const BOOT_FRAMES = 3;
if (lockstep) {
  await shotApi.pump(BOOT_FRAMES);
  window.__READY__ = true;
} else {
  let warm = 0;
  const readyProbe = () => {
    if (++warm >= BOOT_FRAMES) {
      window.__READY__ = true;
      return;
    }
    requestAnimationFrame(readyProbe);
  };
  requestAnimationFrame(readyProbe);
}

window.__ENGINE__ = engine;

/**
 * Time-to-playable, measured from navigation start — the one number both
 * portals grade on (CrazyGames: <=20 s hard, <10 s to hit their conversion
 * benchmark). It has to be read on REAL hardware: most of boot is the material
 * generator rendering to WebGLRenderTargets, and a headless/software rasterizer
 * inflates exactly that, so the harness number is an upper bound, not a
 * measurement. ponytail: console.log, not a HUD — this is a dev instrument.
 */
console.log(`[boot] playable in ${Math.round(performance.now())} ms`);

/**
 * F8 copies the diagnostic log to the clipboard.
 *
 * The `[hitch]` and `[warp]` lines only mean anything when they come from a real
 * machine with a real GPU at a real frame rate, which means the person reading
 * them is never the person playing. Asking a player to open devtools, filter a
 * console and select text mid-session is enough friction that the evidence just
 * does not arrive. One key does instead.
 *
 * Wrapping console.warn rather than teaching each logger about a buffer keeps
 * the loggers unaware of this entirely — they print, this collects.
 */
{
  const LOG = [];
  const realWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const first = String(args[0] ?? '');
    if (first.startsWith('[hitch]') || first.startsWith('[warp]')) {
      // Keep the tail: the interesting run is the one that just happened.
      if (LOG.length > 400) LOG.shift();
      LOG.push(`${(performance.now() / 1000).toFixed(1)}s ${args.join(' ')}`);
    }
    realWarn(...args);
  };
  window.__LOG__ = LOG;
  addEventListener(
    'keydown',
    (ev) => {
      if (ev.code !== 'F8') return;
      ev.preventDefault();
      const gpu = (() => {
        try {
          const gl = engine.ctx.get('render').renderer.getContext();
          const d = gl.getExtension('WEBGL_debug_renderer_info');
          return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
        } catch {
          return 'unknown';
        }
      })();
      const head = [
        `hotline-strike diagnostics`,
        `gpu: ${gpu}`,
        `quality: ${engine.ctx.config.quality}  map: ${engine.ctx.config.map}`,
        `boot: ${Math.round(performance.now())} ms elapsed  frame ${engine.time.frame}`,
        `entries: ${LOG.length}`,
        '',
      ].join('\n');
      const text = head + (LOG.length ? LOG.join('\n') : '(no hitches or warps recorded)');
      navigator.clipboard
        ?.writeText(text)
        .then(() => console.info(`[diag] copied ${LOG.length} entries to clipboard`))
        .catch(() => console.info('[diag] clipboard blocked — read window.__LOG__ instead'));
    },
    true
  );
  console.info('[diag] press F8 to copy the hitch/warp log to the clipboard');
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => engine.dispose());
}
