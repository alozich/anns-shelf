import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader, DRACO_GLTF_CONFIG } from 'three/addons/loaders/DRACOLoader.js';

// DRACO_GLTF_CONFIG points at the glTF-only Draco decoder (~190 KB wasm instead
// of ~290 KB). Vite bundles it from node_modules and serves it locally, no CDN.
// Decoding runs in Web Workers, so it never blocks the render loop.
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(DRACO_GLTF_CONFIG);
dracoLoader.setWorkerLimit(2);
dracoLoader.preload(); // fetch + compile the decoder now, before the first model is requested

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

const cache = new Map();

/**
 * Load a (Draco-compressed) .glb/.gltf. Repeat requests for the same URL reuse
 * one download, and each call returns a clone that shares geometry and materials
 * with the original, so ten copies of a model cost one upload to the GPU.
 */
export async function loadModel(url, onProgress) {
  if (!cache.has(url)) {
    const pending = gltfLoader.loadAsync(url, onProgress).catch((err) => {
      cache.delete(url);
      throw err;
    });
    cache.set(url, pending);
  }
  const gltf = await cache.get(url);
  return gltf.scene.clone(true);
}

const STANDARD_KEYS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'aoMapIntensity',
  'emissiveMap', 'emissiveIntensity', 'alphaMap', 'roughness', 'metalness',
  'opacity', 'transparent', 'alphaTest', 'side', 'vertexColors', 'envMapIntensity', 'name',
];

/**
 * glTF exporters usually produce MeshStandardMaterial. This swaps those for
 * MeshPhysicalMaterial with a clearcoat layer, keeping all the original maps.
 * Shared materials are converted once and stay shared.
 */
export function upgradeToClearcoat(root, { clearcoat = 1, clearcoatRoughness = 0.1, shadows = true } = {}) {
  const converted = new Map();

  const convert = (m) => {
    if (m.isMeshPhysicalMaterial) {
      m.clearcoat = clearcoat;
      m.clearcoatRoughness = clearcoatRoughness;
      return m;
    }
    if (!m.isMeshStandardMaterial) return m;
    if (converted.has(m)) return converted.get(m);

    const p = new THREE.MeshPhysicalMaterial({ clearcoat, clearcoatRoughness });
    for (const key of STANDARD_KEYS) p[key] = m[key];
    p.color.copy(m.color);
    p.emissive.copy(m.emissive);
    p.normalScale.copy(m.normalScale);
    converted.set(m, p);
    return p;
  };

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    o.castShadow = o.receiveShadow = shadows;
  });
  return root;
}

export function disposeLoaders() {
  dracoLoader.dispose();
}
