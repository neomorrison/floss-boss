// The dirt model of a hands-on clean: pure logic, no three.js, no DOM (DESIGN 5.2 to 5.5).
//
// Every tooth carries three DIRT_GU x DIRT_GV layers in tooth-local cylindrical space:
//   u around the tooth (0.5 = outward face, 0 / 1 = tongue side), v from gumline (0) to biting edge (1).
// Tools act through an elliptical brush: a cell is inside the brush when its point on an idealized
// crown (an elliptic cylinder with a domed top, sized by TOOTH_DIMS) lies within the brush radius of
// the hit point, so the brush keeps its size in mouth units on every tooth and on the biting surface.
//
// The scene feeds hits (tooth, u, v) plus stroke lengths or dt; the model mutates itself and pushes
// discrete events (pops, dings, gags...) into `model.events`, which the scene drains every frame.
import { DIRT_GU, DIRT_GV, OCCLUSAL_V, TARTAR_HP } from '../core/constants';
import type { CleanResult, CleanSetup, ToolSlot, ToothKind } from '../core/types';
import { layoutTeeth, reachable, TEETH_PER_ARCH, TOOTH_COUNT, type ToothPlacement } from '../core/mouth';
import { clamp, hashSeed, makeRng, type Rng } from '../core/rng';
import { toolTier, type ToolTier } from '../data/tools';

export const CELLS = DIRT_GU * DIRT_GV;

/** Tunable rates. Stroke lengths are in mouth units (1 unit ~ 8 mm) measured on the tooth surface. */
export const RATES = {
  brushScaler: 0.17,        // hand scaler / ultrasonic brush radius (mouth units, x tool radius)
  brushPolisher: 0.3,
  brushFloss: 0.16,
  tartarStroke: 0.75,       // tartar hp per unit of stroke per tartar power (DESIGN: strokeLen * 6 at 1/8 scale)
  plaqueStroke: 3.0,        // plaque per unit of stroke per plaque power (DESIGN 5.3)
  strokeCap: 2.6,           // counted stroke speed cap (units per second): frantic scrubbing does not help
  ultrasonicTartar: 0.5,    // hp per second per tartar power while touching
  ultrasonicPlaque: 0.7,
  polishPlaque: 1.4,        // per second per plaque power under the cup centre
  polishStain: 1.3,
  polishGain: 1.3,          // polish per second per polish power (cells with plaque and stain < 0.15 only)
  polishClean: 0.15,
  waterFloss: 0.9,          // debris hp per second per floss power (water flosser)
  flossPlaque: 0.9,         // interproximal plaque removed per swipe
  flossStrip: 0.14,         // half-width in u of the interproximal strip a swipe cleans
  tartarReach: 0.19,        // deposit radius in mouth units at size 1
  bitSuckRadius: 0.95,      // suction pickup radius (x tool radius)
  bitWashRadius: 1.1,       // rinse spray radius
  washTime: 0.3,            // seconds of spray to wash a loose bit into the water
  washedDrain: 5,           // washed bits removed per unit of drain
  hitChunk: 0.14,           // tartar damage per "hit" (crunch + flakes)
  cleanEps: 0.06,           // a cell counts as clean below this
  comboWindow: 2.6,         // seconds between pops to keep a combo
};

export const GUM_CONTACT_DELAY = 0.15;
export const GAG_SECONDS = 2.5;
export const REASSURE_COOLDOWN = 12;
export const REASSURE_AMOUNT = 12;
export const WATER_DISCOMFORT = 0.6;

// ------------------------------------------------------------------ types

export interface ToothDirt {
  index: number;
  kind: ToothKind;
  arch: 'upper' | 'lower';
  present: boolean;
  plaque: Float32Array;
  stain: Float32Array;
  polish: Float32Array;
  reach: Uint8Array;
  reachCount: number;
  plaque0: number;          // initial sums
  stain0: number;
  /** Set when any layer changed; the scene uploads the texture and clears it. */
  changed: boolean;
  startedDirty: boolean;
  sparkled: boolean;        // tooth-clean ding already awarded
  uFront: number;           // the u that faces the front camera
}

export interface TartarDeposit {
  id: number;
  tooth: number;
  u: number; v: number;
  size: number;
  hp: number; hp0: number;
  variant: 0 | 1 | 2;
  popped: boolean;
  hitAcc: number;           // damage since the last hit event
  lastHit: number;          // model time of the last damage
}

export type DebrisKind = 'popcorn' | 'spinach' | 'seed' | 'candy';
export interface Debris {
  id: number;
  a: number; b: number;     // tooth indices (b = a + 1, same arch)
  kind: DebrisKind;
  v: number;                // height of the wedge along the teeth (0 gumline, 1 edge)
  hp: number; hp0: number;
  popped: boolean;
  lastHit: number;
}

export interface LooseBit {
  id: number;
  x: number; y: number; z: number;   // mouth space
  state: 'loose' | 'washed' | 'gone';
  wash: number;
  from: number;             // tartar deposit id
}

export type CleanEvent =
  | { type: 'tartarHit'; dep: TartarDeposit }
  | { type: 'tartarPop'; dep: TartarDeposit; combo: number; bits: LooseBit[] }
  | { type: 'debrisHit'; deb: Debris }
  | { type: 'debrisPop'; deb: Debris; combo: number }
  | { type: 'toothClean'; tooth: number }
  | { type: 'bitSucked'; bit: LooseBit }
  | { type: 'bitWashed'; bit: LooseBit }
  | { type: 'ow' }
  | { type: 'gag' }
  | { type: 'chat'; line: string; closesJaw: boolean }
  | { type: 'reassure'; amount: number }
  | { type: 'walkout' };

export interface CleanModel {
  setup: CleanSetup;
  placements: ToothPlacement[];
  teeth: ToothDirt[];
  tartar: TartarDeposit[];
  debris: Debris[];
  bits: LooseBit[];
  bitsCreated: number;
  water: number;
  // comfort
  comfort: number;
  gumTime: number;
  gumHurting: boolean;
  gumHits: number;
  molarTime: number;
  molarIdle: number;
  gags: number;
  jawClosed: number;        // seconds left of a closed jaw (gag or chat): tools disabled
  chatTimer: number;
  lineTimer: number;
  reassureCd: number;
  lastHurt: number;         // model time of the last gum hurt
  walkout: boolean;
  // progress
  time: number;             // seconds of active (unpaused) clean time
  chunks: number;
  combo: number;
  bestCombo: number;
  lastPop: number;
  washedAcc: number;
  events: CleanEvent[];
  rng: Rng;                 // runtime randomness (chat timing, bit scatter); spawn used its own stream
  nextId: number;
  totalTartarHp: number;
  totalDebrisHp: number;
}

// ------------------------------------------------------------------ geometry helpers

const cellU = new Float32Array(CELLS);
const cellV = new Float32Array(CELLS);
for (let iv = 0; iv < DIRT_GV; iv++) {
  for (let iu = 0; iu < DIRT_GU; iu++) {
    const i = iv * DIRT_GU + iu;
    cellU[i] = (iu + 0.5) / DIRT_GU;
    cellV[i] = (iv + 0.5) / DIRT_GV;
  }
}
export const cellIndex = (iu: number, iv: number) => iv * DIRT_GU + iu;
export const cellCenterU = (i: number) => cellU[i];
export const cellCenterV = (i: number) => cellV[i];

/** Idealized crown point for (u, v) of a tooth of size w x h x d (tooth-local space). */
export function idealPoint(u: number, v: number, w: number, h: number, d: number, out: { x: number; y: number; z: number }) {
  const th = (u - 0.5) * Math.PI * 2;
  let k = 1;
  let y = v * h;
  if (v > OCCLUSAL_V) {
    // biting surface: move toward the axis as v -> 1, stay near the top
    k = Math.max(0, (1 - v) / (1 - OCCLUSAL_V));
    y = h * (OCCLUSAL_V + (1 - OCCLUSAL_V) * 0.35 * (1 - k));
  } else {
    // slight crown bulge
    k = 0.9 + 0.1 * Math.sin(Math.min(1, v / OCCLUSAL_V) * Math.PI);
  }
  out.x = Math.sin(th) * (w / 2) * k;
  out.y = y;
  out.z = Math.cos(th) * (d / 2) * k;
  return out;
}

/** Per tooth: idealized cell positions (x, y, z interleaved), built once per placement size. */
const cellPosCache = new Map<string, Float32Array>();
function cellPositions(p: ToothPlacement): Float32Array {
  const key = `${p.width}|${p.height}|${p.depth}`;
  let arr = cellPosCache.get(key);
  if (!arr) {
    arr = new Float32Array(CELLS * 3);
    const o = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < CELLS; i++) {
      idealPoint(cellU[i], cellV[i], p.width, p.height, p.depth, o);
      arr[i * 3] = o.x; arr[i * 3 + 1] = o.y; arr[i * 3 + 2] = o.z;
    }
    cellPosCache.set(key, arr);
  }
  return arr;
}

/** The u of a tooth that faces the default front camera (+Z). Upper teeth are flipped about Z. */
export function frontU(p: ToothPlacement): number {
  const lx = -Math.sin(p.yaw) * (p.arch === 'upper' ? -1 : 1);
  const lz = Math.cos(p.yaw);
  return Math.atan2(lx, lz) / (Math.PI * 2) + 0.5;
}

/** The u on tooth `index` facing its neighbour `other` in the same arch. */
export function sideU(p: ToothPlacement, other: number): number {
  const towardNext = other > p.index;
  // lower teeth: local +X points along increasing index (u 0.75); upper teeth are flipped
  const plusX = p.arch === 'lower' ? towardNext : !towardNext;
  return plusX ? 0.75 : 0.25;
}

// small deterministic value noise for spawn patterns
function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise2(seed: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash2(seed, xi, yi), b = hash2(seed, xi + 1, yi);
  const c = hash2(seed, xi, yi + 1), d = hash2(seed, xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
// ------------------------------------------------------------------ spawn

function gauss(x: number, c: number, w: number): number { const d = (x - c) / w; return Math.exp(-d * d); }

/** Pick the threshold so that `frac` of the scores are above it. */
function quantileThreshold(scores: number[], frac: number): number {
  if (!scores.length || frac <= 0) return Infinity;
  if (frac >= 1) return -Infinity;
  const s = scores.slice().sort((a, b) => b - a);
  const k = Math.max(0, Math.min(s.length - 1, Math.round(frac * s.length) - 1));
  return s[k];
}

export function createModel(setup: CleanSetup): CleanModel {
  const placements = layoutTeeth();
  const srng = makeRng(setup.seed);
  const missing = new Set(setup.missingTeeth);
  const teeth: ToothDirt[] = placements.map((p) => {
    const reach = new Uint8Array(CELLS);
    let rc = 0;
    for (let i = 0; i < CELLS; i++) { if (reachable(p.kind, cellU[i], cellV[i])) { reach[i] = 1; rc++; } }
    return {
      index: p.index, kind: p.kind, arch: p.arch, present: !missing.has(p.index),
      plaque: new Float32Array(CELLS), stain: new Float32Array(CELLS), polish: new Float32Array(CELLS),
      reach, reachCount: rc, plaque0: 0, stain0: 0, changed: true, startedDirty: false, sparkled: false,
      uFront: frontU(p),
    };
  });

  spawnLayer(teeth, placements, srng, 'plaque', clamp(setup.dirt.plaque * 0.45, 0, 1), setup);
  spawnLayer(teeth, placements, srng, 'stain', clamp(setup.dirt.stain * 0.35, 0, 1), setup);

  const tartar = spawnTartar(teeth, placements, srng, setup);
  const debris = spawnDebris(teeth, srng, setup);

  for (const t of teeth) {
    let ps = 0, ss = 0;
    for (let i = 0; i < CELLS; i++) { ps += t.plaque[i]; ss += t.stain[i]; }
    t.plaque0 = ps; t.stain0 = ss;
  }
  for (const d of tartar) teeth[d.tooth].startedDirty = true;
  for (const t of teeth) if (t.plaque0 > 0.5 || t.stain0 > 0.5) t.startedDirty = true;

  const rng = makeRng(hashSeed(setup.seed, 'clean-runtime'));
  const m: CleanModel = {
    setup, placements, teeth, tartar, debris, bits: [], bitsCreated: 0, water: 0,
    comfort: clamp(setup.traits.comfortStart, 0, 100),
    gumTime: 0, gumHurting: false, gumHits: 0, molarTime: 0, molarIdle: 0, gags: 0, jawClosed: 0,
    chatTimer: setup.traits.chatty ? rng.range(10, 16) : Infinity,
    lineTimer: rng.range(14, 22),
    reassureCd: 0, lastHurt: -99, walkout: false,
    time: 0, chunks: 0, combo: 0, bestCombo: 0, lastPop: -99, washedAcc: 0,
    events: [], rng, nextId: 1,
    totalTartarHp: tartar.reduce((s, d) => s + d.hp0, 0),
    totalDebrisHp: debris.reduce((s, d) => s + d.hp0, 0),
  };
  m.nextId = 1 + tartar.length + debris.length;
  return m;
}

function spawnLayer(teeth: ToothDirt[], placements: ToothPlacement[], rng: Rng, layer: 'plaque' | 'stain', frac: number, setup: CleanSetup) {
  if (frac <= 0) return;
  const seed = rng.int(1, 2 ** 30);
  const bands = layer === 'stain' && (setup.patient.archetype === 'coffee' || setup.patient.archetype === 'smoker');
  const scores: number[] = [];
  const perTooth: Float32Array[] = [];
  for (const t of teeth) {
    const sc = new Float32Array(CELLS).fill(-Infinity);
    perTooth.push(sc);
    if (!t.present) continue;
    const p = placements[t.index];
    const front = p.kind === 'incisor' || p.kind === 'canine';
    const lowerFront = p.arch === 'lower' && front;
    const back = p.kind === 'molar' || p.kind === 'premolar';
    let mult = rng.range(0.55, 1.45);
    if (layer === 'plaque' && (lowerFront || p.kind === 'molar')) mult *= 1.25;
    if (layer === 'stain' && bands && front) mult *= 1.5;
    const cU = 0.5 * (0.5 + t.uFront);
    const tseed = seed + t.index * 7919;
    for (let i = 0; i < CELLS; i++) {
      if (!t.reach[i]) continue;
      const u = cellU[i], v = cellV[i];
      const occ = v >= OCCLUSAL_V && back;
      let s: number;
      const n = wrapNoise(tseed, u, v, layer === 'plaque' ? 7 : 9, layer === 'plaque' ? 4 : 5);
      if (layer === 'plaque') {
        // a buttery band just above the gum edge, and down the sides where neighbours meet
        const gum = gauss(v, 0.13, 0.13) + 0.4 * Math.exp(-v / 0.06);
        const side = gauss(u, 0.3, 0.05) + gauss(u, 0.7, 0.05) + 0.5 * (gauss(u, 0.22, 0.04) + gauss(u, 0.78, 0.04));
        s = 1.0 * gum + 0.75 * side + (occ ? 0.45 : 0) + 0.9 * n;
      } else {
        const face = gauss(u, cU, 0.15);
        const band = bands && front ? gauss(v, 0.32, 0.14) * (u > 0.3 && u < 0.7 ? 1 : 0.3) : 0;
        s = 0.7 * face + (occ ? 0.9 : 0) + 1.1 * band + 1.2 * n;
      }
      s *= mult;
      sc[i] = s;
      scores.push(s);
    }
  }
  const thr = quantileThreshold(scores, frac);
  if (!isFinite(thr)) {
    if (thr === -Infinity) for (const t of teeth) if (t.present) for (let i = 0; i < CELLS; i++) if (t.reach[i]) t[layer][i] = 1;
    return;
  }
  let max = thr;
  for (const s of scores) if (s > max) max = s;
  const span = Math.max(1e-6, max - thr);
  for (const t of teeth) {
    const sc = perTooth[t.index];
    const arr = t[layer];
    for (let i = 0; i < CELLS; i++) {
      const s = sc[i];
      if (s >= thr && s > -Infinity) arr[i] = clamp(0.6 + ((s - thr) / span) * 1.4, 0.6, 1);
    }
  }
}

function wrapNoise(seed: number, u: number, v: number, fu: number, fv: number): number {
  // blend two samples so u = 0 and u = 1 agree (seamless around the tooth)
  const a = noise2(seed, u * fu, v * fv) * 0.65 + noise2(seed + 17, u * fu * 2.1, v * fv * 2.1) * 0.35;
  const b = noise2(seed, (u + 1) * fu, v * fv) * 0.65 + noise2(seed + 17, (u + 1) * fu * 2.1, v * fv * 2.1) * 0.35;
  return a * (1 - u) + b * u;
}

function spawnTartar(teeth: ToothDirt[], placements: ToothPlacement[], rng: Rng, setup: CleanSetup): TartarDeposit[] {
  const count = Math.max(0, Math.round(setup.dirt.tartarCount));
  const out: TartarDeposit[] = [];
  const present = teeth.filter((t) => t.present);
  if (!present.length) return out;
  const weight = (t: ToothDirt) => {
    const p = placements[t.index];
    if (p.arch === 'lower' && (p.kind === 'incisor' || p.kind === 'canine')) return 4;
    if (p.arch === 'upper' && p.kind === 'molar') return 3;
    return 1;
  };
  let id = 1;
  for (let k = 0; k < count; k++) {
    let tooth: ToothDirt;
    let u = 0.5, v = 0.15;
    let ok = false;
    for (let attempt = 0; attempt < 10 && !ok; attempt++) {
      tooth = (setup.tutorial && k === 0) ? teeth[TEETH_PER_ARCH + 7].present ? teeth[TEETH_PER_ARCH + 7] : rng.weighted(present, weight) : rng.weighted(present, weight);
      const p = placements[tooth.index];
      const cU = 0.5 * (0.5 + tooth.uFront);
      u = clamp(cU + rng.normal(0, 0.1), 0.27, 0.73);
      v = rng.range(0.07, 0.25);
      if (setup.tutorial && k === 0) { u = tooth.uFront; v = 0.15; }
      const circ = Math.PI * (p.width + p.depth) / 2;
      ok = !out.some((d) => d.tooth === tooth.index && Math.hypot((d.u - u) * circ, (d.v - v) * p.height) < 0.3);
      if (ok || attempt === 9) {
        const size = Math.max(0.35, setup.dirt.tartarSize * rng.range(0.75, 1.25));
        out.push({ id: id++, tooth: tooth.index, u, v, size, hp: size * TARTAR_HP, hp0: size * TARTAR_HP, variant: rng.int(0, 2) as 0 | 1 | 2, popped: false, hitAcc: 0, lastHit: -99 });
        ok = true;
      }
    }
  }
  return out;
}

const DEBRIS_HP: Record<DebrisKind, number> = { popcorn: 3, spinach: 2, seed: 1, candy: 2 };

function spawnDebris(teeth: ToothDirt[], rng: Rng, setup: CleanSetup): Debris[] {
  const count = Math.max(0, Math.round(setup.dirt.debrisCount));
  const gaps: { a: number; b: number; w: number }[] = [];
  for (let arch = 0; arch < 2; arch++) {
    for (let pos = 0; pos < TEETH_PER_ARCH - 1; pos++) {
      const a = arch * TEETH_PER_ARCH + pos;
      if (!teeth[a].present || !teeth[a + 1].present) continue;
      gaps.push({ a, b: a + 1, w: pos >= 2 && pos <= 10 ? 3 : 1 });
    }
  }
  const out: Debris[] = [];
  const kinds: DebrisKind[] = ['popcorn', 'spinach', 'seed', 'candy'];
  const kid = setup.patient.archetype === 'kid';
  for (let k = 0; k < count && gaps.length; k++) {
    let g = rng.weighted(gaps, (x) => x.w);
    let kind = rng.weighted(kinds, (x) => (x === 'candy' ? (kid ? 5 : 1.5) : x === 'popcorn' ? 3 : 2));
    if (setup.tutorial && k === 0) {
      const want = gaps.find((x) => x.a === TEETH_PER_ARCH + 5) || gaps.find((x) => x.a === 5) || g;
      g = want; kind = 'popcorn';
    }
    gaps.splice(gaps.indexOf(g), 1);
    const hp = DEBRIS_HP[kind];
    out.push({ id: 1000 + k, a: g.a, b: g.b, kind, v: rng.range(0.3, 0.5), hp, hp0: hp, popped: false, lastHit: -99 });
  }
  return out;
}

// ------------------------------------------------------------------ brush

const tmpP = { x: 0, y: 0, z: 0 };

/**
 * Visit cells of `tooth` inside a brush of radius R (mouth units) around (u, v); fn(cell, falloff 0..1).
 * Returns the number of cells visited.
 */
export function forBrush(m: CleanModel, tooth: number, u: number, v: number, R: number, fn: (i: number, f: number) => void): number {
  const t = m.teeth[tooth];
  if (!t || !t.present) return 0;
  const p = m.placements[tooth];
  const pos = cellPositions(p);
  idealPoint(u, v, p.width, p.height, p.depth, tmpP);
  const R2 = R * R;
  let n = 0;
  for (let i = 0; i < CELLS; i++) {
    if (!t.reach[i]) continue;
    const dx = pos[i * 3] - tmpP.x, dy = pos[i * 3 + 1] - tmpP.y, dz = pos[i * 3 + 2] - tmpP.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= R2) continue;
    fn(i, 1 - d2 / R2);
    n++;
  }
  return n;
}

/** Distance in mouth units between two (u, v) points on the same idealized tooth. */
export function surfaceDistance(m: CleanModel, tooth: number, u1: number, v1: number, u2: number, v2: number): number {
  const p = m.placements[tooth];
  const a = idealPoint(u1, v1, p.width, p.height, p.depth, { x: 0, y: 0, z: 0 });
  const b = idealPoint(u2, v2, p.width, p.height, p.depth, { x: 0, y: 0, z: 0 });
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ------------------------------------------------------------------ tools

export function activeTool(setup: CleanSetup, slot: ToolSlot): ToolTier {
  return toolTier(slot, setup.tools[slot]);
}
export function isUltrasonic(setup: CleanSetup): boolean { return activeTool(setup, 'scaler').timeBased; }

function registerPop(m: CleanModel): number {
  m.combo = m.time - m.lastPop <= RATES.comboWindow ? m.combo + 1 : 1;
  m.lastPop = m.time;
  if (m.combo > m.bestCombo) m.bestCombo = m.combo;
  return m.combo;
}

function damageTartar(m: CleanModel, d: TartarDeposit, dmg: number) {
  if (d.popped || dmg <= 0) return;
  d.hp -= dmg;
  d.hitAcc += dmg;
  d.lastHit = m.time;
  if (d.hp <= 0) {
    d.hp = 0;
    d.popped = true;
    m.chunks++;
    const combo = registerPop(m);
    const bits = spawnBits(m, d);
    m.events.push({ type: 'tartarPop', dep: d, combo, bits });
    checkToothClean(m, d.tooth);
  } else if (d.hitAcc >= RATES.hitChunk) {
    d.hitAcc = 0;
    m.events.push({ type: 'tartarHit', dep: d });
  }
}

function spawnBits(m: CleanModel, d: TartarDeposit): LooseBit[] {
  const p = m.placements[d.tooth];
  const n = d.size >= 1.2 ? 3 : d.size >= 0.8 ? 2 : 1;
  const out: LooseBit[] = [];
  for (let k = 0; k < n; k++) {
    // they tumble inward onto the tongue / floor of the mouth near the tooth
    const inward = m.rng.range(0.4, 0.68);
    const b: LooseBit = {
      id: m.nextId++,
      x: p.x * inward + m.rng.range(-0.35, 0.35),
      y: -1.75,
      z: (p.z - 0.3) * inward + m.rng.range(-0.3, 0.3),
      state: 'loose', wash: 0, from: d.id,
    };
    m.bits.push(b);
    out.push(b);
  }
  m.bitsCreated += n;
  return out;
}

/** Tartar deposits within reach of a brush at (tooth, u, v). */
const tmpA = { x: 0, y: 0, z: 0 };
const tmpB = { x: 0, y: 0, z: 0 };
function depositsNear(m: CleanModel, tooth: number, u: number, v: number, R: number, fn: (d: TartarDeposit, f: number) => void) {
  const p = m.placements[tooth];
  const a = idealPoint(u, v, p.width, p.height, p.depth, tmpA);
  const b = tmpB;
  for (const d of m.tartar) {
    if (d.popped || d.tooth !== tooth) continue;
    idealPoint(d.u, d.v, p.width, p.height, p.depth, b);
    const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const reach = R + RATES.tartarReach * Math.sqrt(d.size);
    if (dist < reach) fn(d, 1 - (dist / reach) * 0.5);
  }
}

export interface ApplyResult { plaque: number; stain: number; polish: number; tartar: number }
const res: ApplyResult = { plaque: 0, stain: 0, polish: 0, tartar: 0 };
function resetRes() { res.plaque = 0; res.stain = 0; res.polish = 0; res.tartar = 0; return res; }

/**
 * Scaler on a tooth. Hand scalers (tiers 1 to 3) act on stroke length `stroke` (mouth units moved on
 * the surface since the last frame); ultrasonic tiers act on time `dt` while touching.
 * Returns the amounts removed this call (shared object, read immediately).
 */
export function applyScaler(m: CleanModel, tooth: number, u: number, v: number, stroke: number, dt: number): ApplyResult {
  const r = resetRes();
  if (m.jawClosed > 0 || m.walkout) return r;
  const tool = activeTool(m.setup, 'scaler');
  const t = m.teeth[tooth];
  if (!t || !t.present) return r;
  const R = RATES.brushScaler * tool.radius;
  let tDmg: number, pAmt: number;
  if (tool.timeBased) {
    tDmg = tool.tartar * m.setup.mods.scalerPower * RATES.ultrasonicTartar * dt;
    pAmt = tool.plaque * RATES.ultrasonicPlaque * dt;
    addWater(m, tool.water * dt);
  } else {
    const s = Math.min(stroke, RATES.strokeCap * Math.max(dt, 1 / 120));
    if (s <= 0) return r;
    tDmg = tool.tartar * m.setup.mods.scalerPower * RATES.tartarStroke * s;
    pAmt = tool.plaque * RATES.plaqueStroke * s;
  }
  depositsNear(m, tooth, u, v, R, (d, f) => { const before = d.hp; damageTartar(m, d, tDmg * f); r.tartar += before - d.hp; });
  forBrush(m, tooth, u, v, R, (i, f) => {
    const before = t.plaque[i];
    if (before <= 0) return;
    const after = Math.max(0, before - pAmt * (0.35 + 0.65 * f));
    t.plaque[i] = after < 0.02 ? 0 : after;
    r.plaque += before - t.plaque[i];
  });
  if (r.plaque > 0 || r.tartar > 0) { t.changed = true; checkToothClean(m, tooth); }
  return r;
}

/** Polisher (time based). `moving` spins faster: 1 when the cup moves, ~0.55 when held still. */
export function applyPolisher(m: CleanModel, tooth: number, u: number, v: number, dt: number, moving = 1): ApplyResult {
  const r = resetRes();
  if (m.jawClosed > 0 || m.walkout) return r;
  const tool = activeTool(m.setup, 'polisher');
  const t = m.teeth[tooth];
  if (!t || !t.present) return r;
  const mods = m.setup.mods;
  const R = RATES.brushPolisher * tool.radius * mods.polishRadius;
  const k = dt * (0.55 + 0.45 * clamp(moving, 0, 1)) * mods.polishSpeed;
  const pA = tool.plaque * RATES.polishPlaque * k;
  const sA = tool.stain * RATES.polishStain * k;
  const gA = tool.polish * RATES.polishGain * k;
  addWater(m, tool.water * dt);
  forBrush(m, tooth, u, v, R, (i, f) => {
    const w = 0.3 + 0.7 * f;
    const p0 = t.plaque[i], s0 = t.stain[i];
    if (p0 > 0) { const p1 = Math.max(0, p0 - pA * w); t.plaque[i] = p1 < 0.02 ? 0 : p1; r.plaque += p0 - t.plaque[i]; }
    if (s0 > 0) { const s1 = Math.max(0, s0 - sA * w); t.stain[i] = s1 < 0.02 ? 0 : s1; r.stain += s0 - t.stain[i]; }
    if (t.plaque[i] < RATES.polishClean && t.stain[i] < RATES.polishClean && t.polish[i] < 1) {
      const g0 = t.polish[i];
      t.polish[i] = Math.min(1, g0 + gA * w);
      r.polish += t.polish[i] - g0;
    }
  });
  if (r.plaque > 0 || r.stain > 0 || r.polish > 0) { t.changed = true; checkToothClean(m, tooth); }
  return r;
}

/** One string-floss swipe across the gap between `a` and `a + 1`: returns true if it hit anything. */
export function flossSwipe(m: CleanModel, a: number, b: number): boolean {
  if (m.jawClosed > 0 || m.walkout) return false;
  const tool = activeTool(m.setup, 'floss');
  const ta = m.teeth[a], tb = m.teeth[b];
  let hit = false;
  for (const d of m.debris) {
    if (d.popped || d.a !== Math.min(a, b) || d.b !== Math.max(a, b)) continue;
    hitDebris(m, d, tool.floss);
    hit = true;
  }
  if (ta?.present) hit = flossPlaque(m, a, b) || hit;
  if (tb?.present) hit = flossPlaque(m, b, a) || hit;
  return hit;
}

function hitDebris(m: CleanModel, d: Debris, dmg: number) {
  if (d.popped) return;
  d.hp -= dmg;
  d.lastHit = m.time;
  if (d.hp <= 1e-6) {
    d.hp = 0;
    d.popped = true;
    const combo = registerPop(m);
    m.events.push({ type: 'debrisPop', deb: d, combo });
    checkToothClean(m, d.a);
    checkToothClean(m, d.b);
  } else {
    m.events.push({ type: 'debrisHit', deb: d });
  }
}

function flossPlaque(m: CleanModel, tooth: number, other: number): boolean {
  const t = m.teeth[tooth];
  const su = sideU(m.placements[tooth], other);
  let removed = 0;
  for (let i = 0; i < CELLS; i++) {
    if (!t.reach[i] || t.plaque[i] <= 0) continue;
    const du = Math.abs(cellU[i] - su);
    if (du > RATES.flossStrip) continue;          // strip from the contact point into the visible side band
    if (cellV[i] > 0.9) continue;
    const before = t.plaque[i];
    t.plaque[i] = Math.max(0, before - RATES.flossPlaque);
    if (t.plaque[i] < 0.02) t.plaque[i] = 0;
    removed += before - t.plaque[i];
  }
  if (removed > 0) { t.changed = true; checkToothClean(m, tooth); }
  return removed > 0;
}

/** Water flosser held at a gap (time based). */
export function applyWaterFloss(m: CleanModel, a: number, b: number, dt: number): boolean {
  if (m.jawClosed > 0 || m.walkout) return false;
  const tool = activeTool(m.setup, 'floss');
  addWater(m, tool.water * dt);
  let hit = false;
  for (const d of m.debris) {
    if (d.popped || d.a !== Math.min(a, b) || d.b !== Math.max(a, b)) continue;
    const before = d.hp;
    d.hp -= tool.floss * RATES.waterFloss * dt;
    d.lastHit = m.time;
    if (d.hp <= 0) { d.hp = before; hitDebris(m, d, before); }
    else if (Math.floor(before * 2) !== Math.floor(d.hp * 2)) m.events.push({ type: 'debrisHit', deb: d });
    hit = true;
  }
  // gentle interproximal plaque removal while the jet runs
  for (const [t, o] of [[a, b], [b, a]] as const) {
    const td = m.teeth[t];
    if (!td?.present) continue;
    const su = sideU(m.placements[t], o);
    let removed = 0;
    for (let i = 0; i < CELLS; i++) {
      if (!td.reach[i] || td.plaque[i] <= 0 || Math.abs(cellU[i] - su) > RATES.flossStrip) continue;
      const b0 = td.plaque[i];
      td.plaque[i] = Math.max(0, b0 - 1.2 * dt);
      removed += b0 - td.plaque[i];
    }
    if (removed > 0) { td.changed = true; checkToothClean(m, t); hit = true; }
  }
  return hit;
}

/** Suction held at a mouth-space point: drains water and picks up loose bits nearby. */
export function applySuction(m: CleanModel, x: number, y: number, z: number, dt: number): number {
  if (m.walkout) return 0;
  const tool = activeTool(m.setup, 'suction');
  const before = m.water;
  m.water = Math.max(0, m.water - tool.drain * dt);
  const R = RATES.bitSuckRadius * tool.radius;
  let got = 0;
  for (const b of m.bits) {
    if (b.state !== 'loose') continue;
    const dx = b.x - x, dz = b.z - z, dy = (b.y - y) * 0.5;
    if (dx * dx + dy * dy + dz * dz < R * R) {
      b.state = 'gone';
      got++;
      m.events.push({ type: 'bitSucked', bit: b });
    }
  }
  // bits already washed into the water drain out with it
  m.washedAcc += dt * tool.drain * tool.bits * RATES.washedDrain;
  while (m.washedAcc >= 1) {
    const b = m.bits.find((q) => q.state === 'washed');
    if (!b) { m.washedAcc = 0; break; }
    b.state = 'gone';
    got++;
    m.washedAcc -= 1;
    m.events.push({ type: 'bitSucked', bit: b });
  }
  return got + (before - m.water);
}

/** Air-water syringe spraying at a mouth-space point. */
export function applyRinse(m: CleanModel, x: number, y: number, z: number, dt: number): void {
  if (m.walkout) return;
  const tool = activeTool(m.setup, 'rinse');
  addWater(m, tool.water * dt);
  const R = RATES.bitWashRadius;
  for (const b of m.bits) {
    if (b.state !== 'loose') continue;
    const dx = b.x - x, dz = b.z - z;
    if (dx * dx + dz * dz < R * R) {
      b.wash += dt;
      if (b.wash >= RATES.washTime) { b.state = 'washed'; m.events.push({ type: 'bitWashed', bit: b }); }
    }
  }
}

export function addWater(m: CleanModel, amount: number) {
  if (amount > 0) m.water = Math.min(1, m.water + amount);
}

// ------------------------------------------------------------------ tooth state

/** Remaining dirt of one tooth, 0 (spotless) .. 1 (as dirty as it started, or worse). */
export function toothDirtLeft(m: CleanModel, tooth: number): number {
  const t = m.teeth[tooth];
  if (!t.present) return 0;
  let p = 0, s = 0;
  for (let i = 0; i < CELLS; i++) { p += t.plaque[i]; s += t.stain[i]; }
  let th = 0, th0 = 0;
  for (const d of m.tartar) if (d.tooth === tooth) { th += d.hp; th0 += d.hp0; }
  let dh = 0, dh0 = 0;
  for (const d of m.debris) if (d.a === tooth || d.b === tooth) { dh += d.hp * 0.5; dh0 += d.hp0 * 0.5; }
  const total0 = t.plaque0 * 0.02 + t.stain0 * 0.02 + th0 * 1.5 + dh0;
  if (total0 <= 0) return 0;
  return clamp((p * 0.02 + s * 0.02 + th * 1.5 + dh) / total0, 0, 1);
}

export function isToothSpotless(m: CleanModel, tooth: number): boolean {
  const t = m.teeth[tooth];
  if (!t.present) return true;
  for (let i = 0; i < CELLS; i++) if (t.plaque[i] > RATES.cleanEps || t.stain[i] > RATES.cleanEps) return false;
  for (const d of m.tartar) if (d.tooth === tooth && !d.popped) return false;
  for (const d of m.debris) if ((d.a === tooth || d.b === tooth) && !d.popped) return false;
  return true;
}

function checkToothClean(m: CleanModel, tooth: number) {
  const t = m.teeth[tooth];
  if (!t || !t.present || t.sparkled || !t.startedDirty) return;
  if (isToothSpotless(m, tooth)) {
    t.sparkled = true;
    m.events.push({ type: 'toothClean', tooth });
  }
}

// ------------------------------------------------------------------ comfort

export interface TickInput {
  dt: number;
  working: boolean;         // a tool is touching the mouth this frame
  molar: boolean;           // touching a molar
  gum: boolean;             // scaler on gum tissue (or a tooth cell with v < 0.02)
  gumRisk: number;          // the active tool's gum risk
  headphones: boolean;
  numbing: boolean;
}

export function tickModel(m: CleanModel, inp: TickInput): void {
  if (m.walkout) return;
  const dt = inp.dt;
  const tr = m.setup.traits;
  const mods = m.setup.mods;
  m.time += dt;
  if (m.jawClosed > 0) m.jawClosed = Math.max(0, m.jawClosed - dt);
  if (m.reassureCd > 0) m.reassureCd = Math.max(0, m.reassureCd - dt);
  if (m.time - m.lastPop > RATES.comboWindow) m.combo = 0;

  let c = m.comfort;
  c -= 0.35 * tr.comfortDrain * (inp.headphones ? 0.75 : 1) * mods.comfortDrain * dt;
  if (m.water > WATER_DISCOMFORT) c -= 3 * dt;

  // gum contact
  const touchingGum = inp.gum && inp.working && m.jawClosed <= 0;
  if (touchingGum) {
    m.gumTime += dt;
    if (m.gumTime >= GUM_CONTACT_DELAY) {
      c -= 8 * inp.gumRisk * tr.gumSensitivity * mods.gumDamage * (inp.numbing ? 0.5 : 1) * dt;
      m.lastHurt = m.time;
      if (!m.gumHurting) { m.gumHurting = true; m.gumHits++; m.events.push({ type: 'ow' }); }
    }
  } else {
    m.gumTime = 0;
    m.gumHurting = false;
  }

  // gag reflex: continuous work on a molar
  if (tr.gag) {
    if (inp.working && inp.molar && m.jawClosed <= 0) { m.molarTime += dt; m.molarIdle = 0; }
    else { m.molarIdle += dt; if (m.molarIdle > 0.5) m.molarTime = 0; }
    if (m.molarTime > GAG_SECONDS + mods.gagDelay) {
      m.molarTime = 0;
      m.gags++;
      c -= 15;
      m.jawClosed = Math.max(m.jawClosed, 1.2);
      m.lastHurt = m.time;
      m.events.push({ type: 'gag' });
    }
  }

  // chatty: a question every 18 to 30 s closes the jaw for 2 s
  m.chatTimer -= dt;
  if (m.chatTimer <= 0) {
    m.chatTimer = m.rng.range(18, 30);
    m.jawClosed = Math.max(m.jawClosed, 2);
    c += 3;
    m.lineTimer = Math.max(m.lineTimer, 8);
    m.events.push({ type: 'chat', line: pickLine(m), closesJaw: true });
  }
  // everyone else says a flavour line now and then (no gameplay effect)
  if (!tr.chatty) {
    m.lineTimer -= dt;
    if (m.lineTimer <= 0) {
      m.lineTimer = m.rng.range(24, 38);
      if (m.setup.lines.length) m.events.push({ type: 'chat', line: pickLine(m), closesJaw: false });
    }
  }

  m.comfort = clamp(c, 0, 100);
  if (m.comfort <= 0) {
    m.walkout = true;
    m.events.push({ type: 'walkout' });
  }
}

function pickLine(m: CleanModel): string {
  const lines = m.setup.lines;
  return lines.length ? lines[Math.floor(m.rng.next() * lines.length)] : 'Mmhm.';
}

/** Reassure the patient. Returns false while on cooldown. */
export function reassure(m: CleanModel): boolean {
  if (m.reassureCd > 0 || m.walkout) return false;
  const amount = REASSURE_AMOUNT * m.setup.mods.reassure;
  m.comfort = clamp(m.comfort + amount, 0, 100);
  m.reassureCd = REASSURE_COOLDOWN;
  m.events.push({ type: 'reassure', amount });
  return true;
}

// ------------------------------------------------------------------ scoring (DESIGN 5.5)

export interface Fractions {
  tartar: number; plaque: number; stain: number; debris: number; polish: number; mess: number; clean: number;
}

export function fractions(m: CleanModel): Fractions {
  let p = 0, p0 = 0, s = 0, s0 = 0, pol = 0, reach = 0;
  for (const t of m.teeth) {
    if (!t.present) continue;
    p0 += t.plaque0; s0 += t.stain0;
    for (let i = 0; i < CELLS; i++) {
      if (!t.reach[i]) continue;
      p += t.plaque[i]; s += t.stain[i]; pol += t.polish[i];
    }
    reach += t.reachCount;
  }
  let th = 0;
  for (const d of m.tartar) th += d.hp;
  let dh = 0;
  for (const d of m.debris) dh += d.hp;
  const tartar = m.totalTartarHp > 0 ? clamp(1 - th / m.totalTartarHp, 0, 1) : 1;
  const debris = m.totalDebrisHp > 0 ? clamp(1 - dh / m.totalDebrisHp, 0, 1) : 1;
  const plaque = p0 > 0 ? clamp(1 - p / p0, 0, 1) : 1;
  const stain = s0 > 0 ? clamp(1 - s / s0, 0, 1) : 1;
  const polish = reach > 0 ? clamp(pol / reach, 0, 1) : 0;
  const left = m.bits.filter((b) => b.state !== 'gone').length;
  const bitFrac = m.bitsCreated > 0 ? left / m.bitsCreated : 0;
  const mess = clamp(0.65 * bitFrac + 0.35 * m.water, 0, 1);
  const clean = clamp(0.35 * tartar + 0.25 * plaque + 0.2 * stain + 0.1 * debris + 0.1 * polish - 0.1 * mess, 0, 1);
  return { tartar, plaque, stain, debris, polish, mess, clean };
}

export function starsFor(quality: number): number {
  return quality >= 0.92 ? 5 : quality >= 0.8 ? 4 : quality >= 0.65 ? 3 : quality >= 0.45 ? 2 : 1;
}

export function qualityFor(clean: number, comfort: number, walkout: boolean): number {
  const q = clamp(0.82 * clean + 0.18 * (comfort / 100), 0, 1);
  return walkout ? Math.min(q, 0.25) : q;
}

/** par = (25 + 3.2*tartarCount*tartarSize + 30*plaque + 25*stain + 4*debrisCount) * parMult */
export function parFor(setup: Pick<CleanSetup, 'dirt' | 'mods'>): number {
  const d = setup.dirt;
  return (25 + 3.2 * d.tartarCount * d.tartarSize + 30 * d.plaque + 25 * d.stain + 4 * d.debrisCount) * setup.mods.parMult;
}

export function scoreClean(m: CleanModel, quit: CleanResult['quit'], seconds: number): CleanResult {
  const f = fractions(m);
  const walkout = quit === 'walkout' || m.walkout;
  const quality = qualityFor(f.clean, m.comfort, walkout);
  return {
    quit: walkout ? 'walkout' : quit,
    tartar: f.tartar, plaque: f.plaque, stain: f.stain, debris: f.debris, polish: f.polish, mess: f.mess,
    clean: f.clean,
    comfort: m.comfort,
    quality,
    stars: walkout ? 1 : starsFor(quality),
    seconds,
    chunks: m.chunks,
    bestCombo: m.bestCombo,
    gumHits: m.gumHits,
    gags: m.gags,
    perfect: !walkout && f.clean >= 0.97,
  };
}

// ------------------------------------------------------------------ debug / cheats

/** Remove `frac` of every dirt layer, pop that share of tartar and debris, tidy that share of the mess. */
export function cheat(m: CleanModel, frac: number): void {
  const f = clamp(frac, 0, 1);
  for (const t of m.teeth) {
    if (!t.present) continue;
    for (let i = 0; i < CELLS; i++) {
      if (!t.reach[i]) continue;
      t.plaque[i] *= 1 - f;
      t.stain[i] *= 1 - f;
      if (t.plaque[i] < 0.02) t.plaque[i] = 0;
      if (t.stain[i] < 0.02) t.stain[i] = 0;
      t.polish[i] = Math.max(t.polish[i], f);
    }
    t.changed = true;
  }
  const tl = m.tartar.filter((d) => !d.popped);
  const nT = Math.round(tl.length * f);
  for (let k = 0; k < nT; k++) damageTartar(m, tl[k], tl[k].hp + 1);
  const dl = m.debris.filter((d) => !d.popped);
  const nD = Math.round(dl.length * f);
  for (let k = 0; k < nD; k++) hitDebris(m, dl[k], dl[k].hp + 1);
  const bl = m.bits.filter((b) => b.state !== 'gone');
  const nB = Math.round(bl.length * f);
  for (let k = 0; k < nB; k++) { bl[k].state = 'gone'; m.events.push({ type: 'bitSucked', bit: bl[k] }); }
  m.water *= 1 - f;
  for (const t of m.teeth) checkToothClean(m, t.index);
}

export function bitsLeft(m: CleanModel): number {
  let n = 0;
  for (const b of m.bits) if (b.state !== 'gone') n++;
  return n;
}

export { TOOTH_COUNT };
