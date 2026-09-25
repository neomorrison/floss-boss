// The finale (DESIGN 11.3, 11.4): the Golden Molar Gala showcase clean, the trophy, Legacy points and
// retiring into New Game+. Legacy points live in core/legacy.ts, apart from the run save.
import type { CleanResult, CleanSetup, GameState, HandsOnPayout, SimEvent, TwistId } from '../core/types';
import { clamp, hashSeed, makeRng } from '../core/rng';
import { money } from '../core/format';
import { loadLegacy, saveLegacy } from '../core/legacy';
import { ACHIEVEMENTS } from '../data/achievements';
import { CASES, CASE_ORDER } from '../data/cases';
import { OFFICES, TIER_ORDER } from '../data/offices';
import { S, addCash, addTimeline, note } from './internal';
import { gainXp, tierIndex, valuation } from './progress';
import { buildCaseSetup, caseLevel, masteryCount, masteryTier } from './cases';
import { diff, starsWith } from './difficulty';
import { emptyPayout, recordClean } from './career';
import { checkAchievements } from './goals';

/** The gala headliner (DESIGN 11.3). */
export const GALA_STAR = 'Lil Molar';
/** Stars the showcase needs to win the Golden Molar. */
export const GALA_WIN_STARS = 4;
/** Gala prize: GALA_PRIZE times the biggest office's tierScale ('Gala prize', not operating income). */
export const GALA_PRIZE = 25_000;
/** The crowd warms up: every failed attempt lowers the gala's star thresholds by GALA_MERCY, up to
 * GALA_MERCY_CAP, so the finale stays winnable for every player. */
export const GALA_MERCY = 0.015;
export const GALA_MERCY_CAP = 0.12;
/** Twists the headliner brings: chatty always, then these by seed, up to the difficulty's count. */
const GALA_TWISTS: TwistId[] = ['hiccups', 'fidget', 'sensitive', 'sleepy', 'gagger'];

/** Legacy points (DESIGN 11.4): 5 for the Golden Molar, 1 per 5 achievements, 1 per gold case mastery,
 * 1 per $1M valuation (at most 10). */
export const LEGACY_GOLDEN_MOLAR = 5;
export const LEGACY_PER_ACHIEVEMENTS = 5;
export const LEGACY_VALUATION_STEP = 1_000_000;
export const LEGACY_VALUATION_CAP = 10;

/** Twists at the gala: 2 on Relaxed, 3 otherwise (always chatty: he has a lot to say). */
function galaTwists(state: GameState, attempt: number): TwistId[] {
  const n = Math.max(2, Math.min(3, diff(state).maxTwists));
  const r = makeRng(hashSeed(state.seed, 'gala', attempt));
  const pool = [...GALA_TWISTS];
  const out: TwistId[] = ['chatty'];
  while (out.length < n && pool.length) out.push(pool.splice(r.int(0, pool.length - 1), 1)[0]);
  return out;
}

/** Whether the gala can be played now: the city reached 100% (the gala is scheduled), not won yet, and
 * at most one try a day. */
export function galaStatus(state: GameState): { unlocked: boolean; ready: boolean; won: boolean; attempts: number; reason?: string } {
  const f = state.finale;
  const unlocked = !!f?.galaUnlocked;
  const base = { unlocked, won: !!f?.won, attempts: f?.attempts ?? 0 };
  if (!unlocked) return { ...base, ready: false, reason: 'Smile City needs to reach 100%' };
  if (f.won) return { ...base, ready: false, reason: 'The Golden Molar is yours' };
  if (state.phase !== 'owner') return { ...base, ready: false, reason: 'Open a practice first' };
  if ((S(state).galaDay ?? -1) >= state.day) return { ...base, ready: false, reason: 'The next gala is tomorrow' };
  return { ...base, ready: true };
}

/**
 * The Golden Molar Gala showcase clean (DESIGN 11.3): the grillz case on stage (`special.showcase`), the rap
 * star Lil Molar, 12 gems, chatty plus two more twists (one on Relaxed), a comfort start of 75, the
 * difficulty rules of your title, eased by GALA_MERCY per failed attempt. Deterministic per attempt; no
 * numbing gel is used.
 */
export function galaSetup(state: GameState): CleanSetup {
  const f = state.finale;
  const attempt = (f?.attempts ?? 0) + 1;
  const c = state.locations[state.active] ?? state.locations[0] ?? null;
  const setup = buildCaseSetup(state, {
    patientId: `gala${attempt}`, name: GALA_STAR, archetype: 'rapper', service: 'cleaning', caseType: 'grillz',
    twists: galaTwists(state, attempt), dirtLevel: 0.8, level: Math.max(caseLevel(state, c), 8), tutorial: false, consumeGel: false,
    firstOfCase: !state.flags['case_seen_grillz'], bonus: 'spotless', showcase: true,
  });
  setup.seed = hashSeed(state.seed, 'gala', attempt);
  setup.traits = { ...setup.traits, comfortStart: 75 };
  const mercy = Math.min(GALA_MERCY_CAP, GALA_MERCY * (attempt - 1));
  setup.rules = { ...setup.rules, starShift: Math.round((setup.rules.starShift - mercy) * 1000) / 1000 };
  setup.lines = [
    'Tonight the whole city is watching, doc.',
    'Make the ice shine for the cameras.',
    ...setup.lines,
  ];
  return setup;
}

/**
 * Score the gala (DESIGN 11.3). 4+ stars wins: the Golden Molar (finale.won, wonDay), the gala prize, a
 * timeline entry, the Legacy store records the win (veteranUnlocked) and `legacy` shows what retiring
 * would pay now. Fewer stars (or a walkout or an abort) lets you try again tomorrow. The clean counts for
 * stats and grillz mastery like any hands-on clean; it never touches the clinic clock.
 */
export function completeGala(state: GameState, result: CleanResult): { won: boolean; payout: HandsOnPayout; lines: string[]; legacy: number; events: SimEvent[] } {
  const ev: SimEvent[] = [];
  const payout = emptyPayout();
  const st = galaStatus(state);
  if (!st.ready) return { won: false, payout, lines: [st.reason ?? 'The gala is not on tonight'], legacy: legacyPoints(state).total, events: ev };
  const f = state.finale;
  f.attempts += 1;
  S(state).galaDay = state.day;
  const lines: string[] = [];
  if (result.quit === 'abort') {
    lines.push(`${GALA_STAR} will be back on stage tomorrow.`);
    payout.lines = lines;
    return { won: false, payout, lines, legacy: legacyPoints(state).total, events: ev };
  }
  const setup = galaSetup({ ...state, finale: { ...f, attempts: f.attempts - 1 } } as GameState);
  const q = clamp(Number.isFinite(result.quality) ? result.quality : 0, 0, 1);
  const walked = result.quit === 'walkout';
  const stars = walked ? 1 : clamp(Math.round(Number.isFinite(result.stars) ? result.stars : starsWith(q, setup.rules, result.seconds, setup.parSeconds)), 1, 5);
  state.flags['case_seen_grillz'] = true;
  recordClean(state, walked ? result : { ...result, stars }, ev, 'rapper');
  payout.stars = stars;
  payout.quality = walked ? Math.min(q, 0.25) : q;
  payout.xp = walked ? 5 : Math.round(10 + 30 * q + (stars === 5 ? 5 : 0));
  payout.levelUps = gainXp(state, payout.xp, ev);
  // mastery like any hands-on clean of the grill case
  const count0 = masteryCount(state, 'grillz');
  const tier0 = masteryTier(count0);
  const count = count0 + (!walked && stars >= 3 ? 1 : 0);
  if (count !== count0) state.player.mastery.grillz = count;
  const tier = masteryTier(count);
  payout.mastery = { caseType: 'grillz', count, tier, tierUp: tier > tier0 };
  if (tier >= 3 && tier0 < 3) addTimeline(state, 'mastery', `Gold mastery: ${CASES.grillz.name}`);
  const won = !walked && stars >= GALA_WIN_STARS;
  if (won) {
    f.won = true;
    f.wonDay = state.day;
    const prize = galaPrize(state);
    payout.pay = prize;
    addCash(state, prize, 'Gala prize');
    addTimeline(state, 'award', `Won the Golden Molar at the Gala (${stars} stars)`);
    note(state, `The Golden Molar is yours. Gala prize ${money(prize)}.`);
    lines.push('The crowd goes wild. The Golden Molar is yours.', `${GALA_STAR}: "Best grill I ever had. Put that on the album."`, `Dr. Ruth Canal: "I always knew you had a flair for the dramatic."`);
    ev.push({ type: 'toast', text: 'You won the Golden Molar', kind: 'good' });
    recordWin(state);
  } else {
    lines.push(walked ? `${GALA_STAR} walked off stage. The crowd is still here tomorrow.` : `${stars} stars. The crowd wants an encore: try again tomorrow.`, `The Golden Molar needs ${GALA_WIN_STARS} stars or more.`);
    addTimeline(state, 'award', `Gala attempt ${f.attempts}: ${stars} stars`);
  }
  payout.lines = lines;
  checkAchievements(state, ev);
  return { won, payout, lines, legacy: legacyPoints(state).total, events: ev };
}

/** The gala prize now: GALA_PRIZE x the biggest office's tierScale. */
export function galaPrize(state: GameState): number {
  const top = state.locations.reduce((m, c) => Math.max(m, tierIndex(c.tier)), 0);
  return Math.round(GALA_PRIZE * OFFICES[TIER_ORDER[top]].tierScale);
}

/** A Golden Molar win is written to the Legacy store at once (wins, veteranUnlocked), even if the player
 * keeps running the chain and never retires. */
function recordWin(state: GameState): void {
  const s = S(state);
  if (s.legacyWinSaved) return;
  s.legacyWinSaved = true;
  const l = loadLegacy();
  l.wins += 1;
  l.veteranUnlocked = true;
  saveLegacy(l);
}

/** What retiring now is worth in Legacy points, line by line (DESIGN 11.4). */
export function legacyPoints(state: GameState): { goldenMolar: number; achievements: number; gold: number; valuation: number; total: number } {
  const goldenMolar = state.finale?.won ? LEGACY_GOLDEN_MOLAR : 0;
  const known = new Set(ACHIEVEMENTS.map((a) => a.id));
  const achievements = Math.floor(state.achievements.filter((a) => known.has(a)).length / LEGACY_PER_ACHIEVEMENTS);
  const gold = CASE_ORDER.filter((ct) => masteryTier(masteryCount(state, ct)) >= 3).length;
  const v = state.phase === 'owner' ? valuation(state) : 0;
  const val = Math.min(LEGACY_VALUATION_CAP, Math.max(0, Math.floor(v / LEGACY_VALUATION_STEP)));
  return { goldenMolar, achievements, gold, valuation: val, total: goldenMolar + achievements + gold + val };
}

/**
 * Retire (New Game+, DESIGN 11.4): converts the run into Legacy points, adds them to core/legacy (points,
 * earned, runs; a win also counts once in wins and sets veteranUnlocked) and marks finale.retired. Returns
 * the points earned; retiring twice earns nothing more.
 */
export function retire(state: GameState): number {
  if (state.finale?.retired) return 0;
  const pts = legacyPoints(state).total;
  const l = loadLegacy();
  l.points += pts;
  l.earned += pts;
  l.runs += 1;
  if (state.finale?.won && !S(state).legacyWinSaved) { l.wins += 1; l.veteranUnlocked = true; S(state).legacyWinSaved = true; }
  saveLegacy(l);
  state.finale.retired = true;
  addTimeline(state, 'career', `Retired with ${pts} Legacy ${pts === 1 ? 'point' : 'points'}`);
  return pts;
}

/** Trophy wall summary for the clinic view (DESIGN 11.2: ClinicView.setTrophies). */
export function trophies(state: GameState): { plaques: number; gold: number; milestones: number; goldenMolar: boolean } {
  return {
    plaques: state.achievements.length,
    gold: CASE_ORDER.filter((ct) => masteryTier(masteryCount(state, ct)) >= 3).length,
    milestones: state.finale?.milestones.length ?? 0,
    goldenMolar: !!state.finale?.won,
  };
}
