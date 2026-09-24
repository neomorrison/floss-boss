// Day report: net, income and expense lines, per-location stats with the waitlist, events answered today,
// reviews, goals (auto-claimed ones too), what ends tomorrow, notes, "Next day". Employees see their own shift.
import { money, signedMoney, weekday as weekdayName } from '../core/format';
import { store } from '../core/store';
import type { ClinicDayStats, DayLine, DayReport, Review } from '../core/types';
import { CAMPAIGNS } from '../data/manager';
import { h } from './dom';
import { countUp, music, sfx } from './fx';
import { icon } from './icons';
import { noDash, operatingNet, plural } from './logic';
import { eventDef } from './mgr';
import { endingOn, type MyDay } from './mgrlogic';
import { openModal } from './modal';
import { patientPortrait } from './portrait';
import { btn, chip, stars } from './widgets';

type WaitStats = ClinicDayStats & { waitlist?: number };

export function showDayReport(report: DayReport, extra: { mine?: MyDay | null; autoClaimed?: string[] } = {}): Promise<void> {
  const netEl = h('span.num', money(0));
  // owners see the day's profit; purchases, loans and rewards show as the cash change beside it
  const owner = report.phase === 'owner';
  const headline = owner ? operatingNet(report) : report.net;
  const cashDiff = owner && Math.round(report.net) !== Math.round(headline);
  const positive = headline >= 0;
  const hero = h('div.report-hero', { class: { 'is-loss': !positive } },
    h('div.report-cal', h('span', weekdayName(report.weekday)), h('b', String(report.day))),
    h('div.grow',
      h('div.eyebrow', 'Day report'),
      h('h2', `Day ${report.day} is a wrap`),
    ),
    h('div.report-net', h('span.tiny.bold', owner ? 'Profit' : 'Earned'), h('div.report-net-num', icon(positive ? 'trendUp' : 'trendDown'), netEl),
      cashDiff ? h('span.report-cash.tiny.bold', `Cash ${signedMoney(Math.round(report.net))}`) : null),
  );

  const tile = (label: string, value: string | number, tone = '', ic?: string) => h('div.report-tile', { class: tone }, ic ? icon(ic) : null, h('b.num', String(value)), h('span', label));

  // ---- employee: your own shift first, the clinic as a footnote
  const mine = !owner ? extra.mine ?? null : null;
  const shift = mine ? h('div.report-loc.report-mine',
    h('div.row.row-between.row-wrap',
      h('div.report-loc-name', icon('hand'), 'Your shift'),
      mine.reviews ? h('div.row.gap-6', stars(mine.avgStars, 16), h('span.num', mine.avgStars.toFixed(1))) : null,
    ),
    h('div.report-tiles.is-four',
      tile('Patients', mine.seen, '', 'user'),
      tile('Five stars', mine.fiveStars, mine.fiveStars ? 'good' : '', 'star'),
      tile('Walkouts', mine.walkouts, mine.walkouts ? 'bad' : '', 'door'),
      tile('Avg stars', mine.reviews ? mine.avgStars.toFixed(1) : '-', '', 'starLine'),
    ),
  ) : null;

  const locs = report.perLocation.map((l) => {
    const st = l.stats as WaitStats;
    const delta = Math.round(l.ratingDelta * 100) / 100;
    if (!owner) {
      // the employer's day in one line: it is not your score
      return h('div.report-clinic-line.small.muted', icon('pin'),
        `${l.name} today: ${plural(st.served, 'patient')} served, rating ${l.rating.toFixed(1)}`);
    }
    const waitlist = st.waitlist ?? (l as { waitlist?: number }).waitlist;
    let waitNote: HTMLElement | null = null;
    const wl = typeof waitlist === 'number' ? waitlist : 0;
    if (wl > 0 || st.turnedAway > 0) {
      const parts: string[] = [];
      if (wl > 0) parts.push(`${plural(wl, 'patient')} on tomorrow's waitlist, booked first.`);
      else if (typeof waitlist !== 'number') parts.push(`${plural(st.turnedAway, 'patient')} could not get in today.`);
      if (typeof waitlist === 'number' && st.turnedAway > wl) parts.push(`${plural(st.turnedAway - wl, 'patient')} went elsewhere.`);
      waitNote = h('div.report-note', icon('calendar'), h('span', parts.join(' '), h('span.report-note-tip', ' More operatories or hygienists fit them in.')));
    }
    return h('div.report-loc',
      h('div.row.row-between.row-wrap',
        h('div.report-loc-name', icon('pin'), l.name),
        h('div.row.gap-6', stars(l.rating, 16), h('span.num', l.rating.toFixed(1)), delta ? chip(`${delta > 0 ? '+' : ''}${delta.toFixed(2)}`, delta > 0 ? 'mint' : 'coral') : null),
      ),
      h('div.report-tiles',
        tile('Served', st.served, '', 'user'),
        tile(typeof waitlist === 'number' ? 'Waitlist' : 'Turned away', typeof waitlist === 'number' ? waitlist : st.turnedAway, wl > 0 || st.turnedAway > 0 ? 'warn' : '', 'calendar'),
        tile('Walkouts', st.walkouts, st.walkouts ? 'bad' : '', 'door'),
        tile('No-shows', st.noShows, '', 'alert'),
        tile('Five stars', st.fiveStars, st.fiveStars ? 'good' : '', 'star'),
      ),
      waitNote,
    );
  });

  const lineList = (title: string, lines: DayLine[], tone: 'good' | 'bad') => {
    const total = lines.reduce((a, l) => a + l.amount, 0);
    return h('div.report-lines',
      h('div.report-lines-title', title),
      ...(lines.length ? lines.map((l) => h('div.money-line', h('span', noDash(l.label)), h('span.num', { class: tone }, money(Math.abs(l.amount))))) : [h('div.small.faint', 'None')]),
      h('div.money-total', h('span', 'Total'), h('span.num', { class: tone }, money(Math.abs(total)))),
    );
  };

  // ---- the finished day from the live state (reviews, events answered, what ends tomorrow)
  const reviews: Review[] = [];
  const events: { title: string; text: string; place: string }[] = [];
  const ending: string[] = [];
  if (store.loaded && owner) {
    const s = store.state;
    const ids = new Set(report.perLocation.map((l) => l.clinicId));
    const multi = s.locations.length > 1;
    for (const c of s.locations) if (ids.has(c.id)) reviews.push(...c.reviews.filter((r) => r.day === report.day));
    for (const e of s.eventLog ?? []) {
      if (e.day !== report.day) continue;
      const def = eventDef(e.eventId);
      const c = s.locations.find((x) => x.id === e.clinicId);
      events.push({ title: def?.title ?? 'Event', text: e.text, place: multi && c ? c.name : '' });
    }
    // closeDay already moved to tomorrow: modifiers whose last day is s.day end after tomorrow
    for (const c of s.locations) {
      const where = multi ? ` (${c.name})` : '';
      if (c.campaign && c.campaign.untilDay === s.day) ending.push(`${CAMPAIGNS[c.campaign.id]?.name ?? 'Campaign'}${where}`);
      for (const m of endingOn(c.modifiers, s.day)) if (!m.id.startsWith('campaign:') && !m.id.startsWith('focus:')) ending.push(`${m.label}${where}`);
    }
  }
  reviews.sort((a, b) => b.stars * b.weight - a.stars * a.weight);
  const shownReviews = [...reviews.slice(0, 2), ...reviews.filter((r) => r.stars <= 2).slice(0, 1)].filter((r, i, arr) => arr.indexOf(r) === i).slice(0, 3);

  // goals: Paperwork Pro claims finished goals at day close
  const autoField = (report as DayReport & { autoClaimed?: string[] }).autoClaimed ?? [];
  const autoNotes = report.notes.filter((n) => /^auto-?claimed/i.test(n)).map((n) => n.replace(/^auto-?claimed:?\s*/i, ''));
  const autoClaimed = [...(extra.autoClaimed ?? []), ...autoField, ...autoNotes.flatMap((n) => n.split(/;\s*/))].filter((g, i, a) => g && a.indexOf(g) === i);
  // the sim also writes events and the waitlist as notes: they have their own sections here
  const eventLines = events.map((e) => `${e.title}. ${e.text}`);
  const notes = report.notes.filter((n) => !/^auto-?claimed/i.test(n)
    && !(owner && (/turned away$/.test(n) || /on the waitlist/i.test(n)))
    && !eventLines.some((x) => n.endsWith(x)));
  const goalsDone = report.goalsDone.filter((g) => !autoClaimed.includes(g));

  const next = btn('Next day', { variant: 'primary', size: 'lg', block: true, iconRight: 'arrowRight' });
  const m = openModal({
    hero,
    body: h('div.report-body',
      shift,
      ...locs,
      h('div.report-money', { class: { 'is-single': !(report.expenses.length || owner) } },
        lineList(owner ? 'Income' : 'Earnings', report.income, 'good'),
        report.expenses.length || owner ? lineList('Expenses', report.expenses, 'bad') : null),
      events.length ? h('div.report-section', h('div.report-lines-title', 'Events today'), ...events.map((e) =>
        h('div.report-event', icon('bell'), h('div.grow', h('b.small', noDash(e.title)), e.place ? h('span.tiny.faint', `  ${e.place}`) : null, h('div.small.muted', noDash(e.text)))))) : null,
      shownReviews.length ? h('div.report-section', h('div.report-lines-title', 'Reviews'), ...shownReviews.map((r) =>
        h('div.report-review', patientPortrait({ name: r.name, archetype: r.archetype }, r.stars >= 4 ? 'happy' : r.stars <= 2 ? 'pain' : 'neutral', 40),
          h('div.grow', h('div.row.gap-6', h('b.small', r.name), stars(r.stars, 13)), h('div.small.muted', `“${noDash(r.text)}”`))))) : null,
      goalsDone.length ? h('div.report-section', h('div.report-lines-title', 'Goals done'), h('div.row.row-wrap.gap-6', ...goalsDone.map((g) => chip(noDash(g), 'sun', 'goals')))) : null,
      autoClaimed.length ? h('div.report-section', h('div.report-lines-title', 'Auto-claimed'), h('div.row.row-wrap.gap-6', ...autoClaimed.map((g) => chip(noDash(g), 'mint', 'check')))) : null,
      ending.length ? h('div.report-section', h('div.report-lines-title', 'Ending tomorrow'), h('div.row.row-wrap.gap-6', ...ending.map((x) => chip(noDash(x), 'sky', 'clock')))) : null,
      notes.length ? h('div.report-section', h('div.report-lines-title', 'Notes'), ...notes.map((n) => h('div.report-note', icon('info'), noDash(n)))) : null,
      h('div.report-foot-stats',
        h('span.chip.chip-sun', icon('bolt'), `+${Math.round(report.xpGained)} XP`),
        report.levelUps ? h('span.chip.chip-gum', icon('arrowUp'), plural(report.levelUps, 'level up')) : null,
        h('span.chip', icon('wallet'), `Cash ${money(report.cashAfter)}`),
      ),
    ),
    actions: [next],
    size: 'lg',
    cls: 'modal-report',
    dismissable: false,
    closeButton: false,
  });
  next.addEventListener('click', () => { sfx('ui_click'); m.close(); });
  countUp(netEl, 0, headline, 900, (n) => signedMoney(Math.round(n)));
  music('music_clinic');
  return m.closed;
}
