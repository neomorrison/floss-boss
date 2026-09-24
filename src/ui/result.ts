// Clean Result modal: star count-up, cleanliness breakdown, comfort, time vs par, pay lines with coins
// flying to the cash counter, XP fill with a level-up burst, flavour line and "While you were cleaning".
import { money, pct } from '../core/format';
import type { ArchetypeId, CleanResult, HandsOnPayout, Phase, SimEvent } from '../core/types';
import { ARCHETYPES } from '../data/patients';
import * as sim from '../sim';
import { h } from './dom';
import { confetti, countUp, flyCoins, sfx, wait } from './fx';
import { cashDisplay } from './hud';
import { coin, icon } from './icons';
import { canalLine, patientLine } from './lines';
import { fmtSeconds, moodFromStars, noDash, summarizeEvents } from './logic';
import { openModal } from './modal';
import { bossPortrait, patientPortrait } from './portrait';
import { reducedMotion } from './settings';
import { attempt } from './safe';
import { bar, btn, chip, setBar } from './widgets';

export interface ResultOpts {
  patient: { name: string; archetype: ArchetypeId };
  patientId?: string;
  result: CleanResult;
  payout: HandsOnPayout;
  parSeconds: number;
  before: { level: number; xp: number; cash: number };
  after: { level: number; xp: number; cash: number };
  events: SimEvent[];
  phase: Phase;
  ownedClinicIds: string[];
  primaryLabel?: string;
  school?: boolean;
}

export function showCleanResult(o: ResultOpts): Promise<void> {
  const r = o.result;
  const walkout = r.quit === 'walkout';
  const starCount = Math.max(1, Math.min(5, Math.round(o.payout.stars || r.stars)));
  const mood = moodFromStars(starCount, walkout);

  // ---- hero
  const starEls = Array.from({ length: 5 }, () => h('span.result-star', icon('star')));
  const heroTitle = walkout ? 'Walked out' : r.perfect ? 'Sparkling Smile' : ['Rough one', 'Not bad', 'Nice clean', 'Great clean', 'Perfect shine'][starCount - 1];
  const hero = h('div.result-hero', { class: { 'is-walkout': walkout, 'is-perfect': r.perfect } },
    h('div.result-rays'),
    h('div.result-who',
      patientPortrait(o.patient, mood, 84, 'ring'),
      h('div',
        h('div.result-name', o.patient.name),
        h('div.row.gap-6.row-wrap', chip(ARCHETYPES[o.patient.archetype]?.label ?? o.patient.archetype, 'mint'), r.perfect ? chip('Perfect', 'sun', 'sparkle') : null, walkout ? chip('Walked out', 'coral', 'door') : null),
      ),
    ),
    h('div.result-stars', ...starEls),
    h('div.result-title', heroTitle),
    h('div.result-quality', `Quality ${pct(r.quality)}`),
  );

  // ---- breakdown
  const parts: [string, number, string][] = [
    ['Tartar', r.tartar, 'sun'], ['Plaque', r.plaque, 'sun'], ['Stain', r.stain, ''], ['Debris', r.debris, 'gum'], ['Polish', r.polish, 'sky'], ['Tidy', 1 - r.mess, 'teal'],
  ];
  const partBars: [HTMLElement, number][] = [];
  const breakdown = h('div.result-block',
    h('div.result-block-title', icon('sparkle'), 'Cleanliness'),
    ...parts.map(([label, v, tone]) => {
      const b = bar(0, tone, 'sm');
      partBars.push([b, v]);
      return h('div.stat-row', h('span', label), b, h('span.num', pct(Math.max(0, Math.min(1, v)))));
    }),
  );

  const underPar = r.seconds <= o.parSeconds;
  const comfortBar = bar(0, 'gum', 'sm');
  const facts = h('div.result-block',
    h('div.result-block-title', icon('heart'), 'Patient'),
    h('div.stat-row', h('span', 'Comfort'), comfortBar, h('span.num', String(Math.round(r.comfort)))),
    h('div.result-facts',
      fact('timer', 'Time', `${fmtSeconds(r.seconds)}`, o.parSeconds > 0 ? h('span', { class: underPar ? 'good' : 'faint' }, `par ${fmtSeconds(o.parSeconds)}`) : null),
      fact('tooth', 'Chunks', String(r.chunks), r.bestCombo > 1 ? h('span.faint', `best combo x${r.bestCombo}`) : null),
      fact('alert', 'Gum slips', String(r.gumHits), r.gags ? h('span.faint', `${r.gags} gag${r.gags === 1 ? '' : 's'}`) : null),
    ),
  );

  // ---- money
  const p = o.payout;
  const lines: [string, number][] = [];
  if (p.pay) lines.push([o.phase === 'owner' ? 'Fees' : 'Pay', p.pay]);
  if (p.tip) lines.push(['Tip', p.tip]);
  if (p.bonus) lines.push([o.school ? 'Signing bonus' : 'Bonus', p.bonus]);
  const total = p.pay + p.tip + p.bonus;
  const totalNum = h('span.num', money(0));
  const lineEls = lines.map(([label, amt]) => h('div.money-line', h('span', label), h('span.num', money(amt))));
  const moneyBlock = lines.length ? h('div.result-money',
    ...lineEls,
    h('div.money-total', h('span', 'Total'), h('span.row.gap-6', coin(), totalNum)),
  ) : null;

  // ---- xp
  const need0 = attempt(() => sim.xpToNext(o.before.level), 100);
  const need1 = attempt(() => sim.xpToNext(o.after.level), 100);
  const xpBar = bar(o.before.xp / Math.max(1, need0), 'xp', 'lg');
  const xpLabel = h('span.num', `Level ${o.before.level}`);
  const leveled = o.after.level > o.before.level;
  const xpBlock = h('div.result-xp', { class: { 'will-level': leveled } },
    h('div.row.row-between', h('span.row.gap-6.bold', icon('bolt'), `+${Math.round(p.xp)} XP`), xpLabel),
    xpBar,
  );

  // ---- flavour: a character line, then the sim's notes (bonuses, walkouts)
  const seed = `${o.patient.name}|${r.seconds}|${starCount}`;
  let who: string;
  let face: HTMLElement;
  let said: string;
  if (o.school) {
    who = o.patient.name;
    face = patientPortrait(o.patient, 'neutral', 52);
    said = starCount >= 4 ? '(Dennis stares proudly at the ceiling.)' : '(Dennis stares at the ceiling.)';
  } else if (o.phase === 'employee') {
    who = 'Dr. Ruth Canal';
    face = bossPortrait(52, '', walkout || starCount <= 2 ? 'neutral' : 'happy');
    said = canalLine(starCount, walkout, seed);
  } else {
    who = o.patient.name;
    face = patientPortrait(o.patient, mood, 52);
    said = patientLine(o.patient.archetype, starCount, walkout, seed);
  }
  const notes = p.lines.filter(Boolean).map(noDash);
  const flavourEl = h('div.result-flavour',
    h('div.speaker', face, h('div.grow', h('div.who', who), h('div.bubble', said))),
    notes.length ? h('div.result-notes', ...notes.map((t) => h('div.wyc-row.good', icon('sparkle'), h('span', t)))) : null,
  );

  // ---- while you were cleaning
  // only what happened elsewhere: drop the payment and review of the patient just cleaned
  const others = o.events.filter((e) => !(
    (e.type === 'paid' && o.patientId && e.patientId === o.patientId)
    || (e.type === 'review' && e.name === o.patient.name)
    || (e.type === 'cleaned' && o.patientId && e.patientId === o.patientId)));
  const sum = summarizeEvents(others, o.ownedClinicIds);
  const wyc: HTMLElement[] = [];
  if (sum.served) wyc.push(wycRow('user', `${sum.served} patient${sum.served === 1 ? '' : 's'} seen by ${o.phase === 'owner' ? 'your team' : 'your colleagues'}`));
  if (sum.revenue) wyc.push(wycRow('wallet', `${money(sum.revenue)} earned by the team`));
  if (sum.reviews) wyc.push(wycRow('star', `${sum.reviews} review${sum.reviews === 1 ? '' : 's'}, ${sum.reviewStars.toFixed(1)} average`));
  if (sum.walkouts) wyc.push(wycRow('door', `${sum.walkouts} walkout${sum.walkouts === 1 ? '' : 's'}`, 'bad'));
  sum.goals.forEach((g) => wyc.push(wycRow('goals', `Goal done: ${noDash(g)}`, 'good')));
  sum.achievements.forEach((a) => wyc.push(wycRow('medal', `Achievement: ${a}`, 'good')));
  sum.quits.forEach((n) => wyc.push(wycRow('door', `${n} quit`, 'bad')));
  const wycEl = wyc.length && !o.school ? h('div.result-block.result-wyc', h('div.result-block-title', icon('clock'), 'While you were cleaning'), ...wyc) : null;

  const done = btn(o.primaryLabel ?? 'Done', { variant: 'primary', size: 'lg', block: true, iconRight: 'arrowRight' });
  const m = openModal({
    hero,
    body: h('div.result-body',
      h('div.result-grid', breakdown, facts),
      moneyBlock,
      xpBlock,
      flavourEl,
      wycEl,
    ),
    actions: [done],
    size: 'lg',
    cls: 'modal-result',
    dismissable: false,
    closeButton: false,
  });
  const raise = !!cashDisplay.target();
  if (raise) document.documentElement.classList.add('hud-over-modal');
  cashDisplay.hold(o.before.cash);
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    cashDisplay.release();
  };
  done.addEventListener('click', () => { finish(); m.close(); });
  m.closed.then(() => document.documentElement.classList.remove('hud-over-modal'));

  // ---- choreography
  (async () => {
    await wait(260);
    for (let i = 0; i < starCount; i++) {
      if (!m.open) return;
      starEls[i].classList.add('is-on');
      sfx('star', { rate: 0.9 + i * 0.09 });
      await wait(230);
    }
    if (starCount === 5 && !walkout) { sfx('perfect'); confetti(starEls[2], 70); }
    partBars.forEach(([b, v], i) => setTimeout(() => setBar(b, Math.max(0, Math.min(1, v))), reducedMotion() ? 0 : i * 70));
    setTimeout(() => setBar(comfortBar, r.comfort / 100), reducedMotion() ? 0 : 200);
    await wait(260);
    if (moneyBlock && total > 0) {
      await countUp(totalNum, 0, total, 700, (n) => money(Math.round(n)));
      const target = cashDisplay.target();
      if (target && m.open) {
        const nCoins = Math.max(3, Math.min(12, Math.round(total / 25)));
        const per = total / nCoins;
        let paid = 0;
        await flyCoins(totalNum, target, nCoins, (i, n) => {
          const amt = i === n - 1 ? total - paid : per;
          paid += amt;
          cashDisplay.add(amt);
          if (i % 2 === 0) sfx('coins', { volume: 0.6 });
        });
        sfx('cash');
      }
    }
    // xp
    if (leveled) {
      setBar(xpBar, 1);
      await wait(520);
      xpBlock.classList.add('is-burst');
      sfx('level_up');
      confetti(xpBar, 40);
      xpLabel.textContent = `Level ${o.after.level}`;
      const fill = xpBar.querySelector('i') as HTMLElement;
      fill.style.transition = 'none';
      setBar(xpBar, 0);
      void fill.offsetWidth;
      fill.style.transition = '';
      await wait(60);
    }
    setBar(xpBar, o.after.xp / Math.max(1, need1));
    await wait(700);
    finish();
  })().catch((e) => { console.error(e); finish(); });

  return m.closed.then(() => finish());
}

function fact(iconName: string, label: string, value: string, sub: HTMLElement | null): HTMLElement {
  return h('div.fact', h('div.fact-icon', icon(iconName)), h('div', h('div.fact-label', label), h('div.fact-value.num', value), sub ? h('div.fact-sub.tiny', sub) : null));
}

function wycRow(iconName: string, text: string, tone = ''): HTMLElement {
  return h('div.wyc-row', { class: tone }, icon(iconName), h('span', text));
}
