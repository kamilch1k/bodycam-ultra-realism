import * as THREE from 'three';
import { Registry, EventBus } from './registry.js';
import { FIXED_DT, MAX_SUBSTEPS, MAX_FRAME_DT } from './config.js';

/** Frames longer than this get reported with a breakdown. ~1.5 frames at 60 Hz. */
const HITCH_S = 0.024;
import { Input } from './input.js';
import { Rng } from './rng.js';

/**
 * The Engine owns the frame loop and the shared context handed to every
 * subsystem. It does NOT know what any subsystem does — it only sequences them.
 *
 * Frame order:
 *   1. input.beginFrame()
 *   2. fixedUpdate(FIXED_DT) xN   — physics, deterministic gameplay
 *   3. update(dt)                 — animation, cameras, AI decisions
 *   4. lateUpdate(dt)             — anything that must observe final transforms
 *   5. render subsystem draws
 *   6. input.endFrame()
 */
export class Engine {
  constructor({ canvas, config }) {
    this.canvas = canvas;
    this.config = config;
    this.registry = new Registry();
    this.events = new EventBus();
    this.input = new Input(canvas, config);
    this.rng = new Rng(config.deterministic ? 0x5eed1234 : (Math.random() * 2 ** 32) >>> 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(config.fov, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';

    /** Separate scene+camera for the first-person viewmodel, drawn with its own
     *  near plane so hands/weapon never clip into world geometry. */
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(60, 1, 0.005, 12);

    this.time = {
      /** Seconds since start, scaled. */ elapsed: 0,
      /** Unscaled wall-clock seconds since start. */ raw: 0,
      /** Last frame delta, scaled and clamped. */ dt: 0,
      /** Fixed step. */ fixed: FIXED_DT,
      /** Interpolation alpha between the last two physics steps, 0..1. */ alpha: 0,
      /** Fixed steps run on the LAST frame. Read by the F3 overlay: a value
       *  that swings frame to frame means the accumulator is beating against
       *  the display refresh, which reads as stutter at a perfect frame rate. */
      steps: 0,
      scale: 1,
      frame: 0,
    };

    this.ctx = {
      engine: this,
      scene: this.scene,
      camera: this.camera,
      viewScene: this.viewScene,
      viewCamera: this.viewCamera,
      canvas,
      config,
      events: this.events,
      input: this.input,
      time: this.time,
      rng: this.rng,
      get: (id) => this.registry.get(id),
      peek: (id) => this.registry.peek(id),
      has: (id) => this.registry.has(id),
    };

    this._accum = 0;
    this._last = 0;
    this._running = false;
    this._onResize = () => this.resize();

    /** Per-system update cost, rewritten each frame, read only by _logHitch. */
    this._sysMs = new Map();
    this._gpuPrev = { programs: 0, geometries: 0, textures: 0 };
    this._hitches = 0;
    this._firstStep = 0;
  }

  add(SystemClass, opts) {
    this.registry.add(new SystemClass(opts));
    return this;
  }

  async init() {
    const order = this.registry.resolve();
    for (const sys of order) {
      const t0 = performance.now();
      await sys.init?.(this.ctx);
      const ms = performance.now() - t0;
      if (ms > 50) console.info(`[engine] ${sys.constructor.id} init ${ms.toFixed(0)}ms`);
    }
    this.input.attach();
    addEventListener('resize', this._onResize);
    this.resize();
    return this;
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    for (const sys of this.registry.with('resize')) sys.resize(w, h, this.ctx);
    this.events.emit('resize', { width: w, height: h });
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  stop() {
    this._running = false;
  }

  _loop(now) {
    if (!this._running) return;
    requestAnimationFrame(this._loop);
    this.step(now);
  }

  /** Advance one frame. Exposed so the capture harness can pump frames by hand. */
  step(now = performance.now()) {
    const t = this.time;
    /**
     * Clamp so a tab-switch, a breakpoint or a GC pause cannot teleport the
     * simulation.
     *
     * 50 ms is six fixed steps, deliberately UNDER MAX_SUBSTEPS: the
     * backlog-shedding branch below then never fires during play, and one hitch
     * can never advance the world by more than one clamp's worth. It used to be
     * 100 ms, which is 12 steps' worth of catch-up crammed into a single frame —
     * the player crosses most of a metre with no collision resolution in
     * between, ends up inside geometry, and gets ejected by depenetrate(). That
     * ejection is the "teleport". A stall now runs fractionally slow instead,
     * which nobody notices, rather than moving the player somewhere they never
     * walked, which everybody does.
     */
    // Keep the true duration for the hitch report — the clamp below is what the
    // simulation believes, but "50 ms" and "600 ms" need to read differently.
    const trueDt = Math.max(0, (now - this._last) / 1000);
    const rawDt = Math.min(MAX_FRAME_DT, trueDt);
    this._last = now;
    t.raw += rawDt;
    t.dt = rawDt * t.scale;
    t.elapsed += t.dt;
    t.frame++;

    this.input.beginFrame(rawDt);

    const mFixed = performance.now();
    this._accum += t.dt;
    let steps = 0;
    const fixedSystems = this.registry.with('fixedUpdate');
    while (this._accum >= FIXED_DT && steps < MAX_SUBSTEPS) {
      for (const sys of fixedSystems) sys.fixedUpdate(FIXED_DT, this.ctx);
      this._accum -= FIXED_DT;
      steps++;
    }
    t.steps = steps;
    if (steps === MAX_SUBSTEPS) this._accum = 0; // shed backlog rather than spiral
    t.alpha = this._accum / FIXED_DT;

    const mUpdate = performance.now();
    const sysMs = this._sysMs;
    // Must be cleared, not just overwritten: a system with lateUpdate and no
    // update is never touched by the loop below, so the += in the late loop
    // would keep adding to last frame's value and climb forever.
    sysMs.clear();
    for (const sys of this.registry.with('update')) {
      const s = performance.now();
      sys.update(t.dt, this.ctx);
      sysMs.set(sys.constructor.id, performance.now() - s);
    }
    const mLate = performance.now();
    for (const sys of this.registry.with('lateUpdate')) {
      const s = performance.now();
      sys.lateUpdate(t.dt, this.ctx);
      const id = sys.constructor.id;
      sysMs.set(id, (sysMs.get(id) ?? 0) + (performance.now() - s));
    }

    const mRender = performance.now();
    const renderSystem = this.registry.peek('render');
    if (typeof renderSystem?.render === 'function') renderSystem.render(this.ctx);
    const mEnd = performance.now();

    /**
     * Ignore the first couple of seconds — boot frames are legitimately enormous.
     *
     * The gate must be WALL CLOCK. A frame count is wrong because a struggling
     * machine is still in single digits when the interesting hitches happen, and
     * `t.raw` is wrong because it accumulates the CLAMPED dt: at 2 fps it
     * advances 0.1 s per real second, so a "2 second" gate on it never opens.
     * Both of those silently suppressed this log before anyone read a line of it.
     */
    if (this._firstStep === 0) this._firstStep = now;
    /**
     * Only report frames the PLAYER could feel.
     *
     * A paused game (scale 0, so zero fixed steps) and a tab that lost focus
     * both produce enormous frames that are not stutters — rAF throttles to
     * about 1 Hz on an unfocused tab, so opening DevTools to read this very log
     * manufactures 3-5 second "hitches" and floods out the real ones.
     */
    const playing = steps > 0 && !document.hidden;
    if (playing && trueDt > HITCH_S && now - this._firstStep > 2000) {
      this._logHitch(trueDt, steps, [mFixed, mUpdate, mLate, mRender, mEnd]);
    }

    this.input.endFrame();
  }

  /**
   * Report a long frame with its breakdown.
   *
   * A hitch is only actionable with attribution, and the attribution has to come
   * from the machine that actually hitches — timings measured headless are
   * software-rasteriser fiction and have already sent me chasing the wrong
   * subsystem more than once. So the shipping build reports its own long frames:
   * where the time went, which system spent it, and whether the frame also
   * compiled a shader or uploaded geometry — the two things that stall a WebGL
   * frame no matter how cheap the JavaScript was.
   */
  _logHitch(rawDt, steps, [mFixed, mUpdate, mLate, mRender, mEnd]) {
    if (++this._hitches > 40) return; // enough to diagnose; don't flood the console
    const worst = [...this._sysMs.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([, ms]) => ms >= 0.5)
      .slice(0, 3)
      .map(([id, ms]) => `${id} ${ms.toFixed(1)}`)
      .join(', ');

    const info = this.registry.peek('render')?.renderer?.info;
    const prev = this._gpuPrev;
    let gpu = '';
    // First report has no baseline to diff against — seeding it from zero made
    // the first line claim "+135 programs", i.e. the entire boot, as if it were
    // one frame's work.
    if (info && this._hitches === 1) {
      prev.programs = info.programs?.length ?? 0;
      prev.geometries = info.memory?.geometries ?? 0;
      prev.textures = info.memory?.textures ?? 0;
    }
    if (info) {
      const now = {
        programs: info.programs?.length ?? 0,
        geometries: info.memory?.geometries ?? 0,
        textures: info.memory?.textures ?? 0,
      };
      const d = [];
      for (const k of ['programs', 'geometries', 'textures']) {
        if (now[k] > prev[k]) d.push(`+${now[k] - prev[k]} ${k}`);
      }
      this._gpuPrev = now;
      if (d.length) gpu = `  | ${d.join(' ')}`;
    }

    /**
     * `outside` is the frame time this engine cannot account for: driver work,
     * compositing, GC, anything between our last statement and the next rAF.
     * It is the single most useful number here — a hitch that is nearly all
     * `outside` is not a JavaScript problem and no amount of profiling the
     * update loop will find it.
     */
    const outside = rawDt * 1000 - (mEnd - mFixed);
    console.warn(
      `[hitch] ${(rawDt * 1000).toFixed(0)}ms` +
        `  fixed ${(mUpdate - mFixed).toFixed(1)} (${steps} steps)` +
        `  update ${(mLate - mUpdate).toFixed(1)}` +
        `  late ${(mRender - mLate).toFixed(1)}` +
        `  render ${(mEnd - mRender).toFixed(1)}` +
        `  outside ${outside.toFixed(0)}` +
        (worst ? `  | ${worst}` : '') +
        gpu
    );
  }

  dispose() {
    this.stop();
    removeEventListener('resize', this._onResize);
    this.input.detach();
    for (const sys of [...this.registry.ordered].reverse()) sys.dispose?.();
    this.events.clear();
  }
}
