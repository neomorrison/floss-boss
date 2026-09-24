// Goals: daily goals with Claim, and the achievements grid.
import { money } from '../../core/format';
import { store } from '../../core/store';
import type { Goal } from '../../core/types';
import { ACHIEVEMENTS } from '../../data/achievements';
import * as sim from '../../sim';
import { h } from '../dom';
import { flyCoins, sfx } from '../fx';
import { act } from '../game';
import { cashDisplay } from '../hud';
import { icon } from '../icons';
import { noDash } from '../logic';
import type { PanelCtx, PanelInst } from '../panelhost';
import { bar, btn, chip, empty, sectionTitle } from '../widgets';

const GOAL_ICON: Record<Goal['kind'], string> = {
  chunks: 'tooth', fiveStars: 'star', served: 'user', fastClean: 'timer', addons: 'receipt', perfect: 'sparkle', combo: 'bolt',
};

export function goalsPanel(_ctx: PanelCtx): PanelInst {
  return {
    title: 'Goals',
    icon: 'goals',
    key: () => { const s = store.state; return JSON.stringify([s.goals.map((g) => [g.id, g.progress, g.done, g.claimed]), s.achievements.length]); },
    render() {
      const s = store.state;
      const goals = s.goals.map((g) => {
        const frac = g.target ? Math.min(1, g.progress / g.target) : 0;
        let action: HTMLElement;
        if (g.claimed) action = chip('Claimed', 'mint', 'check');
        else if (g.done) {
          action = btn('Claim', {
            variant: 'sun', icon: 'gift', class: 'goal-claim',
            onClick: (ev) => {
              const from = ev.currentTarget as HTMLElement;
              const before = store.state.cash;
              if (!act(() => sim.claimGoal(store.state, g.id), { sound: 'cash' })) return;
              const gained = store.state.cash - before;
              const target = cashDisplay.target();
              if (target && gained > 0) {
                cashDisplay.hold(before);
                let paid = 0;
                flyCoins(from, target, 8, (i, n) => {
                  const amt = i === n - 1 ? gained - paid : gained / n;
                  paid += amt;
                  cashDisplay.add(amt);
                  if (i % 2 === 0) sfx('coins', { volume: 0.5 });
                }).then(() => cashDisplay.release());
              }
            },
          });
        } else action = h('span.goal-progress.num', `${Math.min(g.progress, g.target)}/${g.target}`);
        return h('div.goal-card', { class: { 'is-done': g.done, 'is-claimed': g.claimed } },
          h('div.goal-icon', icon(GOAL_ICON[g.kind] ?? 'goals')),
          h('div.grow',
            h('div.goal-text', noDash(g.text)),
            bar(frac, g.done ? '' : 'sun', 'sm'),
            h('div.row.row-wrap.gap-6.goal-reward',
              g.rewardCash ? chip(`+${money(g.rewardCash)}`, 'sun') : null,
              g.rewardXp ? chip(`+${g.rewardXp} XP`, 'grape', 'bolt') : null,
            ),
          ),
          h('div.goal-action', action),
        );
      });
      const have = new Set(s.achievements);
      const achs = ACHIEVEMENTS.map((a) => h('div.ach-card', { class: { 'is-on': have.has(a.id) } },
        h('div.ach-medal', icon(have.has(a.id) ? 'medal' : 'lock')),
        h('div.ach-name', a.name),
        h('div.ach-text', a.text),
      ));
      return h('div.goals-panel',
        sectionTitle('Today', 'calendar', h('span.small.muted', 'New goals every morning')),
        goals.length ? h('div.col.gap-14', ...goals) : empty('goals', 'No goals today', 'New goals arrive with the next day.'),
        sectionTitle('Achievements', 'medal', chip(`${have.size} of ${ACHIEVEMENTS.length}`, 'teal')),
        h('div.grid.grid-auto-sm.ach-grid', ...achs),
      );
    },
  };
}
