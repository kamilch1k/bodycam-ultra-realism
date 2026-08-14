import { el, setText, setStyle, clamp, damp, ease } from './util.js';
import { t } from '../core/i18n.js';

const PRESETS = ['low', 'medium', 'high', 'ultra'];

/**
 * The advanced switches, in the order they cost frame time on the web profile.
 * Shadows first because they are 1.3 ms of a 4.5 ms frame at 1080p — 326 of the
 * frame's 644 draw calls and 3.0M of its 5.1M triangles.
 */
const FEATURES = [
  ['shadows', 'Sun Shadows'],
  ['contact', 'Contact Shadows'],
  ['gtao', 'Ambient Occlusion'],
  ['ssr', 'Screen-Space Reflections'],
  ['volumetrics', 'Volumetric Light'],
  ['bloom', 'Bloom'],
  ['motionBlur', 'Motion Blur'],
  ['dof', 'Depth Of Field'],
  ['taa', 'Temporal AA'],
];

/**
 * Pause / settings menu.
 *
 * Wired straight into `ctx.config`: the quality segments call
 * `config.setQuality`, the sliders write `config.sensitivity` and `config.fov`
 * (and push the FOV into the live camera), and every change is announced on the
 * event bus so render/player can react without importing this module.
 *
 * Events emitted: `ui:pause` {paused}, `ui:quality` {quality},
 * `ui:sensitivity` {value}, `ui:fov` {value}, `ui:setting` {key, value}.
 */
export class PauseMenu {
  constructor(parent, ctx) {
    this.ctx = ctx;
    this.root = el('div', 'ow-menu', parent);
    const inner = el('div', 'ow-menu-inner', this.root);

    el('h1', null, inner, t('menu.paused'));
    el('div', 'sub', inner, 'HOTLINE STRIKE — RAPID RESPONSE');
    el('div', 'rule', inner);

    this.rows = el('div', null, inner);

    // ---- quality preset --------------------------------------------------
    this.qBtns = [];
    const qRow = this._row('Graphics Preset');
    const seg = el('div', 'ow-seg', qRow);
    for (const p of PRESETS) {
      const b = el('button', null, seg, p);
      b.type = 'button';
      b.addEventListener('click', () => this.setQuality(p));
      this.qBtns.push(b);
    }

    /**
     * The optic, muzzle, magazine, stock and finish rows used to live here,
     * between the shadow toggle and the sensitivity slider. They are the game's
     * whole progression economy now and they have their own screen — see
     * ui/gunsmith.js, bound to B. What is left in this menu is settings.
     */

    // ---- advanced graphics ------------------------------------------------
    /**
     * Per-effect switches, live, on top of the preset.
     *
     * A preset is a single dial and it is the wrong shape for "the shadows cost
     * me a third of my frame but I want to keep the bloom". These call straight
     * into the render subsystem's `setFeature`, which gates each pass behind a
     * getter — no reload, no pipeline rebuild.
     *
     * A preset that never CONSTRUCTED a pass cannot switch it on (the object
     * does not exist), so those rows render disabled and say why rather than
     * offering a dead toggle. Raise the preset and they come alive.
     */
    this.advOpen = false;
    const advRow = this._row('Advanced');
    this.advBtn = el('button', 'ow-btn', advRow, 'Show');
    this.advBtn.type = 'button';
    this.advBtn.addEventListener('click', () => {
      this.advOpen = !this.advOpen;
      setText(this.advBtn, this.advOpen ? 'Hide' : 'Show');
      setStyle(this.adv, 'display', this.advOpen ? '' : 'none');
      if (this.advOpen) this.syncFromConfig();
    });
    this.adv = el('div', null, this.rows);
    setStyle(this.adv, 'display', 'none');
    this.featBtns = [];
    for (const [key, label] of FEATURES) {
      const r = el('div', 'ow-row', this.adv);
      el('div', 'name', r, label.toUpperCase());
      const seg = el('div', 'ow-seg', r);
      const pair = [];
      for (const [txt, on] of [
        ['off', false],
        ['on', true],
      ]) {
        const b = el('button', null, seg, txt);
        b.type = 'button';
        b.addEventListener('click', () => {
          this._setFeature(key, on);
          this.ctx.events.emit('ui:setting', { key: `gfx.${key}`, value: on });
          this.syncFromConfig();
        });
        pair.push([b, on]);
      }
      const note = el('div', 'val', r, '');
      this.featBtns.push({ key, pair, note });
    }

    // ---- sensitivity -----------------------------------------------------
    this.sens = this._slider('Mouse Sensitivity', 0.2, 3.0, 0.01, (v) => {
      this.ctx.config.sensitivity = 0.0022 * v;
      this.ctx.events.emit('ui:sensitivity', { value: this.ctx.config.sensitivity, multiplier: v });
      return v.toFixed(2);
    });

    // ---- field of view ---------------------------------------------------
    this.fov = this._slider('Field Of View', 65, 120, 1, (v) => {
      this.ctx.config.fov = v;
      const cam = this.ctx.camera;
      if (cam) {
        cam.fov = v;
        cam.updateProjectionMatrix();
      }
      this.ctx.events.emit('ui:fov', { value: v });
      return String(v | 0);
    });

    // ---- invert look -----------------------------------------------------
    const invRow = this._row('Invert Look');
    const invSeg = el('div', 'ow-seg', invRow);
    this.invBtns = [];
    for (const [label, val] of [
      ['off', false],
      ['on', true],
    ]) {
      const b = el('button', null, invSeg, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.ctx.config.invertY = val;
        this.ctx.events.emit('ui:setting', { key: 'invertY', value: val });
        this.syncFromConfig();
      });
      this.invBtns.push([b, val]);
    }

    // ---- buttons ---------------------------------------------------------
    const btns = el('div', 'ow-btns', inner);
    this.resumeBtn = el('button', 'ow-btn primary', btns, t('menu.resume'));
    this.resumeBtn.type = 'button';
    this.resumeBtn.addEventListener('click', () => this.close());
    // Mouse-only route to the loadout, for a player who never learns the B key.
    // `onLoadout` is injected by UiSystem — the menu must not reach across to a
    // sibling screen itself.
    const loadout = el('button', 'ow-btn', btns, t('menu.loadout'));
    loadout.type = 'button';
    loadout.addEventListener('click', () => this.onLoadout?.());
    /**
     * EXIT TO MENU — a navigation, not a teardown.
     *
     * Disposing the engine and re-showing the front end in place would be the
     * elegant version and is not worth the risk: every subsystem would have to
     * release its GPU resources perfectly or the second boot leaks a context.
     * Navigating to the bare path re-runs the whole load, which the menu is
     * already built to cover, and drops any `?map=`/`?mode=` so the front end
     * actually appears instead of being skipped.
     *
     * The session is banked first — `pagehide` fires on navigation, but relying
     * on that ordering to save a career is how a career gets lost.
     */
    const exit = el('button', 'ow-btn', btns, t('menu.exit'));
    exit.type = 'button';
    exit.addEventListener('click', () => {
      try {
        this.ctx.events?.emit('session:bank');
      } catch {
        /* a save that fails must not trap the player in the match */
      }
      location.href = location.pathname;
    });
    const reset = el('button', 'ow-btn', btns, 'Defaults');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.sens.set(1);
      this.fov.set(80);
      this.ctx.config.invertY = false;
      this.setQuality('ultra');
    });
    el('div', 'hint', inner, 'ESC RESUME · WASD MOVE · SHIFT SPRINT · R RELOAD · F USE');

    this.open = false;
    this.shown = 0;
    setStyle(this.root, 'display', 'none');
    setStyle(this.root, 'cursor', 'default');
    this.syncFromConfig();
  }

  _row(name) {
    const r = el('div', 'ow-row', this.rows);
    el('div', 'name', r, name.toUpperCase());
    return r;
  }

  _slider(name, min, max, step, apply) {
    const row = this._row(name);
    const wrap = el('div', 'ow-slider', row);
    el('div', 'track', wrap);
    const fill = el('div', 'fill', wrap);
    const knob = el('div', 'knob', wrap);
    const input = el('input', null, wrap);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const val = el('div', 'val', row, '');

    const paint = (v) => {
      const t = (v - min) / (max - min);
      setStyle(fill, 'width', (t * 100).toFixed(2) + '%');
      setStyle(knob, 'left', (t * 100).toFixed(2) + '%');
      setText(val, apply(v) ?? String(v));
    };
    input.addEventListener('input', () => paint(parseFloat(input.value)));
    const api = {
      set: (v) => {
        const c = clamp(v, min, max);
        input.value = String(c);
        paint(c);
      },
    };
    return api;
  }

  /**
   * Volumetric light lives in `sky`, everything else in `render` — the panel is
   * the only place that has to know which, so the two subsystems stay unaware
   * of each other.
   */
  _setFeature(key, on) {
    if (key === 'volumetrics') {
      const v = this.ctx.peek('sky')?.volumetrics;
      if (v?.marchAvailable) v.marchEnabled = !!on;
      return;
    }
    this.ctx.peek('render')?.setFeature?.(key, on);
  }

  _featureState(key) {
    if (key === 'volumetrics') {
      const v = this.ctx.peek('sky')?.volumetrics;
      return { available: !!v?.marchAvailable, on: !!v?.marchEnabled };
    }
    const r = this.ctx.peek('render');
    if (!r) return { available: false, on: false };
    return { available: !!r.featureAvailable?.(key), on: !!r.opt?.[key] };
  }

  setQuality(name) {
    try {
      this.ctx.config.setQuality(name);
      this.ctx.events.emit('ui:quality', { quality: name });
    } catch (err) {
      console.warn('[ui] quality switch failed', err);
    }
    this.syncFromConfig();
  }

  syncFromConfig() {
    const cfg = this.ctx.config;
    for (let i = 0; i < this.qBtns.length; i++)
      this.qBtns[i].classList.toggle('on', PRESETS[i] === cfg.quality);
    for (const [b, v] of this.invBtns) b.classList.toggle('on', !!cfg.invertY === v);
    for (const f of this.featBtns ?? []) {
      const st = this._featureState(f.key);
      for (const [b, v] of f.pair) {
        b.classList.toggle('on', st.available && st.on === v);
        b.disabled = !st.available;
        setStyle(b, 'opacity', st.available ? '' : '0.35');
      }
      setText(f.note, st.available ? '' : 'preset');
    }
    this.sens?.set((cfg.sensitivity ?? 0.0022) / 0.0022);
    this.fov?.set(cfg.fov ?? 80);
  }

  toggle() {
    this.open ? this.close() : this.show();
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.syncFromConfig();
    setStyle(this.root, 'display', '');
    // Release the cursor AND stop anything re-grabbing it: a click on a setting
    // must land on the setting, not be swallowed by a re-lock.
    if (this.ctx.input) this.ctx.input.lockSuppressed = true;
    document.exitPointerLock?.();
    const time = this.ctx.time;
    if (time) {
      this._prevScale = time.scale;
      time.scale = 0;
    }
    this.ctx.peek('player')?.setControlEnabled?.(false);
    this.ctx.events.emit('ui:pause', { paused: true });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    const time = this.ctx.time;
    if (time) time.scale = this._prevScale ?? 1;
    this.ctx.peek('player')?.setControlEnabled?.(true);
    if (this.ctx.input) this.ctx.input.lockSuppressed = false;
    this.ctx.input?.requestPointerLock?.();
    this.ctx.events.emit('ui:pause', { paused: false });
  }

  /** Driven with unscaled time so the fade still runs while the game is frozen. */
  update(rawDt) {
    this.shown = damp(this.shown, this.open ? 1 : 0, 14, rawDt);
    if (this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      setStyle(this.root, 'pointer-events', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'pointer-events', this.open ? 'auto' : 'none');
    setStyle(this.root, 'opacity', ease.outQuad(this.shown).toFixed(3));
  }

  dispose() {
    this.root.remove();
  }
}
