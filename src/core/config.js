/**
 * Central tuning + quality configuration.
 * Subsystems read from here rather than hardcoding magic numbers, so the
 * quality scaler and the capture harness can drive everything from one place.
 */

export const PHYSICS_HZ = 120;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Never simulate more than this many physics steps in one frame (spiral-of-death guard). */
export const MAX_SUBSTEPS = 8;

/** Real-world units are metres, seconds, kilograms. */
export const UNITS = {
  gravity: -9.81 * 2.1, // Games use exaggerated gravity; CoD-like feel.
  playerHeight: 1.78,
  playerCrouchHeight: 1.12,
  playerRadius: 0.32,
  eyeOffset: 0.12, // below top of capsule
};

export const QUALITY_PRESETS = {
  /**
   * MOBILE — the shipping default for the portals.
   *
   * The one structural difference from `low` is `shadows: false`. The cascade
   * pass was measured at 326 of the frame's 644 draw calls and 3.0M of its 5.1M
   * triangles; on a phone GPU that is not a 1.3 ms line item, it is the frame.
   *
   * Dropping it entirely used to make everything float, which is why `low` kept
   * one short cascade. `contactShadows: true` is what replaces it: a short
   * screen-space ray march toward the sun that resolves the 0-40 cm of contact
   * under a crate or a boot. That is the part the eye actually reads as
   * "standing on the ground" — the long soft cast shadow is not.
   */
  mobile: {
    renderScale: 0.7,
    shadows: false,
    contactShadows: true,
    shadowMapSize: 512,
    cascades: 1,
    shadowDistance: 30,
    taa: false,
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: true,
    anisotropy: 2,
    charTextureSize: 192,
    /**
     * Radial segment scale for every curve in the viewmodel — see
     * weapons/geometry.js. The authored counts target a 1080p desktop ADS
     * frame; a phone's is well under half that.
     */
    meshDetail: 0.45,
    /**
     * Soldier mesh density — see ai/geo.js. Enemies are the largest remaining
     * item in the frame and, unlike the weapon, are never closer than a few
     * metres, so they carry a cut far more readily.
     */
    aiDetail: 0.5,
    particleBudget: 1800,
    decalBudget: 48,
  },
  low: {
    // Web-first default: keep the scene readable while avoiding the expensive
    // desktop-only effects that make the first frame and steady-state GPU cost
    // too high for Yandex/Crazy Games hardware.
    renderScale: 0.80,
    shadowMapSize: 1024,
    // ONE cascade, close in. Measured at 1080p: the shadow pass is 326 of the
    // frame's 644 draw calls and 3.0M of its 5.1M triangles, for 1.3 ms of a
    // 4.5 ms frame — by far the biggest single item left. One short cascade
    // keeps objects sitting ON the ground (drop it entirely and everything
    // floats) and gives most of that back.
    cascades: 1,
    shadowDistance: 45,
    taa: false,
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: true,
    anisotropy: 4,
    // Character texture bake is on the CPU (src/ai/textures.js) and is O(size^2):
    // 512px cost 7.6 s of boot, 256px costs a quarter of that.
    charTextureSize: 256,
    particleBudget: 3500,
    decalBudget: 96,
  },
  medium: {
    renderScale: 0.85,
    shadowMapSize: 2048,
    cascades: 3,
    shadowDistance: 90,
    taa: true,
    gtao: true,
    ssr: false,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 8,
    charTextureSize: 512,
    particleBudget: 6000,
    decalBudget: 128,
  },
  high: {
    renderScale: 1.0,
    shadowMapSize: 2048,
    cascades: 4,
    shadowDistance: 140,
    taa: true,
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 16,
    charTextureSize: 512,
    particleBudget: 12000,
    decalBudget: 256,
  },
  ultra: {
    renderScale: 1.0,
    shadowMapSize: 4096,
    cascades: 4,
    shadowDistance: 200,
    taa: true,
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 16,
    charTextureSize: 512,
    particleBudget: 24000,
    decalBudget: 512,
  },
};

export const DEFAULTS = {
  // Start in the web-safe profile. Desktop players can opt into `?q=high` or
  // `?q=ultra`, and the in-game quality menu still exposes every preset.
  quality: 'mobile',
  /**
   * Level to build. Defaults to the shoot house, NOT the street map: the street
   * takes ~25 s to build and on a portal that is a bounce rather than a load.
   * The greybox levels are up in about a second.
   */
  map: 'swat',
  /** 'tdm' garrisons the level with enemy squads; 'sandbox' spawns none. */
  mode: 'tdm',
  fov: 80, // horizontal-ish vertical FOV, CoD default feel
  adsFovScale: 0.72,
  sensitivity: 0.0022,
  adsSensScale: 0.65,
  invertY: false,
  exposure: 1.0,
  /** Capture mode disables anything nondeterministic so screenshots are stable. */
  deterministic: false,
};

export function createConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  cfg.q = { ...QUALITY_PRESETS[cfg.quality] };
  cfg.setQuality = (name) => {
    if (!QUALITY_PRESETS[name]) throw new Error(`unknown quality preset "${name}"`);
    cfg.quality = name;
    Object.assign(cfg.q, QUALITY_PRESETS[name]);
  };
  return cfg;
}
