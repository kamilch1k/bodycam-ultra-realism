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
import { showMainMenu } from './ui/mainmenu.js';
import { portal } from './core/portal.js';
import { TouchControls, isTouchDevice } from './core/touch.js';
import { AimAssist } from './player/assist.js';
import { setLang } from './core/i18n.js';
import { loadCareer, bankSession } from './core/save.js';
import { armFirstGesture } from './core/fullscreen.js';

const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
// Deterministic shutter for the pixel gate: the engine does not schedule its own
// frames, the driver advances exactly N of them through window.__PUMP__. Opt-in,
// because tools that measure real frame pacing (tools/perf.mjs) need the loop to
// free-run. See the long comment in src/dev/shots.js.
const lockstep = capture && params.get('lockstep') === '1';
const canvas = document.getElementById('game');

/**
 * FRONT END FIRST, ENGINE BEHIND IT.
 *
 * The menu is plain DOM and paints before any 3D work starts. Its selected map
 * then builds and pre-warms while the menu remains usable; changing the map
 * cancels that warm-up and serially replaces the stopped engine. Play waits for
 * the matching build, so gameplay never inherits half-warmed resources.
 *
 * The menu is SKIPPED for `?capture=1` (the pixel harness drives boot itself),
 * whenever `?map=` names a level outright (so every tool, probe and deep link
 * still boots straight into the game), and for `?menu=0`.
 */
const sameChoice = (a, b) => a?.map === b?.map && a?.mode === b?.mode;

function abortError() {
  const err = new Error('Engine build superseded');
  err.name = 'AbortError';
  return err;
}

function showBootFailure(err) {
  console.error('[boot] init failed', err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:0;padding:2rem;color:#f66;background:#000;
       font:12px/1.5 ui-monospace,monospace;overflow:auto;z-index:9999;white-space:pre-wrap">
BOOT FAILURE\n\n${err.stack ?? err.message}</pre>`
  );
}

/** Build a fully initialised but STOPPED engine for one menu choice. */
async function buildEngine(choice, { paced = false, budgetMs = 4, signal } = {}) {
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

  const engine = new Engine({ canvas, config });
  let disposed = false;
  const disposeOnce = () => {
    if (disposed) return;
    disposed = true;
    try {
      engine.dispose();
    } catch (disposeErr) {
      console.warn('[boot] partial engine cleanup failed:', disposeErr);
    }
  };

  try {
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
      // A selection change is not a boot failure. init() itself is not
      // interruptible, so the signal may only be observed once it returns/throws.
      if (signal?.aborted) throw abortError();
      showBootFailure(err);
      throw err;
    }

    // A stopped engine is built behind the front menu, but init() has already
    // attached the global mouse/keyboard listeners. Keep them inert until Play:
    // otherwise a map-card click requests pointer lock, moves the cursor to the
    // viewport centre and can make the next menu click land on the wrong element.
    if (paced) {
      engine.input.enabled = false;
      engine.input.lockSuppressed = true;
    }

    if (signal?.aborted) throw abortError();

    // A paced menu build does not own the page yet. installShotApi's free-run
    // diagnostics schedule a persistent rAF loop and publish globals, so defer
    // them until this engine is the selected build instead of retaining every
    // aborted/replaced engine forever.
    const shotApi = paced ? null : installShotApi(engine, { capture, lockstep });

    /**
     * Arcade maps pre-warm by default; street keeps its explicit opt-in because
     * its material set is much larger. The menu path admits one coarse driver job
     * per animation frame, keeping selection/fullscreen/Play responsive. Direct
     * links and capture retain the old blocking order for deterministic tooling.
     */
    const prewarmParam = params.get('prewarm');
    const wantPrewarm =
      prewarmParam === '1' || (prewarmParam !== '0' && config.map !== 'street');
    const progress = {
      status: wantPrewarm ? 'running' : 'skipped',
      progress: 0,
      map: config.map,
    };
    window.__PREWARM__ = progress;

    const warmup = wantPrewarm
      ? await prewarm(engine, {
        transients: capture ? false : (params.get('warm') ?? 'play'),
        paced,
        budgetMs,
        signal,
        onProgress: (value) => {
          // A later map build owns the global once it starts.
          if (window.__PREWARM__ === progress) progress.progress = value;
        },
      })
      : { ok: false, reason: `off for map "${config.map}" — ?prewarm=1 to force` };

    Object.assign(progress, warmup, {
      status: warmup.aborted
        ? 'aborted'
        : wantPrewarm
          ? warmup.ok ? 'done' : 'failed'
          : 'skipped',
      progress: warmup.aborted ? progress.progress : 1,
    });
    console.info('[boot] prewarm', warmup);

    if (signal?.aborted || warmup.aborted) throw abortError();

    return { choice: { ...choice }, config, engine, shotApi, warmup };
  } catch (err) {
    // Until return transfers ownership to the caller, every failure path owns
    // exactly one cleanup attempt. Cleanup must never replace the real cause.
    disposeOnce();
    throw err;
  }
}

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
let built;
if (skipMenu) {
  const choice = {
    map: params.get('map') ?? DEFAULTS.map,
    mode: params.get('mode') ?? DEFAULTS.mode,
  };
  // Capture, deep links and ?menu=0 retain the deterministic blocking path.
  built = await buildEngine(choice);
} else {
  const menu = showMainMenu({ map: params.get('map'), mode: params.get('mode') });

  // Resolve in the second rAF callback: the first callback allows the DOM menu
  // to paint before procedural generation starts occupying the main thread.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  portal.loaded();
  console.log(`[boot] menu interactive in ${Math.round(performance.now())} ms`);

  let serial = Promise.resolve(null);
  let pending = serial;
  let requested = menu.choice;
  let controller = null;

  const schedule = (nextChoice) => {
    const choiceForBuild = { ...nextChoice };
    requested = choiceForBuild;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;

    pending = serial = serial.then(async (previous) => {
      previous?.engine?.dispose();
      if (signal.aborted) return null;
      try {
        return await buildEngine(choiceForBuild, { paced: true, budgetMs: 4, signal });
      } catch (err) {
        if (err?.name === 'AbortError' || signal.aborted) return null;
        return { choice: choiceForBuild, error: err };
      }
    });
    return pending;
  };

  const stopWatching = menu.changed(schedule);
  schedule(requested);

  const chosen = await menu.play;
  menu.setBusy(true);
  if (!sameChoice(requested, chosen)) schedule(chosen);

  // Selection is disabled after Play, but loop defensively in case its click
  // shared a task with an already queued change notification.
  while (!built || !sameChoice(built.choice, chosen)) {
    const awaited = pending;
    const result = await awaited;
    if (awaited !== pending) continue;
    if (result?.error) throw result.error;
    if (result && sameChoice(result.choice, chosen)) built = result;
    else schedule(chosen);
  }

  stopWatching();
  menu.done();
}

const { config, engine } = built;
const shotApi = built.shotApi ?? installShotApi(engine, { capture, lockstep });

// Direct links were never gated; for the menu path this hands input ownership
// to gameplay only after the matching engine is fully warm and the menu is gone.
engine.input.enabled = true;
engine.input.lockSuppressed = false;

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
  // Spell this out: ad callbacks manipulate the engine clock, not wall time.
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

// The menu path sent this immediately after its first paint. A direct/capture
// path has no interactive front end, so it becomes ready only now.
if (skipMenu) portal.loaded();
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
