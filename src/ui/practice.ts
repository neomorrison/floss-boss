// Open-practice flow: the celebratory hub card when sim.practiceStatus is ok, then naming the
// practice and picking a loan. On success the hub switches to the new clinic.
import { LOAN_DAILY_PAYMENT, LOAN_DAILY_RATE } from '../core/constants';
import { money } from '../core/format';
import { store } from '../core/store';
import { OFFICES } from '../data/offices';
import * as sim from '../sim';
import { h } from './dom';
import { confetti, sfx } from './fx';
import { act } from './game';
import { icon } from './icons';
import { openModal } from './modal';
import { attempt } from './safe';
import { officeArt } from './art';
import { toast } from './toasts';
import { btn, priceTag, slider } from './widgets';

type Status = { ok: boolean; price: number; maxLoan: number; cashNeeded: number; reasons: string[] };

function status(): Status | null {
  if (!store.loaded) return null;
  return attempt(() => sim.practiceStatus(store.state), null as Status | null, 'practiceStatus');
}

export function createPracticeCard(): { el: HTMLElement; sync(): void } {
  const el = h('div.practice-card.card', { style: { display: 'none' } });
  let shown = false;
  function sync(): void {
    if (!store.loaded) return;
    const s = store.state;
    const st = s.phase === 'employee' ? status() : null;
    const show = !!st?.ok;
    if (show === shown) return;
    shown = show;
    el.style.display = show ? '' : 'none';
    if (!show || !st) return;
    el.replaceChildren(
      h('div.practice-burst'),
      h('div.practice-top',
        officeArt('t1', 92),
        h('div.grow',
          h('div.eyebrow', 'Ready when you are'),
          h('div.practice-title', 'Your own practice'),
          h('div.small.muted', `${OFFICES.t1.name}, ${money(st.price)}`),
        ),
      ),
      btn('Open practice', { variant: 'sun', icon: 'sparkle', block: true, onClick: () => openPracticeFlow() }),
    );
    el.classList.remove('anim-pop');
    void el.offsetWidth;
    el.classList.add('anim-pop');
    sfx('notify');
  }
  return { el, sync };
}

export function openPracticeFlow(): void {
  if (!store.loaded) return;
  const s = store.state;
  const st = status();
  if (!st) { sfx('error'); toast({ text: 'Not available yet', kind: 'bad' }); return; }
  const office = OFFICES.t1;
  const price = st.price || office.price;
  const minLoan = Math.max(0, Math.ceil((price - s.cash) / 100) * 100);
  const maxLoan = Math.max(minLoan, Math.floor(st.maxLoan / 100) * 100);
  let loan = minLoan;
  const nameInput = h('input.input', { type: 'text', maxLength: 28, value: `${s.player.name} Family Dental`, 'aria-label': 'Practice name', 'data-focus-key': 'practice-name' }) as HTMLInputElement;
  const loanVal = h('span.num');
  const cashAfter = h('span.num');
  const daily = h('span.num');
  const paint = () => {
    loanVal.textContent = money(loan);
    cashAfter.textContent = money(s.cash + loan - price);
    daily.textContent = loan ? `${money(Math.round(loan * (LOAN_DAILY_RATE + LOAN_DAILY_PAYMENT)))}/day` : 'None';
  };
  const range = slider({ min: minLoan, max: maxLoan, step: 100, value: loan, tone: 'sun', label: 'Loan', disabled: maxLoan <= minLoan, onInput: (v) => { loan = v; paint(); } });
  paint();

  const open = btn('Open practice', { variant: 'primary', size: 'lg', icon: 'sparkle', block: true });
  const m = openModal({
    hero: h('div.practice-hero', h('div.practice-hero-rays'), officeArt('t1', 190)),
    eyebrow: 'Your own practice',
    title: 'Open your practice',
    body: h('div.col.gap-14',
      h('div.field', h('label', 'Practice name'), nameInput),
      h('div.card-soft.card.practice-office',
        h('div.row.row-between', h('div.bold', office.name), priceTag(price)),
        h('div.small.muted', office.blurb),
        h('div.row.row-wrap.gap-6.small',
          h('span.chip', icon('chair'), `${office.opSlots} operatories`),
          h('span.chip', icon('user'), `${office.seats} seats`),
          h('span.chip', icon('receipt'), `Rent ${money(office.rent)}/day`),
        ),
      ),
      h('div.field',
        h('div.row.row-between', h('span.label', 'Bank loan'), loanVal),
        range,
        h('div.practice-loan-facts.small',
          h('div', h('span.faint', 'Cash after opening'), cashAfter),
          h('div', h('span.faint', 'Interest and payment'), daily),
        ),
      ),
    ),
    actions: [open],
    size: 'md',
    cls: 'modal-practice',
  });
  open.addEventListener('click', () => {
    const name = nameInput.value.trim().replace(/\s+/g, ' ') || `${s.player.name} Family Dental`;
    const ok = act(() => sim.openPractice(store.state, { name, loan }), { sound: 'purchase', success: '' });
    if (!ok) return;
    attempt(() => sim.setActive(store.state, 0), undefined);
    store.commit({ saveNow: true });
    m.close();
    sfx('level_up');
    confetti(undefined, 120);
    toast({ text: `Welcome to ${name}`, sub: 'Hire a hygienist on the Staff screen', kind: 'gold', icon: 'sparkle', ms: 5000 });
  });
}
