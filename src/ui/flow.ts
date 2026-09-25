// Game lifecycle flows: new game, continue (with offline earnings), import.
import { duration, money } from '../core/format';
import { loadGame, setActiveSlot, type SlotId } from '../core/save';
import { store } from '../core/store';
import type { Difficulty, GameState, LegacyPerkId, OfflineReport } from '../core/types';
import { newGameWith } from './endgame';
import * as sim from '../sim';
import { go } from './app';
import { h } from './dom';
import { flyCoins, sfx } from './fx';
import { cashDisplay } from './hud';
import { coin, icon } from './icons';
import { resetLevelUps } from './levelup';
import { enqueue, openModal } from './modal';
import { attempt, tryRun } from './safe';
import { toast } from './toasts';
import { btn } from './widgets';

export function startNewGame(name: string, avatar: number, opts: { difficulty?: Difficulty; legacyPerks?: LegacyPerkId[]; slot?: SlotId } = {}): void {
  // the target slot (an empty one picked on the title, or the slot a retired career just left) is set
  // before the state exists, so the first autosave below lands in it rather than whatever was active
  if (opts.slot) setActiveSlot(opts.slot);
  const r = tryRun(() => newGameWith({ name, avatar, difficulty: opts.difficulty ?? 'standard', legacyPerks: opts.legacyPerks ?? [] }));
  if (!r.ok) {
    sfx('error');
    toast({ text: 'Could not start a new game yet', kind: 'bad' });
    console.warn('[ui] newGame', r.error);
    go('title');
    return;
  }
  loadState(r.value);
  store.commit({ saveNow: true });
  go('school');
}

/** Install a state (loaded, imported or new) as the running game. */
export function loadState(state: GameState): void {
  const migrated = attempt(() => sim.migrate(state), state, 'migrate');
  store.set(migrated);
  resetLevelUps(migrated.player?.level ?? 0);
  cashDisplay.snap();
}

export function continueGame(): void {
  if (!store.loaded) return;
  const s = store.state;
  if (s.phase === 'school') { go('school'); return; }
  const off = attempt(() => sim.applyOffline(s, Date.now()), null as OfflineReport | null, 'applyOffline');
  const cashBefore = off ? s.cash - off.credit : s.cash;
  s.lastSeen = Date.now();
  store.commit({ saveNow: true });
  go('hub');
  if (off && off.credit > 0) showOffline(off, cashBefore);
}

/** Slot picker "Load": make the slot active, install its save and run the same startup as Continue
 * (migrate, then offline earnings). Returns false when the slot turned out to be empty or corrupt. */
export function loadSlot(slot: SlotId): boolean {
  setActiveSlot(slot);
  const state = loadGame(slot);
  if (!state) {
    sfx('error');
    toast({ text: 'That save could not be loaded', kind: 'bad' });
    return false;
  }
  loadState(state);
  continueGame();
  return true;
}

export function showOffline(off: OfflineReport, cashBefore: number): void {
  enqueue(() => {
    cashDisplay.hold(cashBefore);
    const amount = h('div.offline-amount', coin(), h('span.num', money(off.credit)));
    const collect = btn('Collect', { variant: 'sun', size: 'lg', block: true, icon: 'wallet' });
    const m = openModal({
      icon: 'clock',
      eyebrow: `Away for ${duration(off.hours * 60)}`,
      title: 'While you were away',
      body: h('div.col.gap-14.center',
        h('p.muted', 'Your team kept the office running.'),
        amount,
        h('div.row.gap-6.small.faint', { style: 'justify-content:center' }, icon('info'), 'Earnings stop growing after 12 hours away.'),
      ),
      actions: [collect],
      size: 'sm',
      onClose: () => cashDisplay.release(),
    });
    let collected = false;
    collect.addEventListener('click', async () => {
      if (collected) return;
      collected = true;
      sfx('cash');
      const target = cashDisplay.target();
      if (target) {
        const n = 10;
        let paid = 0;
        await flyCoins(amount, target, n, (i, total) => {
          const amt = i === total - 1 ? off.credit - paid : off.credit / total;
          paid += amt;
          cashDisplay.add(amt);
          if (i % 2 === 0) sfx('coins', { volume: 0.6 });
        });
      }
      cashDisplay.release();
      m.close();
    });
  });
}
