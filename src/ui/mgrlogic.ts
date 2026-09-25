// Pure helpers for the manager layer screens (DESIGN 10): modifier ids and countdowns, effect summaries,
// event text filling, tier locks, hire board ranges, the employee's own day numbers. No DOM, no sim.
// Unit tested in tests/ui.mgr.test.ts.
import type { CaseType, ClinicModifier, DayPatient, EquipId, FocusId, OfficeTierId, PerkId, StaffRole } from '../core/types';
import type { CampaignDef, EventChoice, EventEffect, FocusDef, PerkDef } from '../data/manager';

export const TIER_RANK: Record<OfficeTierId, number> = { t1: 0, t2: 1, t3: 2, t4: 3 };
export function tierAtLeast(have: OfficeTierId, need: OfficeTierId): boolean {
  return (TIER_RANK[have] ?? 0) >= (TIER_RANK[need] ?? 0);
}
/** The biggest office tier among a list (t1 when empty). */
export function bestTier(tiers: OfficeTierId[]): OfficeTierId {
  let best: OfficeTierId = 't1';
  for (const t of tiers) if ((TIER_RANK[t] ?? 0) > TIER_RANK[best]) best = t;
  return best;
}

// ---------------------------------------------------------------- modifiers

export type ModSource = ClinicModifier['source'];

/** Source of a modifier: its `source` field, else the id prefix ('event:puppy:12'). */
export function modifierSource(m: Pick<ClinicModifier, 'id'> & { source?: string }): ModSource {
  const s = m.source ?? m.id.split(':')[0];
  return s === 'campaign' || s === 'focus' ? s : 'event';
}

/** The catalog key of a modifier id ('event:rival:40' -> 'rival'). */
export function modifierKey(id: string): string {
  const parts = id.split(':');
  return parts.length >= 2 ? parts[1] : parts[0];
}

/** Days a modifier or campaign still applies, counting today (untilDay is the last day). null = permanent. */
export function daysLeft(untilDay: number | null | undefined, day: number): number | null {
  if (untilDay === null || untilDay === undefined) return null;
  return Math.max(0, untilDay - day + 1);
}

export function daysLeftLabel(untilDay: number | null | undefined, day: number): string {
  const n = daysLeft(untilDay, day);
  if (n === null) return 'For good';
  if (n <= 1) return 'Last day';
  return `${n} days left`;
}

/** Active modifiers on a clinic (untilDay today or later), grouped by source in the order event, campaign, focus. */
export function activeModifiers(mods: ClinicModifier[] | undefined, day: number): ClinicModifier[] {
  const order: ModSource[] = ['event', 'campaign', 'focus'];
  return (mods ?? [])
    .filter((m) => m.untilDay === null || m.untilDay === undefined || m.untilDay >= day)
    .slice()
    .sort((a, b) => order.indexOf(modifierSource(a)) - order.indexOf(modifierSource(b)));
}

/** Modifiers whose last day is `day` (the day report lists these as "ending tomorrow" after the day closed). */
export function endingOn(mods: ClinicModifier[] | undefined, day: number): ClinicModifier[] {
  return (mods ?? []).filter((m) => m.untilDay === day);
}

const CASE_SHORT: Record<CaseType, string> = {
  routine: 'Routine', candy: 'Sugar bug', whitening: 'Whitening', braces: 'Braces', pirate: 'Pirate', deep: 'Deep cleaning',
  grillz: 'Grill',
};
export function caseShort(ct: CaseType): string {
  return CASE_SHORT[ct] ?? ct;
}

function pctDelta(mult: number): string {
  const d = Math.round((mult - 1) * 100);
  return `${d >= 0 ? '+' : ''}${d}%`;
}

/** "Demand +15%, sugar bug cases x3" for a set of multipliers (1 and missing fields are skipped). */
export function effectSummary(e: {
  demand?: number; fees?: number; supplies?: number; speed?: number; comfort?: number; quality?: number;
  addons?: number; walkins?: number; noShows?: number; caseBoost?: Partial<Record<CaseType, number>>; awareness?: number;
}): string {
  const out: string[] = [];
  const m = (label: string, v: number | undefined) => { if (v !== undefined && Math.abs(v - 1) > 1e-6) out.push(`${label} ${pctDelta(v)}`); };
  m('Demand', e.demand);
  m('Fees', e.fees);
  m('Supplies', e.supplies);
  m('Speed', e.speed);
  m('Comfort', e.comfort);
  if (e.quality !== undefined && Math.abs(e.quality) > 1e-6) out.push(`Quality ${e.quality > 0 ? '+' : ''}${Math.round(e.quality * 100)}%`);
  m('Add-ons', e.addons);
  if (e.walkins !== undefined && Math.abs(e.walkins - 1) > 1e-6) out.push(e.walkins >= 2 ? `Walk-ins x${+e.walkins.toFixed(1)}` : `Walk-ins ${pctDelta(e.walkins)}`);
  m('No-shows', e.noShows);
  for (const [ct, v] of Object.entries(e.caseBoost ?? {}) as [CaseType, number][]) {
    if (v && Math.abs(v - 1) > 1e-6) out.push(`${caseShort(ct)} cases x${+v.toFixed(1)}`);
  }
  if (e.awareness) out.push('More people hear about you');
  const text = out.join(', ');
  return text ? text[0].toUpperCase() + text.slice(1).replace(/, ([A-Z])(?=[a-z])/g, (_x, c: string) => `, ${c.toLowerCase()}`) : '';
}

export function campaignSummary(def: CampaignDef): string {
  return effectSummary({ demand: def.demand, caseBoost: def.caseBoost, awareness: def.awareness });
}

export function modifierSummary(m: ClinicModifier): string {
  const parts: string[] = [];
  const base = effectSummary(m);
  if (base) parts.push(base);
  if (m.closedOpId) parts.push('One operatory closed');
  if (m.openDelay) parts.push(`Opens ${m.openDelay} min late`);
  return parts.join(', ');
}

// ---------------------------------------------------------------- events

/** Fill {staff}, {clinic}, {op}, {equip} ... from the event vars. Unknown keys fall back to `extra`, then a neutral word. */
export function fillVars(text: string, vars: Record<string, string> | undefined, extra: Record<string, string> = {}): string {
  const fallback: Record<string, string> = { staff: 'Your hygienist', clinic: 'your office', op: 'an operatory', equip: 'equipment' };
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => vars?.[k] ?? extra[k] ?? fallback[k] ?? '');
}

/** Tone of an event outcome for sound and color: the chance texts decide, else what the choice does. */
export function outcomeTone(choice: EventChoice | undefined, text: string, fill: (t: string) => string = (t) => t): 'good' | 'bad' | 'neutral' {
  if (!choice) return 'neutral';
  const walk = (effects: EventEffect[]): 'good' | 'bad' | 'neutral' | null => {
    for (const e of effects) {
      if (e.kind === 'chance') {
        if (text && fill(e.loseText) === text) return 'bad';
        if (text && fill(e.winText) === text) return 'good';
        const inner = walk(e.win);
        if (inner) return inner;
      }
    }
    return null;
  };
  const byChance = walk(choice.effects);
  if (byChance) return byChance;
  if (!choice.effects.length) return 'neutral';
  let score = 0;
  for (const e of choice.effects) {
    switch (e.kind) {
      case 'rating': case 'awareness': case 'morale': case 'skill': score += Math.sign(e.delta); break;
      case 'xp': score += 1; break;
      case 'modifier': {
        const up = (e.demand ?? 1) * (e.fees ?? 1) * (e.comfort ?? 1) * (e.speed ?? 1) / (e.supplies ?? 1);
        score += up > 1.001 || Object.keys(e.caseBoost ?? {}).length ? 1 : up < 0.999 ? -1 : 0;
        break;
      }
      case 'vip': case 'tempStaff': case 'discountEquip': case 'freeEquip': score += 1; break;
      case 'quitChance': case 'closeOp': case 'openLate': score -= 1; break;
      case 'cash': score += e.amount > 0 ? 1 : 0; break;
      default: break;
    }
  }
  return score > 0 ? 'good' : score < 0 ? 'bad' : 'neutral';
}

// ---------------------------------------------------------------- focus, perks, hire board

export function focusLockReason(def: FocusDef, have: OfficeTierId, tierName: (t: OfficeTierId) => string): string {
  return tierAtLeast(have, def.minTier) ? '' : `Needs ${tierName(def.minTier)}`;
}

/** Keep a focus selection valid for the number of slots: a new pick replaces the oldest when full. */
export function toggleFocus(current: FocusId[], id: FocusId, slots: number): FocusId[] {
  const n = Math.max(1, slots);
  if (current.includes(id)) {
    // one slot: the pick stays (a focus is always set); two slots: tap again to clear
    return n === 1 ? [id] : current.filter((x) => x !== id);
  }
  const next = [...current, id];
  return next.slice(Math.max(0, next.length - n));
}

/** Perks a role can be offered (debug and fallbacks), skipping ones already owned. */
export function perksForRole(perks: Record<PerkId, PerkDef>, role: StaffRole, owned: PerkId[] = []): PerkId[] {
  return (Object.keys(perks) as PerkId[]).filter((id) => perks[id].roles.includes(role) && !owned.includes(id));
}

/** A case perk makes the owner a specialist of that case type. */
export function specialtyOf(perks: PerkId[] | undefined, defs: Record<PerkId, PerkDef>): CaseType[] {
  return (perks ?? []).map((p) => defs[p]?.caseType).filter((c): c is CaseType => !!c);
}

/** Stat range label for an uninterviewed candidate ("40-70"). */
export function rangeLabel(r: [number, number] | undefined, exact: number): string {
  if (!r) return String(Math.round(exact));
  const lo = Math.max(0, Math.round(Math.min(r[0], r[1])));
  const hi = Math.min(100, Math.round(Math.max(r[0], r[1])));
  return `${lo}–${hi}`;
}

// ---------------------------------------------------------------- equipment

/** Equipment ids grouped by the office tier that unlocks them, in catalog order. */
export function equipmentByTier(order: EquipId[], minTier: (id: EquipId) => OfficeTierId): { tier: OfficeTierId; ids: EquipId[] }[] {
  const tiers: OfficeTierId[] = ['t1', 't2', 't3', 't4'];
  return tiers.map((tier) => ({ tier, ids: order.filter((id) => minTier(id) === tier) })).filter((g) => g.ids.length);
}

/** Percent off beyond the always-on Bulk Buyer discount (a salesman event deal), 0 when none. */
export function saleOff(price: number, base: number, bulk: number): number {
  const regular = Math.round(base * bulk);
  if (!(price < regular - 0.5) || regular <= 0) return 0;
  return Math.round((1 - price / regular) * 100);
}

// ---------------------------------------------------------------- employee day report

export interface MyDay { seen: number; fiveStars: number; walkouts: number; avgStars: number; reviews: number }

/** The player's own shift numbers from the day's patients (employee phase). */
export function myDay(patients: Pick<DayPatient, 'isPlayerPatient' | 'staffId' | 'state' | 'stars' | 'quality'>[]): MyDay {
  const mine = patients.filter((p) => p.isPlayerPatient || p.staffId === 'player');
  const done = ['toDesk', 'checkout', 'exiting', 'gone'];
  // a walkout ends 'gone' too, but never got a quality score
  const served = mine.filter((p) => done.includes(p.state) && p.quality !== null && p.quality !== undefined);
  const seen = served.length;
  const walkouts = mine.filter((p) => p.state === 'walkout' || (p.state === 'gone' && (p.quality === null || p.quality === undefined))).length;
  const rated = served.filter((p) => typeof p.stars === 'number' && p.stars > 0);
  const fiveStars = rated.filter((p) => (p.stars ?? 0) >= 5).length;
  const avgStars = rated.length ? rated.reduce((a, p) => a + (p.stars ?? 0), 0) / rated.length : 0;
  return { seen, fiveStars, walkouts, avgStars, reviews: rated.length };
}
