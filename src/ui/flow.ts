// Game lifecycle flows: new game, continue (with offline earnings), import.
import { duration, money } from '../core/format';
import { store } from '../core/store';
import type { GameState, OfflineReport } from '../core/types';
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

export function startNewGame(name: string, avatar: number): void {
  const r = tryRun(() => sim.newGame({ name, avatar, nowMs: Date.now() }));
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
        h('div.row.gap-6.small.faint', { style: 'justify-content:center' }, icon('info'), 'Offline earnings are capped at 6 hours.'),
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
