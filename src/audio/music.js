/**
 * MUSIC — one looping track at a time, per map.
 *
 * A PLAIN <audio> ELEMENT, deliberately, and not a node in the Mixer graph.
 * Everything else in this game is synthesised, so audio/ is a Web Audio graph
 * end to end — but music is the one sound that is a file, and routing a file
 * through that graph buys nothing and costs three things:
 *
 *   - the master chain is a compressor tuned for gunfire (mixer.js: -2 dB
 *     threshold, 4:1, 3.5 ms attack). Music through it pumps every time a rifle
 *     goes off, which is exactly the artefact a separate music bus exists to
 *     avoid.
 *   - decodeAudioData needs fetch(), and fetch() is blocked on file://. The
 *     portal builds are tested by opening index.html straight off the disk
 *     (see PUBLISHING.md), and an <audio src> keeps working there.
 *   - the element streams and starts on the first buffered chunk; decoding a
 *     3 MB mp3 up front would stall the same boot we spent the prewarm work
 *     protecting.
 *
 * The cost is that master volume does not reach it, so `setMuted` is wired
 * explicitly at the two places that need it: ad breaks and tab visibility.
 *
 * AUTOPLAY: browsers refuse audio before a user gesture, and both portals load
 * the game behind their own splash. `play()` is therefore only ever called from
 * the Play button's click handler onwards, and a rejected promise is swallowed —
 * a portal that blocks music must not be able to break the game.
 */

/** Track per map, plus the menu bed. Keys match `config.map`. */
const TRACKS = {
  menu: 'audio/night.mp3',
  miami: 'audio/combat.mp3',
  zone: 'audio/rock.mp3',
};

/** Music sits under the gunfire by design; this is the ceiling, not a setting. */
const VOLUME = 0.38;
const FADE_MS = 600;

export class Music {
  constructor() {
    this.el = null;
    this.track = null;
    this._muted = false;
    this._fade = null;
  }

  /**
   * Play the track for a map, or the menu bed. Idempotent per track: calling
   * with the map already playing is a no-op rather than a restart, because the
   * pause menu and the mode both re-announce the map.
   */
  play(map) {
    const src = TRACKS[map] ?? TRACKS.menu;
    if (this.track === src && this.el && !this.el.paused) return;
    this.track = src;

    if (!this.el) {
      this.el = new Audio();
      this.el.loop = true;
      this.el.preload = 'auto';
      // Not `crossOrigin`: the files are same-origin in every build, and setting
      // it makes a file:// load fail outright.
      this.el.volume = 0;
    }
    if (!this.el.src.endsWith(src)) this.el.src = src;
    this.el.muted = this._muted;
    // A blocked autoplay is not an error worth surfacing — the game plays fine
    // silently, and the next gesture will start it.
    const p = this.el.play();
    if (p?.catch) p.catch(() => {});
    this._fadeTo(VOLUME);
  }

  /** Ad breaks and hidden tabs. Both portals require silence during an ad. */
  setMuted(on) {
    this._muted = !!on;
    if (this.el) this.el.muted = this._muted;
  }

  stop() {
    if (!this.el) return;
    this.el.pause();
    this.track = null;
  }

  /** Linear fade on the element's own volume — no graph, no scheduling. */
  _fadeTo(target) {
    if (!this.el) return;
    clearInterval(this._fade);
    const from = this.el.volume;
    const t0 = performance.now();
    this._fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / FADE_MS);
      // Clamp: a paused/replaced element can leave volume out of range.
      this.el.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k >= 1) clearInterval(this._fade);
    }, 40);
  }

  dispose() {
    clearInterval(this._fade);
    this.stop();
    this.el = null;
  }
}

export const music = new Music();
