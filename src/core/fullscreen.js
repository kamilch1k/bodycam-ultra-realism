/**
 * Fullscreen — a hard certification requirement, not a nicety.
 *
 * Yandex: "the game takes up the entire screen area, full-screen mode is
 * available" on desktop and TV, and on mobile the game must already BE
 * fullscreen during launch or gameplay. CrazyGames requires it to work from
 * inside their app shell.
 *
 * ponytail: the native API with one prefixed fallback. iOS Safari on iPhone has
 * no element fullscreen at all, which is why nothing here treats a failure as an
 * error — `request()` resolving false is a normal outcome on a supported device,
 * so the caller shows a button that quietly does nothing rather than an error.
 */

const el = () => document.documentElement;

export function supported() {
  return !!(el().requestFullscreen || el().webkitRequestFullscreen);
}

export function active() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/** @returns {Promise<boolean>} true if we are fullscreen afterwards */
export async function request() {
  if (active()) return true;
  try {
    const fn = el().requestFullscreen ?? el().webkitRequestFullscreen;
    if (!fn) return false;
    await fn.call(el(), { navigationUI: 'hide' });
    /**
     * Lock to landscape once we own the screen. A twin-stick shooter in portrait
     * is unplayable, and Yandex rejects a build that deforms on rotation. The
     * API is Android-only and rejects when it is unavailable or when the device
     * is already locked by the user, none of which should surface as a failure.
     */
    await screen.orientation?.lock?.('landscape').catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function exit() {
  if (!active()) return;
  try {
    await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
  } catch {
    /* already gone */
  }
}

export function toggle() {
  return active() ? exit() : request();
}

/**
 * Go fullscreen on the player's first touch.
 *
 * Every browser requires a user gesture, so this cannot be done at boot — the
 * closest legal moment is the first tap, which on a touch device is the one the
 * player makes to start playing anyway. Fires once and unbinds itself.
 */
export function armFirstGesture() {
  if (!supported()) return;
  const once = () => {
    removeEventListener('pointerdown', once);
    request();
  };
  addEventListener('pointerdown', once, { once: true, passive: true });
}
