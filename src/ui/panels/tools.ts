// Tools shop: tiers per slot with thumbnails and stat deltas, extras, numbing gel.
import { money } from '../../core/format';
import { store } from '../../core/store';
import type { ToolSlot } from '../../core/types';
import { EXTRAS, NUMBING_GEL_PRICE, TOOL_SLOTS, TOOL_SLOT_NAMES, TOOLS } from '../../data/tools';
import * as sim from '../../sim';
import { h } from '../dom';
import { act, canAfford } from '../game';
import { coin, icon } from '../icons';
import { bestTier, toolStats, toolTierState } from '../logic';
import type { PanelCtx, PanelInst } from '../panelhost';
import { btn, chip, sectionTitle, thumb, toggle } from '../widgets';

const SLOT_ICON: Record<ToolSlot, string> = { scaler: 'scaler', polisher: 'polisher', floss: 'floss', suction: 'suction', rinse: 'rinse' };

export function toolsPanel(_ctx: PanelCtx): PanelInst {
  return {
    title: 'Tools',
    icon: 'tools',
    aside: () => h('div.panel-cash', coin(), h('span.num', money(store.state.cash))),
    key: () => {
      const s = store.state;
      const prices = [...TOOL_SLOTS.flatMap((sl) => TOOLS[sl].map((t) => t.price)), ...EXTRAS.map((x) => x.price), NUMBING_GEL_PRICE, NUMBING_GEL_PRICE * 5];
      return JSON.stringify([s.player.tools, s.player.extras, s.player.numbingGel, s.player.useGel, prices.map((p) => (s.cash >= p ? 1 : 0)).join('')]);
    },
    render() {
      const s = store.state;
      const sections = TOOL_SLOTS.map((slot) => {
        const owned = s.player.tools[slot] ?? 1;
        const cur = bestTier(slot, owned);
        const tiers = TOOLS[slot];
        const cards = tiers.map((t) => {
          const state = toolTierState(owned, t.tier);
          const stats = toolStats(slot, t, cur);
          const prev = tiers[t.tier - 2];
          const afford = canAfford(t.price);
          let action: HTMLElement;
          if (state === 'inUse') action = chip('In use', 'mint', 'check');
          else if (state === 'owned') action = chip('Owned', '', 'check');
          else if (state === 'locked') action = h('div.tool-lock.small', icon('lock'), `Needs ${prev?.name ?? 'the previous tier'}`);
          else action = btn('Buy', { variant: 'sun', size: 'sm', sub: money(t.price), disabled: !afford, title: afford ? `Buy ${t.name}` : 'Not enough cash', onClick: () => act(() => sim.buyTool(store.state, slot, t.tier), { success: `${t.name} is now in your kit` }) });
          return h('div.tool-card', { class: `is-${state}` },
            h('div.tool-top', thumb(t.model, SLOT_ICON[slot], 84, state === 'locked'), h('span.tool-tier', `T${t.tier}`)),
            h('div.tool-name', t.name),
            h('div.tool-blurb', t.blurb),
            state === 'buy' || state === 'locked'
              ? h('div.tool-stats', ...stats.map((st) => h('div.tool-stat', h('span', st.label), h('span.num', st.value), st.better === null ? h('span.tool-delta') : h('span.tool-delta', { class: st.better ? 'good' : 'bad', title: st.better ? 'Better' : 'Worse' }, icon(st.delta > 0 ? 'arrowUp' : 'arrowDown')))))
              : h('div.tool-stats', ...stats.map((st) => h('div.tool-stat', h('span', st.label), h('span.num', st.value), h('span.tool-delta')))),
            h('div.tool-action', action),
          );
        });
        return h('div.tool-slot',
          sectionTitle(TOOL_SLOT_NAMES[slot], SLOT_ICON[slot], h('span.small.muted', `In use: ${cur.name}`)),
          h('div.tool-row.scroll-x', ...cards),
        );
      });

      const extras = EXTRAS.map((x) => {
        const owned = s.player.extras.includes(x.id);
        const afford = canAfford(x.price);
        return h('div.extra-card', { class: { 'is-owned': owned } },
          thumb(x.model, 'sparkle', 72),
          h('div.grow', h('div.tool-name', x.name), h('div.tool-blurb', x.blurb)),
          owned ? chip('Owned', 'mint', 'check') : btn('Buy', { variant: 'sun', size: 'sm', sub: money(x.price), disabled: !afford, title: afford ? '' : 'Not enough cash', onClick: () => act(() => sim.buyExtra(store.state, x.id), { success: `${x.name} added to your kit` }) }),
        );
      });

      const gel = h('div.gel-card',
        thumb('', 'gel', 72),
        h('div.grow',
          h('div.tool-name', 'Numbing Gel'),
          h('div.tool-blurb', 'Gum slips hurt half as much. While switched on, one is used on each hands-on patient.'),
          h('div.row.gap-6.gel-count', chip(`${s.player.numbingGel} in stock`, s.player.numbingGel ? 'teal' : '', 'gel')),
        ),
        h('div.col.gap-6.gel-buy',
          btn('Buy 1', { variant: 'sun', size: 'sm', sub: money(NUMBING_GEL_PRICE), disabled: !canAfford(NUMBING_GEL_PRICE), title: canAfford(NUMBING_GEL_PRICE) ? '' : 'Not enough cash', onClick: () => act(() => sim.buyGel(store.state, 1)) }),
          btn('Buy 5', { variant: 'sun', size: 'sm', sub: money(NUMBING_GEL_PRICE * 5), disabled: !canAfford(NUMBING_GEL_PRICE * 5), title: canAfford(NUMBING_GEL_PRICE * 5) ? '' : 'Not enough cash', onClick: () => act(() => sim.buyGel(store.state, 5)) }),
        ),
        h('label.gel-toggle', h('span.bold.small', 'Use gel'), toggle(s.player.useGel, (v) => { store.state.player.useGel = v; store.commit(); }, 'Use numbing gel')),
      );

      return h('div.tools-panel',
        ...sections,
        sectionTitle('Extras', 'sparkle'),
        h('div.grid.grid-auto-lg', ...extras),
        sectionTitle('Supplies', 'gel'),
        gel,
      );
    },
  };
}
