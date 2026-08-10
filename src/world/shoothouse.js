import * as THREE from 'three';
import { paintMasks } from './util.js';

/**
 * SWAT shoot house — `?map=swat`.
 *
 * A CQB kill house: a compound wall, a courtyard to stack up in, and a
 * six-room building fed by one central corridor. Every room has two ways in,
 * because a room with one door is a corridor with extra steps — you clear it
 * from the only angle there is and nothing about the fight changes.
 *
 * OPEN TOPPED, and that is not a shortcut. Real shoot houses are built without
 * roofs so instructors can watch from a catwalk, which means the honest version
 * of this level is also the one where the sun still reaches the floor, the CSM
 * still has something to do, and the interiors do not need a single light. Roof
 * it and every room needs its own bulb plus the whole indoor lighting path.
 *
 * Built from ONE surface and ONE box prototype, like the whitebox — that is what
 * keeps it to a single material and a single program, and why it loads in
 * milliseconds instead of the street map's ~25 s.
 *
 * Geometry, in level metres:
 *   compound wall     76 x 60, 4.5 m
 *   building shell    48 x 36, 3.4 m, centred
 *   corridor          3.4 m wide on x = 0, running the full 36 m
 *   rooms             three per side, split at z = -6 and z = +6
 *   doorways          2.2 m — wider than a real door on purpose, so the nav
 *                     grid resolves several walkable cells through each one
 */

const DOOR = 2.2;
const WALL_T = 0.35;
const SHELL_H = 3.4;
const COMPOUND_H = 4.5;

/**
 * One straight wall with doorways punched out of it.
 *
 * Gaps are given as centres along the wall's own axis, which is how you think
 * about a floor plan — "a door 6 m in from the corner" — rather than as the
 * four surviving segments, which is what the renderer needs.
 *
 * @param {'x'|'z'} axis   direction the wall runs
 * @param {number} fixed   its position on the other axis
 * @param {number} a       start along `axis`
 * @param {number} b       end along `axis`
 * @param {number} h       height
 * @param {number[]} doors centres of the openings
 * @param {number} t       thickness
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
    const len = e - s;
    if (len <= 0.05) continue;
    const mid = (s + e) / 2;
    if (axis === 'x') out.push([mid, fixed, len, t, h, 0]);
    else out.push([fixed, mid, t, len, h, 0]);
  }
  return out;
}

/** [x, z, width, depth, height, yaw]; y is the base. */
const WALLS = [
  /* ---- compound wall, with a vehicle gate on the south ------------------ */
  ...wall('x', 30, -38, 38, COMPOUND_H, [], 0.6),
  ...wall('x', -30, -38, 38, COMPOUND_H, [], 0.6),
  ...wall('z', -38, -30, 30, COMPOUND_H, [], 0.6),
  ...wall('z', 38, -30, 30, COMPOUND_H, [], 0.6),

  /* ---- building shell --------------------------------------------------
   * Two entries and they are not opposite each other: the front door on the
   * south at x = -6 and the rear at x = +14 on the north. An assault that can
   * come from two corners at once is the whole point of the layout, and putting
   * them in line would let a single defender hold both.
   */
  ...wall('x', 18, -24, 24, SHELL_H, [-6]),
  ...wall('x', -18, -24, 24, SHELL_H, [14]),
  ...wall('z', -24, -18, 18, SHELL_H, [8]),
  ...wall('z', 24, -18, 18, SHELL_H, [-10]),

  /* ---- central corridor ------------------------------------------------
   * Doors are OFFSET between the two sides — never facing each other across
   * the hall. Facing doors turn the corridor into a crossfire where both rooms
   * cover each other's threshold, which is exactly the geometry a stack is
   * trained to avoid and no fun to attack.
   */
  ...wall('z', -1.7, -18, 18, SHELL_H, [-12, 0.5, 13]),
  ...wall('z', 1.7, -18, 18, SHELL_H, [-8, 4.5, 9]),

  /* ---- room dividers, west side (x < 0) --------------------------------
   * Each divider carries a door too, so the three west rooms chain together
   * and a defender pushed out of one can fall back without using the hall.
   */
  ...wall('x', -6, -24, -1.7, SHELL_H, [-19]),
  ...wall('x', 6, -24, -1.7, SHELL_H, [-13]),

  /* ---- room dividers, east side ---------------------------------------- */
  ...wall('x', -6, 1.7, 24, SHELL_H, [18]),
  ...wall('x', 8, 1.7, 24, SHELL_H, [12]),

  /* ---- interior cover, waist high --------------------------------------
   * Enough to break a room into two firing positions, never enough to make one
   * unclearable. 1.1 m is chest height standing and full cover crouched, which
   * is what makes the crouch button worth pressing indoors.
   */
  [-17, 12, 4, 1.2, 1.1, 0.2],
  [-9, -12, 1.2, 5, 1.1, 0],
  [-19, -2, 3, 3, 1.1, -0.3],
  [13, -13, 5, 1.2, 1.1, 0],
  [19, 3, 1.2, 4.5, 1.1, 0],
  [9, 14, 3, 3, 1.1, 0.35],
  // Corridor furniture: one obstacle so the hall is not a bowling alley.
  [0, -3.5, 2.6, 1.2, 1.1, 0],

  /* ---- courtyard -------------------------------------------------------
   * A stack-up wall short of the front door, a shipping container long enough
   * to cast a real shadow, and two low blocks for the approach.
   */
  [-6, 25, 7, 0.6, 2.1, 0],
  [16, 26, 12, 2.6, 2.8, 0.08],
  [-20, 24, 3, 3, 1.1, 0.4],
  [24, -26, 4, 4, 2.4, -0.2],
  [-24, -26, 6, 2.4, 1.1, 0.15],
];

export function buildShootHouse(A) {
  /**
   * The palette entry is `vertexMasks: true`, so the wear/grime/AO attribute
   * has to exist before the geometry is merged — without it the Accum drops
   * the mesh and the level renders as nothing but collision. Same trap as the
   * whitebox; see the note there.
   */
  const flat = (g) => (
    paintMasks(g, (x, y, z, nx, ny, nz, out) => {
      out[0] = 0.08;
      out[1] = 0.1;
      out[2] = 0;
    }),
    g
  );

  const floor = flat(new THREE.PlaneGeometry(84, 68, 1, 1));
  floor.rotateX(-Math.PI / 2);
  A.add('plaster_white', floor, null);
  A.collideGeo('plaster_white', floor);
  floor.dispose();

  const unit = flat(new THREE.BoxGeometry(1, 1, 1));
  for (const [x, z, w, d, h, ry] of WALLS) {
    A.addBox('plaster_white', unit, x, h / 2, z, ry, w, h, d);
    A.box('plaster_white', x, h / 2, z, w, h, d, ry);
  }
  unit.dispose();
}
