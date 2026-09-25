// Staff card: portrait, stats, traits, morale, salary vs ask, assignment, train, raise, fire.
// staffBlock() is shared by the Staff panel grid and the card modal.
import { money } from '../core/format';
import { store } from '../core/store';
import type { Candidate, Clinic, PerkId, Staff } from '../core/types';
import { PERKS } from '../data/manager';
import { ROLES, TRAITS } from '../data/staff';
import * as sim from '../sim';
import { caseTile } from './casebits';
import { h, replay } from './dom';
import { confetti, sfx } from './fx';
import { act, activeClinic, activeIndex, canAfford, isOwner } from './game';
import { icon } from './icons';
import { liveModal, select } from './live';
import { courseState, noDash } from './logic';
import * as mgr from './mgr';
import { caseShort, rangeLabel, specialtyOf } from './mgrlogic';
import { confirmModal, openModal } from './modal';
import { staffPortrait } from './portrait';
import { toast } from './toasts';
import { quoteRaiseAll, runRaiseAll, summarizeRaiseAll } from './raiseall';
import { bar, btn, chip, statRow } from './widgets';

export const PERK_ICON: Record<PerkId, string> = {
  whiteningPro: 'caseWhitening', kidMagnet: 'caseCandy', bracesWhiz: 'caseBraces', deepDiver: 'caseDeep', pirateWhisperer: 'casePirate',
  speedDemon: 'bolt', gentleHands: 'hand', mentor: 'graduation', ironLungs: 'lungs', upsellStar: 'receipt',
};

/** Perk chips (tap explains, touch has no hover) and specialist badges. */
export function perkChips(st: Pick<Staff, 'perks'>): HTMLElement | null {
  const perks = (st.perks ?? []).filter((p) => PERKS[p]);
  if (!perks.length) return null;
  const spec = specialtyOf(perks, PERKS);
  return h('div.row.row-wrap.gap-6.staff-perks',
    ...spec.map((ct) => h('span.specialist', { title: `Gets ${caseShort(ct).toLowerCase()} patients first` }, caseTile(ct, 20), `${caseShort(ct)} specialist`)),
    ...perks.filter((p) => !PERKS[p].caseType).map((p) => {
      const b = h('button.chip.chip-btn.chip-grape.perk-chip', { type: 'button', title: PERKS[p].text }, icon(PERK_ICON[p] ?? 'sparkle'), PERKS[p].name);
      b.addEventListener('click', (e) => { e.stopPropagation(); sfx('ui_click'); toast({ text: PERKS[p].name, sub: PERKS[p].text, kind: 'info', icon: PERK_ICON[p] ?? 'sparkle', key: 'perk-info' }); });
      return b;
    }),
  );
}

/** The two offered perks as big buttons. `after` runs once a perk is picked. */
export function perkChooser(idx: number, st: Staff, after?: () => void): HTMLElement | null {
  const offer = (st.pendingPerks ?? []).filter((p) => PERKS[p]);
  if (!offer.length) return null;
  return h('div.perk-offer',
    h('div.perk-offer-head', icon('sparkle'), h('b', `Level ${st.level}: choose a perk`)),
    h('div.perk-options', ...offer.map((p) => {
      const d = PERKS[p];
      const b = h('button.perk-option', { type: 'button', 'data-perk': p },
        d.caseType ? caseTile(d.caseType, 40) : h('span.perk-icon', icon(PERK_ICON[p] ?? 'sparkle')),
        h('span.perk-text', h('b', d.name), h('span', d.text), d.caseType ? h('span.perk-spec', `${caseShort(d.caseType)} specialist`) : null),
      );
      b.addEventListener('click', () => {
        const r = mgr.pickPerk(store.state, idx, st.id, p);
        if (!r.ok) { sfx('error'); toast({ text: r.reason, kind: 'bad', key: 'perk' }); replay(b, 'anim-shake'); return; }
        sfx('perk_pick');
        confetti(b, 36);
        // same key as the "leveled up" toast: the answer replaces the question
        toast({ text: `${st.name.split(' ')[0]} picked ${d.name}`, sub: d.text, kind: 'good', icon: PERK_ICON[p] ?? 'sparkle', key: `perk-${st.id}` });
        store.commit();
        after?.();
      });
      return b;
    })),
  );
}

/** Perk choice card for a staff member (toast "Ava leveled up: choose a perk"). */
export function openPerkChoice(staffId: string): void {
  const f = findStaff(staffId);
  if (!f || f.index < 0 || !f.staff.pendingPerks?.length) return;
  const st = f.staff;
  const m = openModal({
    eyebrow: f.clinic.name,
    title: `${st.name} leveled up`,
    icon: 'sparkle',
    size: 'md',
    cls: 'modal-perk',
    body: h('div.col.gap-14',
      h('div.row.gap-14', staffPortrait(st, 64, '', ROLES[st.role].scrubs), h('div.grow', h('div.bold', `${ROLES[st.role].name}, level ${st.level}`), h('div.small.muted', 'Pick one. The other one is gone for good.'))),
      perkChooser(f.index, st, () => m.close()),
    ),
  });
}

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

/** "Raise all" button (Payroll Day, DESIGN 8.5 raise rules, 10.6): the quote on the button, disabled with
 * the reason when nobody at that scope is below their ask. Null when the player has not learned Payroll
 * Day, or while sim.raiseAllQuote has not landed yet (src/ui/raiseall.ts guard). */
export function raiseAllButton(clinicIndex: number | 'all', label: string, opts: { size?: 'sm' | 'md' } = {}): HTMLElement | null {
  const s = store.state;
  if (!s.player.skills.includes('payrollDay')) return null;
  const q = quoteRaiseAll(sim, s, clinicIndex);
  if (!q) return null;
  const sum = summarizeRaiseAll(q, s.player.skills.includes('hardBargain'));
  return btn(label, {
    variant: 'sun', size: opts.size ?? 'sm', icon: 'trendUp', sub: sum.subLabel,
    disabled: !q.ok, title: sum.disabledReason,
    onClick: () => { void raiseAllFlow(clinicIndex, label); },
  });
}

/** Confirm the quote, then give the raise: purchase sound, toast with the result, staff cards update
 * (act() commits the store). Returns whether it went through. */
export async function raiseAllFlow(clinicIndex: number | 'all', label = 'Raise all'): Promise<boolean> {
  const s = store.state;
  const q = quoteRaiseAll(sim, s, clinicIndex);
  if (!q) return false;
  if (!q.ok) { sfx('error'); toast({ text: noDash(q.reason || 'Everyone is paid what they ask'), kind: 'bad', key: 'act-fail' }); return false; }
  const sum = summarizeRaiseAll(q, s.player.skills.includes('hardBargain'));
  const ok = await confirmModal({ title: `${label}?`, text: sum.confirmText, confirm: label, icon: 'trendUp' });
  if (!ok) return false;
  return act(() => runRaiseAll(sim, store.state, clinicIndex), { sound: 'purchase' });
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
        course === 'away' ? chip('Training', 'sun', 'graduation') : course === 'booked' ? chip('Training tomorrow', 'sun', 'graduation') : null,
        typeof st.tempUntilDay === 'number' ? chip(tempLabel(st.tempUntilDay, s.day), 'sky', 'clock') : null),
    ),
    opts.onOpen ? h('button.icon-btn', { type: 'button', 'aria-label': 'Details', onClick: opts.onOpen }, icon('chevronRight')) : null,
  );
  const traits = st.traits.length ? h('div.row.row-wrap.gap-6', ...traitChips(st.traits)) : null;
  const offer = idx >= 0 ? perkChooser(idx, st) : null;
  const morale = h('div.staff-morale', h('span.staff-face', { class: st.morale < 30 ? 'bad' : st.morale >= 60 ? 'good' : '' }, icon(moraleFace(st.morale))),
    h('div.grow', h('div.row.row-between.tiny.bold.faint', h('span', 'Morale'), h('span', String(Math.round(st.morale)))), bar(st.morale / 100, st.morale < 30 ? 'coral' : st.morale < 60 ? 'sun' : '', 'sm')));
  const pay = h('div.staff-pay',
    h('div', h('div.tiny.bold.faint', 'Salary'), h('div.num', `${money(st.salary)}/day`)),
    h('div', h('div.tiny.bold.faint', 'Asks'), h('div.num', { class: lowPay ? 'bad' : '' }, `${money(st.ask)}/day`)),
    h('div', h('div.tiny.bold.faint', 'Today'), h('div.num', `${st.patientsToday}`)),
  );
  const temp = typeof st.tempUntilDay === 'number';
  const trainCost = mgr.trainingCost(s);
  const canRaise = st.salary < st.ask && !temp;
  const actions = temp ? h('div.small.muted', 'Temporary help. Leaves on their own.') : h('div.staff-actions',
    btn('Train', { variant: 'soft', size: 'sm', icon: 'graduation', sub: money(trainCost), disabled: off || !canAfford(trainCost), title: course === 'booked' ? 'Booked on a course tomorrow' : off ? 'Away training today' : canAfford(trainCost) ? 'Skill up, off for a day' : 'Not enough cash', onClick: () => act(() => sim.train(store.state, idx, st.id), { success: `${st.name} is off training tomorrow` }) }),
    canRaise ? btn('Raise', { variant: 'sun', size: 'sm', icon: 'trendUp', sub: `to ${money(st.ask)}`, onClick: () => act(() => sim.setSalary(store.state, idx, st.id, st.ask), { sound: 'cash', success: `${st.name} is happy with the raise` }) }) : null,
    btn('Fire', { variant: 'ghost', size: 'sm', icon: 'door', class: 'btn-fire', onClick: () => fireFlow(idx, st) }),
  );
  return h('div.staff-card', { class: { 'is-compact': !!opts.compact, 'is-low-morale': st.morale < 30, 'has-perk-offer': !!offer }, 'data-staff': st.id },
    head,
    offer,
    perkChips(st),
    traits,
    statBars(st),
    h('div.staff-xp', h('span.tiny.bold.faint', `XP ${st.xp}/${need}`), bar(st.xp / need, 'xp', 'sm')),
    morale,
    pay,
    assign ? h('div.col.gap-4', h('span.label', st.role === 'hygienist' ? 'Operatory' : 'Pairs with'), assign) : h('div.small.muted', role.blurb),
    actions,
  );
}

const revealing = new Set<string>();

/** Candidate stats: exact once interviewed, else the range the application suggests. */
function candidateStats(c: Candidate): HTMLElement {
  if (mgr.isInterviewed(c)) {
    const el = statBars(c);
    if (revealing.has(c.id)) el.classList.add('is-reveal');
    return el;
  }
  const row = (label: string, key: 'skill' | 'speed' | 'bedside', tone: string) => {
    const r = c.range?.[key];
    const lo = r ? Math.max(0, Math.min(r[0], r[1])) : 0;
    const hi = r ? Math.min(100, Math.max(r[0], r[1])) : 100;
    return h('div.stat-row.is-range', h('span', label),
      h('div.bar.bar-sm.bar-range', { class: tone }, h('i', { style: { left: `${lo}%`, width: `${Math.max(3, hi - lo)}%` } })),
      h('span.num', rangeLabel(r, c[key])));
  };
  const rows = c.role === 'hygienist'
    ? [row('Skill', 'skill', ''), row('Speed', 'speed', 'sky'), row('Bedside', 'bedside', 'gum')]
    : [row('Skill', 'skill', '')];
  return h('div.col.gap-4', ...rows);
}

function tempLabel(until: number, day: number): string {
  const n = Math.max(0, until - day + 1);
  return n <= 1 ? 'Temporary: last day' : `Temporary: ${n} days left`;
}

export function candidateBlock(cand: Candidate, onHire: () => void, hireLabel = 'Hire'): HTMLElement {
  const role = ROLES[cand.role];
  const s = store.state;
  const left = cand.expiresDay - s.day;
  const known = mgr.isInterviewed(cand);
  const cost = mgr.interviewCost(s);
  const reveal = revealing.has(cand.id);
  if (reveal) setTimeout(() => revealing.delete(cand.id), 1400);
  const interviewBtn = known ? null : btn('Interview', {
    variant: 'soft', icon: 'mic', block: true, sub: cost > 0 ? money(cost) : 'Free', sound: null,
    disabled: cost > 0 && !canAfford(cost), title: cost > 0 && !canAfford(cost) ? 'Not enough cash' : undefined,
    onClick: () => {
      if (act(() => mgr.interview(store.state, cand.id, activeIndex()), { sound: null })) {
        revealing.add(cand.id);
        sfx('interview');
      }
    },
  });
  return h('div.staff-card.is-candidate', { class: { 'is-unknown': !known, 'is-reveal': reveal }, 'data-cand': cand.id },
    h('div.staff-head',
      staffPortrait(cand, 64, '', role.scrubs),
      h('div.grow',
        h('div.staff-name', cand.name),
        h('div.row.row-wrap.gap-6', chip(role.name, roleTone(cand.role)), left <= 0 ? chip('Leaves tonight', 'coral') : chip(`${left + 1} days left`, ''),
          known && cand.range ? chip('Interviewed', 'mint', 'check') : null),
      ),
    ),
    known
      ? cand.traits.length ? h('div.row.row-wrap.gap-6.cand-traits', ...traitChips(cand.traits)) : h('div.small.faint.cand-traits', 'No special traits')
      : h('div.row.row-wrap.gap-6', h('span.chip.chip-unknown', icon('question'), 'Traits unknown')),
    candidateStats(cand),
    h('div.staff-pay',
      h('div', h('div.tiny.bold.faint', 'Asks'), h('div.num', `${money(cand.ask)}/day`)),
      h('div', h('div.tiny.bold.faint', 'Hiring fee'), h('div.num', money(cand.ask))),
    ),
    h('div.small.muted', role.blurb),
    h('div.cand-actions',
      interviewBtn,
      btn(hireLabel, { variant: 'primary', icon: 'userPlus', block: true, disabled: !canAfford(cand.ask), title: canAfford(cand.ask) ? '' : 'Not enough cash', onClick: onHire }),
    ),
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
