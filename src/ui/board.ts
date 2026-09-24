// 2D office board: shown when the 3D clinic view cannot start (no WebGL). Operatory tiles with
// staff and patient, a waiting room strip, and "Add operatory" slots for owners.
import { store } from '../core/store';
import type { Clinic, DayPatient } from '../core/types';
import { OFFICES } from '../data/offices';
import { CHAIRS } from '../data/upgrades';
import { h } from './dom';
import { activeClinic, isOwner } from './game';
import { icon } from './icons';
import { moodFromPatient } from './logic';
import { patientPortrait, staffPortrait, avatarPortrait } from './portrait';

export interface Board { el: HTMLElement; frame(dt: number): void; sync(): void }

const STATE_LABEL: Partial<Record<DayPatient['state'], string>> = {
  toChair: 'Walking in', inChair: 'Cleaning', waiting: 'Waiting', checkin: 'Checking in', entering: 'Arriving',
};

export function createBoard(hd: { onOp(id: string): void; onEmpty(slot: number): void; onPatient(id: string): void }): Board {
  const opsEl = h('div.board-ops');
  const waitEl = h('div.board-wait');
  const nameEl = h('div.board-name');
  const el = h('div.hub-board', { style: { display: 'none' } },
    h('div.board-inner',
      h('div.board-head', icon('clinic'), nameEl),
      opsEl,
      h('div.board-room', h('div.eyebrow', 'Waiting room'), waitEl),
    ),
  );
  let key = '';
  let t = 0;

  function sync(): void {
    if (!store.loaded || el.style.display === 'none') return;
    const s = store.state;
    const c = activeClinic(s);
    if (!c) { opsEl.replaceChildren(); return; }
    const k = keyOf(c);
    if (k === key) return;
    key = k;
    nameEl.textContent = c.name;
    const slots = OFFICES[c.tier]?.opSlots ?? c.ops.length;
    const tiles: HTMLElement[] = [];
    for (let slot = 0; slot < slots; slot++) {
      const op = c.ops.find((o) => o.slot === slot);
      if (!op) {
        if (isOwner(s) && c.ownedByPlayer) {
          const b = h('button.board-op.is-empty', { type: 'button' }, icon('plus'), h('span', 'Add operatory'));
          b.addEventListener('click', () => hd.onEmpty(slot));
          tiles.push(b);
        } else tiles.push(h('div.board-op.is-void'));
        continue;
      }
      const staff = op.staffId === 'player' ? null : c.staff.find((x) => x.id === op.staffId) ?? null;
      const patient = op.patientId ? c.patients.find((p) => p.id === op.patientId) ?? null : null;
      const who = op.staffId === 'player'
        ? avatarPortrait(s.player.avatar, s.player.name, 40)
        : staff ? staffPortrait(staff, 40) : h('div.board-nobody', icon('user'));
      const tile = h('button.board-op', { type: 'button', class: { 'is-yours': op.staffId === 'player', 'is-busy': !!patient } },
        h('div.board-op-top', h('span.board-op-name', `Operatory ${slot + 1}`), h('span.chip', icon('chair'), CHAIRS[op.chair]?.name.replace(/ Chair$/, '') ?? op.chair)),
        h('div.board-op-mid',
          who,
          h('div.board-op-arrow', icon('arrowRight')),
          patient ? patientPortrait(patient, moodFromPatient(patient), 40) : h('div.board-empty-chair', icon('chair')),
        ),
        h('div.board-op-foot.small', patient ? `${patient.name}  ·  ${patient.awaitingPlayer ? 'Waiting for you' : STATE_LABEL[patient.state] ?? ''}` : op.staffId ? 'Free' : 'Unstaffed'),
      );
      tile.addEventListener('click', () => hd.onOp(op.id));
      tiles.push(tile);
    }
    opsEl.replaceChildren(...tiles);
    const waiting = c.patients.filter((p) => p.state === 'waiting' || p.state === 'checkin' || p.state === 'entering');
    waitEl.replaceChildren(...(waiting.length ? waiting.map((p) => {
      const b = h('button.board-waiter', { type: 'button', title: p.name }, patientPortrait(p, moodFromPatient(p), 44), h('span.tiny.ellipsis', p.name.split(' ')[0]));
      b.addEventListener('click', () => hd.onPatient(p.id));
      return b;
    }) : [h('span.small.faint', 'Nobody waiting')]));
  }

  return {
    el,
    frame(dt) { t += dt; if (t > 0.4) { t = 0; sync(); } },
    sync,
  };
}

function keyOf(c: Clinic): string {
  return c.id + '|' + c.ops.map((o) => `${o.id}:${o.staffId}:${o.patientId}:${o.chair}`).join(',') + '|' +
    c.patients.filter((p) => p.state !== 'gone' && p.state !== 'scheduled' && p.state !== 'noshow').map((p) => `${p.id}:${p.state}:${p.awaitingPlayer}:${p.mood}`).join(',');
}
