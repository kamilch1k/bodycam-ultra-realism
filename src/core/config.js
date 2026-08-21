/**
 * Central tuning + quality configuration.
 * Subsystems read from here rather than hardcoding magic numbers, so the
 * quality scaler and the capture harness can drive everything from one place.
 */

export const PHYSICS_HZ = 120;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Never simulate more than this many physics steps in one frame (spiral-of-death guard). */
export const MAX_SUBSTEPS = 8;
/**
 * Longest frame the simulation will believe, in seconds. Six fixed steps — kept
 * under MAX_SUBSTEPS on purpose, so catch-up is bounded by this clamp and not by
 * the backlog-shedding branch. See the note in Engine.step.
 */
export const MAX_FRAME_DT = 0.05;

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
   * NO SHADOWS OF ANY KIND, and no screen-space luxuries. Contact shadows used
   * to be kept here as the cheap stand-in that stops everything floating — a
   * short screen-space ray march resolving the 0-40 cm under a crate or a boot.
   * They are gone too, because "cheap" was measured per FRAME and the cost that
   * matters is per PIXEL.
   *
   * A screen-space march costs in proportion to what fills the screen, and the
   * reported hitch is walking up to an enemy: at two metres a soldier covers a
   * large fraction of the viewport, and every one of those pixels marches. The
   * approach probe showed draw calls flat at 235 and triangles flat at 250k
   * from 54 m to 2 m — the geometry does not change, so a per-pixel pass is the
   * only thing left that grows as you close in.
   *
   * Bloom goes for the same reason: another full-screen pass, on a build whose
   * job is to run on a phone in a portal iframe.
   *
   * Everything here is still available — `?q=high`, `?q=ultra`, or the quality
   * menu. This is only what a first-time portal player gets by default, and for
   * them a stable frame beats grounded contact every time.
   */
  mobile: {
    renderScale: 0.7,
    shadows: false,
    contactShadows: false,
    shadowMapSize: 512,
    cascades: 1,
    shadowDistance: 30,
    taa: false,
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: false,
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
    /** One material for the whole glove — see the note in viewmodel.js. */
    simpleGlove: true,
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
   * The six-room CQB kill house, garrisoned. This is the shape this game's
   * fights want (see DIRECTION.md) and it is up in about a second; the street
   * map is the ~25 s one and is a deliberate choice from the menu.
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
  /** Bodycam presentation: wide barrel lens, rolling shutter, sensor grain,
   *  heavy vignette, and a chest-mounted camera. ?bodycam=0 for the A/B. */
  bodycam: true,
  /** Hardcore rules: no health regeneration, magazine-level ammo, and rounds
   *  that kill in one or two hits in BOTH directions. ?hardcore=0 for the A/B. */
  hardcore: true,
  /**
   * WEAPON HANDLING WEIGHT.
   *
   * MASS AND CLIMB ARE DIFFERENT AXES and scaling them together was wrong.
   * What a heavy rifle does is shove itself REARWARD into your shoulder; what
   * it does not have to do is throw the muzzle at the ceiling. One multiplier
   * over both gave a gun that walked up the wall and, because the return
   * springs are underdamped, oscillated on the way back down — 45% more
   * amplitude on a spring that already overshoots is where the stutter came
   * from, not the kick itself.
   *
   *   recoilScale   rearward push. Weight you feel, sight picture you keep.
   *   climbScale    camera climb. Above ~1.15 a burst is unusable.
   *   adsFlipKeep   share of the muzzle flip that survives aiming. The arcade
   *                 fork zeroes it (a gun that does not move when fired);
   *                 0.42 was a gun you could not hold on a torso.
   *   recoilDamping return spring, hipfire. 0.74 is visibly springy — it does
   *                 not settle between shots at 800 rpm, which reads as junk.
   *   recoilJitter  shot-to-shot magnitude variation. Randomness you cannot
   *                 anticipate is exactly what "not smooth" means.
   *   adsScale      time to get the sights up.
   */
  recoilScale: 1.5,
  climbScale: 1.1,
  adsFlipKeep: 0.18,
  recoilDamping: 0.88,
  recoilJitter: 0.05,
  adsScale: 1.25,
  /** Global damage multiplier applied at the two hit-resolution sites (player
   *  -> agent, agent -> player). 33-damage rifle x 2.3 = 76 to the torso, so a
   *  fight is two rounds, not a magazine. */
  lethality: 2.3,
  /** Capture mode disables anything nondeterministic so screenshots are stable. */
  deterministic: false,
};

export function createConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  /**
   * A body-worn camera is a wide lens — that is why the footage looks the way
   * it does, and it is what the barrel distortion in the composite is shaped
   * for. Explicit `fov` still wins, so ?fov= and the settings menu are unharmed.
   */
  if (cfg.bodycam && overrides.fov === undefined) cfg.fov = 92;
  cfg.q = { ...QUALITY_PRESETS[cfg.quality] };
  cfg.setQuality = (name) => {
    if (!QUALITY_PRESETS[name]) throw new Error(`unknown quality preset "${name}"`);
    cfg.quality = name;
    Object.assign(cfg.q, QUALITY_PRESETS[name]);
  };
  return cfg;
}
