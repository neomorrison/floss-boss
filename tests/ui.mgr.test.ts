import { describe, expect, it } from 'vitest';
import type { ClinicModifier, DayPatient } from '../src/core/types';
import { CAMPAIGNS, EVENTS, FOCUSES, PERKS } from '../src/data/manager';
import { EQUIPMENT, EQUIP_ORDER } from '../src/data/upgrades';
import {
  activeModifiers, bestTier, campaignSummary, daysLeft, daysLeftLabel, effectSummary, endingOn, equipmentByTier, fillVars,
  focusLockReason, modifierKey, modifierSource, myDay, outcomeTone, perksForRole, rangeLabel, saleOff, specialtyOf, tierAtLeast, toggleFocus,
} from '../src/ui/mgrlogic';

const mod = (id: string, untilDay: number | null, extra: Partial<ClinicModifier> = {}): ClinicModifier =>
  ({ id, label: id, source: id.split(':')[0] as ClinicModifier['source'], untilDay, ...extra });

describe('manager ui logic', () => {
  it('reads modifier ids', () => {
    expect(modifierKey('event:puppy:12')).toBe('puppy');
    expect(modifierKey('campaign:kidsWeek:7')).toBe('kidsWeek');
    expect(modifierSource({ id: 'focus:speed:9' })).toBe('focus');
    expect(modifierSource({ id: 'campaign:x:1' })).toBe('campaign');
    expect(modifierSource({ id: 'weird' })).toBe('event');
  });

  it('counts days left including today', () => {
    expect(daysLeft(12, 10)).toBe(3);
    expect(daysLeft(10, 10)).toBe(1);
    expect(daysLeft(null, 10)).toBeNull();
    expect(daysLeftLabel(10, 10)).toBe('Last day');
    expect(daysLeftLabel(12, 10)).toBe('3 days left');
    expect(daysLeftLabel(null, 10)).toBe('For good');
  });

  it('keeps active modifiers and groups them by source', () => {
    const mods = [mod('focus:speed:10', 10), mod('campaign:kidsWeek:8', 12), mod('event:flu:7', 9), mod('event:puppy:3', null)];
    const act = activeModifiers(mods, 10);
    expect(act.map((m) => m.id)).toEqual(['event:puppy:3', 'campaign:kidsWeek:8', 'focus:speed:10']);
    expect(endingOn(mods, 12).map((m) => m.id)).toEqual(['campaign:kidsWeek:8']);
  });

  it('summarizes effects in sentence case', () => {
    expect(effectSummary({ demand: 1.15, caseBoost: { candy: 3 } })).toBe('Demand +15%, sugar bug cases x3');
    expect(effectSummary({ fees: 0.9, demand: 1.25 })).toBe('Demand +25%, fees -10%');
    expect(effectSummary({ walkins: 3 })).toBe('Walk-ins x3');
    expect(effectSummary({})).toBe('');
    for (const c of Object.values(CAMPAIGNS)) expect(campaignSummary(c).length).toBeGreaterThan(5);
  });

  it('fills event text vars with fallbacks', () => {
    expect(fillVars('It is {staff}\'s birthday at {clinic}.', { staff: 'Ava' }, { clinic: 'Main St' })).toBe('It is Ava\'s birthday at Main St.');
    expect(fillVars('A pipe burst in {op}.', {})).toBe('A pipe burst in an operatory.');
    // every catalog text fills without leftover braces
    for (const e of EVENTS) {
      const vars = { staff: 'Ava', clinic: 'Main St', op: 'Operatory 2', equip: 'Fish Tank' };
      expect(fillVars(e.text, vars)).not.toMatch(/[{}]/);
      for (const c of e.choices) { expect(fillVars(c.label, vars)).not.toMatch(/[{}]/); expect(fillVars(c.hint, vars)).not.toMatch(/[{}]/); }
    }
  });

  it('reads the tone of an event outcome', () => {
    const inspector = EVENTS.find((e) => e.id === 'inspector')!;
    expect(outcomeTone(inspector.choices[1], 'Fined for a dusty sterilizer.')).toBe('bad');
    expect(outcomeTone(inspector.choices[1], 'The inspector found nothing.')).toBe('good');
    expect(outcomeTone(inspector.choices[0], 'Done')).toBe('good');
    const flu = EVENTS.find((e) => e.id === 'flu')!;
    expect(outcomeTone(flu.choices[1], '')).toBe('bad');
    const celeb = EVENTS.find((e) => e.id === 'celebrity')!;
    expect(outcomeTone(celeb.choices[1], '')).toBe('neutral');
    expect(outcomeTone(undefined, '')).toBe('neutral');
  });

  it('handles tiers and focus locks', () => {
    expect(bestTier(['t1', 't3', 't2'])).toBe('t3');
    expect(bestTier([])).toBe('t1');
    expect(tierAtLeast('t2', 't2')).toBe(true);
    expect(tierAtLeast('t1', 't2')).toBe(false);
    const name = (t: string) => ({ t1: 'Strip Mall Suite', t2: 'Main Street Office', t3: 'Medical Plaza', t4: 'Smile Tower' } as Record<string, string>)[t];
    expect(focusLockReason(FOCUSES.upsell, 't1', name)).toBe('Needs Main Street Office');
    expect(focusLockReason(FOCUSES.speed, 't1', name)).toBe('');
  });

  it('toggles focus picks within the slot count', () => {
    expect(toggleFocus(['steady'], 'speed', 1)).toEqual(['speed']);
    expect(toggleFocus(['speed'], 'speed', 1)).toEqual(['speed']);
    expect(toggleFocus(['speed'], 'quality', 2)).toEqual(['speed', 'quality']);
    expect(toggleFocus(['speed', 'quality'], 'team', 2)).toEqual(['quality', 'team']);
    expect(toggleFocus(['speed', 'quality'], 'speed', 2)).toEqual(['quality']);
  });

  it('offers perks by role and finds specialties', () => {
    const recep = perksForRole(PERKS, 'receptionist');
    expect(recep).toContain('speedDemon');
    expect(recep).not.toContain('whiteningPro');
    expect(perksForRole(PERKS, 'hygienist', ['mentor'])).not.toContain('mentor');
    expect(specialtyOf(['whiteningPro', 'mentor', 'deepDiver'], PERKS)).toEqual(['whitening', 'deep']);
  });

  it('labels hire board ranges', () => {
    expect(rangeLabel([40, 70], 55)).toBe('40–70');
    expect(rangeLabel([90, 120], 95)).toBe('90–100');
    expect(rangeLabel(undefined, 55.4)).toBe('55');
  });

  it('groups equipment by the tier that unlocks it', () => {
    const groups = equipmentByTier(EQUIP_ORDER, (id) => EQUIPMENT[id].minTier);
    expect(groups.map((g) => g.tier)).toEqual(['t1', 't2', 't3', 't4']);
    expect(groups.reduce((n, g) => n + g.ids.length, 0)).toBe(EQUIP_ORDER.length);
    expect(groups[3].ids).toContain('helipad');
  });

  it('spots a sale beyond Bulk Buyer', () => {
    expect(saleOff(2000, 2000, 1)).toBe(0);
    expect(saleOff(1800, 2000, 0.9)).toBe(0);
    expect(saleOff(1200, 2000, 1)).toBe(40);
    expect(saleOff(1080, 2000, 0.9)).toBe(40);
  });

  it('counts the employee’s own shift', () => {
    const p = (o: Partial<DayPatient>): DayPatient => ({ isPlayerPatient: true, staffId: 'player', state: 'gone', stars: null, quality: 0.8, ...o } as DayPatient);
    const day = myDay([
      p({ stars: 5 }), p({ stars: 4 }), p({ stars: null }),
      p({ state: 'gone', quality: null, stars: 1 }),        // walked out
      p({ isPlayerPatient: false, staffId: 'x1', stars: 5 }), // a colleague's
      p({ state: 'noshow', quality: null }),
    ]);
    expect(day.seen).toBe(3);
    expect(day.fiveStars).toBe(1);
    expect(day.walkouts).toBe(1);
    expect(day.avgStars).toBeCloseTo(4.5);
  });
});
