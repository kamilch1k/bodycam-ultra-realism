import { el, setText, setStyle } from './util.js';

/**
 * LEVEL-UP ROLL — the upgrade that does not stop the game.
 *
 * The pick-of-three card was modal: it held `time.scale` at zero, took control
 * and waited. In a horde mode that is backwards. Levels arrive in the middle of
 * a fight, often several in a few seconds, and freezing the game each time
 * turns the reward into an interruption — you stop playing to read three
 * descriptions while the thing that was chasing you stands still.
 *
 * So the upgrade is granted automatically and the ROLL is what the player sees:
 * a reel under the compass that spins through the perk names, decelerates and
 * lands on the one that was taken. It is purely a readout — the perk is already
 * applied by the time the reel starts — which is exactly why it can be
 * interrupted, ignored, or run while the player is mid-air being shot at.
 *
 * Nothing here takes pointer events or touches time, control or the pointer
 * lock. That is the entire point.
 */

/** Names flick past this fast at the start, in seconds per name. */
const TICK_FAST = 0.045;
/** ...and this slowly at the end, before it locks. */
const TICK_SLOW = 0.34;
/** How long the reel spins before settling. */
const SPIN = 1.05;
/** How long the winning name is held once locked. */
const HOLD = 1.5;
/** Fade-out after the hold. */
const FADE = 0.45;

export class LevelRoll {
  constructor(parent) {
    this.root = el('div', 'ow-roll', parent);
    this.tag = el('div', 'ow-roll-tag', this.root);
    this.name = el('div', 'ow-roll-name', this.root);
    this.sub = el('div', 'ow-roll-sub', this.root);
    setStyle(this.root, 'opacity', '0');

    this._t = 0;
    this._tick = 0;
    this._active = false;
    this._pool = [];
    this._final = null;
    this._sub = '';
    this._locked = false;
  }

  /**
   * @param {string} tag    e.g. "LEVEL 4"
   * @param {string} label  the perk that was already granted
   * @param {string} sub    its effect line
   * @param {string[]} pool other perk names, purely to have something to flick
   */
  show(tag, label, sub, pool = []) {
    setText(this.tag, tag);
    this._final = label;
    this._sub = sub ?? '';
    // The winner is in the reel so the last few flicks can already be near it.
    this._pool = pool.length ? pool.slice() : [label];
    if (!this._pool.includes(label)) this._pool.push(label);
    this._t = 0;
    this._tick = 0;
    this._locked = false;
    this._active = true;
    setText(this.sub, '');
    setStyle(this.root, 'opacity', '1');
    // Restart the pop even if a previous roll is still on screen: two levels in
    // a second should read as two events, not one long one.
    this.root.classList.remove('ow-roll-in');
    void this.root.offsetWidth;
    this.root.classList.add('ow-roll-in');
  }

  update(dt) {
    if (!this._active) return;
    this._t += dt;

    if (!this._locked) {
      if (this._t >= SPIN) {
        this._locked = true;
        setText(this.name, this._final);
        setText(this.sub, this._sub);
        this.root.classList.add('ow-roll-hit');
      } else {
        // Ease the flick rate from fast to slow so it reads as decelerating
        // rather than as stopping dead.
        const k = this._t / SPIN;
        const interval = TICK_FAST + (TICK_SLOW - TICK_FAST) * k * k;
        this._tick -= dt;
        if (this._tick <= 0) {
          this._tick = interval;
          const i = (Math.random() * this._pool.length) | 0;
          setText(this.name, this._pool[i]);
        }
      }
      return;
    }

    const since = this._t - SPIN;
    if (since > HOLD) {
      const k = Math.min(1, (since - HOLD) / FADE);
      setStyle(this.root, 'opacity', String(1 - k));
      if (k >= 1) {
        this._active = false;
        this.root.classList.remove('ow-roll-in', 'ow-roll-hit');
      }
    }
  }

  dispose() {
    this.root.remove();
  }
}
