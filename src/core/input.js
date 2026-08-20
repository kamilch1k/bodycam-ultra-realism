/**
 * Input aggregation: keyboard, mouse (pointer-locked), and gamepad, exposed as
 * a stable per-frame snapshot so gameplay never touches raw DOM events.
 *
 * Edge queries (`pressed`, `released`) are valid only during the frame in which
 * the transition happened — read them in update(), not fixedUpdate().
 */

export const ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  prone: ['KeyZ'],
  sprint: ['ShiftLeft'],
  reload: ['KeyR'],
  use: ['KeyF'],
  melee: ['KeyV'],
  /** Pull the magazine and look at it — the only ammo readout this game has. */
  magCheck: ['KeyX'],
  leanLeft: ['KeyQ'],
  leanRight: ['KeyE'],
  swapWeapon: ['Digit1', 'Digit2', 'Tab'],
  grenade: ['KeyG'],
  flashlight: ['KeyT'],
  // B for the gunsmith — the buy/loadout key every shooter player already has in
  // their hand. G was taken by grenades.
  loadout: ['KeyB'],
  pause: ['Escape'],
};

export class Input {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;

    this.down = new Set(); // codes currently held
    this._pressed = new Set(); // went down this frame
    this._released = new Set(); // went up this frame
    this._pendingDown = new Set();
    this._pendingUp = new Set();

    /** Accumulated pointer delta for this frame, in radians after sensitivity. */
    this.look = { x: 0, y: 0 };
    this._rawLook = { x: 0, y: 0 };
    this.wheel = 0;
    this._pendingWheel = 0;

    this.pointerLocked = false;
    /** True for exactly one move event after a lock — see _onMouseMove. */
    this._freshLock = false;
    /** How often the per-frame look clamp has fired. Read by controls-check. */
    this.lookClamped = 0;
    /**
     * Set while a menu owns the cursor. The click that re-acquires pointer lock
     * is a CONVENIENCE for getting back into the game, and it has to be off
     * while the pause menu is up: without it, the first click on any setting
     * grabbed the cursor back, so the button never got pressed and the pointer
     * vanished to the middle of the screen. The menu is unusable with the very
     * input that opened it.
     */
    this.lockSuppressed = false;
    /**
     * True on the touch build. Pointer lock is meaningless without a cursor and
     * on mobile Safari/Chrome the request either no-ops or throws, so it is
     * refused outright rather than being suppressed — `lockSuppressed` is the
     * menu's temporary flag and gets cleared when the menu closes.
     */
    this.touchMode = false;
    this.enabled = true;
    /** Set true by capture mode so scripted shots aren't fought by real input. */
    this.frozen = false;

    this.gamepadIndex = null;
    this.stick = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 };
    /**
     * Touch movement, kept SEPARATE from `stick` on purpose: `_pollGamepad`
     * zeroes the stick every frame when no pad is present, which would wipe a
     * thumb's input on the very next poll. Touch look does not live here — it
     * goes straight into `_rawLook`, so it is a mouse delta by the time anything
     * downstream sees it. See core/touch.js.
     */
    this.touch = { moveX: 0, moveY: 0 };

    this._bound = {
      keydown: this._onKeyDown.bind(this),
      keyup: this._onKeyUp.bind(this),
      mousedown: this._onMouseDown.bind(this),
      mouseup: this._onMouseUp.bind(this),
      mousemove: this._onMouseMove.bind(this),
      wheel: this._onWheel.bind(this),
      lockchange: this._onLockChange.bind(this),
      blur: this._onBlur.bind(this),
      contextmenu: (e) => e.preventDefault(),
    };
  }

  attach() {
    addEventListener('keydown', this._bound.keydown);
    addEventListener('keyup', this._bound.keyup);
    addEventListener('mousedown', this._bound.mousedown);
    addEventListener('mouseup', this._bound.mouseup);
    addEventListener('mousemove', this._bound.mousemove);
    addEventListener('wheel', this._bound.wheel, { passive: true });
    addEventListener('blur', this._bound.blur);
    document.addEventListener('pointerlockchange', this._bound.lockchange);
    this.canvas.addEventListener('contextmenu', this._bound.contextmenu);
  }

  detach() {
    removeEventListener('keydown', this._bound.keydown);
    removeEventListener('keyup', this._bound.keyup);
    removeEventListener('mousedown', this._bound.mousedown);
    removeEventListener('mouseup', this._bound.mouseup);
    removeEventListener('mousemove', this._bound.mousemove);
    removeEventListener('wheel', this._bound.wheel);
    removeEventListener('blur', this._bound.blur);
    document.removeEventListener('pointerlockchange', this._bound.lockchange);
    this.canvas.removeEventListener('contextmenu', this._bound.contextmenu);
  }

  requestPointerLock() {
    if (this.lockSuppressed || this.touchMode) return;
    // Chrome returns a promise that rejects if the document is not eligible
    // (headless capture, an iframe, a lock request too soon after an exit).
    // An unhandled rejection there shows up as a page error in the harness, so
    // swallow it: failing to lock is not a game error.
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* not eligible — keep running unlocked */
    }
  }

  _onKeyDown(e) {
    if (!this.enabled) return;
    if (e.repeat) return;
    // Let devtools/refresh through; swallow everything else the game binds.
    if (!e.metaKey && !e.ctrlKey) e.preventDefault();
    this._pendingDown.add(e.code);
  }

  _onKeyUp(e) {
    if (!this.enabled) return;
    this._pendingUp.add(e.code);
  }

  _onMouseDown(e) {
    if (!this.enabled) return;
    // The click that RE-ACQUIRES pointer lock must not also reach the game.
    // Coming back to a tab, or clicking after Esc, used to fire the weapon on
    // the same press that locked the cursor — the player shoots the moment they
    // click back in, at whatever the crosshair happened to be resting on.
    if (!this.pointerLocked) {
      if (e.button === 0 && !this.lockSuppressed) this.requestPointerLock();
      return;
    }
    this._pendingDown.add(`Mouse${e.button}`);
  }

  _onMouseUp(e) {
    if (!this.enabled) return;
    this._pendingUp.add(`Mouse${e.button}`);
  }

  _onMouseMove(e) {
    if (!this.enabled || !this.pointerLocked || this.frozen) return;
    /**
     * DROP the first move after a lock. Chrome reports the jump from wherever
     * the cursor was sitting to the centre of the screen as one movementX/Y
     * pair, so re-entering the game after Esc or a tab-switch used to whip the
     * view by however far the mouse happened to be from centre — a "random"
     * rotation that is really the browser telling the truth about a jump the
     * player never made.
     */
    if (this._freshLock) {
      this._freshLock = false;
      return;
    }
    // movementX/Y is already relative and unaffected by cursor clamping.
    this._rawLook.x += e.movementX ?? 0;
    this._rawLook.y += e.movementY ?? 0;
  }

  _onWheel(e) {
    if (!this.enabled) return;
    this._pendingWheel += Math.sign(e.deltaY);
  }

  _onLockChange() {
    const was = this.pointerLocked;
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (this.pointerLocked && !was) this._freshLock = true;
    if (!this.pointerLocked) this._onBlur();
  }

  /** Losing focus must release every held key, or the player runs forever. */
  _onBlur() {
    for (const code of this.down) this._pendingUp.add(code);
    this._rawLook.x = 0;
    this._rawLook.y = 0;
  }

  /** `dt` sizes the look clamp; defaults to a 60 Hz frame when called by hand. */
  beginFrame(dt = 1 / 60) {
    this._pressed.clear();
    this._released.clear();

    for (const code of this._pendingDown) {
      if (!this.down.has(code)) {
        this.down.add(code);
        this._pressed.add(code);
      }
    }
    for (const code of this._pendingUp) {
      if (this.down.delete(code)) this._released.add(code);
    }
    this._pendingDown.clear();
    this._pendingUp.clear();

    /**
     * Cap one frame's worth of pointer delta, as an angular RATE.
     *
     * The first version of this was a flat 2000 counts, chosen to be generous.
     * At the default sensitivity that is 4.4 radians — 252 degrees in a single
     * frame, comfortably enough to slam pitch into its limit and leave the
     * player staring at the sky, which is the reported symptom. A cap that
     * permits the bug is not a cap.
     *
     * A rate scales with the frame instead: a long frame legitimately pools more
     * mouse movement than a short one, so the budget grows with it, while any
     * single frame stays bounded. 72 rad/s allows roughly 69 degrees at 60 fps —
     * a genuine fast flick still passes, spread over the two or three frames a
     * real flick actually takes — and the 2.5 rad ceiling stops a long hitch from
     * handing back a full spin at once.
     */
    const maxRad = Math.min(2.5, 72 * Math.max(dt, 1 / 120));
    const MAX_COUNTS = maxRad / (this.config.sensitivity || 0.0022);
    const mag = Math.hypot(this._rawLook.x, this._rawLook.y);
    if (mag > MAX_COUNTS) {
      const k = MAX_COUNTS / mag;
      this._rawLook.x *= k;
      this._rawLook.y *= k;
      this.lookClamped++;
    }

    const s = this.config.sensitivity;
    this.look.x = this.frozen ? 0 : this._rawLook.x * s;
    this.look.y = this.frozen ? 0 : this._rawLook.y * s * (this.config.invertY ? -1 : 1);
    this._rawLook.x = 0;
    this._rawLook.y = 0;

    this.wheel = this._pendingWheel;
    this._pendingWheel = 0;

    this._pollGamepad();
  }

  endFrame() {}

  _pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads[this.gamepadIndex ?? 0] ?? pads.find(Boolean);
    if (!pad) {
      this.stick.moveX = this.stick.moveY = this.stick.lookX = this.stick.lookY = 0;
      return;
    }
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    this.stick.moveX = dz(pad.axes[0] ?? 0);
    this.stick.moveY = dz(pad.axes[1] ?? 0);
    // Cubic response curve on the look stick — fine aim near centre, fast flicks at the edge.
    const curve = (v) => Math.sign(v) * Math.abs(v) ** 2.4;
    this.stick.lookX = curve(dz(pad.axes[2] ?? 0));
    this.stick.lookY = curve(dz(pad.axes[3] ?? 0));
  }

  /** True while any key bound to `action` is held. */
  action(name) {
    const codes = ACTIONS[name];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  actionPressed(name) {
    const codes = ACTIONS[name];
    if (!codes) return false;
    for (const c of codes) if (this._pressed.has(c)) return true;
    return false;
  }

  held(code) {
    return this.down.has(code);
  }

  pressed(code) {
    return this._pressed.has(code);
  }

  released(code) {
    return this._released.has(code);
  }

  get fire() {
    return this.down.has('Mouse0');
  }

  get firePressed() {
    return this._pressed.has('Mouse0');
  }

  get ads() {
    return this.down.has('Mouse2');
  }

  /** Normalised WASD + left-stick movement, clamped to the unit disc so
   *  diagonals aren't faster than cardinals. */
  moveVector(out = { x: 0, y: 0 }) {
    let x = (this.action('right') ? 1 : 0) - (this.action('left') ? 1 : 0);
    let y = (this.action('forward') ? 1 : 0) - (this.action('back') ? 1 : 0);
    x += this.stick.moveX + this.touch.moveX;
    // Screen down is +y for both a stick and a thumb; forward is -y.
    y -= this.stick.moveY + this.touch.moveY;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    out.x = x;
    out.y = y;
    return out;
  }
}
