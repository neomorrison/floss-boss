// Services and add-ons. DESIGN 7.
import type { AddonId, EquipId, OpUpgradeId, PriceKey, ServiceId } from '../core/types';

export interface Service {
  id: PriceKey;
  name: string;
  fee: number;          // market fee at price multiplier 1.0
  minutes: number;      // chair minutes (dentist minutes for exam and filling)
  supplies: number;
  addon: boolean;
  requiresEquip: EquipId | null;
  requiresOpUpgrade: OpUpgradeId | null;
  requiresDentist: boolean;
  baseAccept: number;   // add-on acceptance base (whitening uses archetype interest)
}

export const SERVICES: Record<PriceKey, Service> = {
  cleaning: { id: 'cleaning', name: 'Cleaning', fee: 120, minutes: 45, supplies: 14, addon: false, requiresEquip: null, requiresOpUpgrade: null, requiresDentist: false, baseAccept: 1 },
  deep: { id: 'deep', name: 'Deep cleaning', fee: 260, minutes: 75, supplies: 24, addon: false, requiresEquip: 'deepCert', requiresOpUpgrade: null, requiresDentist: false, baseAccept: 1 },
  fluoride: { id: 'fluoride', name: 'Fluoride varnish', fee: 35, minutes: 5, supplies: 4, addon: true, requiresEquip: null, requiresOpUpgrade: null, requiresDentist: false, baseAccept: 0.45 },
  sealant: { id: 'sealant', name: 'Sealants', fee: 60, minutes: 10, supplies: 5, addon: true, requiresEquip: null, requiresOpUpgrade: null, requiresDentist: false, baseAccept: 0.6 },
  xray: { id: 'xray', name: 'X-rays', fee: 90, minutes: 10, supplies: 6, addon: true, requiresEquip: 'xray', requiresOpUpgrade: null, requiresDentist: false, baseAccept: 0.35 },
  whitening: { id: 'whitening', name: 'Whitening', fee: 350, minutes: 40, supplies: 40, addon: true, requiresEquip: null, requiresOpUpgrade: 'whiteningLamp', requiresDentist: false, baseAccept: 0 },
  exam: { id: 'exam', name: 'Dentist exam', fee: 75, minutes: 10, supplies: 2, addon: true, requiresEquip: null, requiresOpUpgrade: null, requiresDentist: true, baseAccept: 0.7 },
  filling: { id: 'filling', name: 'Filling', fee: 220, minutes: 20, supplies: 30, addon: true, requiresEquip: null, requiresOpUpgrade: null, requiresDentist: true, baseAccept: 0.25 },
};

export const SERVICE_IDS: ServiceId[] = ['cleaning', 'deep'];
export const ADDON_IDS: AddonId[] = ['fluoride', 'sealant', 'xray', 'whitening', 'exam', 'filling'];
export const PRICE_KEYS: PriceKey[] = ['cleaning', 'deep', 'fluoride', 'sealant', 'xray', 'whitening', 'exam', 'filling'];
export const PRICE_MIN = 0.7;
export const PRICE_MAX = 1.5;
export const PRICE_STEP = 0.05;

export function defaultPrices(): Record<PriceKey, number> {
  return { cleaning: 1, deep: 1, fluoride: 1, sealant: 1, xray: 1, whitening: 1, exam: 1, filling: 1 };
}
