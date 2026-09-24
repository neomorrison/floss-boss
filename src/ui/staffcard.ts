// Staff card: portrait, stats, traits, morale, salary vs ask, assignment, train, raise, fire.
// staffBlock() is shared by the Staff panel grid and the card modal.
import { money } from '../core/format';
import { TRAINING_COST } from '../core/constants';
import { store } from '../core/store';
import type { Candidate, Clinic, Staff } from '../core/types';
import { ROLES, TRAITS } from '../data/staff';
import * as sim from '../sim';
import { h } from './dom';
import { act, activeClinic, canAfford, isOwner } from './game';
import { icon } from './icons';
import { liveModal, select } from './live';
import { courseState } from './logic';
import { confirmModal } from './modal';
import { staffPortrait } from './portrait';
import { bar, btn, chip, statRow } from './widgets';

export function roleTone(role: Staff['role']): 'mint' | 'sky' | 'grape' | 'gum' | 'sun' {
  return ({ hygienist: 'mint', receptionist: 'sky', assistant: 'grape', dentist: 'gum', manager: 'sun' } as const)[role];
}

export function moraleFace(m: number): string {
  return m >= 60 ? 'smile' : m >= 30 ? 'meh' : 'frown';
}

export function traitChips(t: Staff['traits']): HTMLElement[] {
  return t.map((id) => {
    const d = TRAITS[id];
    const el = chip(d?.name ?? id, d?.good === false ? 'coral' : 'teal');
    el.title = d?.text ?? '';
    return el;
  });
}

export function statBars(s: Staff): HTMLElement {
  const rows = s.role === 'hygienist'
    ? [statRow('Skill', s.skill, 100, ''), statRow('Speed', s.speed, 100, 'sky'), statRow('Bedside', s.bedside, 100, 'gum')]
    : [statRow('Skill', s.skill, 100, '')];
  return h('div.col.gap-4', ...rows);
}

export function findStaff(staffId: string): { clinic: Clinic; index: number; staff: Staff } | null {
  if (!store.loaded) return null;
  const s = store.state;
  for (let i = 0; i < s.locations.length; i++) {
    const st = s.locations[i].staff.find((x) => x.id === staffId);
    if (st) return { clinic: s.locations[i], index: i, staff: st };
  }
  const emp = s.employer?.staff.find((x) => x.id === staffId);
  if (emp && s.employer) return { clinic: s.employer, index: -1, staff: emp };
  return null;
}

/** Assignment select for hygienists and assistants. */
function assignSelect(c: Clinic, idx: number, st: Staff): HTMLElement | null {
  if (st.role !== 'hygienist' && st.role !== 'assistant') return null;
  const current = c.ops.find((o) => (st.role === 'hygienist' ? o.staffId : o.assistantId) === st.id);
  const opts = [{ value: '', label: 'Not assigned' }, ...c.ops.map((o) => {
    const holder = st.role === 'hygienist' ? o.staffId : o.assistantId;
    const who = holder === 'player' ? 'you' : c.staff.find((x) => x.id === holder)?.name;
    return { value: o.id, label: `Operatory ${o.slot + 1}${who && holder !== st.id ? ` (${who})` : ''}` };
  })];
  return select(opts, current?.id ?? '', (opId) => {
    const s = store.state;
    if (!opId) {
      if (current) act(() => st.role === 'hygienist' ? sim.assignHygienist(s, idx, current.id, null) : sim.assignAssistant(s, idx, current.id, null), { sound: 'ui_click' });
      return;
    }
    act(() => st.role === 'hygienist' ? sim.assignHygienist(s, idx, opId, st.id) : sim.assignAssistant(s, idx, opId, st.id), { sound: 'ui_click' });
  }, 'Operatory');
}

export async function fireFlow(idx: number, st: Staff): Promise<void> {
  const ok = await confirmModal({
    title: `Fire ${st.name}?`,
    text: `${st.name} leaves today with one day of severance (${money(st.salary)}).`,
    confirm: 'Fire', danger: true, icon: 'door',
  });
  if (ok) act(() => sim.fire(store.state, idx, st.id), { sound: 'ui_click', success: `${st.name} has left the team` });
}

/** The full staff block (panel grid item or modal body). */
export function staffBlock(c: Clinic, idx: number, st: Staff, opts: { compact?: boolean; onOpen?: () => void } = {}): HTMLElement {
  const s = store.state;
  const role = ROLES[st.role];
  const course = courseState(st, s.day);
  const off = course !== 'none';
  const lowPay = st.salary < st.ask * 0.9;
  const need = Math.max(1, 25 * st.level);
  const assign = assignSelect(c, idx, st);
  const head = h('div.staff-head',
    staffPortrait(st, opts.compact ? 60 : 76, '', role.scrubs),
    h('div.grow',
      h('div.staff-name', st.name),
      h('div.row.row-wrap.gap-6', chip(role.name, roleTone(st.role)), chip(`Level ${st.level}`, ''),
        course === 'away' ? chip('Training', 'sun', 'graduation') : course === 'booked' ? chip('Training tomorrow', 'sun', 'graduation') : null),
    ),
    opts.onOpen ? h('button.icon-btn', { type: 'button', 'aria-label': 'Details', onClick: opts.onOpen }, icon('chevronRight')) : null,
  );
  const traits = st.traits.length ? h('div.row.row-wrap.gap-6', ...traitChips(st.traits)) : null;
  const morale = h('div.staff-morale', h('span.staff-face', { class: st.morale < 30 ? 'bad' : st.morale >= 60 ? 'good' : '' }, icon(moraleFace(st.morale))),
    h('div.grow', h('div.row.row-between.tiny.bold.faint', h('span', 'Morale'), h('span', String(Math.round(st.morale)))), bar(st.morale / 100, st.morale < 30 ? 'coral' : st.morale < 60 ? 'sun' : '', 'sm')));
  const pay = h('div.staff-pay',
    h('div', h('div.tiny.bold.faint', 'Salary'), h('div.num', `${money(st.salary)}/day`)),
    h('div', h('div.tiny.bold.faint', 'Asks'), h('div.num', { class: lowPay ? 'bad' : '' }, `${money(st.ask)}/day`)),
    h('div', h('div.tiny.bold.faint', 'Today'), h('div.num', `${st.patientsToday}`)),
  );
  const canRaise = st.salary < st.ask;
  const actions = h('div.staff-actions',
    btn('Train', { variant: 'soft', size: 'sm', icon: 'graduation', sub: money(TRAINING_COST), disabled: off || !canAfford(TRAINING_COST), title: course === 'booked' ? 'Booked on a course tomorrow' : off ? 'Away training today' : canAfford(TRAINING_COST) ? 'Skill +8, off for a day' : 'Not enough cash', onClick: () => act(() => sim.train(store.state, idx, st.id), { success: `${st.name} is off training tomorrow` }) }),
    canRaise ? btn('Raise', { variant: 'sun', size: 'sm', icon: 'trendUp', sub: `to ${money(st.ask)}`, onClick: () => act(() => sim.setSalary(store.state, idx, st.id, st.ask), { sound: 'cash', success: `${st.name} is happy with the raise` }) }) : null,
    btn('Fire', { variant: 'ghost', size: 'sm', icon: 'door', class: 'btn-fire', onClick: () => fireFlow(idx, st) }),
  );
  return h('div.staff-card', { class: { 'is-compact': !!opts.compact, 'is-low-morale': st.morale < 30 } },
    head,
    traits,
    statBars(st),
    h('div.staff-xp', h('span.tiny.bold.faint', `XP ${st.xp}/${need}`), bar(st.xp / need, 'xp', 'sm')),
    morale,
    pay,
    assign ? h('div.col.gap-4', h('span.label', st.role === 'hygienist' ? 'Operatory' : 'Pairs with'), assign) : h('div.small.muted', role.blurb),
    actions,
  );
}

export function candidateBlock(cand: Candidate, onHire: () => void, hireLabel = 'Hire'): HTMLElement {
  const role = ROLES[cand.role];
  const s = store.state;
  const left = cand.expiresDay - s.day;
  return h('div.staff-card.is-candidate',
    h('div.staff-head',
      staffPortrait(cand, 64, '', role.scrubs),
      h('div.grow',
        h('div.staff-name', cand.name),
        h('div.row.row-wrap.gap-6', chip(role.name, roleTone(cand.role)), left <= 0 ? chip('Last day', 'coral') : chip(`${left + 1} days left`, '')),
      ),
    ),
    cand.traits.length ? h('div.row.row-wrap.gap-6', ...traitChips(cand.traits)) : h('div.small.faint', 'No special traits'),
    statBars(cand),
    h('div.staff-pay',
      h('div', h('div.tiny.bold.faint', 'Asks'), h('div.num', `${money(cand.ask)}/day`)),
      h('div', h('div.tiny.bold.faint', 'Hiring fee'), h('div.num', money(cand.ask))),
    ),
    h('div.small.muted', role.blurb),
    btn(hireLabel, { variant: 'primary', icon: 'userPlus', block: true, disabled: !canAfford(cand.ask), title: canAfford(cand.ask) ? '' : 'Not enough cash', onClick: onHire }),
  );
}

export function openStaffCard(staffId: string): void {
  const found = findStaff(staffId);
  if (!found) return;
  const colleague = found.index < 0 || !isOwner();
  liveModal({ size: colleague ? 'sm' : 'md', cls: 'modal-staff' }, (m) => {
    const f = findStaff(staffId);
    if (!f) { m.close(); return h('div'); }
    if (colleague) {
      const c = activeClinic() ?? f.clinic;
      const boss = f.staff.portrait === 'boss';
      return h('div.staff-card',
        h('div.staff-head', staffPortrait(f.staff, 76, '', ROLES[f.staff.role].scrubs),
          h('div.grow', h('div.staff-name', f.staff.name), h('div.row.row-wrap.gap-6', chip(ROLES[f.staff.role].name, roleTone(f.staff.role)), chip(boss ? 'Your boss' : 'Colleague', '')))),
        statBars(f.staff),
        h('div.small.muted', boss ? `Owns ${c.name}.` : `Works at ${c.name}.`),
      );
    }
    return staffBlock(f.clinic, f.index, f.staff);
  });
}
