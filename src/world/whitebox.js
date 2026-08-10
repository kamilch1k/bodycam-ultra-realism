import * as THREE from 'three';
import { paintMasks } from './util.js';

/**
 * Whitebox arena — `?map=box`.
 *
 * A greybox test level: flat floor, perimeter wall, a handful of blocks for
 * cover. It exists because the street map costs ~25 s to load, almost all of it
 * shader compilation for the procedural surfaces, and that made every iteration
 * on the viewmodel, the weapon feel or the AI a 25-second round trip.
 *
 * It is deliberately built from ONE surface and ONE box prototype, so the whole
 * level adds a single material and a single program to compile.
 *
 * Layout is CS-ish on purpose: a long central lane with cover you can cut across,
 * two flanking routes, and nothing taller than head height in the middle so the
 * sight lines stay readable while testing.
 */

/** [x, z, width, depth, height, yaw] in level space, y is the base. */
const WALLS = [
  // perimeter, 80 x 80, 4 m tall
  [0, -40, 80, 1, 4, 0],
  [0, 40, 80, 1, 4, 0],
  [-40, 0, 1, 80, 4, 0],
  [40, 0, 1, 80, 4, 0],

  // central spine, broken so it can be flanked
  [0, -8, 1, 22, 3, 0],
  [0, 10, 1, 14, 3, 0],

  // waist-high cover along the lane
  [-9, 4, 4, 1, 1.1, 0],
  [9, -2, 4, 1, 1.1, 0],
  [-6, -14, 3, 1, 1.1, 0.4],
  [7, 16, 3, 1, 1.1, -0.3],
  [-16, -4, 1, 5, 1.1, 0],
  [16, 8, 1, 5, 1.1, 0],

  // flank rooms
  [-24, 0, 12, 1, 3, 0],
  [24, 0, 12, 1, 3, 0],
  [-24, -18, 1, 12, 3, 0],
  [24, 18, 1, 12, 3, 0],

  // a couple of tall blocks to break the skyline and cast a real shadow
  [-14, 22, 5, 5, 5, 0.2],
  [15, -22, 6, 4, 4.5, -0.15],
];

export function buildWhitebox(A) {
  // Floor. One quad — the street map's terrain is 42x42 segments of displaced
  // plane, which is a different order of cost for nothing a testbed needs.
  // The palette entry is `vertexMasks: true`, so the wear/grime/AO attribute has
  // to exist before the geometry is merged — without it the Accum drops the mesh
  // and the level renders as nothing but collision.
  const flat = (g) => (paintMasks(g, (x, y, z, nx, ny, nz, out) => { out[0] = 0.08; out[1] = 0.1; out[2] = 0; }), g);

  const floor = flat(new THREE.PlaneGeometry(96, 96, 1, 1));
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
