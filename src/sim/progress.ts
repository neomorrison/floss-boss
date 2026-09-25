// Player progression: XP, levels, titles, auto quality, valuation. DESIGN 4 and 8.11.
import type { CleanModifiers, GameState, OfficeTierId, SimEvent } from '../core/types';
import { FLOSS_BOSS_VALUATION } from '../core/constants';
import { OFFICES, TIER_ORDER } from '../data/offices';
import { CHAIRS, EQUIPMENT, OP_UPGRADES } from '../data/upgrades';
import { S, SimReport, addTimeline, hasSkill, note, pushEvent } from './internal';

/** XP to the next level while employed: 60, 100, 150 (a level-up every 2 to 5 cleans, DESIGN 10.8). */
export const EARLY_XP = [60, 100, 150];
/** XP to the next level: EARLY_XP through level 3, then round(60 x L^1.4). */
export function xpToNext(level: number): number {
  const L = Math.max(1, level);
  return L <= EARLY_XP.length ? EARLY_XP[L - 1] : Math.round(60 * Math.pow(L, 1.4));
}

/** Add XP, handle level-ups (+1 skill point each). Returns the number of level-ups. */
export function gainXp(state: GameState, xp: number, ev: SimEvent[] | null): number {
  const amount = Math.max(0, Math.round(xp));
  if (!amount) return 0;
  const p = state.player;
  p.xp += amount;
  S(state).dayXp = (S(state).dayXp ?? 0) + amount;
  let ups = 0;
  while (p.xp >= xpToNext(p.level) && p.level < 99) {
    p.xp -= xpToNext(p.level);
    p.level += 1;
    p.skillPoints += 1;
    ups++;
    pushEvent(ev, { type: 'levelUp', level: p.level });
  }
  if (ups) {
    S(state).dayLevelUps = (S(state).dayLevelUps ?? 0) + ups;
    setTitle(state);
  }
  return ups;
}

export function tierIndex(t: OfficeTierId): number {
  return TIER_ORDER.indexOf(t);
}

/** Every title in career order (DESIGN 4.1). A title's index is its rank. */
export const TITLES = [
  'Hygiene Student', 'Staff Hygienist', 'Senior Hygienist', 'Lead Hygienist',
  'Practice Owner', 'Clinic Director', 'Dental Mogul', 'Floss Boss',
] as const;
/** Owner titles (the owner phase never goes back down a title, even if a location closes). */
export const OWNER_TITLES = ['Practice Owner', 'Clinic Director', 'Dental Mogul', 'Floss Boss'] as const;

/** Rank of a title in TITLES (0 = Hygiene Student); unknown titles rank 0. */
export function titleRank(t: string): number {
  return Math.max(0, (TITLES as readonly string[]).indexOf(t));
}

export function title(state: GameState): string {
  if (state.phase === 'school') return 'Hygiene Student';
  const L = state.player.level;
  if (state.phase === 'employee') return L >= 7 ? 'Lead Hygienist' : L >= 4 ? 'Senior Hygienist' : 'Staff Hygienist';
  const locs = state.locations.length;
  const top = state.locations.reduce((m, c) => Math.max(m, tierIndex(c.tier)), 0);
  let r = 0;
  if (locs >= 5 || valuation(state) >= FLOSS_BOSS_VALUATION) r = 3;
  else if (top >= 2 || locs >= 3) r = 2;
  else if (top >= 1 || locs >= 2) r = 1;
  return OWNER_TITLES[Math.max(r, Math.min(3, S(state).bestTitle ?? 0))];
}

/**
 * Recompute the player's title. A promotion (a higher title than before) adds a timeline entry and a report
 * note "Promoted: Senior Hygienist", so the UI can play the ceremony (it can also compare player.title before
 * and after an action). Returns the new title when it was a promotion, else null.
 */
export function setTitle(state: GameState): string | null {
  const p = state.player;
  const t = title(state);
  const oi = (OWNER_TITLES as readonly string[]).indexOf(t);
  if (state.phase === 'owner' && oi >= 0) S(state).bestTitle = Math.max(S(state).bestTitle ?? 0, oi);
  const was = p.title;
  p.title = t;
  if (t === was || titleRank(t) <= titleRank(was ?? '')) return null;
  addTimeline(state, 'career', `Promoted to ${t}`);
  note(state, `Promoted: ${t}`);
  return t;
}

/** Employee hourly-ish rate per cleaning by title (DESIGN 3.2). */
export function employeeRate(level: number): number {
  return level >= 7 ? 140 : level >= 4 ? 110 : 85;
}

export function autoQuality(state: GameState): number {
  const t = state.player.tools;
  const toolBonus = Math.min(0.1, 0.02 * ((t.scaler - 1) + (t.polisher - 1) + (t.scaler >= 4 ? 1 : 0)));
  return Math.min(0.9, 0.5 + 0.025 * state.player.level + toolBonus);
}

export function cleanMods(state: GameState): CleanModifiers {
  return {
    gumDamage: hasSkill(state, 'steady2') ? 0.5 : hasSkill(state, 'steady1') ? 0.75 : 1,
    scalerPower: hasSkill(state, 'power') ? 1.25 : 1,
    polishRadius: hasSkill(state, 'polishPro') ? 1.25 : 1,
    polishSpeed: hasSkill(state, 'polishPro') ? 1.25 : 1,
    eagleEye: hasSkill(state, 'eagleEye'),
    parMult: hasSkill(state, 'speedCleaner') ? 1.2 : 1,
    reassure: hasSkill(state, 'calmingVoice') ? 1.5 : 1,
    comfortDrain: hasSkill(state, 'smallTalk') ? 0.8 : 1,
    fidget: hasSkill(state, 'kidWhisperer') ? 0.4 : 1,
    gagDelay: hasSkill(state, 'gagGuru') ? 2 : 0,
  };
}

export function starsFor(quality: number): number {
  return quality >= 0.92 ? 5 : quality >= 0.8 ? 4 : quality >= 0.65 ? 3 : quality >= 0.45 ? 2 : 1;
}

/** Operating net of the last n day reports of the owner phase (purchases and loans excluded). */
export function avgNet(state: GameState, n: number): number {
  const reps = (state.reports as SimReport[]).filter((r) => r.phase === 'owner').slice(-n);
  if (!reps.length) return 0;
  return reps.reduce((s, r) => s + (r.operatingNet ?? r.opNet ?? r.net), 0) / reps.length;
}

export function equipmentValue(c: GameState['locations'][number]): number {
  let v = Math.max(0, c.ops.length - 1) * 4000;
  for (const op of c.ops) {
    v += CHAIRS[op.chair].price;
    for (const u of op.upgrades) v += OP_UPGRADES[u].price;
  }
  for (const e of c.equipment) v += EQUIPMENT[e].price;
  return v;
}

/** Days of average operating net a buyer pays for the business (DESIGN 8.11). */
export const VALUATION_NET_DAYS = 150;

export function valuation(state: GameState): number {
  let v = 0;
  for (const c of state.locations) v += OFFICES[c.tier].price * 0.6 + equipmentValue(c) * 0.5;
  v += Math.max(0, avgNet(state, 7)) * VALUATION_NET_DAYS;
  // Investor Relations: buyers pay 10% more for the business (not for your cash)
  if (hasSkill(state, 'investorRelations')) v *= 1.1;
  v += state.cash - state.loan;
  return Math.round(v);
}
