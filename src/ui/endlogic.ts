// Pure helpers for the end game screens (DESIGN 11): the Smile Index, milestones, district colours, the
// five-star rule text, titles and promotions, Legacy points and the Legacy shop. No DOM, no sim.
// Unit tested in tests/ui.end.test.ts.
import type { CaseType, Clinic, Difficulty, DistrictId, DistrictState, GameState, LegacyPerkId, TimelineEntry } from '../core/types';
import type { LegacyState } from '../core/legacy';
import { CITY_MILESTONES, DISTRICTS, DISTRICT_ORDER } from '../data/city';
import { MASTERY_TIERS } from '../data/cases';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../data/difficulty';
import { LEGACY_PERKS } from '../data/legacy';

// ---------------------------------------------------------------- Smile City

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** A district's Smile Index from the save (the catalog start when the save has none yet). */
export function districtIndex(city: DistrictState[] | undefined | null, id: DistrictId): number {
  const d = (city ?? []).find((x) => x && x.id === id);
  return clamp01(d ? d.index : DISTRICTS[id].start);
}

/** The city Smile Index: the population-weighted mean of the six districts (0..1). */
export function cityIndex(city: DistrictState[] | undefined | null): number {
  let sum = 0;
  let pop = 0;
  for (const id of DISTRICT_ORDER) {
    const p = DISTRICTS[id].population;
    sum += districtIndex(city, id) * p;
    pop += p;
  }
  return pop ? sum / pop : 0;
}

/** Whole percent shown for an index (rounded: the sim lands a milestone within half a point of it). */
export function smilePct(index: number): number {
  return Math.round(clamp01(index) * 100);
}

/** "Halfway There (50%)", or just the title when it already says the percent ("Smile City 60%"). */
export function milestoneLabel(m: { pct: number; title: string }): string {
  return /\d+%/.test(m.title) ? m.title : `${m.title} (${m.pct}%)`;
}

/** City grants paid for the milestones just reached: the last `pcts.length` 'City grant' ledger lines, in
 * order (the sim pays them in ascending order). */
export function grantsFor(pcts: number[], ledger: { label: string; amount: number }[] | undefined | null): Map<number, number> {
  const out = new Map<number, number>();
  const grants = (ledger ?? []).filter((x) => x.amount > 0 && /city grant/i.test(x.label));
  const take = grants.slice(-pcts.length);
  const sorted = [...pcts].sort((a, b) => a - b);
  if (take.length === sorted.length) sorted.forEach((p, i) => out.set(p, take[i].amount));
  return out;
}

/** What each milestone unlocks besides the city grant (DESIGN 11.1). */
export const MILESTONE_UNLOCK: Record<number, string> = {
  50: 'The Smile Van is for sale',
  70: 'Golden Molar nomination',
  90: 'The Golden Molar Gala is planned',
  100: 'The parade and the Golden Molar Gala',
};

export interface MilestoneView { pct: number; title: string; text: string; unlock: string }

export function milestoneView(pct: number): MilestoneView | null {
  const m = CITY_MILESTONES.find((x) => x.pct === pct);
  return m ? { pct: m.pct, title: m.title, text: m.text, unlock: MILESTONE_UNLOCK[m.pct] ?? '' } : null;
}

/** The next milestone not reached yet, and progress toward it from the previous one (0..1). */
export function nextMilestone(index: number, reached: number[] | undefined | null): { milestone: MilestoneView; from: number; frac: number } | null {
  const got = new Set(reached ?? []);
  const sorted = [...CITY_MILESTONES].sort((a, b) => a.pct - b.pct);
  const i = sorted.findIndex((m) => !got.has(m.pct));
  if (i < 0) return null;
  const m = sorted[i];
  const from = i > 0 ? sorted[i - 1].pct : 0;
  const now = clamp01(index) * 100;
  const frac = clamp01((now - from) / Math.max(1, m.pct - from));
  return { milestone: milestoneView(m.pct)!, from, frac };
}

/** Milestones in `reached` that were not celebrated yet (per `seen`), in order. */
export function unseenMilestones(reached: number[] | undefined | null, seen: (pct: number) => boolean): number[] {
  return [...new Set(reached ?? [])].filter((p) => CITY_MILESTONES.some((m) => m.pct === p) && !seen(p)).sort((a, b) => a - b);
}

const GREY = [205, 214, 216];
function hexRgb(hex: string): number[] {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0);
}

/** Map tint of a district: grey at 0, its full colour at 100%. */
export function districtFill(color: string, index: number): string {
  const t = Math.pow(clamp01(index), 0.85);
  const c = hexRgb(color);
  const out = GREY.map((g, i) => Math.round(g + (c[i] - g) * t));
  return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
}

/** Smile curve of a district face: -1 frown .. 1 big grin. */
export function smileCurve(index: number): number {
  return Math.max(-1, Math.min(1, (clamp01(index) - 0.35) / 0.4));
}

/** How many of your locations sit in each district. */
export function locationsByDistrict(locations: Pick<Clinic, 'district'>[]): Record<DistrictId, number> {
  const out = Object.fromEntries(DISTRICT_ORDER.map((id) => [id, 0])) as Record<DistrictId, number>;
  for (const c of locations) {
    const d = c.district && DISTRICTS[c.district] ? c.district : 'downtown';
    out[d]++;
  }
  return out;
}

/** The default pick for a new office: the least-smiling district without one of your locations. */
export function defaultDistrict(city: DistrictState[] | undefined | null, locations: Pick<Clinic, 'district'>[]): DistrictId {
  const have = locationsByDistrict(locations);
  const free = DISTRICT_ORDER.filter((id) => have[id] === 0);
  const pool = free.length ? free : DISTRICT_ORDER;
  return pool.reduce((best, id) => (districtIndex(city, id) < districtIndex(city, best) ? id : best), pool[0]);
}

/** The district the Smile Van serves: the least-smiling one with none of your locations (null when every district has one). */
export function vanDistrict(city: DistrictState[] | undefined | null, locations: Pick<Clinic, 'district'>[]): DistrictId | null {
  const have = locationsByDistrict(locations);
  const free = DISTRICT_ORDER.filter((id) => have[id] === 0);
  if (!free.length) return null;
  return free.reduce((best, id) => (districtIndex(city, id) < districtIndex(city, best) ? id : best), free[0]);
}

// ---------------------------------------------------------------- difficulty and the five-star rule

export const BASE_FIVE_STAR = 0.92;

export interface CleanRules { snapAt: number; starShift: number; fiveStarPar: number }

/** The clean rules the sim fills from state.difficulty and the title (DESIGN 11.5), for previews. */
export function rulesFor(difficulty: Difficulty | undefined | null, title: string): CleanRules {
  const d = DIFFICULTIES[difficulty && DIFFICULTIES[difficulty] ? difficulty : 'standard'];
  const above = Math.max(0, titleRank(title));
  return { snapAt: d.snapAt, starShift: Math.min(d.starShiftCap, d.starShiftPerTitle * above), fiveStarPar: d.fiveStarPar };
}

/** "5 stars: 94% and under 1:20" from the clean rules and the par time. */
export function fiveStarRule(rules: Partial<CleanRules> | null | undefined, parSeconds: number): { text: string; quality: number; seconds: number | null } {
  const quality = Math.min(0.99, BASE_FIVE_STAR + Math.max(0, rules?.starShift ?? 0));
  const mult = rules?.fiveStarPar;
  const seconds = mult !== undefined && mult > 0 && mult < 50 && parSeconds > 0 ? Math.round(parSeconds * mult) : null;
  const pctText = `${Math.round(quality * 100)}%`;
  return { text: seconds !== null ? `5 stars: ${pctText} and under ${clockText(seconds)}` : `5 stars: ${pctText}`, quality, seconds };
}

function clockText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function difficultyOf(s: Pick<GameState, 'difficulty'> | null | undefined): Difficulty {
  const d = s?.difficulty;
  return d && DIFFICULTIES[d] ? d : 'standard';
}

export { DIFFICULTY_ORDER };

/** Bank warning (DESIGN 11.5): shown from 2 closes below zero, when the difficulty has bankruptcy. */
export function distressInfo(s: Pick<GameState, 'distress' | 'difficulty' | 'phase'>): { show: boolean; closes: number; limit: number; left: number } {
  const closes = Math.max(0, Math.floor(s.distress ?? 0));
  const limit = DIFFICULTIES[difficultyOf(s)].bankruptcyDays;
  const show = s.phase === 'owner' && closes >= 2 && limit < 100;
  return { show, closes, limit, left: Math.max(0, limit - closes) };
}

// ---------------------------------------------------------------- titles and promotions

export const TITLE_ORDER = ['Staff Hygienist', 'Senior Hygienist', 'Lead Hygienist', 'Practice Owner', 'Clinic Director', 'Dental Mogul', 'Floss Boss'] as const;

/** 0 for Staff Hygienist up to 6 for Floss Boss; -1 for the student or an unknown title. */
export function titleRank(title: string | null | undefined): number {
  return TITLE_ORDER.indexOf((title ?? '') as typeof TITLE_ORDER[number]);
}

/** Dr. Ruth Canal on each promotion (character voice). */
export const PROMOTION_LINES: Record<string, string> = {
  'Staff Hygienist': 'Welcome to the team! Your chair, your patients, my puns.',
  'Senior Hygienist': 'Senior Hygienist! You have been flossing circles around the whole floor.',
  'Lead Hygienist': 'Lead Hygienist. Everyone looks to you now. No pressure, just plaque.',
  'Practice Owner': 'Your own practice! I always knew you had the drill for it.',
  'Clinic Director': 'Clinic Director. More chairs, more smiles, more paperwork. Mostly smiles.',
  'Dental Mogul': 'Dental Mogul! You are building an empire one molar at a time.',
  'Floss Boss': 'Floss Boss. I taught you everything you know. Well, the puns, anyway.',
};

export function promotionLine(title: string): string {
  return PROMOTION_LINES[title] ?? 'Look at you go. I am so proud I could polish something.';
}

/** What the new title means, in product voice. */
export const TITLE_BLURB: Record<string, string> = {
  'Staff Hygienist': 'Paid per patient at Bright Smiles Dental.',
  'Senior Hygienist': 'Better pay per clean and tougher cases.',
  'Lead Hygienist': 'Top pay at Bright Smiles. Your own practice is next.',
  'Practice Owner': 'Your own office, your own team.',
  'Clinic Director': 'A bigger office or a second location.',
  'Dental Mogul': 'A chain of smiles across the city.',
  'Floss Boss': 'The top of the dental world.',
};

// ---------------------------------------------------------------- Legacy (New Game+)

export interface LegacyPart { label: string; points: number }

/** Legacy points a retirement earns (DESIGN 11.4): Golden Molar 5, 1 per 5 achievements, 1 per gold mastery, 1 per $1M valuation (cap 10). */
export function legacyPointsFor(s: Pick<GameState, 'achievements' | 'player'> & { finale?: { won?: boolean } | null }, valuation: number): { total: number; parts: LegacyPart[] } {
  const parts: LegacyPart[] = [];
  if (s.finale?.won) parts.push({ label: 'Golden Molar', points: 5 });
  const ach = Math.floor((s.achievements?.length ?? 0) / 5);
  if (ach) parts.push({ label: `${s.achievements.length} achievements`, points: ach });
  const gold = goldMasteries(s.player?.mastery);
  if (gold) parts.push({ label: gold === 1 ? '1 gold mastery' : `${gold} gold masteries`, points: gold });
  const mil = Math.min(10, Math.floor(Math.max(0, valuation) / 1_000_000));
  if (mil) parts.push({ label: 'Chain valuation', points: mil });
  return { total: parts.reduce((a, p) => a + p.points, 0), parts };
}

export function goldMasteries(mastery: Partial<Record<CaseType, number>> | undefined | null): number {
  return Object.values(mastery ?? {}).filter((n) => (n ?? 0) >= MASTERY_TIERS[2]).length;
}

export function canBuyPerk(l: LegacyState, id: LegacyPerkId): { ok: boolean; reason: string } {
  const def = LEGACY_PERKS[id];
  if (!def) return { ok: false, reason: 'Unknown perk' };
  if (l.owned.includes(id)) return { ok: false, reason: 'Owned' };
  if (l.points < def.cost) return { ok: false, reason: `Needs ${def.cost} Legacy points` };
  return { ok: true, reason: '' };
}

/** Buy a perk (a new LegacyState; unchanged when it cannot be bought). */
export function buyPerk(l: LegacyState, id: LegacyPerkId): LegacyState {
  if (!canBuyPerk(l, id).ok) return l;
  return { ...l, points: l.points - LEGACY_PERKS[id].cost, owned: [...l.owned, id] };
}

/** The perks to bring into a run: owned ones only, catalog order. */
export function runPerks(owned: LegacyPerkId[], picked: Set<LegacyPerkId>): LegacyPerkId[] {
  return (Object.keys(LEGACY_PERKS) as LegacyPerkId[]).filter((id) => owned.includes(id) && picked.has(id));
}

// ---------------------------------------------------------------- career summary (Legacy screen, credits)

export interface StatLine { icon: string; label: string; value: string }

export function careerStats(s: GameState, money: (n: number) => string): StatLine[] {
  const st = s.stats ?? ({} as GameState['stats']);
  const n = (v: number | undefined) => Math.max(0, Math.round(v ?? 0)).toLocaleString('en-US');
  return [
    { icon: 'user', label: 'Patients', value: n(st.patientsServed) },
    { icon: 'hand', label: 'Hands-on cleans', value: n(st.cleanings) },
    { icon: 'tooth', label: 'Chunks popped', value: n(st.chunks) },
    { icon: 'sparkle', label: 'Perfect cleans', value: n(st.perfect) },
    { icon: 'bolt', label: 'Best combo', value: st.bestCombo > 1 ? `x${st.bestCombo}` : '-' },
    { icon: 'star', label: 'Five-star reviews', value: n(st.fiveStars) },
    { icon: 'wallet', label: 'Money earned', value: money(Math.max(0, st.earned ?? 0)) },
    { icon: 'calendar', label: 'Days', value: n(Math.max(st.daysPlayed ?? 0, s.day ?? 0)) },
  ];
}

export const TIMELINE_ICON: Record<TimelineEntry['kind'], string> = {
  career: 'bolt', office: 'office', city: 'smile', award: 'trophy', mastery: 'medal',
};

/** The career story in order (oldest first). Past `max` entries the first few and the latest ones show. */
export function timelineView(entries: TimelineEntry[] | undefined | null, max = 80): TimelineEntry[] {
  const all = [...(entries ?? [])].filter((e) => e && typeof e.text === 'string').map((e, i) => ({ e, i })).sort((a, b) => a.e.day - b.e.day || a.i - b.i).map((x) => x.e);
  if (all.length <= max) return all;
  const head = Math.min(8, Math.floor(max / 4));
  return [...all.slice(0, head), ...all.slice(all.length - (max - head))];
}

/** Names for the credits: your staff (every location) and the patients who left five-star reviews. */
export function creditNames(s: GameState, maxPatients = 12): { staff: string[]; patients: string[] } {
  const staff: string[] = [];
  for (const c of s.locations ?? []) for (const x of c.staff ?? []) if (x.name && !staff.includes(x.name)) staff.push(x.name);
  const patients: string[] = [];
  const reviews = [...(s.locations ?? [])].flatMap((c) => c.reviews ?? []).filter((r) => r.stars >= 5).sort((a, b) => b.weight - a.weight || b.day - a.day);
  for (const r of reviews) {
    if (patients.length >= maxPatients) break;
    if (r.name && !patients.includes(r.name)) patients.push(r.name);
  }
  return { staff, patients };
}
