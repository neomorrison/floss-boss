// Career: new game, migration, school, the hands-on and quick-clean flows. DESIGN 3, 4 and 5.9.
import type {
  AddonId, BonusId, CampaignId, CaseType, CleanResult, CleanSetup, Clinic, ClinicModifier, DayPatient, FocusId, GameState,
  HandsOnPayout, Operatory, PendingEvent, PerkId, SimEvent, Staff, TwistId,
} from '../core/types';
import { hashSeed, clamp } from '../core/rng';
import {
  EMPLOYER_BOSS, EMPLOYER_NAME, HANDS_ON_MINUTES, OPEN_MIN, PLAYER_ID, QUICK_CLEAN_MINUTES,
} from '../core/constants';
import { SAVE_VERSION } from '../core/save';
import { ARCHETYPES } from '../data/patients';
import { BONUSES, CASES, CASE_ORDER, MASTERY_NAMES, MASTERY_TIERS, TWISTS } from '../data/cases';
import { CAMPAIGNS, EVENTS, FOCUSES, PERKS } from '../data/manager';
import { OFFICES } from '../data/offices';
import { SERVICES, defaultPrices } from '../data/services';
import { SKILLS } from '../data/skills';
import { CHAIRS } from '../data/upgrades';
import {
  S, SimClinic, SimPatient, SimStaff, addCash, clinicsOf, q3, q64, emptyDayStats, findPatient, hasSkill, nextId, opById, priceOf, withRng,
} from './internal';
import { autoQuality, employeeRate, gainXp, starsFor, title } from './progress';
import { addonMinutes, downgradeCase, handsFee } from './patients';
import { buildCaseSetup, caseLevel, masteryCount, masteryTier } from './cases';
import { addReview, computeRating, reviewStars, shiftBonusCheck, tickWorld, walkoutFromChair } from './clinic';
import { hasNitrous, has as hasEquip, modAgg, VIP_WEIGHT } from './effects';
import { bookDay, onlyPlayerHands } from './booking';
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
      mastery: {},
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
    focus: ['steady'],
    huddleDay: 1,
    pendingEvents: [],
    eventLog: [],
    settings: { autoHuddle: false, autoRaise: false },
  };
}


const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = <T extends object>(v: unknown): Partial<T> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<T>) : {});
const isCase = (v: unknown): v is CaseType => typeof v === 'string' && (CASE_ORDER as string[]).includes(v);

function fixStaff(s: Staff): void {
  s.traits = arr<Staff['traits'][number]>(s.traits);
  s.skill = num(s.skill, 50); s.speed = num(s.speed, 50); s.bedside = num(s.bedside, 50);
  s.salary = num(s.salary, 0);
  s.ask = num(s.ask, s.salary);
  s.morale = num(s.morale, 60);
  s.level = num(s.level, 1);
  s.xp = num(s.xp, 0);
  s.hiredDay = num(s.hiredDay, 0);
  s.offUntilDay = num(s.offUntilDay, 0);
  s.patientsToday = num(s.patientsToday, 0);
  s.task ??= 'idle';
  s.targetOpId ??= null;
  s.busyUntil ??= null;
  s.perks = arr<PerkId>(s.perks).filter((p) => p in PERKS);
  const pend = arr<PerkId>(s.pendingPerks).filter((p) => p in PERKS);
  s.pendingPerks = pend.length ? pend : null;
  if (typeof s.tempUntilDay !== 'number' || !Number.isFinite(s.tempUntilDay)) delete s.tempUntilDay;
  // raise pipeline (DESIGN 8.5): a due request and the day of the last request or raise
  const ss = s as SimStaff;
  if (ss.raiseDue !== true) delete ss.raiseDue;
  if (typeof ss.raiseDay !== 'number' || !Number.isFinite(ss.raiseDay)) delete ss.raiseDay;
}

function fixClinic(c: Clinic): void {
  if (!(c.tier in OFFICES)) c.tier = 't1';
  c.ops = arr<Operatory>(c.ops).filter((o) => o && typeof o === 'object');
  c.equipment = arr<Clinic['equipment'][number]>(c.equipment);
  c.staff = arr<Staff>(c.staff).filter((s) => s && typeof s === 'object');
  c.prices = { ...defaultPrices(), ...obj<Clinic['prices']>(c.prices) };
  c.marketing = clamp(Math.round(num(c.marketing, 0)), 0, 3) as Clinic['marketing'];
  c.rating = num(c.rating, 3.5);
  c.reviews = arr<Clinic['reviews'][number]>(c.reviews);
  c.served = num(c.served, 0);
  c.patients = arr<DayPatient>(c.patients).filter((p) => p && typeof p === 'object');
  c.day = { ...emptyDayStats(), ...obj<Clinic['day']>(c.day) };
  c.checkinBusyUntil = num(c.checkinBusyUntil, 0);
  c.modifiers = arr<ClinicModifier>(c.modifiers).filter((m) => m && typeof m === 'object' && typeof m.id === 'string');
  for (const m of c.modifiers) {
    if (m.source !== 'event' && m.source !== 'campaign' && m.source !== 'focus') m.source = 'event';
    m.untilDay = m.untilDay == null ? null : num(m.untilDay, 0);
    m.label = typeof m.label === 'string' ? m.label : '';
  }
  const camp = obj<NonNullable<Clinic['campaign']>>(c.campaign);
  c.campaign = camp.id && camp.id in CAMPAIGNS ? { id: camp.id as CampaignId, untilDay: num(camp.untilDay, 0) } : null;
  c.campaignCooldownUntil = num(c.campaignCooldownUntil, 0);
  c.ops.forEach((o, i) => {
    o.slot = num(o.slot, i);
    o.chair = o.chair in CHAIRS ? o.chair : 'basic';
    o.upgrades = arr<Operatory['upgrades'][number]>(o.upgrades);
    o.staffId ??= null;
    o.assistantId ??= null;
    o.patientId ??= null;
    o.playerMode ??= 'hands';
  });
  for (const s of c.staff) fixStaff(s);
  for (const p0 of c.patients) {
    const p = p0 as SimPatient;
    p.addons = arr<AddonId>(p.addons);
    p.waitedMin = num(p.waitedMin, 0);
    p.wbase = num(p.wbase, p.waitedMin);
    p.billed = num(p.billed, 0);
    p.arriveAt = num(p.arriveAt, p.apptMin);
    p.caseType = isCase(p.caseType) ? p.caseType : 'routine';
    p.twists = arr<TwistId>(p.twists).filter((t) => t in TWISTS);
    p.bonus = typeof p.bonus === 'string' && p.bonus in BONUSES ? (p.bonus as BonusId) : null;
    p.vip = p.vip === true;
    if (p.state === 'inChair' && !p.stage) p.stage = p.awaitingPlayer ? 'await' : 'clean';
  }
}

/** Fill in fields missing from older (or damaged, or imported) saves. */
export function migrate(state: GameState): GameState {
  const s = (state && typeof state === 'object' ? state : {}) as GameState;
  const hadHuddle = typeof s.huddleDay === 'number' && Number.isFinite(s.huddleDay);
  const fresh = newGame({ name: obj<GameState['player']>(s.player).name ?? 'Hygienist', avatar: 0, seed: num(s.seed, 1), nowMs: num(s.createdAt, 0) });
  for (const k of Object.keys(fresh) as (keyof GameState)[]) {
    if ((s as any)[k] === undefined || (s as any)[k] === null && (fresh as any)[k] !== null) (s as any)[k] = (fresh as any)[k];
  }
  const pl = obj<GameState['player']>(s.player);
  s.player = { ...fresh.player, ...pl, tools: { ...fresh.player.tools, ...obj<GameState['player']['tools']>(pl.tools) } };
  const P = s.player;
  P.name = typeof P.name === 'string' && P.name ? P.name.slice(0, 24) : 'Hygienist';
  P.avatar = clamp(Math.round(num(P.avatar, 0)), 0, 3);
  P.level = Math.max(1, Math.round(num(P.level, 1)));
  P.xp = Math.max(0, num(P.xp, 0));
  P.skillPoints = Math.max(0, Math.round(num(P.skillPoints, 0)));
  P.skills = arr<string>(P.skills).filter((id) => SKILLS.some((k) => k.id === id)) as GameState['player']['skills'];
  P.extras = arr<GameState['player']['extras'][number]>(P.extras).filter((x) => typeof x === 'string');
  P.numbingGel = Math.max(0, Math.round(num(P.numbingGel, 0)));
  for (const k of Object.keys(fresh.player.tools) as (keyof GameState['player']['tools'])[]) P.tools[k] = Math.max(1, Math.round(num(P.tools[k], 1)));
  const m = obj<Record<string, unknown>>(P.mastery);
  P.mastery = {};
  for (const ct of CASE_ORDER) { const v = num(m[ct], 0); if (v > 0) P.mastery[ct] = Math.floor(v); }
  s.stats = { ...fresh.stats, ...obj<GameState['stats']>(s.stats) };
  for (const k of Object.keys(fresh.stats) as (keyof GameState['stats'])[]) s.stats[k] = num(s.stats[k], 0);
  s.flags = obj<GameState['flags']>(s.flags) as GameState['flags'];
  s.cash = num(s.cash, 0);
  s.loan = Math.max(0, num(s.loan, 0));
  s.minute = num(s.minute, OPEN_MIN);
  s.day = Math.max(1, Math.round(num(s.day, 1)));
  s.rng = num(s.rng, fresh.rng) >>> 0;
  s.nextId = Math.max(1, num(s.nextId, 1));
  s.goals = arr<GameState['goals'][number]>(s.goals).filter((g) => g && typeof g === 'object');
  s.candidates = arr<GameState['candidates'][number]>(s.candidates).filter((c) => c && typeof c === 'object');
  for (const c of s.candidates) {
    fixStaff(c);
    c.expiresDay = num(c.expiresDay, s.day);
    // candidates from older saves were shown in full: treat them as interviewed
    if (typeof c.interviewed !== 'boolean') c.interviewed = true;
    const r = obj<Staff & { skill: [number, number] }>(c.range) as Partial<Record<'skill' | 'speed' | 'bedside', unknown>>;
    const rng2 = (k: 'skill' | 'speed' | 'bedside'): [number, number] => {
      const v = r[k];
      if (!c.interviewed && Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) return [Number(v[0]), Number(v[1])];
      return [c[k], c[k]];
    };
    c.range = { skill: rng2('skill'), speed: rng2('speed'), bedside: rng2('bedside') };
  }
  s.reports = arr<GameState['reports'][number]>(s.reports).filter((r) => r && typeof r === 'object');
  s.ledger = arr<GameState['ledger'][number]>(s.ledger).filter((e) => e && typeof e === 'object' && Number.isFinite(e.amount));
  s.achievements = arr<string>(s.achievements).filter((a) => typeof a === 'string');
  s.locations = arr<Clinic>(s.locations).filter((c) => c && typeof c === 'object');
  if (s.phase !== 'school' && s.phase !== 'employee' && s.phase !== 'owner') s.phase = 'school';
  if (s.employer && typeof s.employer !== 'object') s.employer = null;
  if (s.employer) fixClinic(s.employer);
  for (const c of s.locations) fixClinic(c);
  // an owner save without a location, or an employee save without an employer, would end every day at once
  if (s.phase === 'owner' && !s.locations.length) s.phase = 'employee';
  if (s.phase === 'employee' && !s.employer) {
    s.employer = makeEmployer(s);
    s.dayOver = false;
    s.minute = OPEN_MIN;
    withRng(s, (rng) => bookDay(s, rng));
  }
  if (s.phase === 'owner') s.active = clamp(Math.round(num(s.active, 0)), 0, Math.max(0, s.locations.length - 1));
  else s.active = -1;
  // manager layer (v3)
  s.focus = arr<FocusId>(s.focus).filter((f) => f in FOCUSES);
  if (!s.focus.length) s.focus = ['steady'];
  if (!hadHuddle) s.huddleDay = s.day;
  s.huddleDay = Math.round(num(s.huddleDay, s.day));
  const ids = new Set(s.locations.map((c) => c.id));
  s.pendingEvents = arr<PendingEvent>(s.pendingEvents).filter((e) => e && typeof e === 'object' && EVENTS.some((x) => x.id === e.eventId) && ids.has(e.clinicId));
  for (const e of s.pendingEvents) { e.vars = obj<Record<string, string>>(e.vars) as Record<string, string>; e.day = num(e.day, s.day); }
  s.eventLog = arr<GameState['eventLog'][number]>(s.eventLog).filter((e) => e && typeof e === 'object').slice(-30);
  const st = obj<GameState['settings']>(s.settings);
  // autoRaise is off unless chosen; autoPause stays undefined (= on) until the player sets it
  s.settings = { autoHuddle: st.autoHuddle === true, autoRaise: st.autoRaise === true };
  if (typeof st.autoPause === 'boolean') s.settings.autoPause = st.autoPause;
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
    level: 3, xp: 0, hiredDay: 0, offUntilDay: 0, patientsToday: 0, task: 'idle', targetOpId: null, busyUntil: null,
    perks: [], pendingPerks: null, ...o,
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
    patients: [], day: emptyDayStats(), checkinBusyUntil: 0, modifiers: [], campaign: null, campaignCooldownUntil: 0,
  };
  c.rating = computeRating(c);
  c.rating = 4.2;
  return c;
}

// ------------------------------------------------------------------ school

// ------------------------------------------------------------------ school

/** School practicals: a routine case on marked teeth only; practical 1 is very light and guided. */
export function schoolSetup(state: GameState, step: 1 | 2): CleanSetup {
  const setup = buildCaseSetup(state, {
    patientId: `school${step}`, name: 'Dennis the Dummy', archetype: 'mannequin', service: 'cleaning', caseType: 'routine',
    twists: [], dirtLevel: 0.5, level: 1, tutorial: step === 1, consumeGel: false, firstOfCase: false, school: step,
  });
  setup.seed = hashSeed(state.seed, 'school', step);
  if (step === 2) {
    // Practical 2 teaches comfort: the dummy's comfort sensor drifts down so the "tap Reassure" hint shows.
    setup.traits = { ...setup.traits, comfortStart: 70, comfortDrain: 1.0 };
    setup.lines = ['(A little sensor light on the dummy blinks.)', ...setup.lines];
  }
  return setup;
}

function emptyPayout(): HandsOnPayout {
  return { pay: 0, tip: 0, bonus: 0, xp: 0, stars: 0, quality: 0, levelUps: 0, addons: [], lines: [], treasure: 0, mastery: null };
}

function recordClean(state: GameState, r: CleanResult, ev: SimEvent[], archetype: string | null): void {
  const st = state.stats;
  const done = r.quit === 'done';
  if (done) st.cleanings += 1;
  st.chunks += Math.max(0, Math.round(num(r.chunks, 0)));
  st.bestCombo = Math.max(st.bestCombo, Math.round(num(r.bestCombo, 0)));
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

const SIGNING_BONUS = 200;

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

/** In your chair and waiting for you (not already cleaned, not walking out). */
function ready(p: SimPatient): boolean {
  return p.state === 'inChair' && p.stage === 'await';
}

/** Owner phase: a case the operatory or office cannot do becomes a routine cleaning. */
function checkCaseSupport(c: Clinic, p: SimPatient): void {
  if (!c.ownedByPlayer) return;
  const req = CASES[p.caseType ?? 'routine']?.requires ?? null;
  if (req === 'whiteningLamp' && !opById(c, p.opId)?.upgrades.includes('whiteningLamp')) downgradeCase(c, p);
  else if (req === 'deepCert' && !c.equipment.includes('deepCert')) downgradeCase(c, p);
}

function setupFor(state: GameState, c: Clinic, p: SimPatient, consumeGel: boolean): CleanSetup {
  const ct: CaseType = p.caseType ?? 'routine';
  return buildCaseSetup(state, {
    patientId: p.id, name: p.name, archetype: p.archetype, service: p.service, caseType: ct, twists: p.twists ?? [],
    dirtLevel: p.dirtLevel, level: caseLevel(state, c), tutorial: false, consumeGel,
    firstOfCase: !state.flags[`case_seen_${ct}`],
    bonus: p.bonus === undefined ? undefined : p.bonus,
    gas: c.ownedByPlayer && hasNitrous(c, opById(c, p.opId)),
  });
}

/** Laughing gas: a nervous patient never walks out of that chair (DESIGN 10.5). The clean is scored as
 * finished with the comfort floored, so they stay (and pay) even if the scene ran out of comfort. */
function gasHolds(c: Clinic, p: SimPatient, r: CleanResult): CleanResult {
  if (r.quit !== 'walkout' || p.archetype !== 'nervous' || !c.ownedByPlayer || !hasNitrous(c, opById(c, p.opId))) return r;
  const clean = clamp(num(r.clean, 0), 0, 1);
  const comfort = Math.max(20, num(r.comfort, 0));
  const quality = clamp(0.8 * clean + 0.2 * comfort / 100, 0, 1);
  return { ...r, quit: 'done', comfort, quality, stars: starsFor(quality) };
}

/** Review comfort of a hands-on clean at an owned clinic: the scene's comfort, Aromatherapy, laughing gas
 * and today's comfort modifiers. */
function handsComfort(state: GameState, c: Clinic, p: SimPatient, comfort: number): number {
  if (!c.ownedByPlayer) return comfort;
  const op = opById(c, p.opId);
  const gas = op?.upgrades.includes('nitrous') ? 0.15 : hasEquip(c, 'nitrousSystem') ? 0.1 : 0;
  return clamp((comfort + (hasEquip(c, 'aromatherapy') ? 0.05 : 0) + gas) * modAgg(state, c).comfort, 0, 1);
}

/** Build the clean for a patient waiting in your chair. Throws when the patient is not ready. */
export function beginHandsOn(state: GameState, patientId: string): CleanSetup {
  const f = findPatient(state, patientId);
  if (!f) throw new Error('Patient not found');
  const { clinic: c, p } = f;
  if (!ready(p)) throw new Error('This patient is not ready yet');
  checkCaseSupport(c, p);
  const setup = setupFor(state, c, p, !p.gel);
  if (setup.tools.numbingGel) p.gel = true;
  else if (p.gel) setup.tools.numbingGel = true;
  return setup;
}

function speedBonus(setupPar: number, seconds: number): number {
  if (!(setupPar > 0) || !(seconds > 0)) return 0;
  return clamp((setupPar - seconds) / setupPar, 0, 1);
}

/** Employee wage for a patient: rate(title) * (0.4 + 0.8 q) * case pay (DESIGN 3.2, 5.5). */
function wage(state: GameState, ct: CaseType, q: number): number {
  return employeeRate(state.player.level) * (0.4 + 0.8 * q) * (CASES[ct]?.payMult ?? 1);
}

/** Treasure bonus for a pirate's doubloon: scales with level. */
export function treasureBonus(level: number): number {
  return 30 + 10 * Math.max(1, level);
}

/**
 * Settle a clean done by the player (hands-on or quick). Pays, reviews, records, then the patient
 * stays in the chair for the rest of the fast-forward and walks out through checkout.
 */
function settle(state: GameState, c: Clinic, p: SimPatient, o: {
  quality: number; comfort: number; stars: number; tip: number; quick: boolean; ffMinutes: number; ev: SimEvent[];
  payMult: number;
}): HandsOnPayout {
  const out = emptyPayout();
  const employee = state.phase === 'employee';
  const q = o.quality;
  // quick clean: no XP (DESIGN 5.9); hands-on: 10 + 30 q (+5 for five stars)
  const xp = o.quick ? 0 : Math.round(10 + 30 * q + (o.stars === 5 ? 5 : 0));
  out.quality = q;
  out.stars = o.stars;
  if (employee) {
    const pay = Math.round(wage(state, p.caseType ?? 'routine', q) * o.payMult);
    out.pay = pay;
    addCash(state, pay, 'Wages');
    if (o.tip > 0) { out.tip = o.tip; addCash(state, o.tip, 'Tips'); }
    p.seen = true;
    if (!o.quick) {
      progressGoal(state, 'served', 1, o.ev);
      if (o.stars === 5) {
        state.stats.fiveStarStreak += 1;
        if (state.stats.fiveStarStreak % 5 === 0) {
          out.bonus += 150;
          addCash(state, 150, 'Bonus');
          out.lines.push(`${EMPLOYER_BOSS.replace('Ruth ', '')} is impressed. Bonus paid.`);
        }
      } else {
        state.stats.fiveStarStreak = 0;
      }
    }
    const sb = shiftBonusCheck(state, c, o.ev);
    if (sb) { out.bonus += sb; out.lines.push('Full shift seen. Shift bonus paid.'); }
  } else {
    const base = handsFee(c, p);
    const extra = Math.round(base * (o.payMult - 1));   // silver mastery: a master's rate
    p.fee += extra;
    const fee = base + extra;
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
  // review from the hands-on quality and comfort; the owner's own clean counts double
  const bossClean = !employee && !o.quick && c.ownedByPlayer;
  withRng(state, (rng) => {
    const always = ARCHETYPES[p.archetype].reviewWeight >= 3 || bossClean || p.vip;
    if (always || rng.chance(0.6)) {
      const stars = reviewStars(q, o.comfort, p.waitedMin, p.patience, priceOf(c, p, p.service));
      const vipW = p.vip ? (p.vipWeight ?? VIP_WEIGHT) * (bossClean ? 2 : 1) : undefined;
      addReview(state, c, p, stars, o.ev, bossClean && stars >= 4 ? 'The owner cleaned my teeth personally. What a treat.' : undefined, bossClean ? 2 : 1, vipW);
    }
  });
  p.reviewed = true;
  return out;
}

export function completeHandsOn(state: GameState, patientId: string, result0: CleanResult): { payout: HandsOnPayout; events: SimEvent[] } {
  const ev: SimEvent[] = [];
  const f = findPatient(state, patientId);
  if (!f || !ready(f.p)) return { payout: emptyPayout(), events: ev };
  const { clinic: c, p } = f;
  const result = gasHolds(c, p, result0);
  if (result.quit === 'abort') {
    // back to waiting in the chair; no pay, no fast-forward
    p.awaitingPlayer = true;
    p.stage = 'await';
    return { payout: emptyPayout(), events: ev };
  }
  const ct: CaseType = p.caseType ?? 'routine';
  state.flags[`case_seen_${ct}`] = true;
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
  const comfort = handsComfort(state, c, p, clamp(num(result.comfort, 60) / 100, 0, 1));
  const stars = clamp(Math.round(num(result.stars, starsFor(q))), 1, 5);
  const a = ARCHETYPES[p.archetype];
  const count0 = masteryCount(state, ct);
  const tier0 = masteryTier(count0);
  const setup = setupFor(state, c, p, false);
  const bonusMet = !!result.bonusMet && setup.bonus != null;
  const employee = state.phase === 'employee';
  const base = employee ? Math.round(120 * (CASES[ct]?.payMult ?? 1)) : Math.round(SERVICES[p.service].fee * priceOf(c, p, p.service));
  const tipMult = (hasSkill(state, 'tipMagnet') ? 1.25 : 1) * (tier0 >= 3 ? 1.2 : 1) * (bonusMet ? 1.25 : 1);
  const tip = Math.round(base * a.tipRate * Math.max(0, (q - 0.6) / 0.4) * (1 + 0.5 * speedBonus(setup.parSeconds, num(result.seconds, 0))) * tipMult);
  const payout = settle(state, c, p, {
    quality: q, comfort, stars, tip, quick: false, ffMinutes: HANDS_ON_MINUTES[p.service], ev, payMult: tier0 >= 2 ? 1.1 : 1,
  });
  // pirate treasure
  if (result.treasure && ct === 'pirate') {
    const t = treasureBonus(state.player.level);
    payout.treasure = t;
    addCash(state, t, 'Treasure');
    if (!employee) c.day.tips += t;
    payout.lines.push('A gold doubloon. Finders keepers.');
  }
  // mastery (DESIGN 5.9): every hands-on clean of 3+ stars counts toward the case
  const count = count0 + (stars >= 3 ? 1 : 0);
  if (count !== count0) state.player.mastery[ct] = count;
  const tier = masteryTier(count);
  payout.mastery = { caseType: ct, count, tier, tierUp: tier > tier0 };
  if (tier > tier0) payout.lines.push(`${MASTERY_NAMES[tier]} mastery: ${CASES[ct].name}.`);
  if (bonusMet) payout.lines.push('Bonus met. Tips up 25%.');
  if (!employee && c.ownedByPlayer) (c as SimClinic).bossCleans = ((c as SimClinic).bossCleans ?? 0) + 1;
  if (result.perfect) payout.lines.push('Sparkling smile.');
  if (tip > 0 && q >= 0.9) payout.lines.push(`${p.name.split(' ')[0]} left a big tip.`);
  checkAchievements(state, ev);
  const more = tickWorld(state, HANDS_ON_MINUTES[p.service], holdFor(state, c));
  return { payout, events: [...ev, ...more] };
}

/** A clinic where only your hands-on chair serves keeps its waiting room's patience during your fast-forward. */
function holdFor(state: GameState, c: Clinic): string[] {
  return c.ownedByPlayer && onlyPlayerHands(state, c) ? [c.id] : [];
}

/** Can Quick clean take this patient: Bronze mastery of the patient's case (DESIGN 5.9). */
export function quickCleanStatus(state: GameState, patientId: string): { ok: boolean; count: number; need: number } {
  const need = MASTERY_TIERS[0];
  const f = findPatient(state, patientId);
  if (!f) return { ok: false, count: 0, need };
  const count = masteryCount(state, f.p.caseType ?? 'routine');
  return { ok: count >= need && ready(f.p), count, need };
}

/**
 * Hand the patient to a colleague (employee) or clean on autopilot (owner). Needs Bronze on the case.
 * Pays 50% of the wage (the owner bills the fee), no tip, no XP, no mastery, streak or goals.
 */
export function quickClean(state: GameState, patientId: string): { payout: HandsOnPayout; events: SimEvent[] } {
  const ev: SimEvent[] = [];
  const f = findPatient(state, patientId);
  if (!f || !ready(f.p) || !quickCleanStatus(state, patientId).ok) return { payout: emptyPayout(), events: ev };
  const { clinic: c, p } = f;
  checkCaseSupport(c, p);
  const q = autoQuality(state);
  const op = opById(c, p.opId);
  const chair = op ? CHAIRS[op.chair] : CHAIRS.basic;
  const comfort = clamp((0.4 + 0.45 * 0.6 + chair.comfort + (op?.upgrades.includes('tv') ? 0.08 : 0)) * (c.ownedByPlayer ? modAgg(state, c).comfort : 1), 0, 1);
  const stars = starsFor(q);
  state.stats.quickCleans += 1;
  const payout = settle(state, c, p, {
    quality: q, comfort, stars, tip: 0, quick: true, ffMinutes: QUICK_CLEAN_MINUTES, ev, payMult: state.phase === 'employee' ? 0.5 : 1,
  });
  checkAchievements(state, ev);
  const more = tickWorld(state, QUICK_CLEAN_MINUTES, holdFor(state, c));
  return { payout, events: [...ev, ...more] };
}

export type { AddonId };
export { clinicsOf, S };
