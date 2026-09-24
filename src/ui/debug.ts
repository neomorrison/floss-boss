// window.__fb debug hooks for headless tests (ARCHITECTURE "Debug hooks"). Available in every build.
import { bus } from '../core/bus';
import { store } from '../core/store';
import type { CleanResult, SimEvent, Speed } from '../core/types';
import * as sim from '../sim';
import { go } from './app';
import { startNewGame } from './flow';
import { activeClinic } from './game';
import { cleanPatient, hubBridge } from './handson';
import { resetLevelUps } from './levelup';
import { openOpPanel } from './oppanel';
import { openStaffCard } from './staffcard';
import { attempt } from './safe';
import { SCHOOL_FLAG } from './screens/school';

const GOOD_RESULT: CleanResult = {
  quit: 'done', tartar: 1, plaque: 0.92, stain: 0.9, debris: 1, polish: 0.85, mess: 0.05, clean: 0.93,
  comfort: 92, quality: 0.93, stars: 5, seconds: 110, chunks: 6, bestCombo: 4, gumHits: 0, gags: 0, perfect: false,
};

export function installDebug(): void {
  const debug = {
    newGame(name = 'Tester', avatar = 0) {
      startNewGame(name, avatar);
      return store.loaded ? { phase: store.state.phase, day: store.state.day } : null;
    },
    grant(cash: number) {
      if (!store.loaded) return null;
      store.state.cash += cash;
      store.commit();
      return store.state.cash;
    },
    setLevel(n: number) {
      if (!store.loaded) return null;
      const p = store.state.player;
      const gained = Math.max(0, n - p.level);
      p.level = n;
      p.xp = 0;
      p.skillPoints += gained;
      p.title = attempt(() => sim.title(store.state), p.title);
      resetLevelUps(n);
      store.commit();
      return p.level;
    },
    skipSchool() {
      if (!store.loaded) return null;
      const s = store.state;
      if (s.phase === 'school') {
        attempt(() => sim.completeSchool(s, 1, GOOD_RESULT), null, 'completeSchool');
        s.flags[SCHOOL_FLAG] = true;
        attempt(() => sim.completeSchool(s, 2, GOOD_RESULT), null, 'completeSchool');
      }
      resetLevelUps(s.player.level);
      store.commit({ saveNow: true });
      go(s.phase === 'school' ? 'school' : 'hub');
      return s.phase;
    },
    openPractice(name = 'Tester Family Dental') {
      if (!store.loaded) return null;
      const s = store.state;
      if (s.phase === 'school') debug.skipSchool();
      if (s.player.level < 4) debug.setLevel(4);
      const st = attempt(() => sim.practiceStatus(s), null, 'practiceStatus');
      if (st && !st.ok) s.cash = Math.max(s.cash, st.price);
      const st2 = attempt(() => sim.practiceStatus(s), null, 'practiceStatus');
      const loan = st2 ? Math.max(0, Math.min(st2.maxLoan, st2.price - s.cash)) : 0;
      const r = attempt(() => sim.openPractice(s, { name, loan }), { ok: false as const, reason: 'sim unavailable' }, 'openPractice');
      if (r.ok) attempt(() => sim.setActive(s, 0), undefined);
      store.commit({ saveNow: true });
      go('hub');
      return r;
    },
    goto(screen: string) { go(screen); return screen; },
    speed(n: Speed) {
      if (!store.loaded) return null;
      store.state.speed = n;
      store.commit();
      return n;
    },
    fastForward(minutes: number) {
      if (!store.loaded) return null;
      const s = store.state;
      const all: SimEvent[] = [];
      let left = minutes;
      while (left > 0 && !s.dayOver) {
        const step = Math.min(2, left);
        const ev = attempt(() => sim.tick(s, step), [] as SimEvent[], 'tick');
        all.push(...ev);
        left -= step;
      }
      if (all.length) bus.emit('sim:events', all);
      store.commit();
      return { minute: s.minute, day: s.day, dayOver: s.dayOver, events: all.length };
    },
    /** Extra: open the operatory panel (first op of the active clinic by default). */
    openOp(opId?: string) {
      const c = store.loaded ? activeClinic(store.state) : null;
      const id = opId ?? c?.ops[0]?.id;
      if (id) openOpPanel(id);
      return id ?? null;
    },
    /** Extra: open a staff card. */
    openStaff(staffId?: string) {
      const c = store.loaded ? activeClinic(store.state) : null;
      const id = staffId ?? c?.staff[0]?.id;
      if (id) openStaffCard(id);
      return id ?? null;
    },
    clean(patientId?: string) {
      if (!store.loaded) return null;
      const s = store.state;
      const id = patientId ?? attempt(() => sim.playerQueue(s), []).at(0)?.id ?? activeClinic(s)?.patients.find((p) => p.awaitingPlayer)?.id;
      const bridge = hubBridge();
      if (!id || !bridge) return null;
      void cleanPatient(id, bridge);
      return id;
    },
  };
  (window as unknown as { __fb: unknown }).__fb = { store, sim, debug };
}
