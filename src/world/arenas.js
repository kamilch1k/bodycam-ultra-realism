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

export const ARENAS = {
  strike: { walls: STRIKE, spawns: STRIKE_SPAWNS, floor: [68, 48], ground: 'road_dust' },
  holdout: { walls: HOLDOUT, spawns: HOLDOUT_SPAWNS, floor: [68, 68], ground: 'sand' },
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
