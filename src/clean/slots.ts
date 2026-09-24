// Tool slots in the clean scene: the five owned tools plus the case tools that appear only in their case
// (DESIGN 5.3): the gel brush (whitening gel, sealants) and the UV lamp (whitening cure).
import type { CleanSetup, ToolSlot } from '../core/types';
import { TOOL_SLOTS, TOOL_SLOT_NAMES, toolTier } from '../data/tools';

export type CaseSlot = 'gel' | 'lamp';
export type SlotId = ToolSlot | CaseSlot;

export const SLOT_NAMES: Record<SlotId, string> = { ...TOOL_SLOT_NAMES, gel: 'Gel', lamp: 'Lamp' };
export const CASE_TOOL_NAMES: Record<CaseSlot, string> = { gel: 'Gel Brush', lamp: 'UV Lamp' };
export const CASE_TOOL_MODELS: Record<CaseSlot, string> = { gel: 'tool_gelbrush', lamp: 'tool_uvlamp' };

export function caseSlots(setup: CleanSetup): CaseSlot[] {
  const out: CaseSlot[] = [];
  if (setup.caseType === 'whitening') out.push('gel', 'lamp');
  else if (setup.caseType === 'candy' && (setup.special?.sealants ?? 0) > 0) out.push('gel');
  return out;
}

export function allSlots(setup: CleanSetup): SlotId[] {
  return [...TOOL_SLOTS, ...caseSlots(setup)];
}

export function slotModel(setup: CleanSetup, slot: SlotId): string {
  if (slot === 'gel' || slot === 'lamp') return CASE_TOOL_MODELS[slot];
  return toolTier(slot, setup.tools[slot]).model;
}

export const isCaseSlot = (s: SlotId): s is CaseSlot => s === 'gel' || s === 'lamp';
