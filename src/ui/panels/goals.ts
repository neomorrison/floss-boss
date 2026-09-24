// Goals: daily goals with Claim and the achievements grid, plus the Cases tab (case mastery, DESIGN 5.9).
import { money } from '../../core/format';
import { store } from '../../core/store';
import type { CaseType, GameState, Goal } from '../../core/types';
import { ACHIEVEMENTS } from '../../data/achievements';
import { CASE_ORDER, CASES, MASTERY_NAMES, MASTERY_TIERS } from '../../data/cases';
import { EQUIPMENT, OP_UPGRADES } from '../../data/upgrades';
import * as sim from '../../sim';
import { CASE_TONE, caseTile, tierMedal } from '../casebits';
import { h } from '../dom';
import { flyCoins, sfx } from '../fx';
import { act, activeIndex } from '../game';
import { cashDisplay } from '../hud';
import { icon } from '../icons';
import { masteryInfo, noDash } from '../logic';
import type { PanelCtx, PanelInst } from '../panelhost';
import { bar, btn, chip, empty, sectionTitle, tabs } from '../widgets';

// owner goals (DESIGN 10.7) add management kinds beyond Goal['kind']: campaigns, events, net, rating, zero walkouts
const GOAL_ICON: Record<string, string> = {
  chunks: 'tooth', fiveStars: 'star', served: 'user', fastClean: 'timer', addons: 'receipt', perfect: 'sparkle', combo: 'bolt',
  campaign: 'megaphone', events: 'bell', net: 'trendUp', opNet: 'trendUp', profit: 'trendUp', rating: 'star', noWalkouts: 'door', zeroWalkouts: 'door', walkouts: 'door',
};

type GoalsTab = 'goals' | 'cases';
let pendingTab: GoalsTab | null = null;
/** Open the Goals panel on a tab next time it is built or shown. */
export function goalsPanelTab(tab: GoalsTab): void {
  pendingTab = tab;
}

export function goalsPanel(ctx: PanelCtx): PanelInst {
  let tab: GoalsTab = pendingTab ?? 'goals';
  pendingTab = null;
  return {
    title: 'Goals',
    icon: 'goals',
    key: () => {
      const s = store.state;
      return JSON.stringify([tab, s.goals.map((g) => [g.id, g.progress, g.done, g.claimed]), s.achievements.length, s.player.mastery, s.player.level, s.phase, s.active]);
    },
    render() {
      const s = store.state;
      if (pendingTab) { tab = pendingTab; pendingTab = null; }
      const unclaimed = s.goals.filter((g) => g.done && !g.claimed).length;
      const head = tabs<GoalsTab>([{ value: 'goals', label: 'Goals', badge: unclaimed }, { value: 'cases', label: 'Cases' }], tab, (v) => { tab = v; ctx.rerender(); });
      return h('div.goals-panel', h('div.goals-tabs', head), tab === 'cases' ? casesTab(s) : goalsTab(s));
    },
  };
}

function goalsTab(s: GameState): HTMLElement {
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
  return h('div.goals-tab',
    sectionTitle('Today', 'calendar', h('span.small.muted', 'New goals every morning')),
    goals.length ? h('div.col.gap-14', ...goals) : empty('goals', 'No goals today', 'New goals arrive with the next day.'),
    sectionTitle('Achievements', 'medal', chip(`${have.size} of ${ACHIEVEMENTS.length}`, 'teal')),
    h('div.grid.grid-auto-sm.ach-grid', ...achs),
  );
}

/** Owner phase: a case that needs gear falls back to a routine clean without it. */
function missingGear(s: GameState, ct: CaseType): string {
  const req = CASES[ct].requires;
  if (!req || s.phase !== 'owner') return '';
  const c = s.locations[activeIndex(s)];
  if (!c) return '';
  if (req === 'whiteningLamp') return c.ops.some((o) => o.upgrades.includes('whiteningLamp')) ? '' : `Needs a ${OP_UPGRADES.whiteningLamp.name} in an operatory`;
  if (req === 'deepCert') return c.equipment.includes('deepCert') ? '' : `Needs ${EQUIPMENT.deepCert.name}`;
  return '';
}

function casesTab(s: GameState): HTMLElement {
  const mastery = s.player.mastery ?? {};
  const level = s.player.level;
  const infos = CASE_ORDER.map((ct) => ({ ct, info: masteryInfo(mastery[ct] ?? 0), locked: level < CASES[ct].minLevel }));
  const medals = [1, 2, 3].map((t) => infos.filter((x) => x.info.tier >= t).length);
  const cards = infos.map(({ ct, info, locked }) => {
    const def = CASES[ct];
    const gear = locked ? '' : missingGear(s, ct);
    const next = info.nextAt === null ? null : h('div.case-next',
      h('div.row.row-between.tiny.bold', h('span.faint', `Next: ${info.nextName}`), h('span.num', `${info.count}/${info.nextAt}`)),
      bar(info.frac, `tier-${info.tier + 1}`, 'sm'),
    );
    return h('div.case-card', { class: [`tone-${CASE_TONE[ct]}`, { 'is-locked': locked, [`tier-${info.tier}`]: true }] },
      h('div.case-card-head',
        caseTile(ct, 52),
        h('div.grow',
          h('div.case-card-name', def.name),
          h('div.case-card-blurb', def.blurb),
        ),
        locked ? h('span.case-lock', icon('lock')) : tierMedal(info.tier, 44),
      ),
      locked
        ? h('div.case-locked', icon('lock'), `Unlocks at level ${def.minLevel}`)
        : h('div.col.gap-6',
          h('div.row.row-between.row-wrap.gap-6',
            h('span.case-tier-name', info.tier ? `${info.name} mastery` : MASTERY_NAMES[0]),
            h('span.small.muted', info.count === 1 ? '1 cleaning' : `${info.count} cleanings`),
          ),
          next ?? h('div.case-next.is-max', icon('crown'), 'Top tier'),
          h('div.case-perk', icon(info.tier ? 'sparkle' : 'info'), h('span', noDash(info.perk))),
          info.nextPerk && info.tier > 0 ? h('div.case-perk.is-next', icon('arrowUp'), h('span', `${info.nextName}: ${noDash(info.nextPerk)}`)) : null,
          gear ? h('div.case-perk.is-warn', icon('alert'), h('span', `${gear}. Until then these patients get a routine clean.`)) : null,
        ),
    );
  });
  return h('div.goals-tab',
    sectionTitle('Cases', 'tooth', h('div.row.gap-6.case-medal-sum', ...[1, 2, 3].map((t, i) => h('span.row.gap-4', tierMedal(t, 22), h('b.num', String(medals[i])))))),
    h('div.small.muted.cases-hint', icon('info'), `Hands-on cleans with 3 stars or more count toward mastery. Bronze at ${MASTERY_TIERS[0]}, Silver at ${MASTERY_TIERS[1]}, Gold at ${MASTERY_TIERS[2]}.`),
    h('div.grid.grid-auto-lg.case-grid', ...cards),
  );
}
