// Career: new game, migration, school, the hands-on and quick-clean flows. DESIGN 3 and 4.
import type {
  AddonId, CleanResult, CleanSetup, Clinic, DayPatient, GameState, HandsOnPayout, Operatory, SimEvent, Staff,
} from '../core/types';
import { hashSeed, clamp } from '../core/rng';
import {
  EMPLOYER_BOSS, EMPLOYER_NAME, HANDS_ON_MINUTES, OPEN_MIN, PLAYER_ID, QUICK_CLEAN_MINUTES,
} from '../core/constants';
import { SAVE_VERSION } from '../core/save';
import { ARCHETYPES } from '../data/patients';
import { SERVICES, defaultPrices } from '../data/services';
import { CHAIRS } from '../data/upgrades';
import {
  S, SimPatient, addCash, clinicsOf, q3, q64, emptyDayStats, findPatient, hasSkill, nextId, opById, withRng,
} from './internal';
import { autoQuality, employeeRate, gainXp, starsFor, title } from './progress';
import { addonMinutes, buildSetup, difficultyScale, handsFee } from './patients';
import { addReview, computeRating, reviewStars, shiftBonusCheck, tickWorld, walkoutFromChair } from './clinic';
import { bookDay } from './booking';
import { checkAchievements, makeGoals, progressGoal } from './goals';

// ------------------------------------------------------------------ lifecycle

export function newGame(opts: { name: string; avatar: number; seed?: number; nowMs: number }): GameState {
  const seed = (opts.seed ?? hashSeed('floss', opts.nowMs, opts.name)) >>> 0;
  return {
    version: SAVE_VERSION,
    seed,
    rng: hashSeed(seed, 'rng'),
    createdAt: opts.nowMs,
    lastSeen: opts.nowMs,
    phase: 'school',
    player: {
      name: (opts.name || 'Hygienist').slice(0, 24),
      avatar: clamp(Math.round(opts.avatar) || 0, 0, 3),
      level: 1,
      xp: 0,
      skillPoints: 0,
      skills: [],
      tools: { scaler: 1, polisher: 1, floss: 1, suction: 1, rinse: 1 },
      extras: [],
      numbingGel: 0,
      useGel: true,
      title: 'Hygiene Student',
    },
    cash: 0,
    loan: 0,
    day: 1,
    minute: OPEN_MIN,
    dayOver: false,
    speed: 1,
    employer: null,
    locations: [],
    active: -1,
    candidates: [],
    ledger: [],
    reports: [],
    goals: [],
    goalsDay: 0,
    achievements: [],
    stats: {
      cleanings: 0, quickCleans: 0, chunks: 0, perfect: 0, fiveStars: 0, bestCombo: 0, fastestClean: 0,
      earned: 0, patientsServed: 0, hires: 0, daysPlayed: 0, fiveStarStreak: 0,
    },
    flags: {},
    nextId: 1,
  };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function fixClinic(c: Clinic): void {
  c.ops ??= [];
  c.equipment ??= [];
  c.staff ??= [];
  c.prices = { ...defaultPrices(), ...(c.prices ?? {}) };
  c.marketing ??= 0;
  c.rating = num(c.rating, 3.5);
  c.reviews ??= [];
  c.served = num(c.served, 0);
  c.patients ??= [];
  c.day = { ...emptyDayStats(), ...(c.day ?? {}) };
  c.checkinBusyUntil = num(c.checkinBusyUntil, 0);
  for (const o of c.ops) {
    o.chair ??= 'basic';
    o.upgrades ??= [];
    o.staffId ??= null;
    o.assistantId ??= null;
    o.patientId ??= null;
    o.playerMode ??= 'hands';
  }
  for (const s of c.staff) {
    s.traits ??= [];
    s.morale = num(s.morale, 60);
    s.level = num(s.level, 1);
    s.xp = num(s.xp, 0);
    s.offUntilDay = num(s.offUntilDay, 0);
    s.patientsToday = num(s.patientsToday, 0);
    s.task ??= 'idle';
    s.targetOpId ??= null;
    s.busyUntil ??= null;
    s.ask = num(s.ask, s.salary);
  }
  for (const p0 of c.patients) {
    const p = p0 as SimPatient;
    p.addons ??= [];
    p.waitedMin = num(p.waitedMin, 0);
    p.wbase = num(p.wbase, p.waitedMin);
    p.billed = num(p.billed, 0);
    p.arriveAt = num(p.arriveAt, p.apptMin);
    if (p.state === 'inChair' && !p.stage) p.stage = p.awaitingPlayer ? 'await' : 'clean';
  }
}

/** Fill in fields missing from older saves. */
export function migrate(state: GameState): GameState {
  const fresh = newGame({ name: state?.player?.name ?? 'Hygienist', avatar: 0, seed: num(state?.seed, 1), nowMs: num(state?.createdAt, 0) });
  const s = state as GameState;
  for (const k of Object.keys(fresh) as (keyof GameState)[]) {
    if ((s as any)[k] === undefined || (s as any)[k] === null && (fresh as any)[k] !== null) (s as any)[k] = (fresh as any)[k];
  }
  s.player = { ...fresh.player, ...s.player, tools: { ...fresh.player.tools, ...(s.player?.tools ?? {}) } };
  s.stats = { ...fresh.stats, ...s.stats };
  s.flags ??= {};
  s.cash = num(s.cash, 0);
  s.loan = Math.max(0, num(s.loan, 0));
  s.minute = num(s.minute, OPEN_MIN);
  s.day = Math.max(1, Math.round(num(s.day, 1)));
  s.rng = num(s.rng, fresh.rng) >>> 0;
  s.nextId = Math.max(1, num(s.nextId, 1));
  if (!Array.isArray(s.locations)) s.locations = [];
  if (s.employer) fixClinic(s.employer);
  for (const c of s.locations) fixClinic(c);
  if (s.phase === 'owner') s.active = clamp(num(s.active, 0), 0, Math.max(0, s.locations.length - 1));
  else if (s.phase === 'employee') s.active = -1;
  s.version = SAVE_VERSION;
  s.player.title = title(s);
  return s;
}

// ------------------------------------------------------------------ employer

const COLLEAGUES: { name: string; portrait: number; skill: number; speed: number; bedside: number; traits: Staff['traits'] }[] = [
  { name: 'Molly Brushwell', portrait: 3, skill: 62, speed: 55, bedside: 70, traits: ['charmer'] },
  { name: 'Gus Flossman', portrait: 7, skill: 55, speed: 72, bedside: 48, traits: ['speedy'] },
  { name: 'Priya Pearl', portrait: 11, skill: 74, speed: 50, bedside: 60, traits: ['perfectionist'] },
];

function makeEmployer(state: GameState): Clinic {
  const staff: Staff[] = [];
  const base = (o: Partial<Staff> & Pick<Staff, 'name' | 'role' | 'portrait'>): Staff => ({
    id: nextId(state, 's'), skill: 60, speed: 60, bedside: 60, salary: 0, ask: 0, morale: 80, traits: [],
    level: 3, xp: 0, hiredDay: 0, offUntilDay: 0, patientsToday: 0, task: 'idle', targetOpId: null, busyUntil: null, ...o,
  });
  for (const c of COLLEAGUES) staff.push(base({ name: c.name, role: 'hygienist', portrait: `staff_${c.portrait}`, skill: c.skill, speed: c.speed, bedside: c.bedside, traits: c.traits }));
  staff.push(base({ name: 'Tina Minty', role: 'receptionist', portrait: 'staff_14', skill: 70 }));
  staff.push(base({ name: EMPLOYER_BOSS, role: 'dentist', portrait: 'boss', skill: 85, speed: 65, bedside: 90 }));
  const ops: Operatory[] = [];
  for (let i = 0; i < 4; i++) {
    ops.push({
      id: nextId(state, 'op'), slot: i, chair: i === 0 ? 'basic' : 'comfort', upgrades: i === 3 ? ['tv'] : [],
      staffId: i === 0 ? PLAYER_ID : staff[i - 1].id, assistantId: null, patientId: null, playerMode: 'hands',
    });
  }
  const c: Clinic = {
    id: 'employer', name: EMPLOYER_NAME, tier: 't2', ownedByPlayer: false, ops,
    equipment: ['deepCert', 'sterilizer', 'espresso', 'fishTank'],
    staff, prices: defaultPrices(), marketing: 2, rating: 4.2, reviews: [], served: 600,
    patients: [], day: emptyDayStats(), checkinBusyUntil: 0,
  };
  c.rating = computeRating(c);
  c.rating = 4.2;
  return c;
}

// ------------------------------------------------------------------ school

export function schoolSetup(state: GameState, step: 1 | 2): CleanSetup {
  const setup = buildSetup(state, {
    patientId: `school${step}`, name: 'Dennis the Dummy', archetype: 'mannequin', service: 'cleaning',
    dirtLevel: step === 1 ? 0 : 0.5, tutorial: step === 1, dirtScale: step === 1 ? 0.75 : 1, consumeGel: false,
  });
  setup.seed = hashSeed(state.seed, 'school', step);
  return setup;
}

function emptyPayout(): HandsOnPayout {
  return { pay: 0, tip: 0, bonus: 0, xp: 0, stars: 0, quality: 0, levelUps: 0, addons: [], lines: [] };
}

function recordClean(state: GameState, r: CleanResult, ev: SimEvent[], archetype: string | null): void {
  const st = state.stats;
  const done = r.quit === 'done';
  if (done) st.cleanings += 1;
  st.chunks += Math.max(0, Math.round(r.chunks || 0));
  st.bestCombo = Math.max(st.bestCombo, Math.round(r.bestCombo || 0));
  if (done && r.perfect) st.perfect += 1;
  if (done && r.seconds > 0 && (st.fastestClean === 0 || r.seconds < st.fastestClean)) st.fastestClean = Math.round(r.seconds);
  if (done && r.stars === 5) st.fiveStars += 1;
  if (done && r.stars >= 4 && r.seconds > 0 && r.seconds < 60) state.flags.speed60 = true;
  if (done && archetype === 'nervous' && r.gumHits === 0) state.flags.noOw = true;
  if (state.phase !== 'school') {
    if (r.chunks > 0) progressGoal(state, 'chunks', r.chunks, ev);
    if (r.bestCombo > 0) progressGoal(state, 'combo', r.bestCombo, ev);
    if (done) {
      progressGoal(state, 'fastClean', r.stars >= 3 ? r.seconds : 0, ev);
      if (r.perfect) progressGoal(state, 'perfect', 1, ev);
      if (state.phase === 'employee' && r.stars === 5) progressGoal(state, 'fiveStars', 1, ev);
    }
  }
}

export function completeSchool(state: GameState, step: 1 | 2, result: CleanResult): HandsOnPayout {
  const ev: SimEvent[] = [];
  const out = emptyPayout();
  if (state.phase !== 'school') return out;
  const q = clamp(num(result.quality, 0), 0, 1);
  recordClean(state, result, ev, 'mannequin');
  const xp = Math.round(10 + 30 * q + (result.stars === 5 ? 5 : 0));
  out.levelUps = gainXp(state, xp, ev);
  out.xp = xp;
  out.quality = q;
  out.stars = result.stars;
  out.lines.push(q >= 0.8 ? 'Your instructor is impressed.' : q >= 0.6 ? 'A solid pass. Dennis thanks you.' : 'Dennis has seen worse. Barely.');
  state.flags[`school${step}`] = true;
  if (step === 2) {
    graduate(state);
    out.bonus = SIGNING_BONUS;
    out.lines.push(`${EMPLOYER_BOSS} hired you. Welcome to ${EMPLOYER_NAME}.`);
  }
  checkAchievements(state, ev);
  return out;
}

const SIGNING_BONUS = 250;

function graduate(state: GameState): void {
  state.phase = 'employee';
  state.employer = makeEmployer(state);
  state.active = -1;
  state.minute = OPEN_MIN;
  state.dayOver = false;
  addCash(state, SIGNING_BONUS, 'Signing bonus');
  withRng(state, (rng) => {
    bookDay(state, rng);
    makeGoals(state, rng);
  });
  state.player.title = title(state);
}

// ------------------------------------------------------------------ hands-on

export function playerQueue(state: GameState): DayPatient[] {
  const c = state.phase === 'employee' ? state.employer : state.locations[state.active] ?? null;
  if (!c) return [];
  return c.patients.filter((p) => p.state === 'inChair' && p.awaitingPlayer);
}

export function beginHandsOn(state: GameState, patientId: string): CleanSetup {
  const f = findPatient(state, patientId);
  if (!f) throw new Error('Patient not found');
  const { p } = f;
  const consume = !(p as SimPatient & { gel?: boolean }).gel;
  const setup = buildSetup(state, {
    patientId: p.id, name: p.name, archetype: p.archetype, service: p.service, dirtLevel: p.dirtLevel,
    tutorial: false, dirtScale: difficultyScale(state), consumeGel: consume,
  });
  if (setup.tools.numbingGel) (p as SimPatient & { gel?: boolean }).gel = true;
  else if ((p as SimPatient & { gel?: boolean }).gel) setup.tools.numbingGel = true;
  return setup;
}

function speedBonus(setupPar: number, seconds: number): number {
  if (!(setupPar > 0) || !(seconds > 0)) return 0;
  return clamp((setupPar - seconds) / setupPar, 0, 1);
}

function parFor(state: GameState, p: SimPatient): number {
  const s = buildSetup(state, {
    patientId: p.id, name: p.name, archetype: p.archetype, service: p.service, dirtLevel: p.dirtLevel,
    tutorial: false, dirtScale: difficultyScale(state), consumeGel: false,
  });
  return s.parSeconds;
}

/**
 * Settle a clean done by the player (hands-on or quick). Pays, reviews, records, then the patient
 * stays in the chair for the rest of the fast-forward and walks out through checkout.
 */
function settle(state: GameState, c: Clinic, p: SimPatient, o: {
  quality: number; comfort: number; stars: number; tip: number; quick: boolean; ffMinutes: number; ev: SimEvent[];
}): HandsOnPayout {
  const out = emptyPayout();
  const employee = state.phase === 'employee';
  const q = o.quality;
  const xpFull = 10 + 30 * q + (o.stars === 5 && !o.quick ? 5 : 0);
  const xp = Math.round(o.quick ? xpFull / 2 : xpFull);
  out.quality = q;
  out.stars = o.stars;
  if (employee) {
    const pay = Math.round(employeeRate(state.player.level) * (0.4 + 0.8 * q));
    out.pay = pay;
    addCash(state, pay, 'Wages');
    if (o.tip > 0) { out.tip = o.tip; addCash(state, o.tip, 'Tips'); }
    p.seen = true;
    progressGoal(state, 'served', 1, o.ev);
    if (!o.quick && o.stars === 5) {
      state.stats.fiveStarStreak += 1;
      if (state.stats.fiveStarStreak % 5 === 0) {
        out.bonus += 150;
        addCash(state, 150, 'Bonus');
        out.lines.push(`${EMPLOYER_BOSS.replace('Ruth ', '')} is impressed. Bonus paid.`);
      }
    } else if (!o.quick) {
      state.stats.fiveStarStreak = 0;
    }
    const sb = shiftBonusCheck(state, c, o.ev);
    if (sb) { out.bonus += sb; out.lines.push('Full shift seen. Shift bonus paid.'); }
  } else {
    const fee = handsFee(c, p);
    out.pay = fee;
    out.addons = p.addons.filter((a) => !SERVICES[a].requiresDentist);
    p.billed = fee;
    addCash(state, fee, 'Patient fees');
    if (o.tip > 0) { out.tip = o.tip; addCash(state, o.tip, 'Tips'); c.day.tips += o.tip; }
    c.day.revenue += fee;
    p.seen = true;
  }
  p.tip = out.tip;
  c.day.handsOn += 1;
  out.xp = xp;
  out.levelUps = gainXp(state, xp, o.ev);
  // stays in the chair while the add-ons and the rest of the fast-forward run
  p.quality = q3(q);
  p.comfort = q3(o.comfort);
  p.preQ = p.quality;
  p.preC = p.comfort;
  p.hands = true;
  p.awaitingPlayer = false;
  p.staffId = PLAYER_ID;
  p.stage = 'clean';
  p.since = q64(state.minute);
  p.until = p.since + Math.max(5, o.ffMinutes * 0.8 + addonMinutes(p));
  // review from the hands-on quality and comfort
  withRng(state, (rng) => {
    const always = ARCHETYPES[p.archetype].reviewWeight >= 3;
    if (always || rng.chance(0.6)) {
      addReview(state, c, p, reviewStars(q, o.comfort, p.waitedMin, p.patience, c.prices[p.service] ?? 1), o.ev);
    }
  });
  p.reviewed = true;
  return out;
}

export function completeHandsOn(state: GameState, patientId: string, result: CleanResult): { payout: HandsOnPayout; events: SimEvent[] } {
  const ev: SimEvent[] = [];
  const f = findPatient(state, patientId);
  if (!f || f.p.state !== 'inChair') return { payout: emptyPayout(), events: ev };
  const { clinic: c, p } = f;
  if (result.quit === 'abort') {
    // back to waiting in the chair; no pay, no fast-forward
    p.awaitingPlayer = true;
    p.stage = 'await';
    return { payout: emptyPayout(), events: ev };
  }
  recordClean(state, result, ev, p.archetype);
  if (result.quit === 'walkout') {
    const out = emptyPayout();
    out.quality = Math.min(num(result.quality, 0), 0.25);
    out.stars = 1;
    out.lines.push(`${p.name.split(' ')[0]} walked out.`);
    out.xp = 5;
    out.levelUps = gainXp(state, 5, ev);
    p.quality = out.quality;
    p.comfort = 0;
    if (state.phase === 'employee') { p.seen = true; state.stats.fiveStarStreak = 0; }
    walkoutFromChair(state, c, p, ev);
    checkAchievements(state, ev);
    const more = tickWorld(state, HANDS_ON_MINUTES[p.service] / 2);
    return { payout: out, events: [...ev, ...more] };
  }
  const q = clamp(num(result.quality, 0), 0, 1);
  const comfort = clamp(num(result.comfort, 60) / 100, 0, 1);
  const a = ARCHETYPES[p.archetype];
  const base = state.phase === 'employee' ? 120 : Math.round(SERVICES[p.service].fee * (c.prices[p.service] ?? 1));
  const tipMult = hasSkill(state, 'tipMagnet') ? 1.25 : 1;
  const tip = Math.round(base * a.tipRate * Math.max(0, (q - 0.6) / 0.4) * (1 + 0.5 * speedBonus(parFor(state, p), result.seconds)) * tipMult);
  const payout = settle(state, c, p, { quality: q, comfort, stars: result.stars, tip, quick: false, ffMinutes: HANDS_ON_MINUTES[p.service], ev });
  if (result.perfect) payout.lines.push('Sparkling smile.');
  if (tip > 0 && q >= 0.9) payout.lines.push(`${p.name.split(' ')[0]} left a big tip.`);
  checkAchievements(state, ev);
  const more = tickWorld(state, HANDS_ON_MINUTES[p.service]);
  return { payout, events: [...ev, ...more] };
}

export function quickClean(state: GameState, patientId: string): { payout: HandsOnPayout; events: SimEvent[] } {
  const ev: SimEvent[] = [];
  const f = findPatient(state, patientId);
  if (!f || f.p.state !== 'inChair') return { payout: emptyPayout(), events: ev };
  const { clinic: c, p } = f;
  const q = autoQuality(state);
  const op = opById(c, p.opId);
  const chair = op ? CHAIRS[op.chair] : CHAIRS.basic;
  const comfort = clamp(0.4 + 0.45 * 0.6 + chair.comfort + (op?.upgrades.includes('tv') ? 0.08 : 0), 0, 1);
  const stars = starsFor(q);
  state.stats.quickCleans += 1;
  const payout = settle(state, c, p, { quality: q, comfort, stars, tip: 0, quick: true, ffMinutes: QUICK_CLEAN_MINUTES, ev });
  checkAchievements(state, ev);
  const more = tickWorld(state, QUICK_CLEAN_MINUTES);
  return { payout, events: [...ev, ...more] };
}

export type { AddonId };
export { clinicsOf, S };
