// End game glue (DESIGN 11) between the screens and the sim: Smile City status, the gala, retiring,
// new-game options and district-aware openings. Each call uses the sim function when the sim exposes it
// and falls back to the save and the catalogs otherwise, so the screens keep working while the sim
// changes underneath. Results are normalised to one shape here.
import { loadLegacy, saveLegacy, type LegacyState } from '../core/legacy';
import type { ActionResult, CleanResult, CleanSetup, Difficulty, DistrictId, GameState, HandsOnPayout, LegacyPerkId, OfficeTierId, SimEvent } from '../core/types';
import { DISTRICTS, DISTRICT_ORDER } from '../data/city';
import * as sim from '../sim';
import {
  cityIndex, districtIndex, goldMasteries, legacyPointsFor, locationsByDistrict, nextMilestone, smilePct, vanDistrict, type MilestoneView,
} from './endlogic';
import { simFn } from './mgr';
import { attempt } from './safe';

type AnyFn = (...a: unknown[]) => unknown;

function call(fn: AnyFn, ...args: unknown[]): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try { return { ok: true, value: fn(...args) }; } catch (error) { return { ok: false, error }; }
}

function errText(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return m && !/not built yet|is not a function|undefined/i.test(m) ? m : fallback;
}

function asResult(r: unknown): ActionResult {
  if (r && typeof r === 'object' && 'ok' in (r as object)) {
    const x = r as { ok: boolean; reason?: string; message?: string };
    return x.ok ? { ok: true, message: x.message } : { ok: false, reason: x.reason ?? 'Not available' };
  }
  return { ok: true };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------------------------------------------------------------- Smile City

export interface DistrictView {
  id: DistrictId;
  name: string;
  blurb: string;
  color: string;
  index: number;      // 0..1
  pct: number;        // whole percent
  served: number;
  locations: number;  // your locations here
  employer: boolean;  // Bright Smiles Dental (Downtown)
}

export interface CityView {
  index: number;
  pct: number;
  districts: DistrictView[];
  reached: number[];
  next: { milestone: MilestoneView; from: number; frac: number } | null;
  vanOwned: boolean;
  vanUnlocked: boolean;
  vanDistrict: DistrictId | null;
  galaUnlocked: boolean;
  won: boolean;
  attempts: number;
}

/** Smile City as the screens show it: the save's districts, the sim's cityStatus on top when it has one. */
export function cityStatus(s: GameState): CityView {
  const city = Array.isArray(s.city) ? s.city : [];
  const locs = s.phase === 'owner' ? s.locations : [];
  const have = locationsByDistrict(locs);
  const reached = Array.isArray(s.finale?.milestones) ? [...s.finale.milestones] : [];
  let index = cityIndex(city);
  let vanDist: DistrictId | null = vanDistrict(city, locs);
  let vanFromSim: boolean | null = null;
  const f = simFn('cityStatus');
  if (f) {
    const r = call(f, s);
    if (r.ok && r.value && typeof r.value === 'object') {
      const v = r.value as Record<string, unknown>;
      const idx = num(v.index) ?? num(v.city) ?? (num(v.pct) !== null ? num(v.pct)! / 100 : null);
      if (idx !== null) index = idx > 1 ? idx / 100 : idx;
      const vd = (v.vanDistrict ?? v.van) as unknown;
      if (typeof vd === 'string' && DISTRICTS[vd as DistrictId]) vanDist = vd as DistrictId;
      if (typeof v.vanUnlocked === 'boolean') vanFromSim = v.vanUnlocked;
    }
  }
  const districts: DistrictView[] = DISTRICT_ORDER.map((id) => {
    const d = DISTRICTS[id];
    const st = city.find((x) => x && x.id === id);
    const i = districtIndex(city, id);
    return {
      id, name: d.name, blurb: d.blurb, color: d.color, index: i, pct: smilePct(i), served: Math.max(0, st?.served ?? 0),
      locations: have[id], employer: id === 'downtown' && s.phase !== 'owner',
    };
  });
  const vanOwned = s.phase === 'owner' && s.locations.some((c) => c.equipment.includes('smileVan'));
  return {
    index, pct: smilePct(index), districts, reached,
    next: nextMilestone(index, reached),
    vanOwned,
    vanUnlocked: vanFromSim ?? reached.includes(50),
    vanDistrict: vanOwned ? vanDist : null,
    galaUnlocked: !!s.finale?.galaUnlocked,
    won: !!s.finale?.won,
    attempts: Math.max(0, s.finale?.attempts ?? 0),
  };
}

// ---------------------------------------------------------------- openings with a district

/** Open the first practice in a district (sim.openPractice with `district`; the district is set here if the sim did not). */
export function openPracticeIn(s: GameState, name: string, loan: number, district: DistrictId): ActionResult {
  const opts = { name, loan, district };
  const r = sim.openPractice(s, opts as Parameters<typeof sim.openPractice>[1]);
  if (r.ok) fixDistrict(s, s.locations.length - 1, district);
  return r;
}

/** Open a new location in a district. */
export function openLocationIn(s: GameState, tier: OfficeTierId, name: string, loan: number, district: DistrictId): ActionResult {
  const before = s.locations.length;
  const f = simFn('openLocation') as AnyFn;
  const r = asResult(f(s, tier, name, loan, district));
  if (r.ok && s.locations.length > before) fixDistrict(s, s.locations.length - 1, district);
  return r;
}

function fixDistrict(s: GameState, idx: number, district: DistrictId): void {
  const c = s.locations[idx];
  if (c && !DISTRICTS[c.district as DistrictId]) c.district = district;
}

// ---------------------------------------------------------------- new game

export interface NewGameOpts { name: string; avatar: number; difficulty: Difficulty; legacyPerks: LegacyPerkId[] }

/** sim.newGame with the difficulty and the Legacy perks brought into the run. */
export function newGameWith(o: NewGameOpts): GameState {
  const opts = { name: o.name, avatar: o.avatar, nowMs: Date.now(), difficulty: o.difficulty, legacyPerks: o.legacyPerks };
  const st = sim.newGame(opts as Parameters<typeof sim.newGame>[0]);
  if (st.difficulty !== o.difficulty) st.difficulty = o.difficulty;
  if (!Array.isArray(st.legacyPerks)) st.legacyPerks = [...o.legacyPerks];
  return st;
}

// ---------------------------------------------------------------- the gala

export interface GalaStatus { unlocked: boolean; ready: boolean; won: boolean; attempts: number; reason: string }

/** Whether the gala can be played now (one try a day), from sim.galaStatus or the save. */
export function galaStatus(s: GameState): GalaStatus {
  const base = { unlocked: !!s.finale?.galaUnlocked, won: !!s.finale?.won, attempts: Math.max(0, s.finale?.attempts ?? 0) };
  const f = simFn('galaStatus');
  if (f) {
    const r = call(f, s);
    if (r.ok && r.value && typeof r.value === 'object') {
      const v = r.value as Partial<GalaStatus>;
      return { unlocked: !!v.unlocked, ready: !!v.ready, won: !!v.won, attempts: num(v.attempts) ?? base.attempts, reason: v.reason ?? '' };
    }
  }
  const ready = base.unlocked && !base.won && s.phase === 'owner';
  return { ...base, ready, reason: ready ? '' : base.won ? 'The Golden Molar is yours' : 'Smile City needs to reach 100%' };
}

/** The showcase clean for the Golden Molar Gala, or why it cannot start. */
export function galaSetup(s: GameState): { ok: true; setup: CleanSetup } | { ok: false; reason: string } {
  const st = galaStatus(s);
  if (!st.ready) return { ok: false, reason: st.reason || 'The gala is not on tonight' };
  const f = simFn('galaSetup');
  if (!f) return { ok: false, reason: 'The gala is not ready yet' };
  const r = call(f, s);
  if (!r.ok) return { ok: false, reason: errText(r.error, 'The gala is not ready yet') };
  const v = r.value as (CleanSetup & { ok?: boolean; reason?: string }) | null;
  if (v && v.ok === false) return { ok: false, reason: v.reason ?? 'The gala is not ready yet' };
  if (!v || typeof v !== 'object' || !v.patient) return { ok: false, reason: 'The gala is not ready yet' };
  return { ok: true, setup: v };
}

export interface GalaOutcome { won: boolean; lines: string[]; prize: number; xp: number; stars: number; legacy: number; events: SimEvent[]; mastery: HandsOnPayout['mastery'] }

/** Settle the showcase clean (sim.completeGala). Whether the Golden Molar was won is read from the save. */
export function completeGala(s: GameState, result: CleanResult): GalaOutcome {
  const f = simFn('completeGala');
  const out: GalaOutcome = { won: false, lines: [], prize: 0, xp: 0, stars: result.stars, legacy: 0, events: [], mastery: null };
  if (f) {
    const r = call(f, s, result);
    if (r.ok && r.value && typeof r.value === 'object') {
      const v = r.value as { lines?: unknown; payout?: Partial<HandsOnPayout>; legacy?: unknown; events?: unknown };
      const l = Array.isArray(v.lines) ? v.lines : Array.isArray(v.payout?.lines) ? v.payout!.lines as unknown[] : [];
      out.lines = l.filter((x): x is string => typeof x === 'string');
      out.prize = Math.max(0, (num(v.payout?.pay) ?? 0) + (num(v.payout?.tip) ?? 0) + (num(v.payout?.bonus) ?? 0));
      out.xp = Math.max(0, num(v.payout?.xp) ?? 0);
      out.stars = num(v.payout?.stars) || result.stars;
      out.legacy = num(v.legacy) ?? 0;
      out.mastery = v.payout?.mastery ?? null;
      out.events = Array.isArray(v.events) ? v.events as SimEvent[] : [];
    } else if (!r.ok) console.warn('[ui] completeGala', r.error);
  }
  out.won = !!s.finale?.won;
  return out;
}

/** Legacy points retiring now would earn, line by line (sim.legacyPoints, else the catalog rule). */
export function legacyPreview(s: GameState): { total: number; parts: { label: string; points: number }[] } {
  const f = simFn('legacyPoints');
  if (f) {
    const r = call(f, s);
    if (r.ok && r.value && typeof r.value === 'object') {
      const v = r.value as Record<string, unknown>;
      const parts: { label: string; points: number }[] = [];
      const add = (label: string, k: string) => { const n = num(v[k]) ?? 0; if (n) parts.push({ label, points: n }); };
      add('Golden Molar', 'goldenMolar');
      add('Achievements', 'achievements');
      add('Gold masteries', 'gold');
      add('Chain valuation', 'valuation');
      return { total: num(v.total) ?? parts.reduce((a, p) => a + p.points, 0), parts };
    }
  }
  return legacyPointsFor(s, attempt(() => sim.valuation(s), 0, 'valuation'));
}

/** What 5 stars needs for a waiting patient (sim.fiveStarNeeds), or null. */
export function fiveStarNeeds(s: GameState, patientId: string): { rules: CleanSetup['rules']; par: number } | null {
  const f = simFn('fiveStarNeeds');
  if (!f) return null;
  const r = call(f, s, patientId);
  if (!r.ok || !r.value || typeof r.value !== 'object') return null;
  const v = r.value as { rules?: CleanSetup['rules']; par?: number };
  return v.rules && num(v.par) !== null ? { rules: v.rules, par: v.par! } : null;
}

/** Trophy wall summary for ClinicView.setTrophies (sim.trophies, else counted from the save). */
export function trophySummary(s: GameState): { plaques: number; gold: number; milestones: number; goldenMolar: boolean } {
  const f = simFn('trophies');
  if (f) {
    const r = call(f, s);
    if (r.ok && r.value && typeof r.value === 'object') {
      const v = r.value as Record<string, unknown>;
      return { plaques: num(v.plaques) ?? 0, gold: num(v.gold) ?? 0, milestones: num(v.milestones) ?? 0, goldenMolar: !!v.goldenMolar };
    }
  }
  return { plaques: s.achievements.length, gold: goldMasteries(s.player.mastery), milestones: (s.finale?.milestones ?? []).length, goldenMolar: !!s.finale?.won };
}

/** The rent a location pays today (sim.rent grows it with reputation on Standard and Veteran). */
export function rentOf(s: GameState, idx: number, fallback: number): number {
  const f = simFn('rent');
  if (!f) return fallback;
  const r = call(f, s, idx);
  return r.ok ? num(r.value) ?? fallback : fallback;
}

// ---------------------------------------------------------------- retire (New Game+)

/** Retire the run into Legacy points (sim.retire; the points are added here when the sim did not store them). */
export function retire(s: GameState): { points: number; legacy: LegacyState } {
  const before = loadLegacy();
  const valuation = attempt(() => sim.valuation(s), 0, 'valuation');
  const expected = legacyPointsFor(s, valuation).total;
  const f = simFn('retire');
  let reported: number | null = null;
  let simDone = false;
  if (f) {
    const r = call(f, s);
    if (r.ok) {
      const v = r.value as Record<string, unknown> | number | null;
      reported = typeof v === 'number' ? v : v && typeof v === 'object' ? num(v.points) ?? num(v.earned) : null;
      simDone = reported !== null;
    } else console.warn('[ui] retire', r.error);
  }
  let after = loadLegacy();
  if (!simDone && after.earned <= before.earned && after.runs <= before.runs) {
    // the sim did not write the Legacy store: do it here
    const pts = reported ?? expected;
    after = {
      ...before,
      points: before.points + pts,
      earned: before.earned + pts,
      runs: before.runs + 1,
      wins: before.wins + (s.finale?.won ? 1 : 0),
      veteranUnlocked: before.veteranUnlocked || !!s.finale?.won,
    };
    saveLegacy(after);
  }
  if (s.finale) s.finale.retired = true;
  return { points: simDone ? Math.max(0, reported!) : Math.max(0, after.earned - before.earned), legacy: after };
}
