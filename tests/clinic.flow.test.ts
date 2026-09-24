import { describe, expect, it } from 'vitest';
import { layoutFor } from '../src/clinic/layout';
import {
  FlowContext, emptyTarget, patientTarget, staffTarget, cleaningProgress, lineOf, keysFor,
  STAFF_HIDDEN, STAFF_IDLE, STAFF_POSTED,
} from '../src/clinic/flow';
import type { Clinic, DayPatient, Operatory, PatientState, Staff, StaffRole } from '../src/core/types';
import { PLAYER_ID } from '../src/core/constants';

const L = layoutFor('t2');

function patient(id: string, state: PatientState, extra: Partial<DayPatient> = {}): DayPatient {
  return {
    id, name: 'Pat ' + id, archetype: 'regular', portrait: 'regular', service: 'cleaning', addons: [], apptMin: 540,
    walkIn: false, state, since: 540, until: null, seat: null, opId: null, staffId: null, awaitingPlayer: false,
    arrivedMin: 540, waitedMin: 0, patience: 45, dirtLevel: 0.5, quality: null, comfort: null, stars: null,
    fee: 120, tip: 0, isPlayerPatient: false, mood: 'ok', ...extra,
  };
}
function staff(id: string, role: StaffRole, extra: Partial<Staff> = {}): Staff {
  return {
    id, name: 'S ' + id, role, portrait: 'staff_0', skill: 50, speed: 50, bedside: 50, salary: 200, ask: 200, morale: 70,
    traits: [], level: 1, xp: 0, hiredDay: 1, offUntilDay: 0, patientsToday: 0, task: 'idle', targetOpId: null, busyUntil: null, ...extra,
  };
}
function op(slot: number, extra: Partial<Operatory> = {}): Operatory {
  return { id: 'op' + slot, slot, chair: 'basic', upgrades: [], staffId: null, assistantId: null, patientId: null, playerMode: 'hands', ...extra };
}
function clinic(patients: DayPatient[], ops: Operatory[] = [], team: Staff[] = []): Clinic {
  return {
    id: 'c1', name: 'Test', tier: 't2', ownedByPlayer: true, ops, equipment: [], staff: team,
    prices: { cleaning: 1, deep: 1, fluoride: 1, sealant: 1, xray: 1, whitening: 1, exam: 1, filling: 1 },
    marketing: 0, rating: 4, reviews: [], served: 0, patients,
    day: { booked: 0, demand: 0, turnedAway: 0, noShows: 0, walkIns: 0, served: 0, walkouts: 0, revenue: 0, tips: 0, supplies: 0, addonsSold: 0, fiveStars: 0, handsOn: 0 },
    checkinBusyUntil: 0,
  };
}

describe('clinic flow: patients', () => {
  it('hides scheduled and no-show patients', () => {
    const c = clinic([patient('a', 'scheduled'), patient('b', 'noshow')]);
    const ctx = new FlowContext(); ctx.update(c, L);
    const t = emptyTarget();
    expect(patientTarget(t, c.patients[0], c, L, ctx)).toBe(false);
    expect(patientTarget(t, c.patients[1], c, L, ctx)).toBe(false);
  });

  it('lines people up at the desk, the one at the counter first', () => {
    const c = clinic([
      patient('late', 'entering', { since: 600 }),
      patient('counter', 'checkin', { since: 610 }),
      patient('early', 'entering', { since: 590 }),
    ]);
    const ctx = new FlowContext(); ctx.update(c, L);
    expect(ctx.lineIndex.get('counter')).toBe(0);
    expect(ctx.lineIndex.get('early')).toBe(1);
    expect(ctx.lineIndex.get('late')).toBe(2);
    const t = emptyTarget();
    patientTarget(t, c.patients[0], c, L, ctx);
    expect(t.key).toBe(keysFor(L).qin[2]);
    expect(t.z).toBeCloseTo(L.checkin.z + 2 * L.queueStep.z);
    expect(t.pose).toBe('stand');
  });

  it('seats waiting patients in their seat, and gives seatless ones a free seat', () => {
    const c = clinic([
      patient('a', 'waiting', { seat: 2 }),
      patient('b', 'waiting', { seat: null }),
      patient('c', 'waiting', { seat: 2 }),   // clash: must not share seat 2
    ]);
    const ctx = new FlowContext(); ctx.update(c, L);
    const seats = ['a', 'b', 'c'].map((id) => ctx.seatOf.get(id));
    expect(seats[0]).toBe(2);
    expect(new Set(seats).size).toBe(3);
    const t = emptyTarget();
    patientTarget(t, c.patients[0], c, L, ctx);
    expect(t.pose).toBe('sit');
    expect(t.sx).toBeCloseTo(L.seats[2].x);
    expect(t.x).toBeCloseTo(L.seats[2].approach.x);
  });

  it('sends patients to their operatory chair, reclined', () => {
    const c = clinic([patient('a', 'inChair', { opId: 'op3', until: 700 })], [op(3, { patientId: 'a' })]);
    const ctx = new FlowContext(); ctx.update(c, L);
    const t = emptyTarget();
    patientTarget(t, c.patients[0], c, L, ctx);
    expect(t.key).toBe(keysFor(L).op[3]);
    expect(t.pose).toBe('recline');
    expect(t.sx).toBeCloseTo(L.ops[3].chair.x);
    expect(t.x).toBeCloseTo(L.ops[3].bedside.x);
  });

  it('walks leaving and walked-out patients to the street', () => {
    for (const st of ['exiting', 'walkout', 'gone'] as PatientState[]) {
      const c = clinic([patient('a', st)]);
      const ctx = new FlowContext(); ctx.update(c, L);
      const t = emptyTarget();
      expect(patientTarget(t, c.patients[0], c, L, ctx)).toBe(true);
      expect(t.exit).toBe(true);
      expect(t.x).toBeCloseTo(L.streetOut.x);
    }
  });

  it('pays in the checkout line', () => {
    expect(lineOf('toDesk')).toBe('out');
    expect(lineOf('checkout')).toBe('out');
    const c = clinic([patient('a', 'checkout')]);
    const ctx = new FlowContext(); ctx.update(c, L);
    const t = emptyTarget();
    patientTarget(t, c.patients[0], c, L, ctx);
    expect(t.key).toBe(keysFor(L).qout[0]);
    expect(t.x).toBeCloseTo(L.checkout.x);
  });

  it('reports cleaning progress only while an NPC or autopilot clean runs', () => {
    expect(cleaningProgress(patient('a', 'inChair', { since: 600, until: 640 }), 620)).toBeCloseTo(0.5);
    expect(cleaningProgress(patient('a', 'inChair', { since: 600, until: 640 }), 700)).toBe(1);
    expect(cleaningProgress(patient('a', 'inChair', { since: 600, until: null, awaitingPlayer: true }), 620)).toBeNull();
    expect(cleaningProgress(patient('a', 'waiting'), 620)).toBeNull();
  });
});

describe('clinic flow: staff', () => {
  const t = emptyTarget();

  it('posts hygienists at their operatory and works while a patient is being cleaned', () => {
    const h = staff('h1', 'hygienist');
    const p = patient('a', 'inChair', { opId: 'op1', until: 700 });
    const c = clinic([p], [op(1, { staffId: 'h1', patientId: 'a' })], [h]);
    expect(staffTarget(t, h, c, L, 0, 0)).toBe(STAFF_POSTED);
    expect(t.key).toBe(keysFor(L).hyg[1]);
    expect(t.pose).toBe('work');
    p.awaitingPlayer = true;
    staffTarget(t, h, c, L, 0, 0);
    expect(t.pose).toBe('stand');
  });

  it('sends staff without a post, on a break, or extra to the break area', () => {
    const c = clinic([], [], []);
    expect(staffTarget(t, staff('h', 'hygienist'), c, L, 1, 0)).toBe(STAFF_IDLE);
    expect(t.key).toBe(keysFor(L).idle[1]);
    expect(staffTarget(t, staff('b', 'receptionist', { task: 'break' }), c, L, 0, 0)).toBe(STAFF_IDLE);
    expect(staffTarget(t, staff('r', 'receptionist'), c, L, 0, L.receptionists.length)).toBe(STAFF_IDLE);
  });

  it('hides staff who are off', () => {
    expect(staffTarget(t, staff('o', 'hygienist', { task: 'off' }), clinic([]), L, 0, 0)).toBe(STAFF_HIDDEN);
  });

  it('walks the dentist to the operatory being examined, else the office', () => {
    const c = clinic([], [op(2)], []);
    expect(staffTarget(t, staff('d', 'dentist', { task: 'exam', targetOpId: 'op2' }), c, L, 0, 0)).toBe(STAFF_POSTED);
    expect(t.key).toBe(keysFor(L).dent[2]);
    expect(t.pose).toBe('work');
    staffTarget(t, staff('d', 'dentist'), c, L, 0, 0);
    expect(t.key).toBe('office');
  });

  it('places the player at their own chair', () => {
    const c = clinic([], [op(0, { staffId: PLAYER_ID })], []);
    expect(staffTarget(t, { id: PLAYER_ID, role: 'hygienist', task: 'idle', targetOpId: null }, c, L, 0, 0)).toBe(STAFF_POSTED);
    expect(t.key).toBe(keysFor(L).hyg[0]);
  });
});
