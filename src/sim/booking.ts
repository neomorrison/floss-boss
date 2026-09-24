// Demand, capacity and the day's appointment book. DESIGN 8.4 and 3.2.
import type { ArchetypeId, CaseType, Clinic, GameState, Operatory } from '../core/types';
import type { Rng } from '../core/rng';
import { HANDS_ON_MINUTES, LAST_APPT_MIN, OPEN_MIN, PLAYER_ID, QUICK_CLEAN_MINUTES } from '../core/constants';
import { OFFICES, MARKETING_LEVELS } from '../data/offices';
import { SERVICES } from '../data/services';
import { CASES, CASE_ORDER } from '../data/cases';
import { SimClinic, SimPatient, emptyDayStats, hasSkill, isPresent, opStaffed, q64, staffById } from './internal';
import { makePatient, pickArchetype } from './patients';
import { archetypeForCase, caseAllowed, pickCase } from './cases';
import { shiftSize } from './goals';

export const WEEKDAY_DEMAND = [1.1, 1.0, 1.0, 1.0, 1.15];
/** Demand falls with the cleaning price multiplier: demand * mult^-PRICE_ELASTICITY (DESIGN 8.4). */
export const PRICE_ELASTICITY = 2.2;
/** Minutes an operatory loses per patient to walking, seating and turnover. */
const TURNOVER = 6;
/** Average archetype difficulty (NPC clean duration multiplier). */
const AVG_DIFFICULTY = 1.12;
/** Next-day demand per hands-on clean by the owner at that location, and its cap (DESIGN 5.9). */
export const BOSS_DEMAND_EACH = 0.04;
export const BOSS_DEMAND_MAX = 0.2;

export function weekdayOf(day: number): number {
  return ((day - 1) % 5 + 5) % 5;
}

export function awareness(served: number): number {
  return 0.5 + 0.5 * (1 - Math.exp(-served / 150));
}

/** Expected patients per day (Poisson mean) for a clinic. */
export function demandLambda(state: GameState, c: Clinic, weekday: number): number {
  const tier = OFFICES[c.tier];
  const mk = MARKETING_LEVELS[c.marketing]?.mult ?? 1;
  let lambda = tier.baseDemand
    * awareness(c.served)
    * (0.6 + 0.16 * c.rating)
    * Math.pow(c.prices.cleaning || 1, -PRICE_ELASTICITY)
    * mk
    * (hasSkill(state, 'marketer') ? 1.12 : 1)
    * (c.equipment.includes('onlineBooking') ? 1.1 : 1)
    * WEEKDAY_DEMAND[weekday];
  const idx = state.locations.indexOf(c);
  const hasManager = c.staff.some((s) => s.role === 'manager');
  if (state.locations.length > 1 && idx !== state.active && !hasManager) lambda *= 0.85;
  return lambda;
}

/** Average extra chair minutes per patient from add-ons and the dentist's exam. */
export function addonChairMinutes(state: GameState, c: Clinic): number {
  let m = 0.45 * SERVICES.fluoride.minutes + 0.1 * SERVICES.sealant.minutes;
  if (c.equipment.includes('xray')) m += 0.35 * SERVICES.xray.minutes;
  if (c.ops.some((o) => o.upgrades.includes('whiteningLamp'))) m += 0.12 * SERVICES.whitening.minutes;
  if (c.staff.some((s) => s.role === 'dentist' && isPresent(state, s))) m += 0.7 * 0.25 * SERVICES.filling.minutes * 0.8;
  return m;
}

/** Expected minutes an operatory spends per patient (for capacity and the appointment spread). */
export function opInterval(state: GameState, c: Clinic, op: Operatory): number | null {
  if (op.staffId === PLAYER_ID) {
    // hands-on: the clock fast-forwards the whole clean, then the next patient waits for you
    const deep = c.equipment.includes('deepCert') ? 0.15 * (HANDS_ON_MINUTES.deep - HANDS_ON_MINUTES.cleaning) : 0;
    if (op.playerMode === 'hands') return HANDS_ON_MINUTES.cleaning + deep + addonChairMinutes(state, c) + TURNOVER + 4;
    return (SERVICES.cleaning.minutes + addonChairMinutes(state, c)) * AVG_DIFFICULTY + TURNOVER;
  }
  const s = staffById(c, op.staffId);
  if (!s || s.role !== 'hygienist' || !isPresent(state, s)) return null;
  const asst = staffById(c, op.assistantId);
  let f = (1.3 - 0.6 * s.speed / 100) * (1 - 0.1 * (s.morale - 50) / 50);
  if (s.traits.includes('speedy')) f *= 0.85;
  if (s.traits.includes('perfectionist')) f *= 1.1;
  if (asst && isPresent(state, asst)) f *= 0.8;
  if (c.equipment.includes('ultrasonicKits')) f *= 0.9;
  return (SERVICES.cleaning.minutes + addonChairMinutes(state, c)) * f * AVG_DIFFICULTY + TURNOVER + 3;
}

export function capacityOf(state: GameState, c: Clinic, fromMin = OPEN_MIN): number {
  let cap = 0;
  const span = Math.max(0, LAST_APPT_MIN + 30 - fromMin);
  for (const op of c.ops) {
    const iv = opInterval(state, c, op);
    if (iv) cap += Math.floor(span / iv);
  }
  return cap;
}

/** The only operatory that can serve is your own chair in hands-on mode (every patient waits for you). */
export function onlyPlayerHands(state: GameState, c: Clinic): boolean {
  const serving = c.ops.filter((o) => opStaffed(state, c, o));
  return serving.length > 0 && serving.every((o) => o.staffId === PLAYER_ID && o.playerMode === 'hands');
}

export function noShowRate(c: Clinic): number {
  const rec = c.staff.some((s) => s.role === 'receptionist');
  return 0.12 * (rec ? 0.6 : 1) * (c.equipment.includes('onlineBooking') ? 0.5 : 1);
}

/** Appointment slots spread across the serving operatory lanes, sorted by time. */
function laneSlots(state: GameState, c: Clinic, fromMin: number, rng: Rng): number[] {
  const slots: number[] = [];
  for (const op of c.ops) {
    const iv = opInterval(state, c, op);
    if (!iv) continue;
    let t = fromMin + rng.range(0, Math.min(15, iv * 0.3));  // slot times are rounded below
    while (t <= LAST_APPT_MIN) {
      slots.push(Math.round(t));
      t += iv;
    }
  }
  return slots.sort((a, b) => a - b);
}

/** Clear a clinic's day (from `fromMin`, 8:00 for a normal day). */
export function resetClinicDay(state: GameState, c: Clinic, fromMin = OPEN_MIN): void {
  c.patients = [];
  c.day = emptyDayStats();
  c.checkinBusyUntil = 0;
  for (const op of c.ops) { op.patientId = null; (op as { freeAt?: number }).freeAt = fromMin; }
  for (const s of c.staff) {
    s.patientsToday = 0; s.busyUntil = null; s.targetOpId = null; s.task = isPresent(state, s) ? 'idle' : 'off';
    (s as { workMin?: number }).workMin = 0;
  }
  (c as SimClinic).startRating = c.rating;
}

export function bookClinic(state: GameState, c: Clinic, rng: Rng, fromMin = OPEN_MIN): void {
  const sc = c as SimClinic;
  const boss = 1 + Math.min(BOSS_DEMAND_MAX, BOSS_DEMAND_EACH * Math.max(0, sc.bossCleans ?? 0));
  sc.bossCleans = 0;
  resetClinicDay(state, c, fromMin);
  if (fromMin > LAST_APPT_MIN - 15) return;
  const wd = weekdayOf(state.day);
  const partOfDay = Math.max(0, Math.min(1, (LAST_APPT_MIN - fromMin) / (LAST_APPT_MIN - OPEN_MIN)));
  const lambda = demandLambda(state, c, wd) * partOfDay * boss;
  const demand = rng.poisson(lambda);
  const cap = capacityOf(state, c, fromMin);
  c.day.demand = demand;
  if (cap <= 0) {
    // nobody can clean here today: everyone is turned away (the report's hint to hire)
    c.day.booked = 0;
    c.day.turnedAway = demand;
    return;
  }
  const solo = onlyPlayerHands(state, c);
  const booked = Math.min(demand, cap + (solo ? 0 : 1));
  c.day.booked = booked;
  c.day.turnedAway = demand - booked;
  const slots = laneSlots(state, c, fromMin, rng);
  const times: number[] = [];
  if (slots.length) {
    for (let i = 0; i < booked; i++) {
      if (i < slots.length) times.push(slots[Math.floor((i * slots.length) / Math.max(booked, 1))]);
      else times.push(Math.round(rng.range(fromMin + 30, LAST_APPT_MIN)));
    }
  } else {
    for (let i = 0; i < booked; i++) times.push(Math.round(rng.range(fromMin, LAST_APPT_MIN)));
  }
  times.sort((a, b) => a - b);
  const ns = noShowRate(c);
  for (const t of times) {
    const arrive = q64(Math.max(fromMin, t - rng.range(0, 8)));
    const p = makePatient(state, c, rng, { apptMin: t, arriveAt: arrive, walkIn: false });
    if (rng.chance(ns)) { p.state = 'noshow'; c.day.noShows += 1; }
    c.patients.push(p);
  }
  // walk-ins (turned away at the door when no seat is free or nobody can take them)
  const walkIns = rng.poisson(0.12 * lambda);
  for (let i = 0; i < walkIns; i++) {
    const t = Math.round(rng.range(Math.max(fromMin + 20, OPEN_MIN + 30), LAST_APPT_MIN - 30));
    const p = makePatient(state, c, rng, { apptMin: t, arriveAt: t, walkIn: true });
    c.patients.push(p);
    c.day.walkIns += 1;
  }
}

/** Case types unlocked by level that the player has not had scheduled yet (introduced once). */
function newlyUnlocked(state: GameState): CaseType[] {
  return CASE_ORDER.filter((ct) => CASES[ct].minLevel > 1 && CASES[ct].minLevel <= state.player.level && !state.flags[`case_sched_${ct}`]);
}

/** Employee phase: the employer's NPC patients (display) plus the player's shift. */
export function bookEmployer(state: GameState, c: Clinic, rng: Rng, fromMin = OPEN_MIN): void {
  resetClinicDay(state, c, fromMin);
  const npcOps = c.ops.filter((o) => o.staffId !== PLAYER_ID);
  const times: number[] = [];
  for (const op of npcOps) {
    const iv = opInterval(state, c, op);
    if (!iv) continue;
    let t = Math.max(fromMin, OPEN_MIN) + rng.range(0, 12);
    while (t <= LAST_APPT_MIN) { times.push(Math.round(t)); t += iv; }
  }
  times.sort((a, b) => a - b);
  const booked = Math.round(times.length * 0.85);
  for (let i = 0; i < booked; i++) {
    const t = times[Math.floor((i * times.length) / booked)];
    const p = makePatient(state, c, rng, { apptMin: t, arriveAt: q64(Math.max(fromMin, t - rng.range(0, 8))), walkIn: false });
    if (rng.chance(0.05)) { p.state = 'noshow'; c.day.noShows += 1; }
    c.patients.push(p);
  }
  // the player's shift (DESIGN 3.2): appointment i at 510 + i * floor(450 / n). Every patient brings a
  // case; no case type twice in a row, and a case the last level-up unlocked comes in once.
  const n = shiftSize(state.player.level);
  const step = Math.floor(450 / n);
  const forced = newlyUnlocked(state);
  let prev: CaseType | null = null;
  for (let i = 0; i < n; i++) {
    const t = 510 + i * step;
    if (t < fromMin) continue;
    const firstEver = state.day === 1 && i === 0;
    let ct: CaseType;
    let arch: ArchetypeId;
    if (firstEver) { ct = 'routine'; arch = 'regular'; }
    else if (forced.length) {
      ct = forced.shift() as CaseType;
      arch = archetypeForCase(ct, rng);
      state.flags[`case_sched_${ct}`] = true;
    } else {
      // reroll the patient a few times for a different case than the last one; then pick the case first
      arch = pickArchetype(state, c, rng);
      ct = pickCase(state, c, arch, rng, prev);
      for (let k = 0; k < 6 && ct === prev; k++) {
        arch = pickArchetype(state, c, rng);
        ct = pickCase(state, c, arch, rng, prev);
      }
      if (ct === prev) {
        const other = CASE_ORDER.filter((x) => x !== prev && caseAllowed(state, c, x) && Object.keys(CASES[x].weight).length);
        if (other.length) { ct = rng.pick(other); arch = archetypeForCase(ct, rng); }
      }
    }
    const p = makePatient(state, c, rng, {
      apptMin: t, arriveAt: Math.max(fromMin, t - 4), walkIn: false, archetype: arch, player: true, caseType: ct, avoidCase: prev,
    });
    prev = p.caseType;
    c.patients.push(p);
  }
  c.patients.sort((a, b) => a.apptMin - b.apptMin);
  c.day.booked = c.patients.filter((p) => p.state !== 'noshow').length;
  c.day.demand = c.day.booked;
  state.flags['shiftBonusPaid'] = false;
}

/** Book every clinic for a fresh day. */
export function bookDay(state: GameState, rng: Rng, fromMin = OPEN_MIN): void {
  if (state.phase === 'employee' && state.employer) bookEmployer(state, state.employer, rng, fromMin);
  if (state.phase === 'owner') for (const c of state.locations) bookClinic(state, c, rng, fromMin);
}

export function quickCleanChairMinutes(): number {
  return QUICK_CLEAN_MINUTES * 0.8;
}

export type { SimPatient };
