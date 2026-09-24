// Operatory upgrades, chairs and office equipment. DESIGN 8.7.
import type { ChairTier, EquipId, OfficeTierId, OpUpgradeId } from '../core/types';

export interface ChairDef { id: ChairTier; name: string; price: number; quality: number; comfort: number; model: string; blurb: string }
export const CHAIRS: Record<ChairTier, ChairDef> = {
  basic: { id: 'basic', name: 'Standard Chair', price: 0, quality: 0, comfort: 0, model: 'chair_basic', blurb: 'Vinyl, reliable, squeaks a bit.' },
  comfort: { id: 'comfort', name: 'Comfort Chair', price: 2500, quality: 0.02, comfort: 0.1, model: 'chair_comfort', blurb: 'Memory foam. Patients relax.' },
  deluxe: { id: 'deluxe', name: 'Deluxe Massage Chair', price: 9000, quality: 0.04, comfort: 0.2, model: 'chair_deluxe', blurb: 'Heated, massaging, slightly too fancy.' },
};
export const CHAIR_ORDER: ChairTier[] = ['basic', 'comfort', 'deluxe'];

export interface OpUpgradeDef { id: OpUpgradeId; name: string; price: number; blurb: string; model: string; minTier?: OfficeTierId }
export const OP_UPGRADES: Record<OpUpgradeId, OpUpgradeDef> = {
  tv: { id: 'tv', name: 'Ceiling TV', price: 1200, blurb: 'Comfort +8%. Patients wait 25% longer in the chair.', model: 'op_tv' },
  whiteningLamp: { id: 'whiteningLamp', name: 'Whitening Lamp', price: 6000, blurb: 'Sell whitening in this operatory.', model: 'whitening_lamp' },
  intraoralCam: { id: 'intraoralCam', name: 'Intraoral Camera', price: 3000, blurb: 'Quality +3%. Add-ons accepted 10% more.', model: 'intraoral_cam' },
  ergoStool: { id: 'ergoStool', name: 'Ergonomic Stool', price: 1500, blurb: 'The hygienist here works 5% faster and tires less.', model: 'ergo_stool' },
  nitrous: { id: 'nitrous', name: 'Laughing Gas', price: 4000, blurb: 'Comfort +15%. Nervous patients never walk out of this chair.', model: 'nitrous_tank', minTier: 't2' },
};

export interface EquipDef { id: EquipId; name: string; price: number; blurb: string; model: string; minTier: OfficeTierId }
export const EQUIPMENT: Record<EquipId, EquipDef> = {
  deepCert: { id: 'deepCert', name: 'Deep Cleaning Certification', price: 2000, blurb: 'Offer deep cleanings ($260) to patients who need them.', model: 'certificate', minTier: 't1' },
  espresso: { id: 'espresso', name: 'Espresso Machine', price: 1500, blurb: 'Waiting patients stay 25% longer.', model: 'espresso_machine', minTier: 't1' },
  kidsCorner: { id: 'kidsCorner', name: 'Kids Corner', price: 2000, blurb: 'Twice as many kids. Kids wait 30% longer.', model: 'kids_corner', minTier: 't1' },
  fishTank: { id: 'fishTank', name: 'Fish Tank', price: 2500, blurb: 'Rating +0.1. Everyone loves fish.', model: 'fish_tank', minTier: 't1' },
  sterilizer: { id: 'sterilizer', name: 'Sterilizer Pro', price: 3500, blurb: 'Quality +3% in every operatory.', model: 'sterilizer', minTier: 't1' },
  onlineBooking: { id: 'onlineBooking', name: 'Online Booking', price: 4000, blurb: 'Half the no-shows. Demand +10%.', model: 'kiosk', minTier: 't1' },
  ultrasonicKits: { id: 'ultrasonicKits', name: 'Ultrasonic Kits', price: 5000, blurb: 'Hygienists clean 10% faster.', model: 'ultrasonic_cart', minTier: 't1' },
  xray: { id: 'xray', name: 'X-Ray Suite', price: 8000, blurb: 'Sell X-rays ($90) as an add-on.', model: 'xray_unit', minTier: 't1' },
  breakRoom: { id: 'breakRoom', name: 'Break Room', price: 3000, blurb: 'Staff morale +3 per day.', model: 'break_table', minTier: 't2' },
  // v3 (DESIGN 10.5)
  waterFilter: { id: 'waterFilter', name: 'Water Filter', price: 1200, blurb: 'Supplies cost 10% less.', model: 'water_filter', minTier: 't1' },
  aromatherapy: { id: 'aromatherapy', name: 'Aromatherapy Diffuser', price: 1800, blurb: 'Comfort +5% in every operatory. Smells like mint.', model: 'aroma_diffuser', minTier: 't1' },
  loyaltyProgram: { id: 'loyaltyProgram', name: 'Loyalty Punch Cards', price: 2500, blurb: 'Demand +8%. Everyone loves a punch card.', model: 'loyalty_board', minTier: 't1' },
  staffLockers: { id: 'staffLockers', name: 'Staff Lockers', price: 2200, blurb: 'Staff morale +1 per day.', model: 'staff_lockers', minTier: 't1' },
  digitalXray: { id: 'digitalXray', name: 'Digital X-Ray', price: 6000, blurb: 'X-rays accepted 20% more and take half the time. Needs the X-Ray Suite.', model: 'digital_xray', minTier: 't2' },
  soundMasking: { id: 'soundMasking', name: 'Sound Masking', price: 4500, blurb: 'No drill noise in the lobby. Waiting patients stay 20% longer.', model: 'sound_panel', minTier: 't2' },
  patientApp: { id: 'patientApp', name: 'Patient App', price: 7000, blurb: 'No-shows -30%. Demand +5%.', model: 'patient_tablet', minTier: 't2' },
  nitrousSystem: { id: 'nitrousSystem', name: 'Central Nitrous Line', price: 9000, blurb: 'Laughing gas in every operatory: comfort +10% everywhere.', model: 'nitrous_tank', minTier: 't2' },
  laserWhitening: { id: 'laserWhitening', name: 'Laser Whitening System', price: 14000, blurb: 'Whitening fees +25%, whitening quality +5%.', model: 'laser_whitening', minTier: 't3' },
  spaLounge: { id: 'spaLounge', name: 'Spa Lounge', price: 18000, blurb: 'Waiting patients stay 50% longer. Rating +0.15.', model: 'spa_lounge', minTier: 't3' },
  cadcam: { id: 'cadcam', name: 'CAD/CAM Crown Mill', price: 22000, blurb: 'Fillings pay 50% more and take a third less time.', model: 'cadcam_mill', minTier: 't3' },
  rooftopGarden: { id: 'rooftopGarden', name: 'Rooftop Garden', price: 12000, blurb: 'Staff morale +3 per day. Nobody quits over one bad week.', model: 'rooftop_planter', minTier: 't3' },
  smileStudio: { id: 'smileStudio', name: 'Smile Studio', price: 40000, blurb: 'One VIP makeover patient a day: huge fee, review counts 5x.', model: 'smile_studio', minTier: 't4' },
  researchWing: { id: 'researchWing', name: 'Research Wing', price: 35000, blurb: 'Staff at every location level up 50% faster. Training costs half.', model: 'research_desk', minTier: 't4' },
  helipad: { id: 'helipad', name: 'Helipad', price: 60000, blurb: 'Demand +15% at every location. Also a helipad.', model: 'helipad_sign', minTier: 't4' },
  aiScheduler: { id: 'aiScheduler', name: 'AI Scheduler', price: 30000, blurb: 'Capacity +10% here: the schedule fills every gap.', model: 'ai_screen', minTier: 't4' },
};
export const EQUIP_ORDER: EquipId[] = [
  'deepCert', 'espresso', 'waterFilter', 'aromatherapy', 'kidsCorner', 'staffLockers', 'fishTank', 'loyaltyProgram', 'sterilizer', 'onlineBooking', 'ultrasonicKits', 'xray',
  'breakRoom', 'soundMasking', 'digitalXray', 'patientApp', 'nitrousSystem',
  'rooftopGarden', 'laserWhitening', 'spaLounge', 'cadcam',
  'aiScheduler', 'researchWing', 'smileStudio', 'helipad',
];
