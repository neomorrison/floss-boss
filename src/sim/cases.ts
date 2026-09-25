// Cases, twists, bonuses, mastery and the v2 hands-on CleanSetup. DESIGN 5.2 and 5.5 to 5.9.
import type {
  ArchetypeId, BonusId, CaseSpecial, CaseType, CleanSetup, Clinic, DirtProfile, GameState, PatientTraits, ServiceId, TwistId,
} from '../core/types';
import type { Rng } from '../core/rng';
import { clamp, hashSeed, makeRng } from '../core/rng';
import { ARCHETYPES } from '../data/patients';
import { CASES, CASE_ORDER, MASTERY_TIERS, TWISTS, problemToothCount } from '../data/cases';
import { TOOLS } from '../data/tools';
import type { ToolLoadout } from '../core/types';
import { opStaffed } from './internal';
import { cleanMods, tierIndex } from './progress';
import { cleanRules, comfortDrainMult, diff, maxTwists } from './difficulty';

// ------------------------------------------------------------------ mastery (5.9)

export function masteryTier(count: number): 0 | 1 | 2 | 3 {
  let t = 0;
  for (const n of MASTERY_TIERS) if (count >= n) t++;
  return t as 0 | 1 | 2 | 3;
}

export function masteryCount(state: GameState, ct: CaseType): number {
  const v = state.player.mastery?.[ct];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** Per-case mastery for the Cases tab: hands-on cleans of 3+ stars, tier, next threshold (null at gold). */
export function caseMastery(state: GameState, ct: CaseType): { count: number; tier: 0 | 1 | 2 | 3; next: number | null } {
  const count = masteryCount(state, ct);
  const tier = masteryTier(count);
  const tiers: readonly number[] = MASTERY_TIERS;
  return { count, tier, next: tier < tiers.length ? tiers[tier] : null };
}

// ------------------------------------------------------------------ case and twist picks

/** Difficulty level of a clean: the player level (employee), capped by the office tier as an owner. */
export function caseLevel(state: GameState, c: Clinic | null): number {
  const L = Math.max(1, state.player.level);
  if (state.phase === 'owner' && c) return Math.min(L, 4 + 2 * tierIndex(c.tier));
  return L;
}

/** Can this clinic take a case of this type right now (level gate; owner: the office must offer it). */
export function caseAllowed(state: GameState, c: Clinic, ct: CaseType): boolean {
  const def = CASES[ct];
  if (state.phase === 'school') return ct === 'routine';
  if (state.player.level < def.minLevel) return false;
  if (!c.ownedByPlayer) return true;
  if (def.requires === 'whiteningLamp') return c.ops.some((o) => o.upgrades.includes('whiteningLamp') && opStaffed(state, c, o));
  if (def.requires === 'deepCert') return c.equipment.includes('deepCert');
  return true;
}

/**
 * Pick a case for an archetype. `avoid` (the previous shift patient's case) is skipped when anything
 * else is possible. Owner phase: whitening odds follow the whitening price like an add-on would.
 */
export function pickCase(state: GameState, c: Clinic, arch: ArchetypeId, rng: Rng, avoid: CaseType | null = null): CaseType {
  const w = (ct: CaseType) => caseWeight(state, c, arch, ct);
  let total = 0;
  let others = 0;
  for (const ct of CASE_ORDER) { const x = w(ct); total += x; if (ct !== avoid) others += x; }
  if (total <= 0) return 'routine';
  const skip = avoid != null && others > 0;
  return rng.weighted(CASE_ORDER, (ct) => (skip && ct === avoid ? 0 : w(ct)));
}

/** Relative odds of a case for an archetype at a clinic (0 when the clinic cannot take it). Owner phase:
 * whitening odds follow the whitening price like an add-on would. */
export function caseWeight(state: GameState, c: Clinic, arch: ArchetypeId, ct: CaseType): number {
  if (!caseAllowed(state, c, ct)) return 0;
  const base = CASES[ct].weight[arch] ?? 0;
  if (ct === 'whitening' && c.ownedByPlayer) return base * Math.pow(c.prices.whitening ?? 1, -2);
  return base;
}

/** The patient's bonus objective, decided at booking so the chair card can show it (DESIGN 5.6). A pirate
 * brings a doubloon 70% of the time (then the bonus is to find it); combos need 4+ deposits (routine,
 * pirate and deep cases). */
export function pickBonus(state: GameState, patientId: string, ct: CaseType): BonusId {
  const r = makeRng(hashSeed(state.seed, patientId, state.day, 'bonus'));
  if (ct === 'pirate' && r.chance(0.7)) return 'treasure';
  const opts: BonusId[] = ['noSlips', 'fast', 'spotless'];
  if (ct === 'routine' || ct === 'pirate' || ct === 'deep' || ct === 'grillz') opts.push('combo');
  return opts[r.int(0, opts.length - 1)];
}

/** An archetype likely to bring this case (for scheduling a newly unlocked case). */
export function archetypeForCase(ct: CaseType, rng: Rng): ArchetypeId {
  const entries = Object.entries(CASES[ct].weight).filter(([, v]) => (v ?? 0) > 0) as [ArchetypeId, number][];
  if (!entries.length) return 'regular';
  return rng.weighted(entries, (e) => e[1])[0];
}

/** Archetype traits map to twists (chatty, gag reflex, fidget); more twists unlock with level (TWISTS). */
export function pickTwists(state: GameState, arch: ArchetypeId, rng: Rng): TwistId[] {
  const L = Math.max(1, state.player.level);
  const max = maxTwists(state, L);
  const a = ARCHETYPES[arch].traits;
  const out: TwistId[] = [];
  if (a.chatty) out.push('chatty');
  if (a.gag) out.push('gagger');
  if (a.fidget > 0) out.push('fidget');
  const pool = (Object.keys(TWISTS) as TwistId[]).filter((t) => TWISTS[t].minLevel <= L && !out.includes(t));
  const first = L >= 4 ? 0.5 : L >= 2 ? 0.3 : 0;
  let p = out.length ? 0.25 : first;
  while (out.length < max && pool.length && rng.chance(p)) {
    const t = rng.pick(pool);
    out.push(t);
    pool.splice(pool.indexOf(t), 1);
    p = 0.25;
  }
  return out.slice(0, max);
}

// ------------------------------------------------------------------ setup

export function emptySpecial(): CaseSpecial {
  return { goldTooth: null, braces: false, startShade: 0, targetShade: 0, sugarBugs: 0, sealants: 0, pockets: 0, treasure: false, barnacles: 0, seaweed: 0, grillGems: 0, showcase: false };
}

/** Case extra par seconds (DESIGN 5.8). */
const PAR_EXTRA: Record<CaseType, number> = { routine: 0, whitening: 25, candy: 10, braces: 15, pirate: 20, deep: 25, grillz: 20 };
/** Grill Glow-Up: seconds of par per diamond to buff (DESIGN 11.6). */
export const PAR_PER_GEM = 2.5;
/** Grill gems: 6 to 10 on a normal visit, 12 at the Golden Molar Gala showcase. */
export const GRILL_GEMS: [number, number] = [6, 10];
export const SHOWCASE_GEMS = 12;
/** The grill covers the upper front six (arch positions 4 to 9 of the upper arch). */
export const GRILL_TEETH = [4, 5, 6, 7, 8, 9];

/** par = (20 + 2.6 tartarHp + 5 problemTeeth + 4 debris + case extra) * parMult (DESIGN 5.8). */
export function parSeconds(d: DirtProfile, problemTeeth: number, sp: CaseSpecial, ct: CaseType, parMult: number): number {
  const hidden = sp.pockets * 1.5 * d.tartarSize;
  const tartarHp = d.tartarCount * d.tartarSize + sp.barnacles * 2 + hidden;
  const debris = d.debrisCount + sp.seaweed + (sp.treasure ? 1 : 0);
  return Math.round((20 + 2.6 * tartarHp + 5 * problemTeeth + 4 * debris + (PAR_EXTRA[ct] ?? 0) + PAR_PER_GEM * (sp.grillGems ?? 0)) * parMult);
}

export function loadout(state: GameState, useGel: boolean): ToolLoadout {
  const t = state.player.tools;
  const cap = (slot: keyof typeof TOOLS, v: number) => clamp(Math.round(v) || 1, 1, TOOLS[slot].length);
  return {
    scaler: cap('scaler', t.scaler),
    polisher: cap('polisher', t.polisher),
    floss: cap('floss', t.floss),
    suction: cap('suction', t.suction),
    rinse: cap('rinse', t.rinse),
    extras: [...state.player.extras],
    numbingGel: useGel,
  };
}

const FRONT = (i: number) => { const pos = i % 14; return pos >= 4 && pos <= 9; };
const BRACE = (i: number) => { const pos = i % 14; return pos >= 2 && pos <= 11; };

function missingTeethFor(arch: ArchetypeId, r: Rng): number[] {
  const [lo, hi] = ARCHETYPES[arch].missing;
  if (hi <= 0) return [];
  const n = r.int(lo, hi);
  // prefer molars and premolars; never a central incisor
  const pool = Array.from({ length: 28 }, (_, i) => i).filter((i) => ![6, 7, 20, 21].includes(i));
  const out: number[] = [];
  while (out.length < n && pool.length) {
    const t = r.weighted(pool, (i) => { const pos = i % 14; return pos <= 3 || pos >= 10 ? 3 : 1; });
    out.push(t);
    pool.splice(pool.indexOf(t), 1);
  }
  return out.sort((a, b) => a - b);
}

/** `n` teeth from `pool`, alternating upper and lower arch so the case spreads over the views. */
function spreadPick(pool: number[], n: number, r: Rng): number[] {
  const shuffle = (xs: number[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = r.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const up = shuffle(pool.filter((i) => i < 14));
  const lo = shuffle(pool.filter((i) => i >= 14));
  const out: number[] = [];
  let turn = r.chance(0.5);
  while (out.length < n && (up.length || lo.length)) {
    const src = (turn && up.length) || !lo.length ? up : lo;
    out.push(src.shift() as number);
    turn = !turn;
  }
  return out.sort((a, b) => a - b);
}

export interface SetupInput {
  patientId: string;
  name: string;
  archetype: ArchetypeId;
  service: ServiceId;
  caseType: CaseType;
  twists: TwistId[];
  dirtLevel: number;        // 0..1
  level: number;            // difficulty level (caseLevel)
  tutorial: boolean;
  consumeGel: boolean;
  firstOfCase: boolean;
  school?: 1 | 2;
  /** The patient's booked bonus (DayPatient.bonus). Undefined: decided here from the seed. */
  bonus?: BonusId | null;
  /** Laughing gas at this chair: calmer start, slower comfort drain. */
  gas?: boolean;
  /** The Golden Molar Gala showcase (DESIGN 11.3): the most gems, on stage. */
  showcase?: boolean;
}

/** The v2 CleanSetup per the spawn contract (DESIGN 5.5 table). Deterministic from the seed. */
export function buildCaseSetup(state: GameState, o: SetupInput): CleanSetup {
  const seed = hashSeed(state.seed, o.patientId, state.day);
  const r = makeRng(hashSeed(seed, 'case'));
  const a = ARCHETYPES[o.archetype];
  const L = Math.max(1, o.level);
  const ct = o.caseType;
  const dl = clamp(Number.isFinite(o.dirtLevel) ? o.dirtLevel : 0.5, 0, 1);
  const missing = o.school ? [] : missingTeethFor(o.archetype, makeRng(hashSeed(seed, 'missing')));
  const present = Array.from({ length: 28 }, (_, i) => i).filter((i) => !missing.includes(i));
  const sp = emptySpecial();
  if (ct === 'pirate') {
    const fronts = present.filter((i) => FRONT(i));
    sp.goldTooth = fronts.length ? r.pick(fronts) : null;
  }
  const pool = present.filter((i) => i !== sp.goldTooth && (ct === 'whitening' ? FRONT(i) : ct === 'braces' ? BRACE(i) : true));
  const count = Math.min(pool.length, ct === 'whitening' ? r.int(4, 6) : problemToothCount(L));
  let problemTeeth: number[];
  if (ct === 'grillz') {
    // the upper front six sit under the grill; the rest of the count spreads over the other teeth
    const grill = GRILL_TEETH.filter((i) => present.includes(i));
    const rest = spreadPick(pool.filter((i) => !grill.includes(i)), Math.max(0, count - grill.length), r);
    problemTeeth = [...grill, ...rest].sort((a, b) => a - b);
  } else {
    problemTeeth = spreadPick(pool, count, r);
  }
  const n = problemTeeth.length;
  const lv = L - 1;
  let dirt: DirtProfile;
  switch (ct) {
    case 'candy':
      dirt = { tartarCount: 2, tartarSize: 0.7, plaque: 0.7, stain: 0.1, debrisCount: r.int(2, 4) };
      sp.sugarBugs = Math.min(8, 3 + Math.floor(L / 2));
      sp.sealants = L >= 3 ? 4 : 0;
      break;
    case 'whitening': {
      dirt = { tartarCount: 2, tartarSize: 1, plaque: 0.3, stain: 0.9, debrisCount: 0 };
      const dark = o.archetype === 'coffee' || o.archetype === 'smoker';
      sp.startShade = dark ? r.int(13, 15) : r.int(11, 13);
      sp.targetShade = Math.max(1, sp.startShade - r.int(6, 8));
      break;
    }
    case 'braces':
      dirt = { tartarCount: 3, tartarSize: 1, plaque: 0.7, stain: 0.2, debrisCount: r.int(3, 5) };
      sp.braces = true;
      break;
    case 'pirate':
      dirt = { tartarCount: 2, tartarSize: 1, plaque: 0.4, stain: 0.6, debrisCount: 0 };
      sp.barnacles = r.int(3, 5);
      sp.seaweed = r.int(2, 3);
      sp.treasure = r.chance(0.7);
      if (o.bonus !== undefined) sp.treasure = o.bonus === 'treasure';
      break;
    case 'deep':
      dirt = { tartarCount: r.int(3, 5), tartarSize: 1.2, plaque: 0.6, stain: 0.3, debrisCount: 1 };
      sp.pockets = Math.min(n, r.int(2, 4));
      break;
    case 'grillz':
      // plaque hides under the grill; a little tartar elsewhere
      dirt = { tartarCount: r.int(2, 4), tartarSize: 1.1, plaque: 0.8, stain: 0.3, debrisCount: 1 };
      sp.grillGems = o.showcase ? SHOWCASE_GEMS : r.int(GRILL_GEMS[0], GRILL_GEMS[1]);
      sp.showcase = !!o.showcase;
      break;
    default: {
      const tartar = Math.min(2 * n, Math.round(n * (1 + 0.1 * lv)));
      dirt = {
        tartarCount: Math.max(1, tartar),
        tartarSize: Math.round((1 + 0.3 * dl) * 100) / 100,
        plaque: Math.min(0.9, 0.5 + 0.05 * lv),
        stain: Math.round(clamp(a.dirt.stain * 0.6, 0, 1) * 100) / 100,
        debrisCount: Math.round(1 + L / 3),
      };
    }
  }
  if (o.school === 1) dirt = { tartarCount: 3, tartarSize: 1, plaque: 0.4, stain: 0.25, debrisCount: 1 };
  else if (o.school === 2) dirt = { tartarCount: 5, tartarSize: 1, plaque: 0.5, stain: 0.3, debrisCount: 1 };
  else {
    // difficulty (DESIGN 11.5): dirt amounts x dirtScale on top of the level scaling
    const ds = diff(state).dirtScale;
    if (ds !== 1) {
      dirt = {
        tartarCount: Math.max(1, Math.round(dirt.tartarCount * ds)),
        tartarSize: dirt.tartarSize,
        plaque: Math.round(clamp(dirt.plaque * ds, 0, 0.95) * 100) / 100,
        stain: Math.round(clamp(dirt.stain * ds, 0, 1) * 100) / 100,
        debrisCount: Math.round(dirt.debrisCount * ds),
      };
    }
  }
  const mods = cleanMods(state);
  let gel = false;
  if (o.consumeGel && state.player.useGel && state.player.numbingGel > 0) {
    gel = true;
    state.player.numbingGel -= 1;
  }
  const tw = o.twists;
  const traits: PatientTraits = {
    ...a.traits,
    chatty: tw.includes('chatty'),
    gag: tw.includes('gagger'),
    fidget: tw.includes('fidget') ? Math.max(0.5, a.traits.fidget) : 0,
    gumSensitivity: a.traits.gumSensitivity * (tw.includes('sensitive') ? 2 : 1),
  };
  // difficulty: passive comfort drain grows past level 3 (DESIGN 11.5)
  if (!o.school) traits.comfortDrain = Math.round(traits.comfortDrain * comfortDrainMult(state, L) * 100) / 100;
  if (o.gas) {
    traits.comfortStart = Math.min(100, traits.comfortStart + 15);
    traits.comfortDrain = Math.round(traits.comfortDrain * 0.7 * 100) / 100;
  }
  let bonus: BonusId | null = null;
  if (o.bonus !== undefined && !o.school) {
    bonus = o.bonus === 'combo' && dirt.tartarCount + sp.barnacles + sp.pockets < 4 ? 'spotless' : o.bonus;
    if (bonus === 'treasure' && !(ct === 'pirate' && sp.treasure)) bonus = 'noSlips';
  } else if (!o.school) {
    if (ct === 'pirate' && sp.treasure) bonus = 'treasure';
    else {
      const opts: BonusId[] = ['noSlips', 'fast', 'spotless'];
      if (dirt.tartarCount + sp.barnacles + sp.pockets >= 4) opts.push('combo');
      bonus = opts[makeRng(hashSeed(seed, 'bonus')).int(0, opts.length - 1)];
    }
  }
  return {
    seed,
    patientId: o.patientId,
    patient: { name: o.name, archetype: o.archetype, portrait: o.archetype },
    caseType: ct,
    twists: [...tw],
    bonus,
    problemTeeth,
    special: sp,
    firstOfCase: o.firstOfCase,
    service: o.service,
    missingTeeth: missing,
    dirt,
    traits,
    tools: loadout(state, gel),
    mods,
    tutorial: o.tutorial,
    parSeconds: parSeconds(dirt, n, sp, ct, mods.parMult),
    lines: [...a.lines],
    rules: cleanRules(state),
  };
}

export { CASES };
