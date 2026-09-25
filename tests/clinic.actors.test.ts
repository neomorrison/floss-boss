import { describe, expect, it } from 'vitest';
import { layoutFor } from '../src/clinic/layout';
import { Actors } from '../src/clinic/actors';
import { C } from '../src/clinic/palette';
import { PLAYER_ID } from '../src/core/constants';
import type { Clinic, DayPatient, Operatory, PatientState } from '../src/core/types';

// vitest runs this suite in a DOM-less 'node' environment (vitest.config.ts), but Actors.sync() builds
// real Person rigs (src/clinic/people.ts), which lazily bake a few canvas textures (src/clinic/palette.ts:
// blobTexture and friends) the first time a material is needed. A bottomless no-op stands in for
// `document` here so those canvas 2D calls have somewhere harmless to land; nothing in this file reads
// pixels back, so the stub never needs to draw anything real.
function noop(): any {
  const fn: any = function bottomless() { return fn; };
  return new Proxy(fn, {
    get(target, prop) { return prop in target ? (target as any)[prop] : noop(); },
    set(target, prop, value) { (target as any)[prop] = value; return true; },
    apply() { return noop(); },
  });
}
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop() }) };

const L = layoutFor('t2');

function patient(id: string, state: PatientState, extra: Partial<DayPatient> = {}): DayPatient {
  return {
    id, name: 'Pat ' + id, archetype: 'regular', portrait: 'regular', service: 'cleaning', addons: [], apptMin: 540,
    walkIn: false, state, since: 540, until: null, seat: null, opId: null, staffId: null, awaitingPlayer: false,
    arrivedMin: 540, waitedMin: 0, patience: 45, dirtLevel: 0.5, quality: null, comfort: null, stars: null,
    fee: 120, tip: 0, isPlayerPatient: false, mood: 'ok', caseType: 'routine', twists: [], bonus: null, vip: false, ...extra,
  };
}
function clinic(id: string, patients: DayPatient[]): Clinic {
  return {
    id, name: 'Test ' + id, tier: 't2', ownedByPlayer: true, ops: [], equipment: [], staff: patients.length ? [] : [],
    prices: { cleaning: 1, deep: 1, fluoride: 1, sealant: 1, xray: 1, whitening: 1, exam: 1, filling: 1 },
    marketing: 0, rating: 4, reviews: [], served: 0, patients,
    day: { booked: 0, demand: 0, turnedAway: 0, noShows: 0, walkIns: 0, served: 0, walkouts: 0, revenue: 0, tips: 0, supplies: 0, addonsSold: 0, fiveStars: 0, handsOn: 0 },
    checkinBusyUntil: 0, modifiers: [], campaign: null, campaignCooldownUntil: 0, district: 'downtown',
  };
}

// out/fix/followup.md: "when you have multiple locations, the stars and $ sign from patients leaving
// appears on the screen overlayed". Two same-tier locations share the identical cached ClinicLayout
// object, so a layout-identity check alone cannot tell the view switched; Actors must also key off
// Clinic.id (out/fix/clinic.md multi-location overlay bug).
describe('Actors: multi-location switch', () => {
  it('drops a departed patient\'s pending pay and stars instead of flushing them at the next location', () => {
    const actors = new Actors();
    const a = clinic('clinic-a', [patient('p1', 'checkout')]);
    actors.sync(a, L, 540, 0.1, false, 5);
    expect(actors.patients.has('p1')).toBe(true);

    // the sim billed and reviewed p1 just before the player switched away: both pops are still pending,
    // waiting for the actor to visually reach the checkout desk (deferReview returns null while it's
    // still queued; it only returns the actor for an immediate pop when they already paid or walked out).
    expect(actors.deferPaid('p1', 120)).toBe(true);
    expect(actors.deferReview('Pat p1', 5)).toBeNull();
    const p1 = actors.patients.get('p1')!;
    expect(p1.pendingPaid).toBe(120);
    expect(p1.pendingStars).toBe(5);

    // switch to a different (same-tier) location: p1 is not in clinic b's roster at all.
    const b = clinic('clinic-b', [patient('q1', 'waiting')]);
    actors.sync(b, L, 540, 0.1, true, 5);

    expect(actors.patients.has('p1')).toBe(false);
    expect(actors.patients.has('q1')).toBe(true);
    // nothing from clinic a should have popped a coin/star effect for clinic b to show.
    expect(actors.effects.length).toBe(0);
  });

  it('keeps flushing pay normally within the same location (no regression)', () => {
    const actors = new Actors();
    const a = clinic('clinic-a', [patient('p1', 'checkout')]);
    actors.sync(a, L, 540, 0.1, false, 5);
    expect(actors.deferPaid('p1', 120)).toBe(true);

    // the patient leaves for good within the SAME clinic (sim dropped them, e.g. the day ended and it
    // moved them past 'gone'): this is the real "reached checkout, then vanished" path and should still
    // flush once the actor finishes walking out (dwell at the desk, then the walk to the door).
    const stillHere = clinic('clinic-a', []);
    let minute = 541;
    for (let i = 0; i < 400 && actors.patients.has('p1'); i++) {
      actors.sync(stillHere, L, minute, 0.1, true, 5);
      minute += 0.1;
    }

    expect(actors.patients.has('p1')).toBe(false);
    expect(actors.effects.length).toBe(1);
    expect(actors.effects[0].paid).toBe(120);
  });
});

// DESIGN 11.6: the rap star VIP gets dreadlocks and a gold chain in the diorama (sunglasses come for
// free from the existing VIP accessory, since a rapper visit is always vip).
describe('Actors: rapper look (DESIGN 11.6)', () => {
  it('gives a rapper patient dreadlocks and a gold chain, and drops them for anyone else', () => {
    const actors = new Actors();
    const rapper = patient('r1', 'waiting', { archetype: 'rapper', vip: true });
    const regular = patient('n1', 'waiting');
    actors.sync(clinic('c1', [rapper, regular]), L, 540, 0.1, false, 5);

    const ra = actors.patients.get('r1')!;
    expect(ra.dreads).not.toBeNull();
    expect(ra.chain).not.toBeNull();
    expect(ra.glasses).not.toBeNull();   // vip: true, the existing VIP accessory

    const na = actors.patients.get('n1')!;
    expect(na.dreads).toBeNull();
    expect(na.chain).toBeNull();
  });

  it('ties dreadlocks and the chain to the archetype, not to vip status', () => {
    const actors = new Actors();
    const rapper = patient('r1', 'waiting', { archetype: 'rapper', vip: false });
    actors.sync(clinic('c1', [rapper]), L, 540, 0.1, false, 5);
    const ra = actors.patients.get('r1')!;
    expect(ra.dreads).not.toBeNull();
    expect(ra.chain).not.toBeNull();
    expect(ra.glasses).toBeNull();   // vip: false here, so no sunglasses even though dreads/chain show
  });
});

// DESIGN 11.4: the Gold Scrubs legacy perk tints the player's own scrubs.
describe('Actors: player gold scrubs (DESIGN 11.4)', () => {
  function op(staffId: string | null): Operatory {
    return { id: 'op0', slot: 0, chair: 'basic', upgrades: [], staffId, assistantId: null, patientId: null, playerMode: 'hands' };
  }
  function withPlayerOp(): Clinic {
    const c = clinic('c1', []);
    c.ops = [op(PLAYER_ID)];
    return c;
  }

  it('creates the player with the default scrubs color by default', () => {
    const actors = new Actors();
    actors.sync(withPlayerOp(), L, 540, 0.1, false, 5);
    const player = actors.staff.get(PLAYER_ID)!;
    expect(player.tint.scrubs).toBe('#FF7AA8');
  });

  it('retints the player live when the flag turns on after the actor already exists', () => {
    const actors = new Actors();
    actors.sync(withPlayerOp(), L, 540, 0.1, false, 5);
    actors.setPlayerGold(true);
    const player = actors.staff.get(PLAYER_ID)!;
    expect(player.tint.scrubs).toBe(C.sunshine);
  });

  it('creates the player already gold when the flag was set before the actor existed', () => {
    const actors = new Actors();
    actors.setPlayerGold(true);
    actors.sync(withPlayerOp(), L, 540, 0.1, false, 5);
    const player = actors.staff.get(PLAYER_ID)!;
    expect(player.tint.scrubs).toBe(C.sunshine);
  });
});
