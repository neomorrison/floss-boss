// Raise all (DESIGN 8.5): the Payroll Day skill and its Hard Bargain upgrade. Owner request: "add a 'raise
// all' button as a skill which gives everyone a raise. upgraded skill of that is negotiating raise to do a
// discounted raise which still satisfies them".
import { describe, expect, it } from 'vitest';
import * as sim from '../src/sim/index';
import type { GameState, Staff } from '../src/core/types';
import { OFFICES, TIER_ORDER } from '../src/data/offices';
import { graduated, grant, ledgerSum, nonFinite } from './sim.helpers';
import { HARD_BARGAIN_SHARE, RAISE_COOLDOWN, askFor, makeStaff, staffDaily } from '../src/sim/staff';
import { withRng, type SimStaff } from '../src/sim/internal';

// ------------------------------------------------------------------ helpers

function ownerT2(seed: number): GameState {
  const s = graduated(seed);
  s.difficulty = 'relaxed';   // the raise rules without Standard's salary inflation (DESIGN 11.5)
  grant(s, 3_000_000);
  s.player.level = 8;
  s.player.skillPoints = 5;
  expect(sim.openPractice(s, { name: 'Payroll Dental', loan: 0 }).ok).toBe(true);
  sim.closeDay(s);
  sim.completeHuddle(s);
  expect(sim.moveOffice(s, 0, TIER_ORDER[1], 0).ok).toBe(true);
  const c = s.locations[0];
  while (c.ops.length < OFFICES[c.tier].opSlots) expect(sim.buyOperatory(s, 0).ok).toBe(true);
  for (const op of c.ops) op.staffId = null;
  c.staff = [];
  for (const op of c.ops) addStaff(s, 0, 'hygienist', op.id);
  addStaff(s, 0, 'receptionist');
  return s;
}

function addStaff(s: GameState, li: number, role: Staff['role'], opId?: string): SimStaff {
  const c = s.locations[li];
  const st = withRng(s, (rng) => makeStaff(s, rng, role, 0, { skill: 60, speed: 60, bedside: 60, traits: [] })) as SimStaff;
  c.staff.push(st);
  if (opId) c.ops.find((o) => o.id === opId)!.staffId = st.id;
  return st;
}

/** Underpay a staff member by exactly `gap` (still >= the salary floor at these stats). */
function underpay(s: Staff, gap: number): void {
  s.salary = s.ask - gap;
}

/** One staff close (morale, levels, raises) with the events it raises. */
function close(s: GameState) {
  return withRng(s, (rng) => { const ev: import('../src/core/types').SimEvent[] = []; staffDaily(s, ev, rng); return ev; });
}
const raiseRequests = (ev: ReturnType<typeof close>) => ev.filter((e) => e.type === 'raiseRequest');

// ------------------------------------------------------------------ locked

describe('Raise all: locked without Payroll Day (DESIGN 8.5)', () => {
  it('raiseAllQuote and raiseAll both refuse, and change nothing', () => {
    const s = ownerT2(601);
    const h = s.locations[0].staff.find((x) => x.role === 'hygienist')!;
    underpay(h, 50);
    const q = sim.raiseAllQuote(s, 0);
    expect(q).toMatchObject({ ok: false, count: 0, perDay: 0, fullPerDay: 0, staff: [] });
    expect(q.reason).toBeTruthy();
    const salary0 = h.salary;
    const r = sim.raiseAll(s, 0);
    expect(r.ok).toBe(false);
    expect(h.salary).toBe(salary0);
  });
});

// ------------------------------------------------------------------ Payroll Day

describe('Raise all: Payroll Day (DESIGN 8.5)', () => {
  it('everyone already at their ask: quote says so and changes nothing', () => {
    const s = ownerT2(602);
    expect(sim.learnSkill(s, 'payrollDay').ok).toBe(true);
    const q = sim.raiseAllQuote(s, 0);
    expect(q).toEqual({ ok: false, reason: 'Everyone is paid what they ask', count: 0, perDay: 0, fullPerDay: 0, staff: [] });
    expect(sim.raiseAll(s, 0).ok).toBe(false);
  });

  it('raises only those below ask, skips temp staff, leaves the rest untouched', () => {
    const s = ownerT2(603);
    expect(sim.learnSkill(s, 'payrollDay').ok).toBe(true);
    const c = s.locations[0];
    const hygs = c.staff.filter((x) => x.role === 'hygienist') as SimStaff[];
    underpay(hygs[0], 40);
    underpay(hygs[1], 90);
    const untouched = hygs[2];
    const untouchedSalary = untouched.salary;
    const temp = addStaff(s, 0, 'hygienist');
    temp.tempUntilDay = s.day + 5;
    underpay(temp, 60);
    const tempSalary = temp.salary;

    const q = sim.raiseAllQuote(s, 0);
    expect(q.ok).toBe(true);
    expect(q.count).toBe(2);
    expect(q.perDay).toBe(40 + 90);
    expect(q.fullPerDay).toBe(q.perDay);   // no discount without Hard Bargain
    const byId = new Map(q.staff.map((x) => [x.staffId, x]));
    expect(byId.get(hygs[0].id)).toMatchObject({ clinicIndex: 0, from: hygs[0].ask - 40, to: hygs[0].ask });
    expect(byId.get(hygs[1].id)).toMatchObject({ clinicIndex: 0, from: hygs[1].ask - 90, to: hygs[1].ask });
    expect(byId.has(temp.id)).toBe(false);
    expect(byId.has(untouched.id)).toBe(false);

    hygs[0].morale = 50; hygs[1].morale = 50;
    const r = sim.raiseAll(s, 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message).toBe(`Raised 2 staff: +$${40 + 90}/day`);

    for (const h of [hygs[0], hygs[1]]) {
      expect(h.salary).toBe(h.ask);
      expect(h.morale).toBe(55);
      expect(h.raiseDay).toBe(s.day);
      expect(h.raiseDue).toBeUndefined();
    }
    expect(untouched.salary).toBe(untouchedSalary);
    expect(temp.salary).toBe(tempSalary);
  });

  it('cash and the ledger are untouched at the moment of the raise (a recurring cost, not a one-off charge)', () => {
    const s = ownerT2(604);
    expect(sim.learnSkill(s, 'payrollDay').ok).toBe(true);
    const h = s.locations[0].staff.find((x) => x.role === 'hygienist')!;
    underpay(h, 75);
    const cash0 = s.cash;
    const ledgerLen0 = s.ledger.length;
    expect(sim.raiseAll(s, 0).ok).toBe(true);
    expect(s.cash).toBe(cash0);
    expect(s.ledger.length).toBe(ledgerLen0);
    expect(ledgerSum(s)).toBe(s.cash);
  });
});

// ------------------------------------------------------------------ Hard Bargain

describe('Raise all: Hard Bargain (DESIGN 8.5)', () => {
  it('pays 60% of the gap; the staff member is satisfied and asks for nothing more on that gap', () => {
    const s = ownerT2(605);
    s.player.skillPoints = 5;
    expect(sim.learnSkill(s, 'payrollDay').ok).toBe(true);
    expect(sim.learnSkill(s, 'hardBargain').ok).toBe(true);
    const c = s.locations[0];
    const h = c.staff.find((x) => x.role === 'hygienist') as SimStaff;
    const ask0 = h.ask;
    underpay(h, 50);   // 0.6 * 50 = 30 exactly
    h.morale = 50;
    h.hiredDay = s.day - 30;

    const q = sim.raiseAllQuote(s, 0);
    expect(q.ok).toBe(true);
    expect(q.count).toBe(1);
    expect(q.fullPerDay).toBe(50);
    expect(q.perDay).toBe(Math.round(HARD_BARGAIN_SHARE * 50));
    expect(q.staff[0]).toMatchObject({ staffId: h.id, from: ask0 - 50, to: ask0 - 50 + 30 });

    const r = sim.raiseAll(s, 0);
    expect(r.ok).toBe(true);
    const saved = 50 - 30;
    if (r.ok) expect(r.message).toBe(`Raised 1 staff: +$30/day (saved $${saved}/day)`);

    expect(h.salary).toBe(ask0 - 20);   // salary + 30
    expect(h.ask).toBe(h.salary);        // satisfied at the discounted rate
    expect(h.morale).toBe(55);
    expect(h.raiseDay).toBe(s.day);
    expect(h.raiseDue).toBeUndefined();

    // no follow-up request for this gap over the next 20 working days
    for (let d = 0; d < 20; d++) {
      s.day++;
      const ev = close(s);
      expect(raiseRequests(ev).filter((e) => (e as { staffId: string }).staffId === h.id)).toEqual([]);
      expect(h.salary).toBe(h.ask);   // never falls behind again from this gap
    }
    expect(s.day).toBeGreaterThan(RAISE_COOLDOWN * 2);
  });

  it('rounds each staff member independently and reports the total saving', () => {
    const s = ownerT2(606);
    expect(sim.learnSkill(s, 'payrollDay').ok).toBe(true);
    expect(sim.learnSkill(s, 'hardBargain').ok).toBe(true);
    const c = s.locations[0];
    const hygs = c.staff.filter((x) => x.role === 'hygienist') as SimStaff[];
    underpay(hygs[0], 40);
    underpay(hygs[1], 71);   // 0.6 * 71 = 42.6 -> rounds to 43
    const gaps = [40, 71];
    const fullPerDay = gaps.reduce((a, b) => a + b, 0);
    const perDay = gaps.reduce((a, g) => a + Math.round(HARD_BARGAIN_SHARE * g), 0);
    const q = sim.raiseAllQuote(s, 0);
    expect(q.count).toBe(2);
    expect(q.fullPerDay).toBe(fullPerDay);
    expect(q.perDay).toBe(perDay);
    expect(sim.raiseAll(s, 0).ok).toBe(true);
    for (const h of hygs.slice(0, 2)) expect(h.salary).toBe(h.ask);
    expect(nonFinite(s)).toEqual([]);
  });
});

// ------------------------------------------------------------------ 'all' vs one location

describe("Raise all: one location vs 'all' (DESIGN 8.5)", () => {
  it("'all' covers every owned location; a single index touches only that one", () => {
    const s = ownerT2(607);
    expect(sim.learnSkill(s, 'payrollDay').ok).toBe(true);
    expect(sim.openLocation(s, 't2', 'Second', 0).ok).toBe(true);
    const c2 = s.locations[1];
    addStaff(s, 1, 'hygienist', c2.ops[0].id);
    const h0 = s.locations[0].staff.find((x) => x.role === 'hygienist') as SimStaff;
    const h1 = c2.staff.find((x) => x.role === 'hygienist') as SimStaff;
    underpay(h0, 60);
    underpay(h1, 45);

    // location 1 alone does not see location 0's gap
    const q1 = sim.raiseAllQuote(s, 1);
    expect(q1.count).toBe(1);
    expect(q1.staff[0]).toMatchObject({ clinicIndex: 1, staffId: h1.id });
    expect(sim.raiseAllQuote(s, 0).count).toBe(1);

    const qAll = sim.raiseAllQuote(s, 'all');
    expect(qAll.count).toBe(2);
    expect(qAll.perDay).toBe(60 + 45);
    const clinics = new Set(qAll.staff.map((x) => x.clinicIndex));
    expect(clinics).toEqual(new Set([0, 1]));

    expect(sim.raiseAll(s, 'all').ok).toBe(true);
    expect(h0.salary).toBe(h0.ask);
    expect(h1.salary).toBe(h1.ask);
  });
});
