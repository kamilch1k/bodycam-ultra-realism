/**
 * WORLD — the surface palette.
 *
 * A named set of material variants pulled from the `materials` library. Keeping
 * them in one table means the level uses a deliberate, limited palette (which is
 * what makes a real map read as one place) and that every mesh sharing a key
 * merges into the same draw call.
 *
 * `surface` is the ARCHITECTURE.md physics/FX tag. `tint` is a linear multiply
 * on the baked albedo, so values stay inside 0.02–0.9 reflectance.
 */
import * as THREE from 'three';

/**
 * Mean linear albedo of the baked plaster surface.
 *
 * surfaces-arch.js builds plaster from sRGB(0.598, 0.578, 0.538) mixed toward a
 * warm and a grey, i.e. about 0.316 linear, and shader.js applies the tint as
 * the LAST thing it does: `alb.rgb *= owTintCol`. A tint is therefore a pure
 * multiply on a mid-grey base and can only ever DARKEN it — 0xf2efe9 (0.88
 * linear) lands at 0.88 * 0.316 = 0.28, which is concrete. That is why every
 * attempt to fix "the walls are grey" by picking a whiter hex changed nothing:
 * no hex reaches white through a 0.316 multiply, because none exceeds 1.
 */
const PLASTER_ALBEDO = 0.316;

/**
 * A tint that makes the surface actually READ as `hex`.
 *
 * Divides out the base albedo, so the painted result is the colour asked for
 * rather than the colour asked for times a grey. The returned components are
 * >1 on purpose — this is a gain, not a colour, and `col()` in shader.js passes
 * a THREE.Color straight through without clamping (only the hex path does the
 * sRGB conversion). `lift` trims the top: the plaster's own light/dark trowel
 * variation rides on top of this, so 0.9 keeps the brightest patches under 1.0
 * instead of clipping them flat and losing the texture.
 */
const paint = (hex, lift = 0.9) =>
  new THREE.Color(hex).multiplyScalar(lift / PLASTER_ALBEDO);

export const PALETTE = {
  /* ------------------------------------------------------------- neon city --
   * SATURATED ON PURPOSE, and the only entries here that are.
   *
   * Everything below this block is photoreal architectural tint — `plaster_pink`
   * is 0xc09a86, which is terracotta, and `plaster_blue` is 0x8f9aa0, which is
   * stone. Building a Miami rooftop out of them produced exactly what it should
   * have: concrete. No arrangement of realistic tints becomes a neon skyline.
   *
   * So these are picked as GAME colour rather than as pigment: near-white
   * plaster to carry the light, and four fully saturated accents with the
   * weathering dialled right down, because grime is what turns a bright hue
   * back into mud. They deliberately break the 0.02-0.9 reflectance convention
   * the file header describes — that rule exists to keep photoreal surfaces
   * behaving under the exposure curve, and this block is not photoreal.
   */
  /**
   * A COOL white, because the sun is not neutral.
   *
   * tools/hour-sweep.mjs measures the sun's blue/red ratio at 0.755 even at its
   * most neutral hour, so a surface painted a warm white renders warmer still —
   * the deck measured rgb(204,190,173), which is sand. This hex is the inverse
   * of that sun tint, normalised so the brightest channel still lands at the
   * usual lift: paint it slightly blue and it arrives on screen neutral. It
   * looks wrong in a colour picker and right in the game, which is the whole
   * point of tuning against a render instead of against a swatch.
   */
  neon_white: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: paint(0xd1def5), scale: 2.0, weather: [0.08, 0.1, 0.25, 0.15] },
  },
  neon_pink: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: paint(0xff2e88), scale: 2.2, weather: [0.06, 0.08, 0.2, 0.12] },
  },
  neon_cyan: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: paint(0x15d8e0), scale: 2.2, weather: [0.06, 0.08, 0.2, 0.12] },
  },
  neon_purple: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: paint(0x8a2be2), scale: 2.3, weather: [0.06, 0.08, 0.2, 0.12] },
  },
  neon_orange: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: paint(0xff6a13), scale: 2.3, weather: [0.06, 0.08, 0.2, 0.12] },
  },
  neon_teal: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: paint(0x00b899), scale: 2.1, weather: [0.06, 0.08, 0.2, 0.12] },
  },

  // ---------------------------------------------------------- architecture --
  plaster_cream: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0xcfc0a4, scale: 2.35, weather: [0.4, 0.5, 1.4, 0.55] },
  },
  plaster_sand: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0xb9a582, scale: 2.1, weather: [0.45, 0.5, 1.5, 0.6] },
  },
  plaster_blue: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0x8f9aa0, scale: 2.2, weather: [0.4, 0.55, 1.5, 0.6] },
  },
  plaster_pink: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0xc09a86, scale: 2.5, weather: [0.45, 0.5, 1.3, 0.55] },
  },
  plaster_white: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0xd8d2c4, scale: 1.9, weather: [0.3, 0.35, 0.9, 0.5] },
  },
  brick: {
    name: 'brick',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xa8846c, scale: 1.3 },
  },
  /** Hollow clay block exposed where the render has spalled off. */
  brick_fine: {
    name: 'brick',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x9c8068, scale: 0.62, weather: [0.45, 0.5, 0.8, 0.6] },
  },
  concrete: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xa9a49a, scale: 2.5 },
  },
  /**
   * Prop-scale concrete. A 2.5 m texture tile across a 0.5 m block shows a
   * single smear of noise and reads as untextured plastic; small objects need
   * their own, much tighter tiling.
   */
  concrete_prop: {
    name: 'concrete',
    surface: 'concrete',
    opts: {
      vertexMasks: true,
      tint: 0xa5a096,
      scale: 0.9,
      normalStrength: 1.3,
      weather: [0.45, 0.5, 0.35, 0.55],
    },
  },
  concrete_dark: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x7d7a73, scale: 2.2, weather: [0.4, 0.6, 1.2, 0.6] },
  },
  /** Roof screed: flat, sand-dusted, and the biggest surface in any skyline. */
  roof_screed: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xb5a992, scale: 2.8, weather: [0.6, 0.2, 0.3, 0.45] },
  },
  floor_concrete: {
    name: 'concrete_floor',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x9e9a91, scale: 3.0 },
  },
  tile_floor: {
    name: 'tile',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xa9a08d, scale: 1.4 },
  },

  // ----------------------------------------------------------------- ground --
  /**
   * The street itself. A black tarmac road makes a sunlit Levantine town read
   * as a wet European city at dusk — the actual surface is old tarmac buried
   * under years of blown sand and dust, so the base is warm compacted earth and
   * the asphalt only shows through where wheels have polished it.
   */
  road_dust: {
    name: 'gravel',
    surface: 'dirt',
    opts: {
      vertexMasks: true,
      tint: 0xc9b896,
      // 2.2 m, not 1.5: the aggregate reads as 25-45 mm stone instead of a
      // 15 mm rash, and the macro relief band lands on ruts rather than on
      // individual pebbles.
      scale: 2.2,
      // de-tile: a repeating cracked-earth tile down a 100 m street is the most
      // obvious tell in any procedural level.
      detile: 0.9,
      // .w is cavity grime. On gravel the height field IS the aggregate, so
      // this darkens every interstice: at 0.4 the road histogram was bimodal
      // (mass at 32-80 and 144-176 with a hollow middle) — dither, not surface.
      weather: [0.4, 0.04, 0.08, 0.14],
      // No edge wear on a road. The vertex wear mask exists to rub through the
      // arris of a prop; on a 100 m plane it just brightens every stone crown.
      wear: [0, 0.5, 0.45, 0],
    },
  },
  asphalt: {
    name: 'asphalt',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x9d968a, scale: 3.2, detile: 0.6, wear: [0, 0.55, 0.45, 0] },
  },
  /**
   * The driving line: tarmac polished bare by tyres and stained with oil. A
   * clear stop darker than `road_dust`, because a rut the same value as the dust
   * around it is invisible and the road goes back to being one flat plane.
   */
  road_rut: {
    name: 'asphalt',
    surface: 'concrete',
    opts: {
      vertexMasks: true,
      tint: 0x6f6a62,
      scale: 1.5,
      detile: 0.7,
      weather: [0.3, 0.5, 0.15, 0.28],
      wear: [0, 0.55, 0.45, 0],
    },
  },
  sand: {
    name: 'sand',
    surface: 'sand',
    opts: { vertexMasks: true, scale: 2.6, detile: 0.7, wear: [0, 0.45, 0.45, 0] },
  },
  dirt: {
    name: 'dirt',
    surface: 'dirt',
    opts: { vertexMasks: true, scale: 2.4, detile: 0.8, wear: [0, 0.5, 0.45, 0] },
  },
  gravel: {
    name: 'gravel',
    surface: 'dirt',
    opts: { vertexMasks: true, scale: 1.8, wear: [0, 0.5, 0.45, 0] },
  },
  /**
   * The contact fillet swept up against anything standing on the ground (see
   * Assembler.put / props.dustSkirt). It has to read as the ground's own grit
   * piled up, so it is the same generator as the road at a slightly darker,
   * greyer tint, with the grime mask doing the work at the contact line. The
   * first attempt used `dirt`, which is a stop lighter and carries mud cracks:
   * every prop got a pale polygonal plate around it.
   */
  dust_skirt: {
    name: 'gravel',
    surface: 'dirt',
    opts: {
      vertexMasks: true,
      tint: 0xa89d86,
      scale: 1.1,
      weather: [0.3, 0.0, 0.0, 0.16],
      wear: [0, 0.9, 0.7, 0],
    },
  },

  // ------------------------------------------------------------------ metal --
  metal_rust: { name: 'metal_rust', surface: 'metal', opts: { vertexMasks: true, scale: 1.1 } },
  /**
   * Prop-scale rust. A 1.1 m tile wrapped round a 0.6 m oil drum shows one smear
   * of noise and the drum reads as pink plastic — the same trap as
   * `concrete_prop` / `wood_prop`. Drums and buckets are eye-level silhouette
   * breakers in the mid-ground, so they need tiling that resolves at 3 m.
   */
  metal_rust_prop: {
    name: 'metal_rust',
    surface: 'metal',
    opts: {
      vertexMasks: true,
      tint: 0x9d7c66,
      scale: 0.4,
      normalStrength: 1.35,
      weather: [0.5, 0.35, 0.3, 0.5],
    },
  },
  metal_blue: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x6d8390, scale: 1.3 },
  },
  /** School-bus yellow. The one colour on Cul-de-Sac that is allowed to shout. */
  metal_yellow: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0xd8a52a, scale: 1.25 },
  },
  /** Suburban siding: pale mint and butter, the two houses of the map. */
  siding_mint: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0x9fbcae, scale: 2.1, weather: [0.35, 0.45, 1.2, 0.5] },
  },
  siding_butter: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0xd6c88a, scale: 2.1, weather: [0.35, 0.45, 1.2, 0.5] },
  },
  metal_green: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x76806a, scale: 1.3 },
  },
  metal_dark: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x4a4a48, scale: 1.0 },
  },
  steel: { name: 'metal_brushed', surface: 'metal', opts: { vertexMasks: true, scale: 0.9 } },
  corrugated: { name: 'corrugated', surface: 'metal', opts: { vertexMasks: true, scale: 2.2 } },

  // ---------------------------------------------------------------- organic --
  wood: { name: 'wood', surface: 'wood', opts: { vertexMasks: true, scale: 1.8 } },
  /**
   * Prop-scale timber. A 1.8 m grain tile across a 0.5 m crate slat shows one
   * soft smear; crates, pallets, planks and stall tables need ~0.5 m tiling
   * before the grain, the saw marks and the dirt in the joints read at all.
   */
  wood_prop: {
    name: 'wood',
    surface: 'wood',
    opts: {
      vertexMasks: true,
      tint: 0xb08a5e,
      scale: 0.55,
      normalStrength: 1.45,
      weather: [0.35, 0.3, 0.35, 0.5],
    },
  },
  wood_prop_dark: {
    name: 'wood',
    surface: 'wood',
    opts: {
      vertexMasks: true,
      tint: 0x7d6244,
      scale: 0.5,
      normalStrength: 1.45,
      weather: [0.35, 0.35, 0.4, 0.55],
    },
  },
  wood_dark: {
    name: 'wood',
    surface: 'wood',
    opts: { vertexMasks: true, tint: 0x8a6a4a, scale: 1.5 },
  },
  wood_pale: {
    name: 'wood',
    surface: 'wood',
    opts: { vertexMasks: true, tint: 0xc0a482, scale: 1.2 },
  },
  fabric_red: {
    name: 'fabric',
    surface: 'fabric',
    opts: { vertexMasks: true, tint: 0xa2564a, scale: 0.26, three: { side: 2 } },
  },
  fabric_teal: {
    name: 'fabric',
    surface: 'fabric',
    opts: { vertexMasks: true, tint: 0x5f8a8c, scale: 0.26, three: { side: 2 } },
  },
  fabric_cream: {
    name: 'fabric',
    surface: 'fabric',
    opts: { vertexMasks: true, tint: 0xbcb298, scale: 0.26, three: { side: 2 } },
  },
  /**
   * Hessian. The weave has to be fine — a 0.5 m tile turns every sandbag into a
   * picnic basket, and sandbags are the most-repeated prop in the level.
   *
   * The tint is deliberately well under a bright sand value: an emplacement is
   * dozens of square metres of one material low in the frame, and at the old
   * value it was the brightest thing in the bottom two thirds of the night shot
   * with nothing lighting it. Filled hessian is a mid-tone — 0.18-0.24 linear —
   * darker than the plaster behind it and darker than the dust it sits on.
   */
  burlap: {
    name: 'burlap',
    surface: 'fabric',
    opts: { vertexMasks: true, tint: 0xa2957a, scale: 0.16, weather: [0.5, 0.3, 0.4, 0.5] },
  },
  rubber: { name: 'rubber', surface: 'rubber', opts: { vertexMasks: true, scale: 0.45 } },
  glass: { name: 'glass', surface: 'glass', opts: { scale: 2.0 } },
  foliage: { name: 'foliage', surface: 'foliage', opts: { vertexMasks: true } },
  /**
   * Tree canopy. The foliage generator is an ALPHA-CUT leaf card, which is
   * right on a hedge-thin box and a disaster on anything with volume — the cut
   * punches straight through the far side and you get a chewed black-and-white
   * mess with sky behind it. Solid, tinted and finer-grained: from the street a
   * canopy is a shape with leaf texture on it, not a cloud of individual leaves.
   */
  canopy: {
    name: 'foliage',
    surface: 'foliage',
    opts: { vertexMasks: true, alphaMask: false, tint: 0x6f8a4a, scale: 0.42 },
  },
  /**
   * Mown grass. Built on DIRT, not on the foliage generator: `foliage` draws
   * individual leaf cards, which is right for a hedge and reads as a scatter of
   * dinner plates when you lay it flat. Dirt already has the fine relief a lawn
   * needs; `tint` is a straight albedo multiply, so greening it gives turf with
   * real shading underneath instead of a flat green field.
   */
  lawn: {
    name: 'dirt',
    surface: 'dirt',
    opts: { vertexMasks: true, tint: 0x6f8f4a, scale: 1.15 },
  },

  // ------------------------------------------------------------- apertures --
  /**
   * The dark core BEHIND a window opening. A window is not a grey rectangle: it
   * is a hole with a dark room behind it, and the only thing that sells it is a
   * genuinely dark backing plane set 15-25 cm back from the glass so the reveal
   * casts onto it and the opening parallaxes as the camera moves. Final linear
   * albedo lands around 0.03 (the tint is a linear multiply on the baked
   * plaster albedo), which is the reflectance of an unlit room seen from a
   * sunlit street — dark, but still carrying plaster texture rather than being
   * a black hole.
   */
  window_void: {
    name: 'plaster',
    surface: 'plaster',
    opts: {
      vertexMasks: true,
      tint: 0x474441,
      scale: 1.1,
      roughness: [1.0, 0.15],
      weather: [0.2, 0.7, 0.2, 0.7],
    },
  },
  /**
   * The dark shell inside a non-enterable building. Seen through doorways and
   * blown-out holes as well as windows, so it sits a stop above `window_void`:
   * dark, readable, never a white blank.
   */
  interior_shell: {
    name: 'plaster',
    surface: 'plaster',
    opts: {
      vertexMasks: true,
      tint: 0x5f5b56,
      scale: 1.6,
      roughness: [1.0, 0.1],
      weather: [0.25, 0.8, 0.3, 0.65],
    },
  },
  /**
   * Window glass. Distinct from the `glass` used on bottles and shards purely
   * so the roughness can be forced down: below 0.62 the render's SSR/IBL path
   * kicks in and the pane picks up the sky, which is what stops a window
   * reading as taped-over paper.
   */
  window_glass: {
    name: 'glass',
    surface: 'glass',
    opts: {
      scale: 2.0,
      roughness: [0.3, 0.06],
      three: { opacity: 0.16, envMapIntensity: 2.1 },
    },
  },
  /** Plywood sheet nailed over a broken window. */
  plywood: {
    name: 'wood',
    surface: 'wood',
    opts: {
      vertexMasks: true,
      tint: 0x7a6549,
      scale: 0.62,
      normalStrength: 1.2,
      weather: [0.5, 0.45, 0.5, 0.6],
    },
  },

  // ---------------------------------------------------------------- emissive --
  /** Bare interior bulb. Tiny surface, so it needs real radiance to read. */
  emissive_warm: {
    name: 'plaster',
    surface: 'glass',
    opts: {
      scale: 0.4,
      tint: 0xfff0d8,
      three: { emissive: 0xffd39a, emissiveIntensity: 12, toneMapped: true },
    },
  },
  /**
   * A lit room seen from the street. Much dimmer than `emissive_warm`: this is a
   * whole wall of a room catching a bulb, not the bulb itself, and at daylight
   * exposure it only has to lift the opening off the dark-core value.
   */
  window_glow: {
    name: 'plaster',
    surface: 'plaster',
    opts: {
      vertexMasks: true,
      tint: 0x6a5a45,
      scale: 1.2,
      three: { emissive: 0xffb066, emissiveIntensity: 1.1, toneMapped: true },
    },
  },
  /** Street-lamp diffuser. Emission is driven by time of day at runtime. */
  lamp_lens: {
    name: 'glass',
    surface: 'glass',
    opts: {
      scale: 1.0,
      three: { emissive: 0xffc47a, emissiveIntensity: 0, opacity: 0.5 },
    },
  },
};
