// Clinic furniture: the GLB from public/models when it loaded, otherwise a procedural stand-in built
// from shared primitives. Fallback prototypes are built once per key and cloned (geometry and
// materials shared), so a whole office of placeholders costs a handful of GPU buffers.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { loadModel } from '../core/assets';
import { C, drawTooth, mat, glassMat, waterMat } from './palette';

// ------------------------------------------------------------------ loaded models

const resolved = new Map<string, THREE.Group | null>();
const pending = new Map<string, Promise<void>>();

/** Start loading a model; resolves once the GLB loaded or failed (then the fallback is used). */
export function requestModel(key: string): Promise<void> {
  let p = pending.get(key);
  if (!p) {
    p = loadModel(key).then((g) => { resolved.set(key, g); }).catch(() => { resolved.set(key, null); });
    pending.set(key, p);
  }
  return p;
}
let standIns = false;
/** Debug and test switch: ignore loaded GLBs and build every stand-in (proves nothing depends on art). */
export function useStandInsOnly(on: boolean): void { standIns = on; }
export function modelReady(key: string): boolean { return resolved.has(key); }
export function loadedModel(key: string): THREE.Group | null { return standIns ? null : resolved.get(key) ?? null; }

const boxCache = new WeakMap<THREE.Object3D, THREE.Box3>();
/** Bounding box of a loaded model's source scene (cached). */
export function modelBounds(src: THREE.Object3D): THREE.Box3 {
  let b = boxCache.get(src);
  if (!b) { src.updateMatrixWorld(true); b = new THREE.Box3().setFromObject(src); boxCache.set(src, b); }
  return b;
}

/**
 * A fresh instance of a clinic model. `elevate` lifts wall-mounted and counter-top pieces; a GLB that is
 * already authored at its mounting height (its bounding box starts well above the floor) is not lifted.
 */
export function makeProp(key: string, elevate = 0, forceFallback = false): THREE.Object3D {
  const src = forceFallback || standIns ? null : resolved.get(key);
  let obj: THREE.Object3D;
  if (src) {
    obj = src.clone(true);
    if (elevate > 0 && modelBounds(src).min.y > 0.3) elevate = 0;
  } else {
    obj = fallback(key);
  }
  if (elevate) {
    const g = new THREE.Group();
    obj.position.y = elevate;
    g.add(obj);
    return g;
  }
  return obj;
}

// ------------------------------------------------------------------ primitive helpers (shared geometry)

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const r2 = (v: number) => Math.round(v * 1000) / 1000;

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  return o;
}
/** Box with its base at y (not centered). Rounded when r > 0. */
export function box(w: number, h: number, d: number, color: string | THREE.Material, x = 0, y = 0, z = 0, r = 0.03): THREE.Mesh {
  const key = `box|${r2(w)}|${r2(h)}|${r2(d)}|${r2(r)}`;
  const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const g = geo(key, () => rr > 0.004 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d));
  return mesh(g, typeof color === 'string' ? mat(color) : color, x, y + h / 2, z);
}
export function cyl(rt: number, rb: number, h: number, color: string | THREE.Material, x = 0, y = 0, z = 0, seg = 14): THREE.Mesh {
  const g = geo(`cyl|${r2(rt)}|${r2(rb)}|${r2(h)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  return mesh(g, typeof color === 'string' ? mat(color) : color, x, y + h / 2, z);
}
export function ball(r: number, color: string | THREE.Material, x = 0, y = 0, z = 0, seg = 1): THREE.Mesh {
  const g = geo(`ico|${r2(r)}|${seg}`, () => new THREE.IcosahedronGeometry(r, seg));
  return mesh(g, typeof color === 'string' ? mat(color) : color, x, y, z);
}
function sph(r: number, color: string | THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const g = geo(`sph|${r2(r)}`, () => new THREE.SphereGeometry(r, 16, 12));
  const o = mesh(g, typeof color === 'string' ? mat(color) : color, x, y, z);
  o.scale.set(sx, sy, sz);
  return o;
}
function plane(w: number, h: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const g = geo(`plane|${r2(w)}|${r2(h)}`, () => new THREE.PlaneGeometry(w, h));
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
}
function group(...kids: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const k of kids) g.add(k);
  return g;
}
function rotX(o: THREE.Object3D, a: number): THREE.Object3D { o.rotation.x = a; return o; }
function rotY(o: THREE.Object3D, a: number): THREE.Object3D { o.rotation.y = a; return o; }
function rotZ(o: THREE.Object3D, a: number): THREE.Object3D { o.rotation.z = a; return o; }

const screenMat = () => mat('#2B4A5C', 0.3, 0, '#5FD0FF', 0.35);
const lightMat = () => mat('#FFF6D6', 0.4, 0, '#FFF1B8', 1.1);

// ------------------------------------------------------------------ fallbacks

const protoCache = new Map<string, THREE.Object3D>();

function fallback(key: string): THREE.Object3D {
  let p = protoCache.get(key);
  if (!p) {
    const make = BUILDERS[key] ?? (() => box(0.5, 0.5, 0.5, C.lilac));
    p = make();
    p.name = key + '_fallback';
    protoCache.set(key, p);
  }
  return p.clone(true);
}

function dentalChair(upholstery: string, trim: string, extra: boolean): THREE.Object3D {
  const g = group(
    cyl(0.28, 0.34, 0.08, C.steel, 0, 0, 0.05),
    cyl(0.1, 0.12, 0.42, C.steel, 0, 0.06, 0.05),
    box(0.62, 0.14, 0.95, upholstery, 0, 0.46, 0.08, 0.06),
    rotX(box(0.6, 0.12, 0.72, upholstery, 0, -0.06, -0.36, 0.06), -0.42),
    rotX(box(0.5, 0.1, 0.62, upholstery, 0, -0.02, 0.3, 0.05), 0.28),
    box(0.34, 0.1, 0.24, upholstery, 0, 0.9, -0.92, 0.05),
    box(0.08, 0.06, 0.5, trim, 0.36, 0.64, -0.05, 0.03),
    box(0.08, 0.06, 0.5, trim, -0.36, 0.64, -0.05, 0.03),
  );
  // backrest pivot: place the tilted slabs
  const back = g.children[3]; back.position.set(0, 0.72, -0.62);
  const leg = g.children[4]; leg.position.set(0, 0.48, 0.72);
  if (extra) {
    g.add(box(0.66, 0.03, 0.98, C.sunshine, 0, 0.6, 0.08, 0.015));
    g.add(ball(0.05, mat(C.sunshine, 0.3, 0, C.sunshine, 0.8), 0.36, 0.72, 0.2, 0));
  }
  return g;
}

const BUILDERS: Record<string, () => THREE.Object3D> = {
  chair_basic: () => dentalChair(C.mint, C.steel, false),
  chair_comfort: () => dentalChair('#5BB8E8', C.white, false),
  chair_deluxe: () => dentalChair(C.bubblegum, C.sunshine, true),

  op_lamp: () => group(
    cyl(0.2, 0.24, 0.06, C.steel),
    cyl(0.035, 0.035, 1.9, C.white, 0, 0.06, 0),
    rotZ(box(0.7, 0.05, 0.05, C.white, -0.32, 1.9, 0.1, 0.02), 0),
    rotX(sph(0.14, C.white, -0.68, 1.82, 0.12, 1, 0.55, 1), 0),
    sph(0.09, lightMat(), -0.68, 1.76, 0.12, 1, 0.4, 1),
  ),
  op_cart: () => group(
    box(0.42, 0.06, 0.38, C.steel, 0, 0.05, 0, 0.02),
    cyl(0.025, 0.025, 0.72, C.steel, 0, 0.1, 0),
    box(0.46, 0.05, 0.4, C.white, 0, 0.82, 0, 0.02),
    box(0.3, 0.02, 0.06, C.teal, 0, 0.87, 0.08, 0.005),
    box(0.3, 0.02, 0.06, C.bubblegum, 0, 0.87, -0.05, 0.005),
    ball(0.03, C.dark, 0.16, 0.03, 0.14, 0), ball(0.03, C.dark, -0.16, 0.03, 0.14, 0),
    ball(0.03, C.dark, 0.16, 0.03, -0.14, 0), ball(0.03, C.dark, -0.16, 0.03, -0.14, 0),
  ),
  op_counter: () => group(
    box(1.5, 0.84, 0.5, C.wainscot, 0, 0, 0, 0.03),
    box(1.54, 0.06, 0.54, C.white, 0, 0.84, 0, 0.02),
    box(0.4, 0.02, 0.3, C.steel, 0.4, 0.9, 0, 0.01),
    box(0.02, 0.5, 0.02, C.white, -0.36, 0.08, 0.255, 0.005),
    box(0.02, 0.5, 0.02, C.white, 0.36, 0.08, 0.255, 0.005),
    rotX(cyl(0.015, 0.015, 0.22, C.steel, 0.4, 0.9, -0.16), 0),
    box(0.22, 0.3, 0.16, C.white, -0.5, 0.9, -0.05, 0.03),
    box(0.1, 0.2, 0.1, C.mint, -0.2, 0.9, -0.06, 0.02),
  ),
  op_monitor: () => group(
    box(0.14, 0.02, 0.1, C.dark, 0, 0, 0, 0.01),
    box(0.03, 0.22, 0.03, C.dark, 0, 0.02, 0, 0.005),
    box(0.44, 0.28, 0.03, C.dark, 0, 0.2, 0, 0.015),
    plane(0.4, 0.24, screenMat(), 0, 0.34, 0.017),
  ),
  op_tv: () => group(
    cyl(0.16, 0.2, 0.05, C.steel),
    cyl(0.03, 0.03, 1.55, C.white, 0, 0.05, 0),
    box(0.74, 0.46, 0.05, C.dark, 0, 1.5, 0.02, 0.02),
    plane(0.68, 0.4, mat('#9EE3FF', 0.3, 0, '#7FD8FF', 0.6), 0, 1.73, 0.047),
  ),
  whitening_lamp: () => group(
    cyl(0.18, 0.2, 0.05, C.steel),
    cyl(0.03, 0.03, 1.2, C.white, 0, 0.05, 0),
    rotZ(box(0.05, 0.5, 0.05, C.white, 0, 1.2, 0, 0.02), 0),
    sph(0.12, mat('#8FB8FF', 0.3, 0, '#9EC8FF', 1.2), 0, 1.72, 0.16, 1.3, 0.55, 1.3),
  ),
  intraoral_cam: () => group(
    box(0.22, 0.12, 0.16, C.white, 0, 0, 0, 0.03),
    plane(0.16, 0.08, screenMat(), 0, 0.07, 0.081),
    rotZ(cyl(0.015, 0.02, 0.26, C.bubblegum, 0.14, 0.02, 0), 0.4),
  ),

  reception_desk: () => group(
    box(2.4, 0.95, 0.7, C.mint, 0, 0, 0.05, 0.05),
    box(2.46, 0.06, 0.34, C.white, 0, 1.05, 0.25, 0.02),
    box(2.3, 0.06, 0.5, C.white, 0, 0.72, -0.25, 0.02),
    box(2.4, 0.1, 0.04, C.teal, 0, 0.4, 0.41, 0.01),
    box(0.44, 0.3, 0.04, C.dark, -0.45, 0.78, -0.3, 0.01),
    box(0.3, 0.02, 0.12, C.ink, -0.45, 0.78, -0.12, 0.005),
    ball(0.06, C.sunshine, 0.8, 1.14, 0.25, 0),
    box(0.2, 0.05, 0.14, C.bubblegum, 0.4, 1.11, 0.25, 0.01),
  ),
  waiting_chair: () => group(
    box(0.5, 0.1, 0.46, C.coral, 0, 0.36, 0.02, 0.04),
    box(0.5, 0.46, 0.1, C.coral, 0, 0.44, -0.2, 0.04),
    box(0.04, 0.36, 0.04, C.steel, 0.2, 0, 0.18, 0.01), box(0.04, 0.36, 0.04, C.steel, -0.2, 0, 0.18, 0.01),
    box(0.04, 0.36, 0.04, C.steel, 0.2, 0, -0.18, 0.01), box(0.04, 0.36, 0.04, C.steel, -0.2, 0, -0.18, 0.01),
    box(0.05, 0.05, 0.4, C.steel, 0.27, 0.56, 0, 0.02), box(0.05, 0.05, 0.4, C.steel, -0.27, 0.56, 0, 0.02),
  ),
  plant_tall: () => group(
    cyl(0.19, 0.15, 0.4, C.pot),
    cyl(0.17, 0.17, 0.03, '#6B4B35', 0, 0.38, 0),
    ball(0.26, C.leaf, 0, 0.72, 0, 1), ball(0.2, C.leafDark, 0.12, 1.0, 0.05, 1), ball(0.18, C.leaf, -0.1, 1.2, -0.04, 1),
    ball(0.14, C.leafDark, 0.02, 1.4, 0.02, 1),
  ),
  plant_small: () => group(
    cyl(0.15, 0.12, 0.3, C.sunshine),
    ball(0.2, C.leaf, 0, 0.45, 0, 1), ball(0.13, C.leafDark, 0.08, 0.6, 0.04, 1),
  ),
  water_cooler: () => group(
    box(0.34, 0.9, 0.34, C.white, 0, 0, 0, 0.05),
    box(0.1, 0.06, 0.04, C.sky, 0, 0.7, 0.17, 0.01),
    cyl(0.14, 0.14, 0.4, waterMat(), 0, 0.92, 0, 16),
    cyl(0.06, 0.14, 0.08, waterMat(), 0, 0.9, 0, 16),
  ),
  magazine_table: () => group(
    box(1.0, 0.06, 0.55, C.woodDark, 0, 0.36, 0, 0.025),
    box(0.06, 0.36, 0.06, C.woodDark, 0.44, 0, 0.22, 0.01), box(0.06, 0.36, 0.06, C.woodDark, -0.44, 0, 0.22, 0.01),
    box(0.06, 0.36, 0.06, C.woodDark, 0.44, 0, -0.22, 0.01), box(0.06, 0.36, 0.06, C.woodDark, -0.44, 0, -0.22, 0.01),
    rotY(box(0.28, 0.02, 0.2, C.bubblegum, -0.2, 0.42, 0.02, 0.005), 0.25),
    rotY(box(0.28, 0.02, 0.2, C.sky, 0.15, 0.42, -0.05, 0.005), -0.3),
    rotY(box(0.26, 0.02, 0.19, C.sunshine, 0.2, 0.44, 0.08, 0.005), 0.1),
  ),
  fish_tank: () => {
    const g = group(
      box(1.3, 0.72, 0.5, C.woodDark, 0, 0, 0, 0.03),
      box(1.24, 0.5, 0.44, glassMat(), 0, 0.74, 0, 0.02),
      box(1.18, 0.4, 0.38, waterMat(), 0, 0.75, 0, 0.01),
      box(1.18, 0.05, 0.38, '#F1DDB0', 0, 0.74, 0, 0.005),
      box(1.28, 0.05, 0.48, C.dark, 0, 1.24, 0, 0.02),
    );
    const fishM = mat(C.coral, 0.4, 0, '#FF9A6B', 0.3);
    g.add(sph(0.05, fishM, -0.25, 0.98, 0.05, 1.4, 0.8, 0.5));
    g.add(sph(0.045, mat(C.sunshine, 0.4), 0.2, 0.9, -0.05, 1.4, 0.8, 0.5));
    g.add(sph(0.04, mat(C.sky, 0.4), 0.35, 1.05, 0.08, 1.4, 0.8, 0.5));
    g.add(cyl(0.012, 0.012, 0.3, C.leaf, -0.45, 0.78, -0.08), cyl(0.012, 0.012, 0.22, C.leafDark, -0.4, 0.78, -0.1));
    return g;
  },
  kids_corner: () => group(
    cyl(0.8, 0.8, 0.02, mat('#FFE3A1', 0.9), 0, 0, 0, 28),
    cyl(0.62, 0.62, 0.021, mat('#FFC3D8', 0.9), 0, 0, 0, 28),
    box(0.16, 0.16, 0.16, C.bubblegum, -0.3, 0.02, 0.2, 0.02),
    box(0.16, 0.16, 0.16, C.sky, -0.12, 0.02, 0.28, 0.02),
    box(0.16, 0.16, 0.16, C.sunshine, -0.22, 0.18, 0.24, 0.02),
    box(0.5, 0.04, 0.4, C.mint, 0.3, 0.3, -0.25, 0.02),
    box(0.04, 0.3, 0.04, C.white, 0.1, 0, -0.1, 0.01), box(0.04, 0.3, 0.04, C.white, 0.5, 0, -0.1, 0.01),
    box(0.04, 0.3, 0.04, C.white, 0.1, 0, -0.4, 0.01), box(0.04, 0.3, 0.04, C.white, 0.5, 0, -0.4, 0.01),
    ball(0.14, C.coral, 0.35, 0.16, 0.35, 1),
    sph(0.12, '#C99A6B', -0.45, 0.14, -0.3, 1, 1.1, 0.9), sph(0.08, '#C99A6B', -0.45, 0.32, -0.3),
  ),
  espresso_machine: () => group(
    box(0.8, 0.9, 0.5, C.wainscot, 0, 0, 0, 0.03),
    box(0.84, 0.05, 0.54, C.white, 0, 0.9, 0, 0.02),
    box(0.38, 0.38, 0.3, mat('#D8DEE3', 0.3, 0.3), -0.1, 0.95, -0.04, 0.04),
    box(0.3, 0.06, 0.12, C.dark, -0.1, 1.08, 0.14, 0.02),
    cyl(0.04, 0.035, 0.08, C.white, -0.1, 0.95, 0.16),
    cyl(0.045, 0.04, 0.09, C.bubblegum, 0.25, 0.95, 0.05), cyl(0.045, 0.04, 0.09, C.sky, 0.3, 0.95, -0.12),
  ),
  sterilizer: () => group(
    box(1.2, 0.86, 0.6, C.white, 0, 0, 0, 0.03),
    box(1.24, 0.05, 0.64, C.steel, 0, 0.86, 0, 0.02),
    box(0.5, 0.36, 0.44, mat('#DDE3E8', 0.3, 0.35), -0.25, 0.91, 0, 0.05),
    cyl(0.12, 0.12, 0.02, C.dark, -0.25, 1.09, 0.22),
    box(0.1, 0.05, 0.02, mat(C.mint, 0.3, 0, C.mint, 0.8), 0.05, 1.12, 0.22, 0.005),
    box(0.3, 0.1, 0.36, C.sky, 0.3, 0.91, 0, 0.02),
    box(0.02, 0.5, 0.02, C.steel, 0, 0.1, 0.305, 0.005),
  ),
  kiosk: () => group(
    box(0.4, 0.05, 0.36, C.steel, 0, 0, 0, 0.02),
    box(0.16, 0.95, 0.12, C.white, 0, 0.05, 0, 0.03),
    rotX(box(0.44, 0.34, 0.06, C.teal, 0, 0, 0, 0.03), -0.5),
    rotX(plane(0.38, 0.28, screenMat(), 0, 0, 0), -0.5),
  ),
  ultrasonic_cart: () => group(
    box(0.5, 0.06, 0.42, C.steel, 0, 0.05, 0, 0.02),
    cyl(0.03, 0.03, 0.7, C.steel, 0, 0.1, 0),
    box(0.54, 0.05, 0.44, C.white, 0, 0.8, 0, 0.02),
    box(0.34, 0.2, 0.26, C.mint, 0, 0.85, -0.02, 0.04),
    plane(0.16, 0.08, screenMat(), 0, 0.99, 0.111),
    rotZ(cyl(0.012, 0.016, 0.24, C.sunshine, 0.2, 0.86, 0.1), -0.5),
    ball(0.03, C.dark, 0.18, 0.03, 0.15, 0), ball(0.03, C.dark, -0.18, 0.03, 0.15, 0),
    ball(0.03, C.dark, 0.18, 0.03, -0.15, 0), ball(0.03, C.dark, -0.18, 0.03, -0.15, 0),
  ),
  xray_unit: () => group(
    box(1.0, 0.08, 0.9, C.steel, 0, 0, 0, 0.03),
    box(0.26, 2.0, 0.26, C.white, 0, 0.08, -0.25, 0.05),
    box(0.9, 0.16, 0.18, C.white, 0.2, 1.7, -0.25, 0.05),
    rotX(cyl(0.1, 0.16, 0.36, C.sky, 0.55, 1.4, -0.2), 0),
    box(0.42, 0.52, 0.06, C.dark, -0.1, 0.9, 0.25, 0.03),
    plane(0.36, 0.44, mat('#DDEFFF', 0.3, 0, '#BFE3FF', 0.7), -0.1, 1.16, 0.281),
    box(0.3, 0.12, 0.3, mat('#FFD166', 0.6), 0.3, 0.08, 0.25, 0.03),
  ),
  break_table: () => group(
    cyl(0.5, 0.5, 0.05, C.white, 0, 0.7, 0, 24),
    cyl(0.05, 0.05, 0.7, C.steel, 0, 0, 0),
    cyl(0.26, 0.3, 0.04, C.steel, 0, 0, 0),
    cyl(0.18, 0.18, 0.05, C.sunshine, 0.62, 0.42, 0.2), cyl(0.03, 0.03, 0.42, C.steel, 0.62, 0, 0.2),
    cyl(0.18, 0.18, 0.05, C.bubblegum, -0.62, 0.42, 0.2), cyl(0.03, 0.03, 0.42, C.steel, -0.62, 0, 0.2),
    cyl(0.18, 0.18, 0.05, C.mint, 0, 0.42, -0.62), cyl(0.03, 0.03, 0.42, C.steel, 0, 0, -0.62),
    cyl(0.04, 0.035, 0.09, C.coral, 0.15, 0.75, 0.1), cyl(0.04, 0.035, 0.09, C.sky, -0.18, 0.75, -0.05),
    box(0.26, 0.06, 0.2, '#F4D7A6', 0, 0.75, 0.2, 0.02),
  ),
  certificate: () => group(
    box(0.5, 0.4, 0.04, C.woodDark, 0, 0, 0, 0.01),
    plane(0.42, 0.32, mat('#FFF8E6', 0.9), 0, 0.2, 0.021),
    plane(0.26, 0.03, mat(C.teal), 0, 0.28, 0.022),
    ball(0.035, mat(C.sunshine, 0.4, 0, C.sunshine, 0.3), 0.12, 0.1, 0.03, 0),
  ),
  wall_tv: () => group(
    box(1.1, 0.64, 0.06, C.dark, 0, 0, 0, 0.02),
    plane(1.02, 0.56, mat('#9EE3FF', 0.3, 0, '#7FD8FF', 0.55), 0, 0.32, 0.031),
    ball(0.12, mat(C.sunshine, 0.5, 0, C.sunshine, 0.5), -0.2, 0.36, 0.05, 1),
    box(0.3, 0.1, 0.01, mat(C.bubblegum, 0.5, 0, C.bubblegum, 0.4), 0.22, 0.2, 0.036, 0.004),
  ),
  tooth_sign: () => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g2 = c.getContext('2d')!;
    drawTooth(g2, 128, 128, 120);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6 });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 40), m);
    disc.position.set(0, 0.5, 0.04);
    return group(cyl(0.53, 0.53, 0.04, C.teal, 0, 0.5, 0, 32).rotateX(Math.PI / 2), disc);
  },
  trash_bin: () => group(
    cyl(0.15, 0.13, 0.42, C.steel),
    cyl(0.16, 0.16, 0.04, C.white, 0, 0.42, 0),
    box(0.1, 0.02, 0.06, C.dark, 0, 0, 0.16, 0.01),
  ),
  coat_rack: () => group(
    cyl(0.2, 0.22, 0.04, C.woodDark),
    cyl(0.03, 0.03, 1.75, C.woodDark, 0, 0.04, 0),
    rotZ(cyl(0.015, 0.015, 0.2, C.woodDark, 0.08, 1.6, 0), 0.9), rotZ(cyl(0.015, 0.015, 0.2, C.woodDark, -0.08, 1.6, 0), -0.9),
    sph(0.16, C.sky, 0.1, 1.25, 0.05, 0.8, 1.9, 0.6),
    ball(0.1, C.bubblegum, -0.1, 1.72, 0, 1),
  ),
  office_desk: () => group(
    box(1.4, 0.06, 0.7, C.woodDark, 0, 0.7, 0, 0.02),
    box(0.06, 0.7, 0.66, C.woodDark, 0.64, 0, 0, 0.01), box(0.06, 0.7, 0.66, C.woodDark, -0.64, 0, 0, 0.01),
    box(0.4, 0.5, 0.6, '#D9B386', 0.4, 0.1, 0, 0.02),
    box(0.44, 0.3, 0.03, C.dark, -0.2, 0.78, -0.18, 0.01),
    box(0.03, 0.08, 0.03, C.dark, -0.2, 0.76, -0.18, 0.005),
    box(0.2, 0.05, 0.28, C.white, 0.35, 0.76, 0.05, 0.01),
    sph(0.05, C.bubblegum, -0.52, 0.8, 0.12, 1, 1.2, 1),
    box(0.5, 0.08, 0.46, C.teal, 0, 0.44, -0.62, 0.03),
    box(0.5, 0.5, 0.08, C.teal, 0, 0.52, -0.84, 0.03),
    cyl(0.03, 0.03, 0.4, C.steel, 0, 0.04, -0.62),
  ),
  entrance_door: () => group(
    box(0.08, 2.3, 0.14, C.teal, -0.72, 0, 0, 0.02),
    box(0.08, 2.3, 0.14, C.teal, 0.72, 0, 0, 0.02),
    box(1.52, 0.12, 0.14, C.teal, 0, 2.3, 0, 0.02),
  ),
};

/** The glass door leaf (hinge at the origin, the leaf extends toward +X). */
export function doorLeaf(width: number): THREE.Object3D {
  const g = new THREE.Group();
  g.add(box(width, 2.18, 0.05, glassMat(), width / 2, 0.04, 0, 0.01));
  g.add(box(0.06, 2.18, 0.07, C.teal, 0.03, 0.04, 0, 0.01));
  g.add(box(0.06, 2.18, 0.07, C.teal, width - 0.03, 0.04, 0, 0.01));
  g.add(box(width, 0.08, 0.07, C.teal, width / 2, 0.04, 0, 0.01));
  g.add(box(width, 0.06, 0.07, C.teal, width / 2, 2.16, 0, 0.01));
  g.add(box(0.04, 0.34, 0.1, C.steel, width - 0.16, 0.95, 0, 0.015));
  return g;
}
