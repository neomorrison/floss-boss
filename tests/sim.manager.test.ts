// The v3 manager layer (DESIGN 10): huddle, focus, events, campaigns, demand and the waitlist, gentle wait
// reviews, perks, interviews, and every new equipment, operatory upgrade and skill effect.
import { describe, expect, it } from 'vitest';
import * as sim from '../src/sim/index';
import type { CaseType, Clinic, GameState, OfficeTierId, PendingEvent, Staff } from '../src/core/types';
import { OFFICES, TIER_ORDER } from '../src/data/offices';
import { EQUIPMENT, OP_UPGRADES } from '../src/data/upgrades';
import { CAMPAIGNS, EVENTS, PERKS, PERK_LEVELS } from '../src/data/manager';
import { SERVICES } from '../src/data/services';
import { TRAINING_COST } from '../src/core/constants';
import { graduated, grant, ledgerSum, nonFinite, result } from './sim.helpers';
import { makeStaff, staffDaily, RANGE_WIDTH } from '../src/sim/staff';
import { withRng, type SimClinic, type SimPatient, type SimStaff } from '../src/sim/internal';
import {
  addonFeeMult, addonMinutesMult, equipDemand, lastAppt, noShowRate, opComfort, patienceMult, staffXpMult, suppliesMult,
} from '../src/sim/effects';
import { addonAcceptMult } from '../src/sim/patients';
import { awarenessOf, capacityOf, demandLambda, hygienistFactor } from '../src/sim/booking';
import { computeRating } from '../src/sim/clinic';
import { drawEvents } from '../src/sim/manager';

// ------------------------------------------------------------------ helpers

function ownerAt(seed = 11, tier: OfficeTierId = 't2', cash = 3_000_000): GameState {
  const s = graduated(seed);
  grant(s, cash);
  s.player.level = 8;
  expect(sim.openPractice(s, { name: 'Mgr Dental', loan: 0 }).ok).toBe(true);
  sim.closeDay(s);
  sim.completeHuddle(s);
  for (let i = 1; i <= TIER_ORDER.indexOf(tier); i++) expect(sim.moveOffice(s, 0, TIER_ORDER[i], 0).ok).toBe(true);
  const c = s.locations[0];
  while (c.ops.length < OFFICES[c.tier].opSlots) expect(sim.buyOperatory(s, 0).ok).toBe(true);
  for (const op of c.ops) op.staffId = null;
  for (const op of c.ops) addStaff(s, 0, 'hygienist', 60, op.id);
  addStaff(s, 0, 'receptionist', 60);
  rebookToday(s);
  return s;
}

function addStaff(s: GameState, li: number, role: Staff['role'], stat: number, opId?: string): SimStaff {
  const c = s.locations[li];
  const st = withRng(s, (rng) => makeStaff(s, rng, role, 0, { skill: stat, speed: stat, bedside: stat, traits: [] })) as SimStaff;
  c.staff.push(st);
  if (opId) c.ops.find((o) => o.id === opId)!.staffId = st.id;
  return st;
}

/** Book today again (tests change staff directly). */
function rebookToday(s: GameState): void {
  s.minute = 480;
  s.dayOver = false;
  s.huddleDay = s.day - 1;
  s.pendingEvents = [];
  for (const c of s.locations) (c as SimClinic).startRatingDay = undefined;
  // setFocus rebooks every location in the morning
  expect(sim.setFocus(s, s.focus).ok).toBe(true);
}

function runDay(s: GameState): void {
  sim.completeHuddle(s);
  let g = 0;
  while (!s.dayOver && g++ < 20000) {
    const q = sim.playerQueue(s);
    if (q.length) { const setup = sim.beginHandsOn(s, q[0].id); sim.completeHandsOn(s, q[0].id, result(0.85, { caseType: setup.caseType })); continue; }
    sim.tick(s, 3);
  }
  expect(s.dayOver).toBe(true);
}

function pending(s: GameState, eventId: string, vars: Record<string, string> = {}, li = 0): number {
  const c = s.locations[li];
  const pe: PendingEvent = { eventId, clinicId: c.id, day: s.day, vars: { clinic: c.name, ...vars } };
  s.pendingEvents.push(pe);
  s.huddleDay = s.day - 1;
  return s.pendingEvents.length - 1;
}

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const invariants = (s: GameState, where: string) => {
  expect(nonFinite(s), `${where}: non-finite numbers`).toEqual([]);
  expect(s.cash, `${where}: cash equals the ledger`).toBe(ledgerSum(s));
};

// ------------------------------------------------------------------ huddle and focus

describe('morning huddle and daily focus (DESIGN 10.1)', () => {
  it('closeDay opens a huddle; completeHuddle answers leftovers with choice 0; tick opens the doors itself', () => {
    const s = ownerAt(21);
    runDay(s);
    sim.closeDay(s);
    expect(sim.huddlePending(s)).toBe(true);
    const idx = pending(s, 'supplier');
    expect(idx).toBeGreaterThanOrEqual(0);
    const out = sim.completeHuddle(s);
    expect(out.some((o) => o.eventId === 'supplier')).toBe(true);
    expect(s.pendingEvents).toEqual([]);
    expect(s.huddleDay).toBe(s.day);
    expect(s.eventLog.at(-1)?.eventId).toBe('supplier');
    expect(s.eventLog.at(-1)?.choice).toBe(0);
    // tick opens the doors if the UI did not
    pending(s, 'heatwave');
    const ev = sim.tick(s, 1);
    expect(sim.huddlePending(s)).toBe(false);
    expect(ev.some((e) => e.type === 'toast' && e.text.startsWith('Heatwave'))).toBe(true);
  });

  it('auto-huddle resolves the morning at close and keeps the focus', () => {
    const s = ownerAt(22);
    s.settings.autoHuddle = true;
    expect(sim.setFocus(s, ['speed']).ok).toBe(true);
    for (let d = 0; d < 6; d++) {
      runDay(s);
      sim.closeDay(s);
      expect(s.pendingEvents).toEqual([]);
      expect(s.huddleDay).toBe(s.day);
      expect(s.focus).toEqual(['speed']);
      expect(s.locations[0].modifiers.some((m) => m.id === `focus:speed:${s.day}`)).toBe(true);
    }
  });

  it('setFocus checks the office tier and the slots (two with Huddle Pro)', () => {
    const s = ownerAt(23, 't1');
    expect(sim.setFocus(s, ['upsell']).ok).toBe(false);
    expect(sim.setFocus(s, ['speed', 'quality']).ok).toBe(false);
    expect(sim.focusOptions(s).slots).toBe(1);
    expect(sim.focusOptions(s).options.find((o) => o.id === 'upsell')?.ok).toBe(false);
    s.player.skills.push('huddlePro');
    expect(sim.focusOptions(s).slots).toBe(2);
    expect(sim.setFocus(s, ['speed', 'quality']).ok).toBe(true);
    const ids = s.locations[0].modifiers.filter((m) => m.source === 'focus').map((m) => m.id).sort();
    expect(ids).toEqual([`focus:quality:${s.day}`, `focus:speed:${s.day}`]);
    expect(sim.setFocus(s, []).ok).toBe(true);
    expect(s.focus).toEqual(['steady']);
    expect(s.locations[0].modifiers.filter((m) => m.source === 'focus')).toEqual([]);
  });

  it('focus effects: speed, walk-ins and fees, team morale at close, training XP', () => {
    const s = ownerAt(24);
    const c = s.locations[0];
    const cap0 = capacityOf(s, c);
    sim.setFocus(s, ['speed']);
    expect(capacityOf(s, c)).toBeGreaterThan(cap0);
    // walk-in day: three times the walk-ins over a week, and fees -10% lock at check-in
    const a = clone(s);
    const b = clone(s);
    let wa = 0;
    let wb = 0;
    for (let d = 0; d < 6; d++) {
      sim.setFocus(a, ['walkin']); sim.setFocus(b, ['steady']);
      wa += a.locations[0].patients.filter((p) => p.walkIn).length;
      wb += b.locations[0].patients.filter((p) => p.walkIn).length;
      runDay(a); runDay(b);
      if (d === 0) for (const p of a.locations[0].patients as SimPatient[]) if (p.state === 'gone') expect(p.fm ?? 1).toBeCloseTo(0.9, 5);
      sim.closeDay(a); sim.closeDay(b);
    }
    expect(wa).toBeGreaterThan(wb * 1.8);
    // team day: +4 morale at close
    const t1 = clone(s);
    const t2 = clone(s);
    sim.setFocus(t1, ['team']); sim.setFocus(t2, ['steady']);
    for (const x of [t1, t2]) for (const st of x.locations[0].staff) { st.morale = 50; (st as SimStaff).workMin = 0; }
    withRng(t1, (rng) => staffDaily(t1, null, rng));
    withRng(t2, (rng) => staffDaily(t2, null, rng));
    expect(t1.locations[0].staff[0].morale - t2.locations[0].staff[0].morale).toBe(4);
    // training day doubles staff XP
    const tr = clone(s);
    tr.focus = ['training'];
    const st = tr.locations[0].staff[0];
    expect(staffXpMult(tr, tr.locations[0], st)).toBe(2);
  });
});

// ------------------------------------------------------------------ events

describe('events (DESIGN 10.2)', () => {
  it('draws respect tier, needs, one per location and no repeat within 5 days', () => {
    const s = ownerAt(31, 't1');
    const seen: Record<string, number> = {};
    for (let d = 0; d < 120; d++) {
      withRng(s, (rng) => drawEvents(s, rng));
      expect(s.pendingEvents.length).toBeLessThanOrEqual(1);
      for (const pe of s.pendingEvents) {
        const e = EVENTS.find((x) => x.id === pe.eventId)!;
        expect(e.minTier).toBe('t1');
        expect(e.needs).not.toBe('twoLocations');
        if (seen[e.id] != null) expect(s.day - seen[e.id]).toBeGreaterThanOrEqual(5);
        seen[e.id] = s.day;
        if (e.text.includes('{staff}')) expect(pe.vars.staffId).toBeTruthy();
      }
      s.day += 1;
    }
    expect(Object.keys(seen).length).toBeGreaterThan(8);
  });

  it('eventText fills vars and scales cash hints to the office', () => {
    const s = ownerAt(32, 't2');
    const i = pending(s, 'inspector');
    const t = sim.eventText(s, s.pendingEvents[i]);
    expect(t.title).toBe('Health Inspector');
    expect(t.text).toContain('Mgr Dental');
    expect(t.choices[0].hint).toContain('$540');   // $300 x 1.8
    expect(t.text + t.choices.map((c) => c.label + c.hint).join('')).not.toMatch(/[{}—]/);
  });

  it('cash (scaled), rating (fades) and awareness', () => {
    const s = ownerAt(33, 't2');
    const c = s.locations[0];
    const cash0 = s.cash;
    const r0 = c.rating;
    const events = () => s.ledger.filter((e) => e.label === 'Events' && e.day === s.day).reduce((t, e) => t + e.amount, 0);
    const ev0 = events();
    sim.resolveEvent(s, pending(s, 'inspector'), 0);
    expect(cash0 - s.cash).toBe(540);
    expect(events() - ev0).toBe(-540);
    expect(c.rating).toBeCloseTo(Math.min(5, r0 + 0.1), 2);
    const bonus0 = (c as SimClinic).ratingBonus!;
    runDay(s); sim.closeDay(s);
    expect((c as SimClinic).ratingBonus!).toBeLessThan(bonus0);
    const aw0 = awarenessOf(s, c);
    sim.completeHuddle(s);
    sim.resolveEvent(s, pending(s, 'charity'), 0);
    expect(awarenessOf(s, c) - aw0).toBeCloseTo(0.05, 5);
    invariants(s, 'cash events');
  });

  it('modifiers get shared-convention ids and expire; permanent ones block a repeat draw', () => {
    const s = ownerAt(34, 't2');
    const c = s.locations[0];
    const day = s.day;
    sim.resolveEvent(s, pending(s, 'news'), 0);
    const m = c.modifiers.find((x) => x.id === `event:news:${day}`)!;
    expect(m.source).toBe('event');
    expect(m.untilDay).toBe(day + 2);
    expect(m.demand).toBe(1.2);
    for (let d = 0; d < 3; d++) { runDay(s); sim.closeDay(s); }
    expect(c.modifiers.some((x) => x.id === `event:news:${day}`)).toBe(false);
    sim.completeHuddle(s);
    sim.resolveEvent(s, pending(s, 'puppy'), 0);
    expect(c.modifiers.find((x) => x.id.startsWith('event:puppy:'))?.untilDay).toBeNull();
    for (let d = 0; d < 40; d++) {
      withRng(s, (rng) => drawEvents(s, rng));
      expect(s.pendingEvents.some((x) => x.eventId === 'puppy')).toBe(false);
      s.day++;
    }
  });

  it('morale, skill, salary and quit chance act on the right people', () => {
    const s = ownerAt(35, 't2');
    const c = s.locations[0];
    const st = c.staff[0];
    const m0 = c.staff.map((x) => x.morale);
    sim.resolveEvent(s, pending(s, 'birthday', { staff: 'X', staffId: st.id }), 0);
    c.staff.forEach((x, i) => expect(x.morale).toBe(Math.min(100, m0[i] + 8)));
    const best = [...c.staff].filter((x) => x.role === 'hygienist').sort((a, b) => b.skill - a.skill)[0];
    const sk = best.skill;
    sim.resolveEvent(s, pending(s, 'expo', {}), 0);
    expect(best.skill).toBe(Math.min(99, sk + 10));
    const sal = st.salary;
    sim.resolveEvent(s, pending(s, 'poach', { staff: 'X', staffId: st.id }), 0);
    expect(st.salary).toBe(Math.round(sal * 1.15));
    st.traits = ['loyal'];
    const n = c.staff.length;
    sim.resolveEvent(s, pending(s, 'poach', { staff: 'X', staffId: st.id }), 1);
    expect(c.staff.length).toBe(n);   // Loyal never leaves
  });

  it('a VIP joins today with a flat fee and a heavy review', () => {
    const s = ownerAt(36, 't2');
    const c = s.locations[0];
    sim.resolveEvent(s, pending(s, 'celebrity'), 0);
    const vip = c.patients.find((p) => p.vip) as SimPatient;
    expect(vip).toBeTruthy();
    expect(vip.vipFee).toBe(900);
    runDay(s);
    const after = c.patients.find((p) => p.vip) as SimPatient;
    expect(after.state).toBe('gone');
    const rev = c.reviews.find((r) => r.name === after.name);
    if (after.stars != null && rev && after.stars > 2) expect(rev.weight).toBe(5);
    expect(c.day.revenue).toBeGreaterThanOrEqual(900);
  });

  it('a closed operatory takes nobody; a late opening books nobody before it', () => {
    const s = ownerAt(37, 't2');
    const c = s.locations[0];
    const op = c.ops[1];
    const cap0 = sim.dayOutlook(s, 0).capacity;
    sim.resolveEvent(s, pending(s, 'pipe', { op: 'Operatory 2', opId: op.id }), 1);
    expect(c.modifiers.find((m) => m.closedOpId === op.id)?.untilDay).toBe(s.day + 1);
    expect(sim.dayOutlook(s, 0).capacity).toBeLessThan(cap0);
    sim.completeHuddle(s);
    let seatedThere = 0;
    let g = 0;
    while (!s.dayOver && g++ < 5000) { sim.tick(s, 2); if (op.patientId) seatedThere++; }
    expect(seatedThere).toBe(0);
    sim.closeDay(s);
    sim.resolveEvent(s, pending(s, 'outage'), 1);
    for (const p of c.patients) expect(p.apptMin).toBeGreaterThanOrEqual(600);
  });

  it('temporary staff, the salesman discount, free equipment and XP', () => {
    const s = ownerAt(38, 't2');
    const c = s.locations[0];
    const n = c.staff.length;
    sim.resolveEvent(s, pending(s, 'intern'), 0);
    const temp = c.staff.find((x) => x.tempUntilDay != null)!;
    expect(c.staff.length).toBe(n + 1);
    expect(temp.role).toBe('assistant');
    expect(temp.salary).toBe(0);
    expect(temp.tempUntilDay).toBe(s.day + 4);
    for (let d = 0; d < 5; d++) { runDay(s); sim.closeDay(s); }
    expect(c.staff.some((x) => x.id === temp.id)).toBe(false);
    // salesman: 40% off today only
    sim.completeHuddle(s);
    sim.resolveEvent(s, pending(s, 'salesman', { equip: 'Spa Lounge', equipId: 'spaLounge' }), 0);
    expect(sim.equipmentPrice(s, 0, 'spaLounge')).toBe(Math.round(EQUIPMENT.spaLounge.price * 0.6));
    const next = clone(s);
    runDay(next); sim.closeDay(next);
    expect(sim.equipmentPrice(next, 0, 'spaLounge')).toBe(EQUIPMENT.spaLounge.price);
    // (t2 cannot buy the t3 Spa Lounge, but the price is what the office shows)
    expect(sim.buyEquipment(s, 0, 'spaLounge').ok).toBe(false);
    sim.resolveEvent(s, pending(s, 'salesman', { equip: 'Water Filter', equipId: 'waterFilter' }), 0);
    const cash0 = s.cash;
    expect(sim.buyEquipment(s, 0, 'waterFilter').ok).toBe(true);
    expect(cash0 - s.cash).toBe(Math.round(EQUIPMENT.waterFilter.price * 0.6));
    // freeEquip and xp through a test-only event
    EVENTS.push({ id: 'testGift', title: 'Gift', text: 'A gift.', art: 'box', minTier: 't1', weight: 0, choices: [{ label: 'Take it', hint: '', effects: [{ kind: 'freeEquip' }, { kind: 'xp', amount: 40 }] }] });
    try {
      const xp0 = s.player.xp + s.player.level * 1e6;
      sim.resolveEvent(s, pending(s, 'testGift', { equip: 'Fish Tank', equipId: 'fishTank' }), 0);
      expect(c.equipment).toContain('fishTank');
      expect(s.player.xp + s.player.level * 1e6).toBeGreaterThan(xp0);
    } finally {
      EVENTS.pop();
    }
    invariants(s, 'temp and equipment events');
  });

  it('risky choices roll; Crisis Manager adds 20%', () => {
    let wins = 0;
    for (let i = 0; i < 20; i++) {
      const s = ownerAt(40 + i, 't2');
      s.player.skills.push('crisisManager');
      const r0 = s.locations[0].rating;
      const out = sim.resolveEvent(s, pending(s, 'mystery'), 0);   // 0.8 + 0.2 = always
      expect(out.good).toBe(true);
      expect(out.text).toBe('Smile Magazine loved it.');
      if (s.locations[0].rating > r0) wins++;
      if (i >= 3) break;
    }
    expect(wins).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ campaigns

describe('campaigns (DESIGN 10.3)', () => {
  it('cost x tierScale (Brand Builder -25%), requirements, one at a time, cooldown, grand opening', () => {
    const s = ownerAt(51, 't2');
    const st = sim.campaignStatus(s, 0, 'kidsWeek');
    expect(st.cost).toBe(Math.round(CAMPAIGNS.kidsWeek.cost * OFFICES.t2.tierScale));
    s.player.skills.push('brandBuilder');
    expect(sim.campaignStatus(s, 0, 'kidsWeek').cost).toBe(Math.round(CAMPAIGNS.kidsWeek.cost * OFFICES.t2.tierScale * 0.75));
    expect(sim.campaignStatus(s, 0, 'smileMakeover').reason).toBe('Needs a Whitening Lamp');
    expect(sim.campaignStatus(s, 0, 'goldenYears').ok).toBe(false);
    expect(sim.campaignStatus(s, 0, 'grandOpening').ok).toBe(true);   // opened a day ago
    s.locations[0].served = 5000;
    (s.locations[0] as SimClinic).openedDay = s.day - 30;
    expect(sim.campaignStatus(s, 0, 'grandOpening').reason).toBe('For a new location');
    const cash0 = s.cash;
    expect(sim.startCampaign(s, 0, 'kidsWeek').ok).toBe(true);
    expect(cash0 - s.cash).toBe(sim.campaignStatus(s, 0, 'bracesBonanza').cost > 0 ? Math.round(600 * 1.8 * 0.75) : 0);
    const c = s.locations[0];
    expect(c.campaign?.id).toBe('kidsWeek');
    expect(c.modifiers.some((m) => m.id === `campaign:kidsWeek:${s.day}` && m.source === 'campaign')).toBe(true);
    expect(sim.campaignStatus(s, 0, 'bracesBonanza').ok).toBe(false);
    const end = c.campaign!.untilDay;
    expect(end).toBe(s.day + CAMPAIGNS.kidsWeek.days - 1);
    while (s.day <= end) { runDay(s); sim.closeDay(s); }
    expect(c.campaign).toBeNull();
    expect(sim.campaignStatus(s, 0, 'bracesBonanza').ok).toBe(false);   // cooldown
    expect(c.campaignCooldownUntil).toBe(end + 1 + CAMPAIGNS.kidsWeek.cooldown);
    while (s.day < c.campaignCooldownUntil) { runDay(s); sim.closeDay(s); }
    expect(sim.campaignStatus(s, 0, 'bracesBonanza').ok).toBe(true);
    invariants(s, 'campaigns');
  });

  it('a campaign shifts the case mix and demand', () => {
    const base = ownerAt(52, 't2');
    const a = clone(base);
    const b = clone(base);
    expect(sim.startCampaign(a, 0, 'kidsWeek').ok).toBe(true);
    const lam = (s: GameState) => demandLambda(s, s.locations[0], 1);
    expect(lam(a) / lam(b)).toBeCloseTo(CAMPAIGNS.kidsWeek.demand, 5);
    const count = (s: GameState, ct: CaseType) => s.locations[0].patients.filter((p) => p.caseType === ct).length;
    let ka = 0;
    let kb = 0;
    let na = 0;
    let nb = 0;
    for (let d = 0; d < 5; d++) {
      ka += count(a, 'candy'); kb += count(b, 'candy');
      na += a.locations[0].patients.length; nb += b.locations[0].patients.length;
      runDay(a); runDay(b); sim.closeDay(a); sim.closeDay(b);
    }
    expect(ka / na).toBeGreaterThan(1.8 * (kb / nb));
  });

  it('a campaign bought after the doors open runs the next full days', () => {
    const s = ownerAt(53, 't2');
    sim.completeHuddle(s);
    sim.tick(s, 60);
    expect(sim.startCampaign(s, 0, 'kidsWeek').ok).toBe(true);
    expect(s.locations[0].campaign!.untilDay).toBe(s.day + CAMPAIGNS.kidsWeek.days);
  });
});

// ------------------------------------------------------------------ demand and waitlist

describe('demand, capacity and the waitlist (DESIGN 10.3)', () => {
  it('a new T1 office at the default price fills most of one chair, not all of two', () => {
    let fill1 = 0;
    for (let i = 0; i < 6; i++) {
      const s = graduated(60 + i);
      grant(s, 20000);
      s.player.level = 5;
      sim.openPractice(s, { name: 'New', loan: 0 });
      sim.closeDay(s);
      const c = s.locations[0];
      fill1 += demandLambda(s, c, 1) / capacityOf(s, c);
    }
    fill1 /= 6;
    expect(fill1).toBeGreaterThan(0.55);
    expect(fill1).toBeLessThan(0.95);
  });

  it('awareness grows with patients served at this tier and a move keeps only word of mouth', () => {
    const s = ownerAt(61, 't1');
    const c = s.locations[0] as SimClinic;
    c.reach = 600;
    const high = awarenessOf(s, c);
    expect(high).toBeGreaterThan(0.95);
    expect(sim.moveOffice(s, 0, 't2', 0).ok).toBe(true);
    expect(c.reach).toBe(40);
    expect(awarenessOf(s, c)).toBeLessThan(0.65);
  });

  it('overflow carries over as a waitlist booked first the next day', () => {
    const s = ownerAt(62, 't2');
    const c = s.locations[0] as SimClinic;
    c.modifiers.push({ id: 'event:test:1', label: 'Rush', source: 'event', untilDay: s.day, demand: 4 });
    c.waitIn = 0;
    rebookToday(s);
    const cap = sim.dayOutlook(s, 0).capacity;
    expect(c.day.demand).toBeGreaterThan(cap);
    const carry = c.waitOut!;
    expect(carry).toBe(Math.min(c.day.demand - c.day.booked, cap));
    expect(c.day.turnedAway).toBe(c.day.demand - c.day.booked - carry);
    runDay(s);
    const rep = sim.closeDay(s);
    expect((rep.perLocation[0] as { waitlist?: number }).waitlist).toBe(carry);
    expect(rep.notes.some((n) => n.includes('waitlist'))).toBe(true);
    expect(c.waitIn).toBe(carry);
    expect(sim.dayOutlook(s, 0).waitlist).toBe(carry);
    expect(c.day.booked).toBeGreaterThanOrEqual(Math.min(carry, cap));
  });

  it('nobody is double-booked into a lane: appointments per operatory never overlap at booking', () => {
    const s = ownerAt(63, 't2');
    const c = s.locations[0];
    c.modifiers.push({ id: 'event:test:2', label: 'Rush', source: 'event', untilDay: s.day, demand: 3 });
    rebookToday(s);
    const times = c.patients.filter((p) => !p.walkIn && !p.vip).map((p) => p.apptMin).sort((a, b) => a - b);
    const lanes = c.ops.length;
    // at most one appointment per lane in any 20 minute window
    for (let i = 0; i + lanes < times.length; i++) expect(times[i + lanes] - times[i]).toBeGreaterThan(20);
  });

  it('wait walkouts review gently: half the time, 2 stars, weight 0.5', () => {
    let walkouts = 0;
    let reviews = 0;
    for (let i = 0; i < 4; i++) {
      const s = ownerAt(70 + i, 't2');
      const c = s.locations[0];
      // one hygienist left for a full book: the waiting room overflows
      for (const o of c.ops.slice(1)) o.staffId = null;
      for (const p of c.patients) p.patience = 5;
      sim.completeHuddle(s);
      const n0 = c.reviews.length;
      let g = 0;
      while (!s.dayOver && g++ < 20000) {
        for (const e of sim.tick(s, 2)) if (e.type === 'walkout' && e.reason === 'wait') walkouts++;
      }
      const fresh = c.reviews.slice(n0).filter((r) => r.text.startsWith('Waited'));
      for (const r of fresh) { expect(r.stars).toBe(2); expect(r.weight).toBe(0.5); }
      expect(c.reviews.slice(n0).some((r) => r.stars === 1)).toBe(false);
      reviews += fresh.length;
    }
    expect(walkouts).toBeGreaterThan(20);
    expect(reviews / walkouts).toBeGreaterThan(0.3);
    expect(reviews / walkouts).toBeLessThan(0.7);
  });
});

// ------------------------------------------------------------------ staff depth

describe('perks and interviews (DESIGN 10.4)', () => {
  it('perk levels offer two role perks; pick one; the offer auto-picks after 2 days', () => {
    const s = ownerAt(81, 't2');
    const c = s.locations[0];
    const h = c.staff.find((x) => x.role === 'hygienist')!;
    const r = c.staff.find((x) => x.role === 'receptionist')!;
    h.xp = 25; r.xp = 25;
    withRng(s, (rng) => staffDaily(s, null, rng));
    expect(PERK_LEVELS).toContain(h.level);
    expect(h.pendingPerks?.length).toBe(2);
    for (const p of h.pendingPerks!) expect(PERKS[p].roles).toContain('hygienist');
    for (const p of r.pendingPerks!) expect(PERKS[p].roles).toContain('receptionist');
    expect(sim.pickPerk(s, 0, h.id, 'mentor').ok).toBe(h.pendingPerks!.includes('mentor'));
    const offer = h.pendingPerks ?? [];
    if (offer.length) expect(sim.pickPerk(s, 0, h.id, offer[1]).ok).toBe(true);
    expect(h.pendingPerks).toBeNull();
    expect(h.perks.length).toBe(1);
    const first = r.pendingPerks![0];
    for (let d = 0; d < 3; d++) { s.day++; withRng(s, (rng) => staffDaily(s, null, rng)); }
    expect(r.perks).toEqual([first]);
    expect(r.pendingPerks).toBeNull();
  });

  it('a specialist gets their case type; perk effects (speed, comfort, mentor, iron lungs, upsell)', () => {
    const s = ownerAt(82, 't2');
    const c = s.locations[0];
    const [h1, h2] = c.staff.filter((x) => x.role === 'hygienist');
    const op1 = c.ops.find((o) => o.staffId === h1.id)!;
    const f0 = hygienistFactor(s, c, op1, h1);
    h1.perks = ['speedDemon'];
    expect(hygienistFactor(s, c, op1, h1)).toBeCloseTo(f0 / 1.1, 6);
    expect(staffXpMult(s, c, h1)).toBe(1);
    h2.perks = ['mentor'];
    expect(staffXpMult(s, c, h1)).toBe(1.5);
    const rec = c.staff.find((x) => x.role === 'receptionist')!;
    const acc = addonAcceptMult(s, c, 'fluoride', rec.id);
    rec.perks = ['upsellStar'];
    expect(addonAcceptMult(s, c, 'fluoride', rec.id) / acc).toBeCloseTo(1.1, 6);
    // iron lungs: two more patients' worth of chair minutes before overwork
    for (const x of [h1, h2]) { x.morale = 60; (x as SimStaff).workMin = 470 + 90; }
    h2.perks = ['ironLungs'];
    withRng(s, (rng) => staffDaily(s, null, rng));
    expect(h2.morale - h1.morale).toBeGreaterThanOrEqual(6);
    // routing: a deep case goes to the deep specialist when both are free
    const t = ownerAt(83, 't2');
    const tc = t.locations[0];
    tc.equipment.push('deepCert');
    const [a, b] = tc.staff.filter((x) => x.role === 'hygienist');
    const opB = tc.ops.find((o) => o.staffId === b.id)!;
    b.perks = ['deepDiver'];
    let deepTotal = 0;
    let deepToB = 0;
    for (let d = 0; d < 4; d++) {
      rebookToday(t);
      sim.completeHuddle(t);
      let g = 0;
      while (!t.dayOver && g++ < 20000) {
        for (const e of sim.tick(t, 1)) if (e.type === 'seated') {
          const p = tc.patients.find((x) => x.id === e.patientId)!;
          if (p.caseType === 'deep') { deepTotal++; if (e.opId === opB.id) deepToB++; }
        }
      }
      sim.closeDay(t);
    }
    void a;
    if (deepTotal >= 4) expect(deepToB / deepTotal).toBeGreaterThan(1 / tc.ops.length + 0.15);
  });

  it('candidates show ranges until interviewed; interviews cost 40 x tierScale, free with Talent Scout', () => {
    const s = ownerAt(84, 't2');
    runDay(s); sim.closeDay(s);
    expect(s.candidates.length).toBe(6);
    const fresh = s.candidates.filter((x) => !x.interviewed);
    expect(fresh.length).toBeGreaterThan(0);
    for (const x of fresh) {
      for (const k of ['skill', 'speed', 'bedside'] as const) {
        const [lo, hi] = x.range[k];
        expect(hi - lo).toBe(RANGE_WIDTH);
        expect(x[k]).toBeGreaterThanOrEqual(lo);
        expect(x[k]).toBeLessThanOrEqual(hi);
      }
    }
    const cash0 = s.cash;
    expect(sim.interview(s, fresh[0].id).ok).toBe(true);
    expect(cash0 - s.cash).toBe(Math.round(40 * OFFICES.t2.tierScale));
    expect(fresh[0].interviewed).toBe(true);
    expect(fresh[0].range.skill).toEqual([fresh[0].skill, fresh[0].skill]);
    expect(sim.interview(s, fresh[0].id).ok).toBe(false);
    s.player.skills.push('talentScout');
    expect(sim.interviewCost(s)).toBe(0);
    runDay(s); sim.closeDay(s);
    expect(s.candidates.length).toBe(8);
    const hired = s.candidates.find((x) => x.role === 'hygienist') ?? s.candidates[0];
    expect(sim.hire(s, hired.id, 0).ok).toBe(true);
    const staff = s.locations[0].staff.find((x) => x.id === hired.id)! as Staff & { range?: unknown; interviewed?: unknown };
    expect(staff.range).toBeUndefined();
    expect(staff.interviewed).toBeUndefined();
    expect(staff.perks).toEqual([]);
  });
});

// ------------------------------------------------------------------ equipment, upgrades and skills

describe('equipment and operatory upgrades do what their blurbs say (DESIGN 10.5)', () => {
  const eq = (s: GameState, id: keyof typeof EQUIPMENT) => { s.locations[0].equipment.push(id); return s.locations[0]; };

  it('supplies, comfort, demand, patience, no-shows', () => {
    const s = ownerAt(91, 't4');
    const c = s.locations[0];
    const op = c.ops[0];
    expect(suppliesMult(s, c)).toBe(1);
    eq(s, 'waterFilter');
    expect(suppliesMult(s, c)).toBeCloseTo(0.9, 6);
    const cf = opComfort(c, op);
    eq(s, 'aromatherapy');
    expect(opComfort(c, op) - cf).toBeCloseTo(0.05, 6);
    const d0 = equipDemand(s, c);
    eq(s, 'loyaltyProgram');
    expect(equipDemand(s, c) / d0).toBeCloseTo(1.08, 6);
    const ns0 = noShowRate(s, c);
    eq(s, 'patientApp');
    expect(equipDemand(s, c) / d0).toBeCloseTo(1.08 * 1.05, 6);
    expect(noShowRate(s, c) / ns0).toBeCloseTo(0.7, 6);
    const p0 = patienceMult(c, 'regular');
    eq(s, 'soundMasking');
    expect(patienceMult(c, 'regular') / p0).toBeCloseTo(1.2, 6);
    eq(s, 'spaLounge');
    expect(patienceMult(c, 'regular') / p0).toBeCloseTo(1.2 * 1.5, 6);
    const r0 = computeRating({ ...c, equipment: c.equipment.filter((x) => x !== 'spaLounge') } as Clinic);
    expect(computeRating(c) - r0).toBeCloseTo(Math.min(0.15, 5 - r0), 2);
    const cf2 = opComfort(c, op);
    eq(s, 'nitrousSystem');
    expect(opComfort(c, op) - cf2).toBeCloseTo(0.1, 6);
  });

  it('X-rays, whitening, fillings, capacity, VIPs', () => {
    const s = ownerAt(92, 't4');
    const c = s.locations[0];
    expect(sim.buyEquipment(s, 0, 'digitalXray').ok).toBe(false);   // needs the X-Ray Suite
    expect(sim.buyEquipment(s, 0, 'xray').ok).toBe(true);
    const acc = addonAcceptMult(s, c, 'xray');
    expect(sim.buyEquipment(s, 0, 'digitalXray').ok).toBe(true);
    expect(addonAcceptMult(s, c, 'xray') / acc).toBeCloseTo(1.2, 6);
    expect(addonMinutesMult(c, 'xray')).toBe(0.5);
    eq(s, 'laserWhitening');
    expect(addonFeeMult(c, 'whitening')).toBe(1.25);
    eq(s, 'cadcam');
    expect(addonFeeMult(c, 'filling')).toBe(1.5);
    expect(addonMinutesMult(c, 'filling')).toBeCloseTo(2 / 3, 6);
    const cap0 = capacityOf(s, c);
    eq(s, 'aiScheduler');
    expect(capacityOf(s, c)).toBeGreaterThanOrEqual(Math.floor(cap0 * 1.08));
    eq(s, 'smileStudio');
    rebookToday(s);
    const vips = c.patients.filter((p) => p.vip);
    expect(vips.length).toBe(1);
    expect((vips[0] as SimPatient).vipFee).toBeGreaterThan(SERVICES.cleaning.fee * 10);
  });

  it('morale items, the Rooftop Garden keeps people through a bad week', () => {
    const s = ownerAt(93, 't3');
    const c = s.locations[0];
    const st = c.staff[0];
    const morale = (setup: (x: GameState) => void) => {
      const x = clone(s);
      setup(x);
      const y = x.locations[0].staff[0];
      y.morale = 50; (y as SimStaff).workMin = 0;
      withRng(x, (rng) => staffDaily(x, null, rng));
      return y.morale;
    };
    const base = morale(() => {});
    expect(morale((x) => x.locations[0].equipment.push('staffLockers')) - base).toBe(1);
    expect(morale((x) => x.locations[0].equipment.push('rooftopGarden')) - base).toBe(3);
    // Rooftop Garden: nobody quits before five bad days in a row
    c.equipment.push('rooftopGarden');
    st.traits = [];
    st.salary = Math.round(st.ask * 0.5);
    for (const x of c.staff) x.morale = 0;
    const n = c.staff.length;
    for (let d = 0; d < 4; d++) withRng(s, (rng) => staffDaily(s, null, rng));
    expect(c.staff.length).toBe(n);
  });

  it('chain-wide Research Wing and Helipad; the op upgrades', () => {
    const s = ownerAt(94, 't4');
    s.locations[0].equipment.push('researchWing', 'helipad');
    expect(sim.openLocation(s, 't2', 'Second', 0).ok).toBe(true);
    const c2 = s.locations[1];
    const st = withRng(s, (rng) => makeStaff(s, rng, 'hygienist', 0, { traits: [] }));
    c2.staff.push(st);
    expect(staffXpMult(s, c2, st)).toBe(1.5);
    expect(sim.trainingCost(s)).toBe(Math.round(TRAINING_COST * 0.5));
    expect(equipDemand(s, c2)).toBeCloseTo(1.15, 6);
    // op upgrades: Ergonomic Stool 5% faster, Laughing Gas needs Main Street and adds comfort 0.15
    const t1 = ownerAt(95, 't1');
    const c = t1.locations[0];
    const op = c.ops.find((o) => o.staffId && o.staffId !== 'player')!;
    const h = c.staff.find((x) => x.id === op.staffId)!;
    const f0 = hygienistFactor(t1, c, op, h);
    expect(sim.buyOpUpgrade(t1, 0, op.id, 'ergoStool').ok).toBe(true);
    expect(hygienistFactor(t1, c, op, h)).toBeCloseTo(f0 / 1.05, 6);
    expect(OP_UPGRADES.nitrous.minTier).toBe('t2');
    expect(sim.buyOpUpgrade(t1, 0, op.id, 'nitrous').ok).toBe(false);
    const t2 = ownerAt(96, 't2');
    const op2 = t2.locations[0].ops[0];
    const cf = opComfort(t2.locations[0], op2);
    expect(sim.buyOpUpgrade(t2, 0, op2.id, 'nitrous').ok).toBe(true);
    expect(opComfort(t2.locations[0], op2) - cf).toBeCloseTo(0.15, 6);
  });

  it('laughing gas: a nervous patient never walks out of that chair', () => {
    const s = ownerAt(97, 't2');
    const c = s.locations[0];
    const op = c.ops[0];
    sim.buyOpUpgrade(s, 0, op.id, 'nitrous');
    // your chair, hands-on, only chair serving
    for (const o of c.ops) if (o !== op) o.staffId = null;
    op.staffId = 'player'; op.playerMode = 'hands';
    rebookToday(s);
    sim.completeHuddle(s);
    let g = 0;
    while (!sim.playerQueue(s).length && g++ < 3000) sim.tick(s, 1);
    const p = sim.playerQueue(s)[0];
    p.archetype = 'nervous';
    const setup = sim.beginHandsOn(s, p.id);
    expect(setup.traits.comfortStart).toBeGreaterThan(60);
    const out = sim.completeHandsOn(s, p.id, result(0.25, { quit: 'walkout', clean: 0.7, comfort: 0, caseType: setup.caseType }));
    expect(out.events.some((e) => e.type === 'walkout' && e.patientId === p.id)).toBe(false);
    expect(out.payout.pay).toBeGreaterThan(0);
  });
});

describe('skills (DESIGN 10.6)', () => {
  it('business: Paperwork Pro, Bulk Buyer, Brand Builder, Investor Relations, Franchise Savvy', () => {
    const s = ownerAt(101, 't2');
    // Paperwork Pro: goals left unclaimed at close pay in full (half without)
    const payOut = (pw: boolean) => {
      const x = clone(s);
      if (pw) x.player.skills.push('paperworkPro');
      const g = x.goals[0];
      g.done = true; g.progress = g.target; g.claimed = false;
      runDay(x);
      const rep = sim.closeDay(x);
      return rep.income.find((l) => l.label === 'Goal rewards')?.amount ?? 0;
    };
    const full = payOut(true);
    const half = payOut(false);
    expect(full).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
    s.player.skills.push('bulkBuyer');
    expect(sim.equipmentPrice(s, 0, 'fishTank')).toBe(Math.round(EQUIPMENT.fishTank.price * 0.9));
    expect(sim.chairPrice(s, 'deluxe')).toBe(Math.round(9000 * 0.9));
    expect(sim.opUpgradePrice(s, 'tv')).toBe(Math.round(OP_UPGRADES.tv.price * 0.9));
    const c = s.locations[0] as SimClinic;
    c.reach = 75;
    const aw = awarenessOf(s, c);
    s.player.skills.push('brandBuilder');
    expect(awarenessOf(s, c)).toBeGreaterThan(aw);
    const v0 = sim.valuation(s);
    s.player.skills.push('investorRelations');
    expect(sim.valuation(s)).toBeGreaterThan(v0);
    const q0 = sim.moveQuote(s, 0, 't3');
    const l0 = sim.locationQuote(s, 't2');
    s.player.skills.push('franchiseSavvy');
    expect(sim.moveQuote(s, 0, 't3').net).toBe(Math.round(q0.net * 0.8));
    expect(sim.locationQuote(s, 't2').price).toBe(Math.round(l0.price * 0.8));
    // Investor Relations halves loan interest
    const x = clone(s);
    const y = clone(s);
    y.player.skills = y.player.skills.filter((k) => k !== 'investorRelations');
    for (const z of [x, y]) { sim.takeLoan(z, 10000); runDay(z); }
    const ix = sim.closeDay(x).expenses.find((l) => l.label === 'Loan interest')!.amount;
    const iy = sim.closeDay(y).expenses.find((l) => l.label === 'Loan interest')!.amount;
    expect(ix).toBeCloseTo(iy / 2, -1);
  });

  it('management: HR Guru, Delegator, Night Shift, Mentor Program, Morale Officer', () => {
    const s = ownerAt(102, 't2');
    s.player.skills.push('hrGuru');
    expect(sim.trainingCost(s)).toBe(Math.round(TRAINING_COST * 0.6));
    const h = s.locations[0].staff.find((x) => x.role === 'hygienist')!;
    expect(sim.train(s, 0, h.id).ok).toBe(true);
    expect((h as SimStaff).courseGain).toBe(12);
    // Delegator: a second location without a manager keeps full demand
    expect(sim.openLocation(s, 't2', 'Two', 0).ok).toBe(true);
    const c2 = s.locations[1];
    c2.staff.push(withRng(s, (rng) => makeStaff(s, rng, 'hygienist', 0, {})));
    c2.ops[0].staffId = c2.staff[0].id;
    const lam = demandLambda(s, c2, 1);
    s.player.skills.push('delegator');
    expect(demandLambda(s, c2, 1) / lam).toBeCloseTo(1 / 0.85, 5);
    // Night Shift: an hour later, more capacity
    const cap = capacityOf(s, s.locations[0]);
    s.player.skills.push('nightShift');
    expect(lastAppt(s, s.locations[0])).toBe(960 + 60);
    expect(capacityOf(s, s.locations[0])).toBeGreaterThan(cap);
    s.player.skills.push('mentorProgram');
    expect(staffXpMult(s, s.locations[0], s.locations[0].staff[1])).toBe(1.5);
    s.player.skills.push('moraleOfficer');
    for (const x of s.locations[0].staff) { x.morale = 5; x.salary = Math.round(x.ask * 0.75); }
    withRng(s, (rng) => staffDaily(s, null, rng));
    for (const x of s.locations[0].staff) expect(x.morale).toBeGreaterThanOrEqual(30);
  });
});

// ------------------------------------------------------------------ goals

describe('owner goals (DESIGN 10.7) and the fast-clean goal text', () => {
  it('owner goals use management verbs; campaign and event goals progress', () => {
    const s = ownerAt(111, 't2');
    const kinds = new Set<string>();
    runDay(s);
    sim.closeDay(s);   // the first goals were drawn while you still had a chair
    for (let d = 0; d < 25; d++) {
      for (const g of s.goals) {
        kinds.add(g.kind);
        expect(g.text).not.toMatch(/[—!]/);
        if (g.kind === ('campaign' as never)) {
          const id = (['kidsWeek', 'bracesBonanza', 'pirateDay'] as const).find((k) => sim.campaignStatus(s, 0, k).ok);
          if (id) { sim.startCampaign(s, 0, id); expect(g.done).toBe(true); }
        }
        if (g.kind === ('events' as never) && s.pendingEvents.length) {
          const before = g.progress;
          sim.resolveEvent(s, 0, 0);
          expect(g.progress).toBe(before + 1);
        }
      }
      runDay(s);
      sim.closeDay(s);
    }
    for (const k of kinds) expect(['served', 'fiveStars', 'addons', 'noWalkouts', 'net', 'rating', 'events', 'campaign']).toContain(k);
    expect(kinds.size).toBeGreaterThan(4);
  });

  it('the fast-clean goal says it needs 3 stars (out/fix/sim-late.md)', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = graduated(seed);
      const g = s.goals.find((x) => x.kind === 'fastClean');
      if (!g) continue;
      expect(g.text).toMatch(/^Finish a 3-star cleaning in under \d+ s$/);
      return;
    }
  });
});

// ------------------------------------------------------------------ saves and a long managed run

describe('migrate and a 30-day managed run', () => {
  it('old saves get every v3 default', () => {
    const s = ownerAt(121, 't2');
    runDay(s);
    const old = JSON.parse(JSON.stringify(s));
    for (const k of ['focus', 'huddleDay', 'pendingEvents', 'eventLog', 'settings']) delete old[k];
    for (const c of old.locations) {
      delete c.modifiers; delete c.campaign; delete c.campaignCooldownUntil;
      for (const st of c.staff) { delete st.perks; delete st.pendingPerks; }
      for (const p of c.patients) { delete p.bonus; delete p.vip; }
    }
    for (const c of old.candidates) { delete c.interviewed; delete c.range; }
    const m = sim.migrate(old);
    expect(m.focus).toEqual(['steady']);
    expect(m.huddleDay).toBe(m.day);
    expect(m.pendingEvents).toEqual([]);
    expect(m.eventLog).toEqual([]);
    expect(m.settings).toEqual({ autoHuddle: false, autoRaise: false });
    expect(m.settings.autoPause).toBeUndefined();
    const c = m.locations[0];
    expect(c.modifiers).toEqual([]);
    expect(c.campaign).toBeNull();
    expect(c.campaignCooldownUntil).toBe(0);
    for (const st of c.staff) { expect(st.perks).toEqual([]); expect(st.pendingPerks).toBeNull(); }
    for (const p of c.patients) { expect(p.bonus).toBeNull(); expect(p.vip).toBe(false); }
    for (const x of m.candidates) { expect(x.interviewed).toBe(true); expect(x.range.skill).toEqual([x.skill, x.skill]); }
    sim.closeDay(m);
    runDay(m);
    invariants(m, 'migrated');
  });

  it('30 owner days with huddles, events, focus, campaigns, perks and interviews stay sane', () => {
    const s = ownerAt(131, 't2', 200000);
    for (let d = 0; d < 30; d++) {
      const opts = sim.focusOptions(s).options.filter((o) => o.ok);
      sim.setFocus(s, [opts[d % opts.length].id]);
      while (s.pendingEvents.length) {
        const n = sim.eventText(s, s.pendingEvents[0]).choices.length;
        const out = sim.resolveEvent(s, 0, d % n);
        expect(out.text.length).toBeGreaterThan(3);
        expect(out.text).not.toMatch(/[{}—]/);
      }
      for (const id of ['kidsWeek', 'bracesBonanza', 'pirateDay'] as const) if (sim.campaignStatus(s, 0, id).ok) { sim.startCampaign(s, 0, id); break; }
      for (const st of s.locations[0].staff) if (st.pendingPerks?.length) expect(sim.pickPerk(s, 0, st.id, st.pendingPerks[0]).ok).toBe(true);
      const cand = s.candidates.find((x) => !x.interviewed);
      if (cand) sim.interview(s, cand.id);
      invariants(s, `morning ${d}`);
      runDay(s);
      invariants(s, `evening ${d}`);
      const rep = sim.closeDay(s);
      expect(Number.isFinite(rep.operatingNet)).toBe(true);
      for (const n of rep.notes) expect(n).not.toMatch(/[—{}]|undefined|NaN/);
      for (const c of s.locations) for (const m of c.modifiers) {
        expect(m.id).toMatch(/^(event|campaign|focus):[A-Za-z]+:\d+(\.\d+)?$/);
        if (m.untilDay != null) expect(m.untilDay).toBeGreaterThanOrEqual(s.day);
      }
    }
    expect(s.eventLog.length).toBeGreaterThan(5);
    expect(s.locations[0].staff.some((x) => x.perks.length > 0)).toBe(true);
  });

  it('the manager layer is deterministic', () => {
    const script = (seed: number) => {
      const s = ownerAt(seed, 't2');
      for (let d = 0; d < 8; d++) {
        sim.setFocus(s, [d % 2 ? 'speed' : 'walkin']);
        while (s.pendingEvents.length) sim.resolveEvent(s, 0, 1);
        if (sim.campaignStatus(s, 0, 'kidsWeek').ok) sim.startCampaign(s, 0, 'kidsWeek');
        runDay(s);
        sim.closeDay(s);
      }
      return JSON.stringify(s);
    };
    expect(script(141)).toBe(script(141));
    expect(script(141)).not.toBe(script(142));
  });
});
