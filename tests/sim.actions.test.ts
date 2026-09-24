import { describe, expect, it } from 'vitest';
import * as sim from '../src/sim/index';
import type { GameState, SimEvent } from '../src/core/types';
import { OFFICES } from '../src/data/offices';
import { TOOLS } from '../src/data/tools';
import { ACHIEVEMENTS } from '../src/data/achievements';
import { graduated, grant, ledgerSum, playDay, result } from './sim.helpers';

function owner(seed = 3, cash = 20000): GameState {
  const s = graduated(seed);
  grant(s, cash);
  s.player.level = 5;
  expect(sim.openPractice(s, { name: 'Test Dental', loan: 0 }).ok).toBe(true);
  return s;
}

function waitForChair(s: GameState): string {
  let guard = 0;
  while (!sim.playerQueue(s).length && !s.dayOver && guard++ < 2000) sim.tick(s, 1);
  const p = sim.playerQueue(s)[0];
  expect(p, 'a patient reached the player chair').toBeTruthy();
  return p.id;
}

describe('shop and skills', () => {
  it('buyTool needs the previous tier and the cash', () => {
    const s = graduated();
    grant(s, 5000);
    expect(sim.buyTool(s, 'scaler', 3).ok).toBe(false);
    expect(sim.buyTool(s, 'scaler', 1).ok).toBe(false);
    const r = sim.buyTool(s, 'scaler', 2);
    expect(r.ok).toBe(true);
    expect(s.player.tools.scaler).toBe(2);
    expect(sim.buyTool(s, 'scaler', 3).ok).toBe(true);
    const poor = graduated();
    const res = sim.buyTool(poor, 'polisher', 2);
    expect(res).toEqual({ ok: false, reason: 'Not enough cash' });
    expect(s.cash).toBe(ledgerSum(s));
    expect(s.cash).toBe(5250 - TOOLS.scaler[1].price - TOOLS.scaler[2].price);
  });

  it('extras and gel; the gel is used once per patient', () => {
    const s = graduated();
    grant(s, 2000);
    expect(sim.buyExtra(s, 'loupes').ok).toBe(true);
    expect(sim.buyExtra(s, 'loupes').ok).toBe(false);
    expect(sim.buyGel(s, 3).ok).toBe(true);
    expect(s.player.numbingGel).toBe(3);
    const id = waitForChair(s);
    const a = sim.beginHandsOn(s, id);
    const b = sim.beginHandsOn(s, id);
    expect(a.tools.numbingGel).toBe(true);
    expect(b.tools.numbingGel).toBe(true);
    expect(s.player.numbingGel).toBe(2);
    expect(a.tools.extras).toContain('loupes');
    expect(a.seed).toBe(b.seed);
    expect(a.dirt).toEqual(b.dirt);
  });

  it('skills need a point, the level and the prerequisite', () => {
    const s = graduated();
    s.player.skillPoints = 0;
    expect(sim.skillStatus(s, 'power')).toBe('available');
    expect(sim.learnSkill(s, 'power')).toEqual({ ok: false, reason: 'No skill points' });
    s.player.skillPoints = 3;
    expect(sim.skillStatus(s, 'negotiator')).toBe('locked');
    expect(sim.learnSkill(s, 'negotiator').ok).toBe(false);
    expect(sim.learnSkill(s, 'polishPro').ok).toBe(false);   // needs Power Stroke
    expect(sim.learnSkill(s, 'power').ok).toBe(true);
    s.player.level = 3;
    expect(sim.learnSkill(s, 'polishPro').ok).toBe(true);
    expect(s.player.skillPoints).toBe(1);
    expect(sim.skillStatus(s, 'power')).toBe('learned');
    const setup = sim.beginHandsOn(s, waitForChair(s));
    expect(setup.mods.scalerPower).toBe(1.25);
    expect(setup.mods.polishRadius).toBe(1.25);
  });
});

describe('employee phase', () => {
  it('shift patients go only to the player chair and wait there', () => {
    const s = graduated(8);
    const ev: SimEvent[] = [];
    let guard = 0;
    while (!sim.playerQueue(s).length && guard++ < 2000) ev.push(...sim.tick(s, 1));
    const p = sim.playerQueue(s)[0];
    expect(p.isPlayerPatient).toBe(true);
    expect(p.opId).toBe(s.employer!.ops[0].id);
    expect(ev.some((e) => e.type === 'awaitingPlayer' && e.patientId === p.id)).toBe(true);
    for (const q of s.employer!.patients) if (q.opId && q.opId !== s.employer!.ops[0].id) expect(q.isPlayerPatient).toBe(false);
    expect(sim.nextHint(s)).toBe('Patient waiting in your chair');
  });

  it('abort keeps the patient waiting in the chair with no pay and no fast-forward', () => {
    const s = graduated(9);
    const id = waitForChair(s);
    const minute = s.minute;
    const cash = s.cash;
    sim.beginHandsOn(s, id);
    const r = sim.completeHandsOn(s, id, result(0.9, { quit: 'abort' }));
    expect(r.payout.pay).toBe(0);
    expect(r.events).toEqual([]);
    expect(s.minute).toBe(minute);
    expect(s.cash).toBe(cash);
    expect(sim.playerQueue(s).map((p) => p.id)).toContain(id);
  });

  it('a comfort walkout pays nothing and leaves a 1-star review', () => {
    const s = graduated(10);
    const id = waitForChair(s);
    const cash = s.cash;
    const before = s.employer!.reviews.length;
    const r = sim.completeHandsOn(s, id, result(0.5, { quit: 'walkout', comfort: 0 }));
    expect(r.payout.pay).toBe(0);
    expect(s.cash).toBe(cash);
    expect(r.events.some((e) => e.type === 'walkout' && e.patientId === id && e.reason === 'comfort')).toBe(true);
    const name = s.employer!.patients.find((p) => p.id === id)!.name;
    const mine = s.employer!.reviews.slice(before).filter((rv) => rv.name === name);
    expect(mine.length).toBe(1);
    expect(mine[0].stars).toBe(1);
  });

  it('a hands-on clean fast-forwards 45 minutes and reports those events', () => {
    const s = graduated(11);
    const id = waitForChair(s);
    const m = s.minute;
    const r = sim.completeHandsOn(s, id, result(0.9));
    expect(s.minute).toBeCloseTo(m + 45, 5);
    expect(r.events.some((e) => e.type === 'cleaned' && e.patientId === id)).toBe(true);
    const q = sim.quickClean(s, waitForChair(s));
    expect(q.payout.tip).toBe(0);
  });

  it('shift bonus when every shift patient is seen, and ignoring the chair leads to walkouts', () => {
    const s = graduated(12);
    playDay(s, 'hands', 0.9);
    expect(s.ledger.some((e) => e.label === 'Shift bonus' && e.day === 1)).toBe(true);
    sim.closeDay(s);
    // ignore the chair all day: patients give up and walk out (x1.5 patience while seated)
    const ev: SimEvent[] = [];
    let guard = 0;
    while (!s.dayOver && guard++ < 5000) ev.push(...sim.tick(s, 2));
    expect(s.dayOver).toBe(true);
    expect(ev.filter((e) => e.type === 'walkout').length).toBeGreaterThan(0);
    expect(s.ledger.some((e) => e.label === 'Shift bonus' && e.day === 2)).toBe(false);
  });

  it('the practice needs level 4 and the down payment', () => {
    const s = graduated();
    let st = sim.practiceStatus(s);
    expect(st.ok).toBe(false);
    expect(st.reasons).toContain('Needs level 4');
    expect(st.price).toBe(OFFICES.t1.price);
    expect(st.maxLoan).toBe(Math.round(OFFICES.t1.price * 0.6));
    s.player.level = 4;
    st = sim.practiceStatus(s);
    expect(st.reasons[0]).toMatch(/^Needs \$/);
    grant(s, st.cashNeeded - s.cash);
    expect(sim.practiceStatus(s).ok).toBe(true);
    expect(sim.openPractice(s, { name: 'Mine', loan: st.maxLoan + 500 }).ok).toBe(true);
    expect(s.loan).toBe(st.maxLoan);
    expect(s.cash).toBe(0);
    expect(s.achievements).toContain('owner');
    expect(sim.title(s)).toBe('Practice Owner');
  });
});

describe('owner phase', () => {
  it('hire, assign, train, salary, fire', () => {
    const s = owner();
    const c = s.locations[0];
    const h = s.candidates.find((x) => x.role === 'hygienist') ?? s.candidates[0];
    const cash = s.cash;
    expect(sim.hire(s, h.id, 0).ok).toBe(true);
    expect(s.cash).toBe(cash - h.ask);
    expect(s.candidates.find((x) => x.id === h.id)).toBeUndefined();
    expect(s.achievements).toContain('firstHire');
    if (h.role === 'hygienist') {
      expect(c.ops.every((o) => o.staffId !== h.id)).toBe(true);   // the only op is yours
      expect(sim.buyOperatory(s, 0).ok).toBe(true);
      expect(sim.assignHygienist(s, 0, c.ops[1].id, h.id).ok).toBe(true);
      expect(c.ops[1].staffId).toBe(h.id);
      expect(sim.buyOperatory(s, 0).ok).toBe(false);   // T1 has two slots
      expect(sim.assignHygienist(s, 0, c.ops[0].id, h.id).ok).toBe(true);
      expect(c.ops[1].staffId).toBeNull();
      expect(sim.assignHygienist(s, 0, c.ops[1].id, 'player').ok).toBe(true);
      expect(c.ops[0].staffId).toBe(h.id);
      expect(c.ops.filter((o) => o.staffId === 'player').length).toBe(1);
    }
    expect(sim.train(s, 0, h.id).ok).toBe(true);
    expect(sim.train(s, 0, h.id).ok).toBe(false);
    const ask = c.staff[0].ask;
    expect(sim.setSalary(s, 0, h.id, ask * 10).ok).toBe(true);
    expect(c.staff[0].salary).toBe(Math.round(ask * 2));
    const before = s.cash;
    expect(sim.fire(s, 0, h.id).ok).toBe(true);
    expect(s.cash).toBe(before - Math.round(ask * 2));
    expect(c.staff.length).toBe(0);
    expect(c.ops.every((o) => o.staffId !== h.id)).toBe(true);
  });

  it('candidates lean toward what the office lacks', () => {
    const s = owner(4);
    let rec = 0;
    let total = 0;
    for (let d = 0; d < 6; d++) {
      rec += s.candidates.filter((c) => c.role === 'receptionist').length;
      total += s.candidates.length;
      playDay(s, 'quick');
      sim.closeDay(s);
    }
    expect(total).toBe(36);
    expect(rec / total).toBeGreaterThan(0.2);
  });

  it('a trained hygienist is off the next day only', () => {
    const s = owner(5);
    const h = s.candidates.find((x) => x.role === 'hygienist');
    if (!h) return;
    sim.buyOperatory(s, 0);
    sim.hire(s, h.id, 0);
    sim.train(s, 0, h.id);
    const st = s.locations[0].staff[0];
    playDay(s, 'quick');
    sim.closeDay(s);
    expect(st.task).toBe('off');
    playDay(s, 'quick');
    sim.closeDay(s);
    expect(st.task).not.toBe('off');
  });

  it('equipment checks the tier; chairs only upgrade', () => {
    const s = owner(6, 60000);
    expect(sim.buyEquipment(s, 0, 'breakRoom').ok).toBe(false);
    expect(sim.buyEquipment(s, 0, 'deepCert').ok).toBe(true);
    expect(sim.buyEquipment(s, 0, 'deepCert').ok).toBe(false);
    const op = s.locations[0].ops[0].id;
    expect(sim.upgradeChair(s, 0, op, 'deluxe').ok).toBe(true);
    expect(sim.upgradeChair(s, 0, op, 'comfort').ok).toBe(false);
    expect(sim.buyOpUpgrade(s, 0, op, 'tv').ok).toBe(true);
    expect(sim.buyOpUpgrade(s, 0, op, 'tv').ok).toBe(false);
  });

  it('moving trades in half the current office; new locations need a T2 office', () => {
    const s = owner(7, 60000);
    const q = sim.moveQuote(s, 0, 't2');
    expect(q.tradeIn).toBe(OFFICES.t1.price / 2);
    expect(q.net).toBe(OFFICES.t2.price - OFFICES.t1.price / 2);
    expect(q.maxLoan).toBe(Math.round(q.net * 0.6));
    expect(sim.locationQuote(s, 't2').ok).toBe(false);
    expect(sim.moveOffice(s, 0, 't2', q.maxLoan + 1).ok).toBe(false);
    expect(sim.moveOffice(s, 0, 't2', 0).ok).toBe(true);
    expect(sim.moveQuote(s, 0, 't1').ok).toBe(false);
    grant(s, 400000);
    const lq = sim.locationQuote(s, 't2');
    expect(lq.ok).toBe(true);
    expect(lq.price).toBeGreaterThan(OFFICES.t2.price);   // franchise fee
    expect(sim.openLocation(s, 't2', 'Second', 0).ok).toBe(true);
    expect(s.locations.length).toBe(2);
    expect(s.locations[1].ops[0].staffId).toBeNull();
    expect(sim.locationQuote(s, 't2').price).toBeGreaterThan(lq.price);
    sim.setActive(s, 1);
    expect(s.active).toBe(1);
    sim.setActive(s, 9);
    expect(s.active).toBe(1);
    expect(sim.activeClinic(s)).toBe(s.locations[1]);
    expect(s.achievements).toContain('chain2');
  });

  it('loans: capped, charged daily, repayable', () => {
    const s = owner(8, 6000);
    const cap = sim.maxLoan(s);
    expect(cap).toBeGreaterThan(0);
    expect(sim.takeLoan(s, cap + 1).ok).toBe(false);
    expect(sim.takeLoan(s, 5000).ok).toBe(true);
    expect(s.loan).toBe(5000);
    playDay(s, 'quick');
    const rep = sim.closeDay(s);
    expect(rep.expenses.find((l) => l.label === 'Loan interest')?.amount).toBe(Math.round(5000 * 0.0025));
    expect(rep.expenses.find((l) => l.label === 'Loan payment')?.amount).toBe(50);
    expect(s.loan).toBe(4950);
    expect(sim.repayLoan(s, 1e9).ok).toBe(true);
    expect(s.loan).toBe(0);
    expect(s.achievements).toContain('debtFree');
    expect(s.cash).toBe(ledgerSum(s));
  });

  it('prices clamp to 0.7..1.5 in 0.05 steps; marketing is charged at close', () => {
    const s = owner(9);
    sim.setPrice(s, 0, 'cleaning', 2);
    expect(s.locations[0].prices.cleaning).toBe(1.5);
    sim.setPrice(s, 0, 'cleaning', 1.123);
    expect(s.locations[0].prices.cleaning).toBe(1.1);
    sim.setMarketing(s, 0, 2);
    playDay(s, 'quick');
    const rep = sim.closeDay(s);
    expect(rep.expenses.find((l) => l.label === 'Marketing')?.amount).toBe(180);
  });

  it('the owner chair on autopilot cleans without the player', () => {
    const s = owner(10);
    const op = s.locations[0].ops[0];
    expect(sim.setPlayerMode(s, 0, op.id, 'auto').ok).toBe(true);
    let guard = 0;
    const ev: SimEvent[] = [];
    while (!s.dayOver && guard++ < 5000) {
      expect(sim.playerQueue(s)).toEqual([]);
      ev.push(...sim.tick(s, 3));
    }
    expect(ev.some((e) => e.type === 'cleaned' && e.staffId === 'player')).toBe(true);
    expect(s.stats.quickCleans).toBeGreaterThan(0);
  });

  it('offline earnings follow DESIGN 8.9 and update lastSeen', () => {
    const s = owner(11);
    const t0 = s.lastSeen;
    expect(sim.applyOffline(s, t0 + 60 * 60 * 1000)).toBeNull();   // no hygienist yet
    const h = s.candidates.find((x) => x.role === 'hygienist');
    if (!h) return;
    sim.buyOperatory(s, 0);
    sim.hire(s, h.id, 0);
    for (let d = 0; d < 3; d++) { playDay(s, 'quick'); sim.closeDay(s); }
    const now = s.lastSeen + 5 * 60 * 1000;
    expect(sim.applyOffline(s, now)).toBeNull();   // under 10 minutes
    const later = now + 4 * 3600 * 1000;
    const cash = s.cash;
    const rep = sim.applyOffline(s, later);
    expect(rep).not.toBeNull();
    expect(rep!.hours).toBeCloseTo(4, 1);
    expect(s.cash - cash).toBe(rep!.credit);
    expect(s.lastSeen).toBe(later);
    expect(s.cash).toBe(ledgerSum(s));
  });

  it('forecast and valuation are finite and sensible', () => {
    const s = owner(12);
    const f = sim.forecast(s, 0);
    expect(f.demand).toBeGreaterThan(0);
    expect(f.capacity).toBeGreaterThan(0);
    expect(f.costs).toBeGreaterThan(0);
    expect(sim.valuation(s)).toBeGreaterThan(OFFICES.t1.price * 0.6 - 1);
  });

  it('day reports: weekday advance, report cap, candidate refresh and goals', () => {
    const s = owner(13);
    const days: number[] = [];
    for (let d = 0; d < 34; d++) { playDay(s, 'quick'); days.push(sim.closeDay(s).weekday); }
    expect(days.slice(0, 7)).toEqual([0, 1, 2, 3, 4, 0, 1].map((x) => (x + days[0]) % 5));
    expect(s.reports.length).toBe(30);
    expect(s.ledger.length).toBeLessThanOrEqual(200);
    expect(s.cash).toBe(ledgerSum(s));
    expect(s.goals.length).toBe(3);
    expect(s.goalsDay).toBe(s.day);
    expect(s.candidates.length).toBe(6);
  });
});

describe('goals and achievements', () => {
  it('goal progress, claim and rewards', () => {
    const s = graduated(14);
    const g = s.goals[0];
    g.done = true;
    g.progress = g.target;
    const cash = s.cash;
    expect(sim.claimGoal(s, g.id).ok).toBe(true);
    expect(sim.claimGoal(s, g.id).ok).toBe(false);
    expect(s.cash).toBe(cash + g.rewardCash);
    expect(sim.claimGoal(s, 'nope').ok).toBe(false);
  });

  it('every achievement id exists and is awarded once', () => {
    const s = graduated(15);
    playDay(s, 'hands', 0.97);
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const a of s.achievements) expect(ids.has(a)).toBe(true);
    expect(new Set(s.achievements).size).toBe(s.achievements.length);
    expect(s.achievements).toContain('firstChunk');
    expect(s.achievements).toContain('perfect');
  });
});

describe('migrate and hints', () => {
  it('fills missing fields of an old save', () => {
    const s = owner(16);
    const old = JSON.parse(JSON.stringify(s));
    delete old.stats.fiveStarStreak;
    delete old.flags;
    delete old.goals;
    delete old.player.tools.suction;
    delete old.locations[0].prices.filling;
    delete old.locations[0].day;
    const m = sim.migrate(old);
    expect(m.stats.fiveStarStreak).toBe(0);
    expect(m.flags).toEqual({});
    expect(m.goals).toEqual([]);
    expect(m.player.tools.suction).toBe(1);
    expect(m.locations[0].prices.filling).toBe(1);
    expect(m.locations[0].day.served).toBe(0);
    playDay(m, 'quick');
    sim.closeDay(m);
  });

  it('hints are short product-voice lines without em dashes', () => {
    const states: GameState[] = [sim.newGame({ name: 'a', avatar: 0, seed: 1, nowMs: 0 }), graduated(), owner(17)];
    for (const s of states) {
      const h = sim.nextHint(s);
      expect(h.length).toBeGreaterThan(5);
      expect(h.length).toBeLessThan(60);
      expect(h).not.toMatch(/[—!]/);
    }
    expect(sim.nextHint(states[0])).toBe('Finish your practical to graduate');
    const s = graduated();
    s.player.skillPoints = 0;
    expect(sim.nextHint(s)).toBe('Floss Picks is affordable in Tools');
    s.cash = 0;
    expect(sim.nextHint(s)).toBe('Level 4 unlocks your own practice');
    const o = owner(18);
    o.player.skillPoints = 0;
    expect(sim.nextHint(o)).toMatch(/^Hire a (receptionist|hygienist)/);
  });
});
