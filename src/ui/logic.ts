// Pure UI helpers (no DOM): labels, summaries, chart geometry. Unit tested in tests/ui.test.ts.
import type { Clinic, DayPatient, DayReport, SimEvent, ToolSlot } from '../core/types';
import type { Mood } from '../data/assets';
import { TOOLS, type ToolTier } from '../data/tools';

export function fmtSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function dirtLabel(level: number): { label: string; tone: 'mint' | 'sun' | 'coral' | 'gum' } {
  if (level < 0.3) return { label: 'Light', tone: 'mint' };
  if (level < 0.55) return { label: 'Moderate', tone: 'sun' };
  if (level < 0.8) return { label: 'Heavy', tone: 'coral' };
  return { label: 'Gnarly', tone: 'gum' };
}

export function moodFromStars(stars: number, walkout = false): Mood {
  if (walkout) return 'pain';
  if (stars >= 5) return 'wow';
  if (stars >= 4) return 'happy';
  if (stars >= 3) return 'neutral';
  return 'pain';
}

export function moodFromPatient(p: Pick<DayPatient, 'mood'>): Mood {
  return p.mood === 'happy' ? 'happy' : p.mood === 'ok' ? 'neutral' : 'pain';
}

export interface EventSummary {
  served: number;
  revenue: number;
  reviews: number;
  reviewStars: number;     // average, 0 when none
  fiveStars: number;
  walkouts: number;
  goals: string[];
  achievements: string[];
  levelUps: number;
  quits: string[];
  raises: string[];
}

/** Summarize a batch of SimEvents. Only `paid` events from `ownedClinicIds` count as revenue. */
export function summarizeEvents(events: SimEvent[], ownedClinicIds: string[] = []): EventSummary {
  const s: EventSummary = { served: 0, revenue: 0, reviews: 0, reviewStars: 0, fiveStars: 0, walkouts: 0, goals: [], achievements: [], levelUps: 0, quits: [], raises: [] };
  let starSum = 0;
  for (const e of events) {
    switch (e.type) {
      case 'paid':
        s.served++;
        if (ownedClinicIds.includes(e.clinicId)) s.revenue += e.amount;
        break;
      case 'review':
        s.reviews++; starSum += e.stars; if (e.stars >= 5) s.fiveStars++;
        break;
      case 'walkout': s.walkouts++; break;
      case 'goalDone': s.goals.push(e.text); break;
      case 'achievement': s.achievements.push(e.name); break;
      case 'levelUp': s.levelUps++; break;
      case 'staffQuit': s.quits.push(e.name); break;
      case 'raiseRequest': s.raises.push(e.name); break;
      default: break;
    }
  }
  s.reviewStars = s.reviews ? starSum / s.reviews : 0;
  return s;
}

/** The next scheduled appointment for the player's chair, or null. */
export function nextPlayerAppointment(clinic: Clinic | null): DayPatient | null {
  if (!clinic) return null;
  let best: DayPatient | null = null;
  for (const p of clinic.patients) {
    if (!p.isPlayerPatient && p.staffId !== 'player') continue;
    if (p.state !== 'scheduled' && p.state !== 'entering' && p.state !== 'checkin' && p.state !== 'waiting' && p.state !== 'toChair') continue;
    if (!best || p.apptMin < best.apptMin) best = p;
  }
  return best;
}

export function avgNet(reports: DayReport[], n: number): number {
  const r = reports.slice(-n);
  if (!r.length) return 0;
  return r.reduce((s, x) => s + x.net, 0) / r.length;
}

export interface BarGeom { x: number; y: number; w: number; h: number; value: number; positive: boolean }
/** Bar chart geometry for values around a zero line, inside w x h with padding. */
export function barChart(values: number[], w: number, h: number, pad = { t: 10, r: 8, b: 22, l: 8 }, slots = values.length): { bars: BarGeom[]; zeroY: number; max: number; min: number } {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const innerH = h - pad.t - pad.b;
  const innerW = w - pad.l - pad.r;
  const n = Math.max(1, slots);
  const slot = innerW / n;
  const bw = Math.max(4, slot * 0.64);
  const zeroY = pad.t + (max / span) * innerH;
  const offset = n - values.length;
  const bars = values.map((v, i) => {
    const bh = (Math.abs(v) / span) * innerH;
    const x = pad.l + (i + offset) * slot + (slot - bw) / 2;
    return { x, y: v >= 0 ? zeroY - bh : zeroY, w: bw, h: Math.max(v === 0 ? 0 : 2, bh), value: v, positive: v >= 0 };
  });
  return { bars, zeroY, max, min };
}

export type TierState = 'inUse' | 'owned' | 'buy' | 'locked';
export function toolTierState(ownedTier: number, tier: number): TierState {
  if (tier === ownedTier) return 'inUse';
  if (tier < ownedTier) return 'owned';
  if (tier === ownedTier + 1) return 'buy';
  return 'locked';
}

export interface StatDelta { label: string; value: string; delta: number; better: boolean | null }
/** Stat lines for a tool tier, with deltas against the tier in use. */
export function toolStats(slot: ToolSlot, tier: ToolTier, current: ToolTier): StatDelta[] {
  const row = (label: string, a: number, b: number, higherIsBetter = true, fmt = (n: number) => `x${n.toFixed(2).replace(/0$/, '')}`): StatDelta => {
    const d = a - b;
    return { label, value: fmt(a), delta: d, better: Math.abs(d) < 1e-6 ? null : (d > 0) === higherIsBetter };
  };
  switch (slot) {
    case 'scaler': return [row('Tartar', tier.tartar, current.tartar), row('Plaque', tier.plaque, current.plaque), row('Reach', tier.radius, current.radius), row('Gum risk', tier.gumRisk, current.gumRisk, false)];
    case 'polisher': return [row('Plaque', tier.plaque, current.plaque), row('Stain', tier.stain, current.stain), row('Shine', tier.polish, current.polish), row('Reach', tier.radius, current.radius)];
    case 'floss': return [row('Power', tier.floss, current.floss)];
    case 'suction': return [row('Drain', tier.drain, current.drain, true, (n) => `${n.toFixed(2)}/s`), row('Pickup', tier.bits, current.bits), row('Reach', tier.radius, current.radius)];
    default: return [row('Spray', tier.water, current.water, true, (n) => `${n.toFixed(2)}/s`)];
  }
}

export function bestTier(slot: ToolSlot, owned: number): ToolTier {
  const list = TOOLS[slot];
  return list[Math.max(0, Math.min(list.length - 1, owned - 1))];
}

/** "Mon", "Tue" ... from DayReport.weekday or a day counter (day 1 = Monday). */
export function weekdayOf(day: number): number {
  return ((day - 1) % 5 + 5) % 5;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Remove em dashes from any string that reaches the screen (sim text included). */
export function noDash(s: string): string {
  return s.replace(/\s*\u2014\s*/g, ', ');
}
