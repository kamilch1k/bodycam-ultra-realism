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
 *  YARD — a compact open arena with a central block.
 *
 *  The read is instant: one building in the middle you can circle either way,
 *  four corners with cover, and sightlines short enough that a fight starts
 *  within a couple of seconds of spawning. The central block has two through
 *  routes so it is a loop rather than a wall, which is what keeps a chase alive.
 * ────────────────────────────────────────────────────────────────────────── */
const YARD = [
  // perimeter, 52 x 44
  ...wall('x', 22, -26, 26, 4.5, [], 0.6),
  ...wall('x', -22, -26, 26, 4.5, [], 0.6),
  ...wall('z', -26, -22, 22, 4.5, [], 0.6),
  ...wall('z', 26, -22, 22, 4.5, [], 0.6),

  // central block, 16 x 10, open through both axes
  ...wall('x', 5, -8, 8, 3, [0]),
  ...wall('x', -5, -8, 8, 3, [0]),
  ...wall('z', -8, -5, 5, 3, [0]),
  ...wall('z', 8, -5, 5, 3, [0]),

  // corner cover — two low, two tall, so no corner plays like another
  [-17, 15, 5, 1.2, 1.1, 0.25],
  [17, -15, 5, 1.2, 1.1, -0.25],
  [-17, -14, 3.4, 3.4, 2.6, 0.4],
  [17, 14, 3.4, 3.4, 2.6, -0.4],

  // mid-lane cover, offset so the two lanes are not mirror images
  [0, 16, 6, 1.2, 1.1, 0],
  [0, -16, 4, 1.2, 1.1, 0],
  [-14, 2, 1.2, 5, 1.1, 0],
  [14, -2, 1.2, 5, 1.1, 0],
  // vaultable ledges: a route, not an obstacle
  [-9, -9, 3, 1, 0.7, 0.5],
  [9, 9, 3, 1, 0.7, 0.5],
];

const YARD_SPAWNS = [
  [-20, 18, -2.4, 'north west'],
  [20, 18, 2.4, 'north east'],
  [-20, -18, -0.7, 'south west'],
  [20, -18, 0.7, 'south east'],
  [0, 19, Math.PI, 'north gate'],
  [0, -19, 0, 'south gate'],
];

/* ────────────────────────────────────────────────────────────────────────── *
 *  DEPOT — an indoor hall of aisles.
 *
 *  Crate rows make parallel lanes with gaps you can cut through, so the fight
 *  is about which lane the other player is in. Two offices at the ends give the
 *  map its only enclosed spaces and its only long sightline, down the middle.
 * ────────────────────────────────────────────────────────────────────────── */
const DEPOT = [
  // shell, 56 x 36
  ...wall('x', 18, -28, 28, 5, [], 0.5),
  ...wall('x', -18, -28, 28, 5, [], 0.5),
  ...wall('z', -28, -18, 18, 5, [], 0.5),
  ...wall('z', 28, -18, 18, 5, [], 0.5),

  /**
   * Offices at each END OF THE HALL — that is x, not z: `wall('z', …)` runs
   * ALONG z at a fixed x. Two doors each, so neither is a dead end.
   */
  ...wall('z', -17, -18, 18, 3.2, [-9, 9]),
  ...wall('z', 17, -18, 18, 3.2, [-9, 9]),

  // four crate aisles. Rows are broken into stacks with cut-throughs between,
  // so a lane is a choice rather than a corridor.
  ...[-9, -3, 3, 9].flatMap((x, i) => {
    const tall = i % 2 === 0;
    const h = tall ? 2.4 : 1.1;
    return [
      [x, -11, 2.2, 6, h, 0],
      [x, -2.5, 2.2, 7, h, 0],
      [x, 7, 2.2, 6, h, 0],
    ];
  }),

  // Office furniture — inside the offices, which sit beyond x = +-17.
  [-22, -9, 1.2, 4, 1.1, 0],
  [-22, 9, 1.2, 4, 1.1, 0],
  [22, -9, 1.2, 4, 1.1, 0],
  [22, 9, 1.2, 4, 1.1, 0],
  [-23, 0, 3, 1.2, 1.1, 0.3],
  [23, 0, 3, 1.2, 1.1, -0.3],
  // vaultable pallets in the central lane
  [-14, 0, 1, 2.4, 0.7, 0],
  [14, 0, 1, 2.4, 0.7, 0],
];

const DEPOT_SPAWNS = [
  [-24, -12, Math.PI / 2, 'west office south'],
  [-24, 12, Math.PI / 2, 'west office north'],
  [24, -12, -Math.PI / 2, 'east office south'],
  [24, 12, -Math.PI / 2, 'east office north'],
  [0, -15, 0, 'floor south'],
  [0, 15, Math.PI, 'floor north'],
];

export const ARENAS = {
  yard: { walls: YARD, spawns: YARD_SPAWNS, floor: [60, 52] },
  depot: { walls: DEPOT, spawns: DEPOT_SPAWNS, floor: [64, 44] },
};

/**
 * @param {object} A   the world Assembler
 * @param {string} id  'yard' | 'depot'
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
