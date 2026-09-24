// DESIGN v2 "cases, not chores": case generation, setups, mastery, quick clean, treasure, and the
// QA fixes that ride along (out/fix/sim.md).
import { describe, expect, it } from 'vitest';
import * as sim from '../src/sim/index';
import type { CaseType, DayPatient, GameState, SimEvent } from '../src/core/types';
import { CASES, CASE_ORDER, MASTERY_TIERS, TWISTS, problemToothCount } from '../src/data/cases';
import { encodeSave, decodeSave } from '../src/core/save';
import { serviceFor } from '../src/sim/patients';
import { treasureBonus } from '../src/sim/career';
import { employeeRate } from '../src/sim/progress';
import { NON_OPERATING_LABELS } from '../src/sim/economy';
import { graduated, grant, ledgerSum, playDay, result } from './sim.helpers';

function owner(seed = 3, cash = 20000, level = 5): GameState {
  const s = graduated(seed);
  grant(s, cash);
  s.player.level = level;
  expect(sim.openPractice(s, { name: 'Test Dental', loan: 0 }).ok).toBe(true);
  return s;
}

function waitForChair(s: GameState): DayPatient {
  let guard = 0;
  while (!sim.playerQueue(s).length && !s.dayOver && guard++ < 3000) sim.tick(s, 1);
  const p = sim.playerQueue(s)[0];
  expect(p, 'a patient reached the player chair').toBeTruthy();
  return p;
}

/** Turn the waiting patient into a case (the archetype follows the case so the setup is realistic). */
function force(p: DayPatient, ct: CaseType): void {
  p.caseType = ct;
  p.service = serviceFor(ct);
  if (ct === 'pirate') p.archetype = 'pirate';
  if (ct === 'candy') p.archetype = 'kid';
  if (ct === 'deep') p.archetype = 'senior';
}

/** Shift patients of the next `days` employee days (the shift is booked at the day close). */
function shifts(s: GameState, days: number, level?: number): DayPatient[][] {
  const out: DayPatient[][] = [];
  for (let d = 0; d < days; d++) {
    if (level) s.player.level = level;
    sim.closeDay(s);
    out.push(s.employer!.patients.filter((p) => p.isPlayerPatient).sort((a, b) => a.apptMin - b.apptMin));
  }
  return out;
}

describe('case generation', () => {
  it('every patient carries a case and twists, NPC patients too', () => {
    const s = graduated(31);
    for (const p of s.employer!.patients) {
      expect(CASE_ORDER).toContain(p.caseType);
      expect(Array.isArray(p.twists)).toBe(true);
      for (const t of p.twists) expect(t in TWISTS).toBe(true);
    }
    const o = owner(32);
    sim.closeDay(o);
    for (const p of o.locations[0].patients) expect(CASE_ORDER).toContain(p.caseType);
  });

  it('cases unlock by level; pirates never show up before level 3', () => {
    const s = graduated(33);
    const seen: Record<number, Set<CaseType>> = { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set() };
    for (const L of [1, 2, 3, 4]) {
      for (const shift of shifts(s, 40, L)) {
        for (const p of shift) {
          seen[L].add(p.caseType);
          expect(CASES[p.caseType].minLevel, `level ${L} got ${p.caseType}`).toBeLessThanOrEqual(L);
          if (L < 3) expect(p.archetype).not.toBe('pirate');
        }
      }
      for (const p of s.employer!.patients) if (L < 3) expect(p.archetype).not.toBe('pirate');
    }
    expect([...seen[1]].every((c) => c === 'routine' || c === 'candy')).toBe(true);
    expect(seen[2].has('whitening')).toBe(true);
    expect(seen[3].has('braces')).toBe(true);
    expect(seen[3].has('pirate')).toBe(true);
    expect(seen[4].has('deep')).toBe(true);
  });

  it('a level-up that unlocks cases schedules each of them once in the next shift', () => {
    const s = graduated(34);
    s.player.level = 2;
    sim.closeDay(s);
    s.player.level = 3;
    sim.closeDay(s);
    const shift = s.employer!.patients.filter((p) => p.isPlayerPatient).map((p) => p.caseType);
    expect(shift).toContain('braces');
    expect(shift).toContain('pirate');
    expect(s.flags.case_sched_pirate).toBe(true);
  });

  it('the shift never repeats a case type back to back', () => {
    const s = graduated(35);
    let repeats = 0;
    let pairs = 0;
    for (const shift of shifts(s, 60, 5)) {
      for (let i = 1; i < shift.length; i++) { pairs++; if (shift[i].caseType === shift[i - 1].caseType) repeats++; }
    }
    expect(pairs).toBeGreaterThan(200);
    expect(repeats).toBe(0);
  });

  it('twists: 0 to 1 below level 4, 0 to 2 from level 4; archetype traits map to twists', () => {
    const s = graduated(36);
    for (const L of [2, 5]) {
      let any = 0;
      for (const shift of shifts(s, 30, L)) {
        for (const p of shift) {
          expect(p.twists.length).toBeLessThanOrEqual(L >= 4 ? 2 : 1);
          for (const t of p.twists) expect(TWISTS[t].minLevel <= L || ['chatty', 'gagger', 'fidget'].includes(t)).toBe(true);
          if (p.archetype === 'chatty') expect(p.twists).toContain('chatty');
          if (p.archetype === 'gagger') expect(p.twists).toContain('gagger');
          if (p.archetype === 'kid') expect(p.twists).toContain('fidget');
          any += p.twists.length;
        }
      }
      expect(any).toBeGreaterThan(0);
    }
  });

  it('owner: whitening needs a staffed Whitening Lamp operatory, deep cases need the certification', () => {
    const s = owner(37, 60000, 6);
    const count = (ct: CaseType) => { let n = 0; for (let d = 0; d < 25; d++) { sim.closeDay(s); n += s.locations[0].patients.filter((p) => p.caseType === ct).length; } return n; };
    expect(count('whitening')).toBe(0);
    expect(count('deep')).toBe(0);
    expect(sim.buyOpUpgrade(s, 0, s.locations[0].ops[0].id, 'whiteningLamp').ok).toBe(true);
    expect(sim.buyEquipment(s, 0, 'deepCert').ok).toBe(true);
    expect(count('whitening')).toBeGreaterThan(0);
    for (const p of s.locations[0].patients) expect(p.service).toBe(p.caseType === 'deep' ? 'deep' : 'cleaning');
    expect(count('deep')).toBeGreaterThan(0);
  });

  it('a whitening case bills the whitening add-on; without a lamp at the chair it becomes routine', () => {
    const s = owner(38, 60000, 6);
    const op = s.locations[0].ops[0];
    sim.buyOpUpgrade(s, 0, op.id, 'whiteningLamp');
    let p = waitForChair(s);
    p.caseType = 'whitening';
    p.addons = ['whitening'];   // what the front desk bills a whitening case at check-in
    const setup = sim.beginHandsOn(s, p.id);
    expect(setup.caseType).toBe('whitening');
    const r = sim.completeHandsOn(s, p.id, result(0.9, { caseType: 'whitening' }));
    expect(r.payout.addons).toContain('whitening');
    expect(r.payout.pay).toBeGreaterThanOrEqual(120 + 350);
    // take the lamp away (a second chair without one): the case is downgraded when you start
    op.upgrades = [];
    p = waitForChair(s);
    p.caseType = 'whitening';
    p.addons = ['whitening'];
    const s2 = sim.beginHandsOn(s, p.id);
    expect(s2.caseType).toBe('routine');
    expect(p.caseType).toBe('routine');
    expect(p.addons).not.toContain('whitening');
  });
});

describe('setups follow the spawn contract (DESIGN 5.5)', () => {
  for (const ct of CASE_ORDER) {
    it(`${ct}: problem teeth, dirt and special are valid and deterministic`, () => {
      const s = graduated(40 + CASE_ORDER.indexOf(ct));
      s.player.level = 5;
      const p = waitForChair(s);
      force(p, ct);
      const a = sim.beginHandsOn(s, p.id);
      const b = sim.beginHandsOn(s, p.id);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.caseType).toBe(ct);
      expect(a.service).toBe(serviceFor(ct));
      expect(a.firstOfCase).toBe(true);
      const present = new Set(Array.from({ length: 28 }, (_, i) => i).filter((i) => !a.missingTeeth.includes(i)));
      expect(new Set(a.problemTeeth).size).toBe(a.problemTeeth.length);
      for (const t of a.problemTeeth) expect(present.has(t), `tooth ${t} is missing`).toBe(true);
      if (ct === 'whitening') {
        expect(a.problemTeeth.length).toBeGreaterThanOrEqual(4);
        expect(a.problemTeeth.length).toBeLessThanOrEqual(6);
        for (const t of a.problemTeeth) expect(t % 14 >= 4 && t % 14 <= 9).toBe(true);
        expect(a.special.startShade).toBeGreaterThanOrEqual(11);
        expect(a.special.startShade).toBeLessThanOrEqual(15);
        expect(a.special.targetShade).toBeGreaterThanOrEqual(1);
        expect(a.special.startShade - a.special.targetShade).toBeGreaterThanOrEqual(6);
      } else {
        expect(a.problemTeeth.length).toBe(Math.min(problemToothCount(5), present.size - (a.special.goldTooth != null ? 1 : 0)));
        expect(a.special.startShade).toBe(0);
      }
      if (ct === 'braces') { expect(a.special.braces).toBe(true); for (const t of a.problemTeeth) expect(t % 14 >= 2 && t % 14 <= 11).toBe(true); }
      else expect(a.special.braces).toBe(false);
      if (ct === 'pirate') {
        expect(a.missingTeeth.length).toBeGreaterThanOrEqual(3);
        expect(a.missingTeeth.length).toBeLessThanOrEqual(6);
        expect(a.special.goldTooth).not.toBeNull();
        expect(present.has(a.special.goldTooth!)).toBe(true);
        expect(a.problemTeeth).not.toContain(a.special.goldTooth);
        expect(a.special.barnacles).toBeGreaterThanOrEqual(3);
        expect(a.special.seaweed).toBeGreaterThanOrEqual(2);
        if (a.special.treasure) expect(a.bonus).toBe('treasure');
      } else {
        expect(a.special.goldTooth).toBeNull();
        expect(a.special.treasure).toBe(false);
        expect(a.bonus).not.toBe('treasure');
      }
      if (ct === 'candy') { expect(a.special.sugarBugs).toBe(Math.min(8, 3 + Math.floor(5 / 2))); expect(a.special.sealants).toBe(4); }
      if (ct === 'deep') { expect(a.special.pockets).toBeGreaterThanOrEqual(2); expect(a.dirt.tartarSize).toBe(1.2); }
      expect(a.bonus).not.toBeNull();
      expect(a.parSeconds).toBeGreaterThan(20);
      expect(a.dirt.plaque).toBeGreaterThanOrEqual(0);
      expect(a.dirt.plaque).toBeLessThanOrEqual(1);
      expect(a.dirt.stain).toBeLessThanOrEqual(1);
      expect(a.traits.chatty).toBe(a.twists.includes('chatty'));
      expect(a.traits.gag).toBe(a.twists.includes('gagger'));
      expect(a.traits.fidget > 0).toBe(a.twists.includes('fidget'));
      // after the first clean of this case the intro is no longer "new"
      sim.completeHandsOn(s, p.id, result(0.85, { caseType: ct }));
      const q = waitForChair(s);
      force(q, ct);
      expect(sim.beginHandsOn(s, q.id).firstOfCase).toBe(false);
    });
  }

  it('routine grows with level and level 1 is light (about one chunk per marked tooth)', () => {
    const s = graduated(50);
    s.player.level = 1;
    const p = waitForChair(s);
    force(p, 'routine');
    const a = sim.beginHandsOn(s, p.id);
    expect(a.problemTeeth.length).toBe(4);
    expect(a.dirt.tartarCount).toBe(4);
    expect(a.dirt.plaque).toBeCloseTo(0.5, 5);
    expect(a.twists.length).toBeLessThanOrEqual(1);
  });

  it('school practicals are routine cases on marked teeth only, practical 1 lighter', () => {
    const s = sim.newGame({ name: 'x', avatar: 0, seed: 9, nowMs: 0 });
    const a = sim.schoolSetup(s, 1);
    const b = sim.schoolSetup(s, 2);
    for (const x of [a, b]) {
      expect(x.caseType).toBe('routine');
      expect(x.twists).toEqual([]);
      expect(x.bonus).toBeNull();
      expect(x.firstOfCase).toBe(false);
      expect(x.problemTeeth.length).toBe(4);
      expect(x.missingTeeth).toEqual([]);
    }
    expect(a.tutorial).toBe(true);
    expect(a.dirt.tartarCount).toBeLessThan(b.dirt.tartarCount);
  });
});

describe('mastery and quick clean (DESIGN 5.9)', () => {
  it('3+ star hands-on cleans count toward the case; tiers at 3, 10 and 25', () => {
    const s = graduated(60);
    const p = waitForChair(s);
    force(p, 'routine');
    sim.beginHandsOn(s, p.id);
    const low = sim.completeHandsOn(s, p.id, result(0.5));   // 2 stars: no credit
    expect(low.payout.mastery).toEqual({ caseType: 'routine', count: 0, tier: 0, tierUp: false });
    s.player.mastery.routine = MASTERY_TIERS[0] - 1;
    const q = waitForChair(s);
    force(q, 'routine');
    sim.beginHandsOn(s, q.id);
    const up = sim.completeHandsOn(s, q.id, result(0.8));
    expect(up.payout.mastery).toEqual({ caseType: 'routine', count: 3, tier: 1, tierUp: true });
    expect(up.payout.lines.some((l) => l.startsWith('Bronze mastery'))).toBe(true);
    expect(sim.caseMastery(s, 'routine')).toEqual({ count: 3, tier: 1, next: 10 });
    s.player.mastery.routine = 25;
    expect(sim.caseMastery(s, 'routine')).toEqual({ count: 25, tier: 3, next: null });
  });

  it('silver pays +10%, gold tips +20%', () => {
    const pay = (count: number) => {
      const s = graduated(61);
      s.player.mastery.routine = count;
      const p = waitForChair(s);
      force(p, 'routine');
      p.archetype = 'regular';
      sim.beginHandsOn(s, p.id);
      return sim.completeHandsOn(s, p.id, result(0.9, { seconds: 1000 })).payout;
    };
    const base = pay(0);
    const silver = pay(10);
    const gold = pay(25);
    expect(silver.pay).toBe(Math.round(base.pay * 1.1));
    expect(silver.tip).toBe(base.tip);
    expect(base.tip).toBe(Math.round(120 * 0.1 * 0.75));
    expect(gold.tip).toBe(Math.round(120 * 0.1 * 0.75 * 1.2));
  });

  it('quick clean is locked until Bronze and changes nothing when locked', () => {
    const s = graduated(62);
    const p = waitForChair(s);
    const st = sim.quickCleanStatus(s, p.id);
    expect(st).toEqual({ ok: false, count: 0, need: 3 });
    const before = JSON.stringify(s);
    const r = sim.quickClean(s, p.id);
    expect(r.payout.pay).toBe(0);
    expect(r.events).toEqual([]);
    expect(JSON.stringify(s)).toBe(before);
    s.player.mastery[p.caseType] = 3;
    expect(sim.quickCleanStatus(s, p.id).ok).toBe(true);
  });

  it('quick clean pays half the wage, no tip, no XP, no mastery, streak or goals, and only once', () => {
    const s = graduated(63);
    const p = waitForChair(s);
    s.player.mastery[p.caseType] = 3;
    s.stats.fiveStarStreak = 3;
    const xp = s.player.xp;
    const goals = JSON.stringify(s.goals.map((g) => g.progress));
    const cash = s.cash;
    const r = sim.quickClean(s, p.id);
    const aq = sim.autoQuality(s);
    expect(r.payout.pay).toBe(Math.round(employeeRate(s.player.level) * (0.4 + 0.8 * aq) * CASES[p.caseType].payMult * 0.5));
    expect(r.payout.tip).toBe(0);
    expect(r.payout.xp).toBe(0);
    expect(r.payout.mastery).toBeNull();
    expect(s.player.xp).toBe(xp);
    expect(s.player.mastery[p.caseType]).toBe(3);
    expect(s.stats.fiveStarStreak).toBe(3);
    expect(JSON.stringify(s.goals.map((g) => g.kind === 'served' ? g.progress : g.progress))).toBe(goals);
    expect(s.stats.quickCleans).toBe(1);
    const paid = s.cash - cash;
    // a second click on the same patient (or a stale Clean) pays nothing
    const again = sim.quickClean(s, p.id);
    expect(again.payout.pay).toBe(0);
    const late = sim.completeHandsOn(s, p.id, result(0.9));
    expect(late.payout.pay).toBe(0);
    expect(() => sim.beginHandsOn(s, p.id)).toThrow('This patient is not ready yet');
    expect(s.stats.quickCleans).toBe(1);
    expect(paid).toBeGreaterThanOrEqual(r.payout.pay);
  });

  it('owner phase: quick clean also needs Bronze; autopilot earns no XP', () => {
    const s = owner(64);
    const p = waitForChair(s);
    expect(sim.quickClean(s, p.id).payout.pay).toBe(0);
    s.player.mastery[p.caseType] = 3;
    const r = sim.quickClean(s, p.id);
    expect(r.payout.pay).toBeGreaterThan(0);
    expect(r.payout.xp).toBe(0);
    sim.closeDay(s);
    const op = s.locations[0].ops[0];
    sim.setPlayerMode(s, 0, op.id, 'auto');
    const xp0 = s.player.xp + s.player.level * 1e6;
    let guard = 0;
    while (!s.dayOver && guard++ < 5000) sim.tick(s, 3);
    expect(s.player.xp + s.player.level * 1e6).toBe(xp0);   // only your own chair works: no XP at all
  });

  it('employees cannot put their chair on autopilot', () => {
    const s = graduated(65);
    const r = sim.setPlayerMode(s, -1, s.employer!.ops[0].id, 'auto');
    expect(r.ok).toBe(false);
  });
});

describe('treasure, bonus and the owner on the floor', () => {
  it('finding the doubloon pays a treasure bonus that grows with level', () => {
    const s = graduated(70);
    s.player.level = 3;
    const p = waitForChair(s);
    force(p, 'pirate');
    sim.beginHandsOn(s, p.id);
    const cash = s.cash;
    const r = sim.completeHandsOn(s, p.id, result(0.85, { treasure: true, caseType: 'pirate' }));
    expect(r.payout.treasure).toBe(treasureBonus(3));
    expect(treasureBonus(3)).toBe(30 + 10 * 3);
    expect(s.ledger.some((e) => e.label === 'Treasure' && e.amount === treasureBonus(3))).toBe(true);
    expect(s.cash - cash).toBe(r.payout.pay + r.payout.tip + r.payout.bonus + r.payout.treasure);
    // no treasure outside a pirate case
    const q = waitForChair(s);
    force(q, 'routine');
    sim.beginHandsOn(s, q.id);
    expect(sim.completeHandsOn(s, q.id, result(0.85, { treasure: true })).payout.treasure).toBe(0);
  });

  it('a met bonus raises the tip by 25%', () => {
    const tip = (met: boolean) => {
      const s = graduated(71);
      const p = waitForChair(s);
      force(p, 'routine');
      p.archetype = 'regular';
      sim.beginHandsOn(s, p.id);
      return sim.completeHandsOn(s, p.id, result(0.95, { bonusMet: met, seconds: 1000 })).payout.tip;
    };
    expect(tip(true)).toBe(Math.round(120 * 0.1 * (0.35 / 0.4) * 1.25));
    expect(tip(false)).toBe(Math.round(120 * 0.1 * (0.35 / 0.4)));
  });

  it('an owner hands-on clean lifts next-day demand and its review counts double', () => {
    const s = owner(72);
    const c = s.locations[0];
    const p = waitForChair(s);
    sim.beginHandsOn(s, p.id);
    const before = c.reviews.length;
    sim.completeHandsOn(s, p.id, result(0.95));
    const rv = c.reviews.slice(before).find((r) => r.name === p.name);
    expect(rv).toBeTruthy();
    expect(rv!.weight).toBe(2);
    expect((c as { bossCleans?: number }).bossCleans).toBe(1);
    sim.closeDay(s);
    expect((c as { bossCleans?: number }).bossCleans).toBe(0);
  });
});

describe('QA fixes (out/fix/sim.md)', () => {
  it('an office nobody can staff books nobody and has no walk-ins', () => {
    const s = owner(80, 600000);
    sim.moveOffice(s, 0, 't2', 0);
    expect(sim.openLocation(s, 't2', 'Empty', 0).ok).toBe(true);
    const c = s.locations[1];
    const ev: SimEvent[] = [];
    let guard = 0;
    while (!s.dayOver && guard++ < 5000) {
      const q = sim.playerQueue(s);
      if (q.length) { sim.beginHandsOn(s, q[0].id); ev.push(...sim.completeHandsOn(s, q[0].id, result(0.9)).events); continue; }
      ev.push(...sim.tick(s, 3));
    }
    expect(c.day.booked).toBe(0);
    expect(c.day.walkouts).toBe(0);
    expect(c.reviews.length).toBe(0);
    sim.closeDay(s);
    expect(c.patients.filter((p) => p.state !== 'noshow').length).toBe(0);
    expect(c.day.turnedAway).toBe(c.day.demand);
  });

  it('prices lock at booking: dropping the price at close and raising it by day does not pay', () => {
    const s = owner(81);
    sim.setPrice(s, 0, 'cleaning', 0.7);
    sim.closeDay(s);
    sim.setPrice(s, 0, 'cleaning', 1.5);
    s.player.mastery = { routine: 3, candy: 3, whitening: 3, braces: 3, pirate: 3, deep: 3 };
    playDay(s, 'quick');
    for (const p of s.locations[0].patients) {
      if (p.state !== 'gone' || p.walkIn || p.fee === 0) continue;
      if (p.service === 'cleaning' && p.addons.length === 0) expect(p.fee).toBe(Math.round(120 * 0.7));
    }
  });

  it('operating net leaves out goal rewards and offline credit, and the report carries its events', () => {
    const s = owner(82);
    playDay(s, 'hands');
    s.goals[0].done = true;
    s.goals[0].progress = s.goals[0].target;
    const rep = sim.closeDay(s);
    const goal = rep.income.find((l) => l.label === 'Goal rewards')?.amount ?? 0;
    expect(goal).toBeGreaterThan(0);
    const nonOp = [...rep.income.map((l) => l), ...rep.expenses.map((l) => ({ label: l.label, amount: -l.amount }))]
      .filter((l) => NON_OPERATING_LABELS.has(l.label)).reduce((a, l) => a + l.amount, 0);
    expect(rep.operatingNet).toBe(rep.net - nonOp);
    expect(Array.isArray(rep.events)).toBe(true);
    expect(s.reports[s.reports.length - 1].events).toBeUndefined();
  });

  it('overdraft: interest, no loan payment, no debt-free achievement while broke', () => {
    const s = owner(83, 5000, 5);
    s.loan = 3000;
    grant(s, -s.cash - 5000);
    playDay(s, 'hands');
    const loan = s.loan;
    const rep = sim.closeDay(s);
    expect(s.cash).toBeLessThan(0);
    expect(rep.expenses.some((l) => l.label === 'Overdraft interest')).toBe(true);
    expect(rep.expenses.some((l) => l.label === 'Loan payment')).toBe(false);
    expect(s.loan).toBe(loan);
    expect(s.flags.debtFree).toBeFalsy();
    expect(s.cash).toBe(ledgerSum(s));
  });

  it('candidates stay on the board until they expire; the board tops up to six', () => {
    const s = owner(84);
    const ids = s.candidates.map((c) => c.id);
    sim.closeDay(s);
    expect(s.candidates.length).toBe(6);
    expect(s.candidates.filter((c) => ids.includes(c.id)).length).toBe(6);
    sim.closeDay(s);
    expect(s.candidates.filter((c) => ids.includes(c.id)).length).toBe(0);
  });

  it('training: the skill gain arrives when the course ends', () => {
    const s = owner(85);
    const h = s.candidates.find((x) => x.role === 'hygienist') ?? s.candidates[0];
    sim.hire(s, h.id, 0);
    const st = s.locations[0].staff[0];
    const skill = st.skill;
    expect(sim.train(s, 0, st.id).ok).toBe(true);
    expect(st.skill).toBe(skill);
    expect(st.offFrom).toBe(s.day + 1);
    sim.closeDay(s);
    expect(st.skill).toBe(skill);
    sim.closeDay(s);
    expect(st.skill).toBe(Math.min(99, skill + 8));
  });

  it('a Fish Tank adds 0.1 to the rating at once', () => {
    const s = owner(86, 20000);
    const c = s.locations[0];
    for (let i = 0; i < 40; i++) c.reviews.push({ day: 1, name: 'a', archetype: 'regular', stars: 4, weight: 1, text: '' });
    c.rating = 3.94;
    sim.buyEquipment(s, 0, 'fishTank');
    expect(c.rating).toBeCloseTo((3.5 * 3 + 160) / 43 + 0.1, 2);
  });

  it('hired hygienists take patients before your hands-on chair', () => {
    const s = owner(87, 30000);
    const c = s.locations[0];
    sim.buyOperatory(s, 0);
    const h = s.candidates.find((x) => x.role === 'hygienist') ?? s.candidates[0];
    if (h.role !== 'hygienist') return;
    sim.hire(s, h.id, 0);
    sim.closeDay(s);
    let npcIdleWhileWaiting = 0;
    let guard = 0;
    while (!s.dayOver && guard++ < 3000) {
      sim.tick(s, 2);
      const waitingForMe = c.patients.some((p) => p.state === 'inChair' && p.awaitingPlayer);
      const npcFree = c.ops.some((o) => o.staffId === h.id && o.patientId == null);
      const someoneWaiting = c.patients.some((p) => p.state === 'waiting');
      if (waitingForMe && npcFree && someoneWaiting) npcIdleWhileWaiting++;
      const q = sim.playerQueue(s);
      if (q.length && guard % 3 === 0) { sim.beginHandsOn(s, q[0].id); sim.completeHandsOn(s, q[0].id, result(0.9)); }
    }
    expect(npcIdleWhileWaiting).toBe(0);
  });

  it('owner goals you cannot finish off the floor are not drawn', () => {
    const s = owner(88);
    sim.assignHygienist(s, 0, s.locations[0].ops[0].id, null);
    for (let d = 0; d < 12; d++) {
      sim.closeDay(s);
      for (const g of s.goals) expect(['served', 'fiveStars', 'addons']).toContain(g.kind);
    }
  });

  it('a new owner alone in the chair loses nobody to the fast-forward', () => {
    let walkouts = 0;
    let served = 0;
    for (const seed of [93, 94, 95]) {
      const s = owner(seed, 20000, 5);
      for (let d = 0; d < 4; d++) {
        sim.closeDay(s);
        playDay(s, 'hands', 0.85);
        walkouts += s.locations[0].day.walkouts;
        served += s.locations[0].day.served;
      }
    }
    expect(served).toBeGreaterThan(60);
    expect(walkouts).toBe(0);
  });

  it('overwork counts chair minutes: a busy hygienist with an assistant keeps their morale', () => {
    const s = owner(96, 30000);
    const h = s.candidates.find((x) => x.role === 'hygienist') ?? s.candidates[0];
    sim.hire(s, h.id, 0);
    const st = s.locations[0].staff[0] as typeof s.locations[0]['staff'][number] & { workMin?: number };
    st.salary = st.ask;
    st.traits = [];
    st.morale = 60;
    st.patientsToday = 11;
    st.workMin = 440;
    sim.closeDay(s);
    expect(st.morale).toBeGreaterThanOrEqual(60);
    st.patientsToday = 11;
    st.workMin = 470 + 90;
    const m = st.morale;
    sim.closeDay(s);
    expect(st.morale).toBe(Math.min(100, m + 2 - 6));
  });

  it('owner hints put staffing before the skill point', () => {
    const o = owner(97);
    o.player.skillPoints = 2;
    expect(sim.nextHint(o)).toMatch(/^Hire a (receptionist|hygienist)/);
  });

  it('turned-away notes use the right plural', () => {
    const s = owner(89);
    s.locations[0].day.turnedAway = 1;
    s.dayOver = true;
    const rep = sim.closeDay(s);
    expect(rep.notes.some((n) => n.endsWith(': 1 patient turned away'))).toBe(true);
  });
});

describe('saves', () => {
  it('v2 fields survive the save codec; old saves are migrated', () => {
    const s = graduated(90);
    playDay(s, 'hands');
    s.player.mastery.routine = 4;
    expect(decodeSave(encodeSave(s))).toEqual(s);
    const old = JSON.parse(JSON.stringify(s));
    delete old.player.mastery;
    for (const p of old.employer.patients) { delete p.caseType; delete p.twists; }
    const m = sim.migrate(old);
    expect(m.player.mastery).toEqual({});
    for (const p of m.employer!.patients) { expect(p.caseType).toBe('routine'); expect(p.twists).toEqual([]); }
    sim.closeDay(m);
    playDay(m, 'hands');
  });

  it('migrate repairs damaged saves instead of crashing or looping', () => {
    const o = owner(91);
    const a = JSON.parse(JSON.stringify(o));
    a.player.skills = null;
    a.player.extras = 'x';
    a.locations[0].tier = 't9';
    a.locations[0].staff = null;
    const ma = sim.migrate(a);
    expect(ma.player.skills).toEqual([]);
    expect(ma.player.extras).toEqual([]);
    expect(ma.locations[0].tier).toBe('t1');
    expect(sim.forecast(ma, 0).capacity).toBeGreaterThan(0);
    const b = JSON.parse(JSON.stringify(o));
    b.locations = [];
    const mb = sim.migrate(b);
    expect(mb.phase).toBe('employee');
    expect(mb.employer).not.toBeNull();
    expect(mb.employer!.patients.some((p) => p.isPlayerPatient)).toBe(true);
    const c = JSON.parse(JSON.stringify(graduated(92)));
    c.employer = null;
    const mc = sim.migrate(c);
    expect(mc.employer!.patients.length).toBeGreaterThan(0);
    sim.tick(mc, 5);
    expect(mc.dayOver).toBe(false);
  });
});
