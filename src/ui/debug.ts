// window.__fb debug hooks for headless tests (ARCHITECTURE "Debug hooks"). Available in every build.
import { bus } from '../core/bus';
import { store } from '../core/store';
import type { BonusId, CaseSpecial, CaseType, CleanResult, HandsOnPayout, SimEvent, Speed, TwistId } from '../core/types';
import { CASES } from '../data/cases';
import * as sim from '../sim';
import { go } from './app';
import { startNewGame } from './flow';
import { activeClinic } from './game';
import { cleanPatient, hubBridge } from './handson';
import { resetLevelUps, showLevelUp } from './levelup';
import { openOpPanel } from './oppanel';
import { openStaffCard } from './staffcard';
import { attempt } from './safe';
import { showCleanResult } from './result';
import { SCHOOL_FLAG } from './screens/school';

const GOOD_RESULT: CleanResult = {
  quit: 'done', tartar: 1, plaque: 0.92, stain: 0.9, debris: 1, polish: 0.85, mess: 0.05, clean: 0.93,
  comfort: 92, quality: 0.93, stars: 5, seconds: 110, chunks: 6, bestCombo: 4, gumHits: 0, gags: 0, perfect: false,
  caseType: 'routine',
  objectives: [
    { id: 'tartar', label: 'Pop the tartar (6)', progress: 1, done: true },
    { id: 'plaque', label: 'Clear plaque on the marked teeth', progress: 0.92, done: false },
    { id: 'stain', label: 'Polish out the stains', progress: 1, done: true },
    { id: 'rinse', label: 'Rinse and suction', progress: 1, done: true },
  ],
  bonusMet: false, treasure: false, shadeGain: 0, before: null, after: null,
};

/** A fake mouth snapshot for testing the before/after slider without the 3D scene. */
function fakeSnapshot(dirty: boolean): string {
  const c = document.createElement('canvas');
  c.width = 480; c.height = 300;
  const g = c.getContext('2d');
  if (!g) return '';
  const bg = g.createRadialGradient(240, 150, 20, 240, 150, 260);
  bg.addColorStop(0, '#7a2f3b'); bg.addColorStop(1, '#3a1016');
  g.fillStyle = bg; g.fillRect(0, 0, 480, 300);
  g.fillStyle = '#ff8fa6'; g.fillRect(0, 60, 480, 30); g.fillRect(0, 210, 480, 30);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 8; i++) {
      const x = 30 + i * 55;
      const y = row ? 160 : 88;
      g.fillStyle = dirty ? (i % 3 === 0 ? '#d8b04a' : i % 3 === 1 ? '#e7d58a' : '#b99a60') : '#fffdf7';
      g.beginPath(); g.roundRect(x, y, 46, 52, 12); g.fill();
      if (dirty && i % 2 === 0) { g.fillStyle = '#8a5a2b'; g.beginPath(); g.arc(x + 23, y + (row ? 10 : 42), 9, 0, Math.PI * 2); g.fill(); }
      if (!dirty) { g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x + 14, y + 14, 4, 0, Math.PI * 2); g.fill(); }
    }
  }
  return c.toDataURL('image/jpeg', 0.8);
}

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
    /** Level up to n with the level up modal (setLevel skips the modal). */
    levelUp(n: number) {
      if (!store.loaded) return null;
      const p = store.state.player;
      p.skillPoints += Math.max(0, n - p.level);
      p.level = n;
      p.xp = 0;
      p.title = attempt(() => sim.title(store.state), p.title);
      store.commit();
      showLevelUp(n);
      return n;
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
    /** Set hands-on mastery of a case type (3+ star cleans) for testing Quick clean gates and tier ups. */
    mastery(caseType: CaseType, n: number) {
      if (!store.loaded) return null;
      const p = store.state.player;
      p.mastery = { ...(p.mastery ?? {}), [caseType]: Math.max(0, Math.floor(n)) };
      store.commit();
      return p.mastery;
    },
    /** Give the patient waiting in your chair (or the next one) a case, twists and a bonus, for chair card tests. */
    patient(caseType: CaseType = 'candy', twists: TwistId[] = ['chatty', 'fidget'], bonus: BonusId | null = 'combo') {
      if (!store.loaded) return null;
      const s = store.state;
      const c = activeClinic(s);
      const q = attempt(() => sim.playerQueue(s), []);
      const p = q[0] ?? c?.patients.find((x) => x.state !== 'gone' && x.state !== 'noshow');
      if (!p) return null;
      p.caseType = caseType;
      p.twists = twists;
      (p as typeof p & { bonus?: BonusId | null }).bonus = bonus;
      store.commit();
      return p.id;
    },
    /** Show a Clean Result built from debug data (no 3D scene needed). */
    showResult(o: { caseType?: CaseType; stars?: number; walkout?: boolean; tierUp?: boolean; count?: number; treasure?: number; shadeGain?: number; bonus?: BonusId | null; bonusMet?: boolean; images?: boolean } = {}) {
      if (!store.loaded) return null;
      const s = store.state;
      const ct = o.caseType ?? 'routine';
      const stars = o.stars ?? 5;
      const walkout = !!o.walkout;
      const count = o.count ?? (o.tierUp ? 3 : 2);
      const r: CleanResult = {
        ...GOOD_RESULT, caseType: ct, stars, quality: walkout ? 0.25 : 0.55 + stars * 0.08, quit: walkout ? 'walkout' : 'done',
        comfort: walkout ? 0 : 88, bonusMet: !!o.bonusMet, treasure: (o.treasure ?? 0) > 0, shadeGain: o.shadeGain ?? (ct === 'whitening' ? 7 : 0),
        perfect: stars === 5 && !!o.bonusMet,
        before: o.images === false ? null : fakeSnapshot(true), after: o.images === false ? null : fakeSnapshot(false),
        objectives: [
          { id: 'a', label: ct === 'candy' ? 'Squash the sugar bugs (5)' : 'Pop the tartar (6)', progress: 1, done: true },
          { id: 'b', label: ct === 'whitening' ? 'Cure the front teeth under the lamp' : 'Clear plaque on the marked teeth', progress: walkout ? 0.4 : 0.93, done: !walkout && stars >= 5 },
          { id: 'c', label: 'Floss out the food (2)', progress: walkout ? 0.5 : 1, done: !walkout },
          { id: 'd', label: 'Rinse and suction', progress: walkout ? 0 : 1, done: !walkout },
        ],
      };
      const mastery: HandsOnPayout['mastery'] = walkout ? null : { caseType: ct, count, tier: count >= 25 ? 3 : count >= 10 ? 2 : count >= 3 ? 1 : 0, tierUp: !!o.tierUp };
      const payout: HandsOnPayout = {
        pay: walkout ? 0 : 118, tip: walkout ? 0 : 22, bonus: 0, xp: walkout ? 5 : 41, stars: walkout ? 1 : stars, quality: r.quality, levelUps: 0,
        addons: [], lines: walkout ? ['Walked out.'] : [], treasure: o.treasure ?? 0, mastery,
      };
      const special: Partial<CaseSpecial> = { startShade: ct === 'whitening' ? 13 : 0, targetShade: ct === 'whitening' ? 6 : 0 };
      const cash = s.cash;
      void showCleanResult({
        patient: { name: ct === 'pirate' ? 'Captain Molar' : 'Test Patient', archetype: ct === 'pirate' ? 'pirate' : ct === 'candy' ? 'kid' : 'regular' },
        result: r, payout, parSeconds: 120, before: { level: s.player.level, xp: s.player.xp, cash }, after: { level: s.player.level, xp: s.player.xp, cash },
        events: [], phase: s.phase === 'school' ? 'employee' : s.phase, ownedClinicIds: [], caseType: ct, bonus: o.bonus === undefined ? 'combo' : o.bonus, special,
      });
      return CASES[ct].name;
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
