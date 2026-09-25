// Floss geometry (DESIGN 5.4), pure math so it can be tested without a renderer.
//
// A gap has its own frame in arch space: t runs along the arch (tooth a at t < 0, tooth b at t > 0, the gap
// at 0), h runs up the crown from the gumline centre of the teeth, n points out of the mouth. The scene samples
// the teeth once per gap (the outward depth profile, the biting edge at the gap and the visible gumline there)
// and this module turns a floss state into:
//   - the string: one continuous curve in front of the teeth, across the gap at the current depth, dipping into
//     the gap as a V (tight) or U (slack) notch, never below the visible gumline;
//   - the input axes: pointer motion split along the gap (toward the gum) and across it, from the CURRENT screen
//     projection of the gap, so the mapping follows camera glides, sway, jolts and the jaw.

import { FLOSS, type FlossState } from './floss';

export interface GapProfile {
  /** Sample positions along the arch (ascending) and the outward depth of the teeth there (-Infinity: none). */
  ts: number[];
  depth: number[];
  /** Face centres of the two teeth along t (tA < 0 < tB) and their widths. */
  tA: number; tB: number; wA: number; wB: number;
  /** Heights (up the crown) of the biting edge at the gap and of the visible gumline (papilla) at the gap. */
  hEdge: number; hGum: number;
  /** Food under the wire at a bracket: one tooth, the "gap" is its bracket. */
  bracket: boolean;
}

export interface GapPoint { t: number; h: number; n: number }

/** How far in front of the tooth surface the string runs, and how far out the fingertips hold it. */
export const STRING = { margin: 0.035, handOut: 0.16, handGap: 0.06, sideDip: 0.3, bendT: 0.08, bendHand: 0.14, bridge: 0.09 };

/**
 * The front envelope of a profile: holes (between the teeth, past the end of the arch) filled from the
 * neighbours, then a running max over +-STRING.bridge so the string bridges the embrasure in front of both teeth
 * instead of cutting behind a bulge.
 */
export function envelope(p: GapProfile): number[] {
  const n = p.ts.length;
  const d = p.depth.slice();
  // fill: -Infinity takes the larger of the nearest valid samples on each side
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(d[i])) continue;
    let l = -Infinity, r = -Infinity;
    for (let k = i - 1; k >= 0; k--) if (Number.isFinite(p.depth[k])) { l = p.depth[k]; break; }
    for (let k = i + 1; k < n; k++) if (Number.isFinite(p.depth[k])) { r = p.depth[k]; break; }
    const v = Math.max(l, r);
    d[i] = Number.isFinite(v) ? v : 0;
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let m = d[i];
    for (let k = 0; k < n; k++) if (Math.abs(p.ts[k] - p.ts[i]) <= STRING.bridge + 1e-9) m = Math.max(m, d[k]);
    out[i] = m;
  }
  return out;
}

/** Envelope depth at t (linear between samples, clamped at the ends). */
export function depthAt(p: GapProfile, env: number[], t: number): number {
  const ts = p.ts;
  const n = ts.length;
  if (n === 0) return 0;
  if (t <= ts[0]) return env[0];
  if (t >= ts[n - 1]) return env[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
  const k = (t - ts[lo]) / Math.max(1e-9, ts[hi] - ts[lo]);
  return env[lo] + (env[hi] - env[lo]) * k;
}

/** Height of the string at gap depth s (0 biting edge, 1 visible gumline; s < 0 is above the edge). */
export function heightAt(p: GapProfile, s: number): number {
  return p.hEdge - s * (p.hEdge - p.hGum);
}

/** How deep the string is drawn for a floss state: pressure presses it into the contact, pull lifts it out. */
export function drawnDepth(st: Pick<FlossState, 'phase' | 's' | 'pressure' | 'pull'>): number {
  let s = st.s;
  if (st.phase === 'above') s += st.pressure * 0.07;
  else if (st.phase === 'through') s -= st.pull * (FLOSS.contact + FLOSS.pullOver);
  return Math.max(FLOSS.entry, Math.min(1, s));
}

/** How taut the string looks (0 slack U, 1 tight V). */
export function tautness(st: Pick<FlossState, 'phase' | 'pressure' | 'pull' | 'bend'>): number {
  return Math.min(1, Math.max(st.pressure, st.pull, Math.abs(st.bend) * 0.8, st.phase === 'through' ? 0.45 : 0.15));
}

export interface StringPath { pts: GapPoint[]; handL: GapPoint; handR: GapPoint; mid: GapPoint }

/**
 * The string for depth s (see drawnDepth), sideways bend -1..1 and tautness 0..1, as `count` points from the
 * left fingertip to the right one (gap frame). Continuous; every point in front of the teeth; never below the
 * visible gumline.
 */
export function stringPath(p: GapProfile, env: number[], s: number, bend: number, taut: number, count = 49): StringPath {
  const hMid = heightAt(p, Math.min(1, s));
  const sSide = s > 0 ? s * STRING.sideDip : s;
  const hSide = heightAt(p, sSide);
  const halfA = Math.max(0.12, -p.tA), halfB = Math.max(0.12, p.tB);
  const tMid = Math.max(-halfA * 0.45, Math.min(halfB * 0.45, bend * STRING.bendT));
  const tL = -halfA - p.wA / 2 - STRING.handGap + bend * STRING.bendHand;
  const tR = halfB + p.wB / 2 + STRING.handGap + bend * STRING.bendHand;
  const k = Math.max(0, Math.min(1, taut));
  const pts: GapPoint[] = [];
  const ramp = 0.22;
  for (let i = 0; i < count; i++) {
    const t = tL + (tR - tL) * (i / (count - 1));
    // the notch: from the face centres (tA, tB) down to the gap
    let f = 0;
    if (t <= tMid) f = t <= -halfA ? 0 : (t + halfA) / (tMid + halfA);
    else f = t >= halfB ? 0 : (halfB - t) / (halfB - tMid);
    f = Math.max(0, Math.min(1, f));
    // slack: a U (smooth shoulders and bottom); taut: a V (smooth shoulders, sharp bottom at the gap)
    const shape = f * f * (3 - 2 * f) * (1 - k) + f * f * k;
    const h = Math.max(p.hGum, hSide + (hMid - hSide) * shape);
    // out in front of the teeth; rising to the fingertips at the ends
    const end = Math.max(0, 1 - (t - tL) / ramp, 1 - (tR - t) / ramp);
    const n = depthAt(p, env, t) + STRING.margin + (STRING.handOut - STRING.margin) * end * end;
    pts.push({ t, h, n });
  }
  return {
    pts,
    handL: pts[0], handR: pts[count - 1],
    mid: { t: tMid, h: Math.max(p.hGum, hMid), n: depthAt(p, env, tMid) + STRING.margin },
  };
}

// ---------------------------------------------------------------- input

export interface ScreenAxis { x: number; y: number; len: number }

/**
 * The gap's on-screen axis from the projected biting-edge point toward the projected gumline point: unit
 * direction and length (at least `minLen`). A degenerate projection (looking straight down the tooth) keeps
 * `prev` (or points down the screen).
 */
export function screenAxis(edge: { x: number; y: number }, gum: { x: number; y: number }, minLen: number, prev?: ScreenAxis | null): ScreenAxis {
  const dx = gum.x - edge.x, dy = gum.y - edge.y;
  const l = Math.hypot(dx, dy);
  if (l < 4) return prev ? { x: prev.x, y: prev.y, len: Math.max(minLen, prev.len) } : { x: 0, y: 1, len: minLen };
  return { x: dx / l, y: dy / l, len: Math.max(minLen, l) };
}

/**
 * Split a pointer step (dx, dy in px) along the gap axis (toward the gum, in gap lengths) and across it.
 * Each step is capped so a dropped frame or a touch jump cannot skip the whole gesture.
 */
export function splitStep(axis: ScreenAxis, dx: number, dy: number, cap = 0.35): { along: number; cross: number } {
  const along = (dx * axis.x + dy * axis.y) / axis.len;
  const cross = (-dx * axis.y + dy * axis.x) / axis.len;
  const c = (v: number) => Math.max(-cap, Math.min(cap, v));
  return { along: c(along), cross: c(cross) };
}
