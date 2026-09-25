// PUBLIC SIM API. Owner: sim builder. The signatures below are the contract the UI codes against.
// Rules: pure TypeScript, no DOM, no window, no three.js, no Math.random() (use core/rng with state.rng).
// Every mutating function mutates `state` in place; the UI calls store.commit() afterwards.
//
// Notes for callers:
// - Money is whole dollars. state.cash always equals the sum of state.ledger (old entries fold into
//   one "Earlier activity" line). DayReport.income/expenses amounts are positive magnitudes.
// - Staff.portrait is 'staff_<n>' (see data/assets staffPortraitUrl), or 'boss' for Dr. Ruth Canal.
//   DayPatient.portrait and CleanSetup.patient.portrait are the archetype id (portraitUrl(archetype, mood)).
// - The employer clinic's first operatory (ops[0]) is the player's chair.
// - addonsFor accepts clinicIndex -1 for the employer in the employee phase. setPlayerMode refuses 'auto'
//   there (employees delegate with Quick clean, which needs Bronze mastery of the case).
// - Every DayPatient has caseType and twists (DESIGN 5.5, 5.6), NPC patients too.
import type {
  ActionResult, AddonId, CampaignId, CaseType, ChairTier, CleanResult, CleanSetup, Clinic, DayPatient, DayReport, EquipId, ExtraId,
  FocusId, GameState, HandsOnPayout, OfficeTierId, OfflineReport, OpUpgradeId, PendingEvent, PerkId, PriceKey, SimEvent, SkillId,
  ToolSlot,
} from '../core/types';
import * as manager from './manager';
import * as career from './career';
import * as economy from './economy';
import * as staff from './staff';
import * as sel from './selectors';
import * as prog from './progress';
import * as cases from './cases';
import { tickWorld } from './clinic';
import { claimGoal as claim } from './goals';

// ------------------------------------------------------------------ lifecycle
/** A fresh game in the school phase at day 1, 8:00. */
export function newGame(opts: { name: string; avatar: number; seed?: number; nowMs: number }): GameState { return career.newGame(opts); }
/** Fill in fields missing from older saves. */
export function migrate(state: GameState): GameState { return career.migrate(state); }

// ------------------------------------------------------------------ clock
/** Advance the game clock by `minutes` (all clinics). Returns events for toasts, audio and the clinic view. No-op in school. */
export function tick(state: GameState, minutes: number): SimEvent[] { return tickWorld(state, minutes); }
/** True when the clinics are closed and every patient has left (state.dayOver). */
export function isDayOver(state: GameState): boolean { return state.dayOver; }
/** Close the day: charge costs, build the report, advance to the next working day (8:00) and book it.
 * The returned report carries `events` (achievements, level-ups, quits) for the UI to emit after it.
 * Raise asks are settled here (DESIGN 8.5): `settings.autoRaise` or an Office Manager at the location approves
 * asks up to +15% (report note "Auto raise: Ava +$12"); only a request that needs the owner emits 'raiseRequest'. */
export function closeDay(state: GameState): DayReport { return economy.closeDay(state); }

// ------------------------------------------------------------------ school
/** Setup for school practical 1 or 2 (tutorial: true on step 1). */
export function schoolSetup(state: GameState, step: 1 | 2): CleanSetup { return career.schoolSetup(state, step); }
/** Apply a school result (XP only). After step 2 the player graduates into the employee phase. */
export function completeSchool(state: GameState, step: 1 | 2, result: CleanResult): HandsOnPayout { return career.completeSchool(state, step, result); }

// ------------------------------------------------------------------ hands-on
/** Patients sitting in the player's chair(s) waiting for the player, in the active clinic. */
export function playerQueue(state: GameState): DayPatient[] { return career.playerQueue(state); }
/**
 * Build the clean for a patient waiting in your chair (v2 case setup). Throws 'This patient is not ready yet'
 * unless the patient is in the chair waiting for you. Freezes nothing: the UI stops ticking while cleaning.
 */
export function beginHandsOn(state: GameState, patientId: string): CleanSetup { return career.beginHandsOn(state, patientId); }
/**
 * Apply a finished clean (pay, tip, XP, review, goals, mastery, treasure), then fast-forward the clinic by
 * HANDS_ON_MINUTES[service]. Returns the payout and the events of that window ("while you were cleaning").
 * quit 'abort': no pay, the patient goes back to waiting (the fast-forward is skipped).
 */
export function completeHandsOn(state: GameState, patientId: string, result: CleanResult): { payout: HandsOnPayout; events: SimEvent[] } { return career.completeHandsOn(state, patientId, result); }
/**
 * Quick clean (DESIGN 5.9): needs Bronze mastery of the patient's case, else returns an empty payout and
 * changes nothing. Auto quality, 50% of the wage (owner: the fee), no tip, no XP, no mastery, streak or
 * goals; fast-forwards QUICK_CLEAN_MINUTES.
 */
export function quickClean(state: GameState, patientId: string): { payout: HandsOnPayout; events: SimEvent[] } { return career.quickClean(state, patientId); }
/** Whether Quick clean can take this patient, and the Bronze progress for "Bronze needed: 1/3". */
export function quickCleanStatus(state: GameState, patientId: string): { ok: boolean; count: number; need: number } { return career.quickCleanStatus(state, patientId); }
/** Mastery of a case type: hands-on cleans of 3+ stars, tier (0 none, 1 bronze, 2 silver, 3 gold), next threshold. */
export function caseMastery(state: GameState, caseType: CaseType): { count: number; tier: 0 | 1 | 2 | 3; next: number | null } { return cases.caseMastery(state, caseType); }

// ------------------------------------------------------------------ player shop and skills
export function buyTool(state: GameState, slot: ToolSlot, tier: number): ActionResult { return economy.buyTool(state, slot, tier); }
export function buyExtra(state: GameState, id: ExtraId): ActionResult { return economy.buyExtra(state, id); }
export function buyGel(state: GameState, count: number): ActionResult { return economy.buyGel(state, count); }
export function learnSkill(state: GameState, id: SkillId): ActionResult { return economy.learnSkill(state, id); }
export function skillStatus(state: GameState, id: SkillId): 'learned' | 'available' | 'locked' { return economy.skillStatus(state, id); }

// ------------------------------------------------------------------ practice
export function practiceStatus(state: GameState): { ok: boolean; price: number; maxLoan: number; cashNeeded: number; reasons: string[] } { return economy.practiceStatus(state); }
/** Open the first practice (T1). `loan` is borrowed from the bank (<= maxLoan). Phase becomes 'owner'. */
export function openPractice(state: GameState, opts: { name: string; loan: number }): ActionResult { return economy.openPractice(state, opts); }

// ------------------------------------------------------------------ staff (clinicIndex = index into state.locations)
export function hire(state: GameState, candidateId: string, clinicIndex: number): ActionResult { return staff.hire(state, candidateId, clinicIndex); }
export function fire(state: GameState, clinicIndex: number, staffId: string): ActionResult { return staff.fire(state, clinicIndex, staffId); }
export function train(state: GameState, clinicIndex: number, staffId: string): ActionResult { return staff.train(state, clinicIndex, staffId); }
/** Set a salary (75% to 200% of the ask). A raise starts the staff member's 10-day quiet period for raise
 * requests (DESIGN 8.5). */
export function setSalary(state: GameState, clinicIndex: number, staffId: string, salary: number): ActionResult { return staff.setSalary(state, clinicIndex, staffId, salary); }
/** staffId: a hygienist id, 'player' (your chair) or null (empty). One op per hygienist; the player may hold one op per clinic. */
export function assignHygienist(state: GameState, clinicIndex: number, opId: string, staffId: string | null): ActionResult { return staff.assignHygienist(state, clinicIndex, opId, staffId); }
export function assignAssistant(state: GameState, clinicIndex: number, opId: string, staffId: string | null): ActionResult { return staff.assignAssistant(state, clinicIndex, opId, staffId); }
export function setPlayerMode(state: GameState, clinicIndex: number, opId: string, mode: 'hands' | 'auto'): ActionResult { return staff.setPlayerMode(state, clinicIndex, opId, mode); }
/** What Raise all (the Payroll Day skill, DESIGN 8.5) would do right now, without changing anything: every
 * staff member below their ask at the location (or every location with 'all'), and the total daily cost.
 * With Hard Bargain learned each raise pays only 60% of the gap (`perDay`); `fullPerDay` is always the
 * uncapped cost, so the UI can show the saving. `ok` is false with a reason when Payroll Day is not learned
 * or nobody there is paid below their ask. */
export function raiseAllQuote(state: GameState, clinicIndex: number | 'all'): { ok: boolean; reason?: string; count: number; perDay: number; fullPerDay: number; staff: { clinicIndex: number; staffId: string; name: string; from: number; to: number }[] } { return staff.raiseAllQuote(state, clinicIndex); }
/** Raise all (DESIGN 8.5, needs the Payroll Day skill): raises every staff member paid below their ask at
 * the location (or 'all' of them) up to their ask. With Hard Bargain, pays only 60% of each gap and the
 * staff member accepts it as a full raise (their ask drops to match, so no follow-up request from that
 * gap). Same bookkeeping as a manual raise via setSalary: morale +5, raise request cleared, 10-day quiet
 * period restarted. A recurring salary change, not a one-off charge: cash and the ledger are untouched
 * here, salaries are paid at the day close as usual. */
export function raiseAll(state: GameState, clinicIndex: number | 'all'): ActionResult { return staff.raiseAll(state, clinicIndex); }

// ------------------------------------------------------------------ office
export function buyOperatory(state: GameState, clinicIndex: number): ActionResult { return economy.buyOperatory(state, clinicIndex); }
export function upgradeChair(state: GameState, clinicIndex: number, opId: string, tier: ChairTier): ActionResult { return economy.upgradeChair(state, clinicIndex, opId, tier); }
export function buyOpUpgrade(state: GameState, clinicIndex: number, opId: string, id: OpUpgradeId): ActionResult { return economy.buyOpUpgrade(state, clinicIndex, opId, id); }
export function buyEquipment(state: GameState, clinicIndex: number, id: EquipId): ActionResult { return economy.buyEquipment(state, clinicIndex, id); }
export function moveQuote(state: GameState, clinicIndex: number, tier: OfficeTierId): { price: number; tradeIn: number; net: number; maxLoan: number; ok: boolean; reason?: string } { return economy.moveQuote(state, clinicIndex, tier); }
export function moveOffice(state: GameState, clinicIndex: number, tier: OfficeTierId, loan: number): ActionResult { return economy.moveOffice(state, clinicIndex, tier, loan); }
export function locationQuote(state: GameState, tier: OfficeTierId): { price: number; maxLoan: number; ok: boolean; reason?: string } { return economy.locationQuote(state, tier); }
export function openLocation(state: GameState, tier: OfficeTierId, name: string, loan: number): ActionResult { return economy.openLocation(state, tier, name, loan); }
export function setPrice(state: GameState, clinicIndex: number, key: PriceKey, mult: number): void { economy.setPrice(state, clinicIndex, key, mult); }
export function setMarketing(state: GameState, clinicIndex: number, level: 0 | 1 | 2 | 3): void { economy.setMarketing(state, clinicIndex, level); }
/** Which clinic the UI shows: -1 = the employer (employee phase), else an index into state.locations. */
export function setActive(state: GameState, index: number): void { economy.setActive(state, index); }

// ------------------------------------------------------------------ money and goals
export function takeLoan(state: GameState, amount: number): ActionResult { return economy.takeLoan(state, amount); }
export function repayLoan(state: GameState, amount: number): ActionResult { return economy.repayLoan(state, amount); }
export function maxLoan(state: GameState): number { return economy.maxLoan(state); }
export function claimGoal(state: GameState, goalId: string): ActionResult { return claim(state, goalId); }

// ------------------------------------------------------------------ manager layer (DESIGN 10)
/** True while today's Morning Huddle waits for the owner (owner phase, after "Next day"). tick() completes
 * it automatically (events answered with their first choice) if the clock starts first. */
export function huddlePending(state: GameState): boolean { return manager.huddlePending(state); }
/** Focus slots (1, 2 with Huddle Pro), today's selection, and every focus with ok/reason (office tier). */
export function focusOptions(state: GameState): { slots: number; selected: FocusId[]; options: { id: FocusId; name: string; text: string; ok: boolean; reason?: string }[] } { return manager.focusOptions(state); }
/** Pick today's Daily Focus (1 id, or 2 with Huddle Pro; [] = Steady). Validates the office tier. Before the
 * doors open the day is rebooked with the new walk-in and speed effects. The focus is kept for later days. */
export function setFocus(state: GameState, focusIds: FocusId[]): ActionResult { return manager.setFocus(state, focusIds); }
/** Title, text, icon art, location name and choices (label + hint with cash scaled to the office) of a
 * pending event, with {staff}, {clinic}, {op} and {equip} filled in. */
export function eventText(state: GameState, pending: PendingEvent): { title: string; text: string; art: string; clinic: string; choices: { label: string; hint: string }[] } { return manager.eventText(state, pending); }
/** Answer state.pendingEvents[pendingIndex] with a choice (0-based). Applies its effects (a risky choice
 * rolls; Crisis Manager +20%), logs it in state.eventLog and the day report, and returns the outcome text
 * and whether it went well. Before the doors open the location is rebooked to reflect the decision. */
export function resolveEvent(state: GameState, pendingIndex: number, choice: number): { text: string; good: boolean } { return manager.resolveEvent(state, pendingIndex, choice); }
/** "Open the doors": answers leftover events with their first choice and marks today's huddle done.
 * Returns each auto-answered outcome. */
export function completeHuddle(state: GameState): { eventId: string; clinicId: string; text: string; good: boolean }[] { return manager.completeHuddle(state); }
/** Whether a campaign can start at a location now (reason when not), its cost (x tierScale, Brand Builder
 * -25%), its length, what is running and the cooldown day. */
export function campaignStatus(state: GameState, clinicIndex: number, id: CampaignId): { ok: boolean; cost: number; days: number; reason?: string; active: CampaignId | null; activeUntil: number | null; cooldownUntil: number } { return manager.campaignStatus(state, clinicIndex, id); }
/** Start a campaign (one per location, cooldown after). Before the doors open it runs from today, otherwise
 * it starts tomorrow. Adds a 'campaign:<id>:<startDay>' modifier (demand, case boost) that is not in force
 * before its start day: a start day after state.day reads "Starts tomorrow". */
export function startCampaign(state: GameState, clinicIndex: number, id: CampaignId): ActionResult { return manager.startCampaign(state, clinicIndex, id); }
/** Today's outlook of a location: expected new patients, capacity, booked and the waitlist booked first. */
export function dayOutlook(state: GameState, clinicIndex: number): { lambda: number; capacity: number; booked: number; waitlist: number } { return manager.dayOutlook(state, clinicIndex); }
/** Pick one of the two perks a staff member was offered at a level-up (Staff.pendingPerks). Unpicked perks
 * are auto-picked (the first) after 2 days. */
export function pickPerk(state: GameState, clinicIndex: number, staffId: string, perk: PerkId): ActionResult { return staff.pickPerk(state, clinicIndex, staffId, perk); }
/** Offer a perk choice now with the real level-up rules (two perks of the role not owned yet, auto-picked
 * after 2 days). For the debug hook; an offer already waiting is kept. Fills Staff.pendingPerks. */
export function offerPerks(state: GameState, clinicIndex: number, staffId: string): ActionResult { return staff.offerPerks(state, clinicIndex, staffId); }
/** Interview a candidate: exact stats and traits (Candidate.interviewed, range collapses). */
export function interview(state: GameState, candidateId: string): ActionResult { return staff.interview(state, candidateId); }
/** What an interview costs now ($40 x tierScale of the active office, free with Talent Scout). */
export function interviewCost(state: GameState): number { return staff.interviewCost(state); }
/** What a training course costs now (HR Guru -40%, Research Wing halves it). */
export function trainingCost(state: GameState): number { return staff.trainingCost(state); }
/** What a piece of equipment costs at a location today: Bulk Buyer -10% and a salesman's discount. */
export function equipmentPrice(state: GameState, clinicIndex: number, id: EquipId): number { return economy.equipmentPrice(state, clinicIndex, id); }
/** Price of a chair tier (Bulk Buyer applies). */
export function chairPrice(state: GameState, tier: ChairTier): number { return economy.chairPrice(state, tier); }
/** Price of an operatory upgrade (Bulk Buyer applies). */
export function opUpgradePrice(state: GameState, id: OpUpgradeId): number { return economy.opUpgradePrice(state, id); }

// ------------------------------------------------------------------ selectors (read-only)
export function activeClinic(state: GameState): Clinic | null { return sel.activeClinic(state); }
export function title(state: GameState): string { return prog.title(state); }
export function xpToNext(level: number): number { return prog.xpToNext(level); }
export function autoQuality(state: GameState): number { return prog.autoQuality(state); }
export function forecast(state: GameState, clinicIndex: number): { demand: number; capacity: number; revenue: number; costs: number } { return sel.forecast(state, clinicIndex); }
export function valuation(state: GameState): number { return prog.valuation(state); }
/** Offline earnings on load (DESIGN 8.9); applies the credit and returns the report, or null. */
export function applyOffline(state: GameState, nowMs: number): OfflineReport | null { return sel.applyOffline(state, nowMs); }
/** Short product-voice hint for what to do next (hub tip line). */
export function nextHint(state: GameState): string { return sel.nextHint(state); }
/** Accepted add-ons of a patient that the sim would bill (for UI previews). */
export function addonsFor(state: GameState, clinicIndex: number, patientId: string): AddonId[] { return sel.addonsFor(state, clinicIndex, patientId); }
