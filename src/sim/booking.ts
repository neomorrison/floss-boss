// Demand, capacity, the waitlist and the day's appointment book. DESIGN 8.4, 10.3 and 3.2.
import type { ArchetypeId, CaseType, Clinic, GameState, Operatory, Staff } from '../core/types';
import type { Rng } from '../core/rng';
import { hashSeed, makeRng } from '../core/rng';
import { HANDS_ON_MINUTES, LAST_APPT_MIN, OPEN_MIN, PLAYER_ID, QUICK_CLEAN_MINUTES } from '../core/constants';
import { OFFICES, MARKETING_LEVELS } from '../data/offices';
import { SERVICES } from '../data/services';
import { CASES, CASE_ORDER } from '../data/cases';
import { ARCHETYPES, PATIENT_ARCHETYPES } from '../data/patients';
import { SimClinic, SimPatient, emptyDayStats, hasSkill, isPresent, opClosed, opStaffed, q64, staffById } from './internal';
import { archetypeWeight, makePatient, pickArchetype } from './patients';
import { archetypeForCase, caseAllowed, caseWeight, pickCase } from './cases';
import { shiftSize } from './goals';
import {
  STUDIO_VIP_FEE, VIP_WEIGHT, addonMinutesMult, equipDemand, has, lastAppt, modAgg, noShowRate as noShowRateOf, opDuration, perkMult,
} from './effects';

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
/** Patients served at an office tier for awareness to close 63% of the gap to full (Brand Builder halves it). */
export const AWARENESS_SCALE = 150;
/** Awareness a location keeps when it moves to a bigger office (in patients served): the new
 * neighbourhood has not met you yet, so a move opens spare capacity for marketing and campaigns. */
export const REACH_AFTER_MOVE = 40;
/** Awareness cap including event and campaign bonuses. */
export const AWARENESS_MAX = 1.15;
/** Walk-ins per unit of demand. */
const WALKIN_RATE = 0.12;
/** AI Scheduler capacity bonus. */
const AI_SCHEDULER = 1.1;

export function weekdayOf(day: number): number {
  return ((day - 1) % 5 + 5) % 5;
}

export function awareness(served: number, scale = AWARENESS_SCALE): number {
  return 0.5 + 0.5 * (1 - Math.exp(-Math.max(0, served) / scale));
}

/** Awareness of one location: patients served at this office tier, plus event and campaign bonuses. */
export function awarenessOf(state: GameState, c: Clinic): number {
  const sc = c as SimClinic;
  const reach = typeof sc.reach === 'number' ? sc.reach : c.served;
  const scale = c.ownedByPlayer && hasSkill(state, 'brandBuilder') ? AWARENESS_SCALE / 2 : AWARENESS_SCALE;
  return Math.min(AWARENESS_MAX, awareness(reach, scale) + (sc.awBonus ?? 0));
}

/** Expected new patients per day (Poisson mean) for a clinic, before the waitlist. */
export function demandLambda(state: GameState, c: Clinic, weekday: number, cleaningPrice?: number): number {
  const tier = OFFICES[c.tier];
  const mk = MARKETING_LEVELS[c.marketing]?.mult ?? 1;
  let lambda = tier.baseDemand
    * awarenessOf(state, c)
    * (0.6 + 0.16 * c.rating)
    * Math.pow(cleaningPrice ?? (c.prices.cleaning || 1), -PRICE_ELASTICITY)
    * mk
    * (hasSkill(state, 'marketer') ? 1.12 : 1)
    * equipDemand(state, c)
    * (c.ownedByPlayer ? modAgg(state, c).demand : 1)
    * WEEKDAY_DEMAND[weekday];
  const idx = state.locations.indexOf(c);
  const hasManager = c.staff.some((s) => s.role === 'manager');
  if (state.locations.length > 1 && idx !== state.active && !hasManager && !hasSkill(state, 'delegator')) lambda *= 0.85;
  return lambda;
}

/** Average extra chair minutes per patient from add-ons and the dentist's exam (whitening optional: the
 * booking lanes count it per whitening case instead). */
export function addonChairMinutes(state: GameState, c: Clinic, whitening = true): number {
  let m = 0.45 * SERVICES.fluoride.minutes + 0.1 * SERVICES.sealant.minutes;
  if (has(c, 'xray')) m += 0.35 * SERVICES.xray.minutes * addonMinutesMult(c, 'xray');
  if (whitening && c.ops.some((o) => o.upgrades.includes('whiteningLamp'))) m += 0.12 * SERVICES.whitening.minutes;
  if (c.staff.some((s) => s.role === 'dentist' && isPresent(state, s))) m += 0.7 * 0.25 * SERVICES.filling.minutes * 0.8 * addonMinutesMult(c, 'filling');
  return m;
}

/** Chair-time factor of a hired hygienist at an operatory: speed stat, morale, traits, a present assistant,
 * equipment, perks, today's focus and modifiers. Multiplies the service minutes. */
export function hygienistFactor(state: GameState, c: Clinic, op: Operatory, s: Staff): number {
  const asst = staffById(c, op.assistantId);
  let f = (1.3 - 0.6 * s.speed / 100) * (1 - 0.1 * (s.morale - 50) / 50);
  if (s.traits.includes('speedy')) f *= 0.85;
  if (s.traits.includes('perfectionist')) f *= 1.1;
  if (asst && isPresent(state, asst)) f *= 0.8 / perkMult(asst, 'speed');
  f *= opDuration(c, op);
  f /= perkMult(s, 'speed');
  if (c.ownedByPlayer) f /= modAgg(state, c).speed;
  return f;
}

/** Expected minutes an operatory spends per patient (for capacity and the appointment spread). */
export function opInterval(state: GameState, c: Clinic, op: Operatory): number | null {
  if (opClosed(state, c, op.id)) return null;
  if (op.staffId === PLAYER_ID) {
    // hands-on: the clock fast-forwards the whole clean, then the next patient waits for you
    const deep = has(c, 'deepCert') ? 0.15 * (HANDS_ON_MINUTES.deep - HANDS_ON_MINUTES.cleaning) : 0;
    if (op.playerMode === 'hands') return HANDS_ON_MINUTES.cleaning + deep + addonChairMinutes(state, c) + TURNOVER + 4;
    return (SERVICES.cleaning.minutes + addonChairMinutes(state, c)) * AVG_DIFFICULTY * opDuration(c, op) + TURNOVER;
  }
  const s = staffById(c, op.staffId);
  if (!s || s.role !== 'hygienist' || !isPresent(state, s)) return null;
  const f = hygienistFactor(state, c, op, s);
  return (SERVICES.cleaning.minutes + addonChairMinutes(state, c)) * f * AVG_DIFFICULTY + TURNOVER + 3;
}

export function capacityOf(state: GameState, c: Clinic, fromMin = OPEN_MIN): number {
  let cap = 0;
  const span = Math.max(0, lastAppt(state, c) + 30 - fromMin);
  const ai = has(c, 'aiScheduler') ? AI_SCHEDULER : 1;
  for (const op of c.ops) {
    const iv = opInterval(state, c, op);
    if (iv) cap += Math.floor((span * ai) / iv);
  }
  return cap;
}

/** The only operatory that can serve is your own chair in hands-on mode (every patient waits for you). */
export function onlyPlayerHands(state: GameState, c: Clinic): boolean {
  const serving = c.ops.filter((o) => opStaffed(state, c, o));
  return serving.length > 0 && serving.every((o) => o.staffId === PLAYER_ID && o.playerMode === 'hands');
}

export function noShowRate(c: Clinic, state?: GameState): number {
  if (state) return noShowRateOf(state, c);
  const rec = c.staff.some((s) => s.role === 'receptionist');
  return 0.12 * (rec ? 0.6 : 1) * (c.equipment.includes('onlineBooking') ? 0.5 : 1);
}

/** A booking lane: one per serving operatory, with the time its next appointment can start. */
interface Lane { t: number; hands: boolean; f: number }

function bookingLanes(state: GameState, c: Clinic, fromMin: number, rng: Rng): Lane[] {
  const lanes: Lane[] = [];
  const ai = has(c, 'aiScheduler') ? AI_SCHEDULER : 1;
  for (const op of c.ops) {
    if (opClosed(state, c, op.id)) continue;
    let lane: Lane | null = null;
    if (op.staffId === PLAYER_ID) {
      const asst = staffById(c, op.assistantId);
      const f = op.playerMode === 'hands' ? 1 : opDuration(c, op) * (asst && isPresent(state, asst) ? 0.8 : 1) / (c.ownedByPlayer ? modAgg(state, c).speed : 1);
      lane = { t: 0, hands: op.playerMode === 'hands', f: f / ai };
    } else {
      const s = staffById(c, op.staffId);
      if (s && s.role === 'hygienist' && isPresent(state, s)) lane = { t: 0, hands: false, f: hygienistFactor(state, c, op, s) / ai };
    }
    if (!lane) continue;
    lane.t = fromMin + rng.range(0, 10);
    lanes.push(lane);
  }
  return lanes;
}

/** Expected minutes a patient holds a lane: service, average add-ons, whitening for a whitening case,
 * the archetype's difficulty and turnover. Your hands-on chair runs on the fast-forward clock. */
function slotMinutes(lane: Lane, arch: ArchetypeId, ct: CaseType, addonAvg: number): number {
  const service = ct === 'deep' ? 'deep' : 'cleaning';
  if (lane.hands) return HANDS_ON_MINUTES[service] + addonAvg + TURNOVER + 4;
  const white = ct === 'whitening' ? SERVICES.whitening.minutes : 0;
  return (SERVICES[service].minutes + addonAvg + white) * lane.f * ARCHETYPES[arch].difficulty + TURNOVER + 3;
}

/** Appointment slots spread across the serving operatory lanes, sorted by time (employer shifts). */
function laneSlots(state: GameState, c: Clinic, fromMin: number, rng: Rng): number[] {
  const slots: number[] = [];
  const last = lastAppt(state, c);
  const ai = has(c, 'aiScheduler') ? AI_SCHEDULER : 1;
  for (const op of c.ops) {
    const iv0 = opInterval(state, c, op);
    if (!iv0) continue;
    const iv = iv0 / ai;
    let t = fromMin + rng.range(0, Math.min(15, iv * 0.3));  // slot times are rounded below
    while (t <= last) {
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
  const sc = c as SimClinic;
  if (sc.startRatingDay !== state.day) { sc.startRating = c.rating; sc.startRatingDay = state.day; }
}

/** Total case boost of a clinic today (campaigns and events). Empty when nothing boosts. */
export function caseBoostOf(state: GameState, c: Clinic): Partial<Record<CaseType, number>> {
  return c.ownedByPlayer ? modAgg(state, c).caseBoost : {};
}

/**
 * Pick a patient and their case together. Without a boost this is the archetype mix, then the case mix of
 * that archetype; a case boost (campaigns, events) multiplies the joint odds of every archetype and case
 * pair with that case, so a pirate campaign brings pirates.
 */
export function pickArchCase(state: GameState, c: Clinic, rng: Rng, boost: Partial<Record<CaseType, number>>): { arch: ArchetypeId; ct: CaseType } {
  if (!Object.keys(boost).length) {
    const arch = pickArchetype(state, c, rng);
    return { arch, ct: pickCase(state, c, arch, rng) };
  }
  const pairs: { arch: ArchetypeId; ct: CaseType; w: number }[] = [];
  for (const arch of PATIENT_ARCHETYPES) {
    const wa = archetypeWeight(state, c, arch);
    if (!(wa > 0)) continue;
    let total = 0;
    const ws = CASE_ORDER.map((ct) => { const w = caseWeight(state, c, arch, ct); total += w; return w; });
    if (total <= 0) { pairs.push({ arch, ct: 'routine', w: wa }); continue; }
    CASE_ORDER.forEach((ct, i) => { if (ws[i] > 0) pairs.push({ arch, ct, w: wa * (ws[i] / total) * (boost[ct] ?? 1) }); });
  }
  const pick = rng.weighted(pairs, (x) => x.w);
  return { arch: pick.arch, ct: pick.ct };
}

/** The booking RNG of a clinic day: rebooking the same morning gives the same patients, so the huddle
 * can rebook after a decision without reshuffling everyone. */
function bookingRng(state: GameState, c: Clinic, fromMin: number): Rng {
  return makeRng(hashSeed(state.seed, 'book', state.day, c.id, fromMin));
}

/**
 * Book a clinic's day (owner phase). Demand is new patients plus yesterday's waitlist (booked first).
 * Overflow of today's new patients, up to one day of capacity, comes back tomorrow (`waitOut`); the rest
 * is turned away for good (`day.turnedAway`). Event VIPs and the Smile Studio VIP are added on top.
 */
export function bookClinic(state: GameState, c: Clinic, fromMin0 = OPEN_MIN): void {
  const sc = c as SimClinic;
  const rng = bookingRng(state, c, fromMin0);
  resetClinicDay(state, c, fromMin0);
  // prices lock at the day's first booking: a morning rebook (huddle decisions) keeps them
  if (sc.bookDay !== state.day || !sc.bookPrices) { sc.bookDay = state.day; sc.bookPrices = { cleaning: c.prices.cleaning ?? 1, deep: c.prices.deep ?? 1 }; }
  const locked = sc.bookPrices;
  const boss = sc.bossBoost ?? 1;
  const W = Math.max(0, Math.round(sc.waitIn ?? 0));
  sc.waitOut = 0;
  const fromMin = Math.max(fromMin0, OPEN_MIN + (c.ownedByPlayer ? modAgg(state, c).openDelay : 0));
  const last = lastAppt(state, c);
  if (fromMin > last - 15) { c.day.turnedAway = W; return; }
  const wd = weekdayOf(state.day);
  const partOfDay = Math.max(0, Math.min(1, (last - fromMin) / (last - OPEN_MIN)));
  const lambda = demandLambda(state, c, wd, locked.cleaning) * partOfDay * boss;
  const demand = rng.poisson(lambda);
  const cap = capacityOf(state, c, fromMin);
  c.day.demand = demand;
  if (cap <= 0 || !c.ops.some((o) => opInterval(state, c, o) != null)) {
    // nobody can clean here today: everyone is turned away (the report's hint to hire)
    c.day.booked = 0;
    c.day.turnedAway = demand + W;
    return;
  }
  // greedy lane scheduling: each patient takes the earliest free lane for their expected chair time, so
  // nobody is double-booked into a slot (a deep cleaning or a whitening gets the longer slot it needs)
  const lanes = bookingLanes(state, c, fromMin, rng);
  const addonAvg = addonChairMinutes(state, c, false);
  const ns = noShowRate(c, state);
  const boost = caseBoostOf(state, c);
  let bookedW = 0;
  let bookedN = 0;
  for (let i = 0; i < W + demand && lanes.length; i++) {
    let li = 0;
    for (let k = 1; k < lanes.length; k++) if (lanes[k].t < lanes[li].t) li = k;
    const lane = lanes[li];
    if (lane.t > last) break;
    const t = Math.round(lane.t);
    const { arch, ct } = pickArchCase(state, c, rng, boost);
    lane.t += slotMinutes(lane, arch, ct, addonAvg);
    const arrive = q64(Math.max(fromMin, t - rng.range(0, 8)));
    const p = makePatient(state, c, rng, { apptMin: t, arriveAt: arrive, walkIn: false, archetype: arch, caseType: ct });
    p.pm = { [p.service]: locked[p.service] };
    if (rng.chance(ns)) { p.state = 'noshow'; c.day.noShows += 1; }
    c.patients.push(p);
    if (i < W) bookedW++; else bookedN++;
  }
  const overflow = demand - bookedN;
  const carry = Math.min(overflow, cap);
  sc.waitOut = carry;
  c.day.booked = bookedW + bookedN;
  c.day.turnedAway = (W - bookedW) + (overflow - carry);
  // walk-ins (turned away at the door when no seat is free or nobody can take them)
  const walkIns = rng.poisson(WALKIN_RATE * lambda * (c.ownedByPlayer ? modAgg(state, c).walkins : 1));
  for (let i = 0; i < walkIns; i++) {
    const t = Math.round(rng.range(Math.max(fromMin + 20, OPEN_MIN + 30), last - 30));
    const { arch, ct } = pickArchCase(state, c, rng, boost);
    const p = makePatient(state, c, rng, { apptMin: t, arriveAt: t, walkIn: true, archetype: arch, caseType: ct });
    c.patients.push(p);
    c.day.walkIns += 1;
  }
  // VIPs: event guests booked for today, and the Smile Studio makeover (one a day)
  const vips = (sc.vips ?? []).filter((v) => v.day === state.day);
  if (has(c, 'smileStudio')) vips.push({ fee: STUDIO_VIP_FEE, weight: VIP_WEIGHT, day: state.day });
  vips.forEach((v, i) => {
    const t = Math.round(Math.max(fromMin + 30, Math.min(last - 60, 600 + 150 * i + rng.range(0, 40))));
    c.patients.push(makeVip(state, c, rng, t, v.fee, v.weight));
  });
  c.patients.sort((a, b) => a.apptMin - b.apptMin);
}

/** A VIP patient (event guest or Smile Studio makeover): flat fee, review weight 5, seated first. */
export function makeVip(state: GameState, c: Clinic, rng: Rng, t: number, fee: number, weight: number): SimPatient {
  const white = caseAllowed(state, c, 'whitening');
  const p = makePatient(state, c, rng, {
    apptMin: t, arriveAt: q64(Math.max(OPEN_MIN, t - 5)), walkIn: false, archetype: 'influencer', caseType: white ? 'whitening' : 'routine',
  });
  p.vip = true;
  p.vipFee = Math.round(fee);
  p.vipWeight = weight;
  p.patience = Math.round(p.patience * 1.5);
  return p;
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
  if (state.phase === 'owner') for (const c of state.locations) bookClinic(state, c, fromMin);
}

export function quickCleanChairMinutes(): number {
  return QUICK_CLEAN_MINUTES * 0.8;
}

export type { SimPatient };
