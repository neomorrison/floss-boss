// Clean Result modal (DESIGN 5.10): stars, the case checklist ticking through, a draggable before/after
// slider, the bonus star, whitening shade gain, case mastery (with a tier-up celebration), pay lines with
// coins flying to the cash counter (treasure gets its own burst), XP, a character line and
// "While you were cleaning".
import { money, pct } from '../core/format';
import type { ArchetypeId, BonusId, CaseSpecial, CaseType, CleanObjective, CleanResult, HandsOnPayout, Phase, SimEvent } from '../core/types';
import { CASES, MASTERY_NAMES, MASTERY_PERKS } from '../data/cases';
import { ARCHETYPES } from '../data/patients';
import * as sim from '../sim';
import { CASE_ICON, CASE_TONE, bonusText, caseOf, caseTile, tierMedal } from './casebits';
import { h } from './dom';
import { confetti, countUp, flyCoins, sfx, wait } from './fx';
import { cashDisplay } from './hud';
import { coin, icon } from './icons';
import { canalLine, patientLine } from './lines';
import { fmtSeconds, masteryInfo, moodFromStars, noDash, shadeColor, summarizeEvents } from './logic';
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
  /** From the CleanSetup: case, bonus and case extras (whitening shades). */
  caseType?: CaseType;
  bonus?: BonusId | null;
  special?: Partial<CaseSpecial>;
}

export function showCleanResult(o: ResultOpts): Promise<void> {
  const r = o.result;
  const p = o.payout;
  const walkout = r.quit === 'walkout';
  const ct = caseOf(r.caseType ?? o.caseType);
  const caseDef = CASES[ct];
  const starCount = Math.max(1, Math.min(5, Math.round(p.stars || r.stars)));
  const mood = moodFromStars(starCount, walkout);

  // ---- hero
  const starEls = Array.from({ length: 5 }, () => h('span.result-star', icon('star')));
  const heroTitle = walkout ? 'Walked out' : r.perfect ? 'Sparkling Smile' : ['Rough one', 'Not bad', 'Nice clean', 'Great clean', 'Perfect shine'][starCount - 1];
  const hero = h('div.result-hero', { class: { 'is-walkout': walkout, 'is-perfect': r.perfect && !walkout } },
    h('div.result-rays'),
    h('div.result-who',
      patientPortrait(o.patient, mood, 84, 'ring'),
      h('div',
        h('div.result-case', icon(CASE_ICON[ct]), caseDef.name),
        h('div.result-name', o.patient.name),
        h('div.row.gap-6.row-wrap',
          chip(ARCHETYPES[o.patient.archetype]?.label ?? o.patient.archetype, 'mint'),
          r.perfect && !walkout ? chip('Perfect', 'sun', 'sparkle') : null,
          walkout ? chip('Walked out', 'coral', 'door') : null),
      ),
    ),
    h('div.result-stars', ...starEls),
    h('div.result-title', heroTitle),
    h('div.result-quality', walkout ? `Comfort ran out. Quality ${pct(r.quality)}` : `Quality ${pct(r.quality)}`),
  );

  // ---- before / after
  const ba = r.before && r.after ? beforeAfter(r.before, r.after) : null;

  // ---- checklist (falls back to the legacy cleanliness bars when the scene sent no objectives)
  const objs: CleanObjective[] = Array.isArray(r.objectives) ? r.objectives.filter((x) => x && typeof x.label === 'string') : [];
  const objRows: { row: HTMLElement; bar: HTMLElement; num: HTMLElement; v: number; done: boolean }[] = [];
  const doneCount = objs.filter((x) => x.done).length;
  let checklist: HTMLElement;
  if (objs.length) {
    checklist = h('div.result-block.result-objs',
      h('div.result-block-title', icon(CASE_ICON[ct]), 'Checklist', h('span.spacer'), h('span.obj-count.num', `${doneCount} of ${objs.length}`)),
      ...objs.map((ob) => {
        const v = clamp01(ob.done ? 1 : ob.progress);
        const b = bar(0, ob.done ? '' : 'sun', 'sm');
        const num = h('span.num', '0%');
        const row = h('div.obj-row', h('span.obj-check', icon('check')), h('span.obj-label', noDash(ob.label)), b, num);
        objRows.push({ row, bar: b, num, v, done: !!ob.done });
        return row;
      }),
    );
  } else {
    const parts: [string, number, string][] = [
      ['Tartar', r.tartar, 'sun'], ['Plaque', r.plaque, 'sun'], ['Stain', r.stain, ''], ['Debris', r.debris, 'gum'], ['Polish', r.polish, 'sky'], ['Tidy', 1 - r.mess, 'teal'],
    ];
    checklist = h('div.result-block.result-objs',
      h('div.result-block-title', icon('sparkle'), 'Cleanliness'),
      ...parts.map(([label, v, tone]) => {
        const b = bar(0, tone, 'sm');
        const num = h('span.num', pct(clamp01(v)));
        const row = h('div.obj-row.is-plain', h('span.obj-label', label), b, num);
        objRows.push({ row, bar: b, num, v: clamp01(v), done: false });
        return row;
      }),
    );
  }

  // ---- bonus
  const bonus = walkout || o.school ? '' : bonusText(o.bonus);
  // a met bonus starts grey and lights up in the choreography
  const bonusEl = bonus ? h('div.result-bonus', { class: { 'will-meet': r.bonusMet, 'is-missed': !r.bonusMet } },
    h('span.bonus-star', icon(r.bonusMet ? 'star' : 'starLine')),
    h('div.grow', h('div.tiny.bold.faint', 'Bonus'), h('div.bonus-text', bonus)),
    r.bonusMet ? h('span.bonus-chip', chip('Tips +25%', 'sun')) : chip('Missed', ''),
  ) : null;

  // ---- facts
  const underPar = r.seconds <= o.parSeconds;
  const facts = h('div.result-facts',
    fact('timer', 'Time', fmtSeconds(r.seconds), o.parSeconds > 0 ? h('span', { class: underPar ? 'good' : 'faint' }, `par ${fmtSeconds(o.parSeconds)}`) : null),
    fact('bolt', 'Best combo', r.bestCombo > 1 ? `x${r.bestCombo}` : '-', r.chunks ? h('span.faint', `${r.chunks} chunk${r.chunks === 1 ? '' : 's'}`) : null),
    fact('alert', 'Gum slips', String(r.gumHits), r.gags ? h('span.faint', `${r.gags} gag${r.gags === 1 ? '' : 's'}`) : null, r.gumHits === 0 ? 'good' : ''),
    fact('heart', 'Comfort', String(Math.round(r.comfort)), null, r.comfort < 30 ? 'bad' : ''),
  );

  // ---- whitening shade gain
  const shade = shadeBlock(r, o.special, ct);

  // ---- mastery
  const mastery = !walkout && p.mastery ? masteryBlock(p.mastery, starCount >= 3 && r.quit === 'done') : null;

  // ---- money
  const lines: [string, number, string][] = [];
  // perks in force are the tier held before this clean (DESIGN 5.9)
  const heldTier = p.mastery ? masteryInfo(Math.max(0, p.mastery.count - (starCount >= 3 && r.quit === 'done' ? 1 : 0))).tier : 0;
  const tipWhy = [r.bonusMet && bonus ? 'bonus +25%' : '', heldTier >= 3 ? 'Gold +20%' : ''].filter(Boolean);
  if (p.pay) lines.push([`${o.phase === 'owner' ? 'Fees' : 'Pay'}${heldTier >= 2 ? ' (Silver +10%)' : ''}`, p.pay, '']);
  if (p.tip) lines.push([tipWhy.length ? `Tip (${tipWhy.join(', ')})` : 'Tip', p.tip, '']);
  if (p.bonus) lines.push([o.school ? 'Signing bonus' : 'Bonus', p.bonus, '']);
  const treasure = Math.max(0, p.treasure ?? 0);
  const base = p.pay + p.tip + p.bonus;
  const total = base + treasure;
  const totalNum = h('span.num', money(0));
  const treasureLine = treasure > 0 ? h('div.money-line.is-treasure', h('span.row.gap-6', coin(), 'Doubloon found'), h('span.num', money(treasure))) : null;
  const moneyBlock = lines.length || treasureLine ? h('div.result-money',
    ...lines.map(([label, amt]) => h('div.money-line', h('span', label), h('span.num', money(amt)))),
    treasureLine,
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
  // the sim's notes, minus the ones this sheet already celebrates with its own block
  const shown: RegExp[] = [];
  if (mastery && p.mastery?.tierUp) shown.push(/^(bronze|silver|gold) mastery/i);
  if (bonusEl && r.bonusMet) shown.push(/^bonus met/i);
  if (treasure > 0) shown.push(/doubloon/i);
  if (r.perfect && !walkout) shown.push(/^sparkling smile/i);
  if (walkout) shown.push(/walked out\.?$/i);
  const notes = p.lines.filter(Boolean).map(noDash).filter((t) => !shown.some((re) => re.test(t)));
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
  const body = h('div.result-body', { class: `tone-${CASE_TONE[ct]}` },
    h('div.result-top', { class: { 'has-ba': !!ba } }, ba?.el ?? null, h('div.col.gap-14', checklist, bonusEl)),
    facts,
    shade?.el ?? null,
    mastery?.el ?? null,
    moneyBlock,
    xpBlock,
    flavourEl,
    wycEl,
  );
  const m = openModal({
    hero,
    body,
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
  m.closed.then(() => { document.documentElement.classList.remove('hud-over-modal'); ba?.stop(); });

  // follow the choreography down the sheet until the player scrolls or drags themselves
  let userScrolled = false;
  const scroller = m.body;
  const mark = () => { userScrolled = true; };
  scroller.addEventListener('wheel', mark, { passive: true });
  scroller.addEventListener('touchstart', mark, { passive: true });
  const follow = (el: HTMLElement | null | undefined) => {
    if (!el || userScrolled || !m.open) return;
    const top = el.offsetTop - scroller.offsetTop;
    const want = top + el.offsetHeight - scroller.clientHeight + 16;
    if (want > scroller.scrollTop) scroller.scrollTo({ top: want, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  // ---- choreography
  (async () => {
    await wait(260);
    ba?.intro();
    for (let i = 0; i < starCount; i++) {
      if (!m.open) return;
      starEls[i].classList.add('is-on');
      sfx('star', { rate: 0.9 + i * 0.09 });
      await wait(200);
    }
    if (starCount === 5 && !walkout) { sfx('perfect'); confetti(starEls[2], 70); }
    // checklist: fill each row, tick the finished ones with a rising check
    let ticks = 0;
    for (const row of objRows) {
      if (!m.open) return;
      setBar(row.bar, row.v);
      countUp(row.num, 0, row.v * 100, 360, (n) => `${Math.round(n)}%`);
      if (row.done) {
        await wait(150);
        row.row.classList.add('is-done');
        sfx('check', { rate: 1 + ticks * 0.07, volume: 0.8 });
        ticks++;
      } else await wait(110);
    }
    if (bonusEl && r.bonusMet) {
      await wait(160);
      bonusEl.classList.add('is-met', 'is-pop');
      sfx('star', { rate: 1.35 });
      confetti(bonusEl.querySelector('.bonus-star') ?? bonusEl, 28);
    }
    if (shade) { follow(shade.el); await shade.play(() => m.open); }
    await wait(200);
    if (mastery) { follow(mastery.el); await mastery.play(() => m.open); }
    if (moneyBlock && total > 0) {
      follow(moneyBlock);
      await countUp(totalNum, 0, total, 700, (n) => money(Math.round(n)));
      const target = cashDisplay.target();
      if (target && m.open && base > 0) {
        const nCoins = Math.max(3, Math.min(12, Math.round(base / 25)));
        let paid = 0;
        await flyCoins(totalNum, target, nCoins, (i, n) => {
          const amt = i === n - 1 ? base - paid : base / n;
          paid += amt;
          cashDisplay.add(amt);
          if (i % 2 === 0) sfx('coins', { volume: 0.6 });
        });
        sfx('cash');
      }
      if (target && m.open && treasureLine) {
        treasureLine.classList.add('is-pop');
        sfx('coin_clink');
        let paid = 0;
        await flyCoins(treasureLine, target, 6, (i, n) => {
          const amt = i === n - 1 ? treasure - paid : treasure / n;
          paid += amt;
          cashDisplay.add(amt);
          if (i % 2 === 1) sfx('coin_clink', { volume: 0.5, rate: 1.1 + i * 0.05 });
        });
      }
    }
    // xp
    follow(xpBlock);
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

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

function fact(iconName: string, label: string, value: string, sub: HTMLElement | null, tone = ''): HTMLElement {
  return h('div.fact', { class: tone }, h('div.fact-icon', icon(iconName)), h('div', h('div.fact-label', label), h('div.fact-value.num', value), sub ? h('div.fact-sub.tiny', sub) : null));
}

function wycRow(iconName: string, text: string, tone = ''): HTMLElement {
  return h('div.wyc-row', { class: tone }, icon(iconName), h('span', text));
}

// ---------------------------------------------------------------- before / after slider

/** Two snapshots stacked; drag the handle (pointer or touch) to wipe between them. */
export function beforeAfter(before: string, after: string): { el: HTMLElement; intro(): void; stop(): void } {
  const knob = h('div.ba-knob', icon('chevronLeft'), icon('chevronRight'));
  const handle = h('div.ba-handle', { role: 'slider', tabindex: 0, 'aria-label': 'Before and after', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 50 }, knob);
  const imgAfter = h('img.ba-img', { src: after, alt: 'After', draggable: false }) as HTMLImageElement;
  const imgBefore = h('img.ba-img.ba-before', { src: before, alt: 'Before', draggable: false }) as HTMLImageElement;
  const frame = h('div.ba-frame', imgAfter, imgBefore, h('span.ba-label.is-l', 'Before'), h('span.ba-label.is-r', 'After'), handle);
  const el = h('div.result-ba', frame, h('div.ba-hint.tiny.bold.faint', icon('hand'), 'Drag to compare'));
  let x = 1;
  let raf = 0;
  const set = (v: number) => {
    x = Math.max(0, Math.min(1, v));
    frame.style.setProperty('--x', `${(x * 100).toFixed(2)}%`);
    handle.setAttribute('aria-valuenow', String(Math.round(x * 100)));
  };
  set(1);
  imgAfter.addEventListener('load', () => {
    if (imgAfter.naturalWidth && imgAfter.naturalHeight) frame.style.aspectRatio = `${imgAfter.naturalWidth} / ${imgAfter.naturalHeight}`;
  });
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  let dragging = false;
  const fromEvent = (e: PointerEvent) => {
    const r = frame.getBoundingClientRect();
    set((e.clientX - r.left) / Math.max(1, r.width));
  };
  frame.addEventListener('pointerdown', (e) => {
    stop();
    dragging = true;
    frame.classList.add('is-dragging');
    try { frame.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    fromEvent(e);
  });
  frame.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  const end = () => { dragging = false; frame.classList.remove('is-dragging'); };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { stop(); set(x - 0.05); e.preventDefault(); }
    if (e.key === 'ArrowRight') { stop(); set(x + 0.05); e.preventDefault(); }
  });
  return {
    el,
    stop,
    /** Wipe from all-before to show the clean result, then settle in the middle. */
    intro() {
      if (reducedMotion()) { set(0.5); return; }
      const t0 = performance.now();
      const keys = [[0, 1], [900, 0.06], [1500, 0.5]] as const;
      const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const step = (now: number) => {
        const t = now - t0;
        let v: number = keys[keys.length - 1][1];
        for (let i = 1; i < keys.length; i++) {
          if (t <= keys[i][0]) {
            const [ta, va] = keys[i - 1];
            const [tb, vb] = keys[i];
            v = va + (vb - va) * ease((t - ta) / (tb - ta));
            break;
          }
        }
        set(v);
        raf = t < keys[keys.length - 1][0] ? requestAnimationFrame(step) : 0;
      };
      raf = requestAnimationFrame(step);
    },
  };
}

// ---------------------------------------------------------------- whitening

function shadeBlock(r: CleanResult, special: Partial<CaseSpecial> | undefined, ct: CaseType): { el: HTMLElement; play(open: () => boolean): Promise<void> } | null {
  const gain = Math.max(0, Math.round(r.shadeGain || 0));
  if (ct !== 'whitening' && gain <= 0) return null;
  const start = Math.round(special?.startShade || 0);
  const target = Math.round(special?.targetShade || 0);
  const title = h('div.result-block-title', icon('shade'), 'Whitening', h('span.spacer'), chip(gain ? `+${gain} shade${gain === 1 ? '' : 's'}` : 'No change', gain ? 'sky' : ''));
  if (start < 1 || start > 16) {
    return { el: h('div.result-block.result-shade', title), play: async () => { /* no strip without a start shade */ } };
  }
  const end = Math.max(1, start - gain);
  // darkest on the left, brightest on the right: brightening moves the marker right
  const order = Array.from({ length: 16 }, (_, i) => 16 - i);
  const sw = order.map((n) => h('span.shade-sw', { class: { 'is-target': n === target, 'is-start': n === start }, style: { background: shadeColor(n) }, title: `Shade ${n}` }));
  const marker = h('span.shade-marker', icon('arrowDown'));
  const strip = h('div.shade-strip', ...sw, marker);
  const pos = (n: number) => `${((order.indexOf(n) + 0.5) / 16) * 100}%`;
  marker.style.left = pos(start);
  const nowLabel = h('b.num', `Shade ${start}`);
  const el = h('div.result-block.result-shade', title, strip,
    h('div.shade-legend.small', h('span.muted', `Started at shade ${start}`), nowLabel, target ? h('span.muted', `Goal ${target}`) : null),
  );
  return {
    el,
    async play(open) {
      for (let n = start - 1; n >= end; n--) {
        if (!open()) return;
        await wait(130);
        marker.style.left = pos(n);
        nowLabel.textContent = `Shade ${n}`;
        sfx('shade_tick', { rate: 0.9 + (start - n) * 0.06, volume: 0.7 });
      }
      if (gain > 0 && open()) { marker.classList.add('is-done'); nowLabel.classList.add('good'); }
    },
  };
}

// ---------------------------------------------------------------- mastery

function masteryBlock(ms: NonNullable<HandsOnPayout['mastery']>, counted: boolean): { el: HTMLElement; play(open: () => boolean): Promise<void> } {
  const ct = caseOf(ms.caseType);
  const now = masteryInfo(ms.count);
  const prevCount = counted ? Math.max(0, ms.count - 1) : ms.count;
  const prev = masteryInfo(prevCount);
  const tierUp = !!ms.tierUp || now.tier > prev.tier;
  const medalHost = h('div.mastery-medal', tierMedal(prev.tier, 48));
  const tierLabel = h('div.mastery-tier', prev.tier ? `${prev.name} mastery` : 'Unranked');
  const countLabel = h('span.num.mastery-count', progressText(prev));
  const fill = bar(prev.frac, `tier-${Math.min(3, prev.tier + 1)}`, '');
  const perk = h('div.mastery-perk', icon('sparkle'), h('span', noDash(MASTERY_PERKS[now.tier])));
  const el = h('div.result-block.result-mastery', { class: { 'will-tierup': tierUp } },
    h('div.mastery-rays'),
    h('div.mastery-row',
      medalHost,
      h('div.grow',
        h('div.row.row-between', h('div.mastery-case', caseTile(ct, 22), CASES[ct].name), countLabel),
        tierLabel,
        fill,
      ),
    ),
    tierUp ? perk : h('div.mastery-note.tiny.bold.faint', counted
      ? (now.nextName && now.nextPerk ? `${now.nextName}: ${noDash(now.nextPerk)}` : 'Top tier')
      : '3 stars or more counts toward mastery'),
  );
  return {
    el,
    async play(open) {
      if (!counted) return;
      await wait(120);
      if (!tierUp) {
        setBar(fill, now.frac);
        countLabel.textContent = progressText(now);
        sfx('check', { rate: 1.2, volume: 0.6 });
        await wait(420);
        return;
      }
      setBar(fill, 1);
      countLabel.textContent = `${ms.count}/${prev.nextAt ?? ms.count}`;
      await wait(520);
      if (!open()) return;
      el.classList.add('is-tierup');
      medalHost.replaceChildren(tierMedal(now.tier, 48, 'is-new'));
      tierLabel.textContent = `${MASTERY_NAMES[now.tier]} mastery`;
      sfx('perfect');
      sfx('level_up', { rate: 1.12, volume: 0.7 });
      confetti(medalHost, 70);
      // restart the bar toward the next tier
      const f = fill.querySelector('i') as HTMLElement;
      f.style.transition = 'none';
      setBar(fill, 0);
      fill.className = `bar tier-${Math.min(3, now.tier + 1)}`;
      void f.offsetWidth;
      f.style.transition = '';
      await wait(80);
      setBar(fill, now.frac);
      countLabel.textContent = progressText(now);
      await wait(900);
    },
  };
}

function progressText(m: ReturnType<typeof masteryInfo>): string {
  return m.nextAt === null ? `${m.count}` : `${m.count}/${m.nextAt} to ${m.nextName}`;
}
