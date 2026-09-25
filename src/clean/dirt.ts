// The dirt model of a hands-on clean (DESIGN 5 v2, "cases, not chores"): pure logic, no three.js, no DOM.
//
// Every tooth carries DIRT_GU x DIRT_GV cells in tooth-local cylindrical space:
//   u around the tooth (0.5 = outward face, 0 / 1 = tongue side), v from gumline (0) to biting edge (1).
// Layers per cell: plaque, stain, polish, paste (prophy paste left by the polisher, only rinse removes it)
// and gel (whitening gel or sealant, painted with the gel brush).
//
// Scope (5.2): only the case's problem teeth carry real dirt, and only on cells a view can see (the outward
// face and the biting surface of back teeth). Other teeth get faint cosmetic plaque that is not scored.
// A problem tooth snaps clean once its tartar is gone and 80% of its plaque and stain is (at most 20% left).
//
// Tools act through an elliptical brush on an idealized crown (an elliptic cylinder with a domed top,
// sized by TOOTH_DIMS), so the brush keeps its size in mouth units on every tooth.
// The scene feeds hits (tooth, u, v) plus stroke lengths or dt; the model mutates itself and pushes
// discrete events into `model.events`, which the controller drains every frame.
import { DIRT_GU, DIRT_GV, OCCLUSAL_V, TARTAR_HP } from '../core/constants';
import type { BonusId, CaseType, CleanObjective, CleanResult, CleanSetup, ToolSlot, ToothKind, TwistId } from '../core/types';
import { layoutTeeth, reachable, TEETH_PER_ARCH, TOOTH_COUNT, type ToothPlacement } from '../core/mouth';
import { clamp, hashSeed, makeRng, type Rng } from '../core/rng';
import { toolTier, type ToolTier } from '../data/tools';
import { pressable } from './reach';

export const CELLS = DIRT_GU * DIRT_GV;
export { TOOTH_COUNT };

/** Tunable rates. Stroke lengths are in mouth units (1 unit ~ 8 mm) measured on the tooth surface. */
export const RATES = {
  brushScaler: 0.17,        // hand scaler / ultrasonic brush radius (mouth units, x tool radius)
  brushPolisher: 0.3,
  brushGel: 0.42,
  tartarStroke: 1.0,        // tartar hp per unit of stroke per tartar power (a lump pops in ~0.8 s of hand-speed scraping)
  plaqueStroke: 3.0,        // plaque per unit of stroke per plaque power
  strokeCap: 2.6,           // counted stroke speed cap (units per second): frantic scrubbing does not help
  ultrasonicTartar: 1.65,   // hp per second per tartar power while touching (always faster than a hand scaler)
  ultrasonicPlaque: 1.6,
  polishPlaque: 1.8,        // per second per plaque power under the cup centre
  polishStain: 1.7,
  polishGain: 1.3,          // polish per second per polish power (cells with plaque and stain < 0.15 only)
  polishClean: 0.15,
  wrapBase: 0.4,            // polisher / gel wrap assist: rate around the crown at the hit height
  wrapMax: 0.7,             // after 1 s on the same tooth
  wrapBand: 0.11,           // half height (v) of the wrap band
  pasteLay: 0.85,           // prophy paste left on polished cells
  gelPaint: 6.0,            // gel per second under the brush centre
  gelBand: 0.22,            // half height (v) of the gel brush wrap band
  gelDone: 0.6,             // share of a tooth's gel target covered for it to count
  waterFloss: 0.9,          // debris hp per second per floss power (water flosser)
  flossPlaque: 0.6,         // interproximal plaque removed per floss stroke
  flossStrip: 0.14,         // half-width in u of the interproximal strip a stroke cleans
  tartarReach: 0.19,        // deposit radius in mouth units at size 1
  bitSuckRadius: 1.5,       // suction pickup radius for floating bits (x tool radius, xz plane)
  bitPull: 3.2,             // floating bits drift toward the suction tip within this radius
  suctionDrain: 1.6,        // x the suction tier's drain rate (the finish is a flourish, not a chore)
  rinseRadius: 3.0,         // rinse cone radius on the teeth (paste and gel wash off): one sweep of a view clears it
  rinseWash: 9,             // paste / gel removed per second at the cone centre
  rinseWater: 0.55,         // share of the syringe's water rate that stays in the mouth (the rest runs off)
  bitWashRadius: 3.4,       // resting bits within this xz radius of the spray float up
  washTime: 0.15,           // seconds of spray to float a resting bit
  hitChunk: 0.14,           // tartar damage per "hit" (crunch + flakes)
  cleanEps: 0.02,
  comboWindow: 2.6,         // seconds between pops to keep a combo
  snapLeft: 0.2,            // a problem tooth snaps once 80% of its plaque and stain is gone (and its tartar)
  areaDone: 0.8,            // area objectives: removing 80% of a tooth's layer counts as all of it
  lastBits: 0.7,            // from 70% done the specks left on a problem tooth pulse ("last bits" glow)
  bandFloor: 0.05,          // dirt starts just above the gum (the first cell row, v ~0.02, stays clean)
  bugSpeed: 0.14,           // sugar bug crawl, surface units per second
  bugFlee: 0.5,             // sidle speed when a tool comes near
  bugFleeRadius: 0.6,
  bugSpread: 6,             // seconds between plaque spreads per live bug
  lampShade: 1.2,           // seconds under the lamp per shade step
  lampZing: 4,              // nonstop seconds on one tooth before it zings
  pocketHold: 0.8,          // seconds of scaler on a pocket to open it
};

export const GUM_CONTACT_DELAY = 0.15;
export const GAG_SECONDS = 2.5;
export const GAG_WARN = 0.6;
export const REASSURE_COOLDOWN = 18;
export const REASSURE_AMOUNT = 8;
export const WATER_DISCOMFORT = 0.6;
export const MAX_BITS = 160;
export const DOZE_CLOSE = 4;         // seconds for a sleepy patient's jaw to close
export const DOZE_BLOCK = 0.6;       // past this the lower arch cannot be reached

// ------------------------------------------------------------------ types

export interface ToothDirt {
  index: number;
  kind: ToothKind;
  arch: 'upper' | 'lower';
  present: boolean;
  problem: boolean;
  plaque: Float32Array;
  stain: Float32Array;
  polish: Float32Array;
  paste: Float32Array;
  gel: Float32Array;
  reach: Uint8Array;        // cells tools can work (not under a bracket)
  vis: Uint8Array;          // cells a view can see (dirt spawns only here)
  reachCount: number;
  visCount: number;
  plaque0: number;          // initial sums (problem teeth: scored)
  stain0: number;
  plaqueAdded: number;      // plaque spread by sugar bugs
  /** Set when any layer changed; the scene uploads the texture and clears it. */
  changed: boolean;
  snapped: boolean;         // problem tooth done (DESIGN 5.2)
  uFront: number;           // the u that faces the front camera
  // case state
  gold: boolean;
  bracket: boolean;
  gelTarget: boolean;       // whitening: front tooth to paint and cure
  sealTarget: boolean;      // candy: molar to seal
  gelled: boolean;          // gel / sealant coverage reached once (sticky for the checklist)
  shade: number;            // shade guide 1 (brightest) .. 16
  cure: number;             // seconds toward the next shade step
  lampRun: number;          // nonstop seconds under the lamp
  lampFrame: number;
  pasteOn: boolean;         // has paste now (for the rinse reveal event)
  goldShine: boolean;
}

export type DepositKind = 'tartar' | 'barnacle' | 'hidden';
export interface TartarDeposit {
  id: number;
  tooth: number;
  u: number; v: number;
  size: number;
  hp: number; hp0: number;
  variant: 0 | 1 | 2;
  kind: DepositKind;
  hidden: boolean;          // inside a closed gum pocket: cannot be touched yet
  pocket: number;           // pocket id or -1
  stage: 0 | 1 | 2;         // crack stage (hairline, big cracks)
  popped: boolean;
  hitAcc: number;
  lastHit: number;
}

export type DebrisKind = 'popcorn' | 'spinach' | 'seed' | 'candy' | 'seaweed' | 'doubloon';
export interface Debris {
  id: number;
  a: number; b: number;     // tooth indices (b = a + 1, same arch); a === b for food at a bracket
  bracket: boolean;
  kind: DebrisKind;
  v: number;                // height of the wedge along the teeth (0 gumline, 1 edge)
  hp: number; hp0: number;
  popped: boolean;
  lastHit: number;
}

export interface LooseBit {
  id: number;
  x: number; y: number; z: number;   // mouth space (lower-jaw space for resting bits)
  state: 'resting' | 'floating' | 'gone';
  wash: number;
  color: number;            // 0xRRGGBB
}

export interface SugarBug {
  id: number;
  tooth: number;
  u: number; v: number;
  du: number; dv: number;   // crawl direction (unit, surface space)
  spread: number;           // seconds to the next plaque spread
  fleeing: number;          // seconds of sidling left
  alive: boolean;
  lastSpread: number;
}

export interface Pocket {
  id: number;
  tooth: number;
  u: number;
  open: number;             // hold progress 0..1
  opened: boolean;
  healed: boolean;
  held: number;             // frame of the last hold
  deps: number[];
}

export type ObjectiveId =
  | 'tartar' | 'barnacles' | 'plaque' | 'stain' | 'debris' | 'bugs' | 'seal' | 'gel' | 'cure'
  | 'gold' | 'pockets' | 'hidden' | 'finish';

export interface Objective extends CleanObjective {
  id: ObjectiveId;
  count: number;            // count objectives: total (0 = area)
  have: number;             // count objectives: done so far
}

export type CleanEvent =
  | { type: 'tartarHit'; dep: TartarDeposit }
  | { type: 'tartarCrack'; dep: TartarDeposit; stage: 1 | 2 }
  | { type: 'tartarPop'; dep: TartarDeposit; combo: number; bits: LooseBit[] }
  | { type: 'debrisHit'; deb: Debris }
  | { type: 'debrisPop'; deb: Debris; combo: number; bits: LooseBit[] }
  | { type: 'toothSnap'; tooth: number; n: number }
  | { type: 'bitFloat'; bit: LooseBit }
  | { type: 'bitSucked'; bit: LooseBit }
  | { type: 'pasteRinsed'; tooth: number }
  | { type: 'bugSquash'; bug: SugarBug; combo: number }
  | { type: 'bugSpread'; bug: SugarBug }
  | { type: 'gelDone'; tooth: number; seal: boolean }
  | { type: 'shadeTick'; tooth: number; shade: number }
  | { type: 'zing'; tooth: number }
  | { type: 'goldShine'; tooth: number }
  | { type: 'pocketOpen'; pocket: Pocket }
  | { type: 'pocketHeal'; pocket: Pocket }
  | { type: 'objective'; obj: Objective }
  | { type: 'ow' }
  | { type: 'gag' }
  | { type: 'gagWarn' }
  | { type: 'hic' }
  | { type: 'jolt' }
  | { type: 'doze' }
  | { type: 'wake' }
  | { type: 'chat'; line: string; closesJaw: boolean }
  | { type: 'reassure'; amount: number }
  | { type: 'walkout' };

export interface Twists { chatty: boolean; fidget: number; gag: boolean; sensitive: boolean; hiccups: boolean; sleepy: boolean }

export interface CleanModel {
  setup: CleanSetup;
  caseType: CaseType;
  tw: Twists;
  placements: ToothPlacement[];
  teeth: ToothDirt[];
  problem: number[];        // present problem teeth
  tartar: TartarDeposit[];
  debris: Debris[];
  bits: LooseBit[];
  bugs: SugarBug[];
  pockets: Pocket[];
  objectives: Objective[];
  bitsCreated: number;
  water: number;
  messEver: boolean;        // anything to rinse or suction was ever made (the finish objective starts then)
  // comfort
  comfort: number;
  gumTime: number;
  gumHurting: boolean;
  gumHits: number;
  molarTime: number;
  molarIdle: number;
  gagWarned: boolean;
  gags: number;
  jawClosed: number;        // seconds left of a closed jaw (gag or chat): tools disabled
  chatTimer: number;
  lineTimer: number;
  hicTimer: number;
  joltIn: number;           // seconds until the hiccup jolt (after the "hic" tell)
  jolt: number;             // seconds left of the jolt window
  joltHit: boolean;
  dozeTimer: number;
  dozing: boolean;
  doze: number;             // 0 awake .. 1 jaw shut
  snoreT: number;
  reassureCd: number;
  lastHurt: number;
  walkout: boolean;
  // progress
  time: number;
  frame: number;
  chunks: number;
  snaps: number;
  combo: number;
  bestCombo: number;
  lastPop: number;
  treasure: boolean;
  events: CleanEvent[];
  rng: Rng;
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

const isBack = (k: ToothKind) => k === 'molar' || k === 'premolar';

/** Can a view see this cell? The outward face (u 0.3..0.7) and the biting surface of back teeth (5.2). */
export function visibleCell(kind: ToothKind, u: number, v: number): boolean {
  if (v >= OCCLUSAL_V) return isBack(kind) || (u >= 0.3 && u <= 0.7);
  return u >= 0.3 && u <= 0.7 && v >= RATES.bandFloor;
}

/**
 * Dirt may spawn on this cell of tooth `index`: a view can see it (visibleCell) and the reachability audit
 * found a view from which a pointer presses it (REACH_CELLS, out/cleanfu/reach.mjs). Pure.
 */
export function spawnCell(index: number, kind: ToothKind, cell: number): boolean {
  return visibleCell(kind, cellU[cell], cellV[cell]) && pressable(index, cell);
}

/** Cells under a bracket (braces case): not reachable by any tool. */
export function underBracket(u: number, v: number): boolean {
  return u > 0.42 && u < 0.58 && v > 0.36 && v < 0.64;
}

/** Idealized crown point for (u, v) of a tooth of size w x h x d (tooth-local space). */
export function idealPoint(u: number, v: number, w: number, h: number, d: number, out: { x: number; y: number; z: number }) {
  const th = (u - 0.5) * Math.PI * 2;
  let k = 1;
  let y = v * h;
  if (v > OCCLUSAL_V) {
    k = Math.max(0, (1 - v) / (1 - OCCLUSAL_V));
    y = h * (OCCLUSAL_V + (1 - OCCLUSAL_V) * 0.35 * (1 - k));
  } else {
    k = 0.9 + 0.1 * Math.sin(Math.min(1, v / OCCLUSAL_V) * Math.PI);
  }
  out.x = Math.sin(th) * (w / 2) * k;
  out.y = y;
  out.z = Math.cos(th) * (d / 2) * k;
  return out;
}

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

/** Tooth-local point to mouth space (upper teeth are flipped about Z, then yawed onto the arch). */
export function toMouth(p: ToothPlacement, lx: number, ly: number, lz: number, out: { x: number; y: number; z: number }) {
  let x = lx, y = ly;
  if (p.arch === 'upper') { x = -x; y = -y; }
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  out.x = p.x + x * c + lz * s;
  out.y = p.y + y;
  out.z = p.z - x * s + lz * c;
  return out;
}

/** Crown centre of a tooth in mouth space (rest pose). */
export function crownCenter(p: ToothPlacement, out: { x: number; y: number; z: number }) {
  out.x = p.x + p.nx * 0.12; out.y = p.y + p.dir * p.height * 0.5; out.z = p.z + p.nz * 0.12;
  return out;
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
  const plusX = p.arch === 'lower' ? towardNext : !towardNext;
  return plusX ? 0.75 : 0.25;
}

/** Neighbour in the same arch on the +u (true) or -u side, or -1. */
function neighbourToward(p: ToothPlacement, plusU: boolean): number {
  // +u side (u 0.75) is local +X: next index for lower, previous for upper
  const next = p.arch === 'lower' ? plusU : !plusU;
  const n = p.index + (next ? 1 : -1);
  if (n < 0 || n >= TOOTH_COUNT || Math.floor(n / TEETH_PER_ARCH) !== Math.floor(p.index / TEETH_PER_ARCH)) return -1;
  return n;
}

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
function gauss(x: number, c: number, w: number): number { const d = (x - c) / w; return Math.exp(-d * d); }

// ------------------------------------------------------------------ twists

export function effectiveTwists(setup: CleanSetup): Twists {
  const has = (t: TwistId) => setup.twists?.includes(t) ?? false;
  return {
    chatty: has('chatty') || setup.traits.chatty,
    fidget: Math.max(setup.traits.fidget, has('fidget') ? 0.6 : 0),
    gag: has('gagger') || setup.traits.gag,
    sensitive: has('sensitive'),
    hiccups: has('hiccups'),
    sleepy: has('sleepy'),
  };
}

/** The twist ids actually in play (setup twists plus archetype traits), for the intro and chair card. */
export function twistList(setup: CleanSetup): TwistId[] {
  const t = effectiveTwists(setup);
  const out: TwistId[] = [];
  if (t.chatty) out.push('chatty');
  if (t.fidget > 0) out.push('fidget');
  if (t.gag) out.push('gagger');
  if (t.sensitive) out.push('sensitive');
  if (t.hiccups) out.push('hiccups');
  if (t.sleepy) out.push('sleepy');
  return out;
}

// ------------------------------------------------------------------ spawn

export function createModel(setup: CleanSetup): CleanModel {
  const placements = layoutTeeth();
  const srng = makeRng(setup.seed);
  const missing = new Set(setup.missingTeeth);
  const caseType: CaseType = setup.caseType ?? 'routine';
  const sp = setup.special;
  const problemSet = new Set((setup.problemTeeth ?? []).filter((i) => i >= 0 && i < TOOTH_COUNT && !missing.has(i)));
  const teeth: ToothDirt[] = placements.map((p) => {
    const present = !missing.has(p.index);
    const bracket = !!sp?.braces && present && p.pos >= 2 && p.pos <= 11;
    const reach = new Uint8Array(CELLS);
    const vis = new Uint8Array(CELLS);
    let rc = 0, vc = 0;
    for (let i = 0; i < CELLS; i++) {
      const u = cellU[i], v = cellV[i];
      if (!reachable(p.kind, u, v) || (bracket && underBracket(u, v))) continue;
      reach[i] = 1; rc++;
      if (spawnCell(p.index, p.kind, i)) { vis[i] = 1; vc++; }
    }
    return {
      index: p.index, kind: p.kind, arch: p.arch, present, problem: problemSet.has(p.index),
      plaque: new Float32Array(CELLS), stain: new Float32Array(CELLS), polish: new Float32Array(CELLS),
      paste: new Float32Array(CELLS), gel: new Float32Array(CELLS),
      reach, vis, reachCount: rc, visCount: vc, plaque0: 0, stain0: 0, plaqueAdded: 0,
      changed: true, snapped: false, uFront: frontU(p),
      gold: present && sp?.goldTooth === p.index, bracket,
      gelTarget: caseType === 'whitening' && present && p.pos >= 4 && p.pos <= 9,
      sealTarget: false, gelled: false,
      shade: clamp(Math.round(sp?.startShade || 4), 1, 16), cure: 0, lampRun: 0, lampFrame: -1,
      pasteOn: false, goldShine: false,
    };
  });
  const problem = [...problemSet].sort((a, b) => a - b);

  // --- layers
  spawnPlaque(teeth, placements, srng, setup, problem);
  spawnStain(teeth, placements, srng, setup, problem);
  spawnCosmetic(teeth, srng, problemSet);

  // --- deposits, pockets, debris, bugs
  const nextId = { v: 1 };
  const tartar: TartarDeposit[] = [];
  const pockets: Pocket[] = [];
  spawnTartar(tartar, teeth, placements, srng, setup, problem, nextId);
  if (caseType === 'deep') spawnPockets(tartar, pockets, teeth, srng, setup, problem, nextId);
  const debris = spawnDebris(teeth, srng, setup, problem, nextId);
  const bugs: SugarBug[] = [];
  const nBugs = caseType === 'candy' ? Math.max(0, Math.round(sp?.sugarBugs ?? 0)) : 0;
  for (let k = 0; k < nBugs && problem.length; k++) {
    const tooth = problem[k % problem.length];
    const a = srng.range(0, Math.PI * 2);
    // on a cell a tool can reach
    const [u, v] = nearestSpawn(teeth[tooth], srng.range(0.36, 0.64), srng.range(0.28, 0.7), 0.2);
    bugs.push({ id: nextId.v++, tooth, u, v, du: Math.cos(a), dv: Math.sin(a), spread: RATES.bugSpread * srng.range(0.7, 1.2), fleeing: 0, alive: true, lastSpread: -99 });
  }
  if (caseType === 'candy' && (sp?.sealants ?? 0) > 0) {
    const want = Math.round(sp!.sealants);
    const order = [1, 12, 0, 13];
    const picks: number[] = [];
    for (const pos of order) for (const arch of [1, 0]) {
      const i = arch * TEETH_PER_ARCH + pos;
      if (picks.length < want && teeth[i].present) picks.push(i);
    }
    for (const i of picks) teeth[i].sealTarget = true;
  }

  // every problem tooth has something to do
  for (const i of problem) {
    const t = teeth[i];
    let sum = 0;
    for (let c = 0; c < CELLS; c++) sum += t.plaque[c] + t.stain[c];
    const hasDep = tartar.some((d) => d.tooth === i);
    if (sum < 0.5 && !hasDep) paintBand(t, srng, 0.28, 0.9);
  }

  for (const t of teeth) {
    let ps = 0, ss = 0;
    for (let i = 0; i < CELLS; i++) { ps += t.plaque[i]; ss += t.stain[i]; }
    t.plaque0 = ps; t.stain0 = ss;
  }

  const rng = makeRng(hashSeed(setup.seed, 'clean-runtime'));
  const tw = effectiveTwists(setup);
  const m: CleanModel = {
    setup, caseType, tw, placements, teeth, problem, tartar, debris, bits: [], bugs, pockets, objectives: [],
    bitsCreated: 0, water: 0, messEver: false,
    comfort: clamp(setup.traits.comfortStart, 0, 100),
    gumTime: 0, gumHurting: false, gumHits: 0, molarTime: 0, molarIdle: 0, gagWarned: false, gags: 0, jawClosed: 0,
    chatTimer: tw.chatty ? rng.range(10, 16) : Infinity,
    lineTimer: rng.range(14, 22),
    hicTimer: tw.hiccups ? rng.range(8, 12) : Infinity, joltIn: -1, jolt: 0, joltHit: false,
    dozeTimer: tw.sleepy ? rng.range(14, 20) : Infinity, dozing: false, doze: 0, snoreT: 0,
    reassureCd: 0, lastHurt: -99, walkout: false,
    time: 0, frame: 0, chunks: 0, snaps: 0, combo: 0, bestCombo: 0, lastPop: -99, treasure: false,
    events: [], rng, nextId: nextId.v,
    totalTartarHp: tartar.reduce((s, d) => s + d.hp0, 0),
    totalDebrisHp: debris.reduce((s, d) => s + d.hp0, 0),
  };
  m.objectives = buildObjectives(m);
  // a problem tooth with nothing on it (should not happen) is done from the start
  for (const i of problem) if (toothDone(m, i)) m.teeth[i].snapped = true;
  updateObjectives(m, true);
  return m;
}

function paintBand(t: ToothDirt, rng: Rng, height: number, amount: number) {
  const seed = rng.int(1, 2 ** 30);
  for (let i = 0; i < CELLS; i++) {
    if (!t.vis[i]) continue;
    const v = cellV[i], u = cellU[i];
    if (v >= OCCLUSAL_V) continue;
    const edge = height * (0.75 + 0.5 * noise2(seed, u * 9, 3));
    if (v < edge) t.plaque[i] = Math.max(t.plaque[i], clamp(amount * (0.8 + 0.4 * noise2(seed + 3, u * 14, v * 10)), 0.55, 1));
  }
}

function spawnPlaque(teeth: ToothDirt[], placements: ToothPlacement[], rng: Rng, setup: CleanSetup, problem: number[]) {
  const share = clamp(setup.dirt.plaque, 0, 1);
  if (share <= 0 || !problem.length) return;
  const n = Math.max(1, Math.round(share * problem.length));
  const order = problem.slice();
  shuffle(order, rng);
  const thick = 0.26 + 0.16 * share;             // band height grows with the amount (the gum hides the first ~0.1)
  for (const i of order.slice(0, n)) {
    const t = teeth[i];
    const p = placements[i];
    paintBand(t, rng, thick, 1);
    // plaque loves the grooves on the biting surface of back teeth
    if (isBack(p.kind) && rng.chance(0.5)) {
      const seed = rng.int(1, 2 ** 30);
      for (let c = 0; c < CELLS; c++) {
        if (!t.vis[c] || cellV[c] < OCCLUSAL_V) continue;
        if (noise2(seed, cellU[c] * 10, cellV[c] * 30) > 0.5) t.plaque[c] = Math.max(t.plaque[c], 0.75);
      }
    }
  }
}

function spawnStain(teeth: ToothDirt[], placements: ToothPlacement[], rng: Rng, setup: CleanSetup, problem: number[]) {
  const share = clamp(setup.dirt.stain, 0, 1);
  if (share <= 0 || !problem.length) return;
  const n = Math.max(1, Math.round(share * problem.length));
  const order = problem.slice();
  shuffle(order, rng);
  const bands = setup.patient.archetype === 'coffee' || setup.patient.archetype === 'smoker' || setup.caseType === 'whitening';
  for (const i of order.slice(0, n)) {
    const t = teeth[i];
    const p = placements[i];
    const seed = rng.int(1, 2 ** 30);
    const front = !isBack(p.kind);
    const cu = rng.range(0.42, 0.58), cv = rng.range(0.35, 0.62);
    const w = rng.range(0.07, 0.11);
    for (let c = 0; c < CELLS; c++) {
      if (!t.vis[c]) continue;
      const u = cellU[c], v = cellV[c];
      let s: number;
      if (v >= OCCLUSAL_V) s = isBack(p.kind) ? 0.6 * gauss(noise2(seed, u * 8, v * 20), 0.7, 0.25) : 0;
      else if (bands && front) s = gauss(v, 0.3, 0.13) * 0.9 + 0.35 * gauss(u, cu, w * 1.4) * gauss(v, cv, 0.2);
      else s = gauss(u, cu, w) * gauss(v, cv, 0.16);
      s += (noise2(seed + 11, u * 16, v * 12) - 0.5) * 0.45;
      if (s > 0.42) t.stain[c] = clamp(0.6 + (s - 0.42) * 1.6, 0.6, 1);
    }
  }
}

/** Faint plaque on a few non-problem teeth: looks lived-in, never scored. */
function spawnCosmetic(teeth: ToothDirt[], rng: Rng, problem: Set<number>) {
  for (const t of teeth) {
    if (!t.present || problem.has(t.index) || !rng.chance(0.4)) continue;
    const seed = rng.int(1, 2 ** 30);
    for (let i = 0; i < CELLS; i++) {
      if (!t.vis[i] || cellV[i] >= OCCLUSAL_V) continue;
      const v = cellV[i], u = cellU[i];
      if (v < 0.08 + 0.06 * noise2(seed, u * 9, 1)) t.plaque[i] = 0.24;
    }
  }
}

function shuffle<T>(a: T[], rng: Rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); const t = a[i]; a[i] = a[j]; a[j] = t; }
}

export const cellAt = (u: number, v: number) => clamp(Math.floor(v * DIRT_GV), 0, DIRT_GV - 1) * DIRT_GU + clamp(Math.floor((((u % 1) + 1) % 1) * DIRT_GU), 0, DIRT_GU - 1);

/** The spawn cell nearest (u, v) (v within vMin .. vMax, u within the face), or (u, v) itself when it already is one. */
function nearestSpawn(t: ToothDirt | undefined, u: number, v: number, vMin = 0.06, vMax = Math.max(0.3, v + 0.1)): [number, number] {
  if (!t || t.vis[cellAt(u, v)]) return [u, v];
  let best: [number, number] = [u, v], bd = Infinity;
  for (let i = 0; i < CELLS; i++) {
    if (!t.vis[i] || cellV[i] < vMin || cellV[i] > vMax || cellU[i] < 0.34 || cellU[i] > 0.66) continue;
    const d = (cellU[i] - u) ** 2 + ((cellV[i] - v) * 0.5) ** 2;
    if (d < bd) { bd = d; best = [cellU[i], cellV[i]]; }
  }
  return best;
}

function placeDeposit(out: TartarDeposit[], tooth: number, rng: Rng, size: number, kind: DepositKind, id: { v: number }, u0?: number, v0?: number, t?: ToothDirt): TartarDeposit {
  let u = u0 ?? clamp(0.5 + rng.normal(0, 0.07), 0.36, 0.64);
  let v = v0 ?? rng.range(0.07, 0.2);
  // keep lumps on one tooth apart
  for (let k = 0; k < 6; k++) {
    if (!out.some((d) => d.tooth === tooth && Math.abs(d.u - u) < 0.09 && Math.abs(d.v - v) < 0.12)) break;
    u = clamp(u + (k % 2 ? -1 : 1) * 0.1 * (k + 1) * 0.5, 0.34, 0.66);
  }
  // only where a pointer can press it (DESIGN 5.2 reachability)
  [u, v] = nearestSpawn(t, u, v, kind === 'hidden' ? 0.05 : 0.06);
  const hpMult = kind === 'barnacle' ? 2 : 1;
  const d: TartarDeposit = {
    id: id.v++, tooth, u, v, size, hp: size * TARTAR_HP * hpMult, hp0: size * TARTAR_HP * hpMult,
    variant: rng.int(0, 2) as 0 | 1 | 2, kind, hidden: kind === 'hidden', pocket: -1, stage: 0,
    popped: false, hitAcc: 0, lastHit: -99,
  };
  out.push(d);
  return d;
}

function spawnTartar(out: TartarDeposit[], teeth: ToothDirt[], placements: ToothPlacement[], rng: Rng, setup: CleanSetup, problem: number[], id: { v: number }) {
  if (!problem.length) return;
  const count = Math.max(0, Math.round(setup.dirt.tartarCount));
  const order = problem.slice();
  shuffle(order, rng);
  if (setup.tutorial) {
    // the first lump sits on a lower front tooth the camera sees head-on
    const pref = [TEETH_PER_ARCH + 7, TEETH_PER_ARCH + 6, TEETH_PER_ARCH + 5, 7, 6];
    const first = pref.find((i) => problem.includes(i));
    if (first !== undefined) { order.splice(order.indexOf(first), 1); order.unshift(first); }
  }
  for (let k = 0; k < count; k++) {
    const tooth = order[k % order.length];
    const size = Math.max(0.35, setup.dirt.tartarSize * rng.range(0.8, 1.2));
    placeDeposit(out, tooth, rng, size, 'tartar', id, setup.tutorial && k === 0 ? 0.5 : undefined, setup.tutorial && k === 0 ? 0.14 : undefined, teeth[tooth]);
  }
  const nb = setup.caseType === 'pirate' ? Math.max(0, Math.round(setup.special?.barnacles ?? 0)) : 0;
  const border = problem.slice();
  shuffle(border, rng);
  for (let k = 0; k < nb; k++) placeDeposit(out, border[k % border.length], rng, rng.range(0.9, 1.15), 'barnacle', id, undefined, undefined, teeth[border[k % border.length]]);
  void placements;
}

function spawnPockets(out: TartarDeposit[], pockets: Pocket[], teeth: ToothDirt[], rng: Rng, setup: CleanSetup, problem: number[], id: { v: number }) {
  const n = Math.min(problem.length, Math.max(0, Math.round(setup.special?.pockets ?? 0)));
  const order = problem.slice();
  shuffle(order, rng);
  for (let k = 0; k < n; k++) {
    const tooth = order[k];
    const u = clamp(0.5 + rng.range(-0.08, 0.08), 0.4, 0.6);
    const pk: Pocket = { id: id.v++, tooth, u, open: 0, opened: false, healed: false, held: -1, deps: [] };
    const nd = rng.int(1, 2);
    for (let j = 0; j < nd; j++) {
      const d = placeDeposit(out, tooth, rng, Math.max(0.5, setup.dirt.tartarSize * rng.range(0.85, 1.1)), 'hidden', id, clamp(u + (j ? 0.1 : -0.02) * (rng.chance(0.5) ? 1 : -1), 0.36, 0.64), 0.07, teeth[tooth]);
      d.pocket = pk.id;
      pk.deps.push(d.id);
    }
    pockets.push(pk);
  }
}

const DEBRIS_HP: Record<DebrisKind, number> = { popcorn: 2, spinach: 2, seed: 1, candy: 2, seaweed: 2, doubloon: 2 };

function spawnDebris(teeth: ToothDirt[], rng: Rng, setup: CleanSetup, problem: number[], id: { v: number }): Debris[] {
  const out: Debris[] = [];
  const ps = new Set(problem);
  const caseType = setup.caseType ?? 'routine';
  const count = Math.max(0, Math.round(setup.dirt.debrisCount));
  const gaps: { a: number; b: number; w: number }[] = [];
  for (let arch = 0; arch < 2; arch++) {
    for (let pos = 0; pos < TEETH_PER_ARCH - 1; pos++) {
      const a = arch * TEETH_PER_ARCH + pos;
      if (!teeth[a].present || !teeth[a + 1].present) continue;
      if (!ps.has(a) && !ps.has(a + 1)) continue;
      gaps.push({ a, b: a + 1, w: pos >= 2 && pos <= 10 ? 3 : 1 });
    }
  }
  const takeGap = (pref?: (g: { a: number }) => boolean) => {
    if (!gaps.length) return null;
    let g = pref ? gaps.find(pref) : undefined;
    if (!g) g = rng.weighted(gaps, (x) => x.w);
    gaps.splice(gaps.indexOf(g), 1);
    return g;
  };
  const kid = setup.patient.archetype === 'kid';
  const foodKinds: DebrisKind[] = ['popcorn', 'spinach', 'seed', 'candy'];
  if (setup.special?.braces) {
    // food wedged under the wire at brackets on problem teeth
    const br = problem.filter((i) => teeth[i].bracket);
    shuffle(br, rng);
    for (let k = 0; k < count && k < br.length; k++) {
      const kind = rng.weighted(foodKinds, (x) => (x === 'spinach' ? 3 : x === 'popcorn' ? 2 : 1.5));
      out.push({ id: id.v++, a: br[k], b: br[k], bracket: true, kind, v: 0.62, hp: DEBRIS_HP[kind], hp0: DEBRIS_HP[kind], popped: false, lastHit: -99 });
    }
  } else {
    for (let k = 0; k < count; k++) {
      const tutFirst = setup.tutorial && k === 0;
      const g = takeGap(tutFirst ? (x) => x.a === TEETH_PER_ARCH + 5 || x.a === TEETH_PER_ARCH + 6 || x.a === 5 || x.a === 6 : undefined);
      if (!g) break;
      const kind: DebrisKind = tutFirst ? 'popcorn' : caseType === 'candy' ? 'candy'
        : rng.weighted(foodKinds, (x) => (x === 'candy' ? (kid ? 5 : 1) : x === 'popcorn' ? 3 : 2));
      out.push({ id: id.v++, a: g.a, b: g.b, bracket: false, kind, v: rng.range(0.32, 0.5), hp: DEBRIS_HP[kind], hp0: DEBRIS_HP[kind], popped: false, lastHit: -99 });
    }
  }
  if (caseType === 'pirate') {
    const ns = Math.max(0, Math.round(setup.special?.seaweed ?? 0));
    for (let k = 0; k < ns; k++) {
      const g = takeGap();
      if (!g) break;
      out.push({ id: id.v++, a: g.a, b: g.b, bracket: false, kind: 'seaweed', v: rng.range(0.35, 0.5), hp: 2, hp0: 2, popped: false, lastHit: -99 });
    }
    if (setup.special?.treasure) {
      // a doubloon wedged in a back molar gap: only a side view shows it
      const cands: { a: number; b: number }[] = [];
      for (const arch of [0, 1]) for (const pos of [0, 12]) {
        const a = arch * TEETH_PER_ARCH + pos;
        if (teeth[a].present && teeth[a + 1].present && !out.some((d) => d.a === a && !d.bracket)) cands.push({ a, b: a + 1 });
      }
      if (cands.length) {
        const g = rng.pick(cands);
        out.push({ id: id.v++, a: g.a, b: g.b, bracket: false, kind: 'doubloon', v: 0.42, hp: DEBRIS_HP.doubloon, hp0: DEBRIS_HP.doubloon, popped: false, lastHit: -99 });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ brush

const tmpP = { x: 0, y: 0, z: 0 };

/**
 * Visit reachable cells of `tooth` inside a brush of radius R (mouth units) around (u, v); fn(cell, falloff 0..1).
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

/** Wrap assist: every reachable cell in a band around the crown at height v (the biting surface counts as one band). */
export function forWrap(m: CleanModel, tooth: number, v: number, fn: (i: number) => void, band = RATES.wrapBand) {
  const t = m.teeth[tooth];
  if (!t || !t.present) return;
  const top = v >= OCCLUSAL_V - 0.04;
  for (let i = 0; i < CELLS; i++) {
    if (!t.reach[i]) continue;
    const cv = cellV[i];
    if (top ? cv >= OCCLUSAL_V - 0.02 : Math.abs(cv - v) <= band) fn(i);
  }
}

export function wrapRate(hold: number): number {
  return RATES.wrapBase + (RATES.wrapMax - RATES.wrapBase) * clamp(hold, 0, 1);
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
  if (d.popped || d.hidden || dmg <= 0) return;
  d.hp -= dmg;
  d.hitAcc += dmg;
  d.lastHit = m.time;
  if (d.hp <= 1e-6) {
    d.hp = 0;
    d.popped = true;
    m.chunks++;
    const combo = registerPop(m);
    // one or two crumbs per lump: enough to show where it went, few enough that the rinse is one sweep
    const bits = spawnBits(m, d.tooth, d.kind === 'barnacle' || d.size >= 1.2 ? 2 : 1, d.kind === 'barnacle' ? 0xE9E4D6 : 0xD2A945);
    m.events.push({ type: 'tartarPop', dep: d, combo, bits });
    if (d.pocket >= 0) {
      const pk = m.pockets.find((p) => p.id === d.pocket);
      if (pk && !pk.healed && pk.deps.every((id) => m.tartar.find((x) => x.id === id)?.popped)) {
        pk.healed = true;
        m.events.push({ type: 'pocketHeal', pocket: pk });
      }
    }
    checkSnap(m, d.tooth);
  } else {
    const f = d.hp / d.hp0;
    const stage = (f < 0.36 ? 2 : f < 0.7 ? 1 : 0) as 0 | 1 | 2;
    if (stage > d.stage) { d.stage = stage; m.events.push({ type: 'tartarCrack', dep: d, stage: stage as 1 | 2 }); d.hitAcc = 0; }
    else if (d.hitAcc >= RATES.hitChunk) { d.hitAcc = 0; m.events.push({ type: 'tartarHit', dep: d }); }
  }
}

function spawnBits(m: CleanModel, tooth: number, n: number, color: number): LooseBit[] {
  const p = m.placements[tooth];
  const out: LooseBit[] = [];
  let live = 0;
  for (const b of m.bits) if (b.state !== 'gone') live++;
  n = Math.min(n, MAX_BITS - live);
  for (let k = 0; k < n; k++) {
    // they tumble inward onto the tongue / floor of the mouth near the tooth
    const inward = m.rng.range(0.35, 0.62);
    const b: LooseBit = {
      id: m.nextId++,
      x: p.x * inward + m.rng.range(-0.35, 0.35),
      y: -1.75,
      z: (p.z - 0.3) * inward + m.rng.range(-0.3, 0.3),
      state: 'resting', wash: 0, color,
    };
    m.bits.push(b);
    out.push(b);
  }
  if (n > 0) { m.bitsCreated += n; m.messEver = true; }
  return out;
}

const tmpA = { x: 0, y: 0, z: 0 };
const tmpB = { x: 0, y: 0, z: 0 };
function depositsNear(m: CleanModel, tooth: number, u: number, v: number, R: number, fn: (d: TartarDeposit, f: number) => void) {
  const p = m.placements[tooth];
  const a = idealPoint(u, v, p.width, p.height, p.depth, tmpA);
  for (const d of m.tartar) {
    if (d.popped || d.hidden || d.tooth !== tooth) continue;
    idealPoint(d.u, d.v, p.width, p.height, p.depth, tmpB);
    const dist = Math.hypot(a.x - tmpB.x, a.y - tmpB.y, a.z - tmpB.z);
    const reach = R + RATES.tartarReach * Math.sqrt(d.size);
    if (dist < reach) fn(d, 1 - (dist / reach) * 0.5);
  }
}

/** Squash live sugar bugs within reach of a tool at (tooth, u, v). */
function squashNear(m: CleanModel, tooth: number, u: number, v: number, R: number) {
  for (const b of m.bugs) {
    if (!b.alive || b.tooth !== tooth) continue;
    if (surfaceDistance(m, tooth, u, v, b.u, b.v) > R + 0.1) continue;
    b.alive = false;
    const combo = registerPop(m);
    m.events.push({ type: 'bugSquash', bug: b, combo });
  }
}

export interface ApplyResult { plaque: number; stain: number; polish: number; tartar: number }
const res: ApplyResult = { plaque: 0, stain: 0, polish: 0, tartar: 0 };
function resetRes() { res.plaque = 0; res.stain = 0; res.polish = 0; res.tartar = 0; return res; }

function blocked(m: CleanModel, tooth: number): boolean {
  if (m.jawClosed > 0 || m.walkout) return true;
  if (m.doze >= 0.95) return true;
  if (m.doze >= DOZE_BLOCK && m.teeth[tooth]?.arch === 'lower') return true;
  return false;
}

/** Can a tool work on this tooth right now? (closed jaw, a dozing patient's lower arch) */
export function toothBlocked(m: CleanModel, tooth: number): boolean { return blocked(m, tooth); }

/**
 * Scaler on a tooth. Hand scalers (tiers 1 to 3) act on stroke length `stroke` (mouth units moved on
 * the surface since the last frame); ultrasonic tiers act on time `dt` while touching.
 * Returns the amounts removed this call (shared object, read immediately).
 */
export function applyScaler(m: CleanModel, tooth: number, u: number, v: number, stroke: number, dt: number): ApplyResult {
  const r = resetRes();
  if (blocked(m, tooth)) return r;
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
  squashNear(m, tooth, u, v, R);
  depositsNear(m, tooth, u, v, R, (d, f) => { const before = d.hp; damageTartar(m, d, tDmg * f); r.tartar += before - d.hp; });
  forBrush(m, tooth, u, v, R, (i, f) => {
    const before = t.plaque[i];
    if (before <= 0) return;
    const after = Math.max(0, before - pAmt * (0.35 + 0.65 * f));
    t.plaque[i] = after < RATES.cleanEps ? 0 : after;
    r.plaque += before - t.plaque[i];
  });
  if (r.plaque > 0 || r.tartar > 0) { t.changed = true; checkSnap(m, tooth); }
  return r;
}

/**
 * Polisher (time based). `moving` spins faster: 1 when the cup moves, ~0.55 when held still.
 * `hold` = seconds the cup has stayed on this tooth: the wrap assist polishes a band around the whole crown
 * at the same height (40% rate, rising to 70% after 1 s), so hidden sides never block a snap.
 * Leaves prophy paste on every cell it touched (only rinse removes it).
 */
export function applyPolisher(m: CleanModel, tooth: number, u: number, v: number, dt: number, moving = 1, hold = 0): ApplyResult {
  const r = resetRes();
  if (blocked(m, tooth)) return r;
  const tool = activeTool(m.setup, 'polisher');
  const t = m.teeth[tooth];
  if (!t || !t.present) return r;
  const mods = m.setup.mods;
  const R = RATES.brushPolisher * tool.radius * mods.polishRadius;
  const k = dt * (0.55 + 0.45 * clamp(moving, 0, 1)) * mods.polishSpeed;
  const pA = tool.plaque * RATES.polishPlaque * k;
  const sA = tool.stain * RATES.polishStain * k;
  const gA = tool.polish * RATES.polishGain * k * (t.gold ? 1.8 : 1);
  const whitening = m.caseType === 'whitening';
  addWater(m, tool.water * dt);
  squashNear(m, tooth, u, v, R);
  const work = (i: number, w: number) => {
    const p0 = t.plaque[i], s0 = t.stain[i];
    if (p0 > 0) { const p1 = Math.max(0, p0 - pA * w); t.plaque[i] = p1 < RATES.cleanEps ? 0 : p1; r.plaque += p0 - t.plaque[i]; }
    if (s0 > 0) { const s1 = Math.max(0, s0 - sA * w); t.stain[i] = s1 < RATES.cleanEps ? 0 : s1; r.stain += s0 - t.stain[i]; }
    if (t.plaque[i] < RATES.polishClean && t.stain[i] < RATES.polishClean && t.polish[i] < 1) {
      const g0 = t.polish[i];
      t.polish[i] = Math.min(1, g0 + gA * w);
      r.polish += t.polish[i] - g0;
    }
    // prophy paste (the gold crown stays clean so the shine shows while buffing)
    const pl = t.gold ? 0 : RATES.pasteLay * Math.min(1, w * 1.6);
    if (t.paste[i] < pl) { t.paste[i] = pl; t.pasteOn = true; m.messEver = true; }
    if (whitening && t.gel[i] > 0) t.gel[i] = Math.max(0, t.gel[i] - 3 * dt);
  };
  forBrush(m, tooth, u, v, R, (i, f) => work(i, 0.3 + 0.7 * f));
  const wr = wrapRate(hold);
  forWrap(m, tooth, v, (i) => work(i, wr * 0.7));
  t.changed = true;
  if (t.gold && !t.goldShine && goldProgress(m) >= 1) { t.goldShine = true; m.events.push({ type: 'goldShine', tooth }); }
  if (r.plaque > 0 || r.stain > 0) checkSnap(m, tooth);
  return r;
}

/**
 * Gel brush (whitening gel on the outward face, sealant on the biting surface of back teeth).
 * Same wrap assist as the polisher. Returns the gel added.
 */
export function applyGel(m: CleanModel, tooth: number, u: number, v: number, dt: number, hold = 0): number {
  if (blocked(m, tooth)) return 0;
  const t = m.teeth[tooth];
  if (!t || !t.present) return 0;
  const seal = m.caseType !== 'whitening';
  const target = (i: number) => (seal ? cellV[i] >= OCCLUSAL_V && isBack(t.kind) : t.vis[i] === 1 && cellV[i] < OCCLUSAL_V);
  const amt = RATES.gelPaint * dt;
  let added = 0;
  const paint = (i: number, w: number) => {
    if (!target(i) || t.gel[i] >= 1) return;
    const g0 = t.gel[i];
    t.gel[i] = Math.min(1, g0 + amt * w);
    added += t.gel[i] - g0;
  };
  forBrush(m, tooth, u, v, RATES.brushGel, (i, f) => paint(i, 0.35 + 0.65 * f));
  forWrap(m, tooth, seal ? 1 : v, (i) => paint(i, wrapRate(hold) * 0.8), RATES.gelBand);
  if (added > 0) {
    t.changed = true;
    if (!seal) m.messEver = true;
    if (!t.gelled && (seal ? t.sealTarget : t.gelTarget) && gelCoverage(m, tooth) >= RATES.gelDone) {
      t.gelled = true;
      m.events.push({ type: 'gelDone', tooth, seal });
    }
  }
  return added;
}

/** Share of a tooth's gel target cells (face for whitening, biting surface for sealant) with gel >= 0.5. */
export function gelCoverage(m: CleanModel, tooth: number): number {
  const t = m.teeth[tooth];
  if (!t.present) return 0;
  const seal = m.caseType !== 'whitening';
  let n = 0, on = 0;
  for (let i = 0; i < CELLS; i++) {
    if (!t.reach[i]) continue;
    const tgt = seal ? cellV[i] >= OCCLUSAL_V : t.vis[i] === 1 && cellV[i] < OCCLUSAL_V;
    if (!tgt) continue;
    n++;
    if (t.gel[i] >= 0.5) on++;
  }
  return n ? on / n : 0;
}

/**
 * UV lamp aimed at `tooth`: the lamp cone covers that tooth and its two neighbours. Each gel-coated
 * whitening tooth under it brightens one shade per 1.2 s down to the target; more than 4 s nonstop on
 * one tooth zings (comfort -5).
 */
export function applyLamp(m: CleanModel, tooth: number, dt: number): void {
  if (blocked(m, tooth) || m.caseType !== 'whitening') return;
  const arch = Math.floor(tooth / TEETH_PER_ARCH);
  const target = Math.max(1, m.setup.special?.targetShade || 1);
  for (let n = tooth - 1; n <= tooth + 1; n++) {
    if (n < 0 || n >= TOOTH_COUNT || Math.floor(n / TEETH_PER_ARCH) !== arch) continue;
    const t = m.teeth[n];
    if (!t.present) continue;
    t.lampFrame = m.frame;
    t.lampRun += dt;
    if (t.lampRun > RATES.lampZing) {
      t.lampRun = 0;
      m.comfort = clamp(m.comfort - 5, 0, 100);
      m.lastHurt = m.time;
      m.events.push({ type: 'zing', tooth: n });
    }
    if (!t.gelTarget || t.shade <= target || gelCoverage(m, n) < RATES.gelDone * 0.75) continue;
    t.cure += dt;
    if (t.cure >= RATES.lampShade) {
      t.cure -= RATES.lampShade;
      t.shade = Math.max(target, t.shade - 1);
      t.changed = true;
      m.events.push({ type: 'shadeTick', tooth: n, shade: t.shade });
    }
  }
}

/** Mean shade of the whitening teeth (or of every present tooth outside whitening). */
export function meanShade(m: CleanModel): number {
  let s = 0, n = 0;
  for (const t of m.teeth) {
    if (!t.present || (m.caseType === 'whitening' && !t.gelTarget)) continue;
    s += t.shade; n++;
  }
  return n ? s / n : m.setup.special?.startShade || 4;
}

/** Hold the scaler on a closed gum pocket: after 0.8 s it opens and the hidden tartar slides into view. */
export function applyPocket(m: CleanModel, pocketId: number, dt: number): boolean {
  const pk = m.pockets.find((p) => p.id === pocketId);
  if (!pk || pk.opened || blocked(m, pk.tooth)) return false;
  pk.held = m.frame;
  pk.open = Math.min(1, pk.open + dt / RATES.pocketHold);
  if (pk.open >= 1) {
    pk.opened = true;
    for (const id of pk.deps) { const d = m.tartar.find((x) => x.id === id); if (d) d.hidden = false; }
    m.events.push({ type: 'pocketOpen', pocket: pk });
  }
  return true;
}

export type FlossTarget = { a: number; b: number };   // a === b: food at a bracket

/** One floss saw stroke in a gap (or under the wire at a bracket): debris hp and the plaque between the teeth. */
export function flossStroke(m: CleanModel, target: FlossTarget, power = activeTool(m.setup, 'floss').floss): boolean {
  if (blocked(m, target.a)) return false;
  let hit = false;
  for (const d of m.debris) {
    if (d.popped || d.a !== target.a || d.b !== target.b) continue;
    hitDebris(m, d, power);
    hit = true;
  }
  if (target.a !== target.b) {
    if (m.teeth[target.a]?.present) hit = flossPlaque(m, target.a, target.b) || hit;
    if (m.teeth[target.b]?.present) hit = flossPlaque(m, target.b, target.a) || hit;
  }
  return hit;
}

/** Legacy name kept for the harness: one stroke in the gap between `a` and `b`. */
export function flossSwipe(m: CleanModel, a: number, b: number): boolean {
  return flossStroke(m, { a: Math.min(a, b), b: Math.max(a, b) });
}

function hitDebris(m: CleanModel, d: Debris, dmg: number) {
  if (d.popped) return;
  d.hp -= dmg;
  d.lastHit = m.time;
  if (d.hp <= 1e-6) {
    d.hp = 0;
    d.popped = true;
    const combo = registerPop(m);
    if (d.kind === 'doubloon') m.treasure = true;
    const color = d.kind === 'spinach' || d.kind === 'seaweed' ? 0x3E9B3A : d.kind === 'candy' ? 0xFF5FA2 : d.kind === 'seed' ? 0x5B4630 : 0xFFF1C8;
    const bits = d.kind === 'doubloon' ? [] : spawnBits(m, d.a, 1, color);
    m.events.push({ type: 'debrisPop', deb: d, combo, bits });
    checkSnap(m, d.a);
    if (d.b !== d.a) checkSnap(m, d.b);
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
    if (Math.abs(cellU[i] - su) > RATES.flossStrip + 0.1 || cellV[i] > 0.9) continue;
    const before = t.plaque[i];
    t.plaque[i] = Math.max(0, before - RATES.flossPlaque);
    if (t.plaque[i] < RATES.cleanEps) t.plaque[i] = 0;
    removed += before - t.plaque[i];
  }
  if (removed > 0) { t.changed = true; checkSnap(m, tooth); }
  return removed > 0;
}

/** Water flosser held at a gap or bracket (time based). */
export function applyWaterFloss(m: CleanModel, a: number, b: number, dt: number): boolean {
  if (blocked(m, a)) return false;
  const tool = activeTool(m.setup, 'floss');
  addWater(m, tool.water * dt);
  let hit = false;
  for (const d of m.debris) {
    if (d.popped || d.a !== Math.min(a, b) || d.b !== Math.max(a, b)) continue;
    const before = d.hp;
    const dmg = tool.floss * RATES.waterFloss * dt;
    if (before - dmg <= 1e-6) hitDebris(m, d, before);
    else {
      d.hp -= dmg;
      d.lastHit = m.time;
      if (Math.floor(before * 2) !== Math.floor(d.hp * 2)) m.events.push({ type: 'debrisHit', deb: d });
    }
    hit = true;
  }
  if (a !== b) for (const [t, o] of [[a, b], [b, a]] as const) {
    const td = m.teeth[t];
    if (!td?.present) continue;
    const su = sideU(m.placements[t], o);
    let removed = 0;
    for (let i = 0; i < CELLS; i++) {
      if (!td.reach[i] || td.plaque[i] <= 0 || Math.abs(cellU[i] - su) > RATES.flossStrip + 0.1) continue;
      const b0 = td.plaque[i];
      td.plaque[i] = Math.max(0, b0 - 1.2 * dt);
      removed += b0 - td.plaque[i];
    }
    if (removed > 0) { td.changed = true; checkSnap(m, t); hit = true; }
  }
  return hit;
}

/**
 * Suction held at a mouth-space point (lower-jaw space): drains water and removes floating bits only.
 * Floating bits drift toward the tip. Bits resting on the tongue need a rinse first.
 * Returns the number of resting bits near the tip (for a "rinse first" hint).
 */
export function applySuction(m: CleanModel, x: number, y: number, z: number, dt: number): number {
  if (m.walkout) return 0;
  const tool = activeTool(m.setup, 'suction');
  m.water = Math.max(0, m.water - tool.drain * RATES.suctionDrain * dt);
  const R = RATES.bitSuckRadius * tool.radius;
  const pull = RATES.bitPull * tool.radius;
  let resting = 0;
  for (const b of m.bits) {
    if (b.state === 'gone') continue;
    const dx = x - b.x, dz = z - b.z;
    const d2 = dx * dx + dz * dz;
    if (b.state === 'resting') { if (d2 < pull * pull) resting++; continue; }
    if (d2 < R * R) {
      b.state = 'gone';
      m.events.push({ type: 'bitSucked', bit: b });
    } else if (d2 < pull * pull) {
      const d = Math.sqrt(d2);
      const k = Math.min(d, dt * 2.2 * tool.bits) / d;
      b.x += dx * k; b.z += dz * k;
    }
  }
  void y;
  return resting;
}

/**
 * Air-water syringe spraying at a mouth-space point: washes paste (and whitening gel) off the teeth in a
 * wide cone, floats resting bits into the water, raises the water.
 */
export function applyRinse(m: CleanModel, x: number, y: number, z: number, dt: number): void {
  if (m.walkout) return;
  const tool = activeTool(m.setup, 'rinse');
  addWater(m, tool.water * RATES.rinseWater * dt);
  m.messEver = true;
  const R = RATES.rinseRadius;
  const c = tmpA;
  const whitening = m.caseType === 'whitening';
  for (const t of m.teeth) {
    if (!t.present) continue;
    crownCenter(m.placements[t.index], c);
    const d = Math.hypot(c.x - x, c.y - y, c.z - z);
    if (d > R) continue;
    const k = RATES.rinseWash * dt * (1 - 0.6 * (d / R));
    let left = 0, any = false;
    for (let i = 0; i < CELLS; i++) {
      if (t.paste[i] > 0) { t.paste[i] = Math.max(0, t.paste[i] - k); if (t.paste[i] < 0.03) t.paste[i] = 0; any = true; left += t.paste[i]; }
      if (whitening && t.gel[i] > 0) { t.gel[i] = Math.max(0, t.gel[i] - k); if (t.gel[i] < 0.03) t.gel[i] = 0; any = true; }
    }
    if (any) t.changed = true;
    if (t.pasteOn && left <= 0) { t.pasteOn = false; m.events.push({ type: 'pasteRinsed', tooth: t.index }); }
  }
  const W = RATES.bitWashRadius;
  for (const b of m.bits) {
    if (b.state !== 'resting') continue;
    const dx = b.x - x, dz = b.z - z;
    if (dx * dx + dz * dz < W * W) {
      b.wash += dt;
      if (b.wash >= RATES.washTime) { b.state = 'floating'; m.events.push({ type: 'bitFloat', bit: b }); }
    }
  }
}

export function addWater(m: CleanModel, amount: number) {
  if (amount > 0) { m.water = Math.min(1, m.water + amount); if (m.water > 0.1) m.messEver = true; }
}

// ------------------------------------------------------------------ tooth state

function layerSums(t: ToothDirt): { p: number; s: number } {
  let p = 0, s = 0;
  for (let i = 0; i < CELLS; i++) { p += t.plaque[i]; s += t.stain[i]; }
  return { p, s };
}

/** Is a problem tooth finished: no tartar (visible or hidden) and at most 20% of its plaque and stain left? */
export function toothDone(m: CleanModel, tooth: number): boolean {
  const t = m.teeth[tooth];
  if (!t.present) return true;
  for (const d of m.tartar) if (d.tooth === tooth && !d.popped) return false;
  const { p, s } = layerSums(t);
  const start = t.plaque0 + t.plaqueAdded + t.stain0;
  return p + s <= start * RATES.snapLeft + 1e-6;
}

/**
 * How much of a problem tooth's dirt is gone, 0 .. 1 (raw removal, not scaled to the snap): plaque and stain
 * removed (weight 1) and tartar hp removed (0.5 per deposit). Snapped and non-problem teeth report 1.
 */
export function toothRemoval(m: CleanModel, tooth: number): number {
  const t = m.teeth[tooth];
  if (!t.present || !t.problem || t.snapped) return 1;
  const { p, s } = layerSums(t);
  const start = t.plaque0 + t.plaqueAdded + t.stain0;
  let th = 0, th0 = 0, nd = 0;
  for (const d of m.tartar) if (d.tooth === tooth) { th += d.hp; th0 += d.hp0; nd++; }
  const wA = start > 0.5 ? 1 : 0, wT = th0 > 0 ? 0.5 * nd : 0;
  if (wA + wT <= 0) return 1;
  const area = wA ? clamp(1 - (p + s) / start, 0, 1) : 1;
  const tart = th0 > 0 ? clamp(1 - th / th0, 0, 1) : 1;
  return (wA * area + wT * tart) / (wA + wT);
}

/** Progress toward the snap, 0 .. 1 (plaque and stain scaled so the snap threshold reads as 1). */
export function toothProgress(m: CleanModel, tooth: number): number {
  const t = m.teeth[tooth];
  if (!t.present || !t.problem || t.snapped) return 1;
  const { p, s } = layerSums(t);
  const start = t.plaque0 + t.plaqueAdded + t.stain0;
  let th = 0, th0 = 0, nd = 0;
  for (const d of m.tartar) if (d.tooth === tooth) { th += d.hp; th0 += d.hp0; nd++; }
  const wA = start > 0.5 ? 1 : 0, wT = th0 > 0 ? 0.5 * nd : 0;
  if (wA + wT <= 0) return 1;
  const area = wA ? clamp((1 - (p + s) / start) / (1 - RATES.snapLeft), 0, 1) : 1;
  const tart = th0 > 0 ? clamp(1 - th / th0, 0, 1) : 1;
  return (wA * area + wT * tart) / (wA + wT);
}

/** Remaining work on one tooth, 0 (done) .. 1 (untouched), for the mini-map. Non-problem teeth report 0. */
export function toothDirtLeft(m: CleanModel, tooth: number): number {
  const t = m.teeth[tooth];
  if (!t.present || !t.problem || t.snapped) return 0;
  return 1 - toothProgress(m, tooth);
}

/** "Last bits": a problem tooth at 70% or more whose remaining specks pulse so the player sees what is left. */
export function lastBits(m: CleanModel, tooth: number): boolean {
  const t = m.teeth[tooth];
  return t.present && t.problem && !t.snapped && toothRemoval(m, tooth) >= RATES.lastBits;
}

export function isToothSpotless(m: CleanModel, tooth: number): boolean {
  const t = m.teeth[tooth];
  return !t.present || !t.problem || t.snapped;
}

function checkSnap(m: CleanModel, tooth: number) {
  const t = m.teeth[tooth];
  if (!t || !t.present || !t.problem || t.snapped) return;
  if (!toothDone(m, tooth)) return;
  t.snapped = true;
  // leftover specks fade
  for (let i = 0; i < CELLS; i++) { t.plaque[i] = 0; t.stain[i] = 0; }
  t.changed = true;
  m.snaps++;
  m.events.push({ type: 'toothSnap', tooth, n: m.snaps });
}

// ------------------------------------------------------------------ bugs

const bugP = { x: 0, y: 0, z: 0 };
const bugQ = { x: 0, y: 0, z: 0 };

function tickBugs(m: CleanModel, dt: number, tool: { tooth: number; u: number; v: number } | null | undefined) {
  for (const b of m.bugs) {
    if (!b.alive) continue;
    const p = m.placements[b.tooth];
    let speed = RATES.bugSpeed;
    // sidle away from a nearby tool
    if (tool && tool.tooth >= 0) {
      let near = false, fu = 0, fv = 0;
      if (tool.tooth === b.tooth) {
        const d = surfaceDistance(m, b.tooth, b.u, b.v, tool.u, tool.v);
        if (d < RATES.bugFleeRadius) { near = true; fu = b.u - tool.u; fv = b.v - tool.v; }
      } else if (Math.abs(tool.tooth - b.tooth) === 1) {
        toMouth(p, ...ip(p, b.u, b.v), bugP);
        const tp = m.placements[tool.tooth];
        toMouth(tp, ...ip(tp, tool.u, tool.v), bugQ);
        const d = Math.hypot(bugP.x - bugQ.x, bugP.y - bugQ.y, bugP.z - bugQ.z);
        if (d < RATES.bugFleeRadius) { near = true; fu = sideU(p, tool.tooth) > 0.5 ? -1 : 1; fv = 0; }
      }
      if (near) {
        const l = Math.hypot(fu, fv) || 1;
        b.du = fu / l; b.dv = fv / l;
        b.fleeing = 0.4;
      }
    }
    if (b.fleeing > 0) { b.fleeing -= dt; speed = RATES.bugFlee; }
    else if (m.rng.chance(dt * 0.8)) { const a = m.rng.range(0, Math.PI * 2); b.du = Math.cos(a); b.dv = Math.sin(a); }
    const circ = Math.PI * (p.width + p.depth) / 2;
    const pu = b.u, pv = b.v;
    b.u += (b.du * speed * dt) / circ;
    b.v += (b.dv * speed * dt) / p.height;
    // bugs stay where a tool can reach them
    if (b.u >= 0.33 && b.u <= 0.67 && !m.teeth[b.tooth].vis[cellAt(b.u, b.v)] && m.teeth[b.tooth].vis[cellAt(pu, pv)]) {
      b.u = pu; b.v = pv; b.du = -b.du; b.dv = -b.dv;
    }
    if (b.v < 0.2) { b.v = 0.2; b.dv = Math.abs(b.dv); }
    if (b.v > 0.78) { b.v = 0.78; b.dv = -Math.abs(b.dv); }
    if (b.u < 0.33 || b.u > 0.67) {
      const plus = b.u > 0.67;
      const n = neighbourToward(p, plus);
      if (n >= 0 && m.teeth[n].present && (b.fleeing > 0 || m.rng.chance(0.3))) {
        b.tooth = n;
        b.u = plus ? 0.35 : 0.65;
      } else {
        b.u = clamp(b.u, 0.33, 0.67);
        b.du = -b.du;
      }
    }
    // a bug on a finished tooth wanders off to one that still has plaque to eat
    if (m.teeth[b.tooth].snapped) {
      const open = m.problem.filter((i) => !m.teeth[i].snapped);
      if (open.length) { b.tooth = m.rng.pick(open); b.u = m.rng.range(0.4, 0.6); b.v = m.rng.range(0.3, 0.6); }
    }
    b.spread -= dt;
    if (b.spread <= 0) {
      b.spread = RATES.bugSpread;
      b.lastSpread = m.time;
      spreadPlaque(m, b);
    }
  }
}

function ip(p: ToothPlacement, u: number, v: number): [number, number, number] {
  const o = idealPoint(u, v, p.width, p.height, p.depth, tmpP);
  return [o.x, o.y, o.z];
}

function spreadPlaque(m: CleanModel, b: SugarBug) {
  const t = m.teeth[b.tooth];
  if (!t.present) return;
  let added = 0;
  forBrush(m, b.tooth, b.u, b.v, 0.2, (i, f) => {
    if (!t.vis[i]) return;
    const p0 = t.plaque[i];
    const p1 = Math.min(1, Math.max(p0, 0.55 + 0.45 * f));
    added += p1 - p0;
    t.plaque[i] = p1;
  });
  if (added <= 0) return;
  t.changed = true;
  if (t.problem && !t.snapped) t.plaqueAdded += added;
  m.events.push({ type: 'bugSpread', bug: b });
}

// ------------------------------------------------------------------ comfort, twists, time

export interface TickInput {
  dt: number;
  working: boolean;         // a tool is touching the mouth this frame
  molar: boolean;           // touching a molar
  gum: boolean;             // scaler on gum tissue (or a tooth cell with v < 0.02)
  gumRisk: number;          // the active tool's gum risk
  headphones: boolean;
  numbing: boolean;
  scaling?: boolean;        // a scaler or ultrasonic is working this frame (hiccup jolts slip)
  tool?: { tooth: number; u: number; v: number } | null;   // where the tool is (sugar bugs flee)
}

export function tickModel(m: CleanModel, inp: TickInput): void {
  if (m.walkout) return;
  const dt = inp.dt;
  const tr = m.setup.traits;
  const mods = m.setup.mods;
  const tw = m.tw;
  m.time += dt;
  if (m.jawClosed > 0) m.jawClosed = Math.max(0, m.jawClosed - dt);
  if (m.reassureCd > 0) m.reassureCd = Math.max(0, m.reassureCd - dt);
  if (m.time - m.lastPop > RATES.comboWindow) m.combo = 0;

  let c = m.comfort;
  c -= 0.35 * tr.comfortDrain * (inp.headphones ? 0.75 : 1) * mods.comfortDrain * (m.caseType === 'deep' ? 1.5 : 1) * dt;
  if (m.water > WATER_DISCOMFORT) c -= 3 * dt;
  // Sensitive Gums arrives already folded into traits.gumSensitivity (x2) by the sim (DESIGN 5.5 sim notes)
  const sens = tr.gumSensitivity;

  // gum contact
  const touchingGum = inp.gum && inp.working && m.jawClosed <= 0;
  if (touchingGum) {
    m.gumTime += dt;
    if (m.gumTime >= GUM_CONTACT_DELAY) {
      c -= 8 * inp.gumRisk * sens * mods.gumDamage * (inp.numbing ? 0.5 : 1) * dt;
      m.lastHurt = m.time;
      if (!m.gumHurting) { m.gumHurting = true; m.gumHits++; m.events.push({ type: 'ow' }); }
    }
  } else {
    m.gumTime = 0;
    m.gumHurting = false;
  }

  // gag reflex: continuous work on a molar, with a warning build-up
  if (tw.gag) {
    if (inp.working && inp.molar && m.jawClosed <= 0) { m.molarTime += dt; m.molarIdle = 0; }
    else { m.molarIdle += dt; if (m.molarIdle > 0.5) { m.molarTime = 0; m.gagWarned = false; } }
    const limit = GAG_SECONDS + mods.gagDelay;
    if (!m.gagWarned && m.molarTime > limit * GAG_WARN) { m.gagWarned = true; m.events.push({ type: 'gagWarn' }); }
    if (m.molarTime > limit) {
      m.molarTime = 0;
      m.gagWarned = false;
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
  if (!tw.chatty) {
    m.lineTimer -= dt;
    if (m.lineTimer <= 0) {
      m.lineTimer = m.rng.range(24, 38);
      if (m.setup.lines.length) m.events.push({ type: 'chat', line: pickLine(m), closesJaw: false });
    }
  }

  // hiccups: "hic", then 0.8 s later the mouth jolts; a scaler touching the mouth during the jolt slips
  if (tw.hiccups) {
    m.hicTimer -= dt;
    if (m.hicTimer <= 0 && m.joltIn < 0 && m.jolt <= 0) {
      m.hicTimer = m.rng.range(10, 16);
      m.joltIn = 0.8;
      m.events.push({ type: 'hic' });
    }
    if (m.joltIn >= 0) {
      m.joltIn -= dt;
      if (m.joltIn < 0) { m.jolt = 0.35; m.joltHit = false; m.events.push({ type: 'jolt' }); }
    }
    if (m.jolt > 0) {
      m.jolt -= dt;
      if (inp.scaling && !m.joltHit) {
        m.joltHit = true;
        m.gumHits++;
        c -= 6 * sens * mods.gumDamage * (inp.numbing ? 0.5 : 1);
        m.lastHurt = m.time;
        m.events.push({ type: 'ow' });
      }
    }
  }

  // sleepy: dozes off every 20 to 30 s, the jaw closes over 4 s until nudged
  if (tw.sleepy) {
    if (!m.dozing) {
      m.dozeTimer -= dt;
      if (m.dozeTimer <= 0) { m.dozing = true; m.snoreT = 0; m.events.push({ type: 'doze' }); }
      m.doze = Math.max(0, m.doze - dt * 2);
    } else {
      m.doze = Math.min(1, m.doze + dt / DOZE_CLOSE);
    }
  }

  // case clocks
  if (m.bugs.length) tickBugs(m, dt, inp.tool);
  for (const t of m.teeth) if (t.lampRun > 0 && t.lampFrame !== m.frame) t.lampRun = Math.max(0, t.lampRun - dt * 3);
  for (const pk of m.pockets) if (!pk.opened && pk.open > 0 && pk.held !== m.frame) pk.open = Math.max(0, pk.open - dt * 1.5);

  m.comfort = clamp(c, 0, 100);
  updateObjectives(m);
  m.frame++;
  if (m.comfort <= 0) {
    m.walkout = true;
    m.events.push({ type: 'walkout' });
  }
}

function pickLine(m: CleanModel): string {
  const lines = m.setup.lines;
  return lines.length ? lines[Math.floor(m.rng.next() * lines.length)] : 'Mmhm.';
}

/** Reassure (or Nudge a dozing patient awake). Returns false while on cooldown and nothing happened. */
export function reassure(m: CleanModel): boolean {
  if (m.walkout) return false;
  let woke = false;
  if (m.tw.sleepy && (m.dozing || m.doze > 0)) {
    m.dozing = false;
    m.dozeTimer = m.rng.range(20, 30);
    woke = true;
    m.events.push({ type: 'wake' });
  }
  if (m.reassureCd > 0) return woke;
  const amount = REASSURE_AMOUNT * m.setup.mods.reassure;
  m.comfort = clamp(m.comfort + amount, 0, 100);
  m.reassureCd = REASSURE_COOLDOWN;
  m.events.push({ type: 'reassure', amount });
  return true;
}

// ------------------------------------------------------------------ objectives (DESIGN 5.5, 5.8)

const OBJ_LABEL: Record<ObjectiveId, string> = {
  tartar: 'Pop the tartar', barnacles: 'Crack the barnacles', plaque: 'Clear the plaque', stain: 'Polish out the stains',
  debris: 'Floss out the food', bugs: 'Squash the sugar bugs', seal: 'Seal the molars', gel: 'Paint gel on the fronts',
  cure: 'Whiten with the lamp', gold: 'Buff the gold tooth', pockets: 'Open the gum pockets', hidden: 'Scrape out the hidden tartar',
  finish: 'Rinse and suction',
};

function obj(id: ObjectiveId, label: string, count = 0): Objective {
  return { id, label, progress: 0, done: false, count, have: 0 };
}

function buildObjectives(m: CleanModel): Objective[] {
  const c = m.caseType;
  const out: Objective[] = [];
  const nTartar = m.tartar.filter((d) => d.kind === 'tartar').length;
  const nBarn = m.tartar.filter((d) => d.kind === 'barnacle').length;
  const nHidden = m.tartar.filter((d) => d.kind === 'hidden').length;
  const food = m.debris.filter((d) => d.kind !== 'doubloon' && d.kind !== 'seaweed').length;
  const weed = m.debris.filter((d) => d.kind === 'seaweed').length;
  const plaque = m.problem.some((i) => m.teeth[i].plaque0 > 0.5);
  const stain = m.problem.some((i) => m.teeth[i].stain0 > 0.5);
  switch (c) {
    case 'candy':
      if (m.bugs.length) out.push(obj('bugs', OBJ_LABEL.bugs, m.bugs.length));
      if (food) out.push(obj('debris', 'Floss out the gummies', food));
      if (plaque || m.bugs.length) out.push(obj('plaque', OBJ_LABEL.plaque));
      if (m.teeth.some((t) => t.sealTarget)) out.push(obj('seal', OBJ_LABEL.seal, m.teeth.filter((t) => t.sealTarget).length));
      if (nTartar && out.length < 4) out.push(obj('tartar', OBJ_LABEL.tartar, nTartar));
      break;
    case 'whitening': {
      if (stain) out.push(obj('stain', 'Polish the stains'));
      const nGel = m.teeth.filter((t) => t.gelTarget).length;
      if (nGel) {
        out.push(obj('gel', OBJ_LABEL.gel, nGel));
        out.push(obj('cure', `Whiten to shade ${Math.max(1, m.setup.special?.targetShade || 1)}`));
      }
      if (nTartar && out.length < 4) out.push(obj('tartar', OBJ_LABEL.tartar, nTartar));
      break;
    }
    case 'braces':
      if (food) out.push(obj('debris', 'Clear the brackets', food));
      if (plaque) out.push(obj('plaque', 'Plaque by the brackets'));
      if (nTartar) out.push(obj('tartar', OBJ_LABEL.tartar, nTartar));
      break;
    case 'pirate':
      if (nBarn) out.push(obj('barnacles', OBJ_LABEL.barnacles, nBarn));
      if (weed) out.push(obj('debris', 'Floss out the seaweed', weed));
      if (m.teeth.some((t) => t.gold)) out.push(obj('gold', OBJ_LABEL.gold));
      if (nTartar) out.push(obj('tartar', OBJ_LABEL.tartar, nTartar));
      if (out.length < 4 && (plaque || stain)) out.push(obj(stain ? 'stain' : 'plaque', stain ? OBJ_LABEL.stain : OBJ_LABEL.plaque));
      break;
    case 'deep':
      if (m.pockets.length) out.push(obj('pockets', OBJ_LABEL.pockets, m.pockets.length));
      if (nHidden) out.push(obj('hidden', OBJ_LABEL.hidden, nHidden));
      if (nTartar) out.push(obj('tartar', OBJ_LABEL.tartar, nTartar));
      if (out.length < 4 && plaque) out.push(obj('plaque', OBJ_LABEL.plaque));
      break;
    default:
      if (nTartar) out.push(obj('tartar', OBJ_LABEL.tartar, nTartar));
      if (plaque) out.push(obj('plaque', OBJ_LABEL.plaque));
      if (stain) out.push(obj('stain', OBJ_LABEL.stain));
      if (food) out.push(obj('debris', OBJ_LABEL.debris, food));
      break;
  }
  out.push(obj('finish', OBJ_LABEL.finish));
  return out;
}

/** Area progress of a layer over the problem teeth: removing 80% of a tooth's layer counts as all; a snapped tooth counts as 1. */
function areaProgress(m: CleanModel, layer: 'plaque' | 'stain'): number {
  let w = 0, got = 0;
  for (const i of m.problem) {
    const t = m.teeth[i];
    const init = layer === 'plaque' ? t.plaque0 + t.plaqueAdded : t.stain0;
    if (init <= 0.5) continue;
    let cur = 0;
    const arr = t[layer];
    for (let c = 0; c < CELLS; c++) cur += arr[c];
    const p = t.snapped ? 1 : clamp((1 - cur / init) / RATES.areaDone, 0, 1);
    w += init; got += init * p;
  }
  return w > 0 ? got / w : 1;
}

export function goldProgress(m: CleanModel): number {
  const t = m.teeth.find((x) => x.gold && x.present);
  if (!t) return 1;
  let s = 0, n = 0;
  for (let i = 0; i < CELLS; i++) { if (!t.vis[i]) continue; s += t.polish[i]; n++; }
  return n ? clamp(s / n / RATES.areaDone, 0, 1) : 1;
}

/** 0..1 how much is left to rinse or suction (paste, whitening gel, resting and floating bits, water). */
export function messState(m: CleanModel): { paste: number; gel: number; resting: number; floating: number; water: number } {
  let paste = 0, gel = 0;
  const whitening = m.caseType === 'whitening';
  for (const t of m.teeth) {
    if (!t.present) continue;
    for (let i = 0; i < CELLS; i++) {
      if (t.paste[i] > 0.03) paste++;
      if (whitening && t.gel[i] > 0.03) gel++;
    }
  }
  let resting = 0, floating = 0;
  for (const b of m.bits) { if (b.state === 'resting') resting++; else if (b.state === 'floating') floating++; }
  return { paste, gel, resting, floating, water: m.water };
}

function progressOf(m: CleanModel, o: Objective): number {
  const countDone = (n: number) => { o.have = n; return o.count ? n / o.count : 1; };
  switch (o.id) {
    case 'tartar': return countDone(m.tartar.filter((d) => d.kind === 'tartar' && d.popped).length);
    case 'barnacles': return countDone(m.tartar.filter((d) => d.kind === 'barnacle' && d.popped).length);
    case 'hidden': return countDone(m.tartar.filter((d) => d.kind === 'hidden' && d.popped).length);
    case 'pockets': return countDone(m.pockets.filter((p) => p.opened).length);
    case 'debris': return countDone(m.debris.filter((d) => d.popped && d.kind !== 'doubloon' && (m.caseType !== 'pirate' || d.kind === 'seaweed')).length);
    case 'bugs': return countDone(m.bugs.filter((b) => !b.alive).length);
    case 'seal': return countDone(m.teeth.filter((t) => t.sealTarget && t.gelled).length);
    case 'gel': return countDone(m.teeth.filter((t) => t.gelTarget && t.gelled).length);
    case 'plaque': return areaProgress(m, 'plaque');
    case 'stain': return areaProgress(m, 'stain');
    case 'gold': return goldProgress(m);
    case 'cure': {
      const s0 = m.setup.special?.startShade || 12;
      const tgt = Math.max(1, m.setup.special?.targetShade || 1);
      if (s0 <= tgt) return 1;
      // done once the meter reads the goal (within a third of a shade)
      return clamp((s0 - meanShade(m)) / Math.max(0.5, s0 - tgt - 0.34), 0, 1);
    }
    case 'finish': {
      if (!m.messEver) return 0;
      const s = messState(m);
      const left = Math.min(1, s.paste / 120) * 0.35 + Math.min(1, (s.resting + s.floating) / Math.max(4, m.bitsCreated)) * 0.35
        + Math.min(1, s.gel / 120) * 0.15 + clamp(s.water / 0.5, 0, 1) * 0.15;
      const clear = s.paste === 0 && s.gel === 0 && s.resting === 0 && s.floating === 0 && s.water < 0.1;
      return clear ? 1 : Math.min(0.95, 1 - left);
    }
  }
}

/** Recompute every objective; a newly finished one pushes an 'objective' event. */
export function updateObjectives(m: CleanModel, silent = false): void {
  for (const o of m.objectives) {
    const p = clamp(progressOf(m, o), 0, 1);
    o.progress = p;
    const done = p >= 0.999;
    if (done && !o.done && !silent) m.events.push({ type: 'objective', obj: o });
    o.done = done;
  }
}

// ------------------------------------------------------------------ scoring (DESIGN 5.8)

export interface Fractions {
  tartar: number; plaque: number; stain: number; debris: number; polish: number; mess: number; clean: number;
}

/** Legacy fractions (stats) over the problem teeth, plus clean = mean objective progress. */
export function fractions(m: CleanModel): Fractions {
  let p = 0, p0 = 0, s = 0, s0 = 0, pol = 0, vis = 0;
  for (const i of m.problem) {
    const t = m.teeth[i];
    p0 += t.plaque0 + t.plaqueAdded; s0 += t.stain0;
    for (let c = 0; c < CELLS; c++) {
      p += t.plaque[c]; s += t.stain[c];
      if (t.vis[c]) { pol += t.polish[c]; vis++; }
    }
  }
  let th = 0;
  for (const d of m.tartar) th += d.hp;
  let dh = 0;
  for (const d of m.debris) dh += d.hp;
  const tartar = m.totalTartarHp > 0 ? clamp(1 - th / m.totalTartarHp, 0, 1) : 1;
  const debris = m.totalDebrisHp > 0 ? clamp(1 - dh / m.totalDebrisHp, 0, 1) : 1;
  const plaque = p0 > 0 ? clamp(1 - p / p0, 0, 1) : 1;
  const stain = s0 > 0 ? clamp(1 - s / s0, 0, 1) : 1;
  const polish = vis > 0 ? clamp(pol / vis, 0, 1) : 0;
  const fin = m.objectives.find((o) => o.id === 'finish');
  const mess = fin ? (m.messEver ? 1 - fin.progress : 0) : 0;
  return { tartar, plaque, stain, debris, polish, mess, clean: cleanScore(m) };
}

export function cleanScore(m: CleanModel): number {
  if (!m.objectives.length) return 0;
  let s = 0;
  for (const o of m.objectives) s += o.progress;
  return s / m.objectives.length;
}

export function starsFor(quality: number): number {
  return quality >= 0.92 ? 5 : quality >= 0.8 ? 4 : quality >= 0.65 ? 3 : quality >= 0.45 ? 2 : 1;
}

export function qualityFor(clean: number, comfort: number, walkout: boolean): number {
  const q = clamp(0.8 * clean + 0.2 * (comfort / 100), 0, 1);
  return walkout ? Math.min(q, 0.25) : q;
}

export const CASE_PAR_EXTRA: Record<CaseType, number> = { routine: 0, whitening: 25, candy: 10, braces: 15, pirate: 20, deep: 25 };

/** par = (20 + 2.6*tartarHp + 5*problemTeeth + 4*debris + case extra) * parMult (DESIGN 5.8). */
export function parFor(setup: Pick<CleanSetup, 'dirt' | 'mods'> & Partial<Pick<CleanSetup, 'caseType' | 'special' | 'problemTeeth'>>): number {
  const d = setup.dirt;
  const sp = setup.special;
  const c = setup.caseType ?? 'routine';
  let hp = d.tartarCount * d.tartarSize;
  if (c === 'pirate') hp += (sp?.barnacles ?? 0) * 2;
  if (c === 'deep') hp += (sp?.pockets ?? 0) * 1.5 * d.tartarSize;
  let debris = d.debrisCount;
  if (c === 'pirate') debris += (sp?.seaweed ?? 0) + (sp?.treasure ? 1 : 0);
  const n = setup.problemTeeth?.length ?? 0;
  return (20 + 2.6 * hp + 5 * n + 4 * debris + CASE_PAR_EXTRA[c]) * setup.mods.parMult;
}

/** Is the bonus met right now (seconds = clean time so far)? null bonus counts as met. */
export function bonusState(m: CleanModel, seconds: number, final = false): 'met' | 'open' | 'failed' {
  const b: BonusId | null = m.setup.bonus ?? null;
  if (!b) return 'met';
  switch (b) {
    case 'noSlips': return m.gumHits > 0 ? 'failed' : final ? 'met' : 'open';
    case 'fast': return seconds > m.setup.parSeconds ? 'failed' : final ? 'met' : 'open';
    case 'combo': return m.bestCombo >= 4 ? 'met' : final ? 'failed' : 'open';
    case 'spotless': return m.problem.every((i) => m.teeth[i].snapped) ? 'met' : final ? 'failed' : 'open';
    case 'treasure': return m.treasure ? 'met' : final ? 'failed' : 'open';
  }
}

export function scoreClean(m: CleanModel, quit: CleanResult['quit'], seconds: number): CleanResult {
  updateObjectives(m, true);
  const f = fractions(m);
  const walkout = quit === 'walkout' || m.walkout;
  const quality = qualityFor(f.clean, m.comfort, walkout);
  const bonusMet = !walkout && quit !== 'abort' && bonusState(m, seconds, true) === 'met';
  const allDone = m.objectives.every((o) => o.done);
  const s0 = m.setup.special?.startShade || 0;
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
    perfect: !walkout && quit === 'done' && allDone && bonusMet,
    caseType: m.caseType,
    objectives: m.objectives.map((o) => ({ id: o.id, label: o.label, progress: o.progress, done: o.done })),
    bonusMet,
    treasure: m.treasure,
    shadeGain: m.caseType === 'whitening' && s0 > 0 ? Math.max(0, Math.round(s0 - meanShade(m))) : 0,
    before: null,
    after: null,
  };
}

// ------------------------------------------------------------------ debug / cheats

/**
 * Move every objective `frac` of the way: pop that share of deposits (opening pockets first), debris and
 * bugs, remove that share of plaque and stain, paint and cure, buff the gold tooth, and tidy that share of
 * the mess. cheat(1) finishes every objective.
 */
export function cheat(m: CleanModel, frac: number): void {
  const f = clamp(frac, 0, 1);
  const closed = m.pockets.filter((p) => !p.opened);
  for (const pk of closed.slice(0, f >= 1 ? closed.length : Math.round(closed.length * f))) {
    pk.open = 1; pk.opened = true;
    for (const id of pk.deps) { const d = m.tartar.find((x) => x.id === id); if (d) d.hidden = false; }
    m.events.push({ type: 'pocketOpen', pocket: pk });
  }
  for (const t of m.teeth) {
    if (!t.present) continue;
    for (let i = 0; i < CELLS; i++) {
      if (!t.reach[i]) continue;
      t.plaque[i] *= 1 - f;
      t.stain[i] *= 1 - f;
      if (t.plaque[i] < RATES.cleanEps) t.plaque[i] = 0;
      if (t.stain[i] < RATES.cleanEps) t.stain[i] = 0;
      if (t.gold || t.problem) t.polish[i] = Math.max(t.polish[i], f);
    }
    t.changed = true;
  }
  const tl = m.tartar.filter((d) => !d.popped && !d.hidden);
  const nT = f >= 1 ? tl.length : Math.round(tl.length * f);
  for (let k = 0; k < nT; k++) damageTartar(m, tl[k], tl[k].hp + 1);
  const dl = m.debris.filter((d) => !d.popped);
  const nD = f >= 1 ? dl.length : Math.round(dl.length * f);
  for (let k = 0; k < nD; k++) hitDebris(m, dl[k], dl[k].hp + 1);
  const bl = m.bugs.filter((b) => b.alive);
  const nB = f >= 1 ? bl.length : Math.round(bl.length * f);
  for (let k = 0; k < nB; k++) { bl[k].alive = false; m.events.push({ type: 'bugSquash', bug: bl[k], combo: 1 }); }
  // gel, sealant and shade
  const gt = m.teeth.filter((t) => (t.gelTarget || t.sealTarget) && !t.gelled && t.present);
  const nG = f >= 1 ? gt.length : Math.round(gt.length * f);
  for (let k = 0; k < nG; k++) { gt[k].gelled = true; m.events.push({ type: 'gelDone', tooth: gt[k].index, seal: gt[k].sealTarget }); }
  if (m.caseType === 'whitening') {
    const s0 = m.setup.special?.startShade || 12;
    const tgt = Math.max(1, m.setup.special?.targetShade || 1);
    for (const t of m.teeth) if (t.gelTarget) { t.shade = Math.max(tgt, Math.min(t.shade, Math.round(s0 - (s0 - tgt) * f))); t.changed = true; }
  }
  // mess: resting bits float, then that share is sucked up with the water, paste and gel
  const bits = m.bits.filter((b) => b.state !== 'gone');
  const nb = f >= 1 ? bits.length : Math.round(bits.length * f);
  for (let k = 0; k < nb; k++) { bits[k].state = 'gone'; m.events.push({ type: 'bitSucked', bit: bits[k] }); }
  for (const t of m.teeth) {
    for (let i = 0; i < CELLS; i++) {
      t.paste[i] *= 1 - f; if (t.paste[i] < 0.03) t.paste[i] = 0;
      if (m.caseType === 'whitening') { t.gel[i] *= 1 - f; if (t.gel[i] < 0.03) t.gel[i] = 0; }
    }
    if (t.pasteOn && f >= 1) t.pasteOn = false;
  }
  m.water *= 1 - f;
  if (f > 0) m.messEver = true;
  for (const i of m.problem) checkSnap(m, i);
  const gold = m.teeth.find((t) => t.gold);
  if (gold && !gold.goldShine && goldProgress(m) >= 1) { gold.goldShine = true; m.events.push({ type: 'goldShine', tooth: gold.index }); }
  updateObjectives(m);
}

export function bitsLeft(m: CleanModel): number {
  let n = 0;
  for (const b of m.bits) if (b.state !== 'gone') n++;
  return n;
}
