// Morning Huddle (DESIGN 10.1): owner mornings after "Next day". Today's schedule per location, the event
// cards drawn this morning, the daily focus, then "Open the doors". The clinic clock is paused while it is open.
import { money, signedMoney, weekday as weekdayName } from '../core/format';
import { store } from '../core/store';
import type { CaseType, Clinic, FocusId, GameState, PendingEvent } from '../core/types';
import { CAMPAIGNS } from '../data/manager';
import { OFFICES } from '../data/offices';
import { CASE_ORDER } from '../data/cases';
import { caseTile } from './casebits';
import { h, replay } from './dom';
import { confetti, sfx, wait } from './fx';
import { icon } from './icons';
import { courseState, noDash, plural } from './logic';
import * as mgr from './mgr';
import { activeModifiers, caseShort, daysLeftLabel, modifierSource, modifierSummary, toggleFocus } from './mgrlogic';
import { openModal, enqueue, modals } from './modal';
import { staffPortrait } from './portrait';
import { attempt } from './safe';
import { toast } from './toasts';
import { btn, chip, toggle } from './widgets';

export const FOCUS_ICON: Record<FocusId, string> = {
  steady: 'smile', speed: 'bolt', quality: 'sparkle', walkin: 'door', upsell: 'receipt', team: 'heart', training: 'graduation',
};

let open = false;
export function huddleOpen(): boolean {
  return open;
}

/** Show the huddle once nothing else is open (after the day report). */
let queued = false;
export function queueHuddle(): void {
  if (queued) return;
  queued = true;
  enqueue(() => {
    queued = false;
    if (!store.loaded || open) return;
    const s = store.state;
    if (s.phase !== 'owner') return;
    if (mgr.autoHuddle(s)) { autoRun(s); return; }
    if ((s.huddleDay ?? s.day) >= s.day) return;
    void showHuddle();
  });
}

let autoToastDay = -1;
/** Auto-huddle: keep the focus, answer events with the first choice, say what happened in toasts. */
export function autoRun(s: GameState): void {
  const pending = (s.pendingEvents ?? []).slice();
  const views = pending.map((pe) => mgr.eventView(s, pe));
  const outs = pending.length || (s.huddleDay ?? s.day) < s.day ? attempt(() => mgr.completeHuddle(s), [] as mgr.AutoOutcome[], 'completeHuddle') : [];
  store.commit();
  if (autoToastDay === s.day) return;
  autoToastDay = s.day;
  if (views.length) {
    views.forEach((v, i) => {
      const o = outs.find((x) => x.eventId === v.pe.eventId && x.clinicId === v.pe.clinicId);
      toast({ text: v.title, sub: noDash(o?.text ?? v.choices[0]?.label ?? ''), kind: o && !o.good ? 'bad' : 'info', icon: v.art, ms: 5200, key: `auto-ev-${i}` });
    });
    return;
  }
  // the sim answered them at day close: read today's log
  (s.eventLog ?? []).filter((e) => e.day === s.day).slice(-3).forEach((e, i) => {
    const def = mgr.eventDef(e.eventId);
    toast({ text: def?.title ?? 'Event', sub: noDash(e.text), kind: 'info', icon: def?.art ?? 'bell', ms: 5200, key: `auto-ev-${i}` });
  });
}

function onDuty(c: Clinic, day: number): { here: typeof c.staff; away: number } {
  const here = c.staff.filter((st) => courseState(st, day) !== 'away');
  return { here, away: c.staff.length - here.length };
}

function locationCard(s: GameState, c: Clinic, idx: number): HTMLElement {
  // no-shows are decided at booking, but nobody knows who they are yet: count every booking
  const patients = c.patients;
  const booked = Math.max(c.day?.booked ?? 0, patients.filter((p) => !p.walkIn).length);
  const f = mgr.outlook(s, idx);
  const counts = new Map<CaseType, number>();
  for (const p of patients) if (!p.walkIn) counts.set(p.caseType, (counts.get(p.caseType) ?? 0) + 1);
  const vip = patients.filter((p) => p.vip).length;
  const mix = CASE_ORDER.filter((ct) => counts.get(ct)).map((ct) =>
    h('span.huddle-case', { title: `${caseShort(ct)} ${plural(counts.get(ct)!, 'patient')}` }, caseTile(ct, 26), h('b.num', `${counts.get(ct)}`)));
  const duty = onDuty(c, s.day);
  const faces = duty.here.slice(0, 6).map((st) => staffPortrait(st, 34, 'huddle-face'));
  const running = c.campaign && c.campaign.untilDay >= s.day ? c.campaign : null;
  const mods = activeModifiers(c.modifiers, s.day).filter((m) => modifierSource(m) !== 'focus' && !(running && modifierSource(m) === 'campaign'));
  const cap = f ? Math.round(f.capacity) : 0;
  return h('div.huddle-loc',
    h('div.huddle-loc-head',
      h('div.grow', h('div.huddle-loc-name', icon('pin'), c.name), h('div.tiny.bold.faint', OFFICES[c.tier].name)),
      h('div.huddle-booked', h('b.num', String(booked)), h('span', cap ? `of ${cap} booked` : 'booked')),
    ),
    f && f.waitlist > 0 ? h('div.tiny.bold.huddle-wait', icon('calendar'), `${plural(f.waitlist, 'patient')} from the waitlist`) : null,
    mix.length ? h('div.huddle-mix', ...mix, vip ? chip(vip === 1 ? 'VIP' : `${vip} VIPs`, 'sun', 'star') : null) : h('div.small.muted', 'Nobody booked yet'),
    h('div.huddle-team',
      h('div.huddle-faces', ...faces, duty.here.length > 6 ? h('span.huddle-more', `+${duty.here.length - 6}`) : null),
      h('span.small.muted', duty.here.length ? `${duty.here.length} on duty${duty.away ? `, ${duty.away} training` : ''}` : 'Nobody on the team yet'),
    ),
    running || mods.length ? h('div.huddle-mods',
      running ? chip(`${CAMPAIGNS[running.id]?.name ?? 'Campaign'}: ${daysLeftLabel(running.untilDay, s.day).toLowerCase()}`, 'gum', 'megaphone') : null,
      ...mods.map((m) => { const el = chip(`${m.label}: ${daysLeftLabel(m.untilDay, s.day).toLowerCase()}`, 'sky', 'bolt'); el.title = modifierSummary(m); return el; }),
    ) : null,
  );
}

export function showHuddle(): Promise<void> {
  if (!store.loaded || open) return Promise.resolve();
  const s0 = store.state;
  open = true;
  sfx('huddle', { volume: 0.7 });

  // ---- focus
  const focusWrap = h('div.focus-grid');
  const focusHead = h('span.small.muted');
  const renderFocus = () => {
    const s = store.state;
    const { slots, options } = mgr.focusOptions(s);
    const cur = mgr.currentFocus(s).filter((id) => options.find((o) => o.id === id)?.ok).slice(0, slots);
    focusHead.textContent = slots > 1 ? 'Pick two' : 'Pick one';
    focusWrap.replaceChildren(...options.map((o) => {
      const on = cur.includes(o.id);
      const order = cur.indexOf(o.id);
      const b = h('button.focus-card', { type: 'button', class: { 'is-on': on, 'is-locked': !o.ok }, 'aria-pressed': String(on), 'data-focus': o.id },
        h('span.focus-icon', icon(o.ok ? FOCUS_ICON[o.id] ?? 'target' : 'lock')),
        h('span.focus-text', h('b', o.def.name), h('span', o.ok ? o.def.text : o.reason)),
        on && slots > 1 ? h('span.focus-order', String(order + 1)) : on ? h('span.focus-check', icon('check')) : null,
      );
      b.addEventListener('click', () => {
        if (!o.ok) { sfx('error'); toast({ text: o.reason, kind: 'bad', key: 'focus-lock' }); replay(b, 'anim-shake'); return; }
        const next = toggleFocus(cur, o.id, slots);
        const r = mgr.setFocus(store.state, next.length ? next : ['steady']);
        if (!r.ok) { sfx('error'); toast({ text: r.reason, kind: 'bad', key: 'focus' }); return; }
        sfx('ui_tab');
        store.commit();
        renderFocus();
      });
      return b;
    }));
  };
  renderFocus();

  // ---- events
  const pending = (s0.pendingEvents ?? []).slice();
  const cards = pending.map((pe, i) => eventCard(pe, i, pending.length));
  const eventsBlock = cards.length
    ? h('div.event-grid', ...cards)
    : h('div.huddle-quiet', icon('smile'), h('div', h('b', 'Quiet morning'), h('div.small.muted', 'Nothing needs you before the doors open.')));

  // ---- locations
  const locs = h('div.huddle-locs', ...s0.locations.map((c, i) => locationCard(s0, c, i)));

  // ---- footer
  const auto = h('div.huddle-auto', toggle(mgr.autoHuddle(s0), (v) => { mgr.setAutoHuddle(store.state, v); store.commit(); toast({ text: v ? 'Huddles skipped from tomorrow' : 'Huddles back on', sub: v ? 'The focus stays, events take the first choice' : undefined, kind: 'info', key: 'auto-huddle' }); }, 'Skip the huddle'),
    h('span', h('b.small', 'Skip huddles'), h('span.tiny.faint', 'Keep the focus, first choice on events')));
  const go = btn('Open the doors', { variant: 'primary', size: 'lg', icon: 'door', class: 'huddle-go' });
  const hero = h('div.huddle-hero',
    h('div.huddle-cal', h('span', weekdayName(((s0.day - 1) % 5 + 5) % 5)), h('b', String(s0.day))),
    h('div.grow', h('div.eyebrow', `Day ${s0.day}`), h('h2', 'Morning Huddle'), h('div.small.muted', pending.length ? `${plural(pending.length, 'thing')} came up this morning.` : 'Set the focus and open up.')),
    h('div.huddle-cash', h('span.tiny.bold.faint', 'Cash'), h('b.num', money(s0.cash))),
  );
  const unanswered = h('div.tiny.bold.faint.huddle-note');
  const paintNote = () => {
    const left = (store.state.pendingEvents ?? []).length;
    unanswered.textContent = left ? `${plural(left, 'event')} unanswered: the first choice is taken` : '';
  };
  paintNote();

  const m = openModal({
    hero,
    body: h('div.huddle-body',
      h('section.huddle-sec', h('div.huddle-sec-title', icon('calendar'), h('h3', 'Today'), h('span.small.muted', s0.locations.length > 1 ? `${s0.locations.length} locations` : '')), locs),
      h('section.huddle-sec', h('div.huddle-sec-title', icon('bell'), h('h3', 'This morning'), pending.length ? chip(String(pending.length), 'gum') : null), eventsBlock),
      h('section.huddle-sec', h('div.huddle-sec-title', icon('target'), h('h3', 'Daily focus'), focusHead), focusWrap),
    ),
    actions: [h('div.huddle-foot', auto, h('div.col.gap-4.huddle-go-wrap', go, unanswered))],
    size: 'xl',
    cls: 'modal-huddle',
    dismissable: false,
    closeButton: false,
  });

  // deal the cards in
  cards.forEach((el, i) => {
    el.style.setProperty('--deal', `${140 + i * 160}ms`);
    setTimeout(() => { if (m.open) sfx('event_card', { volume: 0.55 }); }, 180 + i * 160);
  });

  function eventCard(pe: PendingEvent, i: number, total: number): HTMLElement {
    const s = store.state;
    const v = mgr.eventView(s, pe);
    const multi = s.locations.length > 1;
    const choices = h('div.event-choices');
    const card = h('article.event-card', { 'data-event': pe.eventId, style: { '--i': i } },
      h('div.event-art', icon(v.art)),
      h('div.event-main',
        h('div.eyebrow', multi && v.clinic ? v.clinic.name : total > 1 ? `Event ${i + 1} of ${total}` : 'Event'),
        h('h4.event-title', noDash(v.title)),
        h('p.event-text', noDash(v.text)),
        choices,
      ),
    );
    v.choices.forEach((c, ci) => {
      const b = btn(noDash(c.label), { variant: ci === 0 ? 'primary' : 'ghost', size: 'sm', sub: c.hint ? noDash(c.hint) : undefined, class: 'event-choice', sound: null });
      b.addEventListener('click', () => choose(ci, b));
      choices.appendChild(b);
    });
    let done = false;
    async function choose(ci: number, b: HTMLElement): Promise<void> {
      if (done) return;
      const st = store.state;
      const cashBefore = st.cash;
      const ratingBefore = v.clinic?.rating ?? 0;
      const out = mgr.resolveEvent(st, pe, ci);
      if (!out.ok) { sfx('error'); toast({ text: out.text, kind: 'bad', key: 'event-fail' }); replay(b, 'anim-shake'); return; }
      done = true;
      sfx('ui_click');
      card.classList.add('is-flipping');
      choices.querySelectorAll('button').forEach((x) => { (x as HTMLButtonElement).disabled = true; });
      store.commit();
      await wait(260);
      const after = store.state;
      const dCash = Math.round(after.cash - cashBefore);
      const clinicNow = after.locations.find((x) => x.id === pe.clinicId);
      const dRating = clinicNow ? Math.round((clinicNow.rating - ratingBefore) * 100) / 100 : 0;
      sfx(out.tone === 'bad' ? 'event_bad' : 'event_good', { volume: 0.8 });
      card.classList.remove('is-flipping');
      card.classList.add('is-resolved', `tone-${out.tone}`);
      choices.replaceWith(h('div.event-outcome',
        h('div.event-picked', icon(out.tone === 'bad' ? 'alert' : 'check'), h('span', noDash(v.choices[ci]?.label ?? ''))),
        h('div.event-result', noDash(out.text)),
        dCash || dRating ? h('div.row.row-wrap.gap-6',
          dCash ? chip(signedMoney(dCash), dCash > 0 ? 'mint' : 'coral', 'wallet') : null,
          dRating ? chip(`Rating ${dRating > 0 ? '+' : ''}${dRating.toFixed(2)}`, dRating > 0 ? 'mint' : 'coral', 'star') : null,
        ) : null,
      ));
      if (out.tone === 'good') confetti(card, 18);
      paintNote();
    }
    return card;
  }

  return new Promise<void>((resolve) => {
    let finished = false;
    go.addEventListener('click', () => {
      if (finished) return;
      finished = true;
      const s = store.state;
      attempt(() => mgr.completeHuddle(s), undefined, 'completeHuddle');
      store.commit({ saveNow: true });
      sfx('ui_click');
      m.close();
    });
    m.closed.then(() => { open = false; resolve(); });
  });
}

/** Hub mount: a huddle left open (reload) or a fresh owner morning with events still waiting. */
export function resumeHuddleIfDue(): void {
  if (!store.loaded || open || modals.count) return;
  if (mgr.huddleDue(store.state)) queueHuddle();
}
