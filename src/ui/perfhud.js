/**
 * FRAME-TIME OVERLAY — F3.
 *
 * Every stutter probe in tools/ measures ALLOCATION, because this project's
 * harness is headless, has no GPU, and software-rasterises: any millisecond
 * figure it printed would be fiction. That has been enough to find and fix a
 * per-shot audio cost and a lazy shader compile, and it has now failed twice to
 * explain a stutter the player can plainly see. Two engine-level theories —
 * missing render interpolation, and the render-target program cache key — were
 * checked and both were wrong.
 *
 * So this measures the one thing only the real machine knows. It is deliberately
 * cheap: a ring buffer of frame deltas and a canvas graph, no allocation per
 * frame, nothing that could itself become the hitch.
 *
 * WHAT EACH NUMBER IS FOR
 *
 *   ms / fps     the headline. If p99 is near the median, the frame rate is
 *                stable and the stutter is elsewhere (see steps).
 *   p99, worst   a stutter IS the tail. A 60 fps median with a 90 ms p99 is a
 *                game that feels broken, and an average would hide it.
 *   steps        physics steps per frame. This is the one that catches judder
 *                that the frame rate cannot explain: with a 120 Hz fixed step,
 *                a 60 Hz display should show a steady 2 and a 144 Hz display a
 *                steady 0/1 alternation. A number that swings 1/2/3 means the
 *                accumulator is beating against the display, which reads as
 *                stutter at a perfect frame rate.
 *   long         frames over 33 ms since the overlay opened — the count of
 *                hitches you actually felt.
 *   calls/tris   scene cost, to correlate a spike with what was on screen.
 *
 * The graph is 120 frames wide with lines at 16.7 and 33.3 ms, so the shape of
 * the problem is visible without reading a single digit.
 */

const N = 120;
const CSS = `
.ow-perf{position:fixed;left:12px;top:12px;z-index:60;pointer-events:none;
  font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#cfe3ff;
  background:rgba(6,10,16,.82);border:1px solid rgba(90,130,180,.45);
  border-radius:6px;padding:7px 9px;min-width:188px;
  text-shadow:0 1px 2px rgba(0,0,0,.9)}
.ow-perf b{color:#fff;font-weight:600}
.ow-perf .hi{color:#ffd27f}
.ow-perf .bad{color:#ff8b7a}
.ow-perf canvas{display:block;margin-top:5px;border-radius:3px;
  background:rgba(0,0,0,.35)}
`;

export class PerfHud {
  constructor(parent) {
    if (!document.getElementById('ow-perf-style')) {
      const s = document.createElement('style');
      s.id = 'ow-perf-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.root = document.createElement('div');
    this.root.className = 'ow-perf';
    this.root.style.display = 'none';
    this.text = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.canvas.width = N;
    this.canvas.height = 44;
    this.canvas.style.width = `${N}px`;
    this.canvas.style.height = '44px';
    this.root.append(this.text, this.canvas);
    parent.appendChild(this.root);
    this.g = this.canvas.getContext('2d');

    /** Ring buffer — preallocated, so the overlay never allocates per frame. */
    this.ms = new Float32Array(N);
    this.steps = new Float32Array(N);
    this.i = 0;
    this.filled = 0;
    this.long = 0;
    this.open = false;
    this._sorted = new Float32Array(N);
    this._acc = 0;
  }

  toggle() {
    this.open = !this.open;
    this.root.style.display = this.open ? '' : 'none';
    if (this.open) {
      this.long = 0;
      this.filled = 0;
      this.i = 0;
    }
  }

  /**
   * @param {number} rawDt   unscaled seconds since the last frame — RAW, not the
   *                         time-scaled dt, or a pause would read as a 0 ms frame
   * @param {object} ctx     engine context, for time.steps and renderer info
   */
  update(rawDt, ctx) {
    if (!this.open) return;
    const ms = rawDt * 1000;
    this.ms[this.i] = ms;
    this.steps[this.i] = ctx?.time?.steps ?? 0;
    this.i = (this.i + 1) % N;
    if (this.filled < N) this.filled++;
    if (ms > 33.3) this.long++;

    // Repaint at ~10 Hz: the numbers are unreadable faster than that, and the
    // overlay must never be the thing it is measuring.
    this._acc += rawDt;
    if (this._acc < 0.1) return;
    this._acc = 0;
    this._paint(ctx);
  }

  _paint(ctx) {
    const n = this.filled;
    const src = this.ms;
    for (let k = 0; k < n; k++) this._sorted[k] = src[k];
    const view = this._sorted.subarray(0, n);
    view.sort();
    const med = view[(n * 0.5) | 0] || 0;
    const p99 = view[Math.min(n - 1, (n * 0.99) | 0)] || 0;
    const worst = view[n - 1] || 0;

    let stepSum = 0;
    let stepMin = 99;
    let stepMax = 0;
    for (let k = 0; k < n; k++) {
      const s = this.steps[k];
      stepSum += s;
      if (s < stepMin) stepMin = s;
      if (s > stepMax) stepMax = s;
    }

    const info = ctx?.get?.('render')?.renderer?.info;
    const cls = (v, warn, bad) => (v >= bad ? 'bad' : v >= warn ? 'hi' : '');
    this.text.innerHTML =
      `<b>${(1000 / (med || 16.7)).toFixed(0)} fps</b>  ${med.toFixed(1)} ms<br>` +
      `p99 <span class="${cls(p99, 22, 34)}">${p99.toFixed(1)}</span>  ` +
      `worst <span class="${cls(worst, 34, 60)}">${worst.toFixed(1)}</span><br>` +
      `steps <span class="${cls(stepMax - stepMin, 2, 3)}">${(stepSum / n).toFixed(2)}` +
      `</span> <span style="opacity:.6">(${stepMin}-${stepMax})</span><br>` +
      `long <span class="${cls(this.long, 1, 5)}">${this.long}</span>` +
      (info ? `<br>${info.render.calls} calls  ${(info.render.triangles / 1000) | 0}k tris` : '');

    const g = this.g;
    const H = this.canvas.height;
    g.clearRect(0, 0, N, H);
    // 60 fps and 30 fps reference lines — the shape matters more than the digits
    g.strokeStyle = 'rgba(120,200,140,.45)';
    g.beginPath();
    g.moveTo(0, H - 16.7);
    g.lineTo(N, H - 16.7);
    g.stroke();
    g.strokeStyle = 'rgba(255,150,110,.4)';
    g.beginPath();
    g.moveTo(0, H - 33.3);
    g.lineTo(N, H - 33.3);
    g.stroke();
    for (let k = 0; k < n; k++) {
      // Oldest-to-newest left-to-right, so the graph reads like a timeline.
      const idx = (this.i + k) % N;
      const v = Math.min(H, src[idx]);
      g.fillStyle = v > 33.3 ? '#ff8b7a' : v > 20 ? '#ffd27f' : '#7fc7ff';
      g.fillRect(k, H - v, 1, v);
    }
  }

  dispose() {
    this.root.remove();
  }
}
