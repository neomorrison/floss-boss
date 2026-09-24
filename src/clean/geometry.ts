// Procedural geometry for the clean scene: every mouth model has a fallback built here, so the scene
// works with no GLBs at all. Mouth units (see core/mouth.ts): +Y up, camera at +Z.
import * as THREE from 'three';
import type { ToothKind } from '../core/types';
import {
  archNormal, archPoint, LOWER_ARCH_SCALE, LOWER_GUM_Y, TOOTH_DIMS, UPPER_GUM_Y, type ToothPlacement,
} from '../core/mouth';
import { mulberry32 } from '../core/rng';

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const spow = (x: number, p: number) => Math.sign(x) * Math.pow(Math.abs(x), p);

// ------------------------------------------------------------------ teeth

const ROOT_Y = -0.35;

/**
 * A rounded cartoon crown for a tooth kind, in tooth-local space: origin at the gumline centre, crown
 * toward +Y (height TOOTH_DIMS.h), labial face toward +Z, a short root stub down to y = -0.35.
 */
export function toothGeometry(kind: ToothKind): THREE.BufferGeometry {
  const { w, h, d } = TOOTH_DIMS[kind];
  const NS = 44;                 // around
  const NY = 20;                 // side rings (root to shoulder)
  const NC = 10;                 // cap rings (shoulder to centre)
  const shoulder = kind === 'incisor' ? 0.9 : kind === 'canine' ? 0.8 : kind === 'premolar' ? 0.84 : 0.84;
  const boxy = kind === 'molar' ? 0.62 : kind === 'premolar' ? 0.72 : kind === 'incisor' ? 0.78 : 0.85;

  const rx = (yn: number) => {
    if (yn < 0) return w / 2 * (0.62 + 0.18 * (1 + yn / -ROOT_Y * 0));
    switch (kind) {
      case 'incisor': return w / 2 * (0.74 + 0.26 * smooth(0, 0.55, yn));
      case 'canine': return w / 2 * (0.78 + 0.22 * smooth(0, 0.4, yn)) * (1 - 0.3 * smooth(0.55, 1, yn));
      case 'premolar': return w / 2 * (0.8 + 0.2 * smooth(0, 0.45, yn));
      default: return w / 2 * (0.82 + 0.18 * smooth(0, 0.4, yn));
    }
  };
  const rz = (yn: number) => {
    if (yn < 0) return d / 2 * 0.62;
    switch (kind) {
      case 'incisor': return d / 2 * (0.95 - 0.62 * smooth(0.12, 1, yn)) * (0.85 + 0.15 * smooth(0, 0.3, yn));
      case 'canine': return d / 2 * (0.9 - 0.35 * smooth(0.3, 1, yn)) * (0.85 + 0.15 * smooth(0, 0.3, yn));
      case 'premolar': return d / 2 * (0.82 + 0.18 * smooth(0, 0.45, yn));
      default: return d / 2 * (0.84 + 0.16 * smooth(0, 0.4, yn));
    }
  };
  // cap height above the shoulder at radius factor r (1 edge, 0 centre) and angle th
  const cap = (r: number, th: number) => {
    const top = h * (1 - shoulder);
    const dome = (1 - r * r);
    switch (kind) {
      case 'incisor': return top * Math.sqrt(Math.max(0, dome)) * 1.0;
      case 'canine': return top * Math.pow(Math.max(0, 1 - r), 0.9) * 1.0;
      case 'premolar': {
        const cusp = Math.pow(0.5 + 0.5 * Math.cos(2 * th), 1.5);
        const bump = Math.exp(-(((r - 0.5) / 0.38) ** 2));
        return top * (0.55 * Math.sqrt(Math.max(0, dome)) + 0.4 * cusp * bump);
      }
      default: {
        const cusp = Math.pow(0.5 + 0.5 * Math.cos(4 * (th - Math.PI / 4)), 1.5);
        const bump = Math.exp(-(((r - 0.5) / 0.36) ** 2));
        return top * (0.55 * Math.sqrt(Math.max(0, dome)) + 0.42 * cusp * bump);
      }
    }
  };

  const pos: number[] = [];
  const ring = (y: number, sx: number, sz: number, yOf?: (th: number) => number) => {
    for (let i = 0; i < NS; i++) {
      const th = (i / NS) * Math.PI * 2;
      const s = Math.sin(th), c = Math.cos(th);
      pos.push(spow(s, boxy) * sx, yOf ? yOf(th) : y, spow(c, boxy) * sz);
    }
  };
  // side rings: root -> shoulder
  for (let j = 0; j <= NY; j++) {
    const t = j / NY;
    const y = ROOT_Y + (h * shoulder - ROOT_Y) * t;
    const yn = y / h;
    ring(y, rx(yn), rz(yn));
  }
  // cap rings: shoulder -> near centre
  const ySh = h * shoulder;
  for (let k = 1; k < NC; k++) {
    const r = 1 - k / NC;
    const round = Math.sqrt(1 - (1 - r) * (1 - r) * 0) * 1;
    const shrink = kind === 'incisor' || kind === 'canine' ? r : Math.sqrt(r) * 0.92 + 0.08 * r;
    ring(0, rx(shoulder) * shrink * round, rz(shoulder) * shrink * round, (th) => ySh + cap(r, th));
  }
  const rings = NY + NC;          // total rings = NY + 1 + NC - 1
  const topIdx = pos.length / 3;
  pos.push(0, ySh + cap(0, 0), 0);
  const botIdx = pos.length / 3;
  pos.push(0, ROOT_Y - 0.05, 0);

  const idx: number[] = [];
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < NS; i++) {
      const a = j * NS + i, b = j * NS + ((i + 1) % NS);
      const c = (j + 1) * NS + i, e = (j + 1) * NS + ((i + 1) % NS);
      idx.push(a, e, c, a, b, e);
    }
  }
  const last = (rings - 1) * NS;
  for (let i = 0; i < NS; i++) idx.push(last + i, last + ((i + 1) % NS), topIdx);
  for (let i = 0; i < NS; i++) idx.push(botIdx, (i + 1) % NS, i);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return fixWinding(g);
}

/** Flip triangle winding if the normals point inward (checked on the +Z face). */
function fixWinding(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  let dot = 0;
  for (let i = 0; i < p.count; i++) dot += p.getX(i) * n.getX(i) + p.getZ(i) * n.getZ(i);
  if (dot < 0) {
    const index = g.getIndex()!;
    const arr = index.array as Uint32Array | Uint16Array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
    index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

/**
 * Normalize a loaded tooth mesh geometry to TOOTH_DIMS: crown top at h, width w, depth d, centred in XZ,
 * gumline at y = 0 (anything below 0 is treated as root). Returns a new geometry (the source is untouched).
 */
export function normalizeToothGeometry(src: THREE.BufferGeometry, kind: ToothKind): THREE.BufferGeometry {
  const g = src.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const { w, h, d } = TOOTH_DIMS[kind];
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  const sx = w / Math.max(1e-4, bb.max.x - bb.min.x);
  const sz = d / Math.max(1e-4, bb.max.z - bb.min.z);
  // crown height: if the model has a root below 0, keep 0 as the gumline, else put the base at 0
  const base = bb.min.y < -0.05 ? 0 : bb.min.y;
  const sy = h / Math.max(1e-4, bb.max.y - base);
  g.translate(-cx, -base, -cz);
  g.scale(sx, sy, sz);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ gums

export interface GumOptions {
  arch: 'upper' | 'lower';
  placements: ToothPlacement[];     // all 28
  missing: Set<number>;
  segments?: number;                // along the arch (default 160; the pick proxy uses fewer)
}

/**
 * A scalloped horseshoe of gum tissue along the arch curve, in mouth space. The edge touching the
 * teeth rises into papillae between neighbouring teeth; a missing tooth leaves a smooth ridge.
 * Vertex colours: lighter pink at the edge, deeper toward the base.
 */
export function gumGeometry(o: GumOptions): THREE.BufferGeometry {
  const upper = o.arch === 'upper';
  const scale = upper ? 1 : LOWER_ARCH_SCALE;
  const gumY = upper ? UPPER_GUM_Y : LOWER_GUM_Y;
  const crown = upper ? -1 : 1;
  const teeth = o.placements.filter((p) => p.arch === o.arch);
  const gaps: number[] = [];
  for (let i = 0; i < teeth.length - 1; i++) {
    if (o.missing.has(teeth[i].index) && o.missing.has(teeth[i + 1].index)) continue;
    gaps.push((teeth[i].s + teeth[i + 1].s) / 2);
  }
  const missingRanges: [number, number][] = [];
  for (let i = 0; i < teeth.length; i++) {
    if (!o.missing.has(teeth[i].index)) continue;
    const a = i > 0 ? (teeth[i - 1].s + teeth[i].s) / 2 : teeth[i].s - 0.06;
    const b = i < teeth.length - 1 ? (teeth[i].s + teeth[i + 1].s) / 2 : teeth[i].s + 0.06;
    missingRanges.push([a, b]);
  }
  const sMin = teeth[0].s - 0.1, sMax = teeth[teeth.length - 1].s + 0.1;
  const edgeLift = (s: number) => {
    // b offset of the edge (negative = toward the crown)
    let pap = 0;
    for (const g of gaps) pap = Math.max(pap, Math.exp(-(((s - g) / 0.022) ** 2)));
    let e = -0.2 * pap + 0.02;
    for (const [a, b] of missingRanges) if (s > a - 0.01 && s < b + 0.01) e = Math.min(e, -0.08);
    // beyond the last molars the tissue rounds off
    const end = Math.max(smooth(sMax - 0.1, sMax, s), 1 - smooth(sMin, sMin + 0.1, s));
    return e + end * 0.35;
  };
  // cross-section profile (a outward along the arch normal, b into the tissue away from the crowns)
  const prof: [number, number, number][] = [ // a, b, edge weight (1 = follows the scallop fully)
    [-0.34, -0.02, 1], [-0.5, 0.0, 1], [-0.62, 0.08, 0.9], [-0.72, 0.35, 0.5], [-0.76, 0.7, 0.2], [-0.68, 1.0, 0],
    [-0.45, 1.22, 0], [0, 1.32, 0], [0.4, 1.22, 0], [0.64, 1.0, 0], [0.76, 0.7, 0.2], [0.76, 0.35, 0.5],
    [0.66, 0.08, 0.9], [0.52, 0.0, 1], [0.36, -0.02, 1],
  ];
  const NSEG = o.segments ?? 160;
  const P = prof.length;
  const pos: number[] = [];
  const col: number[] = [];
  const cEdge = new THREE.Color('#FFB0BF'), cDeep = new THREE.Color('#E86F88');
  const tmp = new THREE.Color();
  for (let k = 0; k <= NSEG; k++) {
    const s = sMin + (sMax - sMin) * (k / NSEG);
    const ap = archPoint(s, scale);
    const n = archNormal(s);
    const e = edgeLift(s);
    const taper = 0.55 + 0.45 * Math.min(smooth(sMin, sMin + 0.07, s), 1 - smooth(sMax - 0.07, sMax, s));
    for (let j = 0; j < P; j++) {
      const [a0, b0, ew] = prof[j];
      const a = a0 * (0.75 + 0.25 * taper);
      const b = b0 * taper + e * ew;
      pos.push(ap.x + n.nx * a, gumY - crown * b, ap.z + n.nz * a);
      tmp.copy(cEdge).lerp(cDeep, smooth(0.05, 0.9, b0));
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < NSEG; k++) {
    for (let j = 0; j < P - 1; j++) {
      const a = k * P + j, b = k * P + j + 1, c = (k + 1) * P + j, d = (k + 1) * P + j + 1;
      if (upper) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  // end caps
  for (const k of [0, NSEG]) {
    const centre = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < P; j++) { cx += pos[(k * P + j) * 3]; cy += pos[(k * P + j) * 3 + 1]; cz += pos[(k * P + j) * 3 + 2]; }
    pos.push(cx / P, cy / P, cz / P);
    col.push(cDeep.r, cDeep.g, cDeep.b);
    for (let j = 0; j < P - 1; j++) {
      const a = k * P + j, b = k * P + j + 1;
      if ((k === 0) === upper) idx.push(centre, b, a); else idx.push(centre, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Soft tissue hanging below the lower gum on the outer (lip) side of the arch. Normally hidden behind
 * the lower lip; when the jaw closes it rises with the jaw so the gum never shows a hard bottom edge.
 */
export function skirtGeometry(): THREE.BufferGeometry {
  const NS = 80;
  const rows = [0.0, 0.35, 0.8, 1.5, 2.6, 4.0, 5.8];
  const pos: number[] = [];
  const col: number[] = [];
  const top = new THREE.Color('#EE8198'), bottom = new THREE.Color('#C8566E');
  const c = new THREE.Color();
  for (let r = 0; r < rows.length; r++) {
    const d = rows[r];
    for (let i = 0; i <= NS; i++) {
      const s = -1.08 + (2.16 * i) / NS;
      const ap = archPoint(s, LOWER_ARCH_SCALE);
      const n = archNormal(s);
      const a = 0.7 + 0.18 * smooth(0, 1.2, d);
      pos.push(ap.x + n.nx * a, LOWER_GUM_Y - 0.8 - d, ap.z + n.nz * a);
      c.copy(top).lerp(bottom, smooth(0, 2.5, d));
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < NS; i++) {
      const a = r * (NS + 1) + i, b = a + 1, cc = a + NS + 1, dd = cc + 1;
      idx.push(a, cc, b, b, cc, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Roof of the mouth (upper) as a shallow dome seen from below. */
export function palateGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(3.9, 1.35, 2.7);
  g.translate(0, UPPER_GUM_Y + 0.55, -0.85);
  const p = g.getAttribute('position');
  const col: number[] = [];
  const a = new THREE.Color('#F08C9C'), b = new THREE.Color('#C95A70');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), x = p.getX(i), z = p.getZ(i);
    // rugae ridges near the front
    const ridge = Math.sin(z * 6) * 0.04 * smooth(-0.5, 1.2, z) * (1 - smooth(0.5, 2.5, Math.abs(x)));
    p.setY(i, y + ridge);
    c.copy(a).lerp(b, smooth(UPPER_GUM_Y + 0.6, UPPER_GUM_Y + 1.9, y));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ tongue, cavity, lips, skin, throat

export function tongueGeometry(ws = 48, hs = 28): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.getAttribute('position');
  const col: number[] = [];
  const base = new THREE.Color('#F27D8E'), groove = new THREE.Color('#D65A70'), tip = new THREE.Color('#FF96A6');
  const c = new THREE.Color();
  const rnd = mulberry32(99);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // wide and flat, rounder toward the tip (front, +z)
    const front = smooth(-0.2, 1, z);
    x *= 3.0 - 0.9 * front;
    z *= 2.55;
    y *= 0.62;
    if (y > 0) {
      y -= 0.2 * Math.exp(-(x * x) / 0.35) * smooth(-2.2, 1.2, z);   // centre groove
      y += (rnd() - 0.5) * 0.025;                                     // papillae roughness
    }
    p.setXYZ(i, x, y, z);
    c.copy(base).lerp(groove, Math.exp(-(x * x) / 0.5) * 0.45).lerp(tip, front * 0.35);
    if (y < 0) c.multiplyScalar(0.7);
    col.push(c.r, c.g, c.b);
  }
  g.translate(0, -1.72 - 0.62 + 0.1, -0.45);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Elliptical tube from the lips to the throat, faces pointing inward. Colour darkens with depth. */
export function cavityGeometry(): THREE.BufferGeometry {
  const rings: [number, number, number][] = [ // z, rx, ry
    [3.6, 5.5, 3.5], [3.0, 5.7, 3.7], [1.5, 6.0, 3.9], [-0.5, 6.0, 3.9], [-2.2, 5.5, 3.7], [-3.4, 4.6, 3.3], [-3.9, 4.0, 3.0],
  ];
  const N = 56;
  const pos: number[] = [];
  const col: number[] = [];
  const front = new THREE.Color('#EE8796'), back = new THREE.Color('#B24A60');
  const c = new THREE.Color();
  for (const [z, rx, ry] of rings) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const y = Math.sin(a) * ry;
      pos.push(Math.cos(a) * rx, y, z);
      c.copy(front).lerp(back, smooth(3.2, -3.6, z));
      if (y < -2.2) c.multiplyScalar(0.85);
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < N; i++) {
      const a = r * N + i, b = r * N + ((i + 1) % N), cc = (r + 1) * N + i, d = (r + 1) * N + ((i + 1) % N);
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function throatGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, 48, 0, Math.PI * 2);
  g.scale(4.2, 3.1, 1);
  g.translate(0, 0, -3.8);
  const p = g.getAttribute('position');
  const col: number[] = [];
  const inner = new THREE.Color('#5A1426'), outer = new THREE.Color('#B8485E');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i) / 4.2, (p.getY(i) + 0.3) / 3.1);
    c.copy(inner).lerp(outer, smooth(0.05, 0.95, r));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export function uvulaGeometry(): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(0.28, 0.55, 6, 16);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 + 0.35 * smooth(0.2, -0.6, y);    // teardrop: fatter at the bottom
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  g.scale(1.25, 1.25, 1.25);
  g.translate(0, 0.75, -3.45);
  return g;
}

/** Cartoon lips: a thick closed tube around the mouth opening, with a cupid's bow. */
export function lipsGeometry(half: 'upper' | 'lower', N = 90, M = 18): THREE.BufferGeometry {
  const RX = 5.55, RY = 3.55, Z = 3.3;
  const pos: number[] = [];
  const a0 = half === 'upper' ? 0 : Math.PI, a1 = a0 + Math.PI;
  const centre = new THREE.Vector3(), tangent = new THREE.Vector3(), normal = new THREE.Vector3();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + (a1 - a0) * (i / N);
    const x = Math.cos(a) * RX;
    let y = Math.sin(a) * RY;
    pts.push(new THREE.Vector3(x, y, Z));
  }
  for (let i = 0; i <= N; i++) {
    const a = a0 + (a1 - a0) * (i / N);
    centre.copy(pts[i]);
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(N, i + 1)];
    tangent.subVectors(next, prev).normalize();
    normal.set(-tangent.y, tangent.x, 0).normalize();   // in-plane, pointing outward from the ellipse centre
    if (normal.x * centre.x + normal.y * centre.y < 0) normal.negate();
    const mid = Math.abs(Math.sin(a));                 // 1 at the middle of each lip, 0 at the corners
    const r = 0.32 + 0.4 * Math.pow(mid, 0.8) * (half === 'lower' ? 1.12 : 1);
    for (let j = 0; j <= M; j++) {
      const t = (j / M) * Math.PI * 2;
      // ring in the plane spanned by the outward normal and +Z; lips pout forward
      const cx = Math.cos(t) * r, cz = Math.sin(t) * r * 1.15;
      pos.push(centre.x + normal.x * cx, centre.y + normal.y * cx, centre.z + Math.max(-0.2, cz) + 0.1 * mid);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j, b = a + 1, c = (i + 1) * (M + 1) + j, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return fixLipWinding(g);
}
function fixLipWinding(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  let dot = 0;
  for (let i = 0; i < p.count; i++) dot += n.getZ(i);
  if (dot < 0) {
    const arr = g.getIndex()!.array as Uint32Array | Uint16Array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

/** Face skin around the mouth: a polar grid around the elliptical opening, cheeks puffed toward the camera. */
export function skinGeometry(S = 120): THREE.BufferGeometry {
  const RX = 5.5, RY = 3.5;
  const rings = [1, 1.05, 1.12, 1.22, 1.35, 1.5, 1.7, 1.95, 2.3, 2.8, 3.5, 4.5, 6, 8.5];
  const pos: number[] = [];
  const col: number[] = [];
  const blush = new THREE.Color('#FF8FA6');
  for (const e of rings) {
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2;
      const x = Math.cos(a) * RX * e, y = Math.sin(a) * RY * e;
      // tuck under the lips at the rim, bulge out at the cheeks, fall away further out
      const z = 3.25 + 0.75 * smooth(1, 1.5, e) * Math.exp(-((e - 1.7) ** 2) / 0.8) - 0.15 * Math.max(0, e - 3);
      pos.push(x, y, z);
      const bx = x - 7.4 * Math.sign(x || 1), by = y + 1.4;
      const b = Math.exp(-(bx * bx + by * by) / 5) * 0.4;
      col.push(1 - b * (1 - blush.r), 1 - b * (1 - blush.g), 1 - b * (1 - blush.b));
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < S; i++) {
      const a = r * S + i, b = r * S + ((i + 1) % S), c = (r + 1) * S + i, d = (r + 1) * S + ((i + 1) % S);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return fixLipWinding(g);
}

// ------------------------------------------------------------------ tartar and debris

/** A crusty tartar lump: base at y = 0, +Y out of the tooth, about 0.34 x 0.18 x 0.26. Vertex colours. */
export function tartarGeometry(variant: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const merged = mergeVerticesSimple(g);
  const rnd = mulberry32(1234 + variant * 77);
  const bumps: [THREE.Vector3, number][] = [];
  for (let i = 0; i < 9; i++) bumps.push([new THREE.Vector3(rnd() * 2 - 1, rnd() * 0.9, rnd() * 2 - 1).normalize(), 0.12 + rnd() * 0.22]);
  const pits: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) pits.push(new THREE.Vector3(rnd() * 2 - 1, rnd(), rnd() * 2 - 1).normalize());
  const p = merged.getAttribute('position');
  const col: number[] = [];
  const base = new THREE.Color('#C39433'), crust = new THREE.Color('#6E4A1C'), light = new THREE.Color('#EAD38E');
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const seed = variant * 31 + 7;
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    let r = 1;
    for (const [b, s] of bumps) { const d = v.distanceTo(b); r += s * Math.exp(-(d * d) / 0.12); }
    let pit = 0;
    for (const q of pits) { const d = v.distanceTo(q); pit = Math.max(pit, Math.exp(-(d * d) / 0.02)); }
    // crunchy relief: two octaves of value noise
    const n1 = noise3(v.x * 3.2 + seed, v.y * 3.2, v.z * 3.2);
    const n2 = noise3(v.x * 8.5, v.y * 8.5 + seed, v.z * 8.5);
    const grit = (n1 - 0.5) * 0.45 + (n2 - 0.5) * 0.28;
    r += grit - pit * 0.18;
    const y = Math.max(-0.15, v.y * r);
    // wide and low: an encrusted patch, not a ball
    p.setXYZ(i, v.x * r * 0.2, (y + 0.15) * 0.14, v.z * r * 0.15);
    const hi = Math.max(0, grit) * 2.4;
    const lo = Math.max(0, -grit) * 3 + pit * 1.3 + (v.y < 0.1 ? 0.3 : 0);
    c.copy(base).lerp(light, Math.min(1, hi)).lerp(crust, Math.min(0.9, lo));
    col.push(c.r, c.g, c.b);
  }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  merged.computeVertexNormals();
  g.dispose();
  return merged;
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth 3D value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

/** Weld coincident vertices of an indexed-by-position geometry (no three addons needed). */
function mergeVerticesSimple(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = src.getAttribute('position');
  const map = new Map<string, number>();
  const pos: number[] = [];
  const remap: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let j = map.get(k);
    if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(p.getX(i), p.getY(i), p.getZ(i)); }
    remap.push(j);
  }
  const idx: number[] = [];
  const index = src.getIndex();
  if (index) for (let i = 0; i < index.count; i++) idx.push(remap[index.getX(i)]);
  else for (let i = 0; i < p.count; i++) idx.push(remap[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export type DebrisGeo = { geo: THREE.BufferGeometry; color: string; rough: number; metal?: number };

export function debrisGeometry(kind: 'popcorn' | 'spinach' | 'seed' | 'candy' | 'seaweed' | 'doubloon'): DebrisGeo {
  switch (kind) {
    case 'seaweed': {
      // three wavy ribbons hanging out of the gap
      const parts: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 3; k++) {
        const g = new THREE.PlaneGeometry(0.07, 0.5, 1, 10);
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          p.setX(i, p.getX(i) + Math.sin(y * 14 + k * 2) * 0.035 + (k - 1) * 0.06);
          p.setZ(i, Math.cos(y * 9 + k) * 0.03);
        }
        g.rotateZ((k - 1) * 0.35);
        g.translate(0, -0.12, 0);
        parts.push(g);
      }
      return { geo: withColors(mergeGeos(parts), ['#2F8F4A', '#3FAE5A', '#1F6B3A']), color: '#ffffff', rough: 0.35 };
    }
    case 'doubloon': {
      const coin = new THREE.CylinderGeometry(0.17, 0.17, 0.045, 28);
      const rim = new THREE.TorusGeometry(0.16, 0.022, 6, 28);
      rim.rotateX(Math.PI / 2);
      const face = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 5);
      const g = mergeGeos([coin, rim, face]);
      g.rotateX(Math.PI / 2);
      return { geo: withColors(g, ['#F4C542', '#E8B030', '#FFD866']), color: '#ffffff', rough: 0.22, metal: 0.9 };
    }
    case 'popcorn': {
      const parts: THREE.BufferGeometry[] = [];
      const rnd = mulberry32(5);
      for (let i = 0; i < 6; i++) {
        const s = new THREE.IcosahedronGeometry(0.075 + rnd() * 0.05, 1);
        s.translate((rnd() - 0.5) * 0.18, (rnd() - 0.5) * 0.14, (rnd() - 0.5) * 0.12);
        parts.push(s);
      }
      return { geo: withColors(mergeGeos(parts), ['#FFF6DC', '#FFEDB8', '#F5D98A']), color: '#ffffff', rough: 0.8 };
    }
    case 'spinach': {
      const g = new THREE.PlaneGeometry(0.3, 0.22, 6, 5);
      const p = g.getAttribute('position');
      const rnd = mulberry32(8);
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 18) * 0.03 + (rnd() - 0.5) * 0.04);
      g.computeVertexNormals();
      return { geo: withColors(g, ['#3E9B3A', '#2F7A2E', '#58B24E']), color: '#ffffff', rough: 0.5 };
    }
    case 'seed': {
      const g = new THREE.SphereGeometry(1, 12, 8);
      g.scale(0.05, 0.1, 0.04);
      return { geo: withColors(g, ['#5B4630', '#40301F', '#7A6040']), color: '#ffffff', rough: 0.6 };
    }
    default: {
      const g = new THREE.IcosahedronGeometry(0.12, 0);
      g.scale(1, 0.8, 0.9);
      return { geo: withColors(g.toNonIndexed(), ['#FF5FA2', '#FF7AB6', '#FF4F95']), color: '#ffffff', rough: 0.15 };
    }
  }
}

function withColors(g: THREE.BufferGeometry, palette: string[]): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const cols = palette.map((h) => new THREE.Color(h));
  const rnd = mulberry32(p.count);
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) { const c = cols[Math.floor(rnd() * cols.length)]; col.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of flat) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of flat) {
    g.computeVertexNormals();
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

// ------------------------------------------------------------------ tools

export interface ToolParts { group: THREE.Group; spinner: THREE.Object3D | null; spinAxis: 'y' | 'z'; nozzle: THREE.Vector3; string: THREE.Mesh | null }

const steel = () => new THREE.MeshStandardMaterial({ color: '#D5DEE4', metalness: 0.85, roughness: 0.28 });
const plastic = (c: string, rough = 0.4) => new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: rough });

function cyl(r0: number, r1: number, len: number, mat: THREE.Material, y0: number, seg = 16) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.translate(0, y0 + len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  return m;
}
function tube(points: THREE.Vector3[], r: number, mat: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 8, false), mat);
}

/** Procedural tool: tip at the origin, handle along +Y, about 7 units long. */
export function toolModel(key: string): ToolParts {
  const g = new THREE.Group();
  let spinner: THREE.Object3D | null = null;
  let string: THREE.Mesh | null = null;
  const nozzle = new THREE.Vector3(0, 0, 0);
  const handle = (color: string, band: string, r = 0.2) => {
    g.add(cyl(r, r, 4.2, steel(), 2.4, 12));
    for (let i = 0; i < 6; i++) g.add(cyl(r * 1.08, r * 1.08, 0.12, plastic(band, 0.5), 3.0 + i * 0.5, 12));
    g.add(cyl(r * 0.9, r, 0.4, plastic(color), 2.0, 12));
  };
  switch (key) {
    case 'tool_scaler': case 'tool_curette': case 'tool_titanium': {
      const band = key === 'tool_scaler' ? '#3DD6B5' : key === 'tool_curette' ? '#0E8F8A' : '#7C8CFF';
      handle('#B8C4CC', band, key === 'tool_titanium' ? 0.23 : 0.2);
      const shank = tube([new THREE.Vector3(0, 2.05, 0), new THREE.Vector3(0.05, 1.2, 0.12), new THREE.Vector3(0.3, 0.45, 0.12), new THREE.Vector3(0.18, 0.08, 0.02)], 0.045, steel());
      g.add(shank);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 10), steel());
      tip.position.set(0.08, 0.02, 0); tip.rotation.z = key === 'tool_curette' ? 1.9 : 2.3;
      g.add(tip);
      if (key === 'tool_curette') { const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), steel()); b.position.set(0.02, 0, 0); g.add(b); }
      break;
    }
    case 'tool_ultrasonic': case 'tool_piezo': {
      const accent = key === 'tool_piezo' ? '#FF7AA8' : '#3DD6B5';
      g.add(cyl(0.34, 0.3, 4.4, plastic('#F4F7F8', 0.35), 2.2, 18));
      g.add(cyl(0.36, 0.36, 0.3, plastic(accent), 3.2, 18));
      g.add(cyl(0.2, 0.34, 0.5, plastic(accent), 1.75, 18));
      const shank = tube([new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0, 1.0, 0.08), new THREE.Vector3(0.18, 0.4, 0.1), new THREE.Vector3(0.1, 0.04, 0.02)], 0.055, steel());
      g.add(shank);
      g.add(tube([new THREE.Vector3(0, 6.6, 0), new THREE.Vector3(0.2, 7.6, 0.2), new THREE.Vector3(1.0, 8.6, 0.6), new THREE.Vector3(2.0, 9.4, 1.0)], 0.1, plastic('#E6ECEF', 0.5)));
      nozzle.set(0.1, 0.1, 0.02);
      break;
    }
    case 'tool_polisher': case 'tool_cordless': case 'tool_airpolisher': {
      const body = key === 'tool_cordless' ? '#0E8F8A' : key === 'tool_airpolisher' ? '#FFD166' : '#EEF2F4';
      g.add(cyl(0.32, 0.28, 4.6, plastic(body, 0.35), 1.2, 18));
      g.add(cyl(0.34, 0.34, 0.25, plastic('#3DD6B5'), 4.4, 18));
      const neck = cyl(0.14, 0.18, 1.0, plastic('#F8FAFB', 0.3), 0.3, 12);
      g.add(neck);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), plastic('#F8FAFB', 0.3));
      head.position.set(0, 0.32, 0.05); g.add(head);
      if (key === 'tool_airpolisher') {
        const n = tube([new THREE.Vector3(0, 0.3, 0.05), new THREE.Vector3(0, 0.12, 0.25), new THREE.Vector3(0, 0.05, 0.45)], 0.06, steel());
        g.add(n);
        nozzle.set(0, 0.05, 0.45);
      } else {
        const cupG = new THREE.CylinderGeometry(key === 'tool_cordless' ? 0.2 : 0.16, 0.12, 0.18, 20, 1, true);
        const cup = new THREE.Mesh(cupG, new THREE.MeshStandardMaterial({ color: key === 'tool_cordless' ? '#7FE3FF' : '#9BF0D8', roughness: 0.6, side: THREE.DoubleSide }));
        cup.rotation.x = Math.PI / 2;
        const holder = new THREE.Group();
        holder.position.set(0, 0.2, 0.12);
        holder.add(cup);
        // a dab of prophy paste inside the cup
        const paste = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), plastic('#FFB3C9', 0.7));
        paste.scale.set(1, 1, 0.5); paste.position.z = -0.03;
        holder.add(paste);
        g.add(holder);
        spinner = holder;
      }
      break;
    }
    case 'tool_floss': case 'tool_flosspick': {
      const body = key === 'tool_floss' ? '#3DD6B5' : '#FF7AA8';
      g.add(cyl(0.22, 0.18, 4.2, plastic(body, 0.4), 1.3, 14));
      const armMat = plastic(body, 0.4);
      g.add(tube([new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(-0.3, 1.0, 0), new THREE.Vector3(-0.42, 0.45, 0), new THREE.Vector3(-0.42, 0.25, 0)], 0.07, armMat));
      g.add(tube([new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(0.3, 1.0, 0), new THREE.Vector3(0.42, 0.45, 0), new THREE.Vector3(0.42, 0.25, 0)], 0.07, armMat));
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.84, 6), new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.4, emissive: '#DFFFF6', emissiveIntensity: 0.25 }));
      s.rotation.z = Math.PI / 2; s.position.set(0, 0.25, 0);
      g.add(s);
      string = s;
      g.position.y = 0;
      g.children.forEach((c) => { c.position.y -= 0.25; });
      break;
    }
    case 'tool_waterflosser': {
      g.add(cyl(0.34, 0.3, 4.4, plastic('#F4F7F8', 0.35), 1.6, 18));
      g.add(cyl(0.36, 0.36, 0.5, plastic('#6CC8FF'), 2.2, 18));
      g.add(tube([new THREE.Vector3(0, 1.7, 0), new THREE.Vector3(0, 0.8, 0.05), new THREE.Vector3(0.05, 0.25, 0.1), new THREE.Vector3(0.05, 0.02, 0.12)], 0.06, plastic('#E8F7FF', 0.3)));
      nozzle.set(0.05, 0.02, 0.12);
      break;
    }
    case 'tool_suction': case 'tool_hve': {
      const hve = key === 'tool_hve';
      const r = hve ? 0.17 : 0.09;
      const mat = new THREE.MeshStandardMaterial({ color: hve ? '#DDE7EC' : '#8FDDF5', roughness: 0.25, transparent: !hve, opacity: hve ? 1 : 0.85 });
      g.add(tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.6, 0.2), new THREE.Vector3(0.1, 1.6, 0.25), new THREE.Vector3(0.2, 4.5, 0.2), new THREE.Vector3(0.4, 7.5, 0.3)], r, mat));
      const tipM = new THREE.Mesh(new THREE.SphereGeometry(r * 1.3, 12, 8), plastic(hve ? '#9AA8B0' : '#3DD6B5', 0.5));
      g.add(tipM);
      if (hve) g.add(cyl(0.26, 0.26, 1.2, plastic('#0E8F8A'), 3.2, 14));
      break;
    }
    case 'tool_gelbrush': {
      g.add(cyl(0.2, 0.17, 4.6, plastic('#FFFFFF', 0.35), 1.3, 14));
      g.add(cyl(0.22, 0.22, 0.4, plastic('#7FD8FF'), 4.2, 14));
      g.add(cyl(0.1, 0.16, 0.6, steel(), 0.7, 12));
      const tipG = new THREE.ConeGeometry(0.12, 0.7, 14);
      tipG.rotateX(Math.PI);
      tipG.translate(0, 0.35, 0);
      const tip = new THREE.Mesh(tipG, new THREE.MeshStandardMaterial({ color: '#8FE3FF', roughness: 0.6, emissive: '#3FB8E8', emissiveIntensity: 0.25 }));
      g.add(tip);
      break;
    }
    case 'tool_uvlamp': {
      g.add(cyl(0.3, 0.26, 4.2, plastic('#2B3B55', 0.3), 1.8, 18));
      g.add(cyl(0.32, 0.32, 0.3, plastic('#7C6CFF'), 3.2, 18));
      const neck = tube([new THREE.Vector3(0, 1.9, 0), new THREE.Vector3(0, 1.2, 0.1), new THREE.Vector3(0, 0.55, 0.3)], 0.12, plastic('#2B3B55', 0.3));
      g.add(neck);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.3, 20), plastic('#2B3B55', 0.3));
      head.position.set(0, 0.35, 0.35); head.rotation.x = Math.PI / 2 - 0.3;
      g.add(head);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.27, 20), new THREE.MeshBasicMaterial({ color: '#B9A8FF' }));
      lens.position.set(0, 0.28, 0.5); lens.rotation.x = -0.3;
      g.add(lens);
      nozzle.set(0, 0.28, 0.5);
      break;
    }
    default: { // tool_syringe
      g.add(cyl(0.26, 0.24, 3.4, steel(), 2.0, 14));
      g.add(cyl(0.3, 0.3, 0.3, plastic('#3DD6B5'), 4.6, 14));
      const trig = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.3), plastic('#0E8F8A'));
      trig.position.set(0, 4.2, 0.35); g.add(trig);
      g.add(tube([new THREE.Vector3(0, 2.05, 0), new THREE.Vector3(0, 1.2, 0.05), new THREE.Vector3(0.1, 0.5, 0.2), new THREE.Vector3(0.08, 0.1, 0.25)], 0.06, steel()));
      nozzle.set(0.08, 0.1, 0.25);
      break;
    }
  }
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; } });
  return { group: g, spinner, spinAxis: 'z', nozzle, string };
}

export const GUM_HEIGHTS = { upper: UPPER_GUM_Y, lower: LOWER_GUM_Y };


// ------------------------------------------------------------------ case props (procedural fallbacks)

/** A cone-shaped barnacle shell with ridges: base at y = 0, +Y out of the tooth, about 0.34 across. */
export function barnacleGeometry(variant: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const prof: [number, number][] = [[0.17, 0], [0.175, 0.02], [0.15, 0.07], [0.11, 0.13], [0.075, 0.17], [0.06, 0.165], [0.045, 0.13], [0.0, 0.12]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 22);
  const p = g.getAttribute('position');
  const col: number[] = [];
  const shell = new THREE.Color('#EDE6D2'), ridge = new THREE.Color('#BFB49A'), hole = new THREE.Color('#4A3B2A'), moss = new THREE.Color('#9BA873');
  const c = new THREE.Color();
  const rnd = mulberry32(77 + variant * 13);
  const jitter = Array.from({ length: 8 }, () => 0.8 + rnd() * 0.4);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const plates = Math.pow(Math.abs(Math.cos(a * 3)), 0.5);
    const k = (0.88 + 0.14 * plates) * jitter[Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 8];
    p.setXYZ(i, x * k, y * (0.9 + 0.15 * jitter[(i >> 2) % 8]), z * k);
    const r = Math.hypot(x, z);
    c.copy(shell).lerp(ridge, (1 - plates) * 0.7);
    if (y > 0.12 && r < 0.07) c.copy(hole);
    if (y < 0.03) c.lerp(moss, 0.5);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A thin dark zig-zag crack ribbon lying on top of a deposit (tartar space: base y = 0, lump ~0.34 wide). */
export function crackGeometry(seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const pos: number[] = [];
  const idx: number[] = [];
  const n = 6;
  let x = -0.16, z = (rnd() - 0.5) * 0.08;
  for (let i = 0; i <= n; i++) {
    const w = 0.012 * (1 - Math.abs(i / n - 0.5));
    pos.push(x, 0, z - w, x, 0, z + w);
    x += 0.32 / n;
    z += (rnd() - 0.5) * 0.09;
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Orthodontic bracket: a small rounded steel block with wings and a slot for the wire, facing +Z. */
export function bracketGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.26, 0.24, 0.05);
  base.translate(0, 0, 0.025);
  const parts: THREE.BufferGeometry[] = [base];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const w = new THREE.BoxGeometry(0.08, 0.07, 0.07);
    w.translate(sx * 0.075, sy * 0.075, 0.07);
    parts.push(w);
  }
  return mergeGeos(parts);
}

/** A cartoon sugar bug: gumdrop body, googly eyes, six little legs. About 0.24 long, feet at y = 0, facing +Z. */
export function sugarBugModel(): { group: THREE.Group; legs: THREE.Object3D[]; body: THREE.Mesh; mats: THREE.Material[]; geos: THREE.BufferGeometry[] } {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: '#B45CFF', roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.1, sheen: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.3 });
  const ink = new THREE.MeshStandardMaterial({ color: '#16323A', roughness: 0.4 });
  const legMat = new THREE.MeshStandardMaterial({ color: '#6E2FA8', roughness: 0.5 });
  const bodyG = new THREE.SphereGeometry(0.1, 16, 12);
  bodyG.scale(1, 0.72, 1.25);
  const body = new THREE.Mesh(bodyG, bodyMat);
  body.position.y = 0.07;
  group.add(body);
  // sugar crystals on the back
  const sprG = new THREE.OctahedronGeometry(0.018, 0);
  const sprMat = new THREE.MeshStandardMaterial({ color: '#FFF6FF', roughness: 0.2, emissive: '#FFFFFF', emissiveIntensity: 0.15 });
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Mesh(sprG, sprMat);
    const a = i * 2.4;
    sp.position.set(Math.cos(a) * 0.05, 0.13, Math.sin(a) * 0.06 - 0.01);
    group.add(sp);
  }
  const eyeG = new THREE.SphereGeometry(0.035, 12, 10);
  const pupG = new THREE.SphereGeometry(0.017, 8, 8);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(eyeG, white);
    e.position.set(sx * 0.042, 0.12, 0.1);
    const pu = new THREE.Mesh(pupG, ink);
    pu.position.set(sx * 0.045, 0.12, 0.13);
    group.add(e, pu);
  }
  const legG = new THREE.CylinderGeometry(0.01, 0.008, 0.08, 5);
  legG.rotateZ(Math.PI / 2);
  legG.translate(0.04, 0, 0);
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.08, 0.03, (k - 1) * 0.06);
    const l = new THREE.Mesh(legG, legMat);
    l.rotation.z = -0.5;
    if (sx < 0) pivot.rotation.y = Math.PI;
    pivot.add(l);
    group.add(pivot);
    legs.push(pivot);
  }
  group.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  return { group, legs, body, mats: [bodyMat, white, ink, legMat, sprMat], geos: [bodyG, sprG, eyeG, pupG, legG] };
}

/** A flattened torus lying in the XZ plane (radius 1): problem-tooth rings, the polisher wrap ring. */
export function flatRingGeometry(tube = 0.07): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(1, tube, 6, 48);
  g.rotateX(Math.PI / 2);
  g.scale(1, 0.5, 1);
  return g;
}

/** A puffy gum pocket: a squashed capsule along X (the arch tangent), about 0.5 wide. */
export function pocketGeometry(): THREE.BufferGeometry {
  // a swollen lobe of gum: wide along the arch, shallow, a little lumpy
  const g = new THREE.SphereGeometry(1, 24, 14);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const lump = 1 + 0.07 * Math.sin(x * 3.1 + 1) * Math.cos(z * 2.3);
    p.setXYZ(i, x * 0.36 * lump, y * 0.1 * lump, z * 0.1 * lump);
  }
  g.computeVertexNormals();
  // angry red in the middle, fading to gum pink at the rim
  const col: number[] = [];
  const mid = new THREE.Color('#FF5A74'), rim = new THREE.Color('#F4909F');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const k = Math.min(1, Math.abs(p.getX(i)) / 0.36); col.push(...c.copy(mid).lerp(rim, k * k).toArray()); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
