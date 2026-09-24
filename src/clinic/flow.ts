// Where should each person be? PURE mapping from the sim's Clinic state to destinations in a layout.
// The view walks people to these destinations along nav routes (see actors.ts); the sim never tells the
// view about moves, it only changes patient.state / seat / opId and the op and staff assignments.
import type { Clinic, DayPatient, PatientState, Staff } from '../core/types';
import { PLAYER_ID } from '../core/constants';
import type { ClinicLayout, Spot, V2 } from './layout';

export type Pose = 'stand' | 'sit' | 'recline' | 'work';

export interface Target {
  key: string;           // destination identity: a change starts a new walk
  x: number; z: number;  // standing point at the end of the walk
  sx: number; sz: number; // settled point (seat or chair) for sit and recline; equals x, z otherwise
  yaw: number;           // facing once arrived
  pose: Pose;
  exit: boolean;         // disappears when it arrives (walked out the door)
}

export function emptyTarget(): Target {
  return { key: '', x: 0, z: 0, sx: 0, sz: 0, yaw: 0, pose: 'stand', exit: false };
}

/** Destination keys prebuilt per layout so the per-frame mapping does not build strings. */
export interface Keys { qin: string[]; qout: string[]; seat: string[]; op: string[]; hyg: string[]; asst: string[]; dent: string[]; recep: string[]; idle: string[] }
const keyCache = new WeakMap<ClinicLayout, Keys>();
export const MAX_QUEUE = 8;
export function keysFor(l: ClinicLayout): Keys {
  let k = keyCache.get(l);
  if (!k) {
    const n = (p: string, c: number) => Array.from({ length: c }, (_, i) => p + i);
    k = {
      qin: n('qin', MAX_QUEUE), qout: n('qout', MAX_QUEUE), seat: n('seat', l.seats.length),
      op: n('op', l.ops.length), hyg: n('hyg', l.ops.length), asst: n('asst', l.ops.length), dent: n('dent', l.ops.length),
      recep: n('recep', l.receptionists.length), idle: n('idle', l.staffIdle.length),
    };
    keyCache.set(l, k);
  }
  return k;
}

const HIDDEN: ReadonlySet<PatientState> = new Set<PatientState>(['scheduled', 'noshow']);
export function patientVisible(p: DayPatient): boolean { return !HIDDEN.has(p.state); }

export type Line = 'in' | 'out' | null;
export function lineOf(state: PatientState): Line {
  if (state === 'entering' || state === 'checkin') return 'in';
  if (state === 'toDesk' || state === 'checkout') return 'out';
  return null;
}

/**
 * Per-frame bookkeeping shared by all patients: position in the check-in and pay lines, and seats for
 * waiting patients the sim has not given a seat index. Reuses its arrays (no per-frame allocation).
 */
export class FlowContext {
  readonly lineIndex = new Map<string, number>();
  readonly seatOf = new Map<string, number>();
  private inLine: DayPatient[] = [];
  private outLine: DayPatient[] = [];
  private taken: boolean[] = [];

  update(c: Clinic, l: ClinicLayout): void {
    this.lineIndex.clear(); this.seatOf.clear();
    this.inLine.length = 0; this.outLine.length = 0;
    const ns = l.seats.length;
    this.taken.length = ns;
    for (let i = 0; i < ns; i++) this.taken[i] = false;
    for (const p of c.patients) {
      const line = lineOf(p.state);
      if (line === 'in') this.inLine.push(p); else if (line === 'out') this.outLine.push(p);
      if (p.state === 'waiting' && p.seat !== null && p.seat >= 0) {
        const s = p.seat % ns;
        if (!this.taken[s]) { this.taken[s] = true; this.seatOf.set(p.id, s); }
      }
    }
    for (const p of c.patients) {
      if (p.state !== 'waiting' || this.seatOf.has(p.id)) continue;
      let s = 0;
      while (s < ns && this.taken[s]) s++;
      if (s >= ns) s = hashIndex(p.id, ns);
      this.taken[s] = true;
      this.seatOf.set(p.id, s);
    }
    this.inLine.sort(lineOrder); this.outLine.sort(lineOrder);
    for (let i = 0; i < this.inLine.length; i++) this.lineIndex.set(this.inLine[i].id, Math.min(i, MAX_QUEUE - 1));
    for (let i = 0; i < this.outLine.length; i++) this.lineIndex.set(this.outLine[i].id, Math.min(i, MAX_QUEUE - 1));
  }
}

/** People at the counter first (checkin / checkout), then by the minute they started walking up. */
function lineOrder(a: DayPatient, b: DayPatient): number {
  const ra = a.state === 'checkin' || a.state === 'checkout' ? 0 : 1;
  const rb = b.state === 'checkin' || b.state === 'checkout' ? 0 : 1;
  if (ra !== rb) return ra - rb;
  if (a.since !== b.since) return a.since - b.since;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function hashIndex(id: string, n: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % Math.max(1, n);
}

function setSpot(out: Target, key: string, s: V2, yaw: number, pose: Pose): void {
  out.key = key; out.x = s.x; out.z = s.z; out.sx = s.x; out.sz = s.z; out.yaw = yaw; out.pose = pose; out.exit = false;
}

export function opSlotOf(c: Clinic, opId: string | null): number {
  if (!opId) return -1;
  for (const o of c.ops) if (o.id === opId) return o.slot;
  return -1;
}

/** Destination for a patient. Returns false when the patient should not be drawn at all. */
export function patientTarget(out: Target, p: DayPatient, c: Clinic, l: ClinicLayout, ctx: FlowContext): boolean {
  const K = keysFor(l);
  switch (p.state) {
    case 'scheduled': case 'noshow':
      return false;
    case 'entering': case 'checkin': case 'toDesk': case 'checkout': {
      const inLine = lineOf(p.state) === 'in';
      const k = ctx.lineIndex.get(p.id) ?? 0;
      const base: Spot = inLine ? l.checkin : l.checkout;
      out.key = (inLine ? K.qin : K.qout)[k];
      out.x = base.x + l.queueStep.x * k; out.z = base.z + l.queueStep.z * k;
      out.sx = out.x; out.sz = out.z; out.yaw = base.yaw; out.pose = 'stand'; out.exit = false;
      return true;
    }
    case 'waiting': {
      const s = ctx.seatOf.get(p.id) ?? hashIndex(p.id, l.seats.length);
      const seat = l.seats[s];
      out.key = K.seat[s];
      out.x = seat.approach.x; out.z = seat.approach.z; out.sx = seat.x; out.sz = seat.z;
      out.yaw = seat.yaw; out.pose = 'sit'; out.exit = false;
      return true;
    }
    case 'toChair': case 'inChair': {
      const slot = opSlotOf(c, p.opId);
      const op = slot >= 0 ? l.ops[slot] : undefined;
      if (!op) { setSpot(out, K.qin[0], l.checkin, l.checkin.yaw, 'stand'); return true; }
      out.key = K.op[slot];
      out.x = op.bedside.x; out.z = op.bedside.z; out.sx = op.chair.x; out.sz = op.chair.z;
      out.yaw = op.chair.yaw; out.pose = 'recline'; out.exit = false;
      return true;
    }
    case 'exiting': case 'walkout': case 'gone':
    default:
      out.key = 'exit';
      out.x = l.streetOut.x; out.z = l.streetOut.z; out.sx = out.x; out.sz = out.z;
      out.yaw = -Math.PI / 2; out.pose = 'stand'; out.exit = true;
      return true;
  }
}

/** Is this patient's cleaning running right now (for progress rings and hygienist work poses)? */
export function cleaningProgress(p: DayPatient, minute: number): number | null {
  if (p.state !== 'inChair' || p.awaitingPlayer || p.until === null) return null;
  const span = p.until - p.since;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (minute - p.since) / span));
}

export const STAFF_HIDDEN = 0;
export const STAFF_POSTED = 1;
export const STAFF_IDLE = 2;

/**
 * Destination for a staff member (or the player, id 'player'). `idleIndex` is this person's rank among
 * staff without a post, so idle people spread over the break area; `roleIndex` is the rank among staff
 * of the same role. Returns STAFF_HIDDEN (off shift), STAFF_POSTED or STAFF_IDLE.
 */
export function staffTarget(out: Target, s: Pick<Staff, 'id' | 'role' | 'task' | 'targetOpId'>, c: Clinic, l: ClinicLayout, idleIndex: number, roleIndex: number): number {
  const K = keysFor(l);
  if (s.task === 'off') return STAFF_HIDDEN;
  const idle = () => {
    const i = idleIndex % l.staffIdle.length;
    setSpot(out, K.idle[i], l.staffIdle[i], l.staffIdle[i].yaw, 'stand');
    return STAFF_IDLE;
  };
  if (s.task === 'break') return idle();
  switch (s.role) {
    case 'hygienist': {
      for (const o of c.ops) {
        if (o.staffId !== s.id) continue;
        const op = l.ops[o.slot];
        if (!op) break;
        setSpot(out, K.hyg[o.slot], op.hygienist, op.hygienist.yaw, busyOp(c, o.patientId) ? 'work' : 'stand');
        return STAFF_POSTED;
      }
      return idle();
    }
    case 'assistant': {
      for (const o of c.ops) {
        if (o.assistantId !== s.id) continue;
        const op = l.ops[o.slot];
        if (!op) break;
        setSpot(out, K.asst[o.slot], op.assistant, op.assistant.yaw, busyOp(c, o.patientId) ? 'work' : 'stand');
        return STAFF_POSTED;
      }
      return idle();
    }
    case 'receptionist': {
      if (roleIndex >= l.receptionists.length) return idle();
      const r = l.receptionists[roleIndex];
      setSpot(out, K.recep[roleIndex], r, r.yaw, 'stand');
      return STAFF_POSTED;
    }
    case 'dentist': {
      const slot = opSlotOf(c, s.targetOpId);
      if (slot >= 0 && l.ops[slot]) {
        const op = l.ops[slot];
        setSpot(out, K.dent[slot], op.dentist, op.dentist.yaw, s.task === 'exam' ? 'work' : 'stand');
        return STAFF_POSTED;
      }
      if (roleIndex > 0) return idle();
      setSpot(out, 'office', l.office, l.office.yaw, 'stand');
      return STAFF_POSTED;
    }
    case 'manager': {
      if (roleIndex > 0) return idle();
      setSpot(out, 'manager', l.manager, l.manager.yaw, 'stand');
      return STAFF_POSTED;
    }
  }
  return idle();
}

function busyOp(c: Clinic, patientId: string | null): boolean {
  if (!patientId) return false;
  for (const p of c.patients) if (p.id === patientId) return p.state === 'inChair' && !p.awaitingPlayer;
  return false;
}

/** The operatory the player is posted at, or null. */
export function playerOp(c: Clinic): number {
  for (const o of c.ops) if (o.staffId === PLAYER_ID) return o.slot;
  return -1;
}
