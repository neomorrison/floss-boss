// Day report: net, income and expense lines, per-location stats, reviews, goals, notes, "Next day".
import { money, signedMoney, weekday as weekdayName } from '../core/format';
import { store } from '../core/store';
import type { DayLine, DayReport, Review } from '../core/types';
import { h } from './dom';
import { countUp, music, sfx } from './fx';
import { icon } from './icons';
import { noDash, plural } from './logic';
import { openModal } from './modal';
import { patientPortrait } from './portrait';
import { btn, chip, stars } from './widgets';

export function showDayReport(report: DayReport): Promise<void> {
  const netEl = h('span.num', money(0));
  const positive = report.net >= 0;
  const hero = h('div.report-hero', { class: { 'is-loss': !positive } },
    h('div.report-cal', h('span', weekdayName(report.weekday)), h('b', String(report.day))),
    h('div.grow',
      h('div.eyebrow', 'Day report'),
      h('h2', `Day ${report.day} is a wrap`),
    ),
    h('div.report-net', h('span.tiny.bold', report.phase === 'owner' ? 'Net' : 'Earned'), h('div.report-net-num', icon(positive ? 'trendUp' : 'trendDown'), netEl)),
  );

  const locs = report.perLocation.map((l) => {
    const st = l.stats;
    const tile = (label: string, value: string | number, tone = '', ic?: string) => h('div.report-tile', { class: tone }, ic ? icon(ic) : null, h('b.num', String(value)), h('span', label));
    const delta = Math.round(l.ratingDelta * 100) / 100;
    return h('div.report-loc',
      h('div.row.row-between.row-wrap',
        h('div.report-loc-name', icon('pin'), l.name),
        h('div.row.gap-6', stars(l.rating, 16), h('span.num', l.rating.toFixed(1)), delta ? chip(`${delta > 0 ? '+' : ''}${delta.toFixed(2)}`, delta > 0 ? 'mint' : 'coral') : null),
      ),
      h('div.report-tiles',
        tile('Served', st.served, '', 'user'),
        tile('Turned away', st.turnedAway, st.turnedAway ? 'bad' : '', 'door'),
        tile('Walkouts', st.walkouts, st.walkouts ? 'bad' : '', 'alert'),
        tile('No-shows', st.noShows, '', 'calendar'),
        tile('Five stars', st.fiveStars, st.fiveStars ? 'good' : '', 'star'),
      ),
      st.turnedAway > 0 && report.phase === 'owner' ? h('div.report-note', icon('bulb'), `${plural(st.turnedAway, 'patient')} could not get an appointment. More operatories or hygienists would fit them in.`) : null,
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

  // reviews from the finished day
  const reviews: Review[] = [];
  if (store.loaded && report.phase === 'owner') {
    const ids = new Set(report.perLocation.map((l) => l.clinicId));
    for (const c of store.state.locations) if (ids.has(c.id)) reviews.push(...c.reviews.filter((r) => r.day === report.day));
  }
  reviews.sort((a, b) => b.stars * b.weight - a.stars * a.weight);
  const shownReviews = [...reviews.slice(0, 2), ...reviews.filter((r) => r.stars <= 2).slice(0, 1)].filter((r, i, arr) => arr.indexOf(r) === i).slice(0, 3);

  const next = btn('Next day', { variant: 'primary', size: 'lg', block: true, iconRight: 'arrowRight' });
  const m = openModal({
    hero,
    body: h('div.report-body',
      ...locs,
      h('div.report-money', { class: { 'is-single': !(report.expenses.length || report.phase === 'owner') } },
        lineList(report.phase === 'owner' ? 'Income' : 'Earnings', report.income, 'good'),
        report.expenses.length || report.phase === 'owner' ? lineList('Expenses', report.expenses, 'bad') : null),
      shownReviews.length ? h('div.report-section', h('div.report-lines-title', 'Reviews'), ...shownReviews.map((r) =>
        h('div.report-review', patientPortrait({ name: r.name, archetype: r.archetype }, r.stars >= 4 ? 'happy' : r.stars <= 2 ? 'pain' : 'neutral', 40),
          h('div.grow', h('div.row.gap-6', h('b.small', r.name), stars(r.stars, 13)), h('div.small.muted', `“${noDash(r.text)}”`))))) : null,
      report.goalsDone.length ? h('div.report-section', h('div.report-lines-title', 'Goals done'), h('div.row.row-wrap.gap-6', ...report.goalsDone.map((g) => chip(noDash(g), 'sun', 'goals')))) : null,
      report.notes.length ? h('div.report-section', h('div.report-lines-title', 'Notes'), ...report.notes.map((n) => h('div.report-note', icon('info'), noDash(n)))) : null,
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
  countUp(netEl, 0, report.net, 900, (n) => signedMoney(Math.round(n)));
  music('music_clinic');
  return m.closed;
}
