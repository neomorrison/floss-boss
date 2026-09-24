// Office (owner): operatories and slots, chairs, op upgrades, equipment, move up, new location.
import { EXTRA_OP_PRICE, LOAN_DAILY_PAYMENT, LOAN_DAILY_RATE, MAX_LOCATIONS, PLAYER_ID } from '../../core/constants';
import { money } from '../../core/format';
import { store } from '../../core/store';
import type { EquipId, OfficeTierId } from '../../core/types';
import { OFFICES, TIER_ORDER } from '../../data/offices';
import { CHAIRS, EQUIPMENT, EQUIP_ORDER, OP_UPGRADES } from '../../data/upgrades';
import * as sim from '../../sim';
import { h } from '../dom';
import { confetti } from '../fx';
import { act, activeIndex, canAfford } from '../game';
import { icon } from '../icons';
import { select } from '../live';
import type { PanelCtx, PanelInst } from '../panelhost';
import { attempt } from '../safe';
import { officeArt } from '../art';
import * as mgr from '../mgr';
import { equipmentByTier } from '../mgrlogic';
import { btn, chip, priceTag, sectionTitle, seg, slider, thumb } from '../widgets';

/** Icons for equipment without a rendered thumbnail yet. */
export const EQUIP_ICON: Record<EquipId, string> = {
  deepCert: 'medal', espresso: 'clock', waterFilter: 'drop', aromatherapy: 'sparkle', kidsCorner: 'balloon', staffLockers: 'lock',
  fishTank: 'droplet', loyaltyProgram: 'tag', sterilizer: 'shield', onlineBooking: 'calendar', ultrasonicKits: 'scaler', xray: 'eye',
  breakRoom: 'heart', soundMasking: 'volume', digitalXray: 'eye', patientApp: 'bell', nitrousSystem: 'smile',
  rooftopGarden: 'sun', laserWhitening: 'caseWhitening', spaLounge: 'heart', cadcam: 'box',
  aiScheduler: 'calendar', researchWing: 'graduation', smileStudio: 'star', helipad: 'flag',
};
const CHAIN_WIDE: EquipId[] = ['researchWing', 'helipad'];

type MoveQuote = { price: number; tradeIn: number; net: number; maxLoan: number; ok: boolean; reason?: string };
type LocQuote = { price: number; maxLoan: number; ok: boolean; reason?: string };

export function locationPicker(onPick?: () => void): HTMLElement | null {
  const s = store.state;
  if (s.locations.length < 2) return null;
  return h('div.loc-pick', select(s.locations.map((l, i) => ({ value: String(i), label: l.name })), String(activeIndex(s)), (v) => {
    attempt(() => sim.setActive(store.state, Number(v)), undefined, 'setActive');
    store.commit();
    onPick?.();
  }, 'Location'));
}

function loanFacts(loan: number): string {
  return loan ? `${money(Math.round(loan * (LOAN_DAILY_RATE + LOAN_DAILY_PAYMENT)))}/day interest and payment` : 'No loan';
}

/** Loan picker: a slider when there is a choice, a fixed line when the bank offers one amount. */
export function loanField(min: number, max: number, value: number, onInput: (v: number) => void): HTMLElement | null {
  if (max <= 0) return null;
  const val = h('span.num', money(value));
  const facts = h('div.small.faint', loanFacts(value));
  if (max <= min) {
    return h('div.field', h('div.row.row-between', h('span.label', 'Bank loan'), val), h('div.small.faint', `The most the bank lends. ${loanFacts(max)}`));
  }
  const rng = slider({ min, max, step: 100, value, tone: 'sun', label: 'Bank loan', onInput: (v) => { onInput(v); val.textContent = money(v); facts.textContent = loanFacts(v); } });
  return h('div.field', h('div.row.row-between', h('span.label', 'Bank loan'), val), rng, facts);
}

export function officePanel(ctx: PanelCtx): PanelInst {
  let moveLoan = -1;
  let newTier: OfficeTierId = 't1';
  let newLoan = -1;
  let newName = '';
  return {
    title: 'Office',
    icon: 'office',
    key: () => {
      const s = store.state;
      const c = s.locations[activeIndex(s)];
      if (!c) return 'none';
      return JSON.stringify([s.active, s.day, s.loan, Math.floor(s.cash / 100), s.locations.length, c.tier, c.name, c.equipment, c.ops.map((o) => [o.id, o.chair, o.upgrades, o.staffId]), c.staff.map((x) => x.id), s.player.skills.length, EQUIP_ORDER.map((id) => mgr.equipmentPrice(s, activeIndex(s), id).price)]);
    },
    render() {
      const s = store.state;
      const idx = activeIndex(s);
      const c = s.locations[idx];
      if (!c) return h('div.empty', icon('office'), h('b', 'No practice yet'));
      const tier = OFFICES[c.tier];
      const slots = tier.opSlots;

      // ---- header
      const header = h('div.office-hero',
        officeArt(c.tier, 132),
        h('div.grow',
          h('div.eyebrow', tier.name),
          h('h3', c.name),
          h('div.small.muted', tier.blurb),
          h('div.row.row-wrap.gap-6', { style: 'margin-top:8px' },
            chip(`${c.ops.length} of ${slots} operatories`, 'teal', 'chair'),
            chip(`${tier.seats} seats`, '', 'user'),
            chip(`Rent ${money(tier.rent)}/day`, '', 'receipt'),
          ),
        ),
        locationPicker(),
      );

      // ---- operatories
      const opCards: HTMLElement[] = c.ops.slice().sort((a, b) => a.slot - b.slot).map((op) => {
        const who = op.staffId === PLAYER_ID ? 'You' : c.staff.find((x) => x.id === op.staffId)?.name ?? 'Unstaffed';
        const b = h('button.office-op', { type: 'button' },
          thumb(CHAIRS[op.chair].model, 'chair', 64),
          h('div.grow',
            h('div.bold', `Operatory ${op.slot + 1}`),
            h('div.small.muted', `${CHAIRS[op.chair].name}  ·  ${who}`),
            op.upgrades.length ? h('div.row.row-wrap.gap-4', { style: 'margin-top:4px' }, ...op.upgrades.map((u) => chip(OP_UPGRADES[u].name, 'mint'))) : null,
          ),
          icon('chevronRight'),
        );
        b.addEventListener('click', () => ctx.openOp(op.id));
        return b;
      });
      if (c.ops.length < slots) {
        const afford = canAfford(EXTRA_OP_PRICE);
        opCards.push(h('div.office-op.is-add',
          h('div.office-add-icon', icon('plus')),
          h('div.grow', h('div.bold', 'Add operatory'), h('div.small.muted', `${slots - c.ops.length} empty slot${slots - c.ops.length === 1 ? '' : 's'}`)),
          btn('Add', { variant: 'sun', size: 'sm', sub: money(EXTRA_OP_PRICE), disabled: !afford, title: afford ? '' : 'Not enough cash', onClick: () => act(() => sim.buyOperatory(store.state, idx), { success: 'Operatory added' }) }),
        ));
      }

      // ---- equipment, grouped by the office tier that unlocks it
      const tierRank = (t: OfficeTierId) => TIER_ORDER.indexOf(t);
      const equipCard = (id: EquipId) => {
        const e = EQUIPMENT[id];
        const owned = c.equipment.includes(id);
        const locked = tierRank(c.tier) < tierRank(e.minTier);
        const p = mgr.equipmentPrice(s, idx, id);
        const afford = canAfford(p.price);
        const chain = CHAIN_WIDE.includes(id);
        return h('div.equip-card', { class: { 'is-owned': owned, 'is-locked': locked, 'is-sale': !owned && !locked && p.sale > 0 }, 'data-equip': id },
          p.sale > 0 && !owned && !locked ? h('span.equip-sale', `-${p.sale}%`) : null,
          thumb(e.model, EQUIP_ICON[id] ?? 'sparkle', 76, locked),
          h('div.equip-name', e.name),
          h('div.equip-blurb', e.blurb),
          chain ? h('div.equip-chain.tiny.bold', icon('building2'), 'Every location') : null,
          h('div.equip-action',
            owned ? chip('Installed', 'mint', 'check')
              : locked ? h('div.tool-lock.small', icon('lock'), `Needs ${OFFICES[e.minTier].name}`)
                : btn('Buy', {
                  variant: 'sun', size: 'sm', sub: p.sale > 0 ? `${money(p.price)}, was ${money(Math.round(p.base))}` : money(p.price), disabled: !afford, title: afford ? '' : 'Not enough cash',
                  onClick: () => act(() => sim.buyEquipment(store.state, idx, id), { success: `${e.name} installed` }),
                })),
        );
      };
      const owned = EQUIP_ORDER.filter((id) => c.equipment.includes(id)).length;
      const groups = equipmentByTier(EQUIP_ORDER, (id) => EQUIPMENT[id].minTier).map((g) => {
        const locked = tierRank(c.tier) < tierRank(g.tier);
        const have = g.ids.filter((id) => c.equipment.includes(id)).length;
        return h('div.equip-group', { class: { 'is-locked': locked } },
          h('div.equip-group-head',
            officeArt(g.tier, 44),
            h('div.grow', h('div.bold', OFFICES[g.tier].name), h('div.tiny.bold.faint', locked ? `Needs ${OFFICES[g.tier].name}` : `${have} of ${g.ids.length} installed`)),
            locked ? chip('Locked', '', 'lock') : null,
          ),
          h('div.grid.grid-auto-sm.equip-grid', ...g.ids.map(equipCard)),
        );
      });

      // ---- move up
      const nextTier = TIER_ORDER[tierRank(c.tier) + 1] as OfficeTierId | undefined;
      let moveBlock: HTMLElement;
      if (!nextTier) {
        moveBlock = h('div.card.card-soft.card-pad.center', icon('crown'), h('div.bold', 'This is the flagship tier'));
      } else {
        const nt = OFFICES[nextTier];
        const q = attempt(() => sim.moveQuote(s, idx, nextTier), null as MoveQuote | null, 'moveQuote');
        const need = q ? Math.max(0, q.net - s.cash) : 0;
        const maxL = q ? Math.max(0, Math.floor(q.maxLoan / 100) * 100) : 0;
        const minL = Math.min(maxL, Math.ceil(need / 100) * 100);
        if (moveLoan < minL || moveLoan > maxL) moveLoan = minL;
        const canMove = !!q && q.ok && s.cash + moveLoan >= q.net;
        moveBlock = h('div.move-card',
          h('div.move-to', officeArt(nextTier, 120),
            h('div.grow',
              h('div.eyebrow', 'Move up'),
              h('h3', nt.name),
              h('div.small.muted', nt.blurb),
              h('div.row.row-wrap.gap-6', { style: 'margin-top:8px' }, chip(`${nt.opSlots} operatories`, 'teal', 'chair'), chip(`${nt.seats} seats`, '', 'user'), chip(`Rent ${money(nt.rent)}/day`, '', 'receipt'), chip(`${nt.appeal}x appeal`, 'sun', 'sparkle')),
            ),
          ),
          q ? h('div.quote',
            h('div.money-line', h('span', 'Price'), h('span.num', money(q.price))),
            h('div.money-line', h('span', `Trade-in for ${tier.name}`), h('span.num.good', `-${money(q.tradeIn)}`)),
            h('div.money-total', h('span', 'You pay'), priceTag(q.net)),
          ) : h('div.small.muted', 'Quote not available yet'),
          q ? loanField(minL, maxL, moveLoan, (v) => { moveLoan = v; }) : null,
          q && !q.ok && q.reason ? h('div.small.bad.bold', q.reason) : null,
          btn(`Move to ${nt.name}`, {
            variant: 'primary', icon: 'arrowUp', block: true, disabled: !canMove, title: canMove ? '' : q?.reason ?? 'Not enough cash',
            onClick: () => { if (act(() => sim.moveOffice(store.state, idx, nextTier, moveLoan), { success: `Welcome to your ${nt.name}` })) { moveLoan = -1; confetti(undefined, 100); } },
          }),
        );
      }

      // ---- new location
      const lq = attempt(() => sim.locationQuote(s, newTier), null as LocQuote | null, 'locationQuote');
      const lMax = lq ? Math.max(0, Math.floor(lq.maxLoan / 100) * 100) : 0;
      const lMin = lq ? Math.min(lMax, Math.ceil(Math.max(0, lq.price - s.cash) / 100) * 100) : 0;
      if (newLoan < lMin || newLoan > lMax) newLoan = lMin;
      if (!newName) newName = `${s.player.name} Dental ${s.locations.length + 1}`;
      const nameIn = h('input.input', { type: 'text', maxLength: 28, value: newName, 'aria-label': 'Location name', 'data-focus-key': 'loc-name' }) as HTMLInputElement;
      nameIn.addEventListener('input', () => { newName = nameIn.value; });
      const full = s.locations.length >= MAX_LOCATIONS;
      const canOpen = !!lq && lq.ok && !full && s.cash + newLoan >= lq.price;
      const nt2 = OFFICES[newTier];
      const newBlock = h('div.move-card',
        h('div.row.row-between.row-wrap', h('div', h('div.eyebrow', `Location ${s.locations.length + 1} of ${MAX_LOCATIONS}`), h('h3', 'Open a new location')),
          seg(TIER_ORDER.map((t) => ({ value: t, label: t.toUpperCase(), title: OFFICES[t].name })), newTier, (v) => { newTier = v; newLoan = -1; ctx.rerender(); })),
        h('div.move-to', officeArt(newTier, 104), h('div.grow', h('div.bold', nt2.name), h('div.small.muted', nt2.blurb), h('div.row.row-wrap.gap-6', { style: 'margin-top:6px' }, chip(`${nt2.opSlots} operatories`, 'teal', 'chair'), chip(`Rent ${money(nt2.rent)}/day`, '', 'receipt'))), lq ? priceTag(lq.price) : null),
        h('div.field', h('label', 'Name'), nameIn),
        lq ? loanField(lMin, lMax, newLoan, (v) => { newLoan = v; }) : null,
        full ? h('div.small.bad.bold', 'You own the maximum number of locations') : lq && !lq.ok && lq.reason ? h('div.small.bad.bold', lq.reason) : null,
        btn('Open location', {
          variant: 'primary', icon: 'pin', block: true, disabled: !canOpen, title: canOpen ? '' : full ? 'You own the maximum number of locations' : lq?.reason ?? 'Not enough cash',
          onClick: () => {
            const name = nameIn.value.trim() || newName;
            if (act(() => sim.openLocation(store.state, newTier, name, newLoan), { success: `${name} is open` })) { newName = ''; newLoan = -1; confetti(undefined, 110); }
          },
        }),
      );

      return h('div.office-panel',
        header,
        sectionTitle('Operatories', 'chair'),
        h('div.grid.grid-auto-lg', ...opCards),
        sectionTitle('Equipment', 'sparkle', chip(`${owned} of ${EQUIP_ORDER.length}`, 'teal')),
        h('div.equip-groups', ...groups),
        sectionTitle('Grow', 'trendUp'),
        h('div.grow-grid', moveBlock, newBlock),
      );
    },
  };
}
