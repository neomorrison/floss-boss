// Full career: school -> employee days -> own practice -> hires -> 20 owner days -> move to T2,
// checking the invariants after every step.
import { describe, expect, it } from 'vitest';
import * as sim from '../src/sim/index';
import type { GameState, SimEvent } from '../src/core/types';
import { encodeSave, decodeSave } from '../src/core/save';
import { ledgerSum, nonFinite, result } from './sim.helpers';

function invariants(s: GameState, where: string): void {
  const bad = nonFinite(s);
  expect(bad, `${where}: non-finite numbers ${bad.slice(0, 5).join(', ')}`).toEqual([]);
  expect(s.cash, `${where}: cash equals the ledger sum`).toBe(ledgerSum(s));
  expect(s.ledger.length).toBeLessThanOrEqual(200);
  expect(s.reports.length).toBeLessThanOrEqual(30);
  expect(s.loan).toBeGreaterThanOrEqual(0);
  const clinics = s.phase === 'employee' ? [s.employer!] : s.locations;
  for (const c of clinics) {
    const inOps = new Set<string>();
    for (const op of c.ops) {
      if (op.patientId) {
        expect(inOps.has(op.patientId), `${where}: patient in two operatories`).toBe(false);
        inOps.add(op.patientId);
        const p = c.patients.find((x) => x.id === op.patientId);
        expect(p && (p.state === 'toChair' || p.state === 'inChair'), `${where}: operatory holds a patient who is ${p?.state}`).toBe(true);
      }
    }
    for (const p of c.patients) {
      // a timed state never lags behind the clock (stuck patients would)
      if (p.until != null && p.state !== 'gone' && p.state !== 'noshow') {
        expect(p.until, `${where}: ${p.id} stuck in ${p.state}`).toBeGreaterThan(s.minute - 0.5 - 1e-6);
      }
      expect(p.since).toBeLessThanOrEqual(s.minute + 1e-6 + (p.state === 'scheduled' || p.state === 'noshow' ? 1e9 : 0));
    }
  }
}

function dayOverChecks(s: GameState, where: string): void {
  expect(s.dayOver).toBe(true);
  const clinics = s.phase === 'employee' ? [s.employer!] : s.locations;
  for (const c of clinics) {
    for (const p of c.patients) expect(['gone', 'noshow'], `${where}: ${p.id} ended the day as ${p.state}`).toContain(p.state);
    for (const op of c.ops) expect(op.patientId).toBeNull();
  }
}

function runDay(s: GameState, mode: (i: number) => 'hands' | 'quick' | 'wait', label: string): SimEvent[] {
  const events: SimEvent[] = [];
  let guard = 0;
  let n = 0;
  let dayOverEvents = 0;
  while (!s.dayOver && guard++ < 20000) {
    const q = sim.playerQueue(s);
    if (q.length) {
      let m = mode(n++);
      if (m === 'quick' && !sim.quickCleanStatus(s, q[0].id).ok) m = 'hands';   // quick clean needs Bronze
      if (m === 'hands') {
        const setup = sim.beginHandsOn(s, q[0].id);
        expect(setup.parSeconds).toBeGreaterThan(0);
        expect(setup.problemTeeth.length).toBeGreaterThan(0);
        expect(setup.caseType).toBe(q[0].caseType);
        const r = sim.completeHandsOn(s, q[0].id, result(0.8 + (n % 3) * 0.06, { chunks: setup.dirt.tartarCount, caseType: setup.caseType }));
        events.push(...r.events);
        continue;
      }
      if (m === 'quick') { events.push(...sim.quickClean(s, q[0].id).events); continue; }
    }
    const ev = sim.tick(s, 2.3);
    events.push(...ev);
    invariants(s, label);
  }
  for (const e of events) if (e.type === 'dayOver') dayOverEvents++;
  expect(s.dayOver, `${label}: day never ended`).toBe(true);
  expect(dayOverEvents, `${label}: dayOver emitted once`).toBe(1);
  dayOverChecks(s, label);
  return events;
}

describe('full career flow', () => {
  it('school -> employee -> practice -> hires -> 20 owner days -> Main Street', () => {
    const s = sim.newGame({ name: 'Flo', avatar: 2, seed: 4242, nowMs: 5_000_000 });
    expect(s.phase).toBe('school');
    expect(s.day).toBe(1);
    expect(s.minute).toBe(480);
    expect(s.cash).toBe(0);
    expect(sim.tick(s, 30)).toEqual([]);   // no-op in school

    // school
    const s1 = sim.schoolSetup(s, 1);
    const s2 = sim.schoolSetup(s, 2);
    expect(s1.tutorial).toBe(true);
    expect(s2.tutorial).toBe(false);
    expect(s1.patient.archetype).toBe('mannequin');
    expect(s1.dirt.tartarCount).toBeLessThan(s2.dirt.tartarCount);
    const p1 = sim.completeSchool(s, 1, result(0.8));
    expect(p1.pay).toBe(0);
    expect(s.phase).toBe('school');
    sim.completeSchool(s, 2, result(0.86));
    expect(s.phase).toBe('employee');
    expect(s.employer?.name).toBe('Bright Smiles Dental');
    expect(s.employer?.ops.length).toBe(4);
    expect(s.employer?.ops[0].staffId).toBe('player');
    expect(s.employer?.staff.filter((x) => x.role === 'hygienist').length).toBe(3);
    expect(s.employer?.staff.some((x) => x.role === 'receptionist')).toBe(true);
    expect(s.achievements).toContain('graduate');
    expect(s.goals.length).toBe(3);
    invariants(s, 'graduation');

    // employee days: mix hands-on and quick cleans until the practice is affordable
    let days = 0;
    while (!sim.practiceStatus(s).ok && days < 40) {
      const before = s.cash;
      runDay(s, (i) => (i % 4 === 3 ? 'quick' : 'hands'), `employee day ${s.day}`);
      expect(s.cash).toBeGreaterThanOrEqual(before);   // employees have no costs
      const rep = sim.closeDay(s);
      expect(rep.phase).toBe('employee');
      expect(rep.expenses.filter((l) => l.label !== 'Tools').length).toBe(0);
      invariants(s, `after employee day ${rep.day}`);
      days++;
      if (s.cash >= 300 && s.player.tools.scaler === 1) expect(sim.buyTool(s, 'scaler', 2).ok).toBe(true);
    }
    expect(sim.practiceStatus(s).ok).toBe(true);
    expect(s.player.level).toBeGreaterThanOrEqual(4);
    expect(s.stats.cleanings).toBeGreaterThan(10);

    // save survives a JSON round trip mid-career
    const rt = JSON.parse(JSON.stringify(s));
    expect(rt).toEqual(s);
    const viaCodec = decodeSave(encodeSave(s));
    expect(viaCodec).toEqual(s);

    // open the practice with the biggest loan the bank allows
    const ps = sim.practiceStatus(s);
    expect(sim.openPractice(s, { name: 'Flo Dental', loan: ps.maxLoan }).ok).toBe(true);
    expect(s.phase).toBe('owner');
    expect(s.employer).toBeNull();
    expect(s.active).toBe(0);
    expect(s.locations[0].tier).toBe('t1');
    expect(s.locations[0].ops[0].staffId).toBe('player');
    expect(s.loan).toBe(ps.maxLoan);
    expect(s.candidates.length).toBe(6);
    invariants(s, 'practice opened');
    if (!s.dayOver) runDay(s, () => 'hands', 'opening day');
    sim.closeDay(s);

    // hire a receptionist and a hygienist for a second operatory
    let hiredRec = false;
    let hiredHyg = false;
    for (let d = 0; d < 20; d++) {
      const c = s.locations[0];
      if (!hiredRec) {
        const r = s.candidates.find((x) => x.role === 'receptionist');
        if (r && s.cash >= r.ask) hiredRec = sim.hire(s, r.id, 0).ok;
      }
      if (!hiredHyg && s.cash >= 4000 + 600) {
        const h = s.candidates.find((x) => x.role === 'hygienist');
        if (h) {
          if (c.ops.length < 2) expect(sim.buyOperatory(s, 0).ok).toBe(true);
          hiredHyg = sim.hire(s, h.id, 0).ok;
          if (hiredHyg) expect(c.ops[1].staffId).toBe(h.id);
        }
      }
      runDay(s, (i) => (i < 2 ? 'hands' : 'quick'), `owner day ${s.day}`);
      const rep = sim.closeDay(s);
      expect(rep.phase).toBe('owner');
      expect(rep.expenses.some((l) => l.label === 'Rent')).toBe(true);
      expect(rep.net).toBe(rep.income.reduce((a, l) => a + l.amount, 0) - rep.expenses.reduce((a, l) => a + l.amount, 0));
      invariants(s, `after owner day ${rep.day}`);
    }
    expect(hiredRec).toBe(true);
    expect(hiredHyg).toBe(true);
    expect(s.stats.hires).toBeGreaterThanOrEqual(2);
    expect(s.locations[0].served).toBeGreaterThan(100);

    // save round trip in the owner phase
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);

    // move to Main Street, borrowing what is needed
    let guard = 0;
    while (!sim.moveQuote(s, 0, 't2').ok && guard++ < 60) {
      runDay(s, () => 'quick', `saving day ${s.day}`);
      sim.closeDay(s);
    }
    const q = sim.moveQuote(s, 0, 't2');
    expect(q.ok).toBe(true);
    expect(q.tradeIn).toBe(Math.round(5000 * 0.5));
    const loan = Math.max(0, Math.min(q.maxLoan, q.net - s.cash + 1000));
    const res = sim.moveOffice(s, 0, 't2', loan);
    expect(res.ok).toBe(true);
    expect(s.locations[0].tier).toBe('t2');
    expect(s.locations[0].ops.length).toBeGreaterThanOrEqual(2);
    expect(sim.title(s)).toBe('Clinic Director');
    expect(s.achievements).toContain('t2');
    invariants(s, 'after the move');
    if (!s.dayOver) runDay(s, () => 'quick', 'move day');
    sim.closeDay(s);
    runDay(s, () => 'quick', 'first Main Street day');
    const rep = sim.closeDay(s);
    expect(rep.perLocation[0].stats.demand).toBeGreaterThan(0);
    invariants(s, 'end');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  }, 60_000);
});
