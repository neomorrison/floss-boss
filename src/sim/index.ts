// PUBLIC SIM API. Owner: sim builder. The signatures below are the contract the UI codes against;
// the sim builder replaces every stub body (and may split the work into other files under src/sim/).
// Rules: pure TypeScript, no DOM, no window, no three.js, no Math.random() (use core/rng with state.rng).
// Every mutating function mutates `state` in place; the UI calls store.commit() afterwards.
import type {
  ActionResult, AddonId, ChairTier, CleanResult, CleanSetup, Clinic, DayPatient, DayReport, EquipId, ExtraId,
  GameState, HandsOnPayout, OfficeTierId, OfflineReport, OpUpgradeId, PriceKey, SimEvent, SkillId, ToolSlot,
} from '../core/types';

const todo = (name: string): never => { throw new Error(`sim.${name} not built yet`); };

// ------------------------------------------------------------------ lifecycle
/** A fresh game in the school phase at day 1, 8:00. */
export function newGame(opts: { name: string; avatar: number; seed?: number; nowMs: number }): GameState { return todo('newGame'); }
/** Fill in fields missing from older saves. */
export function migrate(state: GameState): GameState { return state; }

// ------------------------------------------------------------------ clock
/** Advance the game clock by `minutes` (all clinics). Returns events for toasts, audio and the clinic view. No-op in school. */
export function tick(state: GameState, minutes: number): SimEvent[] { return todo('tick'); }
/** True when the clinics are closed and every patient has left (state.dayOver). */
export function isDayOver(state: GameState): boolean { return state.dayOver; }
/** Close the day: charge costs, build the report, advance to the next working day (8:00) and book it. */
export function closeDay(state: GameState): DayReport { return todo('closeDay'); }

// ------------------------------------------------------------------ school
/** Setup for school practical 1 or 2 (tutorial: true on step 1). */
export function schoolSetup(state: GameState, step: 1 | 2): CleanSetup { return todo('schoolSetup'); }
/** Apply a school result (XP only). After step 2 the player graduates into the employee phase. */
export function completeSchool(state: GameState, step: 1 | 2, result: CleanResult): HandsOnPayout { return todo('completeSchool'); }

// ------------------------------------------------------------------ hands-on
/** Patients sitting in the player's chair(s) waiting for the player, in the active clinic. */
export function playerQueue(state: GameState): DayPatient[] { return todo('playerQueue'); }
/** Build the clean for a waiting patient. Freezes nothing by itself: the UI stops ticking while cleaning. */
export function beginHandsOn(state: GameState, patientId: string): CleanSetup { return todo('beginHandsOn'); }
/**
 * Apply a finished clean (pay, tip, XP, review, goals), then fast-forward the clinic by
 * HANDS_ON_MINUTES[service]. Returns the payout and the events of that window ("while you were cleaning").
 * quit 'abort': no pay, the patient goes back to waiting (the fast-forward is skipped).
 */
export function completeHandsOn(state: GameState, patientId: string, result: CleanResult): { payout: HandsOnPayout; events: SimEvent[] } { return todo('completeHandsOn'); }
/** Auto clean at autoQuality (no tip, half XP), fast-forwards QUICK_CLEAN_MINUTES. */
export function quickClean(state: GameState, patientId: string): { payout: HandsOnPayout; events: SimEvent[] } { return todo('quickClean'); }

// ------------------------------------------------------------------ player shop and skills
export function buyTool(state: GameState, slot: ToolSlot, tier: number): ActionResult { return todo('buyTool'); }
export function buyExtra(state: GameState, id: ExtraId): ActionResult { return todo('buyExtra'); }
export function buyGel(state: GameState, count: number): ActionResult { return todo('buyGel'); }
export function learnSkill(state: GameState, id: SkillId): ActionResult { return todo('learnSkill'); }
export function skillStatus(state: GameState, id: SkillId): 'learned' | 'available' | 'locked' { return todo('skillStatus'); }

// ------------------------------------------------------------------ practice
export function practiceStatus(state: GameState): { ok: boolean; price: number; maxLoan: number; cashNeeded: number; reasons: string[] } { return todo('practiceStatus'); }
/** Open the first practice (T1). `loan` is borrowed from the bank (<= maxLoan). Phase becomes 'owner'. */
export function openPractice(state: GameState, opts: { name: string; loan: number }): ActionResult { return todo('openPractice'); }

// ------------------------------------------------------------------ staff (clinicIndex = index into state.locations)
export function hire(state: GameState, candidateId: string, clinicIndex: number): ActionResult { return todo('hire'); }
export function fire(state: GameState, clinicIndex: number, staffId: string): ActionResult { return todo('fire'); }
export function train(state: GameState, clinicIndex: number, staffId: string): ActionResult { return todo('train'); }
export function setSalary(state: GameState, clinicIndex: number, staffId: string, salary: number): ActionResult { return todo('setSalary'); }
/** staffId: a hygienist id, 'player' (your chair) or null (empty). One op per hygienist; the player may hold one op per clinic. */
export function assignHygienist(state: GameState, clinicIndex: number, opId: string, staffId: string | null): ActionResult { return todo('assignHygienist'); }
export function assignAssistant(state: GameState, clinicIndex: number, opId: string, staffId: string | null): ActionResult { return todo('assignAssistant'); }
export function setPlayerMode(state: GameState, clinicIndex: number, opId: string, mode: 'hands' | 'auto'): ActionResult { return todo('setPlayerMode'); }

// ------------------------------------------------------------------ office
export function buyOperatory(state: GameState, clinicIndex: number): ActionResult { return todo('buyOperatory'); }
export function upgradeChair(state: GameState, clinicIndex: number, opId: string, tier: ChairTier): ActionResult { return todo('upgradeChair'); }
export function buyOpUpgrade(state: GameState, clinicIndex: number, opId: string, id: OpUpgradeId): ActionResult { return todo('buyOpUpgrade'); }
export function buyEquipment(state: GameState, clinicIndex: number, id: EquipId): ActionResult { return todo('buyEquipment'); }
export function moveQuote(state: GameState, clinicIndex: number, tier: OfficeTierId): { price: number; tradeIn: number; net: number; maxLoan: number; ok: boolean; reason?: string } { return todo('moveQuote'); }
export function moveOffice(state: GameState, clinicIndex: number, tier: OfficeTierId, loan: number): ActionResult { return todo('moveOffice'); }
export function locationQuote(state: GameState, tier: OfficeTierId): { price: number; maxLoan: number; ok: boolean; reason?: string } { return todo('locationQuote'); }
export function openLocation(state: GameState, tier: OfficeTierId, name: string, loan: number): ActionResult { return todo('openLocation'); }
export function setPrice(state: GameState, clinicIndex: number, key: PriceKey, mult: number): void { todo('setPrice'); }
export function setMarketing(state: GameState, clinicIndex: number, level: 0 | 1 | 2 | 3): void { todo('setMarketing'); }
/** Which clinic the UI shows: -1 = the employer (employee phase), else an index into state.locations. */
export function setActive(state: GameState, index: number): void { todo('setActive'); }

// ------------------------------------------------------------------ money and goals
export function takeLoan(state: GameState, amount: number): ActionResult { return todo('takeLoan'); }
export function repayLoan(state: GameState, amount: number): ActionResult { return todo('repayLoan'); }
export function maxLoan(state: GameState): number { return todo('maxLoan'); }
export function claimGoal(state: GameState, goalId: string): ActionResult { return todo('claimGoal'); }

// ------------------------------------------------------------------ selectors (read-only)
export function activeClinic(state: GameState): Clinic | null { return todo('activeClinic'); }
export function title(state: GameState): string { return todo('title'); }
export function xpToNext(level: number): number { return Math.round(60 * Math.pow(level, 1.4)); }
export function autoQuality(state: GameState): number { return todo('autoQuality'); }
export function forecast(state: GameState, clinicIndex: number): { demand: number; capacity: number; revenue: number; costs: number } { return todo('forecast'); }
export function valuation(state: GameState): number { return todo('valuation'); }
/** Offline earnings on load (DESIGN 8.9); applies the credit and returns the report, or null. */
export function applyOffline(state: GameState, nowMs: number): OfflineReport | null { return todo('applyOffline'); }
/** Short product-voice hint for what to do next (hub tip line). */
export function nextHint(state: GameState): string { return todo('nextHint'); }
/** Accepted add-ons of a patient that the sim would bill (for UI previews). */
export function addonsFor(state: GameState, clinicIndex: number, patientId: string): AddonId[] { return todo('addonsFor'); }
