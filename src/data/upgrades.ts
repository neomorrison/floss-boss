// Operatory upgrades, chairs and office equipment. DESIGN 8.7.
import type { ChairTier, EquipId, OfficeTierId, OpUpgradeId } from '../core/types';

export interface ChairDef { id: ChairTier; name: string; price: number; quality: number; comfort: number; model: string; blurb: string }
export const CHAIRS: Record<ChairTier, ChairDef> = {
  basic: { id: 'basic', name: 'Standard Chair', price: 0, quality: 0, comfort: 0, model: 'chair_basic', blurb: 'Vinyl, reliable, squeaks a bit.' },
  comfort: { id: 'comfort', name: 'Comfort Chair', price: 2500, quality: 0.02, comfort: 0.1, model: 'chair_comfort', blurb: 'Memory foam. Patients relax.' },
  deluxe: { id: 'deluxe', name: 'Deluxe Massage Chair', price: 9000, quality: 0.04, comfort: 0.2, model: 'chair_deluxe', blurb: 'Heated, massaging, slightly too fancy.' },
};
export const CHAIR_ORDER: ChairTier[] = ['basic', 'comfort', 'deluxe'];

export interface OpUpgradeDef { id: OpUpgradeId; name: string; price: number; blurb: string; model: string }
export const OP_UPGRADES: Record<OpUpgradeId, OpUpgradeDef> = {
  tv: { id: 'tv', name: 'Ceiling TV', price: 1200, blurb: 'Comfort +8%. Patients wait longer in the chair.', model: 'op_tv' },
  whiteningLamp: { id: 'whiteningLamp', name: 'Whitening Lamp', price: 6000, blurb: 'Sell whitening in this operatory.', model: 'whitening_lamp' },
  intraoralCam: { id: 'intraoralCam', name: 'Intraoral Camera', price: 3000, blurb: 'Quality +3%. Add-ons accepted 10% more.', model: 'intraoral_cam' },
};

export interface EquipDef { id: EquipId; name: string; price: number; blurb: string; model: string; minTier: OfficeTierId }
export const EQUIPMENT: Record<EquipId, EquipDef> = {
  deepCert: { id: 'deepCert', name: 'Deep Cleaning Certification', price: 2000, blurb: 'Offer deep cleanings ($260) to patients who need them.', model: 'certificate', minTier: 't1' },
  espresso: { id: 'espresso', name: 'Espresso Machine', price: 1500, blurb: 'Waiting patients stay 25% longer.', model: 'espresso_machine', minTier: 't1' },
  kidsCorner: { id: 'kidsCorner', name: 'Kids Corner', price: 2000, blurb: 'Twice as many kids. Kids wait happier.', model: 'kids_corner', minTier: 't1' },
  fishTank: { id: 'fishTank', name: 'Fish Tank', price: 2500, blurb: 'Rating +0.1. Everyone loves fish.', model: 'fish_tank', minTier: 't1' },
  sterilizer: { id: 'sterilizer', name: 'Sterilizer Pro', price: 3500, blurb: 'Quality +3% in every operatory.', model: 'sterilizer', minTier: 't1' },
  onlineBooking: { id: 'onlineBooking', name: 'Online Booking', price: 4000, blurb: 'Half the no-shows. Demand +10%.', model: 'kiosk', minTier: 't1' },
  ultrasonicKits: { id: 'ultrasonicKits', name: 'Ultrasonic Kits', price: 5000, blurb: 'Hygienists clean 10% faster.', model: 'ultrasonic_cart', minTier: 't1' },
  xray: { id: 'xray', name: 'X-Ray Suite', price: 8000, blurb: 'Sell X-rays ($90) as an add-on.', model: 'xray_unit', minTier: 't1' },
  breakRoom: { id: 'breakRoom', name: 'Break Room', price: 3000, blurb: 'Staff morale +3 per day.', model: 'break_table', minTier: 't2' },
};
export const EQUIP_ORDER: EquipId[] = ['deepCert', 'espresso', 'kidsCorner', 'fishTank', 'sterilizer', 'onlineBooking', 'ultrasonicKits', 'xray', 'breakRoom'];
