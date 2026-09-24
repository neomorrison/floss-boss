// Staff: candidates, hiring, firing, training, assignments and the daily staff update. DESIGN 8.5.
import type { ActionResult, Candidate, Clinic, GameState, SimEvent, Staff, StaffRole, TraitId } from '../core/types';
import type { Rng } from '../core/rng';
import { clamp } from '../core/rng';
import { PLAYER_ID, TRAINING_COST } from '../core/constants';
import { money } from '../core/format';
import { OFFICES } from '../data/offices';
import { ROLES, STAFF_FIRST, STAFF_LAST, STAFF_PORTRAITS, TRAITS } from '../data/staff';
import { S, SimStaff, addCash, clinicByIndex, hasSkill, isPresent, nextId, note, pushEvent, withRng } from './internal';
import { checkAchievements } from './goals';

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
    ...o,
  };
}

/** Six candidates weighted toward the roles the active office lacks. */
export function makeCandidates(state: GameState, rng: Rng): void {
  if (state.phase !== 'owner' || !state.locations.length) { state.candidates = []; return; }
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
  const out: Candidate[] = [];
  const seen = new Set<StaffRole>();
  for (let i = 0; i < 6; i++) {
    // guarantee variety: the first three picks avoid repeats when possible
    let role = rng.weighted(roles, (r) => w[r] * (i < 3 && seen.has(r) ? 0.25 : 1));
    seen.add(role);
    const s = makeStaff(state, rng, role, tier.candidateQuality);
    out.push({ ...s, expiresDay: state.day + 1 });
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
  const { expiresDay, ...rest } = cand;
  const s: Staff = { ...rest, hiredDay: state.day, salary: cand.ask, task: 'idle', patientsToday: 0, busyUntil: null, targetOpId: null };
  c.staff.push(s);
  state.candidates = state.candidates.filter((x) => x.id !== candidateId);
  state.stats.hires += 1;
  let msg = `${s.name} joined the team`;
  if (s.role === 'hygienist') {
    const op = c.ops.find((o) => o.staffId == null);
    if (op) { op.staffId = s.id; msg = `${s.name} now staffs operatory ${c.ops.indexOf(op) + 1}`; }
  } else if (s.role === 'assistant') {
    const op = c.ops.find((o) => o.staffId && !o.assistantId) ?? c.ops.find((o) => !o.assistantId);
    if (op) op.assistantId = s.id;
  }
  checkAchievements(state, null);
  return { ok: true, message: msg };
}

function unassign(c: Clinic, staffId: string): void {
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
  unassign(c, staffId);
  c.staff = c.staff.filter((x) => x.id !== staffId);
  return { ok: true, message: `${s.name} was let go` };
}

export function train(state: GameState, clinicIndex: number, staffId: string): ActionResult {
  const c = state.phase === 'owner' ? state.locations[clinicIndex] : null;
  if (!c) return { ok: false, reason: 'Location not found' };
  const s = c.staff.find((x) => x.id === staffId) as SimStaff | undefined;
  if (!s) return { ok: false, reason: 'Staff member not found' };
  if (s.offUntilDay > state.day) return { ok: false, reason: 'Already booked on a course' };
  if (s.skill >= 99) return { ok: false, reason: 'Nothing left to learn' };
  if (state.cash < TRAINING_COST) return { ok: false, reason: 'Not enough cash' };
  addCash(state, -TRAINING_COST, 'Training');
  s.skill = Math.min(99, s.skill + 8);
  s.offFrom = state.day + 1;
  s.offUntilDay = state.day + 1;
  s.ask = Math.max(s.ask, askFor(s.role, s));
  return { ok: true, message: `${s.name} is on a course tomorrow` };
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
  return { ok: true, message: `${s.name}: ${money(v)} per day` };
}

export function assignHygienist(state: GameState, clinicIndex: number, opId: string, staffId: string | null): ActionResult {
  const c = state.phase === 'owner' ? state.locations[clinicIndex] : null;
  if (!c) return { ok: false, reason: 'Location not found' };
  const op = c.ops.find((o) => o.id === opId);
  if (!op) return { ok: false, reason: 'Operatory not found' };
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

/** Patients per day a role handles before overwork costs morale (hygienists: 7, DESIGN 8.5). */
const OVERWORK: Record<StaffRole, number> = { hygienist: 7, assistant: 9, dentist: 18, receptionist: 40, manager: 999 };

/** Daily staff update at close: morale, quits, levels, raise requests. */
export function staffDaily(state: GameState, ev: SimEvent[] | null, rng: Rng): void {
  const leader = hasSkill(state, 'leader') ? 1 : 0;
  for (const c of state.locations) {
    const manager = c.staff.some((s) => s.role === 'manager' && isPresent(state, s)) ? 2 : 0;
    const breakRoom = c.equipment.includes('breakRoom') ? 3 : 0;
    const quitters: Staff[] = [];
    for (const s of c.staff) {
      let dm = 2 - 3 * Math.max(0, s.patientsToday - OVERWORK[s.role]) + breakRoom + leader + manager;
      // underpaid staff lose morale in proportion (-3 at 90% of their ask, -15 at half)
      if (s.salary < s.ask) dm -= Math.round(30 * (1 - s.salary / Math.max(1, s.ask)));
      if (s.traits.includes('nightOwl')) dm += 1;
      if (state.cash < 0) dm -= 2;
      s.morale = clamp(Math.round(s.morale + dm), 0, 100);
      // levels: every 25 * level patients
      const lv0 = s.level;
      while (s.xp >= 25 * s.level) {
        s.xp -= 25 * s.level;
        s.level += 1;
        s.skill = Math.min(99, s.skill + 3);
        s.speed = Math.min(99, s.speed + 2);
        s.bedside = Math.min(99, s.bedside + 2);
        s.ask = Math.round(s.ask * 1.08);
      }
      if (s.level > lv0) {
        note(state, `${s.name} reached level ${s.level}`);
        if (s.salary < s.ask) {
          pushEvent(ev, { type: 'raiseRequest', clinicId: c.id, staffId: s.id, name: s.name, ask: s.ask });
          note(state, `${s.name} asks for a raise to ${money(s.ask)} per day`);
        }
      } else if (s.traits.includes('ambitious') && s.salary < s.ask && rng.chance(0.15)) {
        pushEvent(ev, { type: 'raiseRequest', clinicId: c.id, staffId: s.id, name: s.name, ask: s.ask });
        note(state, `${s.name} asks for a raise to ${money(s.ask)} per day`);
      }
      if (s.morale < 25 && !s.traits.includes('loyal') && rng.chance(LOW_MORALE_QUIT)) quitters.push(s);
      s.patientsToday = 0;
    }
    for (const q of quitters) {
      unassign(c, q.id);
      c.staff = c.staff.filter((x) => x !== q);
      pushEvent(ev, { type: 'staffQuit', clinicId: c.id, staffId: q.id, name: q.name });
      note(state, `${q.name} quit`);
    }
  }
}

export { withRng, S };
