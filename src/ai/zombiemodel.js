import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * THE ONE DOWNLOADED MESH IN THE GAME — "Animated Zombie" by Quaternius, CC BY 3.0.
 * See THIRD-PARTY-NOTICES.txt; attribution is that licence's only requirement.
 *
 * It is attached exactly the way billboard.js attaches a flatty: the procedural
 * SkinnedMesh is HIDDEN, not removed, and this model rides along beside it. That
 * is not laziness, it is what keeps the integration small — physics adopts the
 * procedural skeleton to build the ragdoll on death, and nav, steering, damage
 * and melee all run off the rig regardless of what is on screen. Swapping only
 * what is DRAWN means no behaviour code learns that this variant exists.
 *
 * The consequence to know: the ragdoll is still driven by the procedural
 * skeleton, so on death the model is hidden and the (previously hidden) real
 * mesh comes back to fall over. The alternative — retargeting Quaternius' 34
 * bones onto RIG's 25 every frame — is a bone-mapping layer that would cost more
 * than the whole feature.
 */

const URL = 'models/zombie.glb';

/** Animation names as authored in the GLB, verified against its own JSON chunk. */
const CLIP = {
  idle: 'Zombie|ZombieIdle',
  walk: 'Zombie|ZombieWalk',
  run: 'Zombie|ZombieRun',
  bite: 'Zombie|ZombieBite',
  crawl: 'Zombie|ZombieCrawl',
};

/** Model height in metres, measured from its own bounds at load. */
let _srcHeight = 1;
/** @type {Promise<THREE.Object3D>|null} shared across every agent. */
let _loading = null;
/** @type {THREE.Object3D|null} */
let _proto = null;
/** @type {THREE.AnimationClip[]} */
let _clips = [];

/**
 * Load once, share forever. Returns the same promise to every caller, so a wave
 * that spawns eight zombies triggers one request rather than eight.
 *
 * Never rejects into the caller: a portal that fails to serve the model must
 * degrade to the procedural body, not break the spawn. A failed load leaves
 * `_proto` null and `attachZombie` returns null, which reads to the caller as
 * "this variant has no model" — the same path as any other variant.
 */
export function loadZombieModel() {
  if (_loading) return _loading;
  _loading = new Promise((resolve) => {
    new GLTFLoader().load(
      URL,
      (gltf) => {
        _proto = gltf.scene;
        _clips = gltf.animations ?? [];
        const box = new THREE.Box3().setFromObject(_proto);
        _srcHeight = Math.max(box.getSize(new THREE.Vector3()).y, 0.001);
        _proto.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          // Shadow-only frustum culling on a skinned mesh whose bounds are the
          // BIND POSE pops it out of view mid-animation. The procedural bodies
          // have the same fix in agent.js.
          o.frustumCulled = false;
        });
        resolve(_proto);
      },
      undefined,
      (err) => {
        console.warn('[ai] zombie model failed to load, using procedural body:', err?.message ?? err);
        resolve(null);
      }
    );
  });
  return _loading;
}

/** True once a load has finished successfully. */
export function zombieModelReady() {
  return !!_proto;
}

/**
 * Attach a clone to an agent's group.
 *
 * `SkeletonUtils.clone` rather than `Object3D.clone`: the latter copies the mesh
 * but leaves every clone pointing at the ORIGINAL skeleton, so all of them
 * animate as one body. Materials and geometry are still shared by reference,
 * which is what keeps a clone cheap.
 *
 * @returns {{root:THREE.Object3D, mixer:THREE.AnimationMixer, play:Function, update:Function, dispose:Function}|null}
 */
export function attachZombie(group, { height = 1.9 } = {}) {
  if (!_proto) return null;

  const root = cloneSkinned(_proto);
  // Normalise to the height this variant asks for: the source is whatever
  // Quaternius exported, and every gameplay constant here is in metres.
  root.scale.setScalar(height / _srcHeight);
  group.add(root);

  const mixer = new THREE.AnimationMixer(root);
  /** @type {Map<string, THREE.AnimationAction>} */
  const actions = new Map();
  for (const [key, name] of Object.entries(CLIP)) {
    const clip = THREE.AnimationClip.findByName(_clips, name);
    if (clip) actions.set(key, mixer.clipAction(clip));
  }

  let current = null;
  /**
   * Cross-fade to a state. Same-state calls are ignored, so this is safe to
   * call every frame from the behaviour tree.
   */
  const play = (key, fade = 0.18) => {
    if (current === key) return;
    const next = actions.get(key) ?? actions.get('idle');
    if (!next) return;
    const prev = current ? actions.get(current) : null;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev && prev !== next) prev.fadeOut(fade);
    current = key;
  };
  play('idle', 0);

  return {
    root,
    mixer,
    play,
    update: (dt) => mixer.update(dt),
    setVisible: (v) => { root.visible = v; },
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      group.remove(root);
      // Geometry and materials belong to the shared prototype: a clone borrows
      // them and owns nothing, so there is nothing here to free. Disposing them
      // would break every other zombie on the map.
    },
  };
}

/**
 * Force the model's shader programs to link during boot.
 *
 * Without this the first zombie to become visible costs an ANGLE link mid-fight
 * — the exact 478-1109 ms class of stall that HANDOFF-STUTTER.md was written
 * about. Called from the AI prewarm alongside the variant geometries.
 */
export async function prewarmZombie(renderer, scene, camera, rt, admit) {
  if (!_proto) return;
  const probe = cloneSkinned(_proto);
  probe.position.set(0, -1000, 0); // off-camera but inside the frustum-cull opt-out
  scene.add(probe);
  await admit?.('ai-model', 'zombie');
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  scene.remove(probe);
}

/** Drop the shared prototype. Called when the AI system is torn down. */
export function disposeZombieModel() {
  _proto?.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose?.();
    const m = o.material;
    (Array.isArray(m) ? m : [m]).forEach((x) => {
      x?.map?.dispose?.();
      x?.dispose?.();
    });
  });
  _proto = null;
  _loading = null;
  _clips = [];
}
