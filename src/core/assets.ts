// Model and image loading with caching and graceful fallback.
// loadModel resolves to null when the file is missing, so callers build a procedural placeholder.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { modelUrl } from '../data/assets';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group | null>>();

export function loadModel(key: string): Promise<THREE.Group | null> {
  let p = cache.get(key);
  if (!p) {
    p = new Promise((resolve) => {
      loader.load(
        modelUrl(key),
        (gltf) => {
          gltf.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
          });
          resolve(gltf.scene);
        },
        undefined,
        () => resolve(null),
      );
    });
    cache.set(key, p);
  }
  return p;
}

/** A fresh clone of a cached model (materials shared), or null if the model is missing. */
export async function instantiateModel(key: string): Promise<THREE.Object3D | null> {
  const src = await loadModel(key);
  return src ? src.clone(true) : null;
}

export function preloadModels(keys: string[]): Promise<void> {
  return Promise.all(keys.map(loadModel)).then(() => undefined);
}

const imageOk = new Map<string, Promise<boolean>>();
/** Resolves true if the image URL loads. Used to swap CSS placeholder avatars for real portraits. */
export function probeImage(url: string): Promise<boolean> {
  let p = imageOk.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    imageOk.set(url, p);
  }
  return p;
}
