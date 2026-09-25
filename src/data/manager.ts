// Manager layer catalog (DESIGN 10): daily focus, campaigns, staff perks and the event deck.
// The sim may retune numbers and texts (never ids). Cash amounts marked `scaled` are multiplied by the
// clinic's OFFICES[tier].tierScale.
import type { ArchetypeId, CampaignId, CaseType, FocusId, OfficeTierId, PerkId, StaffRole, EquipId } from '../core/types';

// ------------------------------------------------------------------ daily focus (10.1)
export interface FocusDef {
  id: FocusId; name: string; text: string; minTier: OfficeTierId;
  speed?: number; quality?: number; walkins?: number; fees?: number; addons?: number;
  moraleAtClose?: number; staffXp?: number;
}
export const FOCUSES: Record<FocusId, FocusDef> = {
  steady: { id: 'steady', name: 'Steady', text: 'No change. A normal day.', minTier: 't1' },
  speed: { id: 'speed', name: 'Speed Day', text: 'Staff 15% faster, quality -4%.', minTier: 't1', speed: 1.15, quality: -0.04 },
  quality: { id: 'quality', name: 'Quality Day', text: 'Quality +5%, staff 10% slower.', minTier: 't1', speed: 0.9, quality: 0.05 },
  walkin: { id: 'walkin', name: 'Walk-in Day', text: 'Three times the walk-ins, fees -10%.', minTier: 't1', walkins: 3, fees: 0.9 },
  upsell: { id: 'upsell', name: 'Upsell Day', text: 'Add-ons accepted 25% more often.', minTier: 't2', addons: 1.25 },
  team: { id: 'team', name: 'Team Day', text: 'Morale +4 for everyone tonight, staff 5% slower.', minTier: 't1', speed: 0.95, moraleAtClose: 4 },
  training: { id: 'training', name: 'Training Day', text: 'Staff level up twice as fast, 10% slower.', minTier: 't2', speed: 0.9, staffXp: 2 },
};
export const FOCUS_ORDER: FocusId[] = ['steady', 'speed', 'quality', 'walkin', 'upsell', 'team', 'training'];

// ------------------------------------------------------------------ campaigns (10.3)
export interface CampaignDef {
  id: CampaignId; name: string; blurb: string; cost: number; days: number; cooldown: number;
  demand: number; caseBoost: Partial<Record<CaseType, number>>; awareness?: number;
  requires: 'whiteningLamp' | 'deepCert' | null; minTier: OfficeTierId;
}
export const CAMPAIGNS: Record<CampaignId, CampaignDef> = {
  kidsWeek: { id: 'kidsWeek', name: 'Kids Week', blurb: 'Balloons, stickers and sugar bugs.', cost: 600, days: 5, cooldown: 3, demand: 1.15, caseBoost: { candy: 3 }, requires: null, minTier: 't1' },
  smileMakeover: { id: 'smileMakeover', name: 'Smile Makeover', blurb: 'Whitening specials all week.', cost: 1200, days: 5, cooldown: 4, demand: 1.1, caseBoost: { whitening: 3 }, requires: 'whiteningLamp', minTier: 't1' },
  goldenYears: { id: 'goldenYears', name: 'Golden Years', blurb: 'Senior discount mornings.', cost: 800, days: 5, cooldown: 3, demand: 1.1, caseBoost: { deep: 3 }, requires: 'deepCert', minTier: 't1' },
  bracesBonanza: { id: 'bracesBonanza', name: 'Braces Bonanza', blurb: 'Free wax with every braces check.', cost: 700, days: 5, cooldown: 3, demand: 1.1, caseBoost: { braces: 3 }, requires: null, minTier: 't2' },
  pirateDay: { id: 'pirateDay', name: 'Talk Like a Pirate Week', blurb: 'Eyepatches at the front desk. Pirates hear about it.', cost: 1000, days: 4, cooldown: 5, demand: 1.1, caseBoost: { pirate: 6 }, requires: null, minTier: 't2' },
  grandOpening: { id: 'grandOpening', name: 'Grand Opening', blurb: 'Ribbon, balloons, free toothbrushes.', cost: 1200, days: 5, cooldown: 30, demand: 1.5, caseBoost: {}, awareness: 0.15, requires: null, minTier: 't1' },
};
export const CAMPAIGN_ORDER: CampaignId[] = ['grandOpening', 'kidsWeek', 'smileMakeover', 'goldenYears', 'bracesBonanza', 'pirateDay'];

// ------------------------------------------------------------------ staff perks (10.4)
export interface PerkDef {
  id: PerkId; name: string; text: string; roles: StaffRole[];
  caseType?: CaseType;           // specialists are routed their case type first
  caseQuality?: number; caseSpeed?: number;   // on their case type
  speed?: number; comfort?: number; quality?: number; tipMult?: number;
  mentorXp?: number; overworkBonus?: number; addons?: number;
}
export const PERKS: Record<PerkId, PerkDef> = {
  whiteningPro: { id: 'whiteningPro', name: 'Whitening Pro', text: 'Whitening cases: quality +8%, 20% faster.', roles: ['hygienist'], caseType: 'whitening', caseQuality: 0.08, caseSpeed: 1.2 },
  kidMagnet: { id: 'kidMagnet', name: 'Kid Magnet', text: 'Sugar bug cases: quality +8%, 10% faster.', roles: ['hygienist'], caseType: 'candy', caseQuality: 0.08, caseSpeed: 1.1 },
  bracesWhiz: { id: 'bracesWhiz', name: 'Braces Whiz', text: 'Braces cases: quality +8%, 20% faster.', roles: ['hygienist'], caseType: 'braces', caseQuality: 0.08, caseSpeed: 1.2 },
  deepDiver: { id: 'deepDiver', name: 'Deep Diver', text: 'Deep cleanings: quality +8%, 15% faster.', roles: ['hygienist'], caseType: 'deep', caseQuality: 0.08, caseSpeed: 1.15 },
  pirateWhisperer: { id: 'pirateWhisperer', name: 'Pirate Whisperer', text: 'Pirates leave big tips. Arr.', roles: ['hygienist'], caseType: 'pirate', caseQuality: 0.05, tipMult: 2 },
  speedDemon: { id: 'speedDemon', name: 'Speed Demon', text: '10% faster on everything.', roles: ['hygienist', 'receptionist', 'assistant', 'dentist'], speed: 1.1 },
  gentleHands: { id: 'gentleHands', name: 'Gentle Hands', text: 'Patients 10% more comfortable.', roles: ['hygienist', 'dentist'], comfort: 0.1 },
  mentor: { id: 'mentor', name: 'Mentor', text: 'Teammates at this office gain XP 50% faster.', roles: ['hygienist', 'dentist', 'manager'], mentorXp: 1.5 },
  ironLungs: { id: 'ironLungs', name: 'Iron Lungs', text: 'Two more patients a day before feeling overworked.', roles: ['hygienist', 'receptionist', 'assistant', 'dentist'], overworkBonus: 2 },
  upsellStar: { id: 'upsellStar', name: 'Upsell Star', text: 'Their patients accept add-ons 10% more often.', roles: ['hygienist', 'receptionist', 'dentist'], addons: 1.1 },
};
/** Staff levels that offer a perk choice. */
export const PERK_LEVELS = [2, 4, 6, 8];

// ------------------------------------------------------------------ events (10.2)
export type EventEffect =
  | { kind: 'cash'; amount: number; scaled?: boolean }
  | { kind: 'rating'; delta: number }                    // added to the clinic rating (clamped 1..5)
  | { kind: 'awareness'; delta: number }                 // added to the served-based awareness
  | { kind: 'modifier'; days: number | null; label: string; demand?: number; fees?: number; supplies?: number; speed?: number; comfort?: number; quality?: number; addons?: number; walkins?: number; noShows?: number; caseBoost?: Partial<Record<CaseType, number>> }
  | { kind: 'morale'; delta: number; who: 'all' | 'staff' }   // 'staff' = the event's {staffId}
  | { kind: 'skill'; delta: number; who: 'staff' | 'bestHygienist' }
  | { kind: 'salary'; pct: number; who: 'staff' }
  | { kind: 'quitChance'; p: number; who: 'staff' }
  | { kind: 'vip'; fee: number; reviewWeight: number; archetype?: ArchetypeId; caseType?: CaseType }   // a VIP patient added to today's schedule
  | { kind: 'closeOp'; days: number }                    // the event's {opId} takes no patients
  | { kind: 'openLate'; minutes: number }
  | { kind: 'tempStaff'; role: StaffRole; days: number; skill: number }
  | { kind: 'discountEquip'; pct: number }               // unlocks buying {equipId} at pct off today
  | { kind: 'freeEquip' }                                // grants {equipId}
  | { kind: 'xp'; amount: number }
  | { kind: 'chance'; p: number; win: EventEffect[]; lose: EventEffect[]; winText: string; loseText: string };

export interface EventChoice { label: string; hint: string; effects: EventEffect[] }
export interface EventDef {
  id: string;
  title: string;
  text: string;              // may use {staff}, {clinic}, {op}, {equip}
  art: string;               // icon key for the card (UI icon set) and optional diorama prop key
  minTier: OfficeTierId;
  weight: number;
  needs?: 'hygienist' | 'staff' | 'twoLocations' | 'unownedEquip' | 'twoOps' | 'dentist';
  choices: EventChoice[];    // 2 or 3; choice 0 is the auto-resolve default
}

export const EVENTS: EventDef[] = [
  { id: 'inspector', title: 'Health Inspector', text: 'An inspector is visiting {clinic} today.', art: 'clipboard', minTier: 't1', weight: 10, choices: [
    { label: 'Deep clean the office', hint: '-$300, rating +0.1', effects: [{ kind: 'cash', amount: -300, scaled: true }, { kind: 'rating', delta: 0.1 }] },
    { label: 'Wing it', hint: '70% nothing, 30% a fine', effects: [{ kind: 'chance', p: 0.7, win: [], lose: [{ kind: 'cash', amount: -800, scaled: true }, { kind: 'rating', delta: -0.2 }], winText: 'The inspector found nothing.', loseText: 'Fined for a dusty sterilizer.' }] },
  ] },
  { id: 'celebrity', title: 'Celebrity Walk-in', text: 'A platinum rap star wants a cleaning at {clinic} today.', art: 'star', minTier: 't2', weight: 6, choices: [
    { label: 'Squeeze them in', hint: 'VIP patient, big fee, their review counts 5x', effects: [{ kind: 'vip', fee: 900, reviewWeight: 5, archetype: 'rapper', caseType: 'grillz' }] },
    { label: 'Politely decline', hint: 'Nothing happens', effects: [] },
  ] },
  { id: 'supplier', title: 'Supplier Sale', text: 'Gloves and prophy paste are half price this week.', art: 'box', minTier: 't1', weight: 8, choices: [
    { label: 'Stock up', hint: '-$400, supplies -40% for 5 days', effects: [{ kind: 'cash', amount: -400, scaled: true }, { kind: 'modifier', days: 5, label: 'Supplier sale', supplies: 0.6 }] },
    { label: 'Pass', hint: 'Nothing happens', effects: [] },
  ] },
  { id: 'birthday', title: 'Staff Birthday', text: "It is {staff}'s birthday.", art: 'cake', minTier: 't1', weight: 8, needs: 'staff', choices: [
    { label: 'Throw a party', hint: '-$150, morale +8 for everyone', effects: [{ kind: 'cash', amount: -150 }, { kind: 'morale', delta: 8, who: 'all' }] },
    { label: 'Card and cupcake', hint: 'Morale +4 for {staff}', effects: [{ kind: 'morale', delta: 4, who: 'staff' }] },
  ] },
  { id: 'flu', title: 'Flu Season', text: 'Half the town has a cold. Appointments are cancelling.', art: 'thermo', minTier: 't1', weight: 6, choices: [
    { label: 'Masks and tissues at the door', hint: '-$120, demand -10% for 3 days', effects: [{ kind: 'cash', amount: -120, scaled: true }, { kind: 'modifier', days: 3, label: 'Flu season', demand: 0.9, noShows: 1.3 }] },
    { label: 'Business as usual', hint: 'Demand -25% for 3 days', effects: [{ kind: 'modifier', days: 3, label: 'Flu season', demand: 0.75, noShows: 1.8 }] },
  ] },
  { id: 'news', title: 'Local News', text: 'Channel 6 wants a segment about {clinic}.', art: 'camera', minTier: 't1', weight: 6, choices: [
    { label: 'Do the interview', hint: 'Demand +20% for 3 days', effects: [{ kind: 'awareness', delta: 0.08 }, { kind: 'modifier', days: 3, label: 'On the news', demand: 1.2 }] },
    { label: 'Send {staff}', hint: '50% great, 50% awkward', effects: [{ kind: 'chance', p: 0.5, win: [{ kind: 'modifier', days: 3, label: 'On the news', demand: 1.25 }, { kind: 'morale', delta: 6, who: 'staff' }], lose: [{ kind: 'rating', delta: -0.05 }], winText: '{staff} was a natural.', loseText: '{staff} froze on camera.' }] },
  ], needs: 'staff' },
  { id: 'school', title: 'School Dental Day', text: 'Maple Elementary wants checkups for a whole class.', art: 'bus', minTier: 't1', weight: 6, choices: [
    { label: 'Book the class', hint: '+$500, sugar bug cases x4 today', effects: [{ kind: 'cash', amount: 500, scaled: true }, { kind: 'modifier', days: 1, label: 'School day', walkins: 3, caseBoost: { candy: 4 } }] },
    { label: 'Not today', hint: 'Nothing happens', effects: [] },
  ] },
  { id: 'pirateFestival', title: 'Pirate Festival', text: 'The Pirate Festival docked in town.', art: 'flag', minTier: 't1', weight: 4, choices: [
    { label: 'Hang a Jolly Roger', hint: '-$100, pirates x5 for 2 days', effects: [{ kind: 'cash', amount: -100 }, { kind: 'modifier', days: 2, label: 'Pirate Festival', caseBoost: { pirate: 5 } }] },
    { label: 'Ignore it', hint: 'Nothing happens', effects: [] },
  ] },
  { id: 'pipe', title: 'Burst Pipe', text: 'A pipe burst in {op}.', art: 'drop', minTier: 't1', weight: 5, needs: 'twoOps', choices: [
    { label: 'Emergency plumber', hint: '-$600, fixed today', effects: [{ kind: 'cash', amount: -600, scaled: true }] },
    { label: 'Wait for the landlord', hint: '{op} closed for 2 days', effects: [{ kind: 'closeOp', days: 2 }] },
  ] },
  { id: 'expo', title: 'Dental Expo', text: 'The regional Dental Expo is this weekend.', art: 'medal', minTier: 't1', weight: 5, needs: 'hygienist', choices: [
    { label: 'Send your best hygienist', hint: '-$800, their skill +10', effects: [{ kind: 'cash', amount: -800 }, { kind: 'skill', delta: 10, who: 'bestHygienist' }] },
    { label: 'Skip it', hint: 'Nothing happens', effects: [] },
  ] },
  { id: 'rival', title: 'Rival Opens', text: 'SmileCo opened a clinic across the street from {clinic}.', art: 'shop', minTier: 't2', weight: 5, choices: [
    { label: 'Out-market them', hint: '-$1,000, demand +15% for 5 days', effects: [{ kind: 'cash', amount: -1000, scaled: true }, { kind: 'modifier', days: 5, label: 'Beating SmileCo', demand: 1.15 }] },
    { label: 'Match their prices', hint: 'Fees -10% for 5 days', effects: [{ kind: 'modifier', days: 5, label: 'Price match', fees: 0.9 }] },
    { label: 'Ignore them', hint: 'Demand -15% for 5 days', effects: [{ kind: 'modifier', days: 5, label: 'SmileCo nearby', demand: 0.85 }] },
  ] },
  { id: 'puppy', title: 'Puppy in the Lobby', text: 'A very good puppy wandered into the waiting room.', art: 'paw', minTier: 't1', weight: 4, choices: [
    { label: 'Office mascot', hint: 'Morale +5, comfort +5% for good', effects: [{ kind: 'morale', delta: 5, who: 'all' }, { kind: 'modifier', days: null, label: 'Office puppy', comfort: 1.05 }] },
    { label: 'Find the owner', hint: 'Local hero: rating +0.05', effects: [{ kind: 'rating', delta: 0.05 }, { kind: 'awareness', delta: 0.03 }] },
  ] },
  { id: 'viral', title: 'Viral Smile', text: "A patient's before and after photo went viral.", art: 'heart', minTier: 't1', weight: 4, choices: [
    { label: 'Repost it', hint: 'Demand +40% for 2 days', effects: [{ kind: 'modifier', days: 2, label: 'Viral smile', demand: 1.4 }] },
    { label: 'Stay humble', hint: 'Rating +0.05', effects: [{ kind: 'rating', delta: 0.05 }] },
  ] },
  { id: 'poach', title: 'Poaching Attempt', text: 'SmileCo offered {staff} a job.', art: 'door', minTier: 't2', weight: 4, needs: 'staff', choices: [
    { label: 'Counter-offer', hint: "{staff}'s salary +15%, morale +10", effects: [{ kind: 'salary', pct: 15, who: 'staff' }, { kind: 'morale', delta: 10, who: 'staff' }] },
    { label: 'Let them choose', hint: '50% they leave', effects: [{ kind: 'quitChance', p: 0.5, who: 'staff' }] },
  ] },
  { id: 'salesman', title: 'Equipment Salesman', text: 'A salesman offers a demo {equip} at 40% off.', art: 'tag', minTier: 't1', weight: 5, needs: 'unownedEquip', choices: [
    { label: 'Take a look', hint: '{equip} 40% off today in the Office', effects: [{ kind: 'discountEquip', pct: 40 }] },
    { label: 'No thanks', hint: 'Nothing happens', effects: [] },
  ] },
  { id: 'charity', title: 'Shelter Cleaning Day', text: 'The shelter asks for free cleanings.', art: 'heart', minTier: 't1', weight: 4, choices: [
    { label: 'Host it', hint: '-$400, rating +0.15, more awareness', effects: [{ kind: 'cash', amount: -400, scaled: true }, { kind: 'rating', delta: 0.15 }, { kind: 'awareness', delta: 0.05 }] },
    { label: 'Donate', hint: '-$100, rating +0.03', effects: [{ kind: 'cash', amount: -100, scaled: true }, { kind: 'rating', delta: 0.03 }] },
  ] },
  { id: 'outage', title: 'Power Outage', text: 'The block lost power this morning.', art: 'bolt', minTier: 't1', weight: 4, choices: [
    { label: 'Rent a generator', hint: '-$250, open on time', effects: [{ kind: 'cash', amount: -250, scaled: true }] },
    { label: 'Open late', hint: 'Doors open 2 hours late', effects: [{ kind: 'openLate', minutes: 120 }] },
  ] },
  { id: 'intern', title: 'Dental Student', text: 'A dental school student wants a week of experience.', art: 'grad', minTier: 't1', weight: 4, choices: [
    { label: 'Take them on', hint: 'A free assistant for 5 days', effects: [{ kind: 'tempStaff', role: 'assistant', days: 5, skill: 45 }] },
    { label: 'Too busy', hint: 'Nothing happens', effects: [] },
  ] },
  { id: 'insurance', title: 'Insurance Network', text: 'BlueTooth Insurance wants {clinic} in-network.', art: 'shield', minTier: 't2', weight: 3, choices: [
    { label: 'Join the network', hint: 'Demand +25%, fees -10%, for good', effects: [{ kind: 'modifier', days: null, label: 'BlueTooth network', demand: 1.25, fees: 0.9 }] },
    { label: 'Stay independent', hint: 'Nothing happens', effects: [] },
  ] },
  { id: 'toothFairy', title: 'Tooth Fairy Day', text: 'The kids want to meet the Tooth Fairy.', art: 'wand', minTier: 't1', weight: 4, choices: [
    { label: 'Rent the costume', hint: '-$200, sugar bug cases x2 for 2 days, rating +0.05', effects: [{ kind: 'cash', amount: -200 }, { kind: 'rating', delta: 0.05 }, { kind: 'modifier', days: 2, label: 'Tooth Fairy visit', caseBoost: { candy: 2 }, demand: 1.1 }] },
    { label: 'Maybe next year', hint: 'Nothing happens', effects: [] },
  ] },
  { id: 'heatwave', title: 'Heatwave', text: 'It is 105 degrees outside.', art: 'sun', minTier: 't1', weight: 4, choices: [
    { label: 'Crank the AC', hint: '-$150', effects: [{ kind: 'cash', amount: -150, scaled: true }] },
    { label: 'Tough it out', hint: 'Morale -5, comfort -10% today', effects: [{ kind: 'morale', delta: -5, who: 'all' }, { kind: 'modifier', days: 1, label: 'Heatwave', comfort: 0.9 }] },
  ] },
  { id: 'mystery', title: 'Mystery Shopper', text: 'A mystery shopper from Smile Magazine visits today.', art: 'glasses', minTier: 't2', weight: 4, choices: [
    { label: 'Roll out the red carpet', hint: '-$200, 80% rating +0.2', effects: [{ kind: 'cash', amount: -200, scaled: true }, { kind: 'chance', p: 0.8, win: [{ kind: 'rating', delta: 0.2 }], lose: [], winText: 'Smile Magazine loved it.', loseText: 'They were not impressed.' }] },
    { label: 'Act natural', hint: '50% rating +0.1, 50% -0.1', effects: [{ kind: 'chance', p: 0.5, win: [{ kind: 'rating', delta: 0.1 }], lose: [{ kind: 'rating', delta: -0.1 }], winText: 'A glowing write-up.', loseText: 'A lukewarm write-up.' }] },
  ] },
  { id: 'conference', title: 'Keynote Invite', text: 'The Dental Business Summit wants you as a speaker.', art: 'mic', minTier: 't3', weight: 3, choices: [
    { label: 'Give the talk', hint: 'XP +150, awareness up at every location', effects: [{ kind: 'xp', amount: 150 }, { kind: 'awareness', delta: 0.05 }] },
    { label: 'Decline', hint: 'Nothing happens', effects: [] },
  ] },
  { id: 'investor', title: 'Angel Investor', text: 'An investor wants a slice of your chain.', art: 'coins', minTier: 't3', weight: 2, needs: 'twoLocations', choices: [
    { label: 'Take the check', hint: '+$25,000, fees -5% for good', effects: [{ kind: 'cash', amount: 25000 }, { kind: 'modifier', days: null, label: 'Investor share', fees: 0.95 }] },
    { label: 'Keep it all', hint: 'Nothing happens', effects: [] },
  ] },
];

/** Chance that a location draws an event on a given owner morning. */
export const EVENT_CHANCE: Record<OfficeTierId, number> = { t1: 0.45, t2: 0.55, t3: 0.6, t4: 0.65 };
/** Equipment the salesman event can offer. */
export type SalesmanPick = EquipId;
