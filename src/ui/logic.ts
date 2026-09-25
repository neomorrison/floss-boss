// Pure UI helpers (no DOM): labels, summaries, chart geometry. Unit tested in tests/ui.test.ts.
import type { CaseType, Clinic, DayPatient, DayReport, SimEvent, ToolSlot } from '../core/types';
import type { Mood } from '../data/assets';
import type { SlotId, SlotInfo } from '../core/save';
import { CASES, MASTERY_NAMES, MASTERY_PERKS, MASTERY_TIERS } from '../data/cases';
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

const UPCOMING: DayPatient['state'][] = ['scheduled', 'entering', 'checkin', 'waiting', 'toChair'];

/**
 * The next patient for the player's chair, or null.
 * Employee phase: the player's own bookings. Owner phase (`owner`): any patient not seated yet, since the
 * front desk sends the next waiting patient to the first free chair (yours included).
 */
export function nextPlayerAppointment(clinic: Clinic | null, owner = false): DayPatient | null {
  if (!clinic) return null;
  let best: DayPatient | null = null;
  for (const p of clinic.patients) {
    if (!owner && !p.isPlayerPatient && p.staffId !== 'player') continue;
    if (owner && p.staffId && p.staffId !== 'player') continue;
    if (!UPCOMING.includes(p.state)) continue;
    if (!best || p.apptMin < best.apptMin) best = p;
  }
  return best;
}

/** Patients already in the waiting room (owner chair card: "3 patients waiting"). */
export function waitingCount(clinic: Clinic | null): number {
  return clinic ? clinic.patients.filter((p) => p.state === 'waiting').length : 0;
}

/** Profit of a day without purchases, loans and hiring fees (falls back to the cash change on old saves). */
export function operatingNet(r: DayReport): number {
  const x = r as DayReport & { opNet?: number };
  return x.operatingNet ?? x.opNet ?? x.net;
}

export function avgNet(reports: DayReport[], n: number): number {
  const r = reports.slice(-n);
  if (!r.length) return 0;
  return r.reduce((s, x) => s + operatingNet(x), 0) / r.length;
}

// ---------------------------------------------------------------- cases and mastery (DESIGN 5.9)

export interface MasteryInfo {
  count: number;
  tier: 0 | 1 | 2 | 3;
  name: string;            // Unranked, Bronze, Silver, Gold
  nextName: string | null; // the tier after this one
  nextAt: number | null;   // count needed for the next tier
  prevAt: number;          // count where the current tier started
  frac: number;            // count / nextAt (1 at gold)
  perk: string;            // what the current tier gives
  nextPerk: string | null;
}

/** Mastery tier from a count of 3+ star hands-on cleans. */
export function masteryInfo(count: number, tiers: readonly number[] = MASTERY_TIERS): MasteryInfo {
  const c = Math.max(0, Math.floor(count || 0));
  let tier = 0;
  while (tier < tiers.length && c >= tiers[tier]) tier++;
  const t = tier as 0 | 1 | 2 | 3;
  const nextAt = tier < tiers.length ? tiers[tier] : null;
  const prevAt = tier > 0 ? tiers[tier - 1] : 0;
  // absolute progress (matches the "4/10" label next to the bar)
  const frac = nextAt === null ? 1 : Math.max(0, Math.min(1, c / Math.max(1, nextAt)));
  return {
    count: c, tier: t, name: MASTERY_NAMES[t], nextName: nextAt === null ? null : MASTERY_NAMES[t + 1],
    nextAt, prevAt, frac, perk: MASTERY_PERKS[t], nextPerk: nextAt === null ? null : MASTERY_PERKS[t + 1],
  };
}

export interface QuickGate { ok: boolean; count: number; need: number; label: string; reason: string }

/** Quick clean needs Bronze mastery of the patient's case (DESIGN 5.9). */
export function quickCleanGate(mastery: Partial<Record<CaseType, number>> | undefined, caseType: CaseType): QuickGate {
  const need = MASTERY_TIERS[0];
  const count = Math.max(0, Math.floor(mastery?.[caseType] ?? 0));
  const ok = count >= need;
  const name = CASES[caseType]?.name ?? 'this case';
  return {
    ok, count, need,
    label: ok ? '' : `Bronze needed: ${Math.min(count, need)}/${need}`,
    reason: ok ? '' : `Clean ${need} ${name} patients by hand with 3 stars or more to unlock Quick clean.`,
  };
}

/** Training course window: booked for tomorrow, away today, or neither (the sim's isPresent uses offFrom..offUntilDay). */
export function courseState(st: { offUntilDay: number; offFrom?: number }, day: number): 'none' | 'booked' | 'away' {
  if (!(st.offUntilDay >= day)) return 'none';
  const from = st.offFrom ?? day;
  return from > day ? 'booked' : 'away';
}

/** Shade guide color: 1 (brightest) .. 16 (darkest). */
export function shadeColor(shade: number): string {
  const t = Math.max(0, Math.min(1, (shade - 1) / 15));
  const a = [255, 253, 244];   // bright enamel
  const b = [196, 158, 96];    // coffee yellow
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.pow(t, 0.9)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
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

// ---------------------------------------------------------------- save slots (title screen)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short relative time for a slot's "last played" line ("2 h ago", "Yesterday"). */
export function relativeTime(savedAt: number, now: number = Date.now()): string {
  if (!savedAt) return '';
  const ms = Math.max(0, now - savedAt);
  const min = ms / 60000;
  if (min < 1) return 'Just now';
  if (min < 60) return `${Math.floor(min)} min ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.floor(hr)} h ago`;
  if (hr < 48) return 'Yesterday';
  const day = hr / 24;
  if (day < 7) return `${Math.floor(day)} d ago`;
  const d = new Date(savedAt);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export interface TitleButtons {
  showContinue: boolean;      // "Continue": load the active slot straight in
  showLoadGame: boolean;      // active slot is empty but another slot has a save: open the picker instead
  showSaves: boolean;         // a secondary way into the picker (hidden when Load game already covers it)
  newGameSlot: SlotId | null; // the slot New Game should jump straight into; null when all three are full
}

/** Which title buttons show, from the three slots' state. Pure so it is unit testable without the DOM. */
export function titleButtonState(slots: SlotInfo[], active: SlotId, loaded: boolean): TitleButtons {
  const activeExists = slots.find((s) => s.slot === active)?.exists ?? false;
  const anyExists = slots.some((s) => s.exists);
  const showContinue = loaded && activeExists;
  const showLoadGame = !showContinue && anyExists;
  return {
    showContinue,
    showLoadGame,
    showSaves: anyExists && !showLoadGame,
    newGameSlot: slots.find((s) => !s.exists)?.slot ?? null,
  };
}
