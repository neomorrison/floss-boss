import { describe, expect, it } from 'vitest';
import type { Clinic, DayPatient, SimEvent } from '../src/core/types';
import { TOOLS } from '../src/data/tools';
import {
  avgNet, barChart, bestTier, dirtLabel, fmtSeconds, moodFromStars, nextPlayerAppointment, noDash, plural,
  summarizeEvents, toolStats, toolTierState, weekdayOf,
} from '../src/ui/logic';
import { canalLine, patientLine } from '../src/ui/lines';

describe('ui logic', () => {
  it('formats seconds as m:ss', () => {
    expect(fmtSeconds(0)).toBe('0:00');
    expect(fmtSeconds(65.4)).toBe('1:05');
    expect(fmtSeconds(-3)).toBe('0:00');
  });

  it('labels dirt levels', () => {
    expect(dirtLabel(0.1).label).toBe('Light');
    expect(dirtLabel(0.5).label).toBe('Moderate');
    expect(dirtLabel(0.7).label).toBe('Heavy');
    expect(dirtLabel(0.95).label).toBe('Gnarly');
  });

  it('maps stars to portrait moods', () => {
    expect(moodFromStars(5)).toBe('wow');
    expect(moodFromStars(4)).toBe('happy');
    expect(moodFromStars(3)).toBe('neutral');
    expect(moodFromStars(1)).toBe('pain');
    expect(moodFromStars(5, true)).toBe('pain');
  });

  it('summarizes "while you were cleaning" events', () => {
    const ev: SimEvent[] = [
      { type: 'paid', clinicId: 'a', patientId: 'p1', amount: 120 },
      { type: 'paid', clinicId: 'b', patientId: 'p2', amount: 90 },
      { type: 'review', clinicId: 'a', stars: 5, text: 'x', name: 'n' },
      { type: 'review', clinicId: 'a', stars: 3, text: 'y', name: 'm' },
      { type: 'walkout', clinicId: 'a', patientId: 'p3', reason: 'wait' },
      { type: 'goalDone', goalId: 'g', text: 'Serve 5 patients' },
      { type: 'achievement', id: 'first', name: 'First Crunch' },
      { type: 'levelUp', level: 3 },
    ];
    const s = summarizeEvents(ev, ['a']);
    expect(s.served).toBe(2);
    expect(s.revenue).toBe(120);
    expect(s.reviews).toBe(2);
    expect(s.reviewStars).toBe(4);
    expect(s.fiveStars).toBe(1);
    expect(s.walkouts).toBe(1);
    expect(s.goals).toEqual(['Serve 5 patients']);
    expect(s.achievements).toEqual(['First Crunch']);
    expect(s.levelUps).toBe(1);
  });

  it('finds the next appointment for the player chair', () => {
    const p = (id: string, apptMin: number, state: DayPatient['state'], mine = true) => ({ id, apptMin, state, isPlayerPatient: mine, staffId: null }) as unknown as DayPatient;
    const clinic = { patients: [p('a', 600, 'gone'), p('b', 700, 'scheduled'), p('c', 650, 'scheduled', false), p('d', 690, 'waiting')] } as unknown as Clinic;
    expect(nextPlayerAppointment(clinic)?.id).toBe('d');
    expect(nextPlayerAppointment(null)).toBeNull();
  });

  it('averages recent net', () => {
    const r = [{ net: 100 }, { net: -50 }, { net: 200 }] as never[];
    expect(avgNet(r, 2)).toBe(75);
    expect(avgNet([], 7)).toBe(0);
  });

  it('builds bar geometry around a zero line', () => {
    const g = barChart([100, -50, 0], 300, 120, { t: 10, r: 10, b: 20, l: 10 }, 3);
    expect(g.bars).toHaveLength(3);
    expect(g.bars[0].positive).toBe(true);
    expect(g.bars[1].positive).toBe(false);
    expect(g.bars[0].y + g.bars[0].h).toBeCloseTo(g.zeroY, 5);
    expect(g.bars[1].y).toBeCloseTo(g.zeroY, 5);
    expect(g.bars[2].h).toBe(0);
    // right-aligned into 14 slots when there are fewer values
    const g2 = barChart([10], 140, 100, { t: 0, r: 0, b: 0, l: 0 }, 14);
    expect(g2.bars[0].x).toBeGreaterThan(120);
  });

  it('knows tool tier states and stat deltas', () => {
    expect(toolTierState(2, 1)).toBe('owned');
    expect(toolTierState(2, 2)).toBe('inUse');
    expect(toolTierState(2, 3)).toBe('buy');
    expect(toolTierState(2, 4)).toBe('locked');
    const cur = bestTier('scaler', 1);
    const next = TOOLS.scaler[1];
    const st = toolStats('scaler', next, cur);
    const gum = st.find((x) => x.label === 'Gum risk')!;
    expect(gum.delta).toBeLessThan(0);
    expect(gum.better).toBe(true);
    const tartar = st.find((x) => x.label === 'Tartar')!;
    expect(tartar.better).toBe(true);
    expect(toolStats('scaler', cur, cur).every((x) => x.better === null)).toBe(true);
  });

  it('counts weekdays from day 1 = Monday', () => {
    expect(weekdayOf(1)).toBe(0);
    expect(weekdayOf(5)).toBe(4);
    expect(weekdayOf(6)).toBe(0);
  });

  it('pluralizes and strips em dashes', () => {
    expect(plural(1, 'patient')).toBe('1 patient');
    expect(plural(3, 'patient')).toBe('3 patients');
    expect(noDash('Great — really')).toBe('Great, really');
  });

  it('character lines are stable and dash free', () => {
    const a = canalLine(5, false, 'seed');
    expect(a).toBe(canalLine(5, false, 'seed'));
    for (let s = 1; s <= 5; s++) {
      for (const seed of ['a', 'b', 'c', 'd']) {
        expect(canalLine(s, false, seed)).not.toMatch(/—/);
        expect(patientLine('kid', s, false, seed)).not.toMatch(/—/);
      }
    }
    expect(patientLine('regular', 3, true, 'x').length).toBeGreaterThan(0);
  });
});
