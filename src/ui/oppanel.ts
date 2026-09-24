// Operatory panel (assign hygienist, assistant or yourself, hands or autopilot, chair tier, op upgrades),
// "Add operatory", patient card and front desk card.
import { clock, money } from '../core/format';
import { EXTRA_OP_PRICE, PLAYER_ID } from '../core/constants';
import { store } from '../core/store';
import type { ChairTier, Clinic, DayPatient, OpUpgradeId, Operatory } from '../core/types';
import { OFFICES } from '../data/offices';
import { ARCHETYPES } from '../data/patients';
import { SERVICES } from '../data/services';
import { CHAIRS, CHAIR_ORDER, OP_UPGRADES } from '../data/upgrades';
import * as sim from '../sim';
import { go } from './app';
import { h } from './dom';
import { act, activeClinic, activeIndex, canAfford, isOwner } from './game';
import { icon } from './icons';
import { liveModal, select } from './live';
import { dirtLabel, moodFromPatient } from './logic';
import { openModal } from './modal';
import { avatarPortrait, patientPortrait, staffPortrait } from './portrait';
import { btn, chip, priceTag, seg, stars, thumb } from './widgets';

function findOp(c: Clinic | null, opId: string): Operatory | null {
  return c?.ops.find((o) => o.id === opId) ?? null;
}

const PATIENT_STATE: Record<DayPatient['state'], string> = {
  scheduled: 'Booked', entering: 'Arriving', checkin: 'Checking in', waiting: 'In the waiting room', toChair: 'Walking to the chair',
  inChair: 'In the chair', toDesk: 'Paying', checkout: 'Paying', exiting: 'Leaving', walkout: 'Walked out', gone: 'Gone home', noshow: 'No-show',
};

export function openOpPanel(opId: string): void {
  if (!store.loaded) return;
  const c0 = activeClinic();
  const op0 = findOp(c0, opId);
  if (!c0 || !op0) return;
  const owner = isOwner() && c0.ownedByPlayer;
  liveModal({
    eyebrow: c0.name,
    title: `Operatory ${op0.slot + 1}`,
    icon: 'chair',
    size: 'md',
    cls: 'modal-op',
  }, (m) => {
    const s = store.state;
    const c = activeClinic(s);
    const op = findOp(c, opId);
    if (!c || !op) { m.close(); return h('div'); }
    return owner ? ownerOp(c, op) : employeeOp(c, op);
  });
}

function patientRow(p: DayPatient | null, empty: string): HTMLElement {
  if (!p) return h('div.op-patient.is-empty', h('div.op-empty-icon', icon('chair')), h('span.muted', empty));
  const d = dirtLabel(p.dirtLevel);
  return h('div.op-patient',
    patientPortrait(p, moodFromPatient(p), 52),
    h('div.grow',
      h('div.bold', p.name),
      h('div.row.row-wrap.gap-6', chip(ARCHETYPES[p.archetype]?.label ?? p.archetype, 'teal'), chip(PATIENT_STATE[p.state], ''), chip(`${d.label} gunk`, d.tone)),
    ),
  );
}

function ownerOp(c: Clinic, op: Operatory): HTMLElement {
  const s = store.state;
  const idx = activeIndex(s);
  const hygienists = c.staff.filter((x) => x.role === 'hygienist');
  const assistants = c.staff.filter((x) => x.role === 'assistant');
  const opOf = (id: string) => c.ops.find((o) => o.staffId === id || o.assistantId === id);
  const hygOpts = [
    { value: '', label: 'Nobody' },
    { value: PLAYER_ID, label: `You (${s.player.name})` },
    ...hygienists.map((x) => {
      const at = opOf(x.id);
      return { value: x.id, label: at && at.id !== op.id ? `${x.name} (Operatory ${at.slot + 1})` : x.name };
    }),
  ];
  const hygSelect = select(hygOpts, op.staffId ?? '', (v) => act(() => sim.assignHygienist(store.state, idx, op.id, v || null), { sound: 'ui_click' }), 'Hygienist');
  const asOpts = [{ value: '', label: 'Nobody' }, ...assistants.map((x) => {
    const at = opOf(x.id);
    return { value: x.id, label: at && at.id !== op.id ? `${x.name} (Operatory ${at.slot + 1})` : x.name };
  })];
  const asSelect = select(asOpts, op.assistantId ?? '', (v) => act(() => sim.assignAssistant(store.state, idx, op.id, v || null), { sound: 'ui_click' }), 'Assistant');
  const staffNow = op.staffId === PLAYER_ID ? null : c.staff.find((x) => x.id === op.staffId) ?? null;
  const who = op.staffId === PLAYER_ID ? avatarPortrait(s.player.avatar, s.player.name, 48) : staffNow ? staffPortrait(staffNow, 48) : h('div.op-nobody', icon('user'));

  const patient = op.patientId ? c.patients.find((p) => p.id === op.patientId) ?? null : null;

  // chair
  const ci = CHAIR_ORDER.indexOf(op.chair);
  const next: ChairTier | undefined = CHAIR_ORDER[ci + 1];
  const chairDef = CHAIRS[op.chair];
  const chairRow = h('div.op-item',
    thumb(chairDef.model, 'chair', 72),
    h('div.grow', h('div.bold', chairDef.name), h('div.small.muted', chairDef.blurb)),
    next
      ? btn(`Upgrade`, { variant: 'sun', size: 'sm', sub: money(CHAIRS[next].price), disabled: !canAfford(CHAIRS[next].price), title: canAfford(CHAIRS[next].price) ? `Upgrade to ${CHAIRS[next].name}` : 'Not enough cash', onClick: () => act(() => sim.upgradeChair(store.state, idx, op.id, next), { success: `${CHAIRS[next].name} installed` }) })
      : chip('Top chair', 'mint', 'check'),
  );
  const upRows = (Object.keys(OP_UPGRADES) as OpUpgradeId[]).map((id) => {
    const u = OP_UPGRADES[id];
    const owned = op.upgrades.includes(id);
    return h('div.op-item',
      thumb(u.model, 'sparkle', 72, false),
      h('div.grow', h('div.bold', u.name), h('div.small.muted', u.blurb)),
      owned ? chip('Installed', 'mint', 'check') : btn('Buy', { variant: 'sun', size: 'sm', sub: money(u.price), disabled: !canAfford(u.price), title: canAfford(u.price) ? '' : 'Not enough cash', onClick: () => act(() => sim.buyOpUpgrade(store.state, idx, op.id, id), { success: `${u.name} installed` }) }),
    );
  });

  return h('div.op-panel',
    h('div.op-section',
      h('div.op-assign-row', who,
        h('div.grow.col.gap-6', h('span.label', 'Hygienist'), hygSelect),
      ),
      op.staffId === PLAYER_ID ? h('div.op-mode',
        h('span.label', 'Your chair'),
        seg([
          { value: 'hands', label: 'Hands on', icon: 'hand' },
          { value: 'auto', label: 'Autopilot', icon: 'auto' },
        ], op.playerMode, (v) => act(() => sim.setPlayerMode(store.state, idx, op.id, v), { sound: 'ui_click' }), 'seg-block'),
      ) : null,
      h('div.op-assign-row', h('div.op-nobody', icon('staff')), h('div.grow.col.gap-6', h('span.label', 'Assistant'), assistants.length ? asSelect : h('div.small.muted', 'No assistants on the team. Assistants make cleanings 20% faster.'))),
      !hygienists.length && op.staffId !== PLAYER_ID ? btn('Hire a hygienist', { variant: 'soft', size: 'sm', icon: 'userPlus', onClick: () => go('staff') }) : null,
    ),
    h('div.op-section', h('span.label', 'In the chair'), patientRow(patient, op.staffId ? 'Free' : 'Nobody is assigned')),
    h('div.op-section', h('span.label', 'Chair'), chairRow),
    h('div.op-section', h('span.label', 'Upgrades'), ...upRows),
  );
}

function employeeOp(c: Clinic, op: Operatory): HTMLElement {
  const s = store.state;
  const patient = op.patientId ? c.patients.find((p) => p.id === op.patientId) ?? null : null;
  if (op.staffId === PLAYER_ID) {
    const mine = c.patients.filter((p) => p.isPlayerPatient).sort((a, b) => a.apptMin - b.apptMin);
    const done = mine.filter((p) => p.state === 'gone' || p.state === 'toDesk' || p.state === 'checkout' || p.state === 'exiting').length;
    return h('div.op-panel',
      h('div.op-section',
        h('div.op-assign-row', avatarPortrait(s.player.avatar, s.player.name, 48), h('div.grow', h('div.bold', 'Your chair'), h('div.small.muted', `${done} of ${mine.length} patients seen today`))),
      ),
      h('div.op-section', h('span.label', 'In the chair'), patientRow(patient, 'Free')),
      h('div.op-section', h('span.label', 'Today'),
        ...(mine.length ? mine.map((p) => h('div.op-sched', h('span.num', clock(p.apptMin)), h('span.grow', p.name), chip(PATIENT_STATE[p.state], p.state === 'gone' ? 'mint' : ''))) : [h('div.small.muted', 'No patients booked')]),
      ),
    );
  }
  const colleague = c.staff.find((x) => x.id === op.staffId) ?? null;
  return h('div.op-panel',
    h('div.op-section',
      h('div.op-assign-row', colleague ? staffPortrait(colleague, 48) : h('div.op-nobody', icon('user')),
        h('div.grow', h('div.bold', colleague?.name ?? 'Empty'), h('div.small.muted', colleague ? 'Colleague at Bright Smiles Dental' : 'Nobody works here today'))),
    ),
    h('div.op-section', h('span.label', 'In the chair'), patientRow(patient, 'Free')),
  );
}

/** Empty slot in an owned office: offer an operatory. */
export function openAddOperatory(slot: number): void {
  if (!store.loaded || !isOwner()) return;
  const c = activeClinic();
  if (!c || !c.ownedByPlayer) return;
  const idx = activeIndex();
  const slots = OFFICES[c.tier].opSlots;
  const buy = btn('Add operatory', { variant: 'primary', icon: 'plus', sub: money(EXTRA_OP_PRICE), disabled: !canAfford(EXTRA_OP_PRICE), title: canAfford(EXTRA_OP_PRICE) ? '' : 'Not enough cash' });
  const m = openModal({
    icon: 'plus',
    eyebrow: c.name,
    title: 'Add an operatory',
    body: h('div.col.gap-14',
      h('div.op-item', thumb('chair_basic', 'chair', 84), h('div.grow', h('div.bold', `Operatory ${slot + 1}`), h('div.small.muted', 'Comes with a Standard Chair. Assign a hygienist to start cleaning.'))),
      h('div.row.row-between.small', h('span.muted', `${c.ops.length} of ${slots} slots used`), priceTag(EXTRA_OP_PRICE)),
      !canAfford(EXTRA_OP_PRICE) ? h('div.small.bad.bold', 'Not enough cash') : null,
    ),
    actions: [btn('Cancel', { variant: 'ghost', onClick: () => m.close() }), buy],
    size: 'sm',
    blocking: false,
  });
  buy.addEventListener('click', () => {
    if (buy.classList.contains('is-disabled')) return;
    if (act(() => sim.buyOperatory(store.state, idx), { success: 'Operatory added' })) m.close();
  });
}

export function openPatientCard(patientId: string): void {
  if (!store.loaded) return;
  const c = activeClinic();
  const p = c?.patients.find((x) => x.id === patientId);
  if (!p) return;
  const arch = ARCHETYPES[p.archetype];
  const d = dirtLabel(p.dirtLevel);
  const waitFrac = Math.min(1, p.waitedMin / Math.max(1, p.patience));
  openModal({
    size: 'sm',
    blocking: false,
    cls: 'modal-patient',
    hero: h('div.patient-hero', patientPortrait(p, moodFromPatient(p), 96, 'ring')),
    title: p.name,
    eyebrow: arch?.label ?? '',
    body: h('div.col.gap-14',
      h('p.muted', arch?.blurb ?? ''),
      h('div.row.row-wrap.gap-6',
        chip(PATIENT_STATE[p.state], 'teal'),
        chip(SERVICES[p.service].name, p.service === 'deep' ? 'grape' : ''),
        chip(`${d.label} gunk`, d.tone),
        p.walkIn ? chip('Walk-in', 'sky') : chip(`Booked ${clock(p.apptMin)}`, ''),
      ),
      p.addons.length ? h('div.small', h('span.bold', 'Add-ons: '), p.addons.map((a) => SERVICES[a].name).join(', ')) : null,
      p.state === 'waiting' ? h('div.col.gap-4', h('span.label', 'Patience'), h('div.bar', { class: waitFrac > 0.7 ? 'coral' : waitFrac > 0.4 ? 'sun' : '' }, h('i', { style: { width: `${(1 - waitFrac) * 100}%` } }))) : null,
      p.stars ? h('div.row.gap-6', stars(p.stars, 18), h('span.small.muted', 'Review')) : null,
    ),
  });
}

export function openDeskCard(): void {
  if (!store.loaded) return;
  const s = store.state;
  const c = activeClinic(s);
  if (!c) return;
  const recs = c.staff.filter((x) => x.role === 'receptionist');
  const waiting = c.patients.filter((p) => p.state === 'waiting').length;
  const checking = c.patients.filter((p) => p.state === 'checkin').length;
  const owner = isOwner(s) && c.ownedByPlayer;
  const m = openModal({
    icon: 'report',
    eyebrow: c.name,
    title: 'Front desk',
    size: 'sm',
    blocking: false,
    body: h('div.col.gap-14',
      recs.length
        ? h('div.col.gap-6', ...recs.map((r) => h('div.op-assign-row', staffPortrait(r, 44), h('div.grow', h('div.bold', r.name), h('div.small.muted', 'Receptionist')))))
        : h('div.small.muted', owner ? 'Nobody at the desk. Check-in takes 7 minutes instead of 3, and more patients skip their appointment.' : 'The front desk team checks patients in.'),
      h('div.row.gap-6.row-wrap', chip(`${waiting} waiting`, 'sun', 'user'), chip(`${checking} checking in`, 'teal', 'report')),
    ),
    actions: owner && !recs.length ? [btn('Hire a receptionist', { variant: 'primary', icon: 'userPlus', onClick: () => { m.close(); go('staff'); } })] : [],
  });
}
