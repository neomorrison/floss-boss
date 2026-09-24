// Juice: UI sounds, music, haptics, count-ups, flying coins and confetti.
import { bus } from '../core/bus';
import type { MusicKey, SfxKey } from '../data/assets';
import { h } from './dom';
import { coinSvg } from './icons';
import { reducedMotion, settings } from './settings';

export function sfx(key: SfxKey, opts: { volume?: number; rate?: number } = {}): void {
  bus.emit('sfx', { key, ...opts });
}

let currentMusic: MusicKey | null | undefined;
export function music(key: MusicKey | null): void {
  if (key === currentMusic) return;
  currentMusic = key;
  bus.emit('music', { key });
}

export function haptic(ms = 8): void {
  if (!settings().haptics) return;
  try { (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(ms); } catch { /* unsupported */ }
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Animate a number in an element. Resolves when done. */
export function countUp(el: HTMLElement, from: number, to: number, ms: number, fmt: (n: number) => string, onStep?: (n: number) => void): Promise<void> {
  if (reducedMotion() || ms <= 0 || from === to) {
    el.textContent = fmt(to);
    onStep?.(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const v = from + (to - from) * easeOut(t);
      el.textContent = fmt(v);
      onStep?.(v);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, reducedMotion() ? Math.min(ms, 60) : ms));

function flyLayer(): HTMLElement {
  let layer = document.getElementById('fly-layer');
  if (!layer) {
    layer = h('div#fly-layer');
    document.body.appendChild(layer);
  }
  return layer;
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Coins burst from `from` and fly to `to`. onArrive(i) fires as each lands (use it to bump the counter).
 * Resolves after the last coin lands.
 */
export function flyCoins(from: Element, to: Element, count: number, onArrive?: (i: number, n: number) => void): Promise<void> {
  const n = Math.max(1, Math.min(14, Math.round(count)));
  if (reducedMotion()) {
    for (let i = 0; i < n; i++) onArrive?.(i, n);
    return Promise.resolve();
  }
  const layer = flyLayer();
  const a = center(from);
  const b = center(to);
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    const coinEl = h('div.fly-coin', { html: coinSvg() });
    layer.appendChild(coinEl);
    const spreadX = (Math.random() - 0.5) * 120;
    const spreadY = -40 - Math.random() * 70;
    const midX = a.x + spreadX;
    const midY = a.y + spreadY;
    const delay = i * 55;
    const dur = 620 + Math.random() * 180;
    const anim = coinEl.animate(
      [
        { transform: `translate(${a.x}px, ${a.y}px) scale(.4)`, opacity: 0 },
        { transform: `translate(${midX}px, ${midY}px) scale(1.15)`, opacity: 1, offset: 0.32 },
        { transform: `translate(${b.x}px, ${b.y}px) scale(.7)`, opacity: 1 },
      ],
      { duration: dur, delay, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'both' },
    );
    jobs.push(anim.finished.then(() => { coinEl.remove(); onArrive?.(i, n); }).catch(() => { coinEl.remove(); }));
  }
  return Promise.all(jobs).then(() => undefined);
}

const CONFETTI = ['#3DD6B5', '#FF7AA8', '#FFD166', '#0E8F8A', '#5BBEF5', '#FFFDF7'];
/** Confetti burst from a point (or the top center of the screen). */
export function confetti(origin?: Element | { x: number; y: number }, amount = 60): void {
  if (reducedMotion()) return;
  const layer = flyLayer();
  const o = origin ? ('getBoundingClientRect' in origin ? center(origin) : origin) : { x: innerWidth / 2, y: innerHeight * 0.3 };
  for (let i = 0; i < amount; i++) {
    const piece = h('i.confetti', { style: { background: CONFETTI[i % CONFETTI.length], borderRadius: i % 3 === 0 ? '50%' : '2px' } });
    layer.appendChild(piece);
    const ang = Math.random() * Math.PI * 2;
    const speed = 160 + Math.random() * 320;
    const dx = Math.cos(ang) * speed;
    const dy = Math.sin(ang) * speed - 220;
    const rot = (Math.random() - 0.5) * 900;
    const dur = 1100 + Math.random() * 900;
    piece.animate(
      [
        { transform: `translate(${o.x}px, ${o.y}px) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${o.x + dx * 0.7}px, ${o.y + dy * 0.7}px) rotate(${rot * 0.6}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${o.x + dx}px, ${o.y + dy + 520}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: dur, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' },
    ).finished.then(() => piece.remove()).catch(() => piece.remove());
  }
}

/** Small floating "+$120" style label. */
export function floatText(at: Element, text: string, cls = ''): void {
  if (reducedMotion()) return;
  const p = center(at);
  const el = h('div.float-text', { class: cls }, text);
  flyLayer().appendChild(el);
  // near the top edge (the cash counter) the label drops down instead of rising off screen
  const dir = p.y < 140 ? 1 : -1;
  el.animate(
    [
      { transform: `translate(${p.x}px, ${p.y}px) translate(-50%, 0) scale(.8)`, opacity: 0 },
      { transform: `translate(${p.x}px, ${p.y + dir * 30}px) translate(-50%, 0) scale(1.05)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${p.x}px, ${p.y + dir * 60}px) translate(-50%, 0) scale(1)`, opacity: 0 },
    ],
    { duration: 1100, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' },
  ).finished.then(() => el.remove()).catch(() => el.remove());
}
