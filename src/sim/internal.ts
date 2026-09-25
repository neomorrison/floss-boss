// Internal sim helpers shared by the sim files. Not part of the public API (use sim/index.ts).
// The sim keeps a few private bookkeeping fields on the shared objects (patients, staff,
// operatories, the state). They are optional, JSON-safe and filled in by migrate().
import type {
  Clinic, DayPatient, DayReport, EquipId, GameState, Goal, Operatory, PriceKey, SimEvent, SkillId, Staff,
} from '../core/types';
import type { Rng } from '../core/rng';
import { makeRng } from '../core/rng';
import { PLAYER_ID } from '../core/constants';

/** Internal clock grid in game minutes. tick() processes the world at k * GRID, so results do not
 * depend on how the caller slices time (frame sizes, fast-forwards). */
export const GRID = 0.5;
export const LEDGER_MAX = 200;
export const REPORTS_MAX = 30;
export const REVIEWS_MAX = 40;

export type ChairStage = 'await' | 'clean' | 'waitDentist' | 'dentist';

export interface SimPatient extends DayPatient {
  arriveAt?: number;         // planned arrival at the door
  stage?: ChairStage | null; // sub-state while inChair
  wbase?: number;            // waited minutes accumulated before the current state
  billed?: number;           // amount already billed (hands-on bills up front)
  reviewed?: boolean;
  preQ?: number;             // rolled quality for the running clean
  preC?: number;             // rolled comfort 0..1
  examDone?: boolean;
  examUntil?: number | null; // when the dentist finishes this patient's exam (once assigned)
  hands?: boolean;           // cleaned by the player (hands-on or quick)
  seen?: boolean;            // employee: counted toward the shift
  gel?: boolean;             // a numbing gel was already used on this patient
  pm?: Partial<Record<PriceKey, number>>;  // price multipliers locked at booking (service) and check-in (add-ons)
  fm?: number;               // fee multiplier from modifiers (focus, events, campaigns), locked at check-in
  vipFee?: number;           // VIP patient: flat service fee (replaces the cleaning fee)
  vipWeight?: number;        // VIP patient: review weight
  preTip?: number;           // tip left for a specialist (Pirate Whisperer), billed at checkout
  deskBy?: string;           // receptionist who checked the patient in (Upsell Star)
}

export interface SimStaff extends Staff {
  workMin?: number;          // chair minutes worked today (overwork is measured in minutes, not patients)
  courseGain?: number;       // skill gained when the booked course ends
  perkDay?: number;          // day the pending perk choice was offered (auto-picked after 2 days)
  lowDays?: number;          // consecutive days with morale under 25 (Rooftop Garden: quits need 5)
  raiseDue?: boolean;        // a raise request waits for the day close (level-up, course, event)
  raiseDay?: number;         // day of the last raise request or raise (quiet period, DESIGN 8.5)
}
export interface SimOp extends Operatory { freeAt?: number }
export interface SimClinic extends Clinic {
  startRating?: number;
  startRatingDay?: number;   // day startRating was taken (a morning rebook keeps it)
  bossCleans?: number;       // hands-on cleans by the owner today: +4% demand each next day (max +20%)
  bossBoost?: number;        // today's demand multiplier from yesterday's owner cleans
  waitIn?: number;           // waitlisted patients booked first today (DESIGN 10.3)
  waitOut?: number;          // today's overflow that comes back tomorrow
  reach?: number;            // patients served at this office tier (drives awareness; a move resets it)
  awBonus?: number;          // awareness from events and campaigns
  ratingBonus?: number;      // rating from events (fades 5% a day)
  recentEvents?: Record<string, number>;   // event id -> last day it was drawn here
  openedDay?: number;        // day this location opened (Grand Opening)
  vips?: { fee: number; weight: number; day: number }[];   // event VIPs booked for a day
  bookDay?: number;          // day the service prices below were locked for booking
  bookPrices?: { cleaning: number; deep: number };
}
export interface SimGoal extends Goal { limit?: number; clinicId?: string }
/** Reports saved before operatingNet existed carry opNet instead. */
export interface SimReport extends DayReport { opNet?: number }
export interface SimState extends GameState {
  discounts?: { clinicId: string; equipId: EquipId; pct: number; day: number }[];   // salesman offers (today only)
  dayXp?: number;
  dayLevelUps?: number;
  dayGoals?: string[];
  dayNotes?: string[];
}

export const S = (state: GameState) => state as SimState;
export const P = (p: DayPatient) => p as SimPatient;

/** Price multiplier a patient pays for `key`: locked when booked (service) or checked in (add-ons). */
export function priceOf(c: Clinic, p: DayPatient, key: PriceKey): number {
  const v = (p as SimPatient).pm?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (c.prices[key] ?? 1);
}

/** Can this operatory serve patients today: your chair, or a present hygienist. */
export function opStaffed(state: GameState, c: Clinic, op: Operatory): boolean {
  if (opClosed(state, c, op.id)) return false;
  if (op.staffId === PLAYER_ID) return true;
  const s = staffById(c, op.staffId);
  return !!s && s.role === 'hygienist' && isPresent(state, s);
}

/** An event closed this operatory for today (ClinicModifier.closedOpId). */
export function opClosed(state: GameState, c: Clinic, opId: string): boolean {
  const mods = c.modifiers;
  if (!mods || !mods.length) return false;
  for (const m of mods) if (m.closedOpId === opId && (m.untilDay == null || m.untilDay >= state.day)) return true;
  return false;
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function nextId(state: GameState, prefix: string): string {
  state.nextId = (state.nextId || 1) + 1;
  return prefix + state.nextId;
}

/** Run fn with a Rng resumed from state.rng, writing the rng state back afterwards. */
export function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = makeRng(state.rng >>> 0);
  try {
    return fn(rng);
  } finally {
    state.rng = rng.state();
  }
}

/** Snap a time or duration to 1/64 minute: binary-exact, so sums stay short in the save and exact. */
export const q64 = (x: number) => Math.round(x * 64) / 64;
/** Round a 0..1 quality-like value for storage. */
export const q3 = (x: number) => Math.round(x * 1000) / 1000;

export const roundMoney = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

/** Every cash change goes through here so cash always equals the ledger sum. Money is whole dollars. */
export function addCash(state: GameState, amount: number, label: string): void {
  const amt = roundMoney(amount);
  if (!amt) return;
  state.cash += amt;
  const kind: 'income' | 'expense' = amt >= 0 ? 'income' : 'expense';
  if (amt > 0) state.stats.earned += amt;
  const L = state.ledger;
  for (let i = L.length - 1; i >= 0 && i >= L.length - 40; i--) {
    const e = L[i];
    if (e.day !== state.day) break;
    if (e.label === label && e.kind === kind) {
      e.amount += amt;
      e.minute = state.minute;
      return;
    }
  }
  L.push({ day: state.day, minute: state.minute, amount: amt, label, kind });
  if (L.length > LEDGER_MAX) {
    // fold the oldest entries into one carried-forward line so the sum is preserved
    const drop = L.length - LEDGER_MAX + 1;
    const old = L.splice(0, drop);
    const sum = old.reduce((s, e) => s + e.amount, 0);
    const last = old[old.length - 1];
    L.unshift({ day: last.day, minute: last.minute, amount: sum, label: 'Earlier activity', kind: sum >= 0 ? 'income' : 'expense' });
  }
}

export function hasSkill(state: GameState, id: SkillId): boolean {
  return state.player.skills.includes(id);
}

export function isPresent(state: GameState, s: Staff): boolean {
  const off = (s as SimStaff).offFrom;
  if (off != null && off <= state.day && state.day <= s.offUntilDay) return false;
  return true;
}

export function clinicsOf(state: GameState): Clinic[] {
  if (state.phase === 'employee') return state.employer ? [state.employer] : [];
  if (state.phase === 'owner') return state.locations;
  return [];
}

export function findPatient(state: GameState, patientId: string): { clinic: Clinic; p: SimPatient } | null {
  for (const c of clinicsOf(state)) {
    const p = c.patients.find((x) => x.id === patientId);
    if (p) return { clinic: c, p: p as SimPatient };
  }
  return null;
}

export function staffById(c: Clinic, id: string | null | undefined): Staff | null {
  if (!id || id === PLAYER_ID) return null;
  return c.staff.find((s) => s.id === id) ?? null;
}

export function opById(c: Clinic, id: string | null | undefined): SimOp | null {
  if (!id) return null;
  return (c.ops.find((o) => o.id === id) as SimOp) ?? null;
}

export function clinicByIndex(state: GameState, index: number): Clinic | null {
  if (index === -1) return state.employer;
  return state.locations[index] ?? null;
}

export function pushEvent(ev: SimEvent[] | null | undefined, e: SimEvent): void {
  if (ev) ev.push(e);
}

export function emptyDayStats() {
  return { booked: 0, demand: 0, turnedAway: 0, noShows: 0, walkIns: 0, served: 0, walkouts: 0, revenue: 0, tips: 0, supplies: 0, addonsSold: 0, fiveStars: 0, handsOn: 0 };
}

export function isTerminal(p: DayPatient): boolean {
  return p.state === 'gone' || p.state === 'noshow';
}

export function note(state: GameState, text: string): void {
  const s = S(state);
  if (!s.dayNotes) s.dayNotes = [];
  if (!s.dayNotes.includes(text)) s.dayNotes.push(text);
}

export type { Rng, SimEvent, Goal };
