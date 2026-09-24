// Game-wide constants. Orchestrator-owned. Formulas in docs/DESIGN.md.

export const OPEN_MIN = 480;            // 8:00
export const CLOSE_MIN = 1020;          // 17:00 (no new check-ins after this; day ends when everyone left)
export const LAST_APPT_MIN = 960;       // 16:00
export const REAL_SEC_PER_GAME_MIN = 0.2;  // at 1x: a 540-minute day = 108 s

export const WALK_MIN = 1.5;
export const CHECKOUT_MIN = 2;
export const CHECKIN_MIN_STAFFED = 3;
export const CHECKIN_MIN_UNSTAFFED = 7;

export const HANDS_ON_MINUTES: Record<'cleaning' | 'deep', number> = { cleaning: 45, deep: 75 };
export const QUICK_CLEAN_MINUTES = 60;

export const PLAYER_ID = 'player';
export const EMPLOYER_NAME = 'Bright Smiles Dental';
export const EMPLOYER_BOSS = 'Dr. Ruth Canal';

export const MAX_LOCATIONS = 5;
export const LOAN_MAX_SHARE = 0.6;
export const LOAN_DAILY_RATE = 0.0025;
export const LOAN_DAILY_PAYMENT = 0.01;
export const EXTRA_OP_PRICE = 4000;
export const TRAINING_COST = 1500;
export const FLOSS_BOSS_VALUATION = 5_000_000;

// Dirt grid (see DESIGN 5.2)
export const DIRT_GU = 32;
export const DIRT_GV = 24;
export const REACH_U_MIN = 0.18;
export const REACH_U_MAX = 0.82;
export const OCCLUSAL_V = 0.86;
export const TARTAR_HP = 1.0;

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

export const SAVE_KEY_PREFIX = 'fb';
