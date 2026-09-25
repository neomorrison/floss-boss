// Staff: candidates, hiring, firing, training, assignments and the daily staff update. DESIGN 8.5.
import type { ActionResult, Candidate, Clinic, GameState, PerkId, SimEvent, Staff, StaffRole, TraitId } from '../core/types';
import type { Rng } from '../core/rng';
import { clamp } from '../core/rng';
import { PLAYER_ID, TRAINING_COST } from '../core/constants';
import { money, signedMoney } from '../core/format';
import { OFFICES } from '../data/offices';
import { ROLES, STAFF_FIRST, STAFF_LAST, STAFF_PORTRAITS, TRAITS } from '../data/staff';
import { PERKS, PERK_LEVELS } from '../data/manager';
import { S, SimOp, SimStaff, addCash, clinicByIndex, hasSkill, isPresent, nextId, note, pushEvent, withRng } from './internal';
import { checkAchievements } from './goals';
import { chainHas, has, lateMinutes, perkAdd, perksOf } from './effects';
import { focusMoraleAtClose } from './manager';

export function statAvg(role: StaffRole, s: { skill: number; speed: number; bedside: number }): number {
  return role === 'hygienist' ? (s.skill + s.speed + s.bedside) / 3 : s.skill;
}

export function askFor(role: StaffRole, s: { skill: number; speed: number; bedside: number }): number {
  const r = ROLES[role];
  return Math.round((r.askBase + r.askPerStat * statAvg(role, s)) / 5) * 5;
}

/** Salary actually charged per day (negotiator applies). */
export function salaryCost(state: GameState, s: Staff): number {
  return Math.round(s.salary * (hasSkill(state, 'negotiator') ? 0.9 : 1));
}

const ALL_TRAITS = Object.keys(TRAITS) as TraitId[];

function rollTraits(rng: Rng): TraitId[] {
  const r = rng.next();
  const n = r < 0.5 ? 0 : r < 0.85 ? 1 : 2;
  const out: TraitId[] = [];
  while (out.length < n) {
    const t = rng.pick(ALL_TRAITS);
    if (out.includes(t)) continue;
    if ((t === 'speedy' && out.includes('perfectionist')) || (t === 'perfectionist' && out.includes('speedy'))) continue;
    out.push(t);
  }
  return out;
}

export function makeStaff(state: GameState, rng: Rng, role: StaffRole, quality: number, o: Partial<Staff> = {}): Staff {
  const stat = () => Math.round(clamp(rng.normal(50 + quality, 14), 15, 95));
  const base = { skill: stat(), speed: stat(), bedside: stat() };
  const ask = askFor(role, base);
  return {
    id: nextId(state, 's'),
    name: `${rng.pick(STAFF_FIRST)} ${rng.pick(STAFF_LAST)}`,
    role,
    portrait: `staff_${rng.int(0, STAFF_PORTRAITS - 1)}`,
    ...base,
    salary: ask,
    ask,
    morale: 70,
    traits: rollTraits(rng),
    level: 1,
    xp: 0,
    hiredDay: state.day,
    offUntilDay: 0,
    patientsToday: 0,
    task: 'idle',
    targetOpId: null,
    busyUntil: null,
    perks: [],
    pendingPerks: null,
    ...o,
  };
}

/** Width of a candidate's stat ranges before an interview (DESIGN 10.4). */
export const RANGE_WIDTH = 30;

/** A range of RANGE_WIDTH that contains the true value, placed at random. */
function statRange(v: number, rng: Rng): [number, number] {
  const lo = clamp(v - rng.int(0, RANGE_WIDTH), 0, 100 - RANGE_WIDTH);
  return [lo, lo + RANGE_WIDTH];
}

/** Candidates on the board: six, eight with Talent Scout. */
export function candidateSlots(state: GameState): number {
  return CANDIDATE_SLOTS + (hasSkill(state, 'talentScout') ? 2 : 0);
}

/** Interview price: $40 x tierScale of the active office, free with Talent Scout. */
export function interviewCost(state: GameState): number {
  if (hasSkill(state, 'talentScout')) return 0;
  const c = state.locations[state.active] ?? state.locations[0];
  return Math.round(INTERVIEW_COST * (c ? OFFICES[c.tier].tierScale : 1));
}
export const INTERVIEW_COST = 40;

/** Interview a candidate: reveals exact stats and traits (DESIGN 10.4). */
export function interview(state: GameState, candidateId: string): ActionResult {
  if (state.phase !== 'owner') return { ok: false, reason: 'Open a practice first' };
  const cand = state.candidates.find((x) => x.id === candidateId);
  if (!cand) return { ok: false, reason: 'Candidate is no longer available' };
  if (cand.interviewed) return { ok: false, reason: 'Already interviewed' };
  const cost = interviewCost(state);
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash' };
  if (cost > 0) addCash(state, -cost, 'Interviews');
  cand.interviewed = true;
  cand.range = { skill: [cand.skill, cand.skill], speed: [cand.speed, cand.speed], bedside: [cand.bedside, cand.bedside] };
  return { ok: true, message: `Interviewed ${cand.name}` };
}

/** Remove a staff member from a clinic (quit, poached, temp contract over) and free their operatory. */
export function removeStaff(c: Clinic, staffId: string): void {
  unassign(c, staffId);
  c.staff = c.staff.filter((x) => x.id !== staffId);
}

/** Perks a staff member can be offered: their role, not owned yet. */
export function perkPool(s: Staff): PerkId[] {
  return (Object.keys(PERKS) as PerkId[]).filter((id) => PERKS[id].roles.includes(s.role) && !perksOf(s).includes(id));
}

/** Roll two perks (DESIGN 10.4) for a staff member who reached a perk level. */
function rollPerks(state: GameState, s: SimStaff, rng: Rng): boolean {
  if (s.pendingPerks && s.pendingPerks.length) return false;
  const pool = perkPool(s);
  if (!pool.length) return false;
  const a = rng.pick(pool);
  const rest = pool.filter((x) => x !== a);
  s.pendingPerks = rest.length ? [a, rng.pick(rest)] : [a];
  s.perkDay = state.day;
  return true;
}

/** Offer a perk choice now with the level-up rules (role pool, not owned, two picks, auto-pick after
 * PERK_AUTO_DAYS). For the debug hook; an offer already waiting is kept. */
export function offerPerks(state: GameState, clinicIndex: number, staffId: string): ActionResult {
  if (state.phase !== 'owner') return { ok: false, reason: 'Open a practice first' };
  // tolerate the older (state, staffId) call: look the staff member up at every location
  const byId = typeof (clinicIndex as unknown) === 'string' ? String(clinicIndex) : null;
  const c = byId ? state.locations.find((l) => l.staff.some((x) => x.id === byId)) : state.locations[clinicIndex];
  if (!c) return { ok: false, reason: 'Location not found' };
  const id = byId ?? staffId;
  const s = c.staff.find((x) => x.id === id) as SimStaff | undefined;
  if (!s) return { ok: false, reason: 'Staff member not found' };
  if (s.tempUntilDay != null) return { ok: false, reason: 'Temporary staff do not pick perks' };
  if (s.pendingPerks && s.pendingPerks.length) return { ok: true, message: `${s.name.split(' ')[0]} is choosing a perk` };
  if (!withRng(state, (rng) => rollPerks(state, s, rng))) return { ok: false, reason: 'No perks left for this role' };
  return { ok: true, message: `${s.name.split(' ')[0]} leveled up: choose a perk` };
}

/** Pick one of the two offered perks. */
export function pickPerk(state: GameState, clinicIndex: number, staffId: string, perk: PerkId): ActionResult {
  const c = state.phase === 'owner' ? state.locations[clinicIndex] : null;
  if (!c) return { ok: false, reason: 'Location not found' };
  const s = c.staff.find((x) => x.id === staffId) as SimStaff | undefined;
  if (!s) return { ok: false, reason: 'Staff member not found' };
  if (!s.pendingPerks || !s.pendingPerks.includes(perk)) return { ok: false, reason: 'Perk not offered' };
  s.perks = [...perksOf(s), perk];
  s.pendingPerks = null;
  delete s.perkDay;
  return { ok: true, message: `${s.name.split(' ')[0]}: ${PERKS[perk].name}` };
}

/** Days before an unpicked perk choice is made automatically (the first offered). */
export const PERK_AUTO_DAYS = 2;

/** Candidates stay on the board until they expire (2 days); the board is topped up to six,
 * weighted toward the roles the active office lacks. */
export const CANDIDATE_SLOTS = 6;
export function makeCandidates(state: GameState, rng: Rng): void {
  if (state.phase !== 'owner' || !state.locations.length) { state.candidates = []; return; }
  const slots = candidateSlots(state);
  const keep = state.candidates.filter((x) => x.expiresDay >= state.day).slice(0, slots);
  const c = state.locations[Math.max(0, Math.min(state.locations.length - 1, state.active))];
  const tier = OFFICES[c.tier];
  const hyg = c.staff.filter((s) => s.role === 'hygienist').length;
  const openOps = c.ops.filter((o) => o.staffId == null).length;
  const w: Record<StaffRole, number> = {
    hygienist: openOps > 0 ? 5 : 2,
    receptionist: c.staff.some((s) => s.role === 'receptionist') ? 0.4 : 3,
    assistant: hyg > 0 && c.ops.some((o) => o.staffId && !o.assistantId) ? 1.5 : 0.4,
    dentist: c.tier === 't1' ? 0.3 : c.staff.some((s) => s.role === 'dentist') ? 0.4 : 1.2,
    manager: state.locations.length >= 2 && !c.staff.some((s) => s.role === 'manager') ? 1.5 : 0.3,
  };
  const roles = Object.keys(w) as StaffRole[];
  const out: Candidate[] = [...keep];
  const seen = new Set<StaffRole>(keep.map((x) => x.role));
  for (let i = keep.length; i < slots; i++) {
    // guarantee variety: the first three picks avoid repeats when possible
    let role = rng.weighted(roles, (r) => w[r] * (i < 3 && seen.has(r) ? 0.25 : 1));
    seen.add(role);
    const s = makeStaff(state, rng, role, tier.candidateQuality);
    const range = { skill: statRange(s.skill, rng), speed: statRange(s.speed, rng), bedside: statRange(s.bedside, rng) };
    out.push({ ...s, expiresDay: state.day + 1, interviewed: false, range });
  }
  state.candidates = out;
}

export function hire(state: GameState, candidateId: string, clinicIndex: number): ActionResult {
  if (state.phase !== 'owner') return { ok: false, reason: 'Open a practice first' };
  const c = state.locations[clinicIndex];
  if (!c) return { ok: false, reason: 'Location not found' };
  const cand = state.candidates.find((x) => x.id === candidateId);
  if (!cand) return { ok: false, reason: 'Candidate is no longer available' };
  const fee = cand.ask;
  if (state.cash < fee) return { ok: false, reason: 'Not enough cash' };
  addCash(state, -fee, 'Hiring fees');
  const { expiresDay, interviewed, range, ...rest } = cand;
  void expiresDay; void interviewed; void range;
  const s: Staff = {
    ...rest, hiredDay: state.day, salary: cand.ask, task: 'idle', patientsToday: 0, busyUntil: null, targetOpId: null,
    perks: perksOf(cand), pendingPerks: null,
  };
  c.staff.push(s);
  state.candidates = state.candidates.filter((x) => x.id !== candidateId);
  state.stats.hires += 1;
  let msg = `${s.name} joined the team`;
  if (s.role === 'hygienist') {
    const op = c.ops.find((o) => o.staffId == null) as SimOp | undefined;
    if (op) { op.staffId = s.id; op.freeAt = state.minute; msg = `${s.name} now staffs operatory ${c.ops.indexOf(op) + 1}`; }
  } else if (s.role === 'assistant') {
    const op = c.ops.find((o) => o.staffId && !o.assistantId) ?? c.ops.find((o) => !o.assistantId);
    if (op) op.assistantId = s.id;
  }
  checkAchievements(state, null);
  return { ok: true, message: msg };
}

export function unassign(c: Clinic, staffId: string): void {
  for (const o of c.ops) {
    if (o.staffId === staffId) o.staffId = null;
    if (o.assistantId === staffId) o.assistantId = null;
  }
}

export function fire(state: GameState, clinicIndex: number, staffId: string): ActionResult {
  const c = state.phase === 'owner' ? state.locations[clinicIndex] : null;
  if (!c) return { ok: false, reason: 'Location not found' };
  const s = c.staff.find((x) => x.id === staffId);
  if (!s) return { ok: false, reason: 'Staff member not found' };
  addCash(state, -s.salary, 'Severance');
  const held = c.ops.find((o) => o.staffId === staffId) as SimOp | undefined;
  unassign(c, staffId);
  c.staff = c.staff.filter((x) => x.id !== staffId);
  // a hygienist without an operatory fills the gap
  if (held) {
    const idle = c.staff.find((x) => x.role === 'hygienist' && !c.ops.some((o) => o.staffId === x.id));
    if (idle) {
      held.staffId = idle.id;
      held.freeAt = state.minute;
      return { ok: true, message: `${s.name} was let go. ${idle.name} staffs operatory ${c.ops.indexOf(held) + 1}` };
    }
  }
  return { ok: true, message: `${s.name} was let go` };
}

export function train(state: GameState, clinicIndex: number, staffId: string): ActionResult {
  const c = state.phase === 'owner' ? state.locations[clinicIndex] : null;
  if (!c) return { ok: false, reason: 'Location not found' };
  const s = c.staff.find((x) => x.id === staffId) as SimStaff | undefined;
  if (!s) return { ok: false, reason: 'Staff member not found' };
  if (s.offUntilDay > state.day) return { ok: false, reason: 'Already booked on a course' };
  if (s.skill >= 99) return { ok: false, reason: 'Nothing left to learn' };
  if (s.tempUntilDay != null) return { ok: false, reason: 'Temporary staff do not train' };
  const cost = trainingCost(state);
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash' };
  addCash(state, -cost, 'Training');
  // the skill gain (and a higher ask) arrive when the course day ends
  s.courseGain = (s.courseGain ?? 0) + courseSkill(state);
  s.offFrom = state.day + 1;
  s.offUntilDay = state.day + 1;
  return { ok: true, message: `${s.name} is on a course tomorrow` };
}

/** Training course price: HR Guru -40%, a Research Wing anywhere halves it. */
export function trainingCost(state: GameState): number {
  return Math.round(TRAINING_COST * (hasSkill(state, 'hrGuru') ? 0.6 : 1) * (chainHas(state, 'researchWing') ? 0.5 : 1));
}
/** Skill a course teaches: HR Guru +50%. */
export function courseSkill(state: GameState): number {
  return Math.round(COURSE_SKILL * (hasSkill(state, 'hrGuru') ? 1.5 : 1));
}

export function setSalary(state: GameState, clinicIndex: number, staffId: string, salary: number): ActionResult {
  const c = state.phase === 'owner' ? state.locations[clinicIndex] : null;
  if (!c) return { ok: false, reason: 'Location not found' };
  const s = c.staff.find((x) => x.id === staffId);
  if (!s) return { ok: false, reason: 'Staff member not found' };
  if (!Number.isFinite(salary)) return { ok: false, reason: 'Enter a salary' };
  const v = Math.round(clamp(salary, Math.round(s.ask * SALARY_FLOOR), Math.round(s.ask * 2)));
  const raised = v > s.salary;
  s.salary = v;
  if (raised && v >= s.ask) s.morale = Math.min(100, s.morale + 5);
  // a raise answers any request in the pipeline and starts the quiet period (DESIGN 8.5)
  if (raised) {
    const ss = s as SimStaff;
    ss.raiseDay = state.day;
    if (v >= s.ask * RAISE_CONTENT) delete ss.raiseDue;
  }
  return { ok: true, message: `${s.name}: ${money(v)} per day` };
}

/** Hard Bargain pays this share of each raise-all gap (DESIGN 8.5). */
export const HARD_BARGAIN_SHARE = 0.6;

/** One staff member's raise in a raiseAllQuote/raiseAll, and the location it belongs to (useful with 'all'). */
export interface RaiseAllStaff { clinicIndex: number; staffId: string; name: string; from: number; to: number }

/** What Raise all (the Payroll Day skill, DESIGN 8.5) would do right now: every staff member paid below
 * their ask at the location (or, with clinicIndex 'all', every location) gets raised. Without Hard Bargain
 * `to` is the full ask; with it, `to` is only HARD_BARGAIN_SHARE of the gap, accepted as a full raise.
 * `fullPerDay` is always the uncapped cost, so the UI can show the saving Hard Bargain makes. `ok` is false
 * (with a reason) when Payroll Day is not learned, or nobody at the target is paid below their ask. */
export interface RaiseAllQuote { ok: boolean; reason?: string; count: number; perDay: number; fullPerDay: number; staff: RaiseAllStaff[] }

export function raiseAllQuote(state: GameState, clinicIndex: number | 'all'): RaiseAllQuote {
  const empty = (reason: string): RaiseAllQuote => ({ ok: false, reason, count: 0, perDay: 0, fullPerDay: 0, staff: [] });
  if (state.phase !== 'owner') return empty('Open a practice first');
  if (!hasSkill(state, 'payrollDay')) return empty('Needs Payroll Day first');
  if (clinicIndex !== 'all' && !state.locations[clinicIndex]) return empty('Location not found');
  const indices = clinicIndex === 'all' ? state.locations.map((_, i) => i) : [clinicIndex];
  const hard = hasSkill(state, 'hardBargain');
  const out: RaiseAllStaff[] = [];
  let perDay = 0;
  let fullPerDay = 0;
  for (const idx of indices) {
    const c = state.locations[idx];
    for (const s of c.staff) {
      if (s.tempUntilDay != null) continue;
      if (s.salary >= s.ask) continue;
      const gap = s.ask - s.salary;
      const to = hard ? s.salary + Math.round(HARD_BARGAIN_SHARE * gap) : s.ask;
      fullPerDay += gap;
      perDay += to - s.salary;
      out.push({ clinicIndex: idx, staffId: s.id, name: s.name, from: s.salary, to });
    }
  }
  if (!out.length) return empty('Everyone is paid what they ask');
  return { ok: true, count: out.length, perDay, fullPerDay, staff: out };
}

/** Raise all (DESIGN 8.5): raises every staff member below their ask at the location (or every location
 * with 'all') to their ask, one location or 'all'. With Hard Bargain, pays only HARD_BARGAIN_SHARE of each
 * gap and the staff member's ask drops to match, so they take it as a full raise and no follow-up request
 * comes from that gap. Reuses setSalary's bookkeeping (morale +5, raise request cleared, 10-day clock
 * restarted) so the result matches a manual raise. A recurring salary change: no cash moves here, salaries
 * are paid at the day close like any other. */
export function raiseAll(state: GameState, clinicIndex: number | 'all'): ActionResult {
  const q = raiseAllQuote(state, clinicIndex);
  if (!q.ok) return { ok: false, reason: q.reason ?? 'Everyone is paid what they ask' };
  const hard = hasSkill(state, 'hardBargain');
  for (const item of q.staff) {
    const c = state.locations[item.clinicIndex];
    const s = c?.staff.find((x) => x.id === item.staffId);
    if (!s) continue;
    if (hard) s.ask = item.to;   // accepted as a full raise at the discounted rate: satisfied, no follow-up ask
    setSalary(state, item.clinicIndex, s.id, item.to);
  }
  const saved = q.fullPerDay - q.perDay;
  const message = hard
    ? `Raised ${q.count} staff: ${signedMoney(q.perDay)}/day (saved ${money(saved)}/day)`
    : `Raised ${q.count} staff: ${signedMoney(q.perDay)}/day`;
  return { ok: true, message };
}

export function assignHygienist(state: GameState, clinicIndex: number, opId: string, staffId: string | null): ActionResult {
  const c = state.phase === 'owner' ? state.locations[clinicIndex] : null;
  if (!c) return { ok: false, reason: 'Location not found' };
  const op = c.ops.find((o) => o.id === opId);
  if (!op) return { ok: false, reason: 'Operatory not found' };
  (op as SimOp).freeAt = state.minute;   // an operatory that starts serving now never seats anyone in the past
  if (staffId === PLAYER_ID) {
    for (const o of c.ops) if (o.staffId === PLAYER_ID && o !== op) o.staffId = null;
    op.staffId = PLAYER_ID;
    return { ok: true, message: 'You staff this operatory' };
  }
  if (staffId == null) {
    op.staffId = null;
    return { ok: true };
  }
  const s = c.staff.find((x) => x.id === staffId);
  if (!s) return { ok: false, reason: 'Staff member not found' };
  if (s.role !== 'hygienist') return { ok: false, reason: 'Only hygienists can staff an operatory' };
  for (const o of c.ops) if (o.staffId === staffId) o.staffId = null;
  op.staffId = staffId;
  checkAchievements(state, null);
  return { ok: true, message: `${s.name} staffs operatory ${c.ops.indexOf(op) + 1}` };
}

export function assignAssistant(state: GameState, clinicIndex: number, opId: string, staffId: string | null): ActionResult {
  const c = state.phase === 'owner' ? state.locations[clinicIndex] : null;
  if (!c) return { ok: false, reason: 'Location not found' };
  const op = c.ops.find((o) => o.id === opId);
  if (!op) return { ok: false, reason: 'Operatory not found' };
  if (staffId == null) { op.assistantId = null; return { ok: true }; }
  const s = c.staff.find((x) => x.id === staffId);
  if (!s) return { ok: false, reason: 'Staff member not found' };
  if (s.role !== 'assistant') return { ok: false, reason: 'Only assistants can assist' };
  for (const o of c.ops) if (o.assistantId === staffId) o.assistantId = null;
  op.assistantId = staffId;
  return { ok: true, message: `${s.name} assists in operatory ${c.ops.indexOf(op) + 1}` };
}

export function setPlayerMode(state: GameState, clinicIndex: number, opId: string, mode: 'hands' | 'auto'): ActionResult {
  const c = clinicByIndex(state, clinicIndex);
  if (!c) return { ok: false, reason: 'Location not found' };
  const op = c.ops.find((o) => o.id === opId);
  if (!op) return { ok: false, reason: 'Operatory not found' };
  if (op.staffId !== PLAYER_ID) return { ok: false, reason: 'You do not staff this operatory' };
  if (mode === 'auto' && !c.ownedByPlayer) return { ok: false, reason: 'Autopilot needs your own practice' };
  if (op.playerMode !== mode) (op as SimOp).freeAt = state.minute;
  op.playerMode = mode;
  if (mode === 'hands') {
    // a patient already seated for autopilot keeps going; nothing else to do
  } else {
    for (const p of c.patients) if (p.opId === op.id) p.awaitingPlayer = false;
  }
  return { ok: true, message: mode === 'auto' ? 'Autopilot on' : 'Hands-on' };
}

/** Lowest salary you can set, as a share of the ask. */
export const SALARY_FLOOR = 0.75;
/** Daily chance that staff with morale under 25 quit (Loyal never). */
export const LOW_MORALE_QUIT = 0.2;

/** Patients per day a role handles before overwork costs morale (DESIGN 8.5). Hygienists and assistants
 * are measured in chair minutes instead, so faster cleans (assistants, Ultrasonic Kits) are not punished. */
const OVERWORK: Record<StaffRole, number> = { hygienist: 7, assistant: 9, dentist: 18, receptionist: 40, manager: 999 };
/** Chair minutes a day before a hygienist or assistant feels overworked, and the minutes per -3 morale. */
export const OVERWORK_MINUTES = 470;
const OVERWORK_STEP = 45;
/** Skill a training course adds when it ends. */
export const COURSE_SKILL = 8;
/** Morale lost per day while cash is below zero (not offset by managers, Leader or the break room). */
const BROKE_MORALE = 8;

/** Raise requests (DESIGN 8.5): a staff member asks at most once per RAISE_COOLDOWN working days, counted
 * from hiring, their last request or their last raise, and never while paid at least RAISE_CONTENT of the ask. */
export const RAISE_COOLDOWN = 10;
export const RAISE_CONTENT = 0.95;
/** Auto raises (settings.autoRaise, or an Office Manager at the location) approve asks up to this much above the salary. */
export const AUTO_RAISE_MAX = 0.15;
/** Underpaid Ambitious staff also ask on a random day with this chance (still once per cooldown). */
export const AMBITIOUS_ASK = 0.1;
/** Ask increase per staff level, up to LEVEL_ASK_MAX (a veteran's ask stops climbing at about 1.55x their
 * hiring ask; stats still grow). Without the cap an owner who approves every raise, or runs auto raises,
 * eventually pays more in salaries than the chairs can earn. */
export const LEVEL_ASK = 1.05;
export const LEVEL_ASK_MAX = 10;

/** Paid below RAISE_CONTENT of the ask: the staff member would ask for a raise. */
export function wantsRaise(s: Staff): boolean {
  return s.tempUntilDay == null && s.salary < s.ask * RAISE_CONTENT;
}

/** Raises at this location are handled without the owner: the pay policy, or an Office Manager on staff. */
export function autoRaises(state: GameState, c: Clinic): boolean {
  return state.settings?.autoRaise === true || c.staff.some((x) => x.role === 'manager' && x.tempUntilDay == null);
}

/** First name for report notes ("Auto raise: Ava +$12"), the full name when a teammate anywhere shares it. */
function shortName(state: GameState, s: Staff): string {
  const first = s.name.split(' ')[0];
  const twin = state.locations.some((l) => l.staff.some((x) => x !== s && x.name.split(' ')[0] === first));
  return twin ? s.name : first;
}

/** A raise request waiting in the pipeline (level-up, course, event) becomes an auto raise, a request to the
 * owner once the quiet period is over, or nothing when the pay already satisfies the ask. */
function settleRaise(state: GameState, c: Clinic, s: SimStaff, ev: SimEvent[] | null): void {
  if (!s.raiseDue) return;
  if (!wantsRaise(s)) { delete s.raiseDue; return; }
  if (autoRaises(state, c) && s.ask <= s.salary * (1 + AUTO_RAISE_MAX)) {
    if (state.cash < 0) return;   // auto raises wait while cash is below zero; the ask stays in the pipeline
    const gain = s.ask - s.salary;
    s.salary = s.ask;
    s.morale = Math.min(100, s.morale + 5);
    s.raiseDay = state.day;
    delete s.raiseDue;
    note(state, `Auto raise: ${shortName(state, s)} +${money(gain)}`);
    return;
  }
  if (state.day - (s.raiseDay ?? s.hiredDay) < RAISE_COOLDOWN) return;   // asks when the quiet period ends
  s.raiseDay = state.day;
  delete s.raiseDue;
  pushEvent(ev, { type: 'raiseRequest', clinicId: c.id, staffId: s.id, name: s.name, ask: s.ask });
  note(state, `${s.name} asks for a raise to ${money(s.ask)} per day`);
}

/** Morale floor with Morale Officer. */
export const MORALE_OFFICER_FLOOR = 30;
/** Rooftop Garden: staff only quit after this many days in a row under 25 morale. */
export const ROOFTOP_QUIT_DAYS = 5;

/** Daily staff update at close: morale, quits, levels, perks, raise requests, temp contracts. */
export function staffDaily(state: GameState, ev: SimEvent[] | null, rng: Rng): void {
  const leader = hasSkill(state, 'leader') ? 1 : 0;
  const floor = hasSkill(state, 'moraleOfficer') ? MORALE_OFFICER_FLOOR : 0;
  const team = focusMoraleAtClose(state);
  for (const c of state.locations) {
    const manager = c.staff.some((s) => s.role === 'manager' && isPresent(state, s)) ? 2 : 0;
    const perks = (has(c, 'breakRoom') ? 3 : 0) + (has(c, 'staffLockers') ? 1 : 0) + (has(c, 'rooftopGarden') ? 3 : 0);
    const late = lateMinutes(state, c);
    const quitters: Staff[] = [];
    const leavers: Staff[] = [];
    for (const s0 of c.staff) {
      const s = s0 as SimStaff;
      const byMinutes = s.role === 'hygienist' || s.role === 'assistant';
      const bonus = perkAdd(s, 'overworkBonus');
      const over = byMinutes
        ? Math.max(0, (s.workMin ?? 0) - (OVERWORK_MINUTES + late + bonus * OVERWORK_STEP)) / OVERWORK_STEP
        : Math.max(0, s.patientsToday - (OVERWORK[s.role] + bonus));
      const overwork = Math.round(3 * over);
      const underpaid = s.salary < s.ask ? Math.round(30 * (1 - s.salary / Math.max(1, s.ask))) : 0;
      // underpaid staff lose morale in proportion (-3 at 90% of their ask, -15 at half)
      let dm = 2 - overwork - underpaid + (s.traits.includes('nightOwl') ? 1 : 0);
      if (state.cash < 0) dm -= BROKE_MORALE;   // payday bounced: no perk makes up for that
      else dm += perks + leader + manager + team;
      const m0 = s.morale;
      s.morale = clamp(Math.round(s.morale + dm), floor, 100);
      if (m0 - s.morale > 5) {
        const why = state.cash < 0 ? 'unpaid' : overwork >= underpaid && overwork > 0 ? 'overworked' : underpaid > 0 ? 'underpaid' : 'unhappy';
        note(state, `${s.name} is ${why} (morale ${s.morale})`);
      }
      // a course that ended today: the skill gain lands and the ask follows
      if (s.courseGain && s.offUntilDay <= state.day) {
        s.skill = Math.min(99, s.skill + s.courseGain);
        s.courseGain = 0;
        const ask = askFor(s.role, s);
        note(state, `${s.name} finished the course: skill ${s.skill}`);
        if (ask > s.ask) {
          s.ask = ask;
          if (wantsRaise(s)) s.raiseDue = true;
        }
      }
      // levels: every 25 * level patients; perk choices at PERK_LEVELS
      const lv0 = s.level;
      while (s.xp >= 25 * s.level) {
        s.xp -= 25 * s.level;
        s.level += 1;
        s.skill = Math.min(99, s.skill + 3);
        s.speed = Math.min(99, s.speed + 2);
        s.bedside = Math.min(99, s.bedside + 2);
        if (s.tempUntilDay == null && s.level <= LEVEL_ASK_MAX) s.ask = Math.round(s.ask * LEVEL_ASK);
        if (PERK_LEVELS.includes(s.level) && s.tempUntilDay == null && rollPerks(state, s, rng)) {
          note(state, `${s.name.split(' ')[0]} leveled up: choose a perk`);
        }
      }
      s.xp = Math.round(s.xp * 100) / 100;
      // raise requests (DESIGN 8.5): mostly at level-ups, at most one per RAISE_COOLDOWN days, none while
      // paid within 5% of the ask; auto raises (pay policy or an Office Manager) never reach the owner
      if (s.level > lv0) {
        note(state, `${s.name} reached level ${s.level}`);
        if (wantsRaise(s)) s.raiseDue = true;
      } else if (s.traits.includes('ambitious') && !s.raiseDue && wantsRaise(s) && rng.chance(AMBITIOUS_ASK)) {
        s.raiseDue = true;
      }
      settleRaise(state, c, s, ev);
      // an unpicked perk choice is made for you after two days (the first offered)
      if (s.pendingPerks && s.pendingPerks.length && state.day - (s.perkDay ?? state.day) >= PERK_AUTO_DAYS) {
        const pick = s.pendingPerks[0];
        s.perks = [...perksOf(s), pick];
        s.pendingPerks = null;
        delete s.perkDay;
        note(state, `${s.name.split(' ')[0]} picked ${PERKS[pick].name}`);
      }
      // quits: morale under 25 (Loyal never; with a Rooftop Garden only after a bad week)
      s.lowDays = s.morale < 25 ? (s.lowDays ?? 0) + 1 : 0;
      if (!s.lowDays) delete s.lowDays;
      const patient = has(c, 'rooftopGarden') && (s.lowDays ?? 0) < ROOFTOP_QUIT_DAYS;
      if (s.morale < 25 && !s.traits.includes('loyal') && !patient && s.tempUntilDay == null && rng.chance(LOW_MORALE_QUIT)) quitters.push(s);
      if (s.tempUntilDay != null && s.tempUntilDay <= state.day) leavers.push(s);
      s.patientsToday = 0;
      s.workMin = 0;
    }
    for (const q of quitters) {
      removeStaff(c, q.id);
      pushEvent(ev, { type: 'staffQuit', clinicId: c.id, staffId: q.id, name: q.name });
      note(state, `${q.name} quit`);
    }
    for (const q of leavers) {
      if (!c.staff.includes(q)) continue;
      removeStaff(c, q.id);
      note(state, `${q.name} finished their placement`);
    }
  }
}

export { withRng, S };
