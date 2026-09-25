// Raise requests and pay policy (DESIGN 8.5), campaigns bought after the doors open (10.9), the perk offer
// hook and settings migration. Owner request: "make them ask for raises less".
import { describe, expect, it } from 'vitest';
import * as sim from '../src/sim/index';
import type { GameState, SimEvent, Staff } from '../src/core/types';
import { OFFICES, TIER_ORDER } from '../src/data/offices';
import { CAMPAIGNS, PERKS } from '../src/data/manager';
import { graduated, grant, ledgerSum, nonFinite, result } from './sim.helpers';
import {
  AUTO_RAISE_MAX, LEVEL_ASK, LEVEL_ASK_MAX, RAISE_CONTENT, RAISE_COOLDOWN, askFor, makeStaff, staffDaily,
} from '../src/sim/staff';
import { withRng, type SimClinic, type SimStaff } from '../src/sim/internal';
import { modActive, modAgg } from '../src/sim/effects';
import { demandLambda } from '../src/sim/booking';

// ------------------------------------------------------------------ helpers

function ownerT2(seed: number, crew: Staff['role'][] = ['receptionist', 'assistant']): GameState {
  const s = graduated(seed);
  grant(s, 3_000_000);
  s.player.level = 8;
  expect(sim.openPractice(s, { name: 'Raise Dental', loan: 0 }).ok).toBe(true);
  sim.closeDay(s);
  sim.completeHuddle(s);
  expect(sim.moveOffice(s, 0, TIER_ORDER[1], 0).ok).toBe(true);
  const c = s.locations[0];
  while (c.ops.length < OFFICES[c.tier].opSlots) expect(sim.buyOperatory(s, 0).ok).toBe(true);
  for (const op of c.ops) op.staffId = null;
  c.staff = [];
  for (const op of c.ops) addStaff(s, 'hygienist', op.id);
  for (const role of crew) addStaff(s, role);
  s.minute = 480;
  s.dayOver = false;
  s.huddleDay = s.day - 1;
  s.pendingEvents = [];
  for (const x of s.locations) (x as SimClinic).startRatingDay = undefined;
  expect(sim.setFocus(s, s.focus).ok).toBe(true);
  return s;
}

function addStaff(s: GameState, role: Staff['role'], opId?: string, traits: Staff['traits'] = []): SimStaff {
  const c = s.locations[0];
  const st = withRng(s, (rng) => makeStaff(s, rng, role, 0, { skill: 60, speed: 60, bedside: 60, traits })) as SimStaff;
  c.staff.push(st);
  if (opId) c.ops.find((o) => o.id === opId)!.staffId = st.id;
  if (role === 'assistant') { const op = c.ops.find((o) => !o.assistantId); if (op) op.assistantId = st.id; }
  return st;
}

function runDay(s: GameState): SimEvent[] {
  const ev: SimEvent[] = [];
  sim.completeHuddle(s);
  let g = 0;
  while (!s.dayOver && g++ < 20000) {
    const q = sim.playerQueue(s);
    if (q.length) { const setup = sim.beginHandsOn(s, q[0].id); sim.completeHandsOn(s, q[0].id, result(0.85, { caseType: setup.caseType })); continue; }
    ev.push(...sim.tick(s, 3));
  }
  expect(s.dayOver).toBe(true);
  return ev;
}

/** One staff close (morale, levels, raises) with the events it raises. */
function close(s: GameState): SimEvent[] {
  const ev: SimEvent[] = [];
  const S = s as GameState & { dayNotes?: string[] };
  S.dayNotes = [];
  withRng(s, (rng) => staffDaily(s, ev, rng));
  return ev;
}
const notes = (s: GameState) => (s as GameState & { dayNotes?: string[] }).dayNotes ?? [];
const raises = (ev: SimEvent[]) => ev.filter((e) => e.type === 'raiseRequest');
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

// ------------------------------------------------------------------ requests

describe('raise requests (DESIGN 8.5)', () => {
  it('a level-up asks only below 95% of the ask, and at most once per 10 working days', () => {
    const s = ownerT2(301);
    const h = s.locations[0].staff.find((x) => x.role === 'hygienist') as SimStaff;
    h.hiredDay = s.day - RAISE_COOLDOWN;   // past the new-hire quiet period
    // one level-up from a salary at the ask stays within 5%: no request
    expect(1 / LEVEL_ASK).toBeGreaterThanOrEqual(RAISE_CONTENT);
    h.xp = 25;
    expect(raises(close(s))).toEqual([]);
    expect(h.level).toBe(2);
    expect(h.salary).toBeGreaterThanOrEqual(h.ask * RAISE_CONTENT);
    // the second level-up drops below 95%: one request, with a note
    s.day++;
    h.xp = 50;
    const ev = close(s);
    expect(raises(ev)).toHaveLength(1);
    expect(raises(ev)[0]).toMatchObject({ staffId: h.id, ask: h.ask });
    expect(notes(s).some((n) => n.includes('asks for a raise'))).toBe(true);
    // ignored: more level-ups inside the quiet period do not ask again
    for (let d = 1; d < RAISE_COOLDOWN; d++) {
      s.day++;
      h.xp = 25 * h.level;
      expect(raises(close(s)), `day +${d}`).toEqual([]);
    }
    // the quiet period is over: the pending ask comes back once
    s.day++;
    expect(raises(close(s))).toHaveLength(1);
    s.day++;
    expect(raises(close(s))).toEqual([]);
  });

  it('new hires wait out the quiet period; a raise answers the request and restarts it', () => {
    const s = ownerT2(302);
    const h = s.locations[0].staff.find((x) => x.role === 'hygienist') as SimStaff;
    h.hiredDay = s.day;
    h.xp = 25 + 50;   // two levels on the first evening
    expect(raises(close(s))).toEqual([]);
    expect(h.level).toBe(3);
    expect(h.raiseDue).toBe(true);
    // the owner raises the salary before the quiet period ends: nothing left to ask
    expect(sim.setSalary(s, 0, h.id, h.ask).ok).toBe(true);
    expect(h.raiseDue).toBeUndefined();
    expect(h.raiseDay).toBe(s.day);
    for (let d = 0; d < RAISE_COOLDOWN + 2; d++) { s.day++; expect(raises(close(s))).toEqual([]); }
  });

  it('never while paid at 95% of the ask or more; temporary staff never ask', () => {
    const s = ownerT2(303);
    const c = s.locations[0];
    const h = c.staff.find((x) => x.role === 'hygienist') as SimStaff;
    h.hiredDay = s.day - 30;
    h.xp = 25 + 50;
    const ask = Math.round(Math.round(h.ask * LEVEL_ASK) * LEVEL_ASK);
    h.salary = Math.ceil(ask * RAISE_CONTENT);
    expect(raises(close(s))).toEqual([]);
    expect(h.ask).toBe(ask);
    const t = addStaff(s, 'hygienist');
    t.tempUntilDay = s.day + 5;
    t.salary = 0;
    t.ask = 0;
    t.hiredDay = s.day - 30;
    t.xp = 25 + 50;
    t.traits = ['ambitious'];
    expect(raises(close(s))).toEqual([]);
    expect(t.salary).toBe(0);
  });

  it('a skill event raises the ask in the morning; the request is settled at the close', () => {
    const s = ownerT2(304);
    const c = s.locations[0];
    const hyg = c.staff.filter((x) => x.role === 'hygienist') as SimStaff[];
    for (const x of hyg) { x.hiredDay = s.day - 30; x.ask = askFor('hygienist', x); x.salary = Math.round(x.ask * 0.97); }
    // Dental Expo: the best hygienist gets +10 skill
    s.pendingEvents.push({ eventId: 'expo', clinicId: c.id, day: s.day, vars: { clinic: c.name } });
    const ev: SimEvent[] = [];
    sim.resolveEvent(s, s.pendingEvents.length - 1, 0);
    const best = hyg.slice().sort((a, b) => b.skill - a.skill)[0];
    expect(best.raiseDue).toBe(true);
    ev.push(...runDay(s));
    expect(raises(ev)).toEqual([]);   // nothing mid-day
    const rep = sim.closeDay(s);
    const req = (rep.events ?? []).filter((e) => e.type === 'raiseRequest');
    expect(req.map((e) => (e as { staffId: string }).staffId)).toContain(best.id);
  });

  it('a course raises the ask when it ends; one request at that close', () => {
    const s = ownerT2(305);
    const h = s.locations[0].staff.find((x) => x.role === 'hygienist') as SimStaff;
    h.hiredDay = s.day - 30;
    h.ask = askFor('hygienist', h);
    h.salary = Math.round(h.ask * 0.97);
    h.courseGain = 8;
    h.offFrom = s.day;
    h.offUntilDay = s.day;
    const ev = close(s);
    expect(h.ask).toBeGreaterThan(h.salary / RAISE_CONTENT);
    expect(raises(ev)).toHaveLength(1);
    expect(notes(s).some((n) => n.includes('finished the course'))).toBe(true);
  });
});

// ------------------------------------------------------------------ pay policy

describe('pay policy: auto raises (DESIGN 8.5)', () => {
  it('settings.autoRaise approves asks up to +15% at the close, with a report note and no event', () => {
    const s = ownerT2(311);
    s.settings.autoRaise = true;
    const h = s.locations[0].staff.find((x) => x.role === 'hygienist') as SimStaff;
    h.hiredDay = s.day;   // auto raises do not wait for the quiet period
    const salary0 = h.salary;
    h.xp = 25 + 50;
    const ev = close(s);
    expect(raises(ev)).toEqual([]);
    expect(h.salary).toBe(h.ask);
    expect(h.ask / salary0).toBeLessThanOrEqual(1 + AUTO_RAISE_MAX);
    const first = h.name.split(' ')[0];
    expect(notes(s)).toContain(`Auto raise: ${first} +$${h.ask - salary0}`);
    // the note reaches the day report
    const t = ownerT2(312);
    t.settings.autoRaise = true;
    const x = t.locations[0].staff.find((y) => y.role === 'hygienist') as SimStaff;
    x.xp = 25 + 50;
    runDay(t);
    const rep = sim.closeDay(t);
    expect(rep.notes.some((n) => /^Auto raise: \S+ \+\$\d+$/.test(n))).toBe(true);
    expect((rep.events ?? []).filter((e) => e.type === 'raiseRequest')).toEqual([]);
  });

  it('teammates who share a first name get their full names in the note', () => {
    const s = ownerT2(317);
    s.settings.autoRaise = true;
    const [a, b] = s.locations[0].staff.filter((x) => x.role === 'hygienist') as SimStaff[];
    a.name = 'Ava Park';
    b.name = 'Ava Silva';
    for (const x of [a, b]) { x.ask = 400; x.salary = 400; x.xp = 25 + 50; }
    close(s);
    const gain = Math.round(Math.round(400 * LEVEL_ASK) * LEVEL_ASK) - 400;
    expect(notes(s)).toContain(`Auto raise: Ava Park +$${gain}`);
    expect(notes(s)).toContain(`Auto raise: Ava Silva +$${gain}`);
  });

  it('asks above +15% still go to the owner (quiet period applies)', () => {
    const s = ownerT2(313);
    s.settings.autoRaise = true;
    const h = s.locations[0].staff.find((x) => x.role === 'hygienist') as SimStaff;
    h.hiredDay = s.day - 30;
    h.salary = Math.round(h.ask * 0.8);   // the owner underpays on purpose
    const salary0 = h.salary;
    h.xp = 25;
    const ev = close(s);
    expect(raises(ev)).toHaveLength(1);
    expect(h.salary).toBe(salary0);
    expect(notes(s).some((n) => n.startsWith('Auto raise'))).toBe(false);
  });

  it('auto raises wait while cash is below zero, then go through', () => {
    const s = ownerT2(315);
    s.settings.autoRaise = true;
    const h = s.locations[0].staff.find((x) => x.role === 'hygienist') as SimStaff;
    h.hiredDay = s.day - 30;
    const salary0 = h.salary;
    h.xp = 25 + 50;
    grant(s, -s.cash - 500);
    expect(s.cash).toBeLessThan(0);
    expect(raises(close(s))).toEqual([]);
    expect(h.salary).toBe(salary0);
    expect(h.raiseDue).toBe(true);
    grant(s, 5000);
    s.day++;
    expect(raises(close(s))).toEqual([]);
    expect(h.salary).toBe(h.ask);
    expect(notes(s).some((n) => n.startsWith('Auto raise'))).toBe(true);
  });

  it('a veteran past level 10 keeps growing but stops raising the ask', () => {
    const s = ownerT2(316);
    const h = s.locations[0].staff.find((x) => x.role === 'hygienist') as SimStaff;
    h.level = LEVEL_ASK_MAX;
    h.hiredDay = s.day - 30;
    const ask0 = h.ask;
    const skill0 = h.skill;
    h.xp = 25 * LEVEL_ASK_MAX;
    expect(raises(close(s))).toEqual([]);
    expect(h.level).toBe(LEVEL_ASK_MAX + 1);
    expect(h.ask).toBe(ask0);
    expect(h.skill).toBe(Math.min(99, skill0 + 3));
    expect(h.raiseDue).toBeUndefined();
  });

  it('an Office Manager handles the raises at their location without the setting', () => {
    const s = ownerT2(314, ['receptionist', 'manager']);
    expect(s.settings.autoRaise).toBe(false);
    const c = s.locations[0];
    const staff = c.staff.filter((x) => x.role !== 'manager') as SimStaff[];
    for (const x of staff) { x.hiredDay = s.day - 30; x.xp = 25 + 50; }
    const ev = close(s);
    expect(raises(ev)).toEqual([]);
    for (const x of staff) expect(x.salary).toBe(x.ask);
    expect(notes(s).filter((n) => n.startsWith('Auto raise')).length).toBe(staff.length);
  });
});

// ------------------------------------------------------------------ frequency

describe('raise frequency (owner request)', () => {
  it('30 owner days at T2 with 6 new staff: well under one request a day, none with auto raises', () => {
    const run = (seed: number, auto: boolean) => {
      const s = ownerT2(seed);
      s.settings.autoRaise = auto;
      let n = 0;
      const answer = (ev: SimEvent[]) => {
        for (const e of ev) {
          if (e.type !== 'raiseRequest') continue;
          n++;
          const st = s.locations[0].staff.find((x) => x.id === e.staffId);
          if (st) expect(sim.setSalary(s, 0, st.id, st.ask).ok).toBe(true);
        }
      };
      for (let d = 0; d < 30; d++) {
        for (const st of s.locations[0].staff) if (st.pendingPerks?.length) sim.pickPerk(s, 0, st.id, st.pendingPerks[0]);
        answer(runDay(s));
        answer(sim.closeDay(s).events ?? []);
      }
      expect(nonFinite(s)).toEqual([]);
      expect(s.cash).toBe(ledgerSum(s));
      return n / 30;
    };
    const perDay = [321, 322, 323].map((seed) => run(seed, false));
    for (const r of perDay) expect(r).toBeLessThanOrEqual(0.45);
    expect(perDay.reduce((a, b) => a + b, 0) / perDay.length).toBeLessThan(0.4);
    expect(run(324, true)).toBe(0);
  });
});

// ------------------------------------------------------------------ campaigns after the doors open

describe('campaigns bought after the doors open start tomorrow (DESIGN 10.9)', () => {
  it('the modifier id carries the start day and applies from that day', () => {
    const s = ownerT2(331);
    sim.completeHuddle(s);
    sim.tick(s, 60);
    const c = s.locations[0];
    const d0 = demandLambda(s, c, 1);
    const r = sim.startCampaign(s, 0, 'kidsWeek');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message).toMatch(/starts tomorrow/);
    const m = c.modifiers.find((x) => x.source === 'campaign')!;
    expect(m.id).toBe(`campaign:kidsWeek:${s.day + 1}`);
    expect(m.untilDay).toBe(s.day + CAMPAIGNS.kidsWeek.days);
    expect(c.campaign?.untilDay).toBe(m.untilDay);
    expect(modActive(s, m)).toBe(false);
    expect(modAgg(s, c).caseBoost.candy).toBeUndefined();
    expect(demandLambda(s, c, 1)).toBeCloseTo(d0, 6);
    // still "running" for the one-at-a-time rule
    expect(sim.campaignStatus(s, 0, 'bracesBonanza').ok).toBe(false);
    runDay(s);
    sim.closeDay(s);
    expect(modActive(s, m)).toBe(true);
    expect(modAgg(s, c).caseBoost.candy).toBe(CAMPAIGNS.kidsWeek.caseBoost.candy);
    // it runs its full length from the start day
    const end = m.untilDay ?? s.day;
    while (s.day <= end) { expect(modActive(s, m)).toBe(true); runDay(s); sim.closeDay(s); }
    expect(c.campaign).toBeNull();
  });

  it('bought in the morning it still starts today', () => {
    const s = ownerT2(332);
    expect(sim.startCampaign(s, 0, 'kidsWeek').ok).toBe(true);
    const m = s.locations[0].modifiers.find((x) => x.source === 'campaign')!;
    expect(m.id).toBe(`campaign:kidsWeek:${s.day}`);
    expect(modActive(s, m)).toBe(true);
  });
});

// ------------------------------------------------------------------ perk offer hook, settings

describe('offerPerks (debug hook) and settings', () => {
  it('offers two perks of the role with the level-up rules', () => {
    const s = ownerT2(341);
    const c = s.locations[0];
    const h = c.staff.find((x) => x.role === 'hygienist')!;
    const r = sim.offerPerks(s, 0, h.id);
    expect(r.ok).toBe(true);
    expect(h.pendingPerks).toHaveLength(2);
    for (const p of h.pendingPerks!) expect(PERKS[p].roles).toContain('hygienist');
    expect(new Set(h.pendingPerks).size).toBe(2);
    // an offer already waiting is kept
    const offer = [...h.pendingPerks!];
    expect(sim.offerPerks(s, 0, h.id).ok).toBe(true);
    expect(h.pendingPerks).toEqual(offer);
    expect(sim.pickPerk(s, 0, h.id, offer[0]).ok).toBe(true);
    // owned perks are not offered again
    expect(sim.offerPerks(s, 0, h.id).ok).toBe(true);
    expect(h.pendingPerks).not.toContain(offer[0]);
    // the older (state, staffId) call still works
    const rec = c.staff.find((x) => x.role === 'receptionist')!;
    expect((sim.offerPerks as unknown as (s: GameState, id: string) => { ok: boolean })(s, rec.id).ok).toBe(true);
    expect(rec.pendingPerks?.length).toBeGreaterThan(0);
    expect(sim.offerPerks(s, 0, 'nobody').ok).toBe(false);
    expect(sim.offerPerks(s, 7, h.id).ok).toBe(false);
    const t = addStaff(s, 'hygienist');
    t.tempUntilDay = s.day + 2;
    expect(sim.offerPerks(s, 0, t.id).ok).toBe(false);
  });

  it('migrate keeps autoRaise off by default and a chosen autoPause', () => {
    const s = ownerT2(351);
    const a = clone(s);
    a.settings = { autoHuddle: true, autoRaise: true, autoPause: false };
    expect(sim.migrate(a).settings).toEqual({ autoHuddle: true, autoRaise: true, autoPause: false });
    const b = clone(s) as unknown as { settings: unknown };
    b.settings = { autoHuddle: 'yes', autoRaise: 1, autoPause: 'no' };
    const mb = sim.migrate(b as unknown as GameState);
    expect(mb.settings).toEqual({ autoHuddle: false, autoRaise: false });
    expect('autoPause' in mb.settings).toBe(false);
    // raise bookkeeping survives a save round trip and bad values are dropped
    const h = s.locations[0].staff[0] as SimStaff;
    h.raiseDue = true;
    h.raiseDay = 4;
    const m = sim.migrate(clone(s));
    expect((m.locations[0].staff[0] as SimStaff).raiseDue).toBe(true);
    expect((m.locations[0].staff[0] as SimStaff).raiseDay).toBe(4);
    const bad = clone(s);
    (bad.locations[0].staff[0] as unknown as Record<string, unknown>).raiseDay = 'soon';
    (bad.locations[0].staff[0] as unknown as Record<string, unknown>).raiseDue = 'yes';
    const mm = sim.migrate(bad).locations[0].staff[0] as SimStaff;
    expect(mm.raiseDay).toBeUndefined();
    expect(mm.raiseDue).toBeUndefined();
  });

  it('a new game starts with auto raises off', () => {
    const s = sim.newGame({ name: 'A', avatar: 0, seed: 5, nowMs: 1 });
    expect(s.settings.autoRaise).toBe(false);
    expect(s.settings.autoPause).toBeUndefined();
  });
});
