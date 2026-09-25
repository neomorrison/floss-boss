// Smile City: districts, the Smile Index, milestones, city grants and the Smile Van (DESIGN 11.1).
// Gains are deterministic: the neighbour share of a patient is picked from a hash of the patient id,
// so crediting the city never draws from the world RNG.
import type { Clinic, DayPatient, DistrictId, DistrictState, GameState, SimEvent } from '../core/types';
import { clamp, hashSeed } from '../core/rng';
import { money } from '../core/format';
import { CITY_MILESTONES, DISTRICTS, DISTRICT_ORDER, EMPLOYER_DISTRICT } from '../data/city';
import { OFFICES, TIER_ORDER } from '../data/offices';
import { S, addCash, addTimeline, note, pushEvent } from './internal';
import { tierIndex } from './progress';
import { diff } from './difficulty';

/** Share of a location's patients from its own district (the rest come from a random neighbour). */
export const HOME_SHARE = 0.8;
/** A second location in a district that already has one of yours adds only this share. */
export const SAME_DISTRICT_SHARE = 0.5;
/** Hands-on cleans count this many times (the owner's personal touch). */
export const HANDS_ON_CITY = 2;
/** Smile points lost per walkout: waited too long, or walked out of the chair. */
export const WALKOUT_WAIT_POINTS = 0.5;
export const WALKOUT_COMFORT_POINTS = 1;
/** Gentle decay: a district with fewer than DECAY_MIN_SERVED patients today loses DECAY_RATE x (index - start). */
export const DECAY_RATE = 0.004;
export const DECAY_MIN_SERVED = 3;
/** The Smile Van: free outreach cleanings a day in the least-smiling district without a location. */
export const VAN_CLEANINGS = 6;
export const VAN_QUALITY = 0.8;
/** City grant at a milestone: GRANT_PER_10 per 10% reached, times the biggest office's tierScale. */
export const GRANT_PER_10 = 500;
/** Smile points an event choice adds to its location's district (index = choice). */
export const CITY_EVENT_POINTS: Record<string, number[]> = {
  charity: [10, 3],
  school: [8, 0],
  toothFairy: [5, 0],
};
/** Milestone percents that unlock something (DESIGN 11.1). */
export const VAN_UNLOCK_PCT = 50;
export const NOMINATION_PCT = 70;
export const GALA_PLANNED_PCT = 90;
export const GALA_PCT = 100;

const isDistrict = (v: unknown): v is DistrictId => typeof v === 'string' && v in DISTRICTS;

export function initCity(): DistrictState[] {
  return DISTRICT_ORDER.map((id) => ({ id, index: DISTRICTS[id].start, served: 0 }));
}

/** Rebuild state.city from any saved shape: every district once, in order, finite values. */
export function fixCity(v: unknown): DistrictState[] {
  const list = Array.isArray(v) ? (v as Partial<DistrictState>[]) : [];
  return DISTRICT_ORDER.map((id) => {
    const d = list.find((x) => x && typeof x === 'object' && x.id === id);
    const idx = typeof d?.index === 'number' && Number.isFinite(d.index) ? clamp(d.index, 0, 1) : DISTRICTS[id].start;
    const served = typeof d?.served === 'number' && Number.isFinite(d.served) ? Math.max(0, Math.round(d.served)) : 0;
    return { id, index: idx, served };
  });
}

export function districtState(state: GameState, id: DistrictId): DistrictState {
  if (!Array.isArray(state.city) || state.city.length !== DISTRICT_ORDER.length) state.city = fixCity(state.city);
  let d = state.city.find((x) => x.id === id);
  if (!d) { state.city = fixCity(state.city); d = state.city.find((x) => x.id === id) as DistrictState; }
  return d;
}

/** City-wide Smile Index: the population-weighted mean of the districts (0..1). */
export function cityIndex(state: GameState): number {
  let w = 0;
  let s = 0;
  for (const id of DISTRICT_ORDER) {
    const pop = DISTRICTS[id].population;
    w += pop;
    s += pop * districtState(state, id).index;
  }
  return w > 0 ? s / w : 0;
}

/** Whole percent the UI shows (a milestone counts from its rounded value, so 99.5% reads and counts as 100%). */
export function cityPct(state: GameState): number {
  return Math.round(cityIndex(state) * 1000) / 10;
}

/** District of a clinic (the employer is Downtown). */
export function districtOfClinic(c: Clinic): DistrictId {
  return isDistrict(c.district) ? c.district : EMPLOYER_DISTRICT;
}

/** How many of your locations are in each district. */
function locationCounts(state: GameState): Record<DistrictId, number> {
  const n = Object.fromEntries(DISTRICT_ORDER.map((id) => [id, 0])) as Record<DistrictId, number>;
  for (const c of state.locations) n[districtOfClinic(c)] += 1;
  return n;
}

/** The least-smiling district without one of your locations (the least-smiling overall when every
 * district has one). `skip` leaves some out (a second Smile Van goes somewhere else). */
export function leastSmilingFree(state: GameState, skip: DistrictId[] = []): DistrictId {
  const n = locationCounts(state);
  const by = (ids: DistrictId[]) => [...ids].sort((a, b) => districtState(state, a).index - districtState(state, b).index || DISTRICT_ORDER.indexOf(a) - DISTRICT_ORDER.indexOf(b))[0];
  const free = DISTRICT_ORDER.filter((id) => n[id] === 0 && !skip.includes(id));
  if (free.length) return by(free);
  const rest = DISTRICT_ORDER.filter((id) => !skip.includes(id));
  return by(rest.length ? rest : DISTRICT_ORDER);
}

/** The district a new practice or location goes to: the requested one when valid, else the least-smiling
 * district without a location. */
export function pickDistrict(state: GameState, requested?: unknown): DistrictId {
  return isDistrict(requested) ? requested : leastSmilingFree(state);
}

/** Share a location adds: half for a second location in a district that already has an older one. */
function locationShare(state: GameState, c: Clinic): number {
  if (!c.ownedByPlayer) return 1;
  const d = districtOfClinic(c);
  const i = state.locations.indexOf(c);
  const older = state.locations.slice(0, Math.max(0, i)).some((l) => districtOfClinic(l) === d);
  return older ? SAME_DISTRICT_SHARE : 1;
}

/** Add smile points to a district (points / population = index). */
export function addPoints(state: GameState, id: DistrictId, points: number): void {
  if (!(Math.abs(points) > 0) || !Number.isFinite(points)) return;
  const d = districtState(state, id);
  d.index = Math.round(clamp(d.index + points / DISTRICTS[id].population, 0, 1) * 1e6) / 1e6;
}

function countServed(state: GameState, id: DistrictId, n: number): void {
  districtState(state, id).served += n;
  const s = S(state);
  const day = (s.cityDay ??= {});
  day[id] = (day[id] ?? 0) + n;
}

/** Which district a patient of this clinic comes from: 80% home, 20% a neighbour (hash of the id). */
export function patientDistrict(state: GameState, c: Clinic, p: DayPatient): DistrictId {
  const home = districtOfClinic(c);
  const h = hashSeed(state.seed, p.id, 'city');
  if ((h % 1000) / 1000 < HOME_SHARE) return home;
  const nb = DISTRICTS[home].neighbors;
  return nb.length ? nb[(h >>> 10) % nb.length] : home;
}

/** A patient was served (DESIGN 11.1): (quality - 0.5) x 2 smile points x cityGainMult, doubled for a
 * hands-on clean, halved at a second location in the same district. A clean below 0.5 lowers the index. */
export function creditPatient(state: GameState, c: Clinic, p: DayPatient, quality: number, hands: boolean): void {
  if (state.phase === 'school') return;
  const id = patientDistrict(state, c, p);
  const q = clamp(Number.isFinite(quality) ? quality : 0.5, 0, 1);
  let pts = (q - 0.5) * 2 * locationShare(state, c) * (hands ? HANDS_ON_CITY : 1);
  if (pts > 0) pts *= diff(state).cityGainMult;
  countServed(state, id, 1);
  addPoints(state, id, pts);
}

/** A walkout costs the patient's district smile points (wait -0.5, comfort -1). */
export function creditWalkout(state: GameState, c: Clinic, p: DayPatient, reason: 'wait' | 'comfort'): void {
  if (state.phase === 'school') return;
  const id = patientDistrict(state, c, p);
  addPoints(state, id, -(reason === 'wait' ? WALKOUT_WAIT_POINTS : WALKOUT_COMFORT_POINTS) * locationShare(state, c));
}

/** Event bonus (charity, school day, tooth fairy): points for the location's district. */
export function creditEvent(state: GameState, c: Clinic, eventId: string, choice: number): number {
  const pts = CITY_EVENT_POINTS[eventId]?.[choice] ?? 0;
  if (!(pts > 0)) return 0;
  const p = pts * diff(state).cityGainMult;
  addPoints(state, districtOfClinic(c), p);
  return p;
}

/** Smile Vans at the day close: each van serves the least-smiling district without a location (a second
 * van the next one), VAN_CLEANINGS cleanings at VAN_QUALITY. Returns the notes. */
export function runSmileVans(state: GameState): string[] {
  const vans = state.locations.filter((c) => c.equipment.includes('smileVan')).length;
  const out: string[] = [];
  const used: DistrictId[] = [];
  for (let i = 0; i < vans; i++) {
    const id = leastSmilingFree(state, used);
    used.push(id);
    countServed(state, id, VAN_CLEANINGS);
    addPoints(state, id, VAN_CLEANINGS * (VAN_QUALITY - 0.5) * 2 * diff(state).cityGainMult);
    out.push(`Smile Van: ${VAN_CLEANINGS} free cleanings in ${DISTRICTS[id].name}`);
  }
  return out;
}

/** Gentle decay at the day close: a district with fewer than 3 patients today drifts back toward its start. */
export function cityDecay(state: GameState): void {
  const day = S(state).cityDay ?? {};
  for (const id of DISTRICT_ORDER) {
    if ((day[id] ?? 0) >= DECAY_MIN_SERVED) continue;
    const d = districtState(state, id);
    const start = DISTRICTS[id].start;
    if (d.index > start) d.index = Math.round((d.index - DECAY_RATE * (d.index - start)) * 1e6) / 1e6;
  }
  S(state).cityDay = {};
}

/** City grant for a milestone, scaled by the biggest office you own. */
export function cityGrant(state: GameState, pct: number): number {
  const top = state.locations.reduce((m, c) => Math.max(m, tierIndex(c.tier)), 0);
  const scale = state.phase === 'owner' ? OFFICES[TIER_ORDER[top]].tierScale : 1;
  return Math.round((GRANT_PER_10 * pct / 10 * scale) / 50) * 50;
}

/**
 * Award every city milestone the Smile Index has reached (DESIGN 11.1): a timeline entry, a report note,
 * a 'toast' event, the city grant, and the unlock (50% the Smile Van, 70% the Golden Molar nomination,
 * 90% the gala is planned, 100% the parade and the Golden Molar Gala). Returns the percents reached now.
 */
export function checkMilestones(state: GameState, ev: SimEvent[] | null): number[] {
  if (state.phase === 'school') return [];
  const pct = cityPct(state);
  const got: number[] = [];
  const f = state.finale;
  for (const m of CITY_MILESTONES) {
    if (f.milestones.includes(m.pct) || pct < m.pct - 0.5) continue;
    f.milestones.push(m.pct);
    f.milestones.sort((a, b) => a - b);
    got.push(m.pct);
    const grant = cityGrant(state, m.pct);
    if (grant > 0) addCash(state, grant, 'City grant');
    // "Smile City 30%" titles say it already; named ones read "Smile City 50%: Halfway There"
    const head = m.title.startsWith('Smile City') ? m.title : `Smile City ${m.pct}%: ${m.title}`;
    addTimeline(state, 'city', `${head}. ${m.text}`);
    note(state, `${head}. ${m.text}${grant > 0 ? ` City grant ${money(grant)}.` : ''}`);
    pushEvent(ev, { type: 'toast', text: head, kind: 'good' });
    if (m.pct === NOMINATION_PCT) addTimeline(state, 'award', 'Nominated for the Golden Molar');
    if (m.pct >= GALA_PCT) {
      f.galaUnlocked = true;
      addTimeline(state, 'city', 'The Smile Parade. The Golden Molar Gala is scheduled.');
      note(state, 'The Golden Molar Gala is scheduled. Lil Molar needs his grill show-ready.');
    }
  }
  return got;
}

/** Smile City for the map, the hub and the Legacy screen (DESIGN 11.2). */
export function cityStatus(state: GameState): {
  index: number;
  pct: number;
  districts: { id: DistrictId; name: string; blurb: string; color: string; index: number; start: number; served: number; locations: number; population: number }[];
  next: { pct: number; title: string; text: string } | null;
  reached: number[];
  galaUnlocked: boolean;
  vanUnlocked: boolean;
} {
  const n = locationCounts(state);
  const reached = [...(state.finale?.milestones ?? [])];
  const next = CITY_MILESTONES.find((m) => !reached.includes(m.pct)) ?? null;
  return {
    index: Math.round(cityIndex(state) * 10000) / 10000,
    pct: cityPct(state),
    districts: DISTRICT_ORDER.map((id) => {
      const d = districtState(state, id);
      const def = DISTRICTS[id];
      return { id, name: def.name, blurb: def.blurb, color: def.color, index: d.index, start: def.start, served: d.served, locations: n[id], population: def.population };
    }),
    next: next ? { pct: next.pct, title: next.title, text: next.text } : null,
    reached,
    galaUnlocked: !!state.finale?.galaUnlocked,
    vanUnlocked: reached.includes(VAN_UNLOCK_PCT),
  };
}
