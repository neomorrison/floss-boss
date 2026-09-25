// People management: one actor per visible patient, staff member and the player. Each frame the actor
// gets a destination from flow.ts; when it changes the actor stands up (if seated), walks the nav route
// at a readable pace (sped up with the game speed and when it falls behind the sim), then settles into
// a seat or the dental chair. On the first frame, after a location switch or a clock jump everyone is
// placed directly where the sim says they are.
import * as THREE from 'three';
import type { ArchetypeId, Clinic, DayPatient, Staff } from '../core/types';
import { PLAYER_ID } from '../core/constants';
import { ROLES } from '../data/staff';
import { route, type ClinicLayout } from './layout';
import { pathLength, pointAt, type V2 } from './nav';
import {
  FlowContext, emptyTarget, patientTarget, staffTarget, playerOp, cleaningProgress, keysFor,
  STAFF_HIDDEN, STAFF_IDLE, type Target,
} from './flow';
import { createPerson, applyPose, disposePerson, type Person, type PersonKind, type Tint, type PoseState, SKINS, HAIRS, SENIOR_HAIRS, SHIRTS, PANTS } from './people';
import { hash01, pickBy, mat, C } from './palette';
import { seatCatchupBoost, walkRate } from './pace';
import type { HitInfo } from './office';

const SETTLE_TIME = 0.4;
const BASE_SPEED = 3.5;       // m/s at 1x (brisk cartoon pace; the sim's walks last seconds, not minutes)
const STRIDE = 5.2;           // walk phase radians per meter
const MAX_PLAN = 6;
// Headroom above the shipped max speed (Speed = 0|1|2|4, so gameRate/5 tops out at 4) so debug/test
// speeds and any future pacing lever (DESIGN 2, "Known tension") never sit exactly at the walk-rate
// ceiling with no margin (out/fix/clinic.md #2).
const RATE_HEADROOM = 8;
// Cap on the "hurry to be seated before the cleaning starts" boost (out/fix/clinic.md #3).
const SEAT_BOOST_CAP = 6;

type StopKind = 'qin' | 'seat' | 'op' | 'qout' | 'exit' | 'other';
function stopKind(key: string): StopKind {
  if (key.startsWith('qin')) return 'qin';
  if (key.startsWith('qout')) return 'qout';
  if (key.startsWith('seat')) return 'seat';
  if (key.startsWith('op')) return 'op';
  if (key === 'exit') return 'exit';
  return 'other';
}

/** A one-shot effect the view should show now (coins and stars once the patient reaches the pay desk). */
export interface ActorEffect { x: number; z: number; y: number; paid: number; stars: number }

export interface Actor {
  id: string;
  role: 'patient' | 'staff' | 'player';
  kind: PersonKind;
  tint: Tint;
  person: Person;
  glb: boolean;
  tgt: Target;
  destKey: string;
  needPath: boolean;
  path: V2[] | null;
  pathLen: number;
  dist: number;
  x: number; z: number; yaw: number;
  standX: number; standZ: number;     // approach point of the seat or chair we are settling into
  seatX: number; seatZ: number; seatYaw: number;
  settle: number;
  settlePose: 'sit' | 'recline' | null;
  pose: PoseState;
  scale: number;
  growing: boolean;
  shrinking: boolean;
  gone: boolean;
  frame: number;
  speedMul: number;
  angry: boolean;
  chimed: boolean;
  entering: boolean;
  hit: HitInfo;
  headY: number;
  hat: THREE.Object3D | null;   // pirate case: a small tricorn, worn for as long as the case does
  glasses: THREE.Object3D | null;   // VIP patient: sunglasses, worn for as long as DayPatient.vip does
  patient: DayPatient | null;
  staff: Staff | null;
  /** Patients visit their stops in order (desk, seat, chair, desk, door) even when the sim is ahead. */
  plan: Target[];
  cur: number;
  dwell: number;
  drive: Target;
  pendingPaid: number;
  pendingStars: number;
  paid: boolean;
}

const tmpP = { x: 0, z: 0, dx: 0, dz: 1 };
const PLAYER_STAFF = { id: PLAYER_ID, role: 'hygienist' as const, task: 'idle' as const, targetOpId: null };

function patientKind(a: ArchetypeId): PersonKind {
  return a === 'kid' ? 'kid' : a === 'senior' ? 'senior' : 'adult';
}

export function patientTint(id: string, a: ArchetypeId): Tint {
  return {
    skin: pickBy(SKINS, id, 11),
    hair: a === 'senior' ? pickBy(SENIOR_HAIRS, id, 12) : pickBy(HAIRS, id, 12),
    shirt: pickBy(SHIRTS, id, 13),
    pants: a === 'kid' ? pickBy(['#5FA8F5', '#F46F9B', '#FFD166', '#4FCB8E'], id, 14) : pickBy(PANTS, id, 14),
    shoes: pickBy(['#3A4A52', '#FFFFFF', '#E8505B', '#5A4636'], id, 15),
    scrubs: '#2BB3A3',
    hairStyle: Math.floor(hash01(id, 16) * 3),
  };
}

// ------------------------------------------------------------------ pirate hat (DESIGN 5, Pirate Visit)
// A small procedural tricorn worn only while the patient's case is pirate. Geometry and materials are
// shared module-level (pirates are rare, per DESIGN 5.5), each patient just gets a cheap clone.

let hatCone: THREE.BufferGeometry | null = null;
let hatBrim: THREE.BufferGeometry | null = null;

function makePirateHat(): THREE.Group {
  hatCone ??= new THREE.ConeGeometry(0.17, 0.2, 10);
  hatBrim ??= new THREE.TorusGeometry(0.16, 0.035, 8, 16);
  const g = new THREE.Group();
  g.name = 'pirateHat';
  const cone = new THREE.Mesh(hatCone, mat(C.ink, 0.55, 0));
  cone.position.y = 0.1;
  cone.rotation.z = 0.14;
  cone.castShadow = true;
  g.add(cone);
  const band = new THREE.Mesh(hatBrim, mat(C.sunshine, 0.35, 0.2, C.sunshine, 0.2));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.01;
  g.add(band);
  return g;
}

// ------------------------------------------------------------------ VIP sunglasses (DESIGN 10.2)
// A simple procedural dark band, worn for as long as the patient stays VIP (mystery shopper, celebrity,
// Smile Studio patron). Same shared-geometry, cheap-clone pattern as the pirate hat above.

let vipLensGeo: THREE.BufferGeometry | null = null;
let vipBridgeGeo: THREE.BufferGeometry | null = null;

function makeVipGlasses(): THREE.Group {
  vipLensGeo ??= new THREE.BoxGeometry(0.14, 0.08, 0.03);
  vipBridgeGeo ??= new THREE.BoxGeometry(0.06, 0.02, 0.02);
  const g = new THREE.Group();
  g.name = 'vipGlasses';
  const m = mat(C.ink, 0.25, 0.35, C.ink, 0.2);
  const l = new THREE.Mesh(vipLensGeo, m); l.position.set(-0.1, 0, 0.02); l.castShadow = true;
  const r = new THREE.Mesh(vipLensGeo, m); r.position.set(0.1, 0, 0.02); r.castShadow = true;
  const bridge = new THREE.Mesh(vipBridgeGeo, m); bridge.position.set(0, 0, 0.02);
  g.add(l, r, bridge);
  return g;
}

export function staffTint(id: string, scrubs: string): Tint {
  return {
    skin: pickBy(SKINS, id, 21), hair: pickBy(HAIRS, id, 22), shirt: scrubs, pants: scrubs,
    shoes: pickBy(['#FFFFFF', '#3A4A52', '#DDE3E8'], id, 23), scrubs, hairStyle: Math.floor(hash01(id, 24) * 3),
  };
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const ease = (t: number) => t * t * (3 - 2 * t);

export interface DoorSense { x: number; z: number; onCross(entering: boolean, first: boolean): void }

export class Actors {
  readonly group = new THREE.Group();
  readonly patients = new Map<string, Actor>();
  readonly staff = new Map<string, Actor>();
  readonly ctx = new FlowContext();
  private frameNo = 0;
  private layout: ClinicLayout | null = null;
  private clinicId = '';
  private t = 0;
  private roleCount = { hygienist: 0, receptionist: 0, assistant: 0, dentist: 0, manager: 0 };
  private rate = 1;
  door: DoorSense | null = null;

  private blobs = true;
  /** Soft round blobs under people: on when real shadows are off. */
  setBlobs(on: boolean): void {
    if (on === this.blobs) return;
    this.blobs = on;
    for (const a of this.all()) a.person.blob.visible = on;
  }

  /** Build every person again (the GLB rigs arrived). Keeps positions and states. */
  rebuildPeople(): void {
    for (const a of this.all()) {
      const old = a.person;
      this.group.remove(old.root);
      disposePerson(old);
      a.person = createPerson(a.kind, a.tint, a.role === 'player');
      a.glb = a.person.fromGlb;
      a.person.hit.userData.hit = a.hit;
      a.person.blob.visible = this.blobs;
      if (a.hat) a.person.root.add(a.hat);
      if (a.glasses) a.person.root.add(a.glasses);
      this.group.add(a.person.root);
    }
  }

  *all(): IterableIterator<Actor> {
    yield* this.patients.values();
    yield* this.staff.values();
  }

  /** Drop every actor without paying out any pending coins/stars (a location switch, out/fix/clinic.md
   * "multi-location overlay bug": the old location's patients never had the chance to actually reach the
   * new layout's checkout, so their pending pay/review must be dropped, not flushed there). */
  clear(): void {
    for (const a of this.all()) { this.group.remove(a.person.root); disposePerson(a.person); }
    this.patients.clear(); this.staff.clear();
    this.effects.length = 0;
  }

  private make(id: string, role: Actor['role'], kind: PersonKind, tint: Tint): Actor {
    const person = createPerson(kind, tint, role === 'player');
    const a: Actor = {
      id, role, kind, tint, person, glb: person.fromGlb, tgt: emptyTarget(), destKey: '', needPath: false,
      path: null, pathLen: 0, dist: 0, x: 0, z: 0, yaw: 0, standX: 0, standZ: 0, seatX: 0, seatZ: 0, seatYaw: 0,
      settle: 0, settlePose: null,
      pose: { walk: 0, phase: hash01(id, 3) * 6, sit: 0, recline: 0, work: 0, angry: 0, t: 0, seed: hash01(id, 4) },
      scale: 1, growing: false, shrinking: false, gone: false, frame: 0,
      speedMul: kind === 'senior' ? 0.8 : kind === 'kid' ? 1.1 : 1, angry: false, chimed: false, entering: false,
      hit: { kind: role === 'patient' ? 'patient' : 'staff', id }, headY: 1.9, hat: null, glasses: null, patient: null, staff: null,
      plan: [], cur: 0, dwell: 0, drive: null as unknown as Target, pendingPaid: 0, pendingStars: 0, paid: false,
    };
    a.drive = a.tgt;
    person.hit.userData.hit = a.hit;
    person.blob.visible = this.blobs;
    this.group.add(person.root);
    return a;
  }

  private remove(map: Map<string, Actor>, a: Actor): void {
    if (a.pendingPaid > 0 || a.pendingStars > 0) this.flushPay(a);
    if (a.hat) { a.person.root.remove(a.hat); a.hat = null; }
    if (a.glasses) { a.person.root.remove(a.glasses); a.glasses = null; }
    this.group.remove(a.person.root);
    disposePerson(a.person);
    map.delete(a.id);
  }

  /** Place an actor exactly at its destination (no walk). */
  private snap(a: Actor): void {
    if (a.role === 'patient') this.resetPlan(a);
    const T = a.drive;
    a.destKey = T.key; a.needPath = false; a.path = null; a.pathLen = 0; a.dist = 0;
    a.standX = T.x; a.standZ = T.z;
    if (T.pose === 'sit' || T.pose === 'recline') {
      a.settlePose = T.pose; a.settle = 1;
      a.seatX = T.sx; a.seatZ = T.sz; a.seatYaw = T.yaw;
      a.x = T.sx; a.z = T.sz;
    } else {
      a.settlePose = null; a.settle = 0;
      a.x = T.x; a.z = T.z;
    }
    a.yaw = T.yaw;
    a.pose.walk = 0;
    a.pose.sit = a.settlePose === 'sit' ? 1 : 0;
    a.pose.recline = a.settlePose === 'recline' ? 1 : 0;
    a.pose.work = T.pose === 'work' ? 1 : 0;
    if (T.exit) a.gone = true;
  }

  private spawnAt(a: Actor, p: V2): void {
    a.x = p.x; a.z = p.z; a.yaw = Math.PI / 2;
    a.destKey = ''; a.needPath = false;
    a.scale = 0.01; a.growing = true;
  }

  /**
   * Update every person. `live` false places everyone directly (first frame, location switch, clock
   * jump). `gameRate` is game minutes per real second (5 at 1x).
   */
  sync(c: Clinic, l: ClinicLayout, minute: number, dt: number, live: boolean, gameRate: number): void {
    // A same-tier location switch keeps the identical cached ClinicLayout object (layoutFor caches by
    // tier), so the layout check alone misses it; check clinicId too (out/fix/followup.md multi-location
    // overlay bug) or the old location's actors fall into the "sim dropped this patient" branch below and
    // flushPay() pops their coins/stars at the new location's checkout instead of being dropped.
    if (l !== this.layout || c.id !== this.clinicId) { this.clear(); this.layout = l; this.clinicId = c.id; live = false; }
    this.t += dt;
    this.frameNo++;
    const fn = this.frameNo;
    this.ctx.update(c, l);
    // walk faster than real time at higher game speeds (the sim squeezes a day into two minutes)
    const rate = walkRate(gameRate, RATE_HEADROOM);
    this.rate = rate;

    // ---- patients
    for (const p of c.patients) {
      let a = this.patients.get(p.id);
      if (!a) {
        if (p.state === 'scheduled' || p.state === 'noshow' || p.state === 'gone') continue;
        if (!live && (p.state === 'exiting' || p.state === 'walkout')) continue;
        a = this.make(p.id, 'patient', patientKind(p.archetype), patientTint(p.id, p.archetype));
        this.patients.set(p.id, a);
        if (!patientTarget(a.tgt, p, c, l, this.ctx)) { this.remove(this.patients, a); continue; }
        if (live && p.state === 'entering') { this.spawnAt(a, l.streetIn); a.entering = true; } else this.snap(a);
      } else if (!patientTarget(a.tgt, p, c, l, this.ctx)) {
        this.remove(this.patients, a);
        continue;
      }
      a.patient = p;
      a.frame = fn;
      a.angry = p.state === 'walkout';
      // pirate case: wear the hat for as long as the case does (dropped if the sim ever falls back to routine)
      const wantHat = p.caseType === 'pirate';
      if (wantHat && !a.hat) { a.hat = makePirateHat(); a.person.root.add(a.hat); }
      else if (!wantHat && a.hat) { a.person.root.remove(a.hat); a.hat = null; }
      // VIP patient (DESIGN 10.2): sunglasses for as long as the visit stays VIP
      if (p.vip && !a.glasses) { a.glasses = makeVipGlasses(); a.person.root.add(a.glasses); }
      else if (!p.vip && a.glasses) { a.person.root.remove(a.glasses); a.glasses = null; }
      // clicks on a patient in the chair open the operatory
      const inChair = (p.state === 'inChair' || p.state === 'toChair') && p.opId !== null;
      a.hit.kind = inChair ? 'op' : 'patient';
      a.hit.id = inChair ? p.opId! : p.id;
      if (live) this.plan(a, dt, l); else this.resetPlan(a);
      // hurry when behind the sim; reach the chair early in the cleaning
      const pending = a.plan.length - 1 - a.cur;
      let boost = Math.min(2.2, 1 + 0.45 * pending) * (a.angry ? 1.3 : 1);
      if (pending === 0 && stopKind(a.drive.key) === 'op' && p.until !== null && !p.awaitingPlayer) {
        // approximate the walk left even before a route exists yet (out/fix/clinic.md #3): the very
        // first frame after the target changes would otherwise skip this boost for a frame
        const remaining = a.path && a.dist < a.pathLen ? a.pathLen - a.dist : Math.hypot(a.drive.x - a.x, a.drive.z - a.z);
        const need = seatCatchupBoost({
          remaining, sinceMin: p.since, untilMin: p.until, minute, gameRate,
          speedMps: BASE_SPEED * a.speedMul, rate, cap: SEAT_BOOST_CAP,
        });
        if (need > boost) boost = need;
      }
      this.step(a, dt, live, rate * boost);
    }
    for (const a of this.patients.values()) {
      if (a.gone) { this.remove(this.patients, a); continue; }
      if (a.frame !== fn) {
        // the sim dropped this patient: finish the walk out of the door (placed directly if not live)
        if (!live || !a.patient) { this.remove(this.patients, a); continue; }
        a.frame = fn;
        a.tgt.key = 'exit'; a.tgt.x = a.tgt.sx = l.streetOut.x; a.tgt.z = a.tgt.sz = l.streetOut.z;
        a.tgt.pose = 'stand'; a.tgt.exit = true; a.tgt.yaw = -Math.PI / 2;
        this.plan(a, dt, l);
        this.step(a, dt, live, rate * Math.min(2.2, 1 + 0.45 * (a.plan.length - 1 - a.cur)));
      }
    }

    // ---- staff
    let idle = 0;
    const roleCount = this.roleCount;
    roleCount.hygienist = 0; roleCount.receptionist = 0; roleCount.assistant = 0; roleCount.dentist = 0; roleCount.manager = 0;
    let checkinBusy = false;
    for (const p of c.patients) if (p.state === 'checkin') { checkinBusy = true; break; }
    for (const s of c.staff) {
      let a = this.staff.get(s.id);
      const tmp = a ? a.tgt : SCRATCH;
      const res = staffTarget(tmp, s, c, l, idle, roleCount[s.role]++);
      if (res === STAFF_IDLE) idle++;
      if (res === STAFF_HIDDEN) { if (a) this.remove(this.staff, a); continue; }
      if (!a) {
        const role = ROLES[s.role];
        const kind: PersonKind = s.role === 'dentist' ? 'dentist' : 'staff';
        a = this.make(s.id, 'staff', kind, staffTint(s.id, role?.scrubs ?? '#2BB3A3'));
        this.staff.set(s.id, a);
        copyTarget(a.tgt, SCRATCH);
        if (live) { this.spawnAt(a, l.door.inside); } else this.snap(a);
      }
      if (s.role === 'receptionist' && checkinBusy && a.tgt.pose === 'stand' && a.tgt.key === 'recep0') a.tgt.pose = 'work';
      a.staff = s;
      a.frame = fn;
      a.drive = a.tgt;
      this.setStaffHit(a, c, s.id, s.role === 'hygienist' || s.role === 'assistant');
      this.step(a, dt, live, rate);
    }
    // ---- the player, when posted at an operatory
    if (playerOp(c) >= 0) {
      let a = this.staff.get(PLAYER_ID);
      const tmp = a ? a.tgt : SCRATCH;
      staffTarget(tmp, PLAYER_STAFF, c, l, 0, 0);
      if (!a) {
        a = this.make(PLAYER_ID, 'player', 'staff', staffTint('player-you', '#FF7AA8'));
        this.staff.set(PLAYER_ID, a);
        copyTarget(a.tgt, SCRATCH);
        this.snap(a);
      }
      a.frame = fn;
      this.setStaffHit(a, c, PLAYER_ID, true);
      this.step(a, dt, live, rate);
    }
    for (const a of this.staff.values()) if (a.frame !== fn) this.remove(this.staff, a);
  }

  /** Effects ready to show (filled during sync, drained by the view). */
  readonly effects: ActorEffect[] = [];

  /** The sim billed this patient: show the coins when they reach the pay desk (now if already past it). */
  deferPaid(patientId: string, amount: number): boolean {
    const a = this.patients.get(patientId);
    if (!a || a.paid) return false;
    a.pendingPaid += amount;
    return true;
  }

  /** A review by this patient: stars float up after paying (now if already past the desk). */
  deferReview(name: string, stars: number): Actor | null {
    for (const a of this.patients.values()) {
      if (a.patient?.name !== name) continue;
      if (a.paid || a.angry) return a;
      a.pendingStars = stars;
      return null;
    }
    return null;
  }

  private flushPay(a: Actor): void {
    const l = this.layout;
    if (!l) return;
    this.effects.push({ x: l.checkout.x, z: l.checkout.z, y: a.headY, paid: a.pendingPaid, stars: a.pendingStars });
    a.pendingPaid = 0; a.pendingStars = 0;
  }

  private resetPlan(a: Actor): void {
    const t = a.plan[0] ?? emptyTarget();
    copyTarget(t, a.tgt);
    a.plan.length = 1; a.plan[0] = t;
    a.cur = 0; a.dwell = 0;
    a.drive = t;
  }

  /**
   * Keep the patient's ordered list of stops in step with the sim and decide which one to walk to.
   * A stop is left once reached and dwelt on briefly, and only when the sim has already moved on.
   */
  private plan(a: Actor, dt: number, l: ClinicLayout): void {
    const kind = stopKind(a.tgt.key);
    const last = a.plan[a.plan.length - 1];
    if (!last) { this.resetPlan(a); return; }
    if (stopKind(last.key) === kind) {
      copyTarget(last, a.tgt);
    } else {
      // the previous stop is history: a line stop becomes the counter itself
      const lk = stopKind(last.key);
      if (lk === 'qin') { last.key = keysFor(l).qin[0]; last.x = last.sx = l.checkin.x; last.z = last.sz = l.checkin.z; }
      if (lk === 'qout') { last.key = keysFor(l).qout[0]; last.x = last.sx = l.checkout.x; last.z = last.sz = l.checkout.z; }
      if (a.plan.length >= MAX_PLAN) {
        // drop visited stops to make room
        const drop = Math.min(a.cur, a.plan.length - MAX_PLAN + 1);
        if (drop > 0) { a.plan.splice(0, drop); a.cur -= drop; }
      }
      const t = emptyTarget();
      copyTarget(t, a.tgt);
      a.plan.push(t);
    }
    // arrived at the current stop?
    const stop = a.plan[a.cur];
    const sk = stopKind(stop.key);
    const settling = stop.pose === 'sit' || stop.pose === 'recline';
    const reached = a.destKey === stop.key && !a.needPath && a.dist >= a.pathLen && (!settling || a.settle >= 1);
    a.dwell = reached ? a.dwell + dt : 0;
    const pending = a.plan.length - 1 - a.cur;
    if (pending > 0) {
      const minDwell = (sk === 'qin' ? 0.35 : sk === 'qout' ? 0.45 : sk === 'op' ? 0.5 : sk === 'seat' ? 0.15 : 0) / this.rate;
      // no time to sit down when the chair is already waiting
      const skipSeat = sk === 'seat' && !reached && a.settle === 0;
      if ((reached && a.dwell >= minDwell) || skipSeat) {
        if (sk === 'qout') { a.paid = true; if (a.pendingPaid > 0 || a.pendingStars > 0) this.flushPay(a); }
        a.cur++;
        a.dwell = 0;
      }
    }
    a.drive = a.plan[a.cur];
    if (stopKind(a.drive.key) === 'exit' && !a.paid) {
      a.paid = true;
      if (a.pendingPaid > 0 || a.pendingStars > 0) this.flushPay(a);
    }
  }

  private setStaffHit(a: Actor, c: Clinic, id: string, opWorker: boolean): void {
    if (opWorker) {
      for (const o of c.ops) {
        if (o.staffId === id || o.assistantId === id) { a.hit.kind = 'op'; a.hit.id = o.id; return; }
      }
    }
    a.hit.kind = 'staff'; a.hit.id = id;
  }

  /** Advance one actor toward its destination and pose it. */
  private step(a: Actor, dtRaw: number, live: boolean, rate: number): void {
    const dt = Math.min(dtRaw, 0.1);
    const T = a.drive;
    const l = this.layout!;
    if (!live) {
      if (a.destKey !== T.key || a.needPath || a.dist < a.pathLen) this.snap(a);
    }
    if (T.key !== a.destKey) {
      a.destKey = T.key;
      a.needPath = true;
    }
    const wantSettle = (T.pose === 'sit' || T.pose === 'recline');
    let walking = false;
    if (a.settle > 0 && (a.needPath || !wantSettle)) {
      // stand up first
      a.settle = Math.max(0, a.settle - dt * Math.sqrt(this.rate) / SETTLE_TIME);
      const e = ease(a.settle);
      a.x = a.standX + (a.seatX - a.standX) * e;
      a.z = a.standZ + (a.seatZ - a.standZ) * e;
      if (a.settle === 0) { a.x = a.standX; a.z = a.standZ; a.settlePose = null; }
    } else {
      if (a.needPath) {
        a.needPath = false;
        a.path = route(l, { x: a.x, z: a.z }, { x: T.x, z: T.z });
        a.pathLen = pathLength(a.path);
        a.dist = 0;
      }
      if (a.path && a.dist < a.pathLen) {
        const v = BASE_SPEED * a.speedMul * rate;
        a.dist = Math.min(a.pathLen, a.dist + v * dt);
        pointAt(a.path, a.dist, tmpP);
        a.x = tmpP.x; a.z = tmpP.z;
        a.yaw = lerpAngle(a.yaw, Math.atan2(tmpP.dx, tmpP.dz), Math.min(1, dt * 12));
        // legs cycle at most ~4 steps a second; faster walkers glide a little
        a.pose.phase += Math.min(v, 4.5) * dt * STRIDE / Math.max(0.6, a.person.hipY / 0.7);
        walking = true;
        this.senseDoor(a);
      } else {
        // arrived
        if (wantSettle) {
          if (a.settlePose !== T.pose) { a.settlePose = T.pose as 'sit' | 'recline'; a.settle = 0; }
          a.standX = T.x; a.standZ = T.z; a.seatX = T.sx; a.seatZ = T.sz; a.seatYaw = T.yaw;
          a.settle = Math.min(1, a.settle + dt * Math.sqrt(this.rate) / SETTLE_TIME);
          const e = ease(a.settle);
          a.x = a.standX + (a.seatX - a.standX) * e;
          a.z = a.standZ + (a.seatZ - a.standZ) * e;
          a.yaw = lerpAngle(a.yaw, T.yaw, Math.min(1, dt * 10));
        } else {
          a.x = T.x; a.z = T.z;
          a.yaw = lerpAngle(a.yaw, T.yaw, Math.min(1, dt * 8));
        }
        if (T.exit && !a.shrinking) a.shrinking = true;
      }
    }
    // pose blends
    const P = a.pose;
    P.t += dt;
    P.walk += ((walking ? 1 : 0) - P.walk) * Math.min(1, dt * 10);
    const sitW = a.settlePose === 'sit' ? ease(a.settle) : 0;
    const recW = a.settlePose === 'recline' ? ease(a.settle) : 0;
    P.sit = sitW; P.recline = recW;
    const wantWork = !walking && T.pose === 'work' ? 1 : 0;
    P.work += (wantWork - P.work) * Math.min(1, dt * 5);
    P.angry += ((a.angry ? 1 : 0) - P.angry) * Math.min(1, dt * 6);
    applyPose(a.person, P);
    // pop in / out
    if (a.growing) { a.scale = Math.min(1, a.scale + dt * 4); if (a.scale >= 1) a.growing = false; }
    if (a.shrinking) { a.scale = Math.max(0, a.scale - dt * 3.5); if (a.scale <= 0.02) a.gone = true; }
    const r = a.person.root;
    r.position.set(a.x, 0, a.z);
    r.rotation.y = a.yaw;
    const s = a.scale < 1 ? easeBack(a.scale) : 1;
    r.scale.setScalar(Math.max(0.01, s));
    a.headY = a.person.height - (a.person.hipY - 0.52) * sitW - 0.55 * recW + 0.12;
    if (a.hat) a.hat.position.y = a.headY - 0.08;
    if (a.glasses) a.glasses.position.y = a.headY - 0.2;
  }

  private senseDoor(a: Actor): void {
    const d = this.door;
    if (!d) return;
    if (Math.abs(a.x - d.x) < 1.0 && Math.abs(a.z - d.z) < 1.1) {
      const first = a.role === 'patient' && a.entering && !a.chimed;
      if (first) a.chimed = true;
      d.onCross(a.entering, first);
    }
  }

  /** Progress (0..1) of the cleaning in an operatory's chair, or null. */
  static progress(p: DayPatient, minute: number): number | null { return cleaningProgress(p, minute); }
}

const SCRATCH: Target = emptyTarget();
function copyTarget(dst: Target, src: Target): void {
  dst.key = src.key; dst.x = src.x; dst.z = src.z; dst.sx = src.sx; dst.sz = src.sz; dst.yaw = src.yaw; dst.pose = src.pose; dst.exit = src.exit;
}
function easeBack(t: number): number {
  const c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
