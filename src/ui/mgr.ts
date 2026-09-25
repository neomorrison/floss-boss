// Manager layer glue (DESIGN 10) between the screens and the sim: the huddle, daily focus, events,
// campaigns, perks, interviews and prices. Each call uses the sim function when the sim exposes it and
// falls back to catalog math otherwise, so the screens keep working while the sim changes underneath.
// Results are normalised to one shape here, so screens never depend on the sim's exact return types.
import { TRAINING_COST } from '../core/constants';
import { store } from '../core/store';
import type { ActionResult, CampaignId, Candidate, Clinic, EquipId, FocusId, GameState, OpUpgradeId, PendingEvent, PerkId, Staff } from '../core/types';
import { CAMPAIGNS, EVENTS, FOCUSES, FOCUS_ORDER, PERKS, type EventDef, type FocusDef } from '../data/manager';
import { OFFICES } from '../data/offices';
import { CHAIRS, EQUIPMENT, OP_UPGRADES } from '../data/upgrades';
import * as sim from '../sim';
import { bestTier, fillVars, focusLockReason, outcomeTone, perksForRole, saleOff, tierAtLeast } from './mgrlogic';

type AnyFn = (...a: unknown[]) => unknown;
const NS = sim as unknown as Record<string, unknown>;

/** A sim function by one of its names, or null while the sim does not have it. */
export function simFn(...names: string[]): AnyFn | null {
  for (const n of names) if (typeof NS[n] === 'function') return NS[n] as AnyFn;
  return null;
}

function hasSkill(s: GameState, id: string): boolean {
  return (s.player.skills as string[]).includes(id);
}

function asResult(r: unknown, fallbackOk = true): ActionResult {
  if (r && typeof r === 'object' && 'ok' in (r as object)) {
    const x = r as { ok: boolean; reason?: string; message?: string };
    return x.ok ? { ok: true, message: x.message } : { ok: false, reason: x.reason ?? 'Not available' };
  }
  if (typeof r === 'string') return { ok: true, message: r };
  return fallbackOk ? { ok: true } : { ok: false, reason: 'Not available yet' };
}

function call(fn: AnyFn, ...args: unknown[]): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try { return { ok: true, value: fn(...args) }; } catch (error) { console.warn('[ui] manager call failed', error); return { ok: false, error }; }
}

export function clinicAt(s: GameState, idx: number): Clinic | null {
  return s.locations[idx] ?? null;
}

export function tierScale(c: Clinic | null): number {
  return c ? OFFICES[c.tier]?.tierScale ?? 1 : 1;
}

export function tierName(t: keyof typeof OFFICES): string {
  return OFFICES[t]?.name ?? t;
}

// ---------------------------------------------------------------- huddle

/** Owner mornings hold the clock on the huddle until it is completed for the day (not with auto-huddle). */
export function huddleDue(s: GameState): boolean {
  if (s.phase !== 'owner' || s.dayOver || !s.locations.length) return false;
  if (s.settings?.autoHuddle) return false;
  return (s.huddleDay ?? s.day) < s.day;
}

export function autoHuddle(s: GameState): boolean {
  return !!s.settings?.autoHuddle;
}

export function setAutoHuddle(s: GameState, v: boolean): void {
  s.settings = { ...(s.settings ?? { autoHuddle: false }), autoHuddle: v };
}

export interface AutoOutcome { eventId: string; clinicId: string; text: string; good: boolean }

/** "Open the doors": unanswered events resolve with choice 0, the focus is kept, the day starts. */
export function completeHuddle(s: GameState): AutoOutcome[] {
  const fn = simFn('completeHuddle', 'openDoors', 'finishHuddle');
  if (fn) {
    const r = call(fn, s);
    if (r.ok) {
      if ((s.huddleDay ?? 0) < s.day && s.phase === 'owner') s.huddleDay = s.day;
      return Array.isArray(r.value) ? (r.value as AutoOutcome[]).filter((x) => x && typeof x.text === 'string') : [];
    }
  }
  // fallback: answer what is left with the first choice, then mark the huddle done
  const out: AutoOutcome[] = [];
  let guard = 12;
  while ((s.pendingEvents?.length ?? 0) > 0 && guard-- > 0) {
    const pe = s.pendingEvents[0];
    const before = s.pendingEvents.length;
    const o = resolveEvent(s, pe, 0);
    if (o.ok) out.push({ eventId: pe.eventId, clinicId: pe.clinicId, text: o.text, good: o.tone !== 'bad' });
    if (s.pendingEvents.length >= before) s.pendingEvents.shift();
  }
  s.huddleDay = s.day;
  return out;
}

// ---------------------------------------------------------------- focus

export interface FocusOption { id: FocusId; def: FocusDef; ok: boolean; reason: string }

export function focusSlots(s: GameState): number {
  return hasSkill(s, 'huddlePro') ? 2 : 1;
}

export function ownerTier(s: GameState): keyof typeof OFFICES {
  return bestTier(s.locations.map((c) => c.tier));
}

export function focusOptions(s: GameState): { slots: number; options: FocusOption[] } {
  const have = ownerTier(s);
  const local = (id: FocusId): FocusOption => {
    const def = FOCUSES[id];
    const reason = focusLockReason(def, have, tierName);
    return { id, def, ok: !reason, reason };
  };
  let slots = focusSlots(s);
  let options = FOCUS_ORDER.map(local);
  const fn = simFn('focusOptions');
  if (fn) {
    const r = call(fn, s);
    if (r.ok && r.value) {
      const v = r.value as unknown;
      const list = Array.isArray(v) ? v : (v as { options?: unknown[]; focuses?: unknown[] }).options ?? (v as { focuses?: unknown[] }).focuses;
      const sl = !Array.isArray(v) ? (v as { slots?: number }).slots : undefined;
      if (typeof sl === 'number' && sl > 0) slots = sl;
      if (Array.isArray(list) && list.length) {
        const ids = new Map<FocusId, { ok: boolean; reason: string }>();
        for (const x of list) {
          if (typeof x === 'string') ids.set(x as FocusId, { ok: true, reason: '' });
          else if (x && typeof x === 'object' && 'id' in x) {
            const o = x as { id: FocusId; ok?: boolean; locked?: boolean; available?: boolean; reason?: string };
            const ok = o.ok ?? o.available ?? !o.locked;
            ids.set(o.id, { ok: ok !== false, reason: o.reason ?? '' });
          }
        }
        options = FOCUS_ORDER.map((id) => {
          const base = local(id);
          const got = ids.get(id);
          if (!got) return { ...base, ok: false, reason: base.reason || 'Not available' };
          return { ...base, ok: got.ok, reason: got.ok ? '' : got.reason || base.reason || 'Not available' };
        });
      }
    }
  }
  return { slots, options };
}

export function currentFocus(s: GameState): FocusId[] {
  const f = (s.focus ?? []).filter((x) => FOCUSES[x]);
  return f.length ? f : ['steady'];
}

export function setFocus(s: GameState, ids: FocusId[]): ActionResult {
  const fn = simFn('setFocus');
  if (fn) {
    const r = call(fn, s, ids);
    if (r.ok) return asResult(r.value);
  }
  s.focus = ids.slice();
  return { ok: true };
}

// ---------------------------------------------------------------- events

export interface EventView {
  pe: PendingEvent;
  def: EventDef | null;
  clinic: Clinic | null;
  clinicIndex: number;
  title: string;
  text: string;
  art: string;
  choices: { label: string; hint: string }[];
}

export function eventDef(id: string): EventDef | null {
  return EVENTS.find((e) => e.id === id) ?? null;
}

function eventFill(s: GameState, pe: PendingEvent, text: string): string {
  const fn = simFn('eventText');
  if (fn && fn.length >= 3) {
    const r = call(fn, s, pe, text);
    if (r.ok && typeof r.value === 'string') return r.value;
  }
  const c = s.locations.find((x) => x.id === pe.clinicId) ?? null;
  const vars = pe.vars ?? {};
  const extra: Record<string, string> = {};
  if (c) extra.clinic = c.name;
  const eq = vars.equipId as EquipId | undefined;
  if (eq && EQUIPMENT[eq]) extra.equip = EQUIPMENT[eq].name;
  if (vars.equip && EQUIPMENT[vars.equip as EquipId]) extra.equip = EQUIPMENT[vars.equip as EquipId].name;
  const staff = vars.staffId && c ? c.staff.find((x) => x.id === vars.staffId) : null;
  if (staff) extra.staff = staff.name;
  const opId = vars.opId;
  const op = opId && c ? c.ops.find((o) => o.id === opId) : null;
  if (op) extra.op = `Operatory ${op.slot + 1}`;
  // prefer names we can resolve over raw ids in vars
  const v2 = { ...vars };
  if (extra.equip && v2.equip && EQUIPMENT[v2.equip as EquipId]) v2.equip = extra.equip;
  if (op && v2.op && v2.op === opId) v2.op = extra.op;
  return fillVars(text, v2, extra);
}

export function eventView(s: GameState, pe: PendingEvent): EventView {
  const def = eventDef(pe.eventId);
  const clinicIndex = s.locations.findIndex((x) => x.id === pe.clinicId);
  const clinic = clinicIndex >= 0 ? s.locations[clinicIndex] : null;
  const fill = (t: string) => eventFill(s, pe, t);
  // a sim eventText(state, index) that returns the whole card wins when it exists
  const fn = simFn('eventText');
  if (fn && fn.length <= 2) {
    const r = call(fn, s, pe);
    const v = r.ok ? r.value as { title?: string; text?: string; choices?: { label: string; hint?: string }[] } | string : null;
    if (v && typeof v === 'object' && typeof v.text === 'string') {
      return {
        pe, def, clinic, clinicIndex,
        title: v.title ?? def?.title ?? 'Event',
        text: v.text,
        art: def?.art ?? 'bell',
        choices: (v.choices ?? def?.choices ?? []).map((c) => ({ label: fill(c.label), hint: fill(c.hint ?? '') })),
      };
    }
    if (typeof v === 'string' && def) {
      return { pe, def, clinic, clinicIndex, title: def.title, text: v, art: def.art, choices: def.choices.map((c) => ({ label: fill(c.label), hint: fill(c.hint) })) };
    }
  }
  return {
    pe, def, clinic, clinicIndex,
    title: def?.title ?? 'Something happened',
    text: def ? fill(def.text) : '',
    art: def?.art ?? 'bell',
    choices: (def?.choices ?? [{ label: 'Okay', hint: '', effects: [] }]).map((c) => ({ label: fill(c.label), hint: fill(c.hint) })),
  };
}

export interface EventOutcome { ok: boolean; text: string; tone: 'good' | 'bad' | 'neutral' }

function findPending(s: GameState, pe: PendingEvent): number {
  const i = s.pendingEvents.indexOf(pe);
  if (i >= 0) return i;
  return s.pendingEvents.findIndex((x) => x.eventId === pe.eventId && x.clinicId === pe.clinicId && x.day === pe.day);
}

/** Answer an event card. The sim applies the effects and returns the outcome text. */
export function resolveEvent(s: GameState, pe: PendingEvent, choice: number): EventOutcome {
  const def = eventDef(pe.eventId);
  const ch = def?.choices[choice];
  const idx = findPending(s, pe);
  if (idx < 0) return { ok: false, text: 'Already answered', tone: 'neutral' };
  const fill = (t: string) => eventFill(s, pe, t);
  const fn = simFn('resolveEvent');
  if (!fn) return { ok: false, text: 'Not available yet', tone: 'neutral' };
  const r = call(fn, s, idx, choice);
  if (!r.ok) return { ok: false, text: 'Not available yet', tone: 'neutral' };
  const v = r.value as unknown;
  let text = '';
  let tone: EventOutcome['tone'] | null = null;
  if (typeof v === 'string') text = v;
  else if (v && typeof v === 'object') {
    const o = v as { ok?: boolean; reason?: string; text?: string; message?: string; outcome?: string; good?: boolean; win?: boolean; tone?: string };
    if (o.ok === false) return { ok: false, text: o.reason ?? 'Not available', tone: 'neutral' };
    text = o.text ?? o.outcome ?? o.message ?? '';
    if (typeof o.good === 'boolean') tone = o.good ? 'good' : 'bad';
    else if (typeof o.win === 'boolean') tone = o.win ? 'good' : 'bad';
    else if (o.tone === 'good' || o.tone === 'bad' || o.tone === 'neutral') tone = o.tone;
  }
  if (!text) text = ch ? fill(ch.hint) : 'Done';
  return { ok: true, text, tone: tone ?? outcomeTone(ch, text, fill) };
}

// ---------------------------------------------------------------- campaigns

export type CampaignStateId = 'ready' | 'active' | 'cooldown' | 'locked' | 'busy';
export interface CampaignInfo { id: CampaignId; cost: number; state: CampaignStateId; days: number; reason: string; startsIn: number }

export function campaignCost(s: GameState, idx: number, id: CampaignId): number {
  const c = clinicAt(s, idx);
  const fn = simFn('campaignCost', 'campaignPrice');
  if (fn && c) {
    const r = call(fn, s, c, id);
    if (r.ok && typeof r.value === 'number' && Number.isFinite(r.value)) return r.value;
  }
  const st = simFn('campaignStatus');
  if (st && c) {
    const r = call(st, s, idx, id);
    const v = r.ok ? r.value as { cost?: number } : null;
    if (v && typeof v.cost === 'number' && Number.isFinite(v.cost) && v.cost > 0) return v.cost;
  }
  return Math.round(CAMPAIGNS[id].cost * tierScale(c) * (hasSkill(s, 'brandBuilder') ? 0.75 : 1));
}

/** First day a campaign runs (bought after the doors opened, it starts tomorrow). */
function campaignFrom(c: Clinic, id: CampaignId, fallback: number): number {
  const m = (c.modifiers ?? []).find((x) => x.id.startsWith(`campaign:${id}:`));
  const n = m ? Math.floor(Number(m.id.split(':')[2])) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function campaignInfo(s: GameState, idx: number, id: CampaignId): CampaignInfo {
  const c = clinicAt(s, idx);
  const def = CAMPAIGNS[id];
  const cost = campaignCost(s, idx, id);
  const info = (state: CampaignStateId, days: number, reason = '', startsIn = 0): CampaignInfo => ({ id, cost, state, days, reason, startsIn });
  if (!c) return info('locked', 0, 'No practice');
  const running = c.campaign && c.campaign.untilDay >= s.day ? c.campaign : null;
  if (running?.id === id) {
    const from = campaignFrom(c, id, s.day);
    return info('active', running.untilDay - Math.max(s.day, from) + 1, '', Math.max(0, from - s.day));
  }
  if (!tierAtLeast(c.tier, def.minTier)) return info('locked', 0, `Needs ${tierName(def.minTier)}`);
  if (def.requires === 'whiteningLamp' && !c.ops.some((o) => o.upgrades.includes('whiteningLamp'))) return info('locked', 0, `Needs a ${OP_UPGRADES.whiteningLamp.name}`);
  if (def.requires === 'deepCert' && !c.equipment.includes('deepCert')) return info('locked', 0, `Needs ${EQUIPMENT.deepCert.name}`);
  if (running) return info('busy', running.untilDay - s.day + 1, 'One campaign at a time');
  const cool = (c.campaignCooldownUntil ?? 0) - s.day;
  if (cool > 0) return info('cooldown', cool, cool === 1 ? 'Ready tomorrow' : `Ready in ${cool} days`);
  // the sim's status covers rules the catalog does not show (Grand Opening is for a new location)
  const fn = simFn('campaignStatus', 'canStartCampaign');
  if (fn) {
    const r = call(fn, s, idx, id);
    const v = r.ok ? r.value as { ok?: boolean; reason?: string } | boolean : null;
    if (v === false) return info('locked', 0, 'Not available');
    if (v && typeof v === 'object' && v.ok === false && !/cash/i.test(v.reason ?? '')) return info('locked', 0, v.reason ?? 'Not available');
  }
  return info('ready', def.days);
}

export function startCampaign(s: GameState, idx: number, id: CampaignId): ActionResult {
  const fn = simFn('startCampaign');
  if (!fn) return { ok: false, reason: 'Not available yet' };
  const r = call(fn, s, idx, id);
  return r.ok ? asResult(r.value) : { ok: false, reason: 'Not available yet' };
}

// ---------------------------------------------------------------- demand and capacity

export interface Outlook { demand: number; capacity: number; booked: number; waitlist: number }

/** Demand, capacity, booked and waitlist of a location (the sim's dayOutlook, else the forecast). */
export function outlook(s: GameState, idx: number): Outlook | null {
  const c = clinicAt(s, idx);
  if (!c) return null;
  const fn = simFn('dayOutlook');
  if (fn) {
    const r = call(fn, s, idx);
    const v = r.ok ? r.value as { lambda?: number; demand?: number; capacity?: number; booked?: number; waitlist?: number } : null;
    if (v && typeof v.capacity === 'number') {
      return { demand: v.lambda ?? v.demand ?? 0, capacity: v.capacity, booked: v.booked ?? c.day.booked, waitlist: v.waitlist ?? 0 };
    }
  }
  const f = simFn('forecast');
  if (f) {
    const r = call(f, s, idx);
    const v = r.ok ? r.value as { demand: number; capacity: number } : null;
    if (v && typeof v.capacity === 'number') return { demand: v.demand, capacity: v.capacity, booked: c.day.booked, waitlist: 0 };
  }
  return null;
}

// ---------------------------------------------------------------- prices

function bulk(s: GameState): number {
  return hasSkill(s, 'bulkBuyer') ? 0.9 : 1;
}

export interface PriceInfo { price: number; base: number; sale: number }

export function equipmentPrice(s: GameState, idx: number, id: EquipId): PriceInfo {
  const base = EQUIPMENT[id].price;
  let price = Math.round(base * bulk(s));
  const fn = simFn('equipmentPrice', 'equipPrice');
  if (fn) {
    const r = call(fn, s, idx, id);
    const v = r.ok ? r.value : null;
    if (typeof v === 'number' && Number.isFinite(v)) price = v;
    else if (v && typeof v === 'object' && typeof (v as { price?: number }).price === 'number') price = (v as { price: number }).price;
  }
  return { price, base, sale: saleOff(price, base, bulk(s)) };
}

export function opUpgradePrice(s: GameState, idx: number, opId: string, id: OpUpgradeId): number {
  const fn = simFn('opUpgradePrice', 'upgradePrice');
  if (fn) {
    const r = fn.length >= 4 ? call(fn, s, idx, opId, id) : call(fn, s, id);
    if (r.ok && typeof r.value === 'number' && Number.isFinite(r.value)) return r.value;
  }
  return Math.round(OP_UPGRADES[id].price * bulk(s));
}

export function chairPrice(s: GameState, idx: number, tier: keyof typeof CHAIRS): number {
  const fn = simFn('chairPrice');
  if (fn) {
    const r = fn.length >= 3 ? call(fn, s, idx, tier) : call(fn, s, tier);
    if (r.ok && typeof r.value === 'number' && Number.isFinite(r.value)) return r.value;
  }
  return Math.round(CHAIRS[tier].price * bulk(s));
}

/** Op upgrade tier lock ("Needs Main Street Office") or ''. */
export function opUpgradeLock(c: Clinic, id: OpUpgradeId): string {
  const min = OP_UPGRADES[id].minTier;
  return min && !tierAtLeast(c.tier, min) ? `Needs ${tierName(min)}` : '';
}

// ---------------------------------------------------------------- training

/** A training course's price now (HR Guru and the Research Wing lower it in the sim). */
export function trainingCost(s: GameState): number {
  const fn = simFn('trainingCost');
  if (fn) {
    const r = call(fn, s);
    if (r.ok && typeof r.value === 'number' && Number.isFinite(r.value)) return r.value;
  }
  return TRAINING_COST;
}

// ---------------------------------------------------------------- hire board

export function interviewCost(s: GameState): number {
  const fn = simFn('interviewCost');
  if (fn) {
    const r = call(fn, s);
    if (r.ok && typeof r.value === 'number' && Number.isFinite(r.value)) return r.value;
  }
  if (hasSkill(s, 'talentScout')) return 0;
  return Math.round(40 * tierScale(clinicAt(s, Math.max(0, s.active))));
}

/** Old saves and fallbacks: a candidate without the interview fields counts as interviewed. */
export function isInterviewed(c: Candidate): boolean {
  return c.interviewed !== false || !c.range;
}

export function interview(s: GameState, candidateId: string, idx: number): ActionResult {
  const fn = simFn('interview', 'interviewCandidate');
  if (!fn) return { ok: false, reason: 'Not available yet' };
  const r = fn.length >= 3 ? call(fn, s, idx, candidateId) : call(fn, s, candidateId);
  return r.ok ? asResult(r.value) : { ok: false, reason: 'Not available yet' };
}

// ---------------------------------------------------------------- perks

export interface PerkOffer { staff: Staff; clinic: Clinic; clinicIndex: number; perks: PerkId[] }

export function perkOffers(s: GameState): PerkOffer[] {
  const out: PerkOffer[] = [];
  s.locations.forEach((c, i) => {
    for (const st of c.staff) {
      const p = st.pendingPerks;
      if (p && p.length) out.push({ staff: st, clinic: c, clinicIndex: i, perks: p.filter((x) => PERKS[x]) });
    }
  });
  return out;
}

export function pickPerk(s: GameState, idx: number, staffId: string, perk: PerkId): ActionResult {
  const fn = simFn('pickPerk', 'choosePerk');
  if (fn) {
    const r = fn.length >= 4 ? call(fn, s, idx, staffId, perk) : call(fn, s, staffId, perk);
    if (r.ok) return asResult(r.value);
    return { ok: false, reason: 'Not available yet' };
  }
  // fallback: the pick is plain data (the sim reads Staff.perks)
  const st = clinicAt(s, idx)?.staff.find((x) => x.id === staffId);
  if (!st || !st.pendingPerks?.includes(perk)) return { ok: false, reason: 'Not available' };
  st.perks = [...(st.perks ?? []), perk];
  st.pendingPerks = null;
  return { ok: true };
}

/** Debug: offer two perks to a staff member now. */
export function offerPerks(s: GameState, staffId: string): PerkId[] | null {
  for (let i = 0; i < s.locations.length; i++) {
    const c = s.locations[i];
    const st = c.staff.find((x) => x.id === staffId);
    if (!st) continue;
    // the sim's offerPerks(state, clinicIndex, staffId) rolls the offer with the level-up rules
    const fn = simFn('offerPerks');
    if (fn) {
      const r = fn.length >= 3 ? call(fn, s, i, staffId) : call(fn, s, staffId);
      if (r.ok && st.pendingPerks?.length) return st.pendingPerks;
      if (r.ok && r.value && (r.value as { ok?: boolean }).ok === false) return null;
    }
    const pool = perksForRole(PERKS, st.role, st.perks ?? []);
    if (pool.length < 1) return null;
    // case perks first so the specialist badge shows up in tests
    const sorted = [...pool.filter((p) => PERKS[p].caseType), ...pool.filter((p) => !PERKS[p].caseType)];
    const pick = [sorted[(s.day * 7) % sorted.length], sorted[(s.day * 7 + 3) % sorted.length]].filter((x, i, a) => a.indexOf(x) === i);
    if (pick.length < 2 && pool.length > 1) pick.push(pool.find((p) => !pick.includes(p))!);
    st.pendingPerks = pick;
    return pick;
  }
  return null;
}

export function activeIdx(): number {
  const s = store.state;
  return Math.max(0, Math.min(s.locations.length - 1, s.active));
}
