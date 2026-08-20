/**
 * Games-portal adapter — Yandex Games and CrazyGames.
 *
 * Both portals want the same four things and give them different names:
 *
 *   "the loader is done, show the game"   LoadingAPI.ready()   /  loadingStop()
 *   "the player is now playing"           GameplayAPI.start()  /  gameplayStart()
 *   "the player stopped"                  GameplayAPI.stop()   /  gameplayStop()
 *   an SDK script from THEIR domain       yandex.ru/games/sdk  /  sdk.crazygames.com
 *
 * That last one is why this file exists rather than the calls being sprinkled
 * through boot: the SDK is loaded from a remote origin, it is a different origin
 * per portal, and it may fail or be absent entirely (running from disk, in the
 * dev server, or on itch). Every method here is safe to call when no portal is
 * present — that is the normal case during development and it must never be a
 * branch anyone else has to write.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: advertising. Both portals pay on ad
 * impressions and both have interstitial and rewarded-video APIs, but where an
 * ad breaks into a session is a design decision with real consequences for
 * retention and for certification (Yandex rejects builds that show an
 * interstitial before the player has played). The hooks are here —
 * `gameplayStart`/`gameplayStop` are exactly the events an ad policy keys off —
 * and the policy itself is deliberately left to a decision, not guessed at.
 *
 * Certification requirements that DO live here, because they are mechanical:
 *   - `ready()` must be called once the game is playable, or the portal shows
 *     its own loader over a running game forever.
 *   - gameplay start/stop must bracket actual play, including pause menus, or
 *     the portal's session analytics are wrong and Yandex flags it.
 */

/** 'yandex' | 'crazygames' | null — set by the portal build, see vite.config. */
const TARGET = (import.meta.env?.VITE_PORTAL ?? '').toLowerCase() || null;

const SDK_URL = {
  yandex: 'https://yandex.ru/games/sdk/v2',
  crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`portal sdk failed: ${src}`));
    document.head.appendChild(s);
  });
}

class Portal {
  constructor() {
    this.target = TARGET;
    this.sdk = null;
    this.ready = false;
    this._playing = false;
    this._readySent = false;
    /** Enforces the portals' minimum gap between interstitials. */
    this._lastAd = 0;
    /**
     * Supplied by main.js. `core` must not import `audio` or `ui`, so the
     * mute-and-freeze that an ad requires is injected rather than reached for.
     */
    this.onPause = null;
    this.onResume = null;
  }

  /** True when a real portal SDK is attached. */
  get active() {
    return !!this.sdk;
  }

  /**
   * Attach the SDK. Never throws and never blocks boot for long: a portal that
   * is slow or unreachable must not be the reason the game does not start, so
   * the load is raced against a timeout and a failure just leaves `sdk` null.
   */
  async init({ timeout = 6000 } = {}) {
    if (!this.target || !SDK_URL[this.target]) return false;
    try {
      await Promise.race([
        loadScript(SDK_URL[this.target]),
        new Promise((_, rej) => setTimeout(() => rej(new Error('portal sdk timeout')), timeout)),
      ]);
      if (this.target === 'yandex') {
        // eslint-disable-next-line no-undef
        this.sdk = await YaGames.init();
      } else {
        this.sdk = window.CrazyGames?.SDK ?? null;
        await this.sdk?.init?.();
        this.sdk?.game?.loadingStart?.();
      }
    } catch (err) {
      console.warn('[portal]', err.message);
      this.sdk = null;
      return false;
    }
    console.info(`[portal] ${this.target} sdk ready`);
    return true;
  }

  /**
   * The game is playable — take the portal's loading screen down.
   *
   * Idempotent: boot has more than one path to "playable" (menu-first, or
   * straight into a map with ?menu=0) and calling twice is a certification
   * warning on Yandex.
   */
  loaded() {
    if (this._readySent) return;
    this._readySent = true;
    try {
      if (this.target === 'yandex') this.sdk?.features?.LoadingAPI?.ready?.();
      else this.sdk?.game?.loadingStop?.();
    } catch (err) {
      console.warn('[portal] loaded()', err);
    }
  }

  /** The player is now in a match. Bracket real play only — not menus. */
  gameplayStart() {
    if (this._playing) return;
    this._playing = true;
    try {
      if (this.target === 'yandex') this.sdk?.features?.GameplayAPI?.start?.();
      else this.sdk?.game?.gameplayStart?.();
    } catch (err) {
      console.warn('[portal] gameplayStart()', err);
    }
  }

  /** Paused, dead, back in a menu, or the tab lost focus. */
  gameplayStop() {
    if (!this._playing) return;
    this._playing = false;
    try {
      if (this.target === 'yandex') this.sdk?.features?.GameplayAPI?.stop?.();
      else this.sdk?.game?.gameplayStop?.();
    } catch (err) {
      console.warn('[portal] gameplayStop()', err);
    }
  }

  /**
   * The language the portal wants the game in.
   *
   * Yandex requires the game to pick this up itself rather than asking; the
   * value is on the environment object the SDK returns from init. CrazyGames has
   * no equivalent, so the browser's own language stands in there.
   *
   * @returns {string|null} a two-letter code, or null to fall back to navigator
   */
  get lang() {
    if (this.target === 'yandex') return this.sdk?.environment?.i18n?.lang ?? null;
    return null;
  }

  /**
   * Cross-device save slot. Both portals offer one and neither is localStorage:
   * Yandex hangs it off a player object that must be fetched first, CrazyGames
   * exposes a synchronous module that only exists once their SDK is up.
   *
   * Never throws and never rejects — a portal save is a mirror of localStorage
   * (see save.js), so every failure here is survivable and none of them should
   * be a branch the caller has to write.
   */
  async _player() {
    if (this.target !== 'yandex' || !this.sdk) return null;
    if (this._playerObj === undefined) {
      try {
        // `scopes: false` asks for storage WITHOUT forcing a login prompt, which
        // Yandex certification treats as required-third-party-auth if it blocks.
        this._playerObj = await this.sdk.getPlayer({ scopes: false });
      } catch {
        this._playerObj = null;
      }
    }
    return this._playerObj;
  }

  /** @returns {Promise<any|null>} */
  async getData(key) {
    if (!this.sdk) return null;
    try {
      if (this.target === 'yandex') {
        const p = await this._player();
        const all = await p?.getData([key]);
        return all?.[key] ?? null;
      }
      const raw = this.sdk.data?.getItem?.(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('[portal] getData()', err);
      return null;
    }
  }

  /** Fire-and-forget: the caller has already written to localStorage. */
  setData(key, value) {
    if (!this.sdk) return;
    try {
      if (this.target === 'yandex') {
        this._player().then((p) => p?.setData({ [key]: value }, false)).catch(() => {});
      } else {
        this.sdk.data?.setItem?.(key, JSON.stringify(value));
      }
    } catch (err) {
      console.warn('[portal] setData()', err);
    }
  }

  /**
   * Show an interstitial.
   *
   * Both portals require the game to go QUIET AND STILL for the duration — an
   * ad playing over a live firefight with the game's own audio underneath is a
   * certification failure on Yandex and a review rejection on CrazyGames. So
   * this brackets the call with the same gameplayStop/Start the pause menu uses
   * and mutes the master bus, and it restores both on every exit path including
   * the error one. An ad that fails to open must not leave the game silent.
   *
   * `onPause`/`onResume` are supplied by main.js rather than reached for here,
   * because `core` must not depend on `audio` or `ui`.
   *
   * @returns {Promise<boolean>} true if an ad was actually shown
   */
  async showInterstitial() {
    if (!this.sdk) return false;
    const now = Date.now();
    /**
     * Yandex rejects interstitials closer together than 60 s and CrazyGames
     * asks for a similar gap. Enforcing it here rather than at the call sites
     * means a new call site cannot get it wrong.
     */
    if (now - this._lastAd < 60000) return false;
    this._lastAd = now;

    this.onPause?.();
    let shown = false;
    try {
      if (this.target === 'yandex') {
        await new Promise((done) => {
          this.sdk.adv.showFullscreenAdv({
            callbacks: {
              onOpen: () => { shown = true; },
              onClose: () => done(),
              onError: () => done(),
            },
          });
        });
      } else {
        await new Promise((done) => {
          this.sdk.ad.requestAd('midgame', {
            adStarted: () => { shown = true; },
            adFinished: () => done(),
            adError: () => done(),
          });
        });
      }
    } catch (err) {
      console.warn('[portal] showInterstitial()', err);
    } finally {
      this.onResume?.();
    }
    return shown;
  }
}

export const portal = new Portal();
