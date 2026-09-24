// Shared mouth geometry: the arch curve, tooth kinds, sizes and placement. Pure math, no three.js,
// so the clean scene, tests and the Blender gum script (which mirrors ARCH_* in Python) agree.
//
// Mouth space (three.js convention): +Y up, the camera sits at +Z looking toward -Z, 1 unit ~ 8 mm.
// The arch lies in the XZ plane: front teeth nearest the camera (largest z), molars at the back.
//   x = ARCH_X * s * scale,  z = ARCH_Z0 + ARCH_Z * (1 - s^2) * scale,  s in [-1, 1]
// Upper teeth hang from the upper gumline (y = UPPER_GUM_Y) pointing -Y; lower teeth stand on
// y = LOWER_GUM_Y pointing +Y. Each tooth's local +Z (its outward/labial face) points along the
// arch's outward normal.
import type { ToothKind } from './types';

export const ARCH_X = 4.8;
export const ARCH_Z = 4.4;
export const ARCH_Z0 = -1.8;
export const LOWER_ARCH_SCALE = 0.95;
export const UPPER_GUM_Y = 2.0;
export const LOWER_GUM_Y = -2.0;
export const TOOTH_GAP = 0.04;
export const TEETH_PER_ARCH = 14;
export const TOOTH_COUNT = 28;

/** Kind per arch position 0..13 (viewer's left to right). */
export const KIND_BY_POS: readonly ToothKind[] = [
  'molar', 'molar', 'premolar', 'premolar', 'canine', 'incisor', 'incisor',
  'incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar',
];

/** Crown dimensions in mouth units: width (along the arch), height (gumline to edge), depth (in-out). */
export const TOOTH_DIMS: Record<ToothKind, { w: number; h: number; d: number }> = {
  incisor: { w: 0.8, h: 1.05, d: 0.55 },
  canine: { w: 0.8, h: 1.15, d: 0.7 },
  premolar: { w: 0.75, h: 0.85, d: 0.8 },
  molar: { w: 1.05, h: 0.75, d: 0.95 },
};
/** Lateral incisors (positions 5 and 8) are narrower. */
export function toothWidth(pos: number): number {
  const k = KIND_BY_POS[pos];
  if (pos === 5 || pos === 8) return 0.68;
  if (pos === 6 || pos === 7) return 0.85;
  return TOOTH_DIMS[k].w;
}

export interface ToothPlacement {
  index: number;          // 0..27
  arch: 'upper' | 'lower';
  pos: number;            // 0..13 along the arch
  kind: ToothKind;
  width: number;
  height: number;
  depth: number;
  s: number;              // arch parameter
  x: number; y: number; z: number;   // gumline center
  yaw: number;            // rotation about +Y so local +Z faces outward
  nx: number; nz: number; // outward normal
  /** crown direction: -1 for upper (points down), +1 for lower */
  dir: -1 | 1;
}

export function archPoint(s: number, scale = 1): { x: number; z: number } {
  return { x: ARCH_X * s * scale, z: ARCH_Z0 * scale + ARCH_Z * (1 - s * s) * scale };
}

export function archNormal(s: number): { nx: number; nz: number } {
  // tangent (ARCH_X, -2 ARCH_Z s); outward normal (2 ARCH_Z s, ARCH_X)
  const nx = 2 * ARCH_Z * s;
  const nz = ARCH_X;
  const l = Math.hypot(nx, nz);
  return { nx: nx / l, nz: nz / l };
}

// arc-length table for the unit-scale curve
const TABLE_N = 400;
const arcTable: number[] = (() => {
  const t = [0];
  let prev = archPoint(-1);
  for (let i = 1; i <= TABLE_N; i++) {
    const s = -1 + (2 * i) / TABLE_N;
    const p = archPoint(s);
    t.push(t[i - 1] + Math.hypot(p.x - prev.x, p.z - prev.z));
    prev = p;
  }
  return t;
})();
export const ARCH_LENGTH = arcTable[TABLE_N];

/** Arch parameter s for an arc length (unit scale) measured from s = -1. */
export function sAtLength(len: number): number {
  const L = Math.max(0, Math.min(ARCH_LENGTH, len));
  let lo = 0;
  let hi = TABLE_N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arcTable[mid] < L) lo = mid; else hi = mid;
  }
  const seg = arcTable[hi] - arcTable[lo] || 1;
  const f = (L - arcTable[lo]) / seg;
  return -1 + (2 * (lo + f)) / TABLE_N;
}

/** Placement of all 28 teeth. Missing teeth still get a placement (the scene just skips them). */
export function layoutTeeth(): ToothPlacement[] {
  const widths = Array.from({ length: TEETH_PER_ARCH }, (_, p) => toothWidth(p));
  const total = widths.reduce((a, b) => a + b, 0) + TOOTH_GAP * (TEETH_PER_ARCH - 1);
  const out: ToothPlacement[] = [];
  for (const arch of ['upper', 'lower'] as const) {
    const scale = arch === 'upper' ? 1 : LOWER_ARCH_SCALE;
    // lay the teeth out centred on the arch, measured in unit-scale arc length
    let cursor = (ARCH_LENGTH - total / scale) / 2;
    for (let pos = 0; pos < TEETH_PER_ARCH; pos++) {
      const w = widths[pos];
      const center = cursor + w / 2 / scale;
      cursor += (w + TOOTH_GAP) / scale;
      const s = sAtLength(center);
      const p = archPoint(s, scale);
      const n = archNormal(s);
      const kind = KIND_BY_POS[pos];
      const dims = TOOTH_DIMS[kind];
      out.push({
        index: arch === 'upper' ? pos : TEETH_PER_ARCH + pos,
        arch, pos, kind,
        width: w, height: dims.h, depth: dims.d,
        s, x: p.x, y: arch === 'upper' ? UPPER_GUM_Y : LOWER_GUM_Y, z: p.z,
        yaw: Math.atan2(n.nx, n.nz), nx: n.nx, nz: n.nz,
        dir: arch === 'upper' ? -1 : 1,
      });
    }
  }
  return out;
}

/** Gap between tooth `index` and the next tooth in the same arch (for debris). null at the arch end. */
export function gapBetween(index: number): { a: number; b: number } | null {
  const pos = index % TEETH_PER_ARCH;
  if (pos >= TEETH_PER_ARCH - 1) return null;
  return { a: index, b: index + 1 };
}

export function isMolar(index: number): boolean {
  return KIND_BY_POS[index % TEETH_PER_ARCH] === 'molar';
}

/** Can this (u, v) cell of a tooth of this kind hold dirt? (DESIGN 5.2) */
export function reachable(kind: ToothKind, u: number, v: number): boolean {
  if (u >= 0.18 && u <= 0.82) return true;
  return v >= 0.86 && (kind === 'molar' || kind === 'premolar');
}
