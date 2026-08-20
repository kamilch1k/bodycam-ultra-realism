import { el, setText, setStyle, FONT_MONO } from './util.js';

/**
 * The camera's own overlay — the burnt-in furniture every body-worn camera
 * writes into its recording, drawn OVER the game's HUD rather than as part of
 * it.
 *
 *   ● REC                              AXON-BWC · 87%
 *   2026-08-21  14:03:57.4             OFFICER K. · 4417
 *
 * It is not a HUD element and it deliberately does not behave like one: it
 * gives the player nothing actionable, it never reacts to the fight, and it
 * sits in the corners the game's own readouts leave empty. Its whole job is to
 * say "you are looking at a recording" every frame without ever being read.
 *
 * The clock is REAL wall time, not game time. A recording's timestamp comes
 * from the camera's clock, and the tenths ticking over at a steady rate is the
 * detail that sells it — a frozen or game-paced clock reads as a texture.
 *
 * The battery drains over a session (~1% a minute) and never recharges. Nothing
 * happens when it runs out; a camera on its last few percent is just a thing
 * that is true about the recording.
 */
export class BodycamOverlay {
  constructor(parent, { id = 'AXON-BWC', officer = 'OFFICER K. · 4417' } = {}) {
    this.root = el('div', 'ow-bcam', parent);
    setStyle(this.root, 'font', `500 calc(11px * var(--k)) ${FONT_MONO}`);

    this.rec = el('div', 'ow-bcam-rec', this.root);
    this.dot = el('b', null, this.rec);
    this.recLabel = el('span', null, this.rec, 'REC');
    this.clock = el('div', 'ow-bcam-clock', this.root);
    this.cam = el('div', 'ow-bcam-cam', this.root, id);
    this.officer = el('div', 'ow-bcam-officer', this.root, officer);

    this.battery = 100;
    this._t = 0;
    this._lastSecond = -1;
  }

  update(dt) {
    this._t += dt;

    // The dot blinks at 1 Hz with a hard edge — an LED, not a fade.
    setStyle(this.dot, 'opacity', this._t % 1 < 0.55 ? '1' : '0.12');

    // ~1% a minute, floored at 1: a dead camera would mean a black screen, and
    // that is a punishment nobody asked for.
    this.battery = Math.max(1, 100 - this._t / 60);

    // The clock only touches the DOM ten times a second; the tenths are the
    // only digit that changes faster than that.
    const now = new Date();
    const tenths = Math.floor(now.getMilliseconds() / 100);
    const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}  ` +
      `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}.${tenths}`;
    if (stamp !== this._lastStamp) {
      this._lastStamp = stamp;
      setText(this.clock, stamp);
    }
    const sec = Math.floor(this._t);
    if (sec !== this._lastSecond) {
      this._lastSecond = sec;
      setText(this.cam, `${this.camId ?? 'AXON-BWC'} · ${Math.round(this.battery)}%`);
    }
  }

  dispose() {
    this.root.remove();
  }
}

const p2 = (n) => String(n).padStart(2, '0');

/** Burnt into the recording: white, hard-edged, with a shadow that survives a
 *  blown-out sky behind it. Positioned off the frame edges by 2.2% so the
 *  vignette does not eat it. */
export const BODYCAM_CSS = `
.ow-bcam{position:absolute;inset:0;pointer-events:none;color:#fff;
  letter-spacing:.06em;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 1px rgba(0,0,0,.9)}
.ow-bcam>div{position:absolute}
.ow-bcam-rec{left:2.2%;top:2.4%;display:flex;align-items:center;gap:.5em}
.ow-bcam-rec b{width:.62em;height:.62em;border-radius:50%;background:#ff2d2d;
  box-shadow:0 0 6px rgba(255,45,45,.8)}
.ow-bcam-clock{left:2.2%;top:calc(2.4% + 1.6em);opacity:.92}
.ow-bcam-cam{right:2.2%;top:2.4%;opacity:.92}
.ow-bcam-officer{right:2.2%;top:calc(2.4% + 1.6em);opacity:.72}
`;
