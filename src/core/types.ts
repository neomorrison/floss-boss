// Shared types for Floss Boss. Orchestrator-owned: builders import these and never edit them.
// If a contract must change, adapt locally and report the change you need.
// Formulas and numbers live in docs/DESIGN.md.

// ------------------------------------------------------------------ ids

export type ArchetypeId =
  | 'mannequin' | 'regular' | 'coffee' | 'kid' | 'nervous' | 'gagger'
  | 'smoker' | 'senior' | 'influencer' | 'athlete' | 'chatty' | 'pirate' | 'rapper';

/** What kind of job a patient brings (docs/DESIGN.md 5). Drives objectives, special mechanics and pay. */
export type CaseType = 'routine' | 'whitening' | 'pirate' | 'candy' | 'braces' | 'deep' | 'grillz';
/** Per-patient complications layered on a case. */
export type TwistId = 'chatty' | 'gagger' | 'fidget' | 'sensitive' | 'hiccups' | 'sleepy';
/** Optional stretch goal per patient. */
export type BonusId = 'noSlips' | 'fast' | 'combo' | 'spotless' | 'treasure';

export type ServiceId = 'cleaning' | 'deep';
export type AddonId = 'fluoride' | 'sealant' | 'xray' | 'whitening' | 'exam' | 'filling';
export type PriceKey = ServiceId | AddonId;

export type ToolSlot = 'scaler' | 'polisher' | 'floss' | 'suction' | 'rinse';
export type ExtraId = 'loupes' | 'headlamp' | 'disclosing' | 'headphones';
export type SkillId =
  | 'steady1' | 'steady2' | 'power' | 'polishPro' | 'eagleEye' | 'speedCleaner'
  | 'calmingVoice' | 'smallTalk' | 'kidWhisperer' | 'gagGuru' | 'tipMagnet'
  | 'negotiator' | 'marketer' | 'leader' | 'leanOps' | 'upseller'
  // business (v3)
  | 'paperworkPro' | 'bulkBuyer' | 'brandBuilder' | 'investorRelations' | 'franchiseSavvy'
  // management (v3)
  | 'talentScout' | 'hrGuru' | 'huddlePro' | 'crisisManager' | 'delegator' | 'nightShift' | 'mentorProgram' | 'moraleOfficer'
  | 'payrollDay' | 'hardBargain';

export type StaffRole = 'hygienist' | 'receptionist' | 'assistant' | 'dentist' | 'manager';
export type TraitId = 'perfectionist' | 'speedy' | 'charmer' | 'clumsy' | 'nightOwl' | 'loyal' | 'ambitious';

export type OfficeTierId = 't1' | 't2' | 't3' | 't4';
export type ChairTier = 'basic' | 'comfort' | 'deluxe';
export type OpUpgradeId = 'tv' | 'whiteningLamp' | 'intraoralCam' | 'ergoStool' | 'nitrous';
export type EquipId =
  | 'deepCert' | 'xray' | 'sterilizer' | 'ultrasonicKits' | 'espresso'
  | 'fishTank' | 'kidsCorner' | 'onlineBooking' | 'breakRoom'
  // v3: more equipment, some exclusive to bigger offices (EquipDef.minTier)
  | 'waterFilter' | 'aromatherapy' | 'loyaltyProgram' | 'staffLockers'
  | 'digitalXray' | 'soundMasking' | 'patientApp' | 'nitrousSystem'
  | 'laserWhitening' | 'spaLounge' | 'cadcam' | 'rooftopGarden'
  | 'smileStudio' | 'researchWing' | 'helipad' | 'aiScheduler'
  | 'smileVan';

// ------------------------------------------------------------------ manager layer (v3, DESIGN 10)
export type FocusId = 'steady' | 'speed' | 'quality' | 'walkin' | 'upsell' | 'team' | 'training';
export type CampaignId = 'kidsWeek' | 'smileMakeover' | 'goldenYears' | 'bracesBonanza' | 'pirateDay' | 'grandOpening';
export type PerkId =
  | 'whiteningPro' | 'kidMagnet' | 'bracesWhiz' | 'deepDiver' | 'pirateWhisperer'
  | 'speedDemon' | 'gentleHands' | 'mentor' | 'ironLungs' | 'upsellStar';

/** A temporary or permanent effect on one clinic, from an event, a campaign or the daily focus. Multipliers default to 1. */
export interface ClinicModifier {
  id: string;
  label: string;                 // shown in the office and huddle ("Pirate Festival: pirates x4")
  source: 'event' | 'campaign' | 'focus';
  untilDay: number | null;       // last day it applies; null = permanent
  demand?: number; fees?: number; supplies?: number; speed?: number; comfort?: number;
  quality?: number;              // additive
  addons?: number; walkins?: number; noShows?: number;
  caseBoost?: Partial<Record<CaseType, number>>;
  closedOpId?: string;           // this operatory cannot take patients
  openDelay?: number;            // minutes the clinic opens late today
}

/** An event card waiting for the owner's decision (DESIGN 10.2). */
export interface PendingEvent {
  eventId: string;
  clinicId: string;
  day: number;
  vars: Record<string, string>;  // {staff}, {staffId}, {clinic}, {op} ... filled into the texts
}

export type Phase = 'school' | 'employee' | 'owner';

// ------------------------------------------------------------------ end game (DESIGN 11)
export type DistrictId = 'downtown' | 'harbor' | 'maple' | 'university' | 'oldtown' | 'uptown';
export type Difficulty = 'relaxed' | 'standard' | 'veteran';
export type LegacyPerkId = 'headStart' | 'prodigy' | 'famousName' | 'trainedHands' | 'alumniNetwork' | 'goldScrubs';

export interface DistrictState {
  id: DistrictId;
  index: number;              // Smile Index 0..1 for this district
  served: number;             // lifetime patients from this district
}

export interface TimelineEntry { day: number; text: string; kind: 'career' | 'office' | 'city' | 'award' | 'mastery' }

export interface FinaleState {
  milestones: number[];       // city-wide Smile Index milestones reached (10, 20, ... 100)
  galaUnlocked: boolean;      // city at 100%: the Golden Molar Gala is scheduled
  attempts: number;           // showcase cleans tried
  won: boolean;               // Golden Molar won
  wonDay: number | null;
  retired: boolean;           // the player retired this run into New Game+
}
export type Speed = 0 | 1 | 2 | 4;

// ------------------------------------------------------------------ mouth / clean contract

export type ToothKind = 'incisor' | 'canine' | 'premolar' | 'molar';

export interface DirtProfile {
  plaque: number;        // 0..1 amount (coverage ~ plaque * 0.45 of the reachable region)
  stain: number;         // 0..1
  tartarCount: number;   // discrete deposits
  tartarSize: number;    // mean deposit size (hp = size)
  debrisCount: number;   // food bits in gaps
}

export interface PatientTraits {
  comfortStart: number;   // 0..100
  comfortDrain: number;   // passive drain multiplier
  gumSensitivity: number; // gum damage multiplier
  gag: boolean;
  fidget: number;         // 0..1 sway amplitude
  chatty: boolean;
}

/** Tool loadout the player brings into a clean. Tiers index into TOOLS[slot]. */
export interface ToolLoadout {
  scaler: number;    // 1..5 (4, 5 = ultrasonic)
  polisher: number;  // 1..3
  floss: number;     // 1..3
  suction: number;   // 1..2
  rinse: number;     // 1
  extras: ExtraId[];
  numbingGel: boolean;  // one gel will be used on this patient
}

/** Multipliers from skills. 1 = no effect. */
export interface CleanModifiers {
  gumDamage: number;       // steady hands: 0.75, 0.5
  scalerPower: number;     // power stroke: 1.25
  polishRadius: number;    // polish pro: 1.25
  polishSpeed: number;
  eagleEye: boolean;
  parMult: number;         // speed cleaner: 1.2
  reassure: number;        // calming voice: 1.5
  comfortDrain: number;    // small talk: 0.8 (headphones applied separately by the scene)
  fidget: number;          // kid whisperer: 0.4
  gagDelay: number;        // seconds added, gag guru: 2
}

/** Case-specific content of a clean (zero / false / null when unused). */
export interface CaseSpecial {
  goldTooth: number | null;  // pirate: tooth index rendered in gold, to buff to a shine
  braces: boolean;           // brackets + wire on the outward faces of arch positions 2..11
  startShade: number;        // shade guide 1 (brightest) .. 16 (darkest); tints the enamel
  targetShade: number;       // whitening: goal shade (0 when not whitening)
  sugarBugs: number;         // candy: bugs to squash
  sealants: number;          // candy: molars to seal
  pockets: number;           // deep: gum pockets hiding tartar
  treasure: boolean;         // pirate: a doubloon wedged in a molar gap
  barnacles: number;         // pirate: tough barnacle deposits
  seaweed: number;           // pirate: seaweed strands in gaps
  grillGems: number;         // grillz: diamonds on the grill to buff (0 = no grill)
  showcase: boolean;         // the Golden Molar Gala finale: on stage, spotlight, crowd meter (DESIGN 11.3)
}

export interface CleanSetup {
  seed: number;
  patientId: string;
  patient: { name: string; archetype: ArchetypeId; portrait: string };  // portrait = image key (see data/assets.ts portraitUrl)
  caseType: CaseType;
  twists: TwistId[];
  bonus: BonusId | null;
  problemTeeth: number[];   // teeth carrying the case's dirt; every other present tooth is near-clean and unscored
  special: CaseSpecial;
  firstOfCase: boolean;     // the player has never had this case type: show the "New case" explainer
  service: ServiceId;
  missingTeeth: number[];   // tooth indices 0..27
  dirt: DirtProfile;
  traits: PatientTraits;
  tools: ToolLoadout;
  mods: CleanModifiers;
  tutorial: boolean;        // guided steps (school phase)
  parSeconds: number;
  lines: string[];          // chatty / flavour lines the patient can say
}

export interface CleanResult {
  quit: 'done' | 'walkout' | 'abort';   // abort = player backed out (no pay, patient reschedules)
  tartar: number; plaque: number; stain: number; debris: number; polish: number; mess: number;  // 0..1
  clean: number;       // 0..1
  comfort: number;     // 0..100 final
  quality: number;     // 0..1
  stars: number;       // 1..5
  seconds: number;     // real seconds spent
  chunks: number;      // tartar deposits popped
  bestCombo: number;
  gumHits: number;
  gags: number;
  perfect: boolean;    // every objective done and the bonus met
  caseType: CaseType;
  objectives: CleanObjective[];
  bonusMet: boolean;
  treasure: boolean;   // pirate doubloon found
  shadeGain: number;   // whitening: shade steps gained (0 otherwise)
  before: string | null;  // small JPEG data URL of the Front view at the start (before/after slider)
  after: string | null;
}

export interface CleanObjective { id: string; label: string; progress: number; done: boolean }

// ------------------------------------------------------------------ clinic

export type PatientState =
  | 'scheduled' | 'entering' | 'checkin' | 'waiting' | 'toChair' | 'inChair'
  | 'toDesk' | 'checkout' | 'exiting' | 'walkout' | 'gone' | 'noshow';

export interface DayPatient {
  id: string;
  name: string;
  archetype: ArchetypeId;
  portrait: string;
  service: ServiceId;
  addons: AddonId[];          // accepted add-ons (decided at check-in by the sim)
  apptMin: number;            // appointment time (game minutes from midnight)
  walkIn: boolean;
  state: PatientState;
  since: number;              // minute the current state began (view interpolates movement)
  until: number | null;       // minute the current state ends, when known (walks, cleaning)
  seat: number | null;        // waiting seat index while waiting
  opId: string | null;        // operatory while toChair / inChair
  staffId: string | null;     // who is cleaning ('player' for you)
  awaitingPlayer: boolean;    // in your chair, waiting for you to start
  arrivedMin: number | null;
  waitedMin: number;
  patience: number;           // minutes
  dirtLevel: number;          // 0..1 how dirty (drives the icon and NPC difficulty)
  quality: number | null;
  comfort: number | null;     // 0..1
  stars: number | null;       // review stars if reviewed
  fee: number;                // total billed
  tip: number;
  isPlayerPatient: boolean;   // employee phase: patient for your chair
  caseType: CaseType;
  twists: TwistId[];
  bonus: BonusId | null;      // decided at booking so the chair card can show it
  vip: boolean;               // event or Smile Studio VIP: big fee, review weight 5
  mood: 'happy' | 'ok' | 'grumpy' | 'angry';
}

export interface Operatory {
  id: string;
  slot: number;               // index into the office layout's op slots
  chair: ChairTier;
  upgrades: OpUpgradeId[];
  staffId: string | null;     // hygienist assigned; 'player' = your chair
  assistantId: string | null;
  patientId: string | null;
  playerMode: 'hands' | 'auto';  // only used when staffId === 'player'
}

export interface Staff {
  id: string;
  name: string;
  role: StaffRole;
  portrait: string;           // staff portrait key
  skill: number; speed: number; bedside: number;   // 0..100
  salary: number;             // per working day
  ask: number;                // what they think they are worth
  morale: number;             // 0..100
  traits: TraitId[];
  level: number;
  xp: number;                 // patients served toward next level
  hiredDay: number;
  offUntilDay: number;        // training / off (last day away)
  offFrom?: number;           // first day away on a course, when booked
  patientsToday: number;
  // live (not important for save but kept simple)
  task: 'idle' | 'cleaning' | 'checkin' | 'walking' | 'exam' | 'break' | 'off';
  targetOpId: string | null;  // dentist walking to / working at
  busyUntil: number | null;
  perks: PerkId[];            // specialties picked at level-ups (DESIGN 10.4)
  pendingPerks: PerkId[] | null;  // two offered perks awaiting the owner's pick
  tempUntilDay?: number;      // temporary staff (intern event) leave after this day
}

export interface Candidate extends Staff {
  expiresDay: number;
  interviewed: boolean;       // exact stats and traits hidden until interviewed; the UI shows ranges
  range: { skill: [number, number]; speed: [number, number]; bedside: [number, number] };
}

export interface Review {
  day: number;
  name: string;
  archetype: ArchetypeId;
  stars: number;
  weight: number;
  text: string;
}

export interface ClinicDayStats {
  booked: number;
  demand: number;
  turnedAway: number;
  noShows: number;
  walkIns: number;
  served: number;
  walkouts: number;
  revenue: number;
  tips: number;
  supplies: number;
  addonsSold: number;
  fiveStars: number;
  handsOn: number;
}

export interface Clinic {
  id: string;
  name: string;
  tier: OfficeTierId;
  ownedByPlayer: boolean;
  ops: Operatory[];
  equipment: EquipId[];
  staff: Staff[];
  prices: Record<PriceKey, number>;   // multipliers 0.7..1.5
  marketing: 0 | 1 | 2 | 3;
  rating: number;
  reviews: Review[];                  // last 40
  served: number;                     // lifetime
  patients: DayPatient[];             // today
  day: ClinicDayStats;
  checkinBusyUntil: number;           // front desk queue
  modifiers: ClinicModifier[];        // events, campaigns, focus (expired ones removed at day close)
  campaign: { id: CampaignId; untilDay: number } | null;
  campaignCooldownUntil: number;      // no new campaign before this day
  district: DistrictId;               // where this location serves (DESIGN 11.1)
}

// ------------------------------------------------------------------ economy and records

export interface LedgerEntry { day: number; minute: number; amount: number; label: string; kind: 'income' | 'expense' }

export interface DayLine { label: string; amount: number }
export interface DayReport {
  day: number;
  weekday: number;             // 0..4 Mon..Fri
  phase: Phase;
  perLocation: { clinicId: string; name: string; stats: ClinicDayStats; rating: number; ratingDelta: number; waitlist?: number }[];   // waitlist: patients booked first tomorrow
  income: DayLine[];
  expenses: DayLine[];
  net: number;                 // total cash change of the day, including purchases and loans
  operatingNet?: number;       // clinic income minus running costs only (use this for profit displays)
  cashAfter: number;
  xpGained: number;
  levelUps: number;
  goalsDone: string[];
  notes: string[];             // events worth reading (quit, raise request, milestones)
  events?: SimEvent[];         // events raised while closing the day (achievements, level-ups); the UI emits them after the report
}

export interface Goal {
  id: string;
  kind: 'chunks' | 'fiveStars' | 'served' | 'fastClean' | 'addons' | 'perfect' | 'combo'
    | 'campaign' | 'noWalkouts' | 'net' | 'events' | 'rating';   // owner goals (DESIGN 10.7)
  target: number;
  progress: number;
  rewardCash: number;
  rewardXp: number;
  done: boolean;
  claimed: boolean;
  text: string;
}

export interface LifetimeStats {
  cleanings: number;           // hands-on
  quickCleans: number;
  chunks: number;
  perfect: number;
  fiveStars: number;
  bestCombo: number;
  fastestClean: number;        // seconds
  earned: number;
  patientsServed: number;      // all staff, all locations
  hires: number;
  daysPlayed: number;
  fiveStarStreak: number;
}

export interface PlayerState {
  name: string;
  avatar: number;              // 0..3
  level: number;
  xp: number;
  skillPoints: number;
  skills: SkillId[];
  tools: Record<ToolSlot, number>;   // owned max tier per slot (you always use the best owned)
  extras: ExtraId[];
  numbingGel: number;          // consumable count
  mastery: Partial<Record<CaseType, number>>;   // hands-on cleans of 3+ stars per case type (DESIGN 5.9)
  useGel: boolean;
  title: string;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;                 // rng state for resuming deterministic sim
  createdAt: number;           // ms epoch
  lastSeen: number;            // ms epoch (offline progress)
  phase: Phase;
  player: PlayerState;
  cash: number;
  loan: number;                // principal
  day: number;                 // 1-based working day counter
  minute: number;              // clock, game minutes from midnight (480 = 8:00)
  dayOver: boolean;            // clinics closed, waiting for the report to be dismissed
  speed: Speed;
  employer: Clinic | null;     // Bright Smiles Dental (employee phase)
  locations: Clinic[];         // owned clinics (owner phase)
  active: number;              // index into locations; -1 = employer view
  candidates: Candidate[];
  ledger: LedgerEntry[];       // last 200
  reports: DayReport[];        // last 30
  goals: Goal[];
  goalsDay: number;
  achievements: string[];
  stats: LifetimeStats;
  flags: Record<string, boolean>;   // tutorial and one-shot flags
  nextId: number;
  // manager layer (v3, owner phase)
  focus: FocusId[];            // today's daily focus (2 slots with Huddle Pro)
  huddleDay: number;           // day the morning huddle was last completed
  pendingEvents: PendingEvent[];   // event cards awaiting a decision this morning (at most one per location)
  eventLog: { day: number; eventId: string; clinicId: string; choice: number; text: string }[];   // last 30
  // end game (DESIGN 11)
  difficulty: Difficulty;
  city: DistrictState[];
  timeline: TimelineEntry[];   // career milestones for the Legacy screen (keep all; they are small)
  finale: FinaleState;
  legacyPerks: LegacyPerkId[]; // New Game+ perks active in this run
  distress: number;            // consecutive day closes with cash below zero (bankruptcy pressure, DESIGN 11.5)
  settings: {
    autoHuddle: boolean;   // skip the huddle and keep yesterday's focus (events auto-resolve with the first choice)
    autoRaise?: boolean;   // approve raise requests up to +15% automatically at day close
    autoPause?: boolean;   // pause the game on key events (default on; undefined = on)
  };
}

// ------------------------------------------------------------------ sim events (UI toasts, audio, clinic view)

export type SimEvent =
  | { type: 'arrive'; clinicId: string; patientId: string }
  | { type: 'seated'; clinicId: string; patientId: string; opId: string }
  | { type: 'awaitingPlayer'; clinicId: string; patientId: string; opId: string }
  | { type: 'cleaned'; clinicId: string; patientId: string; staffId: string; quality: number }
  | { type: 'paid'; clinicId: string; patientId: string; amount: number }
  | { type: 'review'; clinicId: string; stars: number; text: string; name: string; patientId?: string }
  | { type: 'walkout'; clinicId: string; patientId: string; reason: 'wait' | 'comfort' }
  | { type: 'staffQuit'; clinicId: string; staffId: string; name: string }
  | { type: 'raiseRequest'; clinicId: string; staffId: string; name: string; ask: number }
  | { type: 'levelUp'; level: number }
  | { type: 'goalDone'; goalId: string; text: string }
  | { type: 'achievement'; id: string; name: string }
  | { type: 'dayOver' }
  | { type: 'toast'; text: string; kind: 'info' | 'good' | 'bad' };

/** Result of a sim action the UI can show: ok or a reason in product voice. */
export type ActionResult = { ok: true; message?: string } | { ok: false; reason: string };

export interface HandsOnPayout {
  pay: number;          // wage part (employee) or fees (owner)
  tip: number;
  bonus: number;        // shift / streak bonuses triggered by this clean
  xp: number;
  stars: number;
  quality: number;
  levelUps: number;
  addons: AddonId[];    // add-ons billed after the clean (owner)
  lines: string[];      // result screen flavour ("Dr. Canal is impressed")
  treasure: number;     // pirate doubloon bonus paid
  mastery: { caseType: CaseType; count: number; tier: 0 | 1 | 2 | 3; tierUp: boolean } | null;
}

export interface OfflineReport { hours: number; credit: number }
