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
  quality: 'low',
  /** Level to build: 'street' (the full map) or 'box' (greybox arena). */
  map: 'street',
  /** 'tdm' garrisons the level with enemy squads; 'sandbox' spawns none. */
  mode: 'tdm',
  fov: 80, // horizontal-ish vertical FOV, CoD default feel
  adsFovScale: 0.72,
  sensitivity: 0.0022,
  adsSensScale: 0.65,
  invertY: false,
  exposure: 1.0,
  /** Bodycam presentation: wide barrel lens, rolling shutter, sensor grain,
   *  heavy vignette, and a chest-mounted camera. ?bodycam=0 for the A/B. */
  bodycam: true,
  /** Hardcore rules: no health regeneration, magazine-level ammo, and rounds
   *  that kill in one or two hits in BOTH directions. ?hardcore=0 for the A/B. */
  hardcore: true,
  /** Global damage multiplier applied at the two hit-resolution sites (player
   *  -> agent, agent -> player). 33-damage rifle x 2.3 = 76 to the torso, so a
   *  fight is two rounds, not a magazine. */
  lethality: 2.3,
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
