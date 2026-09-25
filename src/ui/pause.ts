// Auto-pause and quiet overlays (owner follow-up): what holds the clock, which key events stop the game
// with a notice, and the per-location tally that replaces toasts from locations off screen.
// Pure (no DOM): unit tested in tests/ui.pause.test.ts.
import { money } from '../core/format';
import type { GameState, Phase, SimEvent } from '../core/types';
import { plural } from './logic';

// ---------------------------------------------------------------- clock hold

export type HoldReason = 'clean' | 'hidden' | 'notice' | 'huddle' | 'modal' | 'panel' | null;

export interface HoldInput {
  cleaning: boolean;   // the hands-on clean is on screen
  hidden: boolean;     // the tab is in the background
  notice: boolean;     // a key event notice waits for Resume
  huddle: boolean;     // the Morning Huddle has not opened the doors yet
  modals: number;      // any modal: result, level up, op panel, staff card, patient card, confirm
  panel: boolean;      // Tools, Skills, Staff, Office, Finance, Goals or Settings
}

/** Why the clock is held right now, or null when it runs at the chosen speed. Every phase, owner included. */
export function holdReason(i: HoldInput): HoldReason {
  if (i.cleaning) return 'clean';
  if (i.hidden) return 'hidden';
  if (i.notice) return 'notice';
  if (i.huddle) return 'huddle';
  if (i.modals > 0) return 'modal';
  if (i.panel) return 'panel';
  return null;
}

/** Tooltip on the clock while it is held. */
export function holdLabel(r: HoldReason): string {
  switch (r) {
    case 'notice': return 'Paused until you resume';
    case 'huddle': return 'Paused for the Morning Huddle';
    case 'modal':
    case 'panel': return 'Paused while a menu is open';
    case 'clean': return 'Paused while you clean';
    case 'hidden': return 'Paused';
    default: return '';
  }
}

/** Key events stop the clock unless the player turned it off (undefined = on). */
export function autoPauseOn(s: Pick<GameState, 'settings'> | null | undefined): boolean {
  return s?.settings?.autoPause !== false;
}

export function autoRaiseOn(s: Pick<GameState, 'settings'> | null | undefined): boolean {
  return !!s?.settings?.autoRaise;
}

/** Write game settings (saved with the game), keeping the others. */
export function setGameSettings(s: Pick<GameState, 'settings'>, patch: Partial<GameState['settings']>): void {
  s.settings = { ...(s.settings ?? { autoHuddle: false }), ...patch };
}

/** Owner phase: review, walkout and payment effects show only for the location on screen. */
export function onScreen(phase: Phase, activeClinicId: string | null | undefined, clinicId: string): boolean {
  if (phase !== 'owner') return true;
  return !activeClinicId || clinicId === activeClinicId;
}

// ---------------------------------------------------------------- per-location tally

export interface Tally { paid: number; revenue: number; reviews: number; stars: number; low: number; walkouts: number }

export function emptyTally(): Tally {
  return { paid: 0, revenue: 0, reviews: 0, stars: 0, low: 0, walkouts: 0 };
}

/** Payments, reviews and walkouts at locations off screen since the player last looked at them. */
export class Tallies {
  private map = new Map<string, Tally>();

  /** Count `events` from owned locations other than `activeId`. Returns true when a tally changed. */
  add(events: SimEvent[], activeId: string | null, owned: string[]): boolean {
    let changed = false;
    for (const e of events) {
      if (e.type !== 'paid' && e.type !== 'review' && e.type !== 'walkout') continue;
      if (e.clinicId === activeId || !owned.includes(e.clinicId)) continue;
      let t = this.map.get(e.clinicId);
      if (!t) { t = emptyTally(); this.map.set(e.clinicId, t); }
      if (e.type === 'paid') { t.paid++; t.revenue += Math.max(0, e.amount); }
      else if (e.type === 'review') { t.reviews++; t.stars += e.stars; if (e.stars <= 2) t.low++; }
      else t.walkouts++;
      changed = true;
    }
    return changed;
  }

  get(id: string): Tally | null {
    const t = this.map.get(id);
    return t && (t.paid || t.reviews || t.walkouts) ? t : null;
  }

  clear(id: string): void { this.map.delete(id); }
  clearAll(): void { this.map.clear(); }

  /** Cheap signature for re-render checks. */
  key(): string {
    return [...this.map.entries()].map(([id, t]) => `${id}:${t.paid}:${t.reviews}:${t.walkouts}`).join(',');
  }
}

export interface TallyView { cash: string; stars: string; walkouts: number; tone: 'good' | 'bad' | ''; title: string }

/** What the location tab shows for a tally: takings, average review, walkouts, and a sentence for the tooltip. */
export function tallyView(t: Tally | null): TallyView | null {
  if (!t || !(t.paid || t.reviews || t.walkouts)) return null;
  const avg = t.reviews ? t.stars / t.reviews : 0;
  const parts: string[] = [];
  if (t.paid) parts.push(`${plural(t.paid, 'patient')} paid ${money(Math.round(t.revenue))}`);
  if (t.reviews) parts.push(`${plural(t.reviews, 'review')}, ${avg.toFixed(1)} average`);
  if (t.walkouts) parts.push(plural(t.walkouts, 'walkout'));
  return {
    cash: t.revenue > 0 ? `+${money(Math.round(t.revenue))}` : '',
    stars: t.reviews ? avg.toFixed(1) : '',
    walkouts: t.walkouts,
    tone: t.walkouts || t.low ? 'bad' : avg >= 4 ? 'good' : '',
    title: `Since you last looked: ${parts.join(', ')}`,
  };
}

// ---------------------------------------------------------------- key event notices

export type NoticeKind = 'quit' | 'raise' | 'perk' | 'chair';
/** Shown in this order when several are waiting. */
export const NOTICE_ORDER: NoticeKind[] = ['quit', 'raise', 'perk', 'chair'];

export interface NoticeItem {
  id: string;          // staff id (quit, raise, perk) or patient id (chair)
  clinicId: string;
  name?: string;
  ask?: number;
}
export interface Notice { kind: NoticeKind; items: NoticeItem[] }

/**
 * One notice per kind waits in the queue and collects its items (three raise requests at the close become
 * one notice). The notice on screen is taken out of the queue, so an item arriving meanwhile starts a new one.
 */
export class NoticeQueue {
  private queue: Notice[] = [];
  private shown: Notice | null = null;

  /** Add an item. Returns false when it is already waiting or on screen. */
  push(kind: NoticeKind, item: NoticeItem): boolean {
    if (this.shown?.kind === kind && this.shown.items.some((x) => x.id === item.id)) return false;
    let n = this.queue.find((x) => x.kind === kind);
    if (!n) { n = { kind, items: [] }; this.queue.push(n); }
    const i = n.items.findIndex((x) => x.id === item.id);
    if (i >= 0) { n.items[i] = { ...n.items[i], ...item }; return false; }
    n.items.push(item);
    return true;
  }

  /** Take the next notice (by NOTICE_ORDER) with the items that still matter; drops notices with none left. */
  next(relevant: (kind: NoticeKind, item: NoticeItem) => boolean): Notice | null {
    this.queue.sort((a, b) => NOTICE_ORDER.indexOf(a.kind) - NOTICE_ORDER.indexOf(b.kind));
    while (this.queue.length) {
      const n = this.queue.shift()!;
      const items = n.items.filter((it) => relevant(n.kind, it));
      if (items.length) { this.shown = { kind: n.kind, items }; return this.shown; }
    }
    return null;
  }

  /** The notice on screen was dismissed. */
  done(): void { this.shown = null; }

  get showing(): Notice | null { return this.shown; }
  get size(): number { return this.queue.length; }
  clear(): void { this.queue = []; this.shown = null; }
}

/** A raise as the notice shows it: "+12%". */
export function raisePct(salary: number, ask: number): string {
  if (!(salary > 0) || !(ask > salary)) return '';
  return `+${Math.round((ask / salary - 1) * 100)}%`;
}
