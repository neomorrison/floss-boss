import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  depthAt, drawnDepth, envelope, heightAt, screenAxis, splitStep, STRING, stringPath, tautness, type GapProfile,
} from '../src/clean/flossgeo';
import { FLOSS, flossHook, flossMove, newFloss, type FlossEvent } from '../src/clean/floss';

// ---------------------------------------------------------------- a synthetic gap: two convex incisors

/** Two teeth 0.5 wide either side of the gap, labial faces bulging to n = 0.32, nothing between them. */
function incisorGap(): GapProfile {
  const tA = -0.25, tB = 0.25, w = 0.5;
  const ts: number[] = [], depth: number[] = [];
  for (let t = -0.9; t <= 0.9 + 1e-9; t += 0.04) {
    ts.push(+t.toFixed(4));
    const inA = Math.abs(t - tA) < w / 2 - 0.01, inB = Math.abs(t - tB) < w / 2 - 0.01;
    // neighbours beyond (the arch curves back): a little lower
    const inC = t < -0.51 || t > 0.51;
    if (inA) depth.push(0.32 - 1.6 * (t - tA) ** 2);
    else if (inB) depth.push(0.32 - 1.6 * (t - tB) ** 2);
    else if (inC) depth.push(0.22 - 1.2 * (Math.abs(t) - 0.75) ** 2);
    else depth.push(-Infinity);
  }
  return { ts, depth, tA, tB, wA: w, wB: w, hEdge: 1.0, hGum: 0.36, bracket: false };
}

const depthRaw = (p: GapProfile, t: number) => {
  // the raw sampled surface (no envelope), for the "in front of the teeth" check
  let best = -Infinity;
  for (let i = 0; i < p.ts.length; i++) if (Math.abs(p.ts[i] - t) <= 0.021) best = Math.max(best, p.depth[i]);
  return best;
};

describe('floss string geometry (flossgeo)', () => {
  const p = incisorGap();
  const env = envelope(p);

  it('the envelope bridges the gap in front of both teeth', () => {
    for (let i = 0; i < p.ts.length; i++) {
      expect(Number.isFinite(env[i])).toBe(true);
      if (Number.isFinite(p.depth[i])) expect(env[i]).toBeGreaterThanOrEqual(p.depth[i]);
    }
    // across the gap the string passes at least as far out as the tooth surfaces next to it
    let near = -Infinity;
    for (let i = 0; i < p.ts.length; i++) if (Math.abs(p.ts[i]) <= STRING.bridge - 0.01) near = Math.max(near, p.depth[i]);
    expect(depthAt(p, env, 0)).toBeGreaterThanOrEqual(near);
  });

  const cases: { s: number; bend: number; taut: number }[] = [];
  for (const s of [-0.3, 0, 0.15, FLOSS.contact, 0.5, 0.8, 1]) for (const bend of [-1, 0, 0.6]) for (const taut of [0, 0.5, 1]) cases.push({ s, bend, taut });

  it('is one continuous curve: no split, no hole, no jumps between neighbouring points', () => {
    for (const c of cases) {
      const path = stringPath(p, env, c.s, c.bend, c.taut, 33);
      expect(path.pts).toHaveLength(33);
      const seg: number[] = [];
      for (let i = 1; i < path.pts.length; i++) {
        const a = path.pts[i - 1], b = path.pts[i];
        for (const v of [b.t, b.h, b.n]) expect(Number.isFinite(v)).toBe(true);
        expect(b.t).toBeGreaterThan(a.t);                       // runs one way along the arch
        seg.push(Math.hypot(b.t - a.t, b.h - a.h, b.n - a.n));
      }
      // no hole: no segment much longer than the even step along the arch (even in the steepest notch)
      const step = (path.handR.t - path.handL.t) / 32;
      expect(Math.max(...seg)).toBeLessThan(Math.min(0.2, step * 5));
      expect(path.handL).toBe(path.pts[0]);
      expect(path.handR).toBe(path.pts[32]);
    }
  });

  it('always lies in front of the teeth (outward side), never inside or behind them', () => {
    for (const c of cases) {
      for (const q of stringPath(p, env, c.s, c.bend, c.taut, 65).pts) {
        expect(q.n).toBeGreaterThanOrEqual(depthAt(p, env, q.t) + STRING.margin - 1e-9);
        expect(q.n).toBeGreaterThan(depthRaw(p, q.t));
      }
    }
  });

  it('never goes below the visible gumline', () => {
    for (const c of cases) for (const q of stringPath(p, env, c.s, c.bend, c.taut, 65).pts) expect(q.h).toBeGreaterThanOrEqual(p.hGum - 1e-9);
  });

  it('at s = 0 it lies across the biting edges; pushing slides it toward the gum and dips a notch into the gap', () => {
    const flat = stringPath(p, env, 0, 0, 0.5);
    for (const q of flat.pts) expect(q.h).toBeCloseTo(p.hEdge, 9);
    let prevLow = p.hEdge + 1;
    for (const s of [0.2, FLOSS.contact, 0.6, 1]) {
      const path = stringPath(p, env, s, 0, 1);
      const low = Math.min(...path.pts.map((q) => q.h));
      expect(low).toBeLessThan(prevLow);                          // deeper as s grows
      expect(path.mid.h).toBeCloseTo(heightAt(p, s), 9);
      // the lowest point is at the gap and the sides (over the face centres) are higher: a V / U notch
      const lowest = path.pts.reduce((b, q) => (q.h < b.h ? q : b));
      expect(Math.abs(lowest.t)).toBeLessThan(0.08);
      const side = (t: number) => path.pts.reduce((b, q) => (Math.abs(q.t - t) < Math.abs(b.t - t) ? q : b)).h;
      const dip = 0.6 * s * (p.hEdge - p.hGum) * (1 - STRING.sideDip);
      expect(side(p.tA) - low).toBeGreaterThan(dip);
      expect(side(p.tB) - low).toBeGreaterThan(dip);
      prevLow = low;
    }
    // at the gum the notch bottom sits on the papilla, not under it
    expect(stringPath(p, env, 1, 0, 1).mid.h).toBeCloseTo(p.hGum, 9);
  });

  it('pulled above the edge it floats above the teeth, it does not wrap under them', () => {
    const path = stringPath(p, env, -0.3, 0, 0.3);
    for (const q of path.pts) expect(q.h).toBeGreaterThan(p.hEdge);
  });

  it('holds the fingertips close to the neighbouring teeth at the string height, just out in front', () => {
    for (const bend of [-1, 0, 1]) {
      const path = stringPath(p, env, 0.5, bend, 1);
      expect(Math.abs(path.handL.t - (p.tA - p.wA / 2))).toBeLessThan(0.25);
      expect(Math.abs(path.handR.t - (p.tB + p.wB / 2))).toBeLessThan(0.25);
      for (const h of [path.handL, path.handR]) {
        const out = h.n - depthAt(p, env, h.t);
        expect(out).toBeGreaterThan(0.08);
        expect(out).toBeLessThan(0.25);
        expect(h.h).toBeGreaterThan(heightAt(p, 0.5));          // at the side height, above the notch
      }
    }
  });

  it('a sideways bend moves the notch a little, never off the gap', () => {
    const l = stringPath(p, env, 0.5, -1, 1).mid.t, r = stringPath(p, env, 0.5, 1, 1).mid.t;
    expect(l).toBeLessThan(0); expect(r).toBeGreaterThan(0);
    expect(Math.max(-l, r)).toBeLessThan(0.12);
  });

  it('drawn depth follows the state: pressure presses into the contact, pull lifts it back out', () => {
    const st = newFloss();
    flossHook(st, false, false);
    expect(drawnDepth(st)).toBe(0);
    st.s = FLOSS.contact; st.pressure = 0.8;
    expect(drawnDepth(st)).toBeGreaterThan(FLOSS.contact);
    st.phase = 'through'; st.pressure = 0; st.s = FLOSS.contact; st.pull = 1;
    expect(drawnDepth(st)).toBeLessThan(0);                       // out past the biting edge
    expect(tautness({ phase: 'through', pressure: 0, pull: 0, bend: 0 })).toBeGreaterThan(tautness({ phase: 'above', pressure: 0, pull: 0, bend: 0 }));
  });
});

// ---------------------------------------------------------------- input axes from the current projection

/** Screen px of a world point for a camera (1000 x 800 canvas). */
function px(cam: THREE.PerspectiveCamera, w: THREE.Vector3) {
  const v = w.clone().project(cam);
  return { x: (v.x * 0.5 + 0.5) * 1000, y: (-v.y * 0.5 + 0.5) * 800 };
}
function camera(pos: [number, number, number], target: [number, number, number], roll = 0) {
  const c = new THREE.PerspectiveCamera(38, 1000 / 800, 0.1, 100);
  c.position.set(...pos);
  c.lookAt(new THREE.Vector3(...target));
  if (roll) c.rotateZ(roll);
  c.updateMatrixWorld();
  return c;
}
// the lower central gap: edge at y -1.1, visible gumline at y -1.7; the upper one mirrored
const LOWER = { edge: new THREE.Vector3(0, -1.1, 3.0), gum: new THREE.Vector3(0, -1.7, 3.0) };
const UPPER = { edge: new THREE.Vector3(0, 1.1, 3.0), gum: new THREE.Vector3(0, 1.7, 3.0) };
const FRONT = camera([0, 1.6, 12.6], [0, -0.1, 0.8]);

describe('floss input axes (screenAxis / splitStep)', () => {
  it('Front view: pushing toward the gum is dragging DOWN for lower teeth and UP for upper teeth', () => {
    const lo = screenAxis(px(FRONT, LOWER.edge), px(FRONT, LOWER.gum), 56);
    const up = screenAxis(px(FRONT, UPPER.edge), px(FRONT, UPPER.gum), 56);
    expect(lo.y).toBeGreaterThan(0.95);
    expect(up.y).toBeLessThan(-0.95);
    expect(splitStep(lo, 0, 20).along).toBeGreaterThan(0);        // drag down: toward the lower gum
    expect(splitStep(up, 0, 20).along).toBeLessThan(0);           // drag down: away from the upper gum
    expect(splitStep(up, 0, -20).along).toBeGreaterThan(0);       // drag up: toward the upper gum
  });

  it('follows whatever the projection says (Lower view from above, a rolled camera)', () => {
    const lowerView = camera([0, 4.5, 10], [0, -1.15, 0.4]);
    const ax = screenAxis(px(lowerView, LOWER.edge), px(lowerView, LOWER.gum), 20);
    expect(ax.y).toBeGreaterThan(0.9);
    const rolled = camera([0, 1.6, 12.6], [0, -0.1, 0.8], Math.PI / 2);
    const r = screenAxis(px(rolled, LOWER.edge), px(rolled, LOWER.gum), 20);
    expect(Math.abs(r.x)).toBeGreaterThan(0.95);                  // the gap now runs across the screen
    const toward = splitStep(r, r.x * 30, r.y * 30);
    expect(toward.along).toBeGreaterThan(0);
    expect(Math.abs(toward.cross)).toBeLessThan(1e-9);
  });

  it('recomputed from the current camera: a stale hook-time axis would send the drag sideways', () => {
    // hook in the Front view, then the camera glides to a focus that sees the gap at an angle
    const atHook = screenAxis(px(FRONT, LOWER.edge), px(FRONT, LOWER.gum), 56);
    const glided = camera([4, 2.5, 8], [0, -1.3, 2.5], 0.6);
    const now = screenAxis(px(glided, LOWER.edge), px(glided, LOWER.gum), 56, atHook);
    // the player drags along the gap as they see it now
    const dx = now.x * 30, dy = now.y * 30;
    const fresh = splitStep(now, dx, dy), stale = splitStep(atHook, dx, dy);
    expect(fresh.along).toBeGreaterThan(0.45 * 30 / now.len);
    expect(Math.abs(fresh.cross)).toBeLessThan(1e-9);
    expect(Math.abs(stale.cross)).toBeGreaterThan(0.2);            // what the old code saw: a sideways drag
  });

  it('scales by the on-screen gap length with a floor, caps a jump, and survives a degenerate projection', () => {
    const a = screenAxis({ x: 100, y: 100 }, { x: 100, y: 300 }, 56);
    expect(a.len).toBe(200);
    expect(splitStep(a, 0, 50).along).toBeCloseTo(0.25, 9);
    const tiny = screenAxis({ x: 100, y: 100 }, { x: 100, y: 120 }, 56);
    expect(tiny.len).toBe(56);
    expect(splitStep(a, 0, 5000).along).toBeCloseTo(0.35, 9);    // capped per step
    const flat = screenAxis({ x: 10, y: 10 }, { x: 11, y: 10 }, 56, a);
    expect(flat.x).toBe(a.x); expect(flat.y).toBe(a.y);          // looking down the tooth: keep the last axis
  });
});

describe('floss state machine: no accidental unhook while sawing', () => {
  const glide = (st: ReturnType<typeof newFloss>, along: number, cross: number, steps = 20) => {
    const out: FlossEvent[] = [];
    for (let i = 0; i < steps; i++) flossMove(st, along / steps, cross, out);
    return out;
  };

  it('a saw stroke that overshoots the contact still counts and stays hooked', () => {
    const st = newFloss();
    flossHook(st, false, false);
    glide(st, FLOSS.contact + 0.3, 0);
    expect(st.phase).toBe('through');
    const out: FlossEvent[] = [];
    // strokes centred near the contact: half of each goes above it
    for (let k = 0; k < 3; k++) { out.push(...glide(st, -0.3, 0)); out.push(...glide(st, 0.3, 0)); }
    expect(st.phase).toBe('through');
    expect(out).not.toContain('zip');
    expect(out.filter((e) => e === 'stroke').length).toBeGreaterThanOrEqual(4);
  });

  it('zips out only when pulled back past the biting edge', () => {
    const st = newFloss();
    flossHook(st, false, false);
    glide(st, FLOSS.contact + 0.3, 0);
    const s0 = st.s;
    const a = glide(st, -(s0 - FLOSS.contact) - FLOSS.contact * 0.8, 0);   // still below the edge
    expect(a).not.toContain('zip');
    expect(st.phase).toBe('through');
    const b = glide(st, -0.4, 0);
    expect(b).toContain('zip');
    expect(st.phase).toBe('idle');
  });

  it('big sideways motion bows and creaks but never moves or unhooks the string', () => {
    const st = newFloss();
    flossHook(st, false, false);
    glide(st, 0.2, 0);
    const s = st.s;
    const out: FlossEvent[] = [];
    for (const c of [0.5, 1.4, -1.4, 0.3, 0]) out.push(...glide(st, 0, c, 5));
    expect(st.phase).toBe('above');
    expect(st.s).toBe(s);
    expect(out).toContain('creak');
  });
});
