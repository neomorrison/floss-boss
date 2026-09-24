// Finance (owner): prices with live forecast hints, marketing, loan, 14-day net chart, valuation.
import { FLOSS_BOSS_VALUATION, LOAN_DAILY_PAYMENT, LOAN_DAILY_RATE } from '../../core/constants';
import { money, pct, signedMoney } from '../../core/format';
import { store } from '../../core/store';
import type { PriceKey } from '../../core/types';
import { MARKETING_LEVELS, OFFICES } from '../../data/offices';
import { PRICE_KEYS, PRICE_MAX, PRICE_MIN, PRICE_STEP, SERVICES } from '../../data/services';
import { EQUIPMENT, OP_UPGRADES } from '../../data/upgrades';
import * as sim from '../../sim';
import { h, svgEl } from '../dom';
import { act, activeIndex } from '../game';
import { icon } from '../icons';
import { avgNet, barChart, operatingNet } from '../logic';
import { locationPicker } from './office';
import type { PanelCtx, PanelInst } from '../panelhost';
import { attempt } from '../safe';
import { bar, btn, chip, sectionTitle, seg, slider } from '../widgets';

type Forecast = { demand: number; capacity: number; revenue: number; costs: number };

export function financePanel(ctx: PanelCtx): PanelInst {
  let takeAmt = 0;
  let repayAmt = 0;
  return {
    title: 'Finance',
    icon: 'finance',
    key: () => {
      const s = store.state;
      const c = s.locations[activeIndex(s)];
      if (!c) return 'none';
      return JSON.stringify([s.active, s.day, Math.round(s.cash / 10), s.loan, s.reports.length, c.prices, c.marketing, c.staff.length, c.equipment, c.ops.length]);
    },
    render() {
      const s = store.state;
      const idx = activeIndex(s);
      const c = s.locations[idx];
      if (!c) return h('div.empty', icon('finance'), h('b', 'No practice yet'));
      const val = attempt(() => sim.valuation(s), 0, 'valuation');
      const net7 = avgNet(s.reports.filter((r) => r.phase === 'owner'), 7);

      // ---- summary
      const summary = h('div.fin-summary',
        tile('wallet', 'Cash', money(s.cash), s.cash < 0 ? 'bad' : ''),
        tile('bank', 'Loan', money(s.loan), s.loan > 0 ? 'bad' : ''),
        tile('trendUp', 'Average net', `${signedMoney(Math.round(net7))}/day`, net7 >= 0 ? 'good' : 'bad'),
        tile('crown', 'Valuation', money(val), ''),
      );
      const bossProgress = h('div.fin-goal',
        h('div.row.row-between.small', h('span.bold', 'Floss Boss valuation'), h('span.num', `${money(val)} of ${money(FLOSS_BOSS_VALUATION)}`)),
        bar(val / FLOSS_BOSS_VALUATION, 'xp'),
      );

      // ---- forecast
      const fcEls = { demand: h('b.num'), capacity: h('b.num'), revenue: h('b.num'), costs: h('b.num') };
      const paintForecast = () => {
        const f = attempt(() => sim.forecast(store.state, idx), null as Forecast | null, 'forecast');
        fcEls.demand.textContent = f ? f.demand.toFixed(1) : '-';
        fcEls.capacity.textContent = f ? String(Math.round(f.capacity)) : '-';
        fcEls.revenue.textContent = f ? money(Math.round(f.revenue)) : '-';
        fcEls.costs.textContent = f ? money(Math.round(f.costs)) : '-';
        fcEls.demand.parentElement?.classList.toggle('is-over', !!f && f.demand > f.capacity + 0.5);
        return f;
      };
      const forecast = h('div.fin-forecast',
        h('div.fc-tile', icon('user'), fcEls.demand, h('span', 'Patients a day')),
        h('div.fc-tile', icon('chair'), fcEls.capacity, h('span', 'Chair capacity')),
        h('div.fc-tile', icon('trendUp'), fcEls.revenue, h('span', 'Revenue a day')),
        h('div.fc-tile', icon('receipt'), fcEls.costs, h('span', 'Costs a day')),
      );
      paintForecast();

      // ---- prices
      const hasDentist = c.staff.some((x) => x.role === 'dentist');
      const priceRows = PRICE_KEYS.map((key: PriceKey) => {
        const sv = SERVICES[key];
        let lock = '';
        if (sv.requiresEquip && !c.equipment.includes(sv.requiresEquip)) lock = `Needs ${EQUIPMENT[sv.requiresEquip].name}`;
        else if (sv.requiresOpUpgrade && !c.ops.some((o) => o.upgrades.includes(sv.requiresOpUpgrade!))) lock = `Needs a ${OP_UPGRADES[sv.requiresOpUpgrade].name}`;
        else if (sv.requiresDentist && !hasDentist) lock = 'Needs a dentist';
        const mult = c.prices[key] ?? 1;
        const feeEl = h('b.num', money(Math.round(sv.fee * mult)));
        const tag = h('span');
        const paintTag = (m: number) => {
          const t = m <= 0.9 ? ['Bargain', 'sky'] : m < 1.1 ? ['Market', 'mint'] : m < 1.25 ? ['Premium', 'sun'] : ['Pricey', 'coral'];
          tag.replaceChildren(chip(`${t[0]}  ${pct(m)}`, t[1] as 'sky'));
        };
        paintTag(mult);
        const rng = slider({
          min: PRICE_MIN, max: PRICE_MAX, step: PRICE_STEP, value: mult, label: `${sv.name} price`,
          onInput: (v) => {
            attempt(() => sim.setPrice(store.state, idx, key, v), undefined, 'setPrice');
            feeEl.textContent = money(Math.round(sv.fee * v));
            paintTag(v);
            paintForecast();
          },
          onChange: () => store.commit(),
        });
        return h('div.price-row', { class: { 'is-locked': !!lock } },
          h('div.price-name', h('div.bold', sv.name),
            lock
              ? h('div.price-lock', icon('lock'), lock)
              : h('div.tiny.faint', sv.addon ? `Add-on  ·  market ${money(sv.fee)}` : `Market ${money(sv.fee)}`)),
          h('div.price-slider', rng),
          h('div.price-fee', feeEl, lock ? null : tag),
        );
      });

      // ---- marketing
      const scale = OFFICES[c.tier].tierScale;
      const marketing = seg(MARKETING_LEVELS.map((m) => ({
        value: m.level,
        label: h('span.mk-opt', h('b', m.name), h('span.tiny', m.cost ? `${money(Math.round(m.cost * scale))}/day` : 'Free')),
        title: `Demand x${m.mult}`,
      })), c.marketing, (v) => {
        attempt(() => sim.setMarketing(store.state, idx, v as 0 | 1 | 2 | 3), undefined, 'setMarketing');
        store.commit();
        paintForecast();
      }, 'seg-block mk-seg');

      // ---- loan: the bank lends up to its limit minus what you already owe
      const limit = attempt(() => sim.maxLoan(s), 0, 'maxLoan');
      const maxL = Math.max(0, Math.floor((limit - s.loan) / 100) * 100);
      const maxRepay = Math.max(0, Math.floor(Math.min(s.cash, s.loan)));
      takeAmt = Math.min(takeAmt, maxL);
      repayAmt = Math.min(repayAmt || maxRepay, maxRepay);
      const takeVal = h('span.num', money(takeAmt));
      const takeBtn = btn('Take loan', {
        variant: 'sun', size: 'sm', icon: 'bank', disabled: maxL <= 0 || takeAmt <= 0, title: maxL <= 0 ? 'The bank will not lend more right now' : undefined,
        onClick: () => { if (takeAmt > 0 && act(() => sim.takeLoan(store.state, takeAmt), { sound: 'cash', success: `Borrowed ${money(takeAmt)}` })) takeAmt = 0; },
      });
      const repayVal = h('span.num', money(repayAmt));
      const loanCard = h('div.loan-card',
        h('div.loan-now',
          h('div', h('div.tiny.bold.faint', 'Owed'), h('div.loan-big.num', money(s.loan))),
          h('div.small.muted', s.loan > 0 ? `${money(Math.round(s.loan * LOAN_DAILY_RATE))} interest and ${money(Math.round(s.loan * LOAN_DAILY_PAYMENT))} payment each day` : 'No loan. Borrow up to 60% of your next purchase.'),
        ),
        h('div.loan-actions',
          h('div.field',
            h('div.row.row-between', h('span.label', 'Borrow'), takeVal),
            slider({ min: 0, max: Math.max(100, maxL), step: 100, value: takeAmt, disabled: maxL <= 0, label: 'Borrow', onInput: (v) => { takeAmt = v; takeVal.textContent = money(v); takeBtn.disabled = v <= 0; } }),
            takeBtn,
          ),
          h('div.field',
            h('div.row.row-between', h('span.label', 'Repay'), repayVal),
            slider({ min: 0, max: Math.max(1, maxRepay), step: 1, value: repayAmt, disabled: maxRepay <= 0, label: 'Repay', onInput: (v) => { repayAmt = v; repayVal.textContent = money(v); } }),
            btn('Repay', { variant: 'primary', size: 'sm', icon: 'check', disabled: maxRepay <= 0, title: maxRepay > 0 ? '' : s.loan > 0 ? 'Not enough cash' : 'No loan to repay', onClick: () => act(() => sim.repayLoan(store.state, repayAmt), { sound: 'cash', success: `Repaid ${money(repayAmt)}` }) }),
          ),
        ),
      );

      return h('div.finance-panel',
        h('div.row.row-between.row-wrap', h('div.small.muted', c.name), locationPicker()),
        summary,
        bossProgress,
        sectionTitle('Last 14 days', 'report', h('span.small.muted', 'Profit before purchases and loans')),
        chart(s.reports.slice(-14).map((r) => ({ day: r.day, net: operatingNet(r), invested: r.net - operatingNet(r) }))),
        sectionTitle('Forecast', 'calendar', h('span.small.muted', 'Tomorrow at these settings')),
        forecast,
        sectionTitle('Prices', 'receipt', h('span.small.muted', 'Higher prices mean fewer patients and tougher reviews')),
        h('div.price-list', ...priceRows),
        sectionTitle('Marketing', 'megaphone'),
        marketing,
        sectionTitle('Bank loan', 'bank'),
        loanCard,
      );
    },
  };
}

function tile(ic: string, label: string, value: string, tone: string): HTMLElement {
  return h('div.fin-tile', h('div.fin-tile-icon', icon(ic)), h('div', h('div.tiny.bold.faint', label), h('div.fin-tile-val.num', { class: tone }, value)));
}

function chart(data: { day: number; net: number; invested: number }[]): HTMLElement {
  const W = 640;
  const H = 190;
  if (!data.length) return h('div.fin-chart.is-empty', icon('report'), h('span', 'Your first day report will show here'));
  const g = barChart(data.map((d) => d.net), W, H, { t: 16, r: 10, b: 26, l: 10 }, 14);
  // days with purchases or loans get a small marker above the bar
  const bars = g.bars.map((b, i) => {
    const mark = Math.abs(data[i].invested) >= 1 ? `<circle class="fc-mark ${data[i].invested < 0 ? 'out' : 'in'}" cx="${(b.x + b.w / 2).toFixed(1)}" cy="${Math.max(6, Math.min(b.y, g.zeroY) - 7).toFixed(1)}" r="4"/>` : '';
    return `<g class="fc-bar ${b.positive ? 'pos' : 'neg'}" data-i="${i}"><rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" rx="5"/>${mark}<text x="${(b.x + b.w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${data[i].day}</text></g>`;
  }).join('');
  const svg = svgEl(`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Net per day"><line x1="0" x2="${W}" y1="${g.zeroY.toFixed(1)}" y2="${g.zeroY.toFixed(1)}" class="fc-zero"/>${bars}</svg>`);
  const cap = h('div.fin-chart-cap.small', h('span.muted', 'Tap a bar'), h('span.num', ''));
  const show = (i: number) => {
    const d = data[i];
    // purchases, loans and goal rewards move cash without being profit: show both when they differ
    const cash = Math.round(d.net + d.invested);
    cap.replaceChildren(
      h('span.muted', `Day ${d.day}`),
      h('span.row.gap-6',
        Math.round(d.invested) ? h('span.small.muted', `Cash ${signedMoney(cash)}, profit`) : h('span.small.muted', 'Profit'),
        h('span.num', { class: d.net >= 0 ? 'good' : 'bad' }, signedMoney(Math.round(d.net)))),
    );
    svg.querySelectorAll('.fc-bar').forEach((x, j) => x.classList.toggle('is-on', j === i));
  };
  svg.addEventListener('click', (e) => {
    const gEl = (e.target as Element).closest('.fc-bar');
    if (gEl) show(Number(gEl.getAttribute('data-i')));
  });
  svg.addEventListener('pointermove', (e) => {
    const gEl = (e.target as Element).closest('.fc-bar');
    if (gEl) show(Number(gEl.getAttribute('data-i')));
  });
  show(data.length - 1);
  return h('div.fin-chart', h('div.fin-chart-svg', svg), cap);
}
