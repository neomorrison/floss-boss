// Staff (owner): the team per location and the hire board.
import { money } from '../../core/format';
import { store } from '../../core/store';
import type { StaffRole } from '../../core/types';
import { ROLES, ROLE_IDS } from '../../data/staff';
import * as sim from '../../sim';
import { h } from '../dom';
import { confetti } from '../fx';
import { act, activeIndex } from '../game';
import { icon } from '../icons';
import { locationPicker } from './office';
import type { PanelCtx, PanelInst } from '../panelhost';
import { candidateBlock, staffBlock } from '../staffcard';
import { empty, tabs } from '../widgets';

let intent: { tab: 'team' | 'hire'; role: StaffRole | 'all' } | null = null;
/** Open the Staff panel on a given tab and role filter next time it is built (for example from the operatory panel). */
export function staffPanelIntent(tab: 'team' | 'hire', role: StaffRole | 'all' = 'all'): void {
  intent = { tab, role };
}

export function staffPanel(ctx: PanelCtx): PanelInst {
  let tab: 'team' | 'hire' = intent?.tab ?? 'team';
  let roleFilter: StaffRole | 'all' = intent?.role ?? 'all';
  intent = null;
  return {
    title: 'Staff',
    icon: 'staff',
    key: () => {
      const s = store.state;
      const c = s.locations[activeIndex(s)];
      if (!c) return 'none';
      return JSON.stringify([
        s.active, s.day, s.locations.length,
        c.staff.map((x) => [x.id, x.salary, x.ask, Math.round(x.morale), x.level, x.xp, x.patientsToday, x.offUntilDay, x.offFrom ?? 0]),
        s.player.skills.includes('negotiator'),
        c.ops.map((o) => [o.id, o.staffId, o.assistantId]),
        s.candidates.map((x) => x.id),
        [1500, ...s.candidates.map((x) => x.ask)].map((p) => (s.cash >= p ? 1 : 0)).join(''),
      ]);
    },
    render() {
      const s = store.state;
      if (intent) { tab = intent.tab; roleFilter = intent.role; intent = null; }
      if (roleFilter !== 'all' && !s.candidates.some((x) => x.role === roleFilter)) roleFilter = 'all';
      const loc = activeIndex(s);
      const c = s.locations[loc];
      if (!c) return empty('staff', 'No practice yet', 'Open a practice to build a team.');
      const staffed = c.ops.filter((o) => o.staffId).length;
      // what the day close charges: Negotiator takes 10% off (sim salaryCost)
      const negotiator = s.player.skills.includes('negotiator');
      const payroll = c.staff.reduce((a, x) => a + Math.round(x.salary * (negotiator ? 0.9 : 1)), 0);
      const locPick = locationPicker();
      const head = h('div.staff-top',
        tabs([{ value: 'team', label: 'Team' }, { value: 'hire', label: 'Hire board', badge: s.candidates.length }], tab, (v) => { tab = v; ctx.rerender(); }),
        locPick,
      );
      if (tab === 'team') {
        const summary = h('div.staff-summary',
          h('div.sum-tile', icon('staff'), h('b.num', String(c.staff.length)), h('span', 'On the team')),
          h('div.sum-tile', icon('chair'), h('b.num', `${staffed}/${c.ops.length}`), h('span', 'Operatories staffed')),
          h('div.sum-tile', icon('wallet'), h('b.num', money(payroll)), h('span', 'Salaries per day')),
        );
        const list = c.staff.length
          ? h('div.grid.grid-auto-lg', ...c.staff.slice().sort((a, b) => ROLE_IDS.indexOf(a.role) - ROLE_IDS.indexOf(b.role)).map((st) => staffBlock(c, loc, st)))
          : empty('userPlus', 'No team yet', 'Hygienists clean patients for you. Receptionists speed up check-in.', h('button.btn.btn-primary', { type: 'button', onClick: () => { tab = 'hire'; ctx.rerender(); } }, 'Hire board'));
        return h('div.staff-panel', head, summary, list);
      }
      // hire board
      const roles = Array.from(new Set(s.candidates.map((x) => x.role)));
      const filterRow = roles.length > 1
        ? h('div.row.row-wrap.gap-6.staff-filter',
          ...(['all', ...ROLE_IDS.filter((r) => roles.includes(r))] as (StaffRole | 'all')[]).map((r) => {
            const b = h('button.chip.chip-btn', { type: 'button', class: { 'is-on': roleFilter === r } }, r === 'all' ? 'Everyone' : ROLES[r].plural);
            b.addEventListener('click', () => { roleFilter = r; ctx.rerender(); });
            return b;
          }))
        : null;
      const cands = s.candidates.filter((x) => roleFilter === 'all' || x.role === roleFilter);
      const list = cands.length
        ? h('div.grid.grid-auto-lg', ...cands.map((cand) => candidateBlock(cand, () => {
          const ok = act(() => sim.hire(store.state, cand.id, loc), { sound: 'hire', success: `${cand.name} joined ${c.name}` });
          if (ok) confetti(undefined, 40);
        }, s.locations.length > 1 ? `Hire to ${c.name}` : 'Hire')))
        : empty('calendar', 'No candidates right now', 'New people apply every morning.');
      return h('div.staff-panel', head,
        h('div.small.muted.staff-hint', icon('info'), 'The hiring fee is one day of salary. New hires start right away.'),
        filterRow, list);
    },
  };
}
