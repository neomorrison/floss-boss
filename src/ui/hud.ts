// Hub HUD: cash (animated), day and clock, speed, rating, level and XP, title. Numbers update per frame
// straight into the DOM; structure changes (phase, rating visibility) happen in sync().
import { store } from '../core/store';
import { clock, money, weekday } from '../core/format';
import type { Speed } from '../core/types';
import * as sim from '../sim';
import { h, replay } from './dom';
import { sfx } from './fx';
import { isOwner, playerTitle } from './game';
import { coin, icon } from './icons';
import { attempt } from './safe';
import { stars } from './widgets';

// ---------------------------------------------------------------- cash display (shared with result modals)
let displayed = NaN;
let held: number | null = null;
let cashEl: HTMLElement | null = null;
let cashPill: HTMLElement | null = null;

export const cashDisplay = {
  /** Freeze the counter at `value` (coins will release the difference). */
  hold(value: number): void { held = value; displayed = value; },
  add(delta: number): void {
    if (held === null) return;
    held += delta;
    if (cashPill) replay(cashPill, 'anim-bump');
  },
  release(): void { held = null; },
  target(): HTMLElement | null { return cashPill; },
  snap(): void { if (store.loaded) displayed = store.state.cash; },
};

export interface Hud {
  el: HTMLElement;
  frame(dt: number, paused: boolean): void;
  sync(): void;
  dispose(): void;
}

export function createHud(): Hud {
  const cashNum = h('span.hud-cash-num.num', '$0');
  const cash = h('div.hud-pill.hud-cash', { title: 'Cash' }, coin(), cashNum);
  cashEl = cashNum;
  cashPill = cash;

  const dayLabel = h('span.hud-day');
  const clockLabel = h('span.hud-clock.num');
  const speedWrap = h('div.hud-speed', { role: 'group', 'aria-label': 'Speed' });
  const speeds: { v: Speed; label: string; icon?: string; title: string }[] = [
    { v: 0, label: '', icon: 'pause', title: 'Pause' },
    { v: 1, label: '1x', title: 'Normal speed' },
    { v: 2, label: '2x', title: 'Double speed' },
    { v: 4, label: '4x', title: 'Fast' },
  ];
  const speedBtns = speeds.map((sp) => {
    const b = h('button.hud-speed-btn', { type: 'button', title: sp.title, 'aria-label': sp.title }, sp.icon ? icon(sp.icon) : sp.label) as HTMLButtonElement;
    b.addEventListener('click', () => setSpeed(sp.v));
    speedWrap.appendChild(b);
    return b;
  });
  const time = h('div.hud-pill.hud-time',
    h('div.hud-time-text', dayLabel, clockLabel),
    speedWrap,
  );

  const ratingNum = h('span.num');
  const ratingStars = h('span.hud-stars');
  const rating = h('div.hud-pill.hud-rating', { title: 'Rating' }, ratingStars, h('span.hud-star-one', icon('star')), ratingNum);

  const lvlNum = h('span.hud-lvl-num');
  const titleEl = h('span.hud-title.ellipsis');
  const xpFill = h('i');
  const xpText = h('span.hud-xp-text');
  const level = h('div.hud-pill.hud-level', { title: 'Level' },
    h('div.hud-lvl-badge', icon('bolt'), lvlNum),
    h('div.hud-lvl-body', h('div.row.gap-6', titleEl, xpText), h('div.bar.xp.bar-sm', xpFill)),
  );

  const el = h('div.hud',
    h('div.hud-left', cash, time),
    h('div.hud-right', rating, level),
  );

  let lastClock = '';
  let lastDay = '';
  let lastSpeed = -1;
  let lastRating = -1;
  let lastLevelKey = '';

  function setSpeed(v: Speed): void {
    if (!store.loaded) return;
    const s = store.state;
    if (s.speed === v) return;
    s.speed = v;
    sfx('ui_tab');
    store.commit();
  }

  function sync(): void {
    if (!store.loaded) return;
    const s = store.state;
    rating.style.display = isOwner(s) ? '' : 'none';
    time.classList.toggle('is-school', s.phase === 'school');
  }

  function frame(dt: number, paused: boolean): void {
    if (!store.loaded) return;
    const s = store.state;
    // cash
    const target = held ?? s.cash;
    if (!Number.isFinite(displayed)) displayed = target;
    const diff = target - displayed;
    if (Math.abs(diff) < 0.5) displayed = target;
    else displayed += diff * Math.min(1, dt * 7);
    const txt = money(Math.round(displayed));
    if (cashNum.textContent !== txt) cashNum.textContent = txt;
    cash.classList.toggle('is-neg', s.cash < 0);

    // day and clock
    const dk = `Day ${s.day} · ${weekday(s.day - 1)}`;
    if (dk !== lastDay) { dayLabel.textContent = dk; lastDay = dk; }
    const ck = s.dayOver ? 'Closed' : clock(s.minute);
    if (ck !== lastClock) { clockLabel.textContent = ck; lastClock = ck; }
    const sp = s.speed + (paused ? 10 : 0);
    if (sp !== lastSpeed) {
      lastSpeed = sp;
      speeds.forEach((o, i) => speedBtns[i].classList.toggle('is-on', o.v === s.speed));
      time.classList.toggle('is-paused', s.speed === 0 || paused);
    }

    // rating
    if (isOwner(s)) {
      const c = s.locations[Math.max(0, s.active)];
      const r = c ? Math.round(c.rating * 10) / 10 : 0;
      if (r !== lastRating) {
        lastRating = r;
        ratingNum.textContent = r.toFixed(1);
        ratingStars.replaceChildren(stars(r, 15));
      }
    }

    // level and xp
    const need = attempt(() => sim.xpToNext(s.player.level), 100);
    const key = `${s.player.level}|${Math.round(s.player.xp)}|${need}`;
    if (key !== lastLevelKey) {
      const prevLevel = Number(lastLevelKey.split('|')[0]) || s.player.level;
      lastLevelKey = key;
      lvlNum.textContent = String(s.player.level);
      xpFill.style.width = `${Math.max(0, Math.min(1, s.player.xp / Math.max(1, need))) * 100}%`;
      xpText.textContent = `${Math.round(s.player.xp)}/${need} XP`;
      titleEl.textContent = playerTitle(s);
      if (s.player.level > prevLevel) replay(level, 'anim-bump');
    }
  }

  sync();
  return {
    el,
    frame,
    sync,
    dispose() { if (cashEl === cashNum) { cashEl = null; cashPill = null; } },
  };
}
