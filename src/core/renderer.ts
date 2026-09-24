// One shared WebGLRenderer for the whole game (iPad Safari dislikes several WebGL contexts).
// The clinic view and the clean scene each attach it to their container while they are visible.
import * as THREE from 'three';
import { loadSettings } from './save';

let renderer: THREE.WebGLRenderer | null = null;

export function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  applyQuality();
  const c = renderer.domElement;
  c.style.display = 'block';
  c.style.width = '100%';
  c.style.height = '100%';
  c.style.touchAction = 'none';
  return renderer;
}

export function applyQuality(): void {
  if (!renderer) return;
  const q = loadSettings().quality;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : 1));
  renderer.shadowMap.enabled = q === 'high';
}

/**
 * Move the shared canvas into `container` and keep it sized to it. `onResize(w, h)` fires now and on
 * every size change (update camera aspect there). Returns a detach function.
 */
export function attachRenderer(container: HTMLElement, onResize: (w: number, h: number) => void): () => void {
  const r = getRenderer();
  container.appendChild(r.domElement);
  const fit = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    r.setSize(w, h, false);
    onResize(w, h);
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(container);
  return () => {
    ro.disconnect();
    if (r.domElement.parentElement === container) container.removeChild(r.domElement);
  };
}
