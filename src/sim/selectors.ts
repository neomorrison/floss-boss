// Read-only selectors for the UI, plus offline earnings. DESIGN 8.9 and 8.11.
import type { AddonId, Clinic, GameState, OfflineReport } from '../core/types';
import { PLAYER_ID } from '../core/constants';
import { money } from '../core/format';
import { OFFICES, TIER_ORDER } from '../data/offices';
import { SERVICES } from '../data/services';
import { TOOLS, EXTRAS } from '../data/tools';
import { SKILLS } from '../data/skills';
import { SimClinic, addCash, clinicByIndex } from './internal';
import { avgNet, tierIndex } from './progress';
import { capacityOf, demandLambda, weekdayOf } from './booking';
import { loanRate, marketingCost, maxLoan, moveQuote, practiceStatus } from './economy';
import { salaryCost } from './staff';
import { campaignStatus } from './manager';
import { CAMPAIGN_ORDER } from '../data/manager';
import { LOAN_DAILY_PAYMENT } from '../core/constants';

export function activeClinic(state: GameState): Clinic | null {
  if (state.phase === 'employee') return state.employer;
  if (state.phase === 'owner') return state.locations[state.active] ?? state.locations[0] ?? null;
  return null;
}

export function forecast(state: GameState, clinicIndex: number): { demand: number; capacity: number; revenue: number; costs: number } {
  const c = clinicByIndex(state, clinicIndex);
  if (!c) return { demand: 0, capacity: 0, revenue: 0, costs: 0 };
  // new patients plus the waitlist booked first today
  const lambda = demandLambda(state, c, weekdayOf(state.day)) + ((c as SimClinic).waitIn ?? 0);
  const capacity = capacityOf(state, c);
  const served = Math.min(lambda * 0.93, capacity);
  const fee = SERVICES.cleaning.fee * (c.prices.cleaning ?? 1);
  const addonShare = 0.45 * SERVICES.fluoride.fee * Math.pow(c.prices.fluoride ?? 1, -1);
  const revenue = Math.round(served * (fee + addonShare));
  let costs = 0;
  if (c.ownedByPlayer) {
    costs = c.staff.reduce((t, s) => t + salaryCost(state, s), 0) + OFFICES[c.tier].rent + marketingCost(c) + Math.round(served * 10);
    if (clinicIndex === 0 && state.loan > 0) costs += Math.round(state.loan * (loanRate(state) + LOAN_DAILY_PAYMENT));
  }
  return { demand: Math.round(lambda * 10) / 10, capacity, revenue, costs: Math.round(costs) };
}

/** Offline earnings on load (DESIGN 8.9); applies the credit and returns the report, or null. */
export function applyOffline(state: GameState, nowMs: number): OfflineReport | null {
  const last = state.lastSeen || nowMs;
  state.lastSeen = nowMs;
  if (state.phase !== 'owner') return null;
  if (!state.locations.some((c) => c.staff.some((s) => s.role === 'hygienist'))) return null;
  const away = nowMs - last;
  if (!(away > 10 * 60 * 1000)) return null;
  const hours = away / 3_600_000;
  const credit = Math.round(Math.max(0, avgNet(state, 3)) * Math.min(hours * 0.5, 6) * 0.6);
  if (credit <= 0) return { hours: Math.round(hours * 10) / 10, credit: 0 };
  addCash(state, credit, 'While you were away');
  return { hours: Math.round(hours * 10) / 10, credit };
}

export function addonsFor(state: GameState, clinicIndex: number, patientId: string): AddonId[] {
  const c = clinicByIndex(state, clinicIndex) ?? activeClinic(state);
  const p = c?.patients.find((x) => x.id === patientId);
  return p ? [...p.addons] : [];
}

function cheapestTool(state: GameState): { name: string; price: number } | null {
  let best: { name: string; price: number } | null = null;
  for (const slot of Object.keys(TOOLS) as (keyof typeof TOOLS)[]) {
    const next = TOOLS[slot][state.player.tools[slot]];
    if (next && (!best || next.price < best.price)) best = { name: next.name, price: next.price };
  }
  for (const e of EXTRAS) if (!state.player.extras.includes(e.id) && (!best || e.price < best.price)) best = { name: e.name, price: e.price };
  return best;
}

/** Short product-voice hint for the hub tip line. */
export function nextHint(state: GameState): string {
  if (state.phase === 'school') return 'Finish your practical to graduate';
  if (state.dayOver) return 'Day over. Close the day to see your report';
  const queue = (activeClinic(state)?.patients ?? []).filter((p) => p.state === 'inChair' && p.awaitingPlayer);
  if (queue.length) return 'Patient waiting in your chair';
  const learnable = state.player.skillPoints > 0 && SKILLS.some((s) => !state.player.skills.includes(s.id) && state.player.level >= s.minLevel && (!s.requires || state.player.skills.includes(s.requires)));
  if (state.phase === 'employee') {
    const ps = practiceStatus(state);
    if (ps.ok) return 'Open your own practice';
    if (learnable) return 'Spend your skill point';
    const t = cheapestTool(state);
    if (t && state.cash >= t.price && state.player.tools.scaler < 3) return `${t.name} is affordable in Tools`;
    if (state.player.level < 4) return 'Level 4 unlocks your own practice';
    return `Save ${money(ps.cashNeeded - state.cash)} more for your own practice`;
  }
  const c = activeClinic(state);
  if (!c) return '';
  const idx = state.locations.indexOf(c);
  // staffing and demand first: the Skills badge already shows unspent points
  const openOp = c.ops.findIndex((o) => o.staffId == null);
  if (openOp >= 0) return `Hire a hygienist to staff operatory ${openOp + 1}`;
  if (state.cash < 0) return 'Cash is below zero. Cut costs or take a loan';
  if (!c.staff.some((s) => s.role === 'receptionist')) return 'Hire a receptionist to speed up check-in';
  const perk = state.locations.flatMap((l) => l.staff).find((s) => s.pendingPerks && s.pendingPerks.length);
  if (perk) return `Pick a perk for ${perk.name.split(' ')[0]} in Staff`;
  const last = state.reports[state.reports.length - 1];
  const lastLoc = last?.perLocation.find((l) => l.clinicId === c.id);
  const turned = lastLoc?.stats.turnedAway ?? 0;
  if (turned > 0 && c.ops.length < OFFICES[c.tier].opSlots) return 'Patients were turned away. Add an operatory';
  if (turned > 0 && c.marketing > 0) return 'Patients were turned away. Hire or grow before more marketing';
  const cap = capacityOf(state, c);
  const spare = cap > 0 && c.day.booked < cap * 0.8;
  if (spare && !c.campaign && CAMPAIGN_ORDER.some((id) => campaignStatus(state, idx, id).ok)) return 'Spare capacity today. Run a campaign';
  if (c.rating < 3.2 && c.reviews.length >= 5) return 'Rating is slipping. Check prices and staff';
  if (learnable) return 'Spend your skill point';
  const i = tierIndex(c.tier);
  if (i < TIER_ORDER.length - 1) {
    const q = moveQuote(state, idx, TIER_ORDER[i + 1]);
    if (q.ok) return `${OFFICES[TIER_ORDER[i + 1]].name} is within reach`;
  }
  if (c.marketing === 0 && state.cash > 2000) return 'Marketing brings in more patients';
  if (!c.equipment.includes('deepCert') && state.cash >= 2000) return 'Deep cleanings pay more. Get certified';
  if (state.loan > 0 && state.cash > state.loan * 2) return 'Pay off the loan to save on interest';
  const ml = maxLoan(state);
  void ml;
  if (c.ops.some((o) => o.staffId === PLAYER_ID && o.playerMode === 'auto')) return 'Your chair is on autopilot';
  return 'Keep the rating up to bring in more patients';
}
