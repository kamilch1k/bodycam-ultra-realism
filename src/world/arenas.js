import * as THREE from 'three';
import { paintMasks } from './util.js';

/**
 * Arcade arenas — `?map=yard` and `?map=depot`.
 *
 * Built to the same one-surface, one-box-prototype rule as the shoot house, so
 * each adds a single material and a single program and is up in milliseconds.
 * That constraint is the whole reason this game can ship on a portal.
 *
 * They are DELIBERATELY SMALLER than the shoot house. That map is a CQB
 * training layout — six rooms, one corridor, built to reward clearing angles
 * patiently. This game is played in ninety-second sittings on a phone with a
 * thumb, and the failure mode there is not dying, it is walking for eight
 * seconds and finding nobody. Both are sized so the farthest two spawns are
 * about 54 m apart — 13 s at a walk, 9 s at a sprint, and that is the WORST
 * case across a diagonal; most pairs are half of it.
 *
 * Shared shape rules, learned from the shoot house:
 *   - every space has two ways out, so no room is a dead end
 *   - cover is 1.1 m: chest height standing, full cover crouched, which is what
 *     makes the crouch button worth pressing
 *   - nothing above 3 m except the perimeter, so the skyline stays readable and
 *     a player can always see where the fight is
 *   - 0.7 m ledges are vaultable (MOVE.mantle.autoVaultMax), so a low block is a
 *     route rather than an obstacle
 */

const WALL_T = 0.35;
const DOOR = 2.4;

/**
 * A straight wall with doorways punched out of it, given as centres along the
 * wall's own axis — the way a floor plan is read, rather than as the surviving
 * segments, which is what the renderer needs.
 */
function wall(axis, fixed, a, b, h, doors = [], t = WALL_T) {
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
    if (axis === 'x') out.push([mid, fixed, e - s, t, h, 0]);
    else out.push([fixed, mid, t, e - s, h, 0]);
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
 *
 *  Both empty onto the SITE in the middle. That is the whole design: one place
 *  worth standing, two ways to reach it, and no third option to memorise.
 * ────────────────────────────────────────────────────────────────────────── */
const STRIKE = [
  // perimeter, 64 x 44
  ...wall('x', 22, -32, 32, 5, [], 0.6),
  ...wall('x', -22, -32, 32, 5, [], 0.6),
  ...wall('z', -32, -22, 22, 5, [], 0.6),
  ...wall('z', 32, -22, 22, 5, [], 0.6),

  // The spine that splits long from short. One doorway at mid so the two lanes
  // are connected rather than parallel — without it the map is two corridors
  // and every round plays identically.
  ...wall('x', 2, -20, 20, 3.2, [-4]),

  // SHORT — the south building. Two doors, so it is a route and never a trap.
  ...wall('x', -10, -14, 6, 3.2, [-4]),
  ...wall('z', -14, -10, 2, 3.2, [-6]),
  ...wall('z', 6, -10, 2, 3.2, [-6]),

  // SITE — waist-high crates you fight over. Deliberately not a room: cover you
  // can shoot across beats cover you hide behind.
  [0, 10, 5, 1.2, 1.1, 0],
  [-4, 14, 1.2, 4, 1.1, 0],
  [4, 14, 1.2, 4, 1.1, 0],
  [0, 17, 3.4, 1.2, 1.9, 0],

  // LONG — sparse cover, placed so the lane is crossable but never safe.
  [-16, 14, 3.4, 1.2, 1.1, 0.3],
  [16, 12, 3.4, 1.2, 1.1, -0.3],
  [-24, 8, 1.2, 5, 1.9, 0],
  [24, 8, 1.2, 5, 1.9, 0],

  // spawn-side cover, so neither team is shot the instant it appears
  [-27, -16, 4, 1.2, 1.1, 0],
  [27, -16, 4, 1.2, 1.1, 0],
  // vaultable ledges into the site
  [-7, 6, 3, 1, 0.7, 0],
  [7, 6, 3, 1, 0.7, 0],
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
 *  Inverted from every other level here. The others are symmetrical because two
 *  sides meet on equal terms; this one has a CENTRE and an OUTSIDE, because the
 *  fight is one player against a tide that arrives from all of it.
 *
 *  The keep is 18 x 18 with THREE doors, never four and never one. One door is
 *  a choke you hold forever and the mode stops being a game; four means you are
 *  flanked from behind whichever way you turn. Three is the number that makes
 *  you keep moving without ever being surrounded.
 *
 *  No roof and nothing above 3 m, so you can always see which side the next
 *  wave is coming from — the whole tension of a horde mode is reading that
 *  early, and a wall you cannot see over converts tension into a cheap death.
 * ────────────────────────────────────────────────────────────────────────── */
const HOLDOUT = [
  // perimeter, 60 x 60 — square on purpose: no direction is the safe one
  ...wall('x', 30, -30, 30, 5, [], 0.6),
  ...wall('x', -30, -30, 30, 5, [], 0.6),
  ...wall('z', -30, -30, 30, 5, [], 0.6),
  ...wall('z', 30, -30, 30, 5, [], 0.6),

  // THE KEEP — three doors: north, west, east. South is solid, so there is
  // always one wall you can put your back to.
  ...wall('x', 9, -9, 9, 3, [0]),
  ...wall('x', -9, -9, 9, 3, []),
  ...wall('z', -9, -9, 9, 3, [0]),
  ...wall('z', 9, -9, 9, 3, [0]),

  // Interior cover — breaks line of sight across the keep so a horde that gets
  // in has to come around something instead of straight at you.
  [-4, 3, 3.4, 1.2, 1.1, 0],
  [4, -3, 3.4, 1.2, 1.1, 0],
  [0, 0, 1.2, 1.2, 1.9, 0.4],

  // Approach cover — the horde funnels past these, which is what makes a
  // grenade or a burst on the choke worth spending.
  [-18, 14, 4, 1.2, 1.1, 0.2],
  [18, 14, 4, 1.2, 1.1, -0.2],
  [-18, -14, 4, 1.2, 1.1, -0.2],
  [18, -14, 4, 1.2, 1.1, 0.2],
  [0, 22, 6, 1.2, 1.1, 0],
  [0, -22, 6, 1.2, 1.1, 0],
  [-24, 0, 1.2, 6, 1.1, 0],
  [24, 0, 1.2, 6, 1.1, 0],
  // vaultable ledges, so a cornered player always has one way out
  [-12, -12, 3, 1, 0.7, 0.5],
  [12, 12, 3, 1, 0.7, 0.5],
];

/**
 * Player first, then the ring. `populate()` ranks spawns by distance from the
 * player and garrisons the far half, so putting the keep first and the corners
 * last makes a horde arrive from the perimeter without any mode-specific code.
 */
const HOLDOUT_SPAWNS = [
  [0, 0, 0, 'the keep'],
  [-26, 26, -2.4, 'north west'],
  [26, 26, 2.4, 'north east'],
  [-26, -26, -0.7, 'south west'],
  [26, -26, 0.7, 'south east'],
  [0, 27, Math.PI, 'north gate'],
];

export const ARENAS = {
  strike: { walls: STRIKE, spawns: STRIKE_SPAWNS, floor: [68, 48] },
  holdout: { walls: HOLDOUT, spawns: HOLDOUT_SPAWNS, floor: [64, 64] },
};

/**
 * @param {object} A   the world Assembler
 * @param {string} id  'strike' | 'holdout'
 */
export function buildArena(A, id) {
  const spec = ARENAS[id];
  if (!spec) return;

  /**
   * The palette entry is `vertexMasks: true`, so the wear/grime/AO attribute
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

  const floor = flat(new THREE.PlaneGeometry(spec.floor[0], spec.floor[1], 1, 1));
  floor.rotateX(-Math.PI / 2);
  A.add('plaster_white', floor, null);
  A.collideGeo('plaster_white', floor);
  floor.dispose();

  const unit = flat(new THREE.BoxGeometry(1, 1, 1));
  for (const [x, z, w, d, h, ry] of spec.walls) {
    A.addBox('plaster_white', unit, x, h / 2, z, ry, w, h, d);
    A.box('plaster_white', x, h / 2, z, w, h, d, ry);
  }
  unit.dispose();
}
