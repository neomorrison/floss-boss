// The owner's manager layer: daily focus, the morning huddle, events and campaigns. DESIGN 10.1 to 10.3.
// Modifier ids follow the shared convention '<source>:<key>:<n>' ('event:puppy:12', 'campaign:kidsWeek:7',
// 'focus:speed:9'); the clinic view maps event and campaign keys to diorama props, the UI groups by source.
import type {
  ActionResult, CampaignId, Clinic, ClinicModifier, EquipId, FocusId, GameState, OfficeTierId, PendingEvent, SimEvent, Staff,
  StaffRole,
} from '../core/types';
import type { Rng } from '../core/rng';
import { clamp, hashSeed, makeRng } from '../core/rng';
import { OPEN_MIN } from '../core/constants';
import { money } from '../core/format';
import {
  CAMPAIGNS, CAMPAIGN_ORDER, EVENTS, EVENT_CHANCE, FOCUSES, FOCUS_ORDER,
  type EventChoice, type EventDef, type EventEffect,
} from '../data/manager';
import { OFFICES, TIER_ORDER } from '../data/offices';
import { EQUIPMENT, EQUIP_ORDER } from '../data/upgrades';
import { S, SimClinic, SimStaff, addCash, hasSkill, isPresent, nextId, note, pushEvent, withRng } from './internal';
import { computeRating } from './clinic';
import { bookClinic, capacityOf, demandLambda, makeVip, weekdayOf } from './booking';
import { lastAppt } from './effects';
import { gainXp, tierIndex } from './progress';
import { askFor, makeStaff, removeStaff, wantsRaise } from './staff';
import { progressGoal } from './goals';

const fail = (reason: string): ActionResult => ({ ok: false, reason });

/** Days before the same event can come back to a location. */
export const EVENT_REPEAT_DAYS = 5;
/** Crisis Manager: chance choices go your way this much more often. */
export const CRISIS_BONUS = 0.2;
/** Event rating bonuses fade by this share each day (and are capped at +-RATING_BONUS_MAX). */
export const RATING_FADE = 0.05;
export const RATING_BONUS_MAX = 0.5;
/** Awareness from events and campaigns is capped at this total. */
export const AW_BONUS_MAX = 0.3;
/** Grand Opening is for a location that opened within this many days (or has served few patients). */
export const GRAND_OPENING_DAYS = 10;
export const GRAND_OPENING_SERVED = 150;
const LOG_MAX = 30;

// ------------------------------------------------------------------ helpers

function topTier(state: GameState): OfficeTierId {
  let best = 0;
  for (const c of state.locations) best = Math.max(best, tierIndex(c.tier));
  return TIER_ORDER[best];
}

/** Before the doors open: nobody has arrived yet at this clinic today, so it can be rebooked. */
export function isMorning(state: GameState, c: Clinic): boolean {
  if (state.dayOver || state.minute > OPEN_MIN) return false;
  return c.patients.every((p) => p.state === 'scheduled' || p.state === 'noshow');
}

/** Rebook a clinic's day in the morning after a decision changed demand, capacity or the case mix. */
function rebook(state: GameState, c: Clinic): void {
  if (isMorning(state, c)) bookClinic(state, c);
}

function modId(c: Clinic, source: string, key: string, day: number): string {
  let id = `${source}:${key}:${day}`;
  let k = 2;
  while (c.modifiers.some((m) => m.id === id)) id = `${source}:${key}:${day}.${k++}`;
  return id;
}

function tierScale(c: Clinic): number {
  return OFFICES[c.tier].tierScale;
}

// ------------------------------------------------------------------ daily focus (10.1)

/** Focus slots: one, two with Huddle Pro. */
export function focusSlots(state: GameState): number {
  return hasSkill(state, 'huddlePro') ? 2 : 1;
}

/** Every focus with whether it can be picked (office tier) and the reason when not. */
export function focusOptions(state: GameState): { slots: number; selected: FocusId[]; options: { id: FocusId; name: string; text: string; ok: boolean; reason?: string }[] } {
  const top = tierIndex(topTier(state));
  return {
    slots: focusSlots(state),
    selected: [...(state.focus ?? [])],
    options: FOCUS_ORDER.map((id) => {
      const f = FOCUSES[id];
      const ok = state.phase === 'owner' && top >= tierIndex(f.minTier);
      return { id, name: f.name, text: f.text, ok, reason: ok ? undefined : state.phase !== 'owner' ? 'Open a practice first' : `Needs a ${OFFICES[f.minTier].name}` };
    }),
  };
}

/** Write today's focus as 'focus' modifiers on every location (replacing today's previous focus). */
export function applyFocus(state: GameState): void {
  for (const c of state.locations) {
    c.modifiers = c.modifiers.filter((m) => m.source !== 'focus');
    for (const id of state.focus) {
      const f = FOCUSES[id];
      if (!f || id === 'steady') continue;
      const m: ClinicModifier = { id: `focus:${id}:${state.day}`, label: f.name, source: 'focus', untilDay: state.day };
      if (f.speed != null) m.speed = f.speed;
      if (f.quality != null) m.quality = f.quality;
      if (f.walkins != null) m.walkins = f.walkins;
      if (f.fees != null) m.fees = f.fees;
      if (f.addons != null) m.addons = f.addons;
      c.modifiers.push(m);
    }
  }
}

/** Keep only valid, unlocked, distinct focuses within the slot count ('steady' when empty). */
function cleanFocus(state: GameState, ids: readonly FocusId[]): FocusId[] {
  const top = tierIndex(topTier(state));
  const out: FocusId[] = [];
  for (const id of ids) {
    const f = FOCUSES[id];
    if (!f || out.includes(id) || top < tierIndex(f.minTier)) continue;
    if (id === 'steady' && ids.length > 1) continue;
    out.push(id);
  }
  return out.slice(0, focusSlots(state)).length ? out.slice(0, focusSlots(state)) : ['steady'];
}

/** Pick today's daily focus (DESIGN 10.1). Validates the office tier and the slot count. */
export function setFocus(state: GameState, focusIds: FocusId[]): ActionResult {
  if (state.phase !== 'owner') return fail('Open a practice first');
  const ids = Array.isArray(focusIds) ? focusIds : [];
  if (ids.length > focusSlots(state)) return fail(focusSlots(state) === 1 ? 'Pick one focus' : 'Pick up to two focuses');
  const top = tierIndex(topTier(state));
  for (const id of ids) {
    const f = FOCUSES[id];
    if (!f) return fail('Unknown focus');
    if (top < tierIndex(f.minTier)) return fail(`${f.name} needs a ${OFFICES[f.minTier].name}`);
  }
  state.focus = cleanFocus(state, ids);
  applyFocus(state);
  for (const c of state.locations) rebook(state, c);
  return { ok: true, message: state.focus.map((f) => FOCUSES[f].name).join(' and ') };
}

/** Morale bonus at close from today's focus (Team Day). */
export function focusMoraleAtClose(state: GameState): number {
  let m = 0;
  for (const f of state.focus ?? []) m += FOCUSES[f]?.moraleAtClose ?? 0;
  return m;
}

// ------------------------------------------------------------------ events (10.2)

export function eventById(id: string): EventDef | null {
  return EVENTS.find((e) => e.id === id) ?? null;
}

function eligibleEquip(c: Clinic): EquipId[] {
  return EQUIP_ORDER.filter((id) => !c.equipment.includes(id) && tierIndex(c.tier) >= tierIndex(EQUIPMENT[id].minTier)
    && !(id === 'digitalXray' && !c.equipment.includes('xray')));
}

function realStaff(c: Clinic): Staff[] {
  return c.staff.filter((s) => s.tempUntilDay == null);
}

function meetsNeeds(state: GameState, c: Clinic, e: EventDef): boolean {
  switch (e.needs) {
    case 'hygienist': return realStaff(c).some((s) => s.role === 'hygienist');
    case 'staff': return realStaff(c).length > 0;
    case 'twoLocations': return state.locations.length >= 2;
    case 'unownedEquip': return eligibleEquip(c).length > 0;
    case 'twoOps': return c.ops.length >= 2;
    case 'dentist': return c.staff.some((s) => s.role === 'dentist');
    default: return true;
  }
}

/** A permanent modifier from this event is already in force here (no second insurance network). */
function hasPermanent(c: Clinic, eventId: string): boolean {
  return c.modifiers.some((m) => m.untilDay == null && m.id.startsWith(`event:${eventId}:`));
}

/** Fill {staff}, {clinic}, {op}, {equip} for an event card. */
function eventVars(state: GameState, c: Clinic, e: EventDef, rng: Rng): Record<string, string> {
  const vars: Record<string, string> = { clinic: c.name, clinicId: c.id };
  const staff = realStaff(c);
  const pool = e.needs === 'hygienist' ? staff.filter((s) => s.role === 'hygienist') : staff;
  // poaching goes after your best people
  const ranked = e.id === 'poach' ? [...pool].sort((a, b) => b.skill + b.level * 5 - (a.skill + a.level * 5)).slice(0, 2) : pool;
  if (ranked.length) {
    const s = rng.pick(ranked);
    vars.staff = s.name.split(' ')[0];
    vars.staffId = s.id;
  }
  if (c.ops.length) {
    const i = rng.int(0, c.ops.length - 1);
    vars.op = `Operatory ${i + 1}`;
    vars.opId = c.ops[i].id;
  }
  const eq = eligibleEquip(c);
  if (eq.length) {
    const id = rng.pick(eq);
    vars.equip = EQUIPMENT[id].name;
    vars.equipId = id;
  }
  return vars;
}

/** Draw this morning's event cards (one chance per location). Called by closeDay for the new day. */
export function drawEvents(state: GameState, rng: Rng): void {
  state.pendingEvents = [];
  if (state.phase !== 'owner') return;
  for (const c of state.locations) {
    const sc = c as SimClinic;
    const recent = (sc.recentEvents ??= {});
    if (!rng.chance(EVENT_CHANCE[c.tier] ?? 0.5)) continue;
    const pool = EVENTS.filter((e) => tierIndex(c.tier) >= tierIndex(e.minTier) && meetsNeeds(state, c, e)
      && !(recent[e.id] != null && state.day - recent[e.id] < EVENT_REPEAT_DAYS) && !hasPermanent(c, e.id));
    if (!pool.length) continue;
    const e = rng.weighted(pool, (x) => x.weight);
    recent[e.id] = state.day;
    for (const k of Object.keys(recent)) if (state.day - recent[k] >= EVENT_REPEAT_DAYS * 4) delete recent[k];
    state.pendingEvents.push({ eventId: e.id, clinicId: c.id, day: state.day, vars: eventVars(state, c, e, rng) });
  }
}

/** Replace {vars} in an event string. Unknown vars read naturally ("your team", "an operatory"). */
export function fillVars(text: string, vars: Record<string, string>): string {
  const fallback: Record<string, string> = { staff: 'your team', clinic: 'your office', op: 'an operatory', equip: 'new equipment' };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? fallback[k] ?? '');
}

/** A choice hint with scaled cash amounts rewritten for this clinic's tier ("-$300" becomes "-$540"). */
function scaledHint(ch: EventChoice, scale: number, vars: Record<string, string>): string {
  let hint = ch.hint;
  if (scale !== 1) {
    for (const ef of ch.effects) {
      if (ef.kind !== 'cash' || !ef.scaled) continue;
      const from = money(Math.abs(ef.amount));
      const to = money(Math.abs(Math.round(ef.amount * scale)));
      hint = hint.split(from).join(to);
    }
  }
  return fillVars(hint, vars);
}

/** The texts of a pending event with its vars filled and cash scaled, for the huddle card. */
export function eventText(state: GameState, pending: PendingEvent): { title: string; text: string; art: string; clinic: string; choices: { label: string; hint: string }[] } {
  const e = eventById(pending.eventId);
  const c = state.locations.find((l) => l.id === pending.clinicId);
  if (!e) return { title: 'Event', text: '', art: 'star', clinic: c?.name ?? '', choices: [] };
  const scale = c ? tierScale(c) : 1;
  return {
    title: e.title,
    text: fillVars(e.text, pending.vars),
    art: e.art,
    clinic: c?.name ?? pending.vars.clinic ?? '',
    choices: e.choices.map((ch) => ({ label: fillVars(ch.label, pending.vars), hint: scaledHint(ch, scale, pending.vars) })),
  };
}

interface ApplyCtx {
  state: GameState;
  c: Clinic;
  pe: PendingEvent;
  e: EventDef;
  rng: Rng;
  texts: string[];
  addedModifier: boolean;
  touchedBooking: boolean;
  ev: SimEvent[] | null;
}

function eventStaff(a: ApplyCtx): Staff | null {
  const id = a.pe.vars.staffId;
  return id ? a.c.staff.find((s) => s.id === id) ?? null : null;
}

function isNegative(ef: EventEffect): boolean {
  switch (ef.kind) {
    case 'rating': case 'awareness': case 'morale': case 'skill': return (ef as { delta: number }).delta < 0;
    case 'modifier': return (ef.demand ?? 1) < 1 || (ef.comfort ?? 1) < 1 || (ef.quality ?? 0) < 0 || (ef.speed ?? 1) < 1 || (ef.noShows ?? 1) > 1;
    case 'closeOp': case 'openLate': case 'quitChance': return true;
    default: return false;
  }
}
function isPositive(ef: EventEffect): boolean {
  switch (ef.kind) {
    case 'rating': case 'awareness': case 'morale': case 'skill': return (ef as { delta: number }).delta > 0;
    case 'modifier': return (ef.demand ?? 1) > 1 || (ef.comfort ?? 1) > 1 || (ef.quality ?? 0) > 0 || (ef.speed ?? 1) > 1 || (ef.supplies ?? 1) < 1 || !!ef.caseBoost || (ef.walkins ?? 1) > 1;
    case 'cash': return ef.amount > 0;
    case 'vip': case 'tempStaff': case 'discountEquip': case 'freeEquip': case 'xp': case 'salary': return true;
    default: return false;
  }
}

/** Apply one effect (DESIGN 10.2: every kind generically). Returns false for a lost chance roll. */
function applyEffect(a: ApplyCtx, ef: EventEffect): boolean {
  const { state, c } = a;
  const sc = c as SimClinic;
  switch (ef.kind) {
    case 'cash': {
      const amt = Math.round(ef.amount * (ef.scaled ? tierScale(c) : 1));
      addCash(state, amt, 'Events');
      return true;
    }
    case 'rating': {
      sc.ratingBonus = clamp((sc.ratingBonus ?? 0) + ef.delta, -RATING_BONUS_MAX, RATING_BONUS_MAX);
      c.rating = computeRating(c);
      a.touchedBooking = true;
      return true;
    }
    case 'awareness': {
      // a keynote talk lifts every location
      const targets = a.e.id === 'conference' ? state.locations : [c];
      for (const t of targets) (t as SimClinic).awBonus = clamp(((t as SimClinic).awBonus ?? 0) + ef.delta, 0, AW_BONUS_MAX);
      a.touchedBooking = true;
      return true;
    }
    case 'modifier': {
      const m: ClinicModifier = {
        id: modId(c, 'event', a.e.id, state.day), label: fillVars(ef.label, a.pe.vars), source: 'event',
        untilDay: ef.days == null ? null : state.day + ef.days - 1,
      };
      for (const k of ['demand', 'fees', 'supplies', 'speed', 'comfort', 'quality', 'addons', 'walkins', 'noShows'] as const) {
        if (ef[k] != null) m[k] = ef[k];
      }
      if (ef.caseBoost) m.caseBoost = { ...ef.caseBoost };
      c.modifiers.push(m);
      a.addedModifier = true;
      a.touchedBooking = true;
      return true;
    }
    case 'morale': {
      const who = ef.who === 'all' ? c.staff : [eventStaff(a)].filter((s): s is Staff => !!s);
      for (const s of who) s.morale = clamp(Math.round(s.morale + ef.delta), 0, 100);
      return true;
    }
    case 'skill': {
      const s = ef.who === 'bestHygienist'
        ? [...c.staff].filter((x) => x.role === 'hygienist' && x.tempUntilDay == null).sort((x, y) => y.skill - x.skill)[0] ?? null
        : eventStaff(a);
      if (!s) return true;
      s.skill = clamp(s.skill + ef.delta, 0, 99);
      const ask = askFor(s.role, s);
      if (ask > s.ask) {
        s.ask = ask;
        // the request (or an auto raise) is settled at the day close with the quiet period (DESIGN 8.5)
        if (wantsRaise(s)) (s as SimStaff).raiseDue = true;
      }
      a.texts.push(`${s.name.split(' ')[0]}: skill ${s.skill}.`);
      return true;
    }
    case 'salary': {
      const s = eventStaff(a);
      if (s) s.salary = Math.round(s.salary * (1 + ef.pct / 100));
      return true;
    }
    case 'quitChance': {
      const s = eventStaff(a);
      if (!s) return true;
      if (a.rng.chance(ef.p) && !s.traits.includes('loyal')) {
        removeStaff(c, s.id);
        pushEvent(a.ev, { type: 'staffQuit', clinicId: c.id, staffId: s.id, name: s.name });
        a.texts.push(`${s.name.split(' ')[0]} took the SmileCo job.`);
        a.touchedBooking = true;
        return false;
      }
      a.texts.push(`${s.name.split(' ')[0]} stayed.`);
      return true;
    }
    case 'vip': {
      (sc.vips ??= []).push({ fee: ef.fee, weight: ef.reviewWeight, day: state.day });
      sc.vips = sc.vips.filter((v) => v.day >= state.day);
      if (!isMorning(state, c)) addVipNow(state, c, ef.fee, ef.reviewWeight, a.rng);
      a.touchedBooking = true;
      return true;
    }
    case 'closeOp': {
      const opId = a.pe.vars.opId;
      if (!opId) return true;
      c.modifiers.push({
        id: modId(c, 'event', a.e.id, state.day), label: `${fillVars('{op}', a.pe.vars)} closed`, source: 'event',
        untilDay: state.day + ef.days - 1, closedOpId: opId,
      });
      a.addedModifier = true;
      a.touchedBooking = true;
      return true;
    }
    case 'openLate': {
      c.modifiers.push({ id: modId(c, 'event', a.e.id, state.day), label: `Opens ${Math.round(ef.minutes / 60)} h late`, source: 'event', untilDay: state.day, openDelay: ef.minutes });
      a.addedModifier = true;
      a.touchedBooking = true;
      return true;
    }
    case 'tempStaff': {
      withRng(state, (r) => {
        const s = makeStaff(state, r, ef.role as StaffRole, 0, { skill: ef.skill, salary: 0, ask: 0, traits: [], morale: 80, tempUntilDay: state.day + ef.days - 1 });
        s.speed = clamp(Math.round(ef.skill + r.normal(0, 6)), 15, 95);
        s.bedside = clamp(Math.round(ef.skill + r.normal(0, 6)), 15, 95);
        c.staff.push(s);
        if (s.role === 'assistant') {
          const op = c.ops.find((o) => o.staffId && !o.assistantId) ?? c.ops.find((o) => !o.assistantId);
          if (op) op.assistantId = s.id;
        } else if (s.role === 'hygienist') {
          const op = c.ops.find((o) => o.staffId == null);
          if (op) op.staffId = s.id;
        }
        a.texts.push(`${s.name} joins for ${ef.days} days.`);
      });
      a.touchedBooking = true;
      return true;
    }
    case 'discountEquip': {
      const id = a.pe.vars.equipId as EquipId | undefined;
      if (!id) return true;
      const s = S(state);
      (s.discounts ??= []).push({ clinicId: c.id, equipId: id, pct: ef.pct, day: state.day });
      a.texts.push(`${EQUIPMENT[id].name} is ${ef.pct}% off today in the Office.`);
      return true;
    }
    case 'freeEquip': {
      const id = a.pe.vars.equipId as EquipId | undefined;
      if (id && !c.equipment.includes(id)) {
        c.equipment.push(id);
        if (id === 'fishTank' || id === 'spaLounge') c.rating = computeRating(c);
        a.texts.push(`${EQUIPMENT[id].name} installed.`);
        a.touchedBooking = true;
      }
      return true;
    }
    case 'xp': {
      gainXp(state, ef.amount, a.ev);
      return true;
    }
    case 'chance': {
      const p = clamp(ef.p + (hasSkill(state, 'crisisManager') ? CRISIS_BONUS : 0), 0, 1);
      const win = a.rng.chance(p);
      for (const x of win ? ef.win : ef.lose) applyEffect(a, x);
      a.texts.unshift(fillVars(win ? ef.winText : ef.loseText, a.pe.vars));
      return win;
    }
  }
  return true;
}

/** A VIP booked after the doors opened: arrives within the hour. */
function addVipNow(state: GameState, c: Clinic, fee: number, weight: number, rng: Rng): void {
  const t = Math.round(Math.min(Math.max(state.minute + 30, OPEN_MIN + 30), lastAppt(state, c) - 30));
  c.patients.push(makeVip(state, c, rng, t, fee, weight));
  c.patients.sort((x, y) => x.apptMin - y.apptMin);
}

/**
 * Answer a pending event with a choice (DESIGN 10.2). Applies every effect generically, logs the outcome
 * in state.eventLog and the day report, and returns the outcome text and whether it went well.
 */
export function resolveEvent(state: GameState, pendingIndex: number, choice: number, ev: SimEvent[] | null = null, auto = false): { text: string; good: boolean } {
  const pe = state.pendingEvents?.[pendingIndex];
  if (!pe) return { text: 'Event not found', good: false };
  const e = eventById(pe.eventId);
  const c = state.locations.find((l) => l.id === pe.clinicId);
  state.pendingEvents.splice(pendingIndex, 1);
  if (!e || !c) return { text: 'Event not found', good: false };
  const ci = Math.max(0, Math.min(e.choices.length - 1, Math.round(Number.isFinite(choice) ? choice : 0)));
  const ch = e.choices[ci];
  const a: ApplyCtx = { state, c, pe, e, rng: makeRng(hashSeed(state.seed, 'event', state.day, pe.clinicId, pe.eventId, ci, state.rng)), texts: [], addedModifier: false, touchedBooking: false, ev };
  let good = true;
  let hadChance = false;
  for (const ef of ch.effects) {
    if (ef.kind === 'chance') { hadChance = true; if (!applyEffect(a, ef)) good = false; }
    else applyEffect(a, ef);
  }
  if (!hadChance) {
    const neg = ch.effects.filter(isNegative).length;
    const pos = ch.effects.filter(isPositive).length;
    good = !(neg > 0 && pos === 0) && !(neg > pos);
  }
  // a prop for the diorama even when the choice changes no numbers (generator, red carpet, party)
  if (!a.addedModifier && ch.effects.length) {
    c.modifiers.push({ id: modId(c, 'event', e.id, state.day), label: `${e.title}: ${fillVars(ch.label, pe.vars)}`, source: 'event', untilDay: state.day });
  }
  if (a.touchedBooking) rebook(state, c);
  const head = fillVars(ch.label, pe.vars);
  const text = a.texts.length ? a.texts.join(' ') : `${head}. ${scaledHint(ch, tierScale(c), pe.vars)}.`.replace(/\.\./g, '.');
  state.eventLog = [...(state.eventLog ?? []), { day: state.day, eventId: e.id, clinicId: c.id, choice: ci, text }].slice(-LOG_MAX);
  note(state, `${c.name}: ${e.title}. ${text}`);
  if (!auto) progressGoal(state, 'events', 1, ev);
  return { text, good };
}

/**
 * Open the doors: resolve every unanswered event with its first choice and mark today's huddle done.
 * Returns the outcomes (for toasts). Safe to call more than once.
 */
export function completeHuddle(state: GameState, ev: SimEvent[] | null = null): { eventId: string; clinicId: string; text: string; good: boolean }[] {
  const out: { eventId: string; clinicId: string; text: string; good: boolean }[] = [];
  while (state.pendingEvents?.length) {
    const pe = state.pendingEvents[0];
    const r = resolveEvent(state, 0, 0, ev, true);
    out.push({ eventId: pe.eventId, clinicId: pe.clinicId, ...r });
  }
  state.huddleDay = state.day;
  return out;
}

/** The morning huddle is waiting for the owner (owner phase, not yet completed today). */
export function huddlePending(state: GameState): boolean {
  return state.phase === 'owner' && !state.dayOver && (state.huddleDay ?? state.day) < state.day;
}

/** Day close: fade event rating bonuses, drop expired modifiers, end finished campaigns and discounts. */
export function expireModifiers(state: GameState, nextDay: number): void {
  for (const c of state.locations) {
    const sc = c as SimClinic;
    c.modifiers = c.modifiers.filter((m) => m.untilDay == null || m.untilDay >= nextDay);
    if (c.campaign && c.campaign.untilDay < nextDay) c.campaign = null;
    if (sc.ratingBonus) {
      sc.ratingBonus = Math.abs(sc.ratingBonus) < 0.005 ? 0 : Math.round(sc.ratingBonus * (1 - RATING_FADE) * 1000) / 1000;
      c.rating = computeRating(c);
    }
    if (sc.vips) sc.vips = sc.vips.filter((v) => v.day >= nextDay);
  }
  const s = S(state);
  if (s.discounts) s.discounts = s.discounts.filter((d) => d.day >= nextDay);
}

// ------------------------------------------------------------------ campaigns (10.3)

/** Campaign cost at a clinic: catalog cost x tierScale, Brand Builder -25%. */
export function campaignCost(state: GameState, c: Clinic, id: CampaignId): number {
  const def = CAMPAIGNS[id];
  return Math.round(def.cost * tierScale(c) * (hasSkill(state, 'brandBuilder') ? 0.75 : 1));
}

/** Whether a campaign can start at a location now, its cost, and what is running. */
export function campaignStatus(state: GameState, clinicIndex: number, id: CampaignId): {
  ok: boolean; cost: number; days: number; reason?: string; active: CampaignId | null; activeUntil: number | null; cooldownUntil: number;
} {
  const c = state.phase === 'owner' ? state.locations[clinicIndex] : null;
  const def = CAMPAIGNS[id];
  if (!c || !def) return { ok: false, cost: 0, days: 0, reason: 'Location not found', active: null, activeUntil: null, cooldownUntil: 0 };
  const cost = campaignCost(state, c, id);
  const base = { cost, days: def.days, active: c.campaign?.id ?? null, activeUntil: c.campaign?.untilDay ?? null, cooldownUntil: c.campaignCooldownUntil ?? 0 };
  const no = (reason: string) => ({ ok: false, reason, ...base });
  if (c.campaign && c.campaign.untilDay >= state.day) return no(`${CAMPAIGNS[c.campaign.id].name} is running`);
  if (state.day < (c.campaignCooldownUntil ?? 0)) return no(`Next campaign on day ${c.campaignCooldownUntil}`);
  if (tierIndex(c.tier) < tierIndex(def.minTier)) return no(`Needs a ${OFFICES[def.minTier].name}`);
  if (def.requires === 'whiteningLamp' && !c.ops.some((o) => o.upgrades.includes('whiteningLamp'))) return no('Needs a Whitening Lamp');
  if (def.requires === 'deepCert' && !c.equipment.includes('deepCert')) return no('Needs the Deep Cleaning Certification');
  if (id === 'grandOpening') {
    const sc = c as SimClinic;
    const fresh = (sc.openedDay != null && state.day - sc.openedDay <= GRAND_OPENING_DAYS) || c.served < GRAND_OPENING_SERVED;
    if (!fresh) return no('For a new location');
  }
  if (state.cash < cost) return no('Not enough cash');
  return { ok: true, ...base };
}

/** Start a campaign at a location (DESIGN 10.3). Before the doors open it runs from today; bought later it
 * starts tomorrow. The modifier id carries the real start day ('campaign:<id>:<startDay>'), and a modifier
 * whose start day is still ahead is not in force yet (effects.modActive), so the UI can show "Starts tomorrow". */
export function startCampaign(state: GameState, clinicIndex: number, id: CampaignId): ActionResult {
  const st = campaignStatus(state, clinicIndex, id);
  if (!st.ok) return fail(st.reason ?? 'Cannot start');
  const c = state.locations[clinicIndex];
  const def = CAMPAIGNS[id];
  addCash(state, -st.cost, 'Campaigns');
  const morning = !state.dayOver && isMorning(state, c);
  const startDay = morning ? state.day : state.day + 1;
  const untilDay = startDay + def.days - 1;
  const boosts = Object.entries(def.caseBoost).map(([ct, v]) => `${CASE_LABEL[ct] ?? ct} x${v}`);
  const parts = [def.demand !== 1 ? `demand +${Math.round((def.demand - 1) * 100)}%` : '', ...boosts].filter(Boolean);
  c.modifiers.push({
    id: modId(c, 'campaign', id, startDay), label: parts.length ? `${def.name}: ${parts.join(', ')}` : def.name, source: 'campaign', untilDay,
    demand: def.demand, caseBoost: { ...def.caseBoost },
  });
  c.campaign = { id, untilDay };
  c.campaignCooldownUntil = untilDay + 1 + def.cooldown;
  if (def.awareness) (c as SimClinic).awBonus = clamp(((c as SimClinic).awBonus ?? 0) + def.awareness, 0, AW_BONUS_MAX);
  if (morning) rebook(state, c);
  progressGoal(state, 'campaign', 1, null);
  return { ok: true, message: morning ? `${def.name} runs until day ${untilDay}` : `${def.name} starts tomorrow and runs until day ${untilDay}` };
}

const CASE_LABEL: Record<string, string> = { candy: 'sugar bug cases', whitening: 'whitening', deep: 'deep cleanings', braces: 'braces checks', pirate: 'pirates', routine: 'routine' };

// ------------------------------------------------------------------ previews for the huddle

/** Demand, capacity and waitlist of a location for the huddle and the office screen. */
export function dayOutlook(state: GameState, clinicIndex: number): { lambda: number; capacity: number; booked: number; waitlist: number } {
  const c = state.locations[clinicIndex];
  if (!c) return { lambda: 0, capacity: 0, booked: 0, waitlist: 0 };
  return {
    lambda: Math.round(demandLambda(state, c, weekdayOf(state.day)) * 10) / 10,
    capacity: capacityOf(state, c),
    booked: c.day.booked,
    waitlist: (c as SimClinic).waitIn ?? 0,
  };
}

export { CAMPAIGN_ORDER, isPresent };
export type { SimStaff };
