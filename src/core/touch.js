/**
 * TOUCH CONTROLS — the portal build's primary input.
 *
 * Feeds the SAME channels the gamepad and mouse already use rather than adding
 * a third input path through gameplay:
 *
 *   left thumb   -> `input.touch.moveX/moveY`, summed into `moveVector`
 *   right thumb  -> `input._rawLook`, exactly as a mouse delta, so sensitivity
 *                   and invertY apply for free
 *   buttons      -> `input.down` with the same codes a keyboard/mouse produces
 *
 * `input.touch` is deliberately NOT `input.stick`: `_pollGamepad` zeroes the
 * stick every frame when no pad is present, which would wipe touch input on the
 * very next poll.
 *
 * LAYOUT. Left half is the move stick, right half is a look pad — the layout
 * every mobile shooter uses, because it is the only one that survives being
 * held in two hands. Both are FLOATING: the stick appears wherever the thumb
 * lands instead of at a fixed rosette, so the player never has to look down to
 * find it. Buttons sit along the right edge, above the look pad's resting
 * thumb position.
 *
 * The overlay is plain DOM over the canvas, not drawn in the scene: it costs no
 * draw calls, it scales with the viewport for free, and it stays crisp on a
 * device pixel ratio the renderer is deliberately not running at.
 */

/** Radius in px at which the move stick reads fully deflected. */
const STICK_RANGE = 62;
/** Movement in px before a look drag is believed — kills thumb jitter at rest. */
const LOOK_DEADZONE = 1.5;

const CSS = `
.ht-touch{position:fixed;inset:0;z-index:40;touch-action:none;-webkit-user-select:none;
  user-select:none;-webkit-tap-highlight-color:transparent;pointer-events:none}
.ht-touch .z{position:absolute;pointer-events:auto}
.ht-move{left:0;bottom:0;width:46%;height:62%}
.ht-look{right:0;top:0;width:54%;height:100%}
.ht-stick{position:absolute;width:132px;height:132px;margin:-66px 0 0 -66px;
  border-radius:50%;border:2px solid rgba(255,255,255,.22);
  background:radial-gradient(circle,rgba(255,255,255,.06),rgba(255,255,255,.02));
  opacity:0;transition:opacity .12s;pointer-events:none}
.ht-stick i{position:absolute;left:50%;top:50%;width:56px;height:56px;
  margin:-28px 0 0 -28px;border-radius:50%;background:rgba(255,255,255,.30);
  border:2px solid rgba(255,255,255,.5)}
.ht-btn{position:absolute;border-radius:50%;display:flex;align-items:center;
  justify-content:center;font:600 12px/1 system-ui,sans-serif;letter-spacing:.06em;
  color:#e8eef6;background:rgba(12,18,26,.44);border:2px solid rgba(255,255,255,.26);
  text-transform:uppercase;pointer-events:auto}
.ht-btn.on{background:rgba(90,150,220,.55);border-color:#cfe2ff}
.ht-fire{right:16px;bottom:16px;width:104px;height:104px;font-size:14px}
.ht-ads{right:132px;bottom:34px;width:78px;height:78px}
.ht-reload{right:24px;bottom:132px;width:66px;height:66px}
.ht-jump{right:112px;bottom:140px;width:60px;height:60px}
.ht-crouch{right:36px;bottom:210px;width:60px;height:60px}
/* Top-left, diagonally opposite the fire button and outside both thumb arcs —
   pause is the one control that must never be hit by accident mid-firefight. */
.ht-pause{left:14px;top:14px;width:46px;height:46px;font-size:15px}
@media (max-height:420px){
  .ht-fire{width:84px;height:84px}
  .ht-ads{right:110px;width:64px;height:64px}
}
`;

/** True when this device is primarily touch-driven. */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  // maxTouchPoints alone is true on plenty of touch-capable laptops, where the
  // player still has a mouse and would rather use it.
  return !!(touch && coarse);
}

export class TouchControls {
  /**
   * @param {HTMLElement} host   element to mount into (document.body)
   * @param {object} input       the engine's Input
   */
  constructor(host, input) {
    this.input = input;
    this.enabled = true;
    input.touch = { moveX: 0, moveY: 0 };

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'ht-touch';
    root.innerHTML = `
      <div class="z ht-move"><div class="ht-stick"><i></i></div></div>
      <div class="z ht-look"></div>
      <button class="ht-btn ht-fire z" type="button">Fire</button>
      <button class="ht-btn ht-ads z" type="button">Aim</button>
      <button class="ht-btn ht-reload z" type="button">R</button>
      <button class="ht-btn ht-jump z" type="button">Jump</button>
      <button class="ht-btn ht-crouch z" type="button">Duck</button>
      <button class="ht-btn ht-pause z" type="button" aria-label="Pause">II</button>`;
    host.appendChild(root);
    this.root = root;

    this.moveZone = root.querySelector('.ht-move');
    this.lookZone = root.querySelector('.ht-look');
    this.stickEl = root.querySelector('.ht-stick');
    this.knobEl = root.querySelector('.ht-stick i');

    /** pointerId -> state, so two thumbs never fight over one origin. */
    this._move = null;
    this._look = null;

    this._bindStick();
    this._bindLook();
    this._bindButton('.ht-fire', 'Mouse0');
    this._bindButton('.ht-ads', 'Mouse2', true);
    this._bindButton('.ht-reload', 'KeyR');
    this._bindButton('.ht-jump', 'Space');
    this._bindButton('.ht-crouch', 'ControlLeft', true);
    /**
     * The only way into the pause menu on a phone. Escape was it before, and a
     * touch device has no Escape — so settings, sensitivity and the loadout were
     * all unreachable on the exact platform this build is FOR.
     */
    this._bindButton('.ht-pause', 'Escape');
  }

  _bindStick() {
    const z = this.moveZone;
    const set = (dx, dy) => {
      const len = Math.hypot(dx, dy);
      const k = len > STICK_RANGE ? STICK_RANGE / len : 1;
      const nx = (dx * k) / STICK_RANGE;
      const ny = (dy * k) / STICK_RANGE;
      this.input.touch.moveX = nx;
      // Screen down is +y; forward is -y.
      this.input.touch.moveY = ny;
      this.knobEl.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    };
    z.addEventListener('pointerdown', (e) => {
      if (this._move !== null) return;
      this._move = e.pointerId;
      z.setPointerCapture(e.pointerId);
      this._ox = e.clientX;
      this._oy = e.clientY;
      this.stickEl.style.left = `${e.clientX}px`;
      this.stickEl.style.top = `${e.clientY}px`;
      this.stickEl.style.opacity = '1';
      set(0, 0);
      e.preventDefault();
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._move) return;
      set(e.clientX - this._ox, e.clientY - this._oy);
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId !== this._move) return;
      this._move = null;
      this.input.touch.moveX = 0;
      this.input.touch.moveY = 0;
      this.stickEl.style.opacity = '0';
      this.knobEl.style.transform = '';
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  _bindLook() {
    const z = this.lookZone;
    z.addEventListener('pointerdown', (e) => {
      if (this._look !== null) return;
      this._look = e.pointerId;
      z.setPointerCapture(e.pointerId);
      this._lx = e.clientX;
      this._ly = e.clientY;
      e.preventDefault();
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._look) return;
      const dx = e.clientX - this._lx;
      const dy = e.clientY - this._ly;
      this._lx = e.clientX;
      this._ly = e.clientY;
      if (Math.abs(dx) < LOOK_DEADZONE && Math.abs(dy) < LOOK_DEADZONE) return;
      /**
       * Straight into `_rawLook`, the same accumulator a mouse writes to. The
       * frame's sensitivity scaling and invertY are applied downstream in
       * `beginFrame`, so a touch drag and a mouse move are the same event by
       * the time anything gameplay-side sees them.
       */
      this.input._rawLook.x += dx;
      this.input._rawLook.y += dy;
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId !== this._look) return;
      this._look = null;
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  /**
   * @param {string} sel
   * @param {string} code   the key/mouse code to hold while pressed
   * @param {boolean} [toggle]  latch instead of hold — aiming and crouching are
   *                            states you want to stay in without a held thumb
   */
  _bindButton(sel, code, toggle = false) {
    const b = this.root.querySelector(sel);
    const inp = this.input;
    /**
     * Queue through `_pendingDown`/`_pendingUp`, NOT straight into `input.down`.
     *
     * `beginFrame` is what turns a pending code into a press EDGE, and the edge
     * is the only thing `actionPressed` can see. Writing into `down` directly
     * skips that step entirely, so a held state (aim, crouch) worked but every
     * edge-triggered action silently did nothing — which is why the touch reload
     * button did nothing at all: weapons reads `actionPressed('reload')`, and
     * that set was never populated. Same reason a pause button was impossible
     * before this change.
     */
    if (toggle) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const on = !inp.down.has(code);
        if (on) inp._pendingDown.add(code);
        else inp._pendingUp.add(code);
        b.classList.toggle('on', on);
      });
      return;
    }
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      inp._pendingDown.add(code);
      b.classList.add('on');
    });
    const up = (e) => {
      e.preventDefault();
      inp._pendingUp.add(code);
      b.classList.remove('on');
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }

  setVisible(on) {
    this.root.style.display = on ? '' : 'none';
    if (!on) {
      this.input.touch.moveX = 0;
      this.input.touch.moveY = 0;
    }
  }

  dispose() {
    this.root.remove();
  }
}
