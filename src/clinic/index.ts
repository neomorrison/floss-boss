// PUBLIC CLINIC VIEW API. Owner: clinic builder. The living 3D office diorama (view only, no rules).
// The UI owns the frame loop: every animation frame it calls view.frame(clinic, minute, dtRealSeconds).
// The view derives all positions from the clinic state (patient.state + since/until, op assignments),
// so it never needs to be told about moves; SimEvents are only for one-shot effects (coins, stars, bubbles).
import type { Clinic, SimEvent } from '../core/types';

export interface ClinicViewHandlers {
  onOpClick(opId: string): void;          // an operatory (chair, cubicle or its hygienist)
  onEmptySlotClick(slot: number): void;   // a slot with no operatory yet ("Add operatory")
  onStaffClick(staffId: string): void;    // receptionist, dentist, manager, assistant
  onPatientClick(patientId: string): void;
  onDeskClick(): void;
}

export interface ClinicView {
  frame(clinic: Clinic, minute: number, dt: number): void;
  events(events: SimEvent[]): void;
  /** Camera glides to an operatory (after a hands-on clean, or when a patient awaits the player). */
  focusOp(opId: string | null): void;
  /** Visual highlight (selected op). */
  select(opId: string | null): void;
  /** true while the view is hidden behind the clean scene (skip rendering, keep state). */
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createClinicView(container: HTMLElement, handlers: Partial<ClinicViewHandlers>): ClinicView {
  throw new Error('clinic.createClinicView not built yet');
}

export function preloadClinic(): Promise<void> {
  return Promise.resolve();
}
