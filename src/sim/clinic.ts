// Clinic simulation: the patient state machine, NPC cleans, the front desk, dentists, reviews.
// DESIGN 8.1 to 8.3. Pure and deterministic: the world is processed on a fixed grid of GRID game
// minutes (k * GRID), and every transition happens at its exact time (since/until), so the result
// does not depend on how the caller slices tick() calls.
import type { Clinic, GameState, SimEvent, Staff } from '../core/types';
import type { Rng } from '../core/rng';
import { clamp, makeRng } from '../core/rng';
import {
  CHECKIN_MIN_STAFFED, CHECKIN_MIN_UNSTAFFED, CHECKOUT_MIN, PLAYER_ID, WALK_MIN,
} from '../core/constants';
import { ARCHETYPES, REVIEW_TEXT } from '../data/patients';
import { SERVICES } from '../data/services';
import { OFFICES } from '../data/offices';
import {
  GRID, REVIEWS_MAX, SimClinic, SimOp, q3, q64, SimPatient, SimStaff, addCash, clinicsOf, isPresent, isTerminal, opById, opClosed,
  priceOf, pushEvent, staffById,
} from './internal';
import { autoQuality, employeeRate, gainXp } from './progress';
import {
  addonAcceptMult, addonBase, addonFee, chairMinutes, decideAddons, downgradeCase, feeFor, hasDentist, offerableAddons, suppliesFor,
} from './patients';
import { hygienistFactor, onlyPlayerHands } from './booking';
import { checkAchievements, progressGoal } from './goals';
import { completeHuddle, eventById, huddlePending } from './manager';
import {
  VIP_WEIGHT, addStaffXp, addonMinutesMult, closeMin, has, modAgg, opComfort, opDuration, opQuality, perkAdd, perkMult, specialty,
  suppliesMult,
} from './effects';

/** Minutes after closing after which anyone still inside is sent home (safety valve). */
const HARD_CLOSE_AFTER = 240;
const DENTIST_WAIT_MAX = 20;
/** The dentist drops in for the exam during the last minutes of the cleaning. */
const DENTIST_LEAD = 12;
/** A patient seated for you always gets at least this many minutes in your chair before giving up. */
export const MIN_CHAIR_WINDOW = 20;
/** Your chair on autopilot works a little below a quick clean (DESIGN 5.9: the team does the work). */
const AUTOPILOT_PENALTY = 0.05;
/** Wait walkouts review gently (DESIGN 10.3). */
export const WAIT_REVIEW_CHANCE = 0.5;
export const WAIT_REVIEW_WEIGHT = 0.5;

interface Ctx {
  state: GameState;
  c: Clinic;
  g: number;
  rng: Rng;
  ev: SimEvent[];
  owner: boolean;       // this clinic belongs to the player
  employee: boolean;    // employee phase
  hold?: boolean;       // waiting-room patience is paused (a fast-forward while only you can clean here)
}

// ------------------------------------------------------------------ public entry

/**
 * Advance the world by `minutes`. `hold` lists clinics whose waiting room does not lose patience in
 * this window: the fast-forward after your own clean, where nobody but you could have seated them.
 */
export function tickWorld(state: GameState, minutes: number, hold: readonly string[] = []): SimEvent[] {
  const ev: SimEvent[] = [];
  if (state.phase === 'school' || state.dayOver || !(minutes > 0) || !Number.isFinite(minutes)) return ev;
  // the doors open: an unfinished morning huddle is answered with the first choices (DESIGN 10.1)
  if (huddlePending(state)) {
    for (const r of completeHuddle(state, ev)) {
      const e = eventById(r.eventId);
      ev.push({ type: 'toast', text: `${e?.title ?? 'Event'}: ${r.text}`, kind: r.good ? 'good' : 'bad' });
    }
  }
  const clinics = clinicsOf(state);
  const rng = makeRng(state.rng >>> 0);
  const end = state.minute + minutes;
  let k = Math.floor(state.minute / GRID + 1e-9) + 1;
  while (k * GRID <= end + 1e-9) {
    const g = k * GRID;
    state.minute = g;
    for (const c of clinics) stepClinic({ state, c, g, rng, ev, owner: c.ownedByPlayer, employee: state.phase === 'employee', hold: hold.includes(c.id) });
    if (dayDone(state, g)) {
      state.dayOver = true;
      ev.push({ type: 'dayOver' });
      break;
    }
    k++;
  }
  if (!state.dayOver) state.minute = end;
  state.rng = rng.state();
  if (ev.length) checkAchievements(state, ev);
  return ev;
}

function dayDone(state: GameState, g: number): boolean {
  // everyone is gone (or never came): past closing, or earlier when nobody else is booked
  for (const c of clinicsOf(state)) for (const p of c.patients) if (!isTerminal(p)) return false;
  return g > 0;
}

// ------------------------------------------------------------------ one grid step

export function stepClinic(ctx: Ctx): void {
  const { c, g } = ctx;
  // arrivals
  for (const p0 of c.patients) {
    const p = p0 as SimPatient;
    if (p.state !== 'scheduled') continue;
    const at = p.arriveAt ?? p.apptMin;
    if (at > g) continue;
    if (at > closeMin(ctx.state, c)) { p.state = 'noshow'; p.since = at; continue; }
    if (p.walkIn && !walkInWelcome(ctx)) {
      // no seat free, or nobody free to take them: the walk-in does not come in
      p.state = 'noshow';
      p.since = at;
      c.day.turnedAway += 1;
      continue;
    }
    if (p.walkIn) p.pm = { [p.service]: c.prices[p.service] ?? 1 };   // walk-ins pay the price at arrival
    p.state = 'entering';
    p.since = at;
    p.until = at + WALK_MIN;
    p.arrivedMin = at;
    p.mood = 'happy';
    pushEvent(ctx.ev, { type: 'arrive', clinicId: c.id, patientId: p.id });
  }
  let guard = 0;
  let changed = true;
  while (changed && guard++ < 12) {
    changed = false;
    for (const p of c.patients) if (advance(ctx, p as SimPatient)) changed = true;
    if (runDesk(ctx)) changed = true;
    if (seatPatients(ctx)) changed = true;
    if (dispatchDentists(ctx)) changed = true;
  }
  // staff live tasks
  for (const s of c.staff) {
    if (!isPresent(ctx.state, s)) { s.task = 'off'; continue; }
    if (s.task === 'off') s.task = 'idle';
    if (s.role === 'receptionist' || s.role === 'dentist') {
      const busy = s.busyUntil != null && s.busyUntil > g;
      s.task = busy ? (s.role === 'dentist' ? 'exam' : 'checkin') : 'idle';
      if (!busy) { s.busyUntil = null; if (s.role === 'dentist') s.targetOpId = null; }
    }
  }
  if (g >= closeMin(ctx.state, c) + HARD_CLOSE_AFTER) sendEveryoneHome(ctx);
}

/** Walk-ins come in only when a seat is free and someone can clean them; with only your own hands-on
 * chair serving, only into an empty waiting room (you cannot clean faster than the fast-forward). */
function walkInWelcome(ctx: Ctx): boolean {
  const { c, state } = ctx;
  const waiting = waitingCount(c);
  if (waiting >= seatsOf(c)) return false;
  const serving = c.ops.filter((o) => opServes(ctx, o as SimOp));
  if (!serving.length) return false;
  // walk-ins take the gaps: they stay when a chair is free or nobody else is waiting
  if (c.ownedByPlayer && waiting > 0 && !serving.some((o) => o.patientId == null)) return false;
  if (onlyPlayerHands(state, c) && waiting > 0) return false;
  return true;
}

function seatsOf(c: Clinic): number {
  return OFFICES[c.tier].seats;
}

function waitingCount(c: Clinic): number {
  let n = 0;
  for (const p of c.patients) if (p.state === 'waiting' || p.state === 'checkin' || p.state === 'entering') n++;
  return n;
}

function freeSeat(c: Clinic): number | null {
  const used = new Set<number>();
  for (const p of c.patients) if (p.state === 'waiting' && p.seat != null) used.add(p.seat);
  const n = seatsOf(c);
  for (let i = 0; i < n; i++) if (!used.has(i)) return i;
  return null;
}

function moodFor(frac: number): 'happy' | 'ok' | 'grumpy' {
  return frac < 0.4 ? 'happy' : frac < 0.75 ? 'ok' : 'grumpy';
}

// ------------------------------------------------------------------ per-patient transitions

function advance(ctx: Ctx, p: SimPatient): boolean {
  const { g, c } = ctx;
  switch (p.state) {
    case 'entering':
      if (p.until != null && p.until <= g) {
        p.state = 'checkin';
        p.since = p.until;
        p.until = null; // queued at the desk until an agent takes them
        return true;
      }
      return false;
    case 'checkin':
      if (p.until != null && p.until <= g) {
        const t = p.until;
        decideAddons(ctx.state, c, p, ctx.rng);
        p.state = 'waiting';
        p.since = t;
        p.until = null;
        p.seat = freeSeat(c);
        p.wbase = 0;
        p.waitedMin = 0;
        return true;
      }
      return false;
    case 'waiting': {
      if (ctx.hold) {
        // patience paused: carry the minutes already waited and restart the clock from now
        p.wbase = p.waitedMin;
        p.since = g;
        return false;
      }
      // early arrivals do not mind waiting until their appointment time
      const wb = p.wbase ?? 0;
      const ws = Math.max(p.since, p.apptMin);
      const tw = ws + (p.patience - wb);
      if (tw <= g) {
        walkout(ctx, p, Math.max(p.since, tw), 'wait');
        return true;
      }
      p.waitedMin = wb + Math.max(0, g - ws);
      p.mood = moodFor(p.waitedMin / p.patience);
      return false;
    }
    case 'toChair':
      if (p.until != null && p.until <= g) {
        arriveInChair(ctx, p, p.until);
        return true;
      }
      return false;
    case 'inChair':
      return advanceChair(ctx, p);
    case 'toDesk':
      if (p.until != null && p.until <= g) {
        p.state = 'checkout';
        p.since = p.until;
        p.until = p.since + CHECKOUT_MIN;
        return true;
      }
      return false;
    case 'checkout':
      if (p.until != null && p.until <= g) {
        const t = p.until;
        checkout(ctx, p);
        p.state = 'exiting';
        p.since = t;
        p.until = t + WALK_MIN;
        return true;
      }
      return false;
    case 'exiting':
    case 'walkout':
      if (p.until != null && p.until <= g) {
        p.state = 'gone';
        p.since = p.until;
        p.until = null;
        p.seat = null;
        compactGone(p);
        return true;
      }
      return false;
    default:
      return false;
  }
}

function advanceChair(ctx: Ctx, p: SimPatient): boolean {
  const { g, c } = ctx;
  const op = opById(c, p.opId);
  if (!op) { leaveChair(ctx, p, g); return true; }
  switch (p.stage) {
    case 'await': {
      // player's chair in hands mode (or an unstaffed op): patience runs 1.5x slower while seated
      if (canNpcServe(ctx, op) && !(p.isPlayerPatient && ctx.employee && op.staffId !== PLAYER_ID)) {
        startClean(ctx, p, op, Math.max(p.since, g - GRID));
        return true;
      }
      const wb = p.wbase ?? 0;
      const tv = op.upgrades.includes('tv') ? 1.25 : 1;
      const tw = p.since + Math.max(MIN_CHAIR_WINDOW, (p.patience - wb) * 1.5 * tv);
      if (tw <= g) {
        walkout(ctx, p, Math.max(p.since, tw), 'wait');
        return true;
      }
      p.waitedMin = Math.round(Math.min(p.patience, wb + (g - p.since) / (1.5 * tv)) * 100) / 100;
      p.mood = moodFor(p.waitedMin / p.patience);
      return false;
    }
    case 'clean':
      if (p.until != null && p.until <= g) {
        finishClean(ctx, p, op, p.until);
        return true;
      }
      return false;
    case 'waitDentist':
      if (!hasDentist(ctx.state, c) || g - p.since > DENTIST_WAIT_MAX) {
        // no dentist free after all: skip the exam (and do not bill it)
        p.addons = p.addons.filter((a) => a !== 'exam');
        p.fee = Math.round(p.fee - addonFee(c, p, 'exam') * (p.fm ?? 1));
        p.examDone = true;
        leaveChair(ctx, p, g);
        return true;
      }
      return false;
    case 'dentist':
      if (p.until != null && p.until <= g) {
        const t = p.until;
        p.examDone = true;
        leaveChair(ctx, p, t);
        return true;
      }
      return false;
    default:
      // unknown stage (old save): treat as awaiting
      p.stage = 'await';
      return true;
  }
}

/** Can the op's staff clean without the player: a present hygienist, or the player's chair on autopilot. */
function canNpcServe(ctx: Ctx, op: SimOp): boolean {
  if (opClosed(ctx.state, ctx.c, op.id)) return false;
  if (op.staffId === PLAYER_ID) return op.playerMode === 'auto';
  const s = staffById(ctx.c, op.staffId);
  return !!s && s.role === 'hygienist' && isPresent(ctx.state, s);
}

function opServes(ctx: Ctx, op: SimOp): boolean {
  if (opClosed(ctx.state, ctx.c, op.id)) return false;
  if (op.staffId === PLAYER_ID) return true;
  const s = staffById(ctx.c, op.staffId);
  return !!s && s.role === 'hygienist' && isPresent(ctx.state, s);
}

function arriveInChair(ctx: Ctx, p: SimPatient, t: number): void {
  const op = opById(ctx.c, p.opId);
  p.state = 'inChair';
  p.since = t;
  p.until = null;
  if (!op) { leaveChair(ctx, p, t); return; }
  pushEvent(ctx.ev, { type: 'seated', clinicId: ctx.c.id, patientId: p.id, opId: op.id });
  const playerHands = op.staffId === PLAYER_ID && op.playerMode === 'hands';
  if (!playerHands && canNpcServe(ctx, op)) {
    startClean(ctx, p, op, t);
    return;
  }
  p.stage = 'await';
  p.awaitingPlayer = playerHands;
  if (playerHands) pushEvent(ctx.ev, { type: 'awaitingPlayer', clinicId: ctx.c.id, patientId: p.id, opId: op.id });
}

/** NPC (or player autopilot) clean: roll quality, comfort and duration (DESIGN 8.2, 10.4, 10.5). */
function startClean(ctx: Ctx, p: SimPatient, op: SimOp, t: number): void {
  const { c, state, rng } = ctx;
  const a = ARCHETYPES[p.archetype];
  const mods = c.ownedByPlayer ? modAgg(state, c) : null;
  const asst = staffById(c, op.assistantId);
  const assistF = asst && isPresent(state, asst) ? 0.8 / perkMult(asst, 'speed') : 1;
  const mins = chairMinutes(p, c);
  const baseComfort = opComfort(c, op);
  let q: number;
  let comfort: number;
  let d: number;
  if (op.staffId === PLAYER_ID) {
    q = clamp(autoQuality(state) - AUTOPILOT_PENALTY + (mods?.quality ?? 0) + rng.normal(0, 0.03), 0.2, 0.99);
    comfort = clamp((0.4 + 0.45 * 0.6 + baseComfort) * (mods?.comfort ?? 1), 0, 1);
    d = mins * 1.0 * a.difficulty * assistF * opDuration(c, op) / (mods?.speed ?? 1);
    p.staffId = PLAYER_ID;
  } else {
    const s = staffById(c, op.staffId) as Staff;
    const tr = s.traits;
    const spec = specialty(s, p.caseType);
    let mean = 0.42 + 0.5 * s.skill / 100 + opQuality(c, op) + (s.morale - 50) / 500 + perkAdd(s, 'quality') + (mods?.quality ?? 0);
    if (tr.includes('perfectionist')) mean += 0.05;
    if (tr.includes('speedy')) mean -= 0.03;
    if (spec) mean += spec.caseQuality ?? 0;
    if (p.caseType === 'whitening' && has(c, 'laserWhitening')) mean += 0.05;
    q = rng.normal(mean, 0.07);
    if (tr.includes('clumsy') && rng.chance(0.05)) q -= 0.3;
    q = clamp(q, 0.2, 0.99);
    comfort = clamp((0.4 + 0.45 * s.bedside / 100 + baseComfort + (tr.includes('charmer') ? 0.1 : 0) + perkAdd(s, 'comfort')) * (mods?.comfort ?? 1), 0, 1);
    let speedF = hygienistFactor(state, c, op, s);
    if (tr.includes('nightOwl') && t < 540) speedF *= 1.2;
    if (spec?.caseSpeed) speedF /= spec.caseSpeed;
    d = mins * speedF * a.difficulty;
    s.task = 'cleaning';
    s.busyUntil = t + q64(Math.max(5, d));
    // an Ergonomic Stool: the hygienist tires less (chair minutes count 80% toward overwork)
    (s as SimStaff).workMin = ((s as SimStaff).workMin ?? 0) + Math.max(5, d) * (op.upgrades.includes('ergoStool') ? 0.8 : 1);
    p.staffId = s.id;
    // Pirate Whisperer: the patient of their case leaves a tip, multiplied by the perk
    const tipMult = spec?.tipMult ?? 0;
    if (tipMult > 0 && c.ownedByPlayer) {
      const qf = Math.max(0, (q - 0.6) / 0.4);
      p.preTip = Math.round(SERVICES[p.service].fee * a.tipRate * Math.max(0.5, qf) * tipMult);
    }
  }
  if (asst && isPresent(state, asst)) (asst as SimStaff).workMin = ((asst as SimStaff).workMin ?? 0) + Math.max(5, d);
  p.stage = 'clean';
  p.awaitingPlayer = false;
  p.preQ = q3(q);
  p.preC = q3(comfort);
  p.since = t;
  p.until = t + q64(Math.max(5, d));
}

function finishClean(ctx: Ctx, p: SimPatient, op: SimOp, t: number): void {
  const { c, state } = ctx;
  p.quality = p.preQ ?? p.quality ?? 0.6;
  p.comfort = p.preC ?? p.comfort ?? 0.6;
  const who = p.staffId ?? op.staffId ?? PLAYER_ID;
  pushEvent(ctx.ev, { type: 'cleaned', clinicId: c.id, patientId: p.id, staffId: who, quality: p.quality });
  const s = staffById(c, who);
  if (s) {
    s.patientsToday += 1;
    addStaffXp(state, c, s);
    s.task = 'idle';
    s.busyUntil = null;
  }
  const asst = staffById(c, op.assistantId);
  if (asst && isPresent(state, asst)) { asst.patientsToday += 1; addStaffXp(state, c, asst); }
  if (who === PLAYER_ID && !p.hands) autopilotDone(ctx, p);
  if (p.addons.includes('exam') && !p.examDone && hasDentist(state, c)) {
    if (p.examUntil != null) {
      if (p.examUntil <= t) p.examDone = true;
      else {
        // the dentist is still at it: stay for the rest of the exam
        p.stage = 'dentist';
        p.since = t;
        p.until = p.examUntil;
        return;
      }
    } else {
      p.stage = 'waitDentist';
      p.since = t;
      p.until = null;
      return;
    }
  }
  leaveChair(ctx, p, t);
}

/** The player's chair on autopilot finished a patient. */
function autopilotDone(ctx: Ctx, p: SimPatient): void {
  const { state } = ctx;
  const q = p.quality ?? 0.6;
  p.hands = true;
  p.seen = true;
  // autopilot earns no XP (DESIGN 5.9); an employee chair on autopilot is paid like a quick clean
  state.stats.quickCleans += 1;
  if (ctx.employee && p.isPlayerPatient) {
    const pay = Math.round(employeeRate(state.player.level) * (0.4 + 0.8 * q) * 0.5);
    addCash(state, pay, 'Wages');
    pushEvent(ctx.ev, { type: 'paid', clinicId: ctx.c.id, patientId: p.id, amount: pay });
    shiftBonusCheck(state, ctx.c, ctx.ev);
  }
}

/** Employee shift bonus: every shift patient seen. Returns the bonus paid (0 if not yet). */
export function shiftBonusCheck(state: GameState, c: Clinic, ev: SimEvent[] | null): number {
  if (state.flags['shiftBonusPaid']) return 0;
  const mine = c.patients.filter((p) => p.isPlayerPatient);
  if (!mine.length || !mine.every((p) => (p as SimPatient).seen)) return 0;
  state.flags['shiftBonusPaid'] = true;
  addCash(state, 40, 'Shift bonus');
  pushEvent(ev, { type: 'toast', text: 'Shift bonus: every patient seen', kind: 'good' });
  return 40;
}

export function leaveChair(ctx: Ctx, p: SimPatient, t: number): void {
  const op = opById(ctx.c, p.opId);
  if (op && op.patientId === p.id) {
    op.patientId = null;
    op.freeAt = t;
  }
  p.state = 'toDesk';
  p.stage = null;
  p.since = t;
  p.until = t + WALK_MIN;
  p.awaitingPlayer = false;
  p.opId = null;
  if (p.stars != null && p.stars >= 4) p.mood = 'happy';
  else if (p.quality != null) p.mood = p.quality >= 0.7 ? 'happy' : p.quality >= 0.5 ? 'ok' : 'grumpy';
}

function walkout(ctx: Ctx, p: SimPatient, t: number, reason: 'wait' | 'comfort'): void {
  const { c, state } = ctx;
  const op = opById(c, p.opId);
  if (op && op.patientId === p.id) { op.patientId = null; op.freeAt = t; }
  p.waitedMin = p.patience;
  p.state = 'walkout';
  p.stage = null;
  p.since = t;
  p.until = t + WALK_MIN;
  p.seat = null;
  p.opId = null;
  p.awaitingPlayer = false;
  p.mood = 'angry';
  c.day.walkouts += 1;
  pushEvent(ctx.ev, { type: 'walkout', clinicId: c.id, patientId: p.id, reason });
  if (reason === 'wait') {
    // waited too long: reviews half the time, 2 stars, weight 0.5 (DESIGN 10.3); a VIP still counts more
    if (ctx.rng.chance(WAIT_REVIEW_CHANCE)) addReview(state, c, p, 2, ctx.ev, 'Waited too long. Left before my turn.', 1, WAIT_REVIEW_WEIGHT * (p.vip ? VIP_WEIGHT : 1));
    else p.reviewed = true;
  } else {
    addReview(state, c, p, 1, ctx.ev);
  }
  if (p.isPlayerPatient && ctx.employee) state.stats.fiveStarStreak = 0;
}

export function walkoutFromChair(state: GameState, c: Clinic, p: SimPatient, ev: SimEvent[]): void {
  walkout({ state, c, g: state.minute, rng: makeRng(1), ev, owner: c.ownedByPlayer, employee: state.phase === 'employee' }, p, state.minute, 'comfort');
}

function checkout(ctx: Ctx, p: SimPatient): void {
  const { c, state } = ctx;
  const due = Math.max(0, Math.round(p.fee - (p.billed ?? 0)));
  p.billed = (p.billed ?? 0) + due;
  c.day.revenue += due;
  c.day.supplies += suppliesFor(p) * (ctx.owner ? suppliesMult(state, c) : 1);
  c.day.addonsSold += p.addons.length;
  c.day.served += 1;
  c.served += 1;
  const sc = c as SimClinic;
  if (typeof sc.reach === 'number') sc.reach += 1;
  if (ctx.owner) {
    if (due > 0) {
      addCash(state, due, 'Patient fees');
      pushEvent(ctx.ev, { type: 'paid', clinicId: c.id, patientId: p.id, amount: due });
    }
    if (p.preTip && p.preTip > 0) {
      c.day.tips += p.preTip;
      p.tip = (p.tip ?? 0) + p.preTip;
      addCash(state, p.preTip, 'Tips');
      delete p.preTip;
    }
    state.stats.patientsServed += 1;
    if (p.staffId !== PLAYER_ID) gainXp(state, 2, ctx.ev);
    progressGoal(state, 'served', 1, ctx.ev);
    if (p.addons.length) progressGoal(state, 'addons', p.addons.length, ctx.ev);
  } else if (p.isPlayerPatient) {
    state.stats.patientsServed += 1;
  }
  for (const s of c.staff) {
    if (s.role === 'manager' && isPresent(state, s)) addStaffXp(state, c, s, 0.25);
  }
  if (!p.reviewed) reviewFor(ctx, p);
}

function reviewFor(ctx: Ctx, p: SimPatient): void {
  const { c, state, rng } = ctx;
  p.reviewed = true;
  const a = ARCHETYPES[p.archetype];
  const always = a.reviewWeight >= 3 || p.vip;
  if (!always && !rng.chance(0.6)) return;
  const stars = reviewStars(p.quality ?? 0.6, p.comfort ?? 0.6, p.waitedMin, p.patience, priceOf(c, p, p.service));
  addReview(state, c, p, stars, ctx.ev, undefined, 1, p.vip ? (p.vipWeight ?? VIP_WEIGHT) : undefined);
}

export function reviewStars(quality: number, comfort: number, waited: number, patience: number, priceMult: number): number {
  const waitScore = 1 - clamp(waited / Math.max(1, patience), 0, 1);
  const e = 0.55 * quality + 0.25 * comfort + 0.2 * waitScore - 0.4 * Math.max(0, priceMult - 1);
  return e >= 0.85 ? 5 : e >= 0.74 ? 4 : e >= 0.6 ? 3 : e >= 0.45 ? 2 : 1;
}

/** Add a review. `weight0` overrides the archetype weight (VIPs, gentle wait walkouts). */
export function addReview(state: GameState, c: Clinic, p: SimPatient, stars: number, ev: SimEvent[] | null, text?: string, weightMult = 1, weight0?: number): void {
  const a = ARCHETYPES[p.archetype];
  const weight = weight0 != null ? weight0 : Math.max(1, a.reviewWeight) * Math.max(1, weightMult);
  const pool = REVIEW_TEXT[stars] ?? REVIEW_TEXT[3];
  // pick text deterministically from the patient id so reviews need no rng draw here
  let h = 0;
  for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0;
  const body = text ?? pool[h % pool.length];
  p.stars = stars;
  p.reviewed = true;
  c.reviews.push({ day: state.day, name: p.name, archetype: p.archetype, stars, weight, text: body });
  if (c.reviews.length > REVIEWS_MAX) c.reviews.splice(0, c.reviews.length - REVIEWS_MAX);
  c.rating = computeRating(c);
  if (stars === 5) {
    c.day.fiveStars += 1;
    if (c.ownedByPlayer) progressGoal(state, 'fiveStars', 1, ev);
  }
  pushEvent(ev, { type: 'review', clinicId: c.id, stars, text: body, name: p.name, patientId: p.id });
}

/** Weighted reviews blended with a 3.5 prior of weight 3; a Fish Tank adds a flat +0.1, a Spa Lounge +0.15,
 * events their fading rating bonus (clamped 1..5). */
export function computeRating(c: Clinic): number {
  const prior = 3.5;
  let sw = 0;
  let s = 0;
  for (const r of c.reviews) { s += r.stars * r.weight; sw += r.weight; }
  const flat = (c.equipment.includes('fishTank') ? 0.1 : 0) + (c.equipment.includes('spaLounge') ? 0.15 : 0) + ((c as SimClinic).ratingBonus ?? 0);
  return Math.round(Math.max(1, Math.min(5, (prior * 3 + s) / (3 + sw) + flat)) * 100) / 100;
}

// ------------------------------------------------------------------ front desk

function runDesk(ctx: Ctx): boolean {
  const { c, state, g } = ctx;
  const queue = c.patients.filter((p) => p.state === 'checkin' && p.until == null);
  if (!queue.length) return false;
  queue.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
  const recs = c.staff.filter((s) => s.role === 'receptionist' && isPresent(state, s));
  let changed = false;
  for (const p of queue) {
    // earliest free agent
    let bestFree = Infinity;
    let best: Staff | null = null;
    if (recs.length) {
      for (const r of recs) {
        const f = r.busyUntil ?? 0;
        if (f < bestFree) { bestFree = f; best = r; }
      }
    } else {
      bestFree = c.checkinBusyUntil || 0;
    }
    const start = Math.max(bestFree, p.since);
    if (start > g) break;
    let dur = CHECKIN_MIN_UNSTAFFED;
    if (best) {
      dur = q64(CHECKIN_MIN_STAFFED * (1.2 - 0.4 * best.skill / 100) / perkMult(best, 'speed'));
      best.busyUntil = start + dur;
      best.task = 'checkin';
      best.patientsToday += 1;
      addStaffXp(state, c, best);
      (p as SimPatient).deskBy = best.id;
    } else {
      c.checkinBusyUntil = start + dur;
    }
    p.since = start;
    p.until = start + dur;
    changed = true;
  }
  return changed;
}

// ------------------------------------------------------------------ seating

function seatPatients(ctx: Ctx): boolean {
  const { c, g } = ctx;
  // hired hygienists (and your autopilot) take patients first; your hands-on chair only gets one
  // when nobody else is free, so nobody waits in your chair while a colleague stands idle
  const handsChair = (o: SimOp) => o.staffId === PLAYER_ID && o.playerMode === 'hands';
  const free = (c.ops as SimOp[]).filter((o) => o.patientId == null && opServes(ctx, o))
    .sort((a, b) => Number(handsChair(a)) - Number(handsChair(b)));
  if (!free.length) return false;
  const waiting = c.patients.filter((p) => p.state === 'waiting') as SimPatient[];
  if (!waiting.length) return false;
  // VIPs first, then booked patients whose time has come (walk-ins take the gaps), then appointment order
  const due = (p: SimPatient) => (!p.walkIn && p.apptMin <= g ? 0 : 1);
  waiting.sort((a, b) => Number(!!b.vip) - Number(!!a.vip) || due(a) - due(b) || a.apptMin - b.apptMin || (a.id < b.id ? -1 : 1));
  let changed = false;
  for (const p of waiting) {
    if (!free.length) break;
    let idx = -1;
    let score = -1;
    for (let i = 0; i < free.length; i++) {
      const o = free[i];
      if (ctx.employee) {
        const mine = o.staffId === PLAYER_ID;
        if (mine !== p.isPlayerPatient) continue;
      }
      // whitening needs the lamp; a specialist of the patient's case comes next; else the first free
      let sc = 0;
      if (p.addons.includes('whitening') && o.upgrades.includes('whiteningLamp')) sc += 4;
      if (ctx.owner && specialty(staffById(c, o.staffId), p.caseType)) sc += 2;
      if (sc > score) { score = sc; idx = i; }
    }
    if (idx < 0) continue;
    const op = free.splice(idx, 1)[0];
    if (ctx.owner && (p.caseType === 'whitening' || p.addons.includes('whitening')) && !op.upgrades.includes('whiteningLamp')) {
      downgradeCase(c, p);   // no lamp in this operatory: a routine cleaning instead
    }
    if (ctx.owner) chairsideUpsell(ctx, p, op);
    // never seat in the past: an operatory that just started serving has a stale freeAt
    const start = Math.max(g - GRID, Math.min(g, Math.max(op.freeAt ?? 0, p.since)));
    p.wbase = (p.wbase ?? 0) + Math.max(0, start - Math.max(p.since, p.apptMin));
    p.waitedMin = p.wbase;
    op.patientId = p.id;
    p.opId = op.id;
    p.staffId = op.staffId;
    p.state = 'toChair';
    p.seat = null;
    p.since = start;
    p.until = start + WALK_MIN;
    changed = true;
  }
  return changed;
}

/** An Upsell Star hygienist offers the add-ons the front desk did not sell, once, at the chair. */
function chairsideUpsell(ctx: Ctx, p: SimPatient, op: SimOp): void {
  const { c, state, rng } = ctx;
  const s = staffById(c, op.staffId);
  const extra = perkMult(s, 'addons') - 1;
  if (!(extra > 0) || p.isPlayerPatient) return;
  let added = false;
  for (const id of offerableAddons(state, c, p)) {
    if (p.addons.includes(id) || id === 'exam') continue;
    const pr = Math.min(0.95, addonBase(p, id) * addonAcceptMult(state, c, id) * extra);
    if (rng.chance(pr)) {
      p.addons = [...p.addons, id];
      p.pm = { ...(p.pm ?? {}), [id]: c.prices[id] ?? 1 };
      added = true;
    }
  }
  if (added) p.fee = feeFor(c, p);
}

// ------------------------------------------------------------------ dentists

function dispatchDentists(ctx: Ctx): boolean {
  const { c, state, g, rng } = ctx;
  const want = c.patients.filter((p0) => {
    const p = p0 as SimPatient;
    if (p.state !== 'inChair' || p.examDone || p.examUntil != null || !p.addons.includes('exam')) return false;
    return p.stage === 'waitDentist' || (p.stage === 'clean' && p.until != null && p.until - g <= DENTIST_LEAD);
  }) as SimPatient[];
  if (!want.length) return false;
  const docs = c.staff.filter((s) => s.role === 'dentist' && isPresent(state, s));
  if (!docs.length) return false;
  const readyAt = (p: SimPatient) => (p.stage === 'clean' ? (p.until as number) - DENTIST_LEAD : p.since);
  want.sort((a, b) => readyAt(a) - readyAt(b) || (a.id < b.id ? -1 : 1));
  let changed = false;
  for (const p of want) {
    let best: Staff | null = null;
    for (const d of docs) {
      const f = d.busyUntil ?? 0;
      if (f <= g && (!best || f < (best.busyUntil ?? 0))) best = d;
    }
    if (!best) break;
    const start = Math.min(g, Math.max(best.busyUntil ?? 0, readyAt(p)));
    const pace = (1.2 - 0.4 * best.speed / 100) / perkMult(best, 'speed');
    let mins = WALK_MIN + q64(SERVICES.exam.minutes * pace);
    if (rng.chance(0.25)) {
      p.addons = [...p.addons, 'filling'];
      p.pm = { ...(p.pm ?? {}), filling: p.pm?.filling ?? c.prices.filling ?? 1 };
      p.fee = feeFor(c, p);
      mins += q64(SERVICES.filling.minutes * pace * addonMinutesMult(c, 'filling'));
    }
    const gentle = perkAdd(best, 'comfort');
    if (gentle > 0) {
      if (p.preC != null) p.preC = q3(Math.min(1, p.preC + gentle / 2));
      if (p.comfort != null) p.comfort = q3(Math.min(1, p.comfort + gentle / 2));
    }
    best.task = 'exam';
    best.targetOpId = p.opId;
    best.busyUntil = start + mins;
    best.patientsToday += 1;
    addStaffXp(state, c, best);
    p.examUntil = start + mins;
    if (p.stage === 'waitDentist') {
      p.stage = 'dentist';
      p.since = start;
      p.until = p.examUntil;
    }
    changed = true;
  }
  return changed;
}

/** Drop bookkeeping a patient no longer needs once they have left (keeps saves small). */
function compactGone(p: SimPatient): void {
  delete p.preQ; delete p.preC; delete p.wbase; delete p.stage; delete p.examUntil; delete p.examDone;
  delete p.billed; delete p.arriveAt; delete p.hands; delete p.reviewed; delete p.pm; delete p.gel;
}

function sendEveryoneHome(ctx: Ctx): void {
  for (const p0 of ctx.c.patients) {
    const p = p0 as SimPatient;
    if (isTerminal(p)) continue;
    if (p.state === 'scheduled') { p.state = 'noshow'; continue; }
    const op = opById(ctx.c, p.opId);
    if (op && op.patientId === p.id) op.patientId = null;
    p.state = 'gone';
    p.until = null;
    p.opId = null;
    p.seat = null;
    p.awaitingPlayer = false;
    compactGone(p);
  }
}

export type { Ctx };
