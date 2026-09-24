// String floss as a small state machine (DESIGN 5.4). Pure: the controller feeds pointer motion already
// split into the gap's axis (the teeth's long axis projected to the screen, toward the gum) and the
// cross axis, normalized by the gap's on-screen length; this module decides what the string does.
//
//   idle ──press near a gap──> above ──push to the contact, pressure 1──> through (thwip)
//     ^                         │                                           │ saw: along-axis reversals = strokes
//     └──── release / slip out ─┴──────── pull back past the contact (zip) ─┘
//   braces: press ──hold still 0.6 s (thread)──> above (gap) or through (bracket)
//
// Cross-axis motion never moves the string: it bows against the tooth and creaks.

export type FlossPhase = 'idle' | 'thread' | 'above' | 'through';

export interface FlossState {
  phase: FlossPhase;
  bracket: boolean;         // the target is food under the wire at a bracket (no contact point)
  s: number;                // along the gap: 0 at the biting edge, CONTACT at the contact point, 1 at the gum
  pressure: number;         // 0..1 at the contact while pushing toward the gum
  pull: number;             // 0..1 pulling back out past the contact from below
  bend: number;             // -1..1 how hard the string is pressed sideways (cross-axis)
  thread: number;           // 0..1 threading progress (braces)
  dir: number;              // sign of the last along-axis movement
  travel: number;           // along-axis travel since the last reversal
  strokes: number;
  creakCd: number;
  bendPeak: number;
}

export const FLOSS = {
  contact: 0.3,             // contact point along the gap
  pressureGain: 4.2,        // pressure per unit of push past the contact
  pressureRelax: 3,         // pressure lost per unit pulled back
  pullGain: 4,              // pull-out per unit pulled back above the contact
  strokeTravel: 0.12,       // minimum along-axis travel between reversals for a stroke
  entry: -0.35,             // pulled this far above the edge, the string slips out
  bendCreak: 0.3,           // |bend| where the string starts to creak
  threadTime: 0.6,
};

export type FlossEvent = 'creak' | 'press' | 'thwip' | 'stroke' | 'zip' | 'slip' | 'threaded';

export function newFloss(): FlossState {
  return { phase: 'idle', bracket: false, s: 0, pressure: 0, pull: 0, bend: 0, thread: 0, dir: 0, travel: 0, strokes: 0, creakCd: 0, bendPeak: 0 };
}

/** Press on a target: hook it (or start threading when the patient wears braces). */
export function flossHook(st: FlossState, braces: boolean, bracket: boolean) {
  st.bracket = bracket;
  st.pressure = 0; st.pull = 0; st.bend = 0; st.bendPeak = 0; st.dir = 0; st.travel = 0; st.strokes = 0; st.thread = 0;
  if (braces) { st.phase = 'thread'; st.s = bracket ? 0.55 : 0; return; }
  st.phase = bracket ? 'through' : 'above';
  st.s = bracket ? 0.55 : 0;
}

export function flossRelease(st: FlossState) {
  st.phase = 'idle';
  st.pressure = 0; st.pull = 0; st.bend = 0; st.thread = 0;
}

/**
 * Time step. `still` = the pointer has stayed near where it pressed (threading needs it).
 * Returns nothing; events go to `out`.
 */
export function flossTick(st: FlossState, dt: number, still: boolean, out: FlossEvent[]) {
  if (st.creakCd > 0) st.creakCd -= dt;
  if (st.phase === 'thread') {
    st.thread = still ? Math.min(1, st.thread + dt / FLOSS.threadTime) : Math.max(0, st.thread - dt * 3);
    if (st.thread >= 1) {
      st.phase = st.bracket ? 'through' : 'above';
      out.push('threaded');
    }
    return;
  }
  // the string relaxes back when nothing pushes it
  if (st.phase === 'above' && st.pressure > 0) st.pressure = Math.max(0, st.pressure - dt * 0.6);
  if (st.phase === 'through' && st.pull > 0) st.pull = Math.max(0, st.pull - dt * 0.8);
}

/**
 * Pointer motion: `along` = movement along the gap axis toward the gum (in gap lengths, negative = away),
 * `cross` = the pointer's current sideways offset from the gap axis (in gap lengths).
 */
export function flossMove(st: FlossState, along: number, cross: number, out: FlossEvent[]) {
  if (st.phase === 'idle' || st.phase === 'thread') return;
  // sideways: blocked. The string bows against the tooth and creaks; it does not move.
  const bend = Math.max(-1, Math.min(1, cross / 0.9));
  if (Math.abs(bend) > FLOSS.bendCreak && Math.abs(bend) > Math.abs(st.bend) + 0.02 && st.creakCd <= 0) {
    out.push('creak');
    st.creakCd = 0.22;
  }
  st.bend = bend;
  if (along === 0) return;
  if (st.phase === 'above') {
    if (along > 0) {
      const room = FLOSS.contact - st.s;
      const move = Math.min(along, Math.max(0, room));
      st.s += move;
      const excess = along - move;
      if (excess > 0) {
        const before = st.pressure;
        st.pressure = Math.min(1, st.pressure + excess * FLOSS.pressureGain);
        if (before < 0.35 && st.pressure >= 0.35) out.push('press');
        if (st.pressure >= 0.55 && st.creakCd <= 0) { out.push('creak'); st.creakCd = 0.3; }
        if (st.pressure >= 1) {
          st.phase = 'through';
          st.pressure = 0;
          st.s = FLOSS.contact + 0.06;
          st.dir = 1; st.travel = 0;
          out.push('thwip');
        }
      }
    } else {
      const back = -along;
      if (st.pressure > 0) {
        const use = Math.min(back, st.pressure / FLOSS.pressureRelax);
        st.pressure = Math.max(0, st.pressure - use * FLOSS.pressureRelax);
        st.s -= back - use;
      } else st.s -= back;
      if (st.s < FLOSS.entry) { flossRelease(st); out.push('slip'); }
    }
    return;
  }
  // through: below the contact (or under the wire at a bracket). Saw up and down; pull back out to zip.
  const top = st.bracket ? 0.3 : FLOSS.contact;
  let moved = 0;
  if (along > 0) {
    if (st.pull > 0) {
      const use = Math.min(along, st.pull / FLOSS.pullGain);
      st.pull = Math.max(0, st.pull - use * FLOSS.pullGain);
      along -= use;
    }
    const ns = Math.min(1, st.s + along);
    moved = ns - st.s;
    st.s = ns;
  } else if (along < 0) {
    const ns = Math.max(top, st.s + along);
    moved = ns - st.s;
    const excess = -along + moved;          // what pushed past the contact
    st.s = ns;
    if (excess > 1e-6 && st.s <= top + 1e-6) {
      st.pull = Math.min(1, st.pull + excess * FLOSS.pullGain);
      if (st.pull >= 1) {
        flossRelease(st);
        out.push('zip');
        return;
      }
    }
  }
  if (Math.abs(moved) < 1e-6) return;
  const sgn = Math.sign(moved);
  if (st.dir !== 0 && sgn !== st.dir) {
    if (st.travel >= FLOSS.strokeTravel) { st.strokes++; out.push('stroke'); }
    st.travel = 0;
  }
  st.dir = sgn;
  st.travel += Math.abs(moved);
}
