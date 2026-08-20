import * as THREE from 'three';
import { paintMasks } from './util.js';

/**
 * Arcade arenas — `?map=strike` and `?map=holdout`.
 *
 * Built to the same one-surface, one-box-prototype rule as the shoot house, so
 * each is up in milliseconds. That constraint is the whole reason this game can
 * ship on a portal.
 *
 * COLOUR COMES FROM THE PALETTE, NOT FROM ASSETS. Every material here is an
 * existing entry in world/palette.js, baked procedurally at load. Downloading
 * textures would trade the property that makes this shippable — one
 * self-contained file, no external requests, which both portals require — for
 * colour that the palette already provides.
 *
 * Shared shape rules, learned from the shoot house:
 *   - every space has two ways out, so no room is a dead end
 *   - cover is ~1.1 m: chest height standing, full cover crouched, which is what
 *     makes the crouch button worth pressing
 *   - 0.7 m ledges are vaultable (MOVE.mantle.autoVaultMax), so a low block is a
 *     route rather than an obstacle
 */

const WALL_T = 0.35;
const DOOR = 2.4;

/**
 * A straight wall with doorways punched out of it, given as centres along the
 * wall's own axis — the way a floor plan is read, rather than as the surviving
 * segments, which is what the renderer needs.
 *
 * `mat` and `y` ride along to the box rows so a wall can be coloured and can sit
 * on top of a plinth.
 */
function wall(axis, fixed, a, b, h, doors = [], t = WALL_T, mat, y) {
  const out = [];
  const cuts = doors
    .filter((d) => d > a && d < b)
    .sort((p, q) => p - q)
    .flatMap((d) => [d - DOOR / 2, d + DOOR / 2]);
  const edges = [a, ...cuts, b];
  for (let i = 0; i < edges.length; i += 2) {
    const s = edges[i];
    const e = edges[i + 1];
    if (e - s <= 0.05) continue;
    const mid = (s + e) / 2;
    if (axis === 'x') out.push([mid, fixed, e - s, t, h, 0, mat, y]);
    else out.push([fixed, mid, t, e - s, h, 0, mat, y]);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── *
 *  STRIKE — the round-based map.
 *
 *  Built to the oldest competitive shape there is, because it is the one every
 *  player already knows how to read: two spawns facing each other, TWO routes
 *  between them, and one contested objective where they meet.
 *
 *    LONG   the open north lane. Fast, no cover for the last 12 m, so taking it
 *           is a bet that nobody is already holding the site.
 *    SHORT  the south lane, through a building with two doors. Slower and
 *           blind, but you arrive with a wall at your back.
 * ────────────────────────────────────────────────────────────────────────── */
const STRIKE = [
  // perimeter, 64 x 44
  ...wall('x', 22, -32, 32, 5, [], 0.6, 'concrete'),
  ...wall('x', -22, -32, 32, 5, [], 0.6, 'concrete'),
  ...wall('z', -32, -22, 22, 5, [], 0.6, 'concrete'),
  ...wall('z', 32, -22, 22, 5, [], 0.6, 'concrete'),

  // The spine that splits long from short. One doorway at mid so the two lanes
  // are connected rather than parallel — without it the map is two corridors
  // and every round plays identically.
  ...wall('x', 2, -20, 20, 3.2, [-4], WALL_T, 'plaster_sand'),

  // SHORT — the south building. Two doors, so it is a route and never a trap.
  ...wall('x', -10, -14, 6, 3.2, [-4], WALL_T, 'plaster_cream'),
  ...wall('z', -14, -10, 2, 3.2, [-6], WALL_T, 'plaster_cream'),
  ...wall('z', 6, -10, 2, 3.2, [-6], WALL_T, 'plaster_cream'),

  // SITE — waist-high crates you fight over. Deliberately not a room: cover you
  // can shoot across beats cover you hide behind.
  [0, 10, 5, 1.2, 1.1, 0, 'wood_prop'],
  [-4, 14, 1.2, 4, 1.1, 0, 'wood_prop'],
  [4, 14, 1.2, 4, 1.1, 0, 'wood_prop'],
  [0, 17, 3.4, 1.2, 1.9, 0, 'metal_rust_prop'],

  // LONG — sparse cover, placed so the lane is crossable but never safe.
  [-16, 14, 3.4, 1.2, 1.1, 0.3, 'concrete_prop'],
  [16, 12, 3.4, 1.2, 1.1, -0.3, 'concrete_prop'],
  [-24, 8, 1.2, 5, 1.9, 0, 'plaster_blue'],
  [24, 8, 1.2, 5, 1.9, 0, 'plaster_pink'],

  // spawn-side cover, so neither team is shot the instant it appears
  [-27, -16, 4, 1.2, 1.1, 0, 'concrete_prop'],
  [27, -16, 4, 1.2, 1.1, 0, 'concrete_prop'],
  // vaultable ledges into the site
  [-7, 6, 3, 1, 0.7, 0, 'wood_prop'],
  [7, 6, 3, 1, 0.7, 0, 'wood_prop'],
];

const STRIKE_SPAWNS = [
  [-28, -18, 0.8, 'west spawn'],
  [-24, -19, 0.8, 'west spawn 2'],
  [28, -18, -0.8, 'east spawn'],
  [24, -19, -0.8, 'east spawn 2'],
  [-28, 18, Math.PI - 0.6, 'long west'],
  [28, 18, Math.PI + 0.6, 'long east'],
];

/* ────────────────────────────────────────────────────────────────────────── *
 *  HOLDOUT — the horde map.
 *
 *  Inverted from a versus layout. There is a CENTRE and an OUTSIDE, because the
 *  fight is one player against a tide arriving from all of it.
 *
 *  THE KEEP is raised 1.2 m on a plinth with ramps on three sides. Height is the
 *  whole mechanic: you shoot down into the crowd, they funnel up a ramp, and the
 *  moment you are pushed off the plinth you feel it. Three ramps, never one and
 *  never four — one is a choke you hold forever and the mode stops being a game,
 *  four means you are flanked whichever way you turn.
 *
 *  FOUR DISTRICTS, one per quadrant, each a different colour and a different
 *  fight. A grey box is not neutral, it is unreadable: with nothing to name, a
 *  player cannot say where they died or plan where to go next.
 *
 *    NE  MARKET   pink and cream stalls under red awnings, tight lanes
 *    NW  GARDEN   green hedges, the only soft cover on the map
 *    SW  YARD     stacked containers, hard angles, the one climb outside the keep
 *    SE  POOL     a sunken tiled basin — the only place BELOW you
 *
 *  Nothing above 3 m except the perimeter, so you can always read which side the
 *  next wave is on. That is the whole tension of a horde mode.
 * ────────────────────────────────────────────────────────────────────────── */

/** Plinth height. Also a vault, so being pushed off is not a death sentence. */
const PLINTH = 1.2;

const HOLDOUT = [
  // perimeter, 64 x 64 — square on purpose: no direction is the safe one
  ...wall('x', 32, -32, 32, 5, [], 0.6, 'concrete'),
  ...wall('x', -32, -32, 32, 5, [], 0.6, 'concrete'),
  ...wall('z', -32, -32, 32, 5, [], 0.6, 'concrete'),
  ...wall('z', 32, -32, 32, 5, [], 0.6, 'concrete'),

  /* ---- THE KEEP -------------------------------------------------------- */
  // Plinth: one low slab. Standing on it is the reward.
  [0, 0, 20, 20, PLINTH, 0, 'tile_floor', 0],
  // Parapet — waist high FROM THE PLINTH, a 2.2 m wall from below. One piece of
  // geometry doing both jobs.
  ...wall('x', 9.6, -9.6, 9.6, 1.0, [0], 0.4, 'plaster_cream', PLINTH),
  ...wall('x', -9.6, -9.6, 9.6, 1.0, [], 0.4, 'plaster_cream', PLINTH),
  ...wall('z', -9.6, -9.6, 9.6, 1.0, [0], 0.4, 'plaster_cream', PLINTH),
  ...wall('z', 9.6, -9.6, 9.6, 1.0, [0], 0.4, 'plaster_cream', PLINTH),
  /**
   * STAIRS up: north, west, east. South is solid, so there is always one edge
   * nothing climbs and you can put your back to it.
   *
   * Three steps of 0.4 m, NOT one 1.2 m slab. The first version of this was a
   * single box the height of the plinth, which is a 1.2 m vertical face — above
   * the step height the nav grid will connect across and above
   * MOVE.mantle.autoVaultMax. A flood fill of the grid showed exactly that: the
   * plinth top was a 713-cell ISLAND with no connection to the 5703-cell ground
   * ring, so nothing could path onto the keep and every agent fell back to
   * steering straight into the plinth wall. That is the "enemies walk into
   * walls" bug, and it was mine.
   */
  ...[0, 1, 2].flatMap((i) => {
    const h = 0.4 * (i + 1);
    const off = 15.5 - i * 2;
    return [
      [0, off, 4.4, 2, h, 0, 'concrete_dark', 0],
      [-off, 0, 2, 4.4, h, 0, 'concrete_dark', 0],
      [off, 0, 2, 4.4, h, 0, 'concrete_dark', 0],
    ];
  }),
  // Cover on the plinth — breaks the sightline across it, so a horde that gets
  // up has to come around something instead of straight at you.
  [-4, 3, 3.2, 1.1, 1.1, 0, 'wood_prop', PLINTH],
  [4, -3, 3.2, 1.1, 1.1, 0, 'wood_prop', PLINTH],
  [0, 0, 1.6, 1.6, 2.0, 0.4, 'metal_rust_prop', PLINTH],

  /* ---- NE: MARKET ------------------------------------------------------ */
  [20, 20, 5.5, 3.2, 2.6, 0.15, 'plaster_pink', 0],
  [26, 13, 3.2, 5.5, 2.6, -0.1, 'plaster_cream', 0],
  [14, 25, 5.5, 3.2, 2.6, 0.1, 'plaster_sand', 0],
  // Awnings: thin slabs at head height. Colour you fight UNDER, not just past.
  [20, 15.5, 6, 0.25, 0.3, 0, 'fabric_red', 2.3],
  [24.5, 20, 0.25, 6, 0.3, 0, 'fabric_red', 2.3],
  [15, 20.5, 5, 0.25, 0.3, 0, 'fabric_teal', 2.3],
  // stalls — waist-high, vaultable
  [17, 17, 2.6, 1.0, 1.05, 0.3, 'wood_prop', 0],
  [24, 24, 2.6, 1.0, 1.05, -0.3, 'wood_prop', 0],

  /* ---- NW: GARDEN ------------------------------------------------------ */
  [-19, 19, 7, 1.2, 1.05, 0, 'foliage', 0],
  [-19, 25, 7, 1.2, 1.05, 0, 'foliage', 0],
  [-25, 19, 1.2, 7, 1.05, 0, 'foliage', 0],
  [-14, 24, 1.2, 5, 1.05, 0.2, 'foliage', 0],
  // planter walls: the hard cover the hedges are not
  [-22, 14, 6, 0.8, 0.7, 0, 'plaster_blue', 0],
  [-27, 26, 4, 0.8, 1.9, 0.4, 'plaster_blue', 0],

  /* ---- SW: YARD -------------------------------------------------------- */
  [-20, -18, 6.5, 2.6, 2.6, 0, 'metal_green', 0],
  [-20, -24, 6.5, 2.6, 2.6, 0.06, 'metal_blue', 0],
  [-26, -14, 2.6, 6.5, 2.6, 0, 'metal_rust', 0],
  [-13, -22, 2.6, 6.5, 2.6, -0.05, 'metal_rust', 0],
  // stacked: the only climb outside the keep, reached by vaulting the low crate
  [-20, -18, 5.5, 2.2, 2.4, 0, 'metal_rust', 2.6],
  [-15.5, -18, 1.6, 2.2, 1.3, 0, 'wood_prop', 0],

  /* ---- SE: POOL -------------------------------------------------------- */
  // A basin with a raised rim: the rim is cover, the inside is a place you can
  // be cornered. Tiled, so it reads as somewhere else the instant you see it.
  // The north rim is SPLIT: a sealed rectangle is a room with no door, and the
  // flood fill found the inside of it as its own dead component. A 4 m gap makes
  // it a place you can be pushed into and fight your way out of.
  [15.5, -20, 5, 0.8, 0.9, 0, 'tile_floor', 0],
  [24.5, -20, 5, 0.8, 0.9, 0, 'tile_floor', 0],
  [20, -27, 14, 0.8, 0.9, 0, 'tile_floor', 0],
  [14, -23.5, 0.8, 8, 0.9, 0, 'tile_floor', 0],
  [27, -23.5, 0.8, 8, 0.9, 0, 'tile_floor', 0],
  // diving platform — elevation in the corner furthest from safety
  [25, -14, 4, 4, 2.2, 0, 'plaster_cream', 0],

  /* ---- approach cover, all four gates ---------------------------------- */
  [0, 24, 6, 1.1, 1.05, 0, 'concrete_prop', 0],
  [0, -24, 6, 1.1, 1.05, 0, 'concrete_prop', 0],
  [-24, 0, 1.1, 6, 1.05, 0, 'concrete_prop', 0],
  [24, 0, 1.1, 6, 1.05, 0, 'concrete_prop', 0],
  // vaultable ledges, so a cornered player always has one way out
  [-12, -12, 3, 1, 0.7, 0.5, 'wood_prop', 0],
  [12, 12, 3, 1, 0.7, 0.5, 'wood_prop', 0],
];

/**
 * Player on the plinth, then the ring. `populate()` ranks spawns by distance
 * from the player and garrisons the far half, so putting the keep first and the
 * corners last makes a horde arrive from the perimeter with no mode-specific
 * code.
 */
const HOLDOUT_SPAWNS = [
  [0, 4, 0, 'the keep'],
  [-27, 27, -2.4, 'garden'],
  [27, 27, 2.4, 'market'],
  [-27, -27, -0.7, 'yard'],
  [27, -27, 0.7, 'pool'],
  [0, 29, Math.PI, 'north gate'],
];

/**
 * A stepped ramp, because a box only rotates about Y — there is no pitch, so a
 * slope has to be built out of treads. 0.35 m rises are climbed by the character
 * controller without a mantle, which is what makes an elevation change a ROUTE
 * rather than a wall.
 *
 * `dir` is the axis the ramp climbs along: 'x' or 'z'. `sign` is +1 or -1 for
 * the direction of ascent, so the top tread is the one nearest the platform.
 */
function ramp(x, z, width, dir, steps, mat, sign = 1, rise = 0.35, tread = 1.6) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const h = rise * (i + 1);
    const off = (i + 0.5) * tread * sign;
    if (dir === 'x') out.push([x + off, z, tread, width, h, 0, mat, 0]);
    else out.push([x, z + off, width, tread, h, 0, mat, 0]);
  }
  return out;
}

/**
 * DRESSING KITS — small clusters of boxes that read as one object.
 *
 * A map made of single boxes reads as a greybox no matter how well it plays,
 * because real objects are never one volume: an air handler is a body, a louvre
 * band and a cap, and it is the BAND that tells you what it is. These emit three
 * or four rows each and are the cheapest way to buy that read.
 *
 * Every child is CONCENTRIC with its parent so `rot` can be passed straight
 * through — an offset child would need the offset rotated too, and that is a
 * transform stack this format deliberately does not have.
 *
 * THE MATERIAL COUNT IS THE BUDGET, not the box count. Prewarm is rebuilt per
 * map, so a material that is new TO THIS MAP costs shader programs at boot and
 * its own draw batch every frame — Miami went 80 -> 90 programs when this kit
 * first landed with five. It now uses two that were not already on the roof
 * (`steel`, `foliage`) and borrows `neon_white` for everything else. Reach for
 * a material already in the map's list before adding one.
 */

/** Rooftop air handler. The one prop that says "roof" rather than "floor". */
function hvac(x, z, w, d, h, rot = 0) {
  return [
    [x, z, w, d, h, rot, 'steel', 0],
    // Louvre band, proud of the body so it catches its own shadow line.
    [x, z, w * 1.04, d * 1.04, h * 0.3, rot, 'steel', h * 0.42],
    // Cap plate, overhanging — an overhang is what makes a lid look like a lid.
    [x, z, w * 1.12, d * 1.12, 0.12, rot, 'steel', h],
  ];
}

/**
 * Planter. Chest-high rims are cover; these are 0.55 so they are furniture the
 * player can see over and vault, and the foliage above is visual only.
 */
function planter(x, z, w, d, rot = 0) {
  return [
    [x, z, w, d, 0.55, rot, 'neon_white', 0],
    [x, z, w * 0.86, d * 0.86, 0.75, rot, 'foliage', 0.5],
  ];
}

/**
 * Pergola — four posts and a slatted lid. Shade structures do a lot of work:
 * they frame a space as designed, and the slats break the sun into stripes,
 * which is the strongest "this is a built place" cue available for free.
 *
 * Not rotatable: the posts are offset from centre, so `rot` would need the
 * offsets rotated with it. No caller needs it, so it does not exist.
 */
function pergola(x, z, w, d, h = 2.6, slats = 5) {
  const hx = w / 2 - 0.2;
  const hz = d / 2 - 0.2;
  const out = [
    [x - hx, z - hz, 0.28, 0.28, h, 0, 'neon_white', 0],
    [x + hx, z - hz, 0.28, 0.28, h, 0, 'neon_white', 0],
    [x - hx, z + hz, 0.28, 0.28, h, 0, 'neon_white', 0],
    [x + hx, z + hz, 0.28, 0.28, h, 0, 'neon_white', 0],
    // beams along the long edges, tying the posts together
    [x, z - hz, w, 0.3, 0.28, 0, 'neon_white', h],
    [x, z + hz, w, 0.3, 0.28, 0, 'neon_white', h],
  ];
  for (let i = 0; i < slats; i++) {
    const t = (i + 0.5) / slats - 0.5;
    out.push([x + t * w, z, 0.22, d, 0.18, 0, 'neon_white', h + 0.1]);
  }
  return out;
}

/** Parasol: post plus canopy. Reads as a pool deck from anywhere on the map. */
function parasol(x, z) {
  return [
    [x, z, 0.18, 0.18, 2.3, 0, 'neon_white', 0],
    [x, z, 3.2, 3.2, 0.16, 0, 'neon_white', 2.3],
  ];
}

/* ────────────────────────────────────────────────────────────────────────── *
 *  MIAMI — the rooftop.
 *
 *  A skyscraper roof rather than its interior, and that is a NAVIGATION
 *  decision as much as an aesthetic one. The nav grid is a single 2-D height
 *  field, so two floors stacked over the same footprint give an agent two
 *  walkable surfaces at one x/z and pathing picks whichever it sampled. Real
 *  floors would need a second grid, which is a rewrite, not a map.
 *
 *  So the "floors" are TERRACES: sun deck, pool deck and helipad sit at
 *  different heights but never overlap in plan, every one reached by a stepped
 *  ramp. The player gets verticality, sightlines and drops; the grid stays a
 *  function of x and z; and no ghoul stands under a floor it cannot leave.
 *
 *  Pastel plaster, teal water and a lot of glass — the palette is doing the
 *  Miami, since downloading textures would cost the single-file build.
 * ────────────────────────────────────────────────────────────────────────── */
const MIAMI = [
  // Roof edge. Waist high so it reads as a parapet and still blocks a fall.
  ...wall('x', -33, -33, 33, 1.15, [], 0.6, 'neon_white', 0),
  ...wall('x', 33, -33, 33, 1.15, [], 0.6, 'neon_white', 0),
  ...wall('z', -33, -33, 33, 1.15, [], 0.6, 'neon_white', 0),
  ...wall('z', 33, -33, 33, 1.15, [], 0.6, 'neon_white', 0),

  // ---- penthouse, north. Two doors, so it is a route and not a trap.
  ...wall('x', 13, -13, 13, 3.4, [-7, 7], WALL_T, 'neon_white', 0),
  ...wall('x', 29, -13, 13, 3.4, [], WALL_T, 'neon_white', 0),
  ...wall('z', -13, 13, 29, 3.4, [21], WALL_T, 'neon_white', 0),
  ...wall('z', 13, 13, 29, 3.4, [21], WALL_T, 'neon_white', 0),
  // glass frontage either side of the south doors
  [-10.5, 13, 3.6, 0.25, 2.6, 0, 'glass', 0.4],
  [10.5, 13, 3.6, 0.25, 2.6, 0, 'glass', 0.4],
  // bar counter and seating inside — chest-high cover
  [-4, 22, 7, 0.9, 1.05, 0, 'neon_orange', 0],
  [5, 20, 0.9, 5, 1.05, 0, 'neon_orange', 0],

  // ---- pool deck, west. A sunken basin is not possible on a flat floor plane,
  // so the water is a rim you vault and a teal pad you stand in.
  ...wall('x', -12, -30, -14, 0.7, [], 0.5, 'neon_pink', 0),
  ...wall('x', -28, -30, -14, 0.7, [], 0.5, 'neon_pink', 0),
  ...wall('z', -30, -28, -12, 0.7, [], 0.5, 'neon_pink', 0),
  ...wall('z', -14, -28, -12, 0.7, [], 0.5, 'neon_pink', 0),
  [-22, -20, 15.4, 7.4, 0.08, 0, 'neon_teal', 0],
  // loungers
  [-18, -10, 2.2, 0.8, 0.5, 0, 'neon_pink', 0],
  [-24, -10, 2.2, 0.8, 0.5, 0, 'neon_pink', 0],

  /**
   * ---- helipad, south-east. Raised terrace, ramped from two sides.
   *
   * BOTH RAMPS USED TO BE BURIED IN THE TERRACE THEY CLIMB. The pad spans
   * z -27..-9 and x 7..25 at 1.05, and the ramps started at its edge and stepped
   * INWARDS — so two of each ramp's three steps were inside a solid 1.05 box and
   * only the first 0.35 step was ever reachable. What the player and the nav grid
   * actually met was a 0.70 face, exactly MOVE.mantle.autoVaultMax, so the pad
   * connected or did not depending on which way a sample rounded. tools/nav-check
   * had 2-3 of its 16 ring points fail here, always on this arc.
   *
   * Both now step UP TO the pad edge across open deck: the top tread's far side
   * lands exactly on the boundary (z -9, x 7), so the run is contiguous with no
   * lip and no gap. Move these and you must re-derive both, or the pad silently
   * becomes an island again.
   */
  [16, -18, 18, 18, 1.05, 0, 'neon_white', 0],
  [16, -18, 11, 11, 0.06, 0, 'neon_white', 1.05],
  ...ramp(16, -4.2, 6, 'z', 3, 'neon_purple', -1),
  ...ramp(2.2, -18, 6, 'x', 3, 'neon_purple', 1),

  // ---- plant and cover on the open deck
  [-6, 2, 3.2, 2.2, 2.1, 0, 'neon_purple', 0], // stair housing
  [6, 4, 2.4, 2.4, 1.6, 0, 'neon_cyan', 0], // AC unit
  [10, 0, 2.4, 2.4, 1.6, 0, 'neon_cyan', 0],
  [-16, 6, 2.6, 2.6, 2.6, 0, 'steel', 0], // water tank
  [20, 10, 1.1, 1.1, 1.1, 0.6, 'neon_pink', 0],
  [24, 4, 1.1, 1.1, 1.1, -0.4, 'neon_cyan', 0],
  [-24, 14, 1.1, 1.1, 1.1, 0.3, 'neon_cyan', 0],
  [2, -26, 4.4, 1.1, 1.1, 0, 'neon_white', 0],
  [-8, -24, 1.1, 4.4, 1.1, 0, 'neon_white', 0],
  [-20, -30, 3.2, 1.1, 1.1, 0, 'neon_orange', 0],

  /**
   * NEON. Thin emissive strips laid along the parapet, the pool rim and the
   * penthouse frontage.
   *
   * This is what the map was missing far more than it was missing geometry: at
   * a low sun everything reads as one warm mass, and a few self-lit lines give
   * the eye edges to follow and the level an identity. They are 0.12 m tall so
   * they are decoration rather than cover, and cost four boxes each.
   */
  [0, -32.6, 60, 0.3, 0.14, 0, 'window_glow', 1.15],
  [0, 32.6, 60, 0.3, 0.14, 0, 'window_glow', 1.15],
  [-32.6, 0, 0.3, 60, 0.14, 0, 'emissive_warm', 1.15],
  [32.6, 0, 0.3, 60, 0.14, 0, 'emissive_warm', 1.15],
  // pool rim glow — reads as underwater lighting from above
  [-22, -13.7, 15.6, 0.28, 0.12, 0, 'window_glow', 0.7],
  [-22, -30.3, 15.6, 0.28, 0.12, 0, 'window_glow', 0.7],
  // penthouse sign band above the glass
  [0, 12.7, 24, 0.25, 0.5, 0, 'emissive_warm', 2.9],
  // helipad perimeter lights
  [16, -26.6, 16, 0.3, 0.12, 0, 'lamp_lens', 1.05],
  [16, -9.4, 16, 0.3, 0.12, 0, 'lamp_lens', 1.05],

  /**
   * PARAPET COPING. A 0.6 m slab ending in mid-air reads as a cut, not an edge;
   * a cap that overhangs it by 0.1 each side gives the roof a finished line all
   * the way round. Four boxes for the single biggest silhouette improvement
   * available, because the parapet is in frame from everywhere on the map.
   */
  [0, -33, 66, 0.8, 0.12, 0, 'steel', 1.15],
  [0, 33, 66, 0.8, 0.12, 0, 'steel', 1.15],
  [-33, 0, 0.8, 66, 0.12, 0, 'steel', 1.15],
  [33, 0, 0.8, 66, 0.12, 0, 'steel', 1.15],

  /**
   * PLANT ROOM, north-east. Every roof is reached from inside the building, and
   * the stair bulkhead is what makes that legible. It also breaks the long
   * sightline down the east flank, which was the one lane on this map with no
   * cover in it at all.
   */
  [22, 20, 4.6, 4.2, 2.6, 0, 'neon_white', 0],
  [22, 17.85, 2.2, 0.3, 2.1, 0, 'neon_orange', 0], // door
  [22, 20, 5.0, 4.6, 0.14, 0, 'steel', 2.6], // capping

  // ---- machinery yard behind it: the working half of a luxury roof
  ...hvac(28, 26, 4.4, 3.2, 1.9, 0.18),
  ...hvac(22, 27.5, 3.2, 2.6, 1.4),
  ...hvac(29.5, 18, 2.8, 3.6, 1.6, -0.25),
  // duct run tying the plant room to the units — chest-high, so it is cover
  [25.4, 22.5, 5.6, 0.9, 1.1, 0, 'steel', 0],
  // water tank on legs. The tallest thing up here and the map's landmark:
  // wherever you are, this tells you which way north-east is.
  [30, 30.5, 0.3, 0.3, 1.7, 0, 'steel', 0],
  [26.6, 30.5, 0.3, 0.3, 1.7, 0, 'steel', 0],
  [30, 27.4, 0.3, 0.3, 1.7, 0, 'steel', 0],
  [26.6, 27.4, 0.3, 0.3, 1.7, 0, 'steel', 0],
  [28.3, 29, 4.6, 4.4, 2.3, 0, 'steel', 1.7],
  [28.3, 29, 4.9, 4.7, 0.16, 0, 'steel', 4.0],
  // antenna mast, south of the tank
  [31, 13, 0.24, 0.24, 5.4, 0, 'steel', 0],
  [31, 13, 1.4, 0.16, 0.14, 0, 'steel', 4.3],

  /**
   * PLANTING along the penthouse frontage. Placed BETWEEN the two doors
   * (x = -7 and x = +7, 2.4 m wide) and outboard of them, so the approach into
   * the penthouse is untouched and the frontage stops being a flat white wall.
   */
  ...planter(-11.5, 10.6, 3.4, 1.3),
  ...planter(0, 10.6, 4.6, 1.3),
  ...planter(11.5, 10.6, 3.4, 1.3),
  ...planter(-29, 9, 1.3, 5.2),
  ...planter(-29, 20, 1.3, 5.2),
  ...planter(29, -2, 1.3, 4.6),

  /**
   * POOL DECK. A timber pad zones the wet end of the roof away from the plaster
   * — a floor that changes material is the difference between rooms and one
   * continuous plane. 0.05 tall, so it is a surface and never a step.
   */
  [-22, -9.6, 18, 4.2, 0.05, 0, 'neon_white', 0],
  [-11.6, -20, 4.2, 18, 0.05, 0, 'neon_white', 0],
  ...parasol(-17.5, -9.6),
  ...parasol(-26.5, -9.6),

  /**
   * EAST LOUNGE. The east deck was empty floor between the helipad and the
   * penthouse; a pergola gives it a reason to exist and gives the player
   * something to fight around on the way between the two.
   */
  ...pergola(25, 4, 10, 8),
  [25, 4, 5.2, 0.9, 1.05, 0, 'neon_orange', 0], // bar counter, chest-high cover
];

/** Player on the open deck at ground level — a spawn must be walkable ground. */
const MIAMI_SPAWNS = [
  [0, -4, 0, 'sun deck'],
  [-26, 24, -2.2, 'pool stair'],
  [26, 26, 2.4, 'penthouse east'],
  [28, -30, 1.2, 'helipad ramp'],
  [-28, -4, -1.6, 'west edge'],
  [0, 30, Math.PI, 'penthouse'],
];

/* ────────────────────────────────────────────────────────────────────────── *
 *  ZONE — the Soviet works.
 *
 *  Cracked concrete, panel blocks and rusted steel: a decommissioned plant with
 *  a yard around it. Same terrace rule as MIAMI — the loading dock and the
 *  substation roof are raised and ramped, never stacked over anything.
 *
 *  Shape is a broken ring: three buildings around a central yard with gaps
 *  between them, so a horde arrives from several bearings at once and the
 *  player can always break line of sight by rounding a corner rather than by
 *  finding the one correct door.
 * ────────────────────────────────────────────────────────────────────────── */
const ZONE = [
  // perimeter fence — corrugated, with two gaps that read as ways out
  ...wall('x', -35, -35, 35, 2.4, [-12, 14], 0.3, 'corrugated', 0),
  ...wall('x', 35, -35, 35, 2.4, [0], 0.3, 'corrugated', 0),
  ...wall('z', -35, -35, 35, 2.4, [10], 0.3, 'corrugated', 0),
  ...wall('z', 35, -35, 35, 2.4, [-10], 0.3, 'corrugated', 0),

  // ---- panel block, north-west. Gutted: two doors and no roof to hide under.
  ...wall('x', 12, -30, -8, 3.6, [-24, -14], WALL_T, 'concrete_dark', 0),
  ...wall('x', 26, -30, -8, 3.6, [-20], WALL_T, 'concrete_dark', 0),
  ...wall('z', -30, 12, 26, 3.6, [19], WALL_T, 'concrete_dark', 0),
  ...wall('z', -8, 12, 26, 3.6, [19], WALL_T, 'concrete_dark', 0),
  // internal spine, so the inside is two rooms rather than one hall
  ...wall('z', -19, 14, 24, 2.6, [17, 22], WALL_T, 'concrete', 0),

  // ---- workshop, east. Open front onto the yard.
  ...wall('z', 16, -22, 4, 3.2, [-16, -4], WALL_T, 'brick', 0),
  ...wall('z', 30, -22, 4, 3.2, [], WALL_T, 'brick', 0),
  ...wall('x', -22, 16, 30, 3.2, [23], WALL_T, 'brick', 0),
  ...wall('x', 4, 16, 30, 3.2, [23], WALL_T, 'brick', 0),
  // loading dock: raised platform with a ramp down into the yard
  [23, -12, 12, 5, 1.05, 0, 'concrete', 0],
  ...ramp(23, -7.5, 5, 'z', 3, 'concrete_dark', 1),

  // ---- substation, south-west. Low roof you can actually get onto.
  [-20, -20, 12, 12, 2.1, 0, 'brick_fine', 0],
  ...ramp(-11.5, -20, 5, 'x', 6, 'concrete_dark', 1, 0.35, 1.5),

  // ---- yard clutter: cover at chest height, vaultable at 0.7
  [0, 0, 3.2, 3.2, 2.8, 0.4, 'metal_rust', 0], // reactor stack
  [-4, 8, 2.2, 2.2, 1.1, 0, 'metal_rust_prop', 0],
  [6, -6, 4.4, 1.1, 1.1, 0, 'concrete_prop', 0],
  [12, 6, 1.1, 4.4, 1.1, 0, 'concrete_prop', 0],
  [-8, -6, 2.6, 1.1, 0.7, 0, 'wood_dark', 0],
  [8, 14, 2.6, 1.1, 0.7, 0, 'wood_dark', 0],
  [18, 24, 2.4, 2.4, 1.6, 0.3, 'metal_rust', 0],
  [-28, 4, 2.4, 2.4, 1.6, -0.5, 'metal_rust', 0],
  [30, 14, 1.1, 6, 1.1, 0, 'concrete_prop', 0],
  [-14, 30, 6, 1.1, 1.1, 0, 'concrete_prop', 0],
  [26, -30, 3.2, 3.2, 2.2, 0.2, 'metal_dark', 0],

  // ---- colour, so the yard is not one grey mass. Soviet industrial paint is
  // actually loud: ochre panels, teal doors, red-lead primer on the steelwork.
  [-19, 12.2, 12, 0.3, 2.4, 0, 'metal_green', 0], // panel block door band
  [23, 15.8, 12, 0.3, 2.2, 0, 'fabric_teal', 0], // workshop shutter
  [-20, -13.8, 12, 0.3, 2.1, 0, 'metal_rust', 0], // substation face
  [0, 0, 3.6, 3.6, 0.35, 0.4, 'metal_rust_prop', 2.8], // stack cap
  // sodium lamps on the yard poles — the one warm note in a cold map
  [-14, -2, 0.35, 0.35, 5.2, 0, 'metal_dark', 0],
  [-14, -2, 0.9, 0.9, 0.3, 0, 'lamp_lens', 5.2],
  [14, 10, 0.35, 0.35, 5.2, 0, 'metal_dark', 0],
  [14, 10, 0.9, 0.9, 0.3, 0, 'lamp_lens', 5.2],
  [2, 26, 0.35, 0.35, 5.2, 0, 'metal_dark', 0],
  [2, 26, 0.9, 0.9, 0.3, 0, 'lamp_lens', 5.2],
  // hazard striping at the dock edge
  [23, -14.6, 12, 0.3, 0.14, 0, 'emissive_warm', 1.05],
];

/** Yard centre-south: open, flat, and away from the buildings' footprints. */
const ZONE_SPAWNS = [
  [0, -26, 0, 'yard'],
  [-30, 30, -2.4, 'panel block'],
  [30, 30, 2.4, 'workshop'],
  [-30, -32, -0.6, 'substation'],
  [32, 0, 1.6, 'east gate'],
  [0, 32, Math.PI, 'north gap'],
];

export const ARENAS = {
  strike: { walls: STRIKE, spawns: STRIKE_SPAWNS, floor: [68, 48], ground: 'road_dust' },
  holdout: { walls: HOLDOUT, spawns: HOLDOUT_SPAWNS, floor: [68, 68], ground: 'sand' },
  /**
   * 13.0, measured rather than picked. tools/hour-sweep.mjs prints the sun's
   * blue/red ratio against the hour: it peaks at 0.755 around noon and falls
   * away hard on both sides (0.70 at 15.4, 0.46 at 18). Since white plaster
   * renders as albedo x sun colour, every hour after ~14 turns this deck beige
   * no matter what the palette says — the "concrete" in the screenshots was
   * literally the light, measured at rgb(160,143,122) with a sun tint of
   * (1, 0.87, 0.70). 13.0 keeps the sun near its most neutral while the
   * altitude (65 degrees) still throws readable shadows.
   */
  miami: {
    walls: MIAMI,
    spawns: MIAMI_SPAWNS,
    floor: [70, 70],
    ground: 'neon_white',
    sky: 13.0,
    /** Negative EV = brighter. See the note in world/index.js. */
    exposure: -1.2,
    /**
     * `cloudCoverage`, NOT `coverage`. setWeather is an Object.assign onto the
     * live weather object, so a wrong key is silently accepted and the sky
     * simply never changes — which is exactly what a previous pass did here,
     * writing two dead properties and leaving the default overcast in place.
     * The names are in SkySystem's `this.weather`, not in its doc comment.
     */
    /**
     * The "grey goo sky" was the HORIZON, not the dome. Pointed up, this sky
     * already measured a saturated blue (sat 0.7); pointed at the skyline —
     * which is where a first-person camera actually looks — it measured
     * rgb(130,123,114), a flat grey-tan band. That band is aerosol: turbidity
     * scatters the blue out, `horizonMurk` deliberately fades the dome to grey
     * at eye level, and the fog sits on top of both. All three are dialled to
     * near-nothing here, so the blue runs all the way down to the parapet.
     */
    weather: {
      cloudCoverage: 0.0,
      cirrusCoverage: 0.08,
      turbidity: 1.1,
      horizonMurk: 0.015,
      /**
       * ZERO, and this is the single line that fixed "the skybox is grey goo".
       *
       * Fog integrates along the view ray, and the sky is at effectively
       * infinite distance, so it accumulates to full opacity and REPLACES the
       * dome rather than tinting it. Measured on this exact view: at a density
       * of 0.03 — which reads like "barely any" — the horizon sampled
       * rgb(147,143,140), flat grey; at 0 the same pixel is rgb(8,112,144),
       * the ocean. Nothing else about the sky had to change. Every previous
       * attempt was tuning the dome underneath an opaque grey sheet.
       */
      fogDensity: 0,
      // A rooftop has no walls to the skyline, so everything past the parapet
      // is the sky's lower hemisphere and this colour is literally the whole
      // backdrop. Miami is looking at the Atlantic.
      groundAlbedo: 0x1d7f96,
    },
  },
  // The Zone keeps its overcast — there it is the point rather than an accident.
  zone: {
    walls: ZONE,
    spawns: ZONE_SPAWNS,
    floor: [74, 74],
    ground: 'asphalt',
    sky: 16.2,
    weather: {
      cloudCoverage: 0.62,
      cirrusCoverage: 0.4,
      turbidity: 3.2,
      fogDensity: 0.6,
      // Wet pine and dead grass to the treeline, not desert sand.
      groundAlbedo: 0x3c4433,
    },
  },
};

/**
 * @param {object} A   the world Assembler
 * @param {string} id  'strike' | 'holdout'
 */
export function buildArena(A, id) {
  const spec = ARENAS[id];
  if (!spec) return;

  /**
   * The palette entries are `vertexMasks: true`, so the wear/grime/AO attribute
   * has to exist before the geometry is merged — without it the Accum drops the
   * mesh and the level renders as nothing but collision. Same trap as the
   * whitebox and the shoot house; see the note there.
   */
  const flat = (g) => (
    paintMasks(g, (x, y, z, nx, ny, nz, out) => {
      out[0] = 0.08;
      out[1] = 0.1;
      out[2] = 0;
    }),
    g
  );

  const ground = spec.ground ?? 'plaster_white';
  const floor = flat(new THREE.PlaneGeometry(spec.floor[0], spec.floor[1], 1, 1));
  floor.rotateX(-Math.PI / 2);
  A.add(ground, floor, null);
  A.collideGeo(ground, floor);
  floor.dispose();

  /**
   * One unit cube, reused for every box. `mat` and `y` are optional tail fields,
   * so the older six-field rows still read the same. `y` is the base the box
   * SITS ON, not its centre — that is how a floor plan is written, and it is the
   * only way stacking onto a plinth stays legible.
   */
  const unit = flat(new THREE.BoxGeometry(1, 1, 1));
  for (const [x, z, w, d, h, ry, mat, y] of spec.walls) {
    const m = mat ?? 'plaster_white';
    const cy = (y ?? 0) + h / 2;
    A.addBox(m, unit, x, cy, z, ry, w, h, d);
    A.box(m, x, cy, z, w, h, d, ry);
  }
  unit.dispose();
}
