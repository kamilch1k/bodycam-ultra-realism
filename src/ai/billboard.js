import * as THREE from 'three';

/**
 * FLAT ENEMIES — the Garry's Mod joke.
 *
 * A cardboard cut-out that always faces you, sprinting. The comedy is entirely
 * in the fact that it has no thickness: strafe around one and it stays exactly
 * as wide, because a THREE.Sprite is billboarded by the renderer itself and
 * never turns. That also means zero per-frame work here.
 *
 * DRAWN, NOT DOWNLOADED. The faces are painted onto a canvas at load, like
 * every other texture in this game — nothing here is fetched, so the build
 * stays one self-contained file and inside the portal size limits. It also
 * sidesteps the obvious problem with shipping actual meme images, which is that
 * somebody owns them.
 *
 * The rig underneath is untouched: this only replaces what is DRAWN. Movement,
 * navigation, physics, damage and the ragdoll on death all still run on the
 * normal skeleton, so a flat enemy behaves exactly like the variant it is
 * based on and none of the AI needed a special case.
 */

const SIZE = 256;

/** Muddy, over-compressed colour — half the joke is that it looks like a JPEG. */
function grain(g, n) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${(Math.random() * 90) | 0},${(Math.random() * 90) | 0},${(Math.random() * 90) | 0},.05)`;
    const s = 4 + Math.random() * 16;
    g.fillRect(Math.random() * SIZE, Math.random() * SIZE, s, s);
  }
}

/**
 * One face. `seed` picks the expression, so a wave of them is not six copies of
 * the same drawing — at a glance that is what sells them as a crowd.
 */
export function makeFaceTexture(seed = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');

  const hue = (seed * 61) % 360;
  g.fillStyle = `hsl(${hue}, 85%, 58%)`;
  g.beginPath();
  g.arc(SIZE / 2, SIZE / 2, SIZE * 0.42, 0, Math.PI * 2);
  g.fill();

  // Heavy outline: it has to read at 40 m against a bright deck.
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,.85)';
  g.stroke();

  const eyeY = SIZE * 0.42;
  const eyeDX = SIZE * 0.15;
  const wide = 1 + ((seed * 7) % 5) * 0.18;
  g.fillStyle = '#fff';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(SIZE / 2 + s * eyeDX, eyeY, SIZE * 0.085 * wide, SIZE * 0.1, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,.9)';
    g.stroke();
  }
  // Pupils looking slightly apart — a dead-straight stare reads as a logo.
  g.fillStyle = '#0a0a0a';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(SIZE / 2 + s * eyeDX + s * ((seed % 3) - 1) * 6, eyeY + 4, SIZE * 0.042, 0, Math.PI * 2);
    g.fill();
  }

  // Mouth: a grin, an O, or a flat line, by seed.
  g.lineWidth = 12;
  g.strokeStyle = '#111';
  g.lineCap = 'round';
  const mouth = seed % 3;
  g.beginPath();
  if (mouth === 0) g.arc(SIZE / 2, SIZE * 0.56, SIZE * 0.17, 0.15 * Math.PI, 0.85 * Math.PI);
  else if (mouth === 1) g.arc(SIZE / 2, SIZE * 0.63, SIZE * 0.09, 0, Math.PI * 2);
  else {
    g.moveTo(SIZE * 0.36, SIZE * 0.64);
    g.lineTo(SIZE * 0.64, SIZE * 0.64);
  }
  g.stroke();

  grain(g, 90);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // Nearest, deliberately: crisp blocky edges read as a pasted image, and a
  // smoothly filtered one just looks like a low-poly head.
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = 1;
  return t;
}

/**
 * Replace an agent's drawn body with a flat sprite.
 *
 * Hides the skinned mesh rather than removing it: physics adopts that skeleton
 * on death to build the ragdoll, so deleting it would break dying. Returns the
 * sprite so the caller can drop it when the agent is cleaned up.
 */
/**
 * A FIXED SET OF FACES, drawn once and shared.
 *
 * Every flat enemy used to draw its own canvas and upload its own texture at
 * spawn — measured at four fresh textures per wave, forever, on top of a 130 ms
 * first spawn. Nothing disposed them either, so a long run accumulated a
 * texture per body. Eight faces is already more variety than anyone reads in a
 * firefight, and a shared SpriteMaterial batches instead of breaking the draw
 * call per enemy. Scale and position are per-sprite, so bodies still differ in
 * size; only the drawing is shared.
 */
const FACE_COUNT = 8;
const FACES = [];

function faceMaterial(seed) {
  const i = ((seed % FACE_COUNT) + FACE_COUNT) % FACE_COUNT;
  FACES[i] ??= new THREE.SpriteMaterial({
    map: makeFaceTexture(i),
    transparent: true,
    // Cut-outs, not smoke: a soft alpha edge on something this big reads as a
    // ghost, and it would also sort badly against every other transparent thing.
    alphaTest: 0.5,
    depthWrite: true,
    toneMapped: true,
  });
  return FACES[i];
}

/**
 * Draw and upload all eight at boot, so no wave pays for one mid-fight.
 *
 * `renderer` is not optional in practice. Creating a CanvasTexture only builds
 * the image — the GPU upload is deferred to the first draw that samples it, so
 * a prewarm without `initTexture` moves the canvas work to boot and leaves the
 * uploads exactly where they were. Measured: still four uploads on wave one and
 * four more on wave two until this was added.
 */
export function prewarmFaces(renderer = null) {
  for (let i = 0; i < FACE_COUNT; i++) {
    const mat = faceMaterial(i);
    renderer?.initTexture?.(mat.map);
  }
}

export function attachBillboard(group, { seed = 0, height = 1.85 } = {}) {
  const sprite = new THREE.Sprite(faceMaterial(seed));
  sprite.scale.setScalar(height);
  sprite.position.y = height * 0.55;
  sprite.name = 'flat-enemy';
  group.add(sprite);
  return sprite;
}
