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
import { UiSystem } from './ui/index.js';
import { AudioSystem } from './audio/index.js';

import { installShotApi } from './dev/shots.js';
import { prewarm } from './core/prewarm.js';
import { showMainMenu, showLoading, MAPS } from './ui/mainmenu.js';
import { portal } from './core/portal.js';
import { TouchControls, isTouchDevice } from './core/touch.js';
import { AimAssist } from './player/assist.js';

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

const skipMenu = capture || params.has('map') || params.get('menu') === '0';
const choice = skipMenu
  ? { map: params.get('map') ?? DEFAULTS.map, mode: params.get('mode') ?? DEFAULTS.mode }
  : await showMainMenu({ map: params.get('map'), mode: params.get('mode') });

// Put the loading screen up and let it actually paint before anything blocks:
// engine.init() holds the main thread, so a frame has to land first or the
// overlay never appears.
const loading = skipMenu ? null : showLoading(MAPS.find((m) => m.id === choice.map)?.name ?? choice.map);
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
  ? await prewarm(engine)
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
  const t = engine.ctx.time;
  portal._adScale = t.scale;
  t.scale = 0;
  engine.ctx.peek('audio')?.setMasterVolume?.(0);
};
portal.onResume = () => {
  const t = engine.ctx.time;
  t.scale = portal._adScale ?? 1;
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden) portal.gameplayStop();
  else if (!engine.ctx.peek('ui')?.menu?.open) portal.gameplayStart();
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => engine.dispose());
}
