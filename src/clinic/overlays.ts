// DOM overlays pinned to 3D points: progress rings over busy operatories, the "!" over an operatory
// waiting for you, patience bars over waiting patients, mood faces on leaving patients, name tags,
// "+" badges on empty slots, and one-shot pops (coins, stars, angry puffs).
// Elements are pooled per id and only restyled when their screen position or value changes.
import * as THREE from 'three';

const CSS = `
.fbc-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:Nunito,system-ui,sans-serif;contain:strict;-webkit-user-select:none;user-select:none}
.fbc-item{position:absolute;left:0;top:0;will-change:transform}
.fbc-item.k-bar,.fbc-item.k-mood{z-index:1}.fbc-item.k-ring{z-index:2}.fbc-item.k-plus{z-index:2}.fbc-item.k-tag{z-index:3}.fbc-item.k-alert{z-index:4}.fbc-item.k-pop{z-index:5}
.fbc-anchor{position:absolute;left:0;top:0;transform:translate(-50%,-100%)}
.fbc-ring{width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 3px 10px rgba(22,50,58,.22);display:flex;align-items:center;justify-content:center}
.fbc-ring svg{position:absolute;inset:0;transform:rotate(-90deg)}
.fbc-ring .trk{fill:none;stroke:#DDF3EC;stroke-width:5}
.fbc-ring .bar{fill:none;stroke:#3DD6B5;stroke-width:5;stroke-linecap:round;transition:stroke-dashoffset .25s linear}
.fbc-ring.player .bar{stroke:#FF7AA8}
.fbc-ring .ic{position:relative;width:22px;height:22px}
.fbc-alert{pointer-events:auto;cursor:pointer;width:48px;height:48px;border-radius:50%;background:#FF7AA8;color:#fff;display:flex;align-items:center;justify-content:center;font:800 30px/1 "Baloo 2",Nunito,system-ui,sans-serif;box-shadow:0 0 0 4px #fff,0 6px 16px rgba(255,90,140,.45);animation:fbc-bob 1s ease-in-out infinite}
.fbc-alert::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:3px solid #FF7AA8;animation:fbc-ping 1.4s ease-out infinite}
@keyframes fbc-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes fbc-ping{0%{transform:scale(1);opacity:.9}100%{transform:scale(1.7);opacity:0}}
.fbc-bar{width:38px;height:8px;border-radius:5px;background:rgba(22,50,58,.28);box-shadow:0 0 0 2px rgba(255,255,255,.9);overflow:hidden}
.fbc-bar i{display:block;height:100%;border-radius:5px;background:#3DD6B5;transform-origin:left center;transition:background-color .4s}
.fbc-bar.low{animation:fbc-shake .5s ease-in-out infinite}
@keyframes fbc-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-1.5px)}75%{transform:translateX(1.5px)}}
.fbc-mood{width:30px;height:30px;filter:drop-shadow(0 2px 3px rgba(22,50,58,.25))}
.fbc-tag{background:#fff;color:#16323A;font:800 13px/1 Nunito,system-ui,sans-serif;padding:5px 10px;border-radius:12px;white-space:nowrap;box-shadow:0 3px 10px rgba(22,50,58,.2)}
.fbc-tag.you{background:#FF7AA8;color:#fff}
.fbc-plus{pointer-events:auto;cursor:pointer;width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.9);border:3px dashed #0E8F8A;color:#0E8F8A;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(22,50,58,.18);transition:transform .15s}
.fbc-plus:hover{transform:scale(1.08)}
.fbc-pop{animation:fbc-rise 1.5s cubic-bezier(.2,.8,.3,1) forwards}
@keyframes fbc-rise{0%{transform:translateY(8px) scale(.4);opacity:0}15%{transform:translateY(-6px) scale(1.12);opacity:1}30%{transform:translateY(-12px) scale(1)}80%{opacity:1}100%{transform:translateY(-58px) scale(.95);opacity:0}}
.fbc-cash{display:flex;align-items:center;gap:4px;font:800 20px/1 "Baloo 2",Nunito,system-ui,sans-serif;color:#0E8F8A;-webkit-text-stroke:5px #fff;paint-order:stroke fill;white-space:nowrap}
.fbc-coin{position:absolute;left:50%;top:0;width:18px;height:18px;margin-left:-9px;animation:fbc-coin .9s cubic-bezier(.2,.7,.4,1) forwards}
@keyframes fbc-coin{0%{transform:translate(0,10px) scale(.3);opacity:0}20%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1) rotate(var(--rot));opacity:0}}
.fbc-stars{display:flex;gap:1px;filter:drop-shadow(0 2px 3px rgba(22,50,58,.3))}
.fbc-stars svg{width:20px;height:20px}
.fbc-puff{width:58px;height:46px;animation:fbc-puff 1.4s ease-out forwards}
@keyframes fbc-puff{0%{transform:scale(.3);opacity:0}20%{transform:scale(1.15);opacity:1}35%{transform:scale(1)}100%{transform:translateY(-40px) scale(1.1);opacity:0}}
.fbc-spark{width:54px;height:54px;animation:fbc-spark 1s ease-out forwards}
@keyframes fbc-spark{0%{transform:scale(.2) rotate(0);opacity:0}25%{opacity:1}100%{transform:scale(1.3) rotate(40deg);opacity:0}}
`;

let styled = false;
export function injectStyles(): void {
  if (styled || typeof document === 'undefined') return;
  const s = document.createElement('style');
  s.id = 'fbc-styles';
  s.textContent = CSS;
  document.head.appendChild(s);
  styled = true;
}

// ------------------------------------------------------------------ icons (inline SVG, no emoji)

const TOOTH = `<svg class="ic" viewBox="0 0 24 24"><path fill="#0E8F8A" d="M7.2 3.2c-2.6 0-4.4 2.1-4 4.9.3 2.1 1.4 3.4 1.9 5.6.5 2.4.6 6.3 2.4 6.3 1.9 0 1.6-4.7 3.1-4.7h.8c1.5 0 1.2 4.7 3.1 4.7 1.8 0 1.9-3.9 2.4-6.3.5-2.2 1.6-3.5 1.9-5.6.4-2.8-1.4-4.9-4-4.9-1.8 0-2.6 1-4.8 1S9 3.2 7.2 3.2z"/><path fill="#FFD166" d="M18.6 1.6l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/></svg>`;
const STAR_ON = `<svg viewBox="0 0 24 24"><path fill="#FFD166" stroke="#fff" stroke-width="2" stroke-linejoin="round" d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.1l-5.9 3.2 1.3-6.5L2.5 9.3l6.6-.8z"/></svg>`;
const STAR_OFF = `<svg viewBox="0 0 24 24"><path fill="#CFE6DF" stroke="#fff" stroke-width="2" stroke-linejoin="round" d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.1l-5.9 3.2 1.3-6.5L2.5 9.3l6.6-.8z"/></svg>`;
const COIN = `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#FFD166" stroke="#E9A23B" stroke-width="2"/><path d="M12 6.5v11M14.8 8.6c-.6-.8-1.6-1.1-2.8-1.1-1.5 0-2.7.8-2.7 2 0 2.9 5.7 1.6 5.7 4.6 0 1.2-1.2 2-2.9 2-1.3 0-2.5-.5-3.1-1.4" fill="none" stroke="#B9791C" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const PLUS = `<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 5v14M5 12h14" stroke="#0E8F8A" stroke-width="3.2" stroke-linecap="round"/></svg>`;
const PUFF = `<svg class="fbc-puff" viewBox="0 0 58 46"><g fill="#D9DEE2" stroke="#fff" stroke-width="2"><circle cx="16" cy="28" r="12"/><circle cx="29" cy="18" r="14"/><circle cx="42" cy="27" r="12"/><circle cx="28" cy="32" r="11"/></g><path d="M22 14l4 3M36 14l-4 3" stroke="#E0484C" stroke-width="2.6" stroke-linecap="round"/><path d="M23 27q6-5 12 0" fill="none" stroke="#E0484C" stroke-width="2.6" stroke-linecap="round"/><path d="M44 6l2 4 4-2-2 4 4 2-4 1" fill="none" stroke="#E0484C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPARK = `<svg class="fbc-spark" viewBox="0 0 54 54"><g fill="#FFD166" stroke="#fff" stroke-width="1.5"><path d="M27 4l3 12 12 3-12 3-3 12-3-12-12-3 12-3z"/><path d="M44 30l1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5z"/><path d="M10 34l1.2 4 4 1.2-4 1.2-1.2 4-1.2-4-4-1.2 4-1.2z"/></g></svg>`;

export type Mood = 'happy' | 'ok' | 'grumpy' | 'angry';
const FACE_COL: Record<Mood, string> = { happy: '#3DD6B5', ok: '#FFD166', grumpy: '#FFA24D', angry: '#F0555B' };
function face(m: Mood): string {
  const mouth = m === 'happy' ? 'M9 15.5q3 3 6 0' : m === 'ok' ? 'M9.2 15.8h5.6' : m === 'grumpy' ? 'M9 16.8q3-2.2 6 0' : 'M8.8 17.2q3.2-3 6.4 0';
  const brows = m === 'angry' ? '<path d="M7.6 8.6l3 1.4M16.4 8.6l-3 1.4" stroke="#16323A" stroke-width="1.6" stroke-linecap="round"/>' : '';
  return `<svg class="fbc-mood" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="${FACE_COL[m]}" stroke="#fff" stroke-width="2"/>${brows}<circle cx="9" cy="11" r="1.4" fill="#16323A"/><circle cx="15" cy="11" r="1.4" fill="#16323A"/><path d="${mouth}" fill="none" stroke="#16323A" stroke-width="1.7" stroke-linecap="round"/></svg>`;
}

// ------------------------------------------------------------------ layer

interface Item { wrap: HTMLDivElement; inner: HTMLElement; used: boolean; shown: boolean; px: number; py: number; val: number; str: string }
type Kind = 'ring' | 'alert' | 'bar' | 'mood' | 'tag' | 'plus';

interface Pop { wrap: HTMLDivElement; x: number; y: number; z: number; until: number; px: number; py: number }

const RING_C = 2 * Math.PI * 20;

export class OverlayLayer {
  readonly root: HTMLDivElement;
  private pools: Record<Kind, Map<string, Item>> = { ring: new Map(), alert: new Map(), bar: new Map(), mood: new Map(), tag: new Map(), plus: new Map() };
  private pops: Pop[] = [];
  private v = new THREE.Vector3();
  private w = 1; private h = 1;
  private cam: THREE.Camera | null = null;
  private now = 0;

  constructor(parent: HTMLElement) {
    injectStyles();
    this.root = document.createElement('div');
    this.root.className = 'fbc-layer';
    parent.appendChild(this.root);
  }

  begin(cam: THREE.Camera, w: number, h: number, nowSec: number): void {
    this.cam = cam; this.w = w; this.h = h; this.now = nowSec;
    for (const k in this.pools) for (const it of this.pools[k as Kind].values()) it.used = false;
  }

  end(): void {
    for (const k in this.pools) {
      const pool = this.pools[k as Kind];
      for (const it of pool.values()) {
        if (!it.used && it.shown) { it.wrap.style.display = 'none'; it.shown = false; }
      }
    }
    // pops follow their world point until they finish
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      if (this.now > p.until) { p.wrap.remove(); this.pops.splice(i, 1); continue; }
      this.place(p.wrap, p, p.x, p.y, p.z);
    }
  }

  private project(x: number, y: number, z: number): boolean {
    this.v.set(x, y, z).project(this.cam!);
    return this.v.z < 1 && this.v.x > -1.3 && this.v.x < 1.3 && this.v.y > -1.3 && this.v.y < 1.3;
  }

  private place(wrap: HTMLDivElement, st: { px: number; py: number }, x: number, y: number, z: number): boolean {
    if (!this.project(x, y, z)) { wrap.style.visibility = 'hidden'; return false; }
    const px = Math.round((this.v.x + 1) * 0.5 * this.w);
    const py = Math.round((1 - this.v.y) * 0.5 * this.h);
    if (px !== st.px || py !== st.py) {
      wrap.style.transform = `translate3d(${px}px,${py}px,0)`;
      st.px = px; st.py = py;
    }
    wrap.style.visibility = '';
    return true;
  }

  private item(kind: Kind, id: string, build: () => HTMLElement): Item {
    const pool = this.pools[kind];
    let it = pool.get(id);
    if (!it) {
      const wrap = document.createElement('div');
      wrap.className = 'fbc-item k-' + kind;
      const anchor = document.createElement('div');
      anchor.className = 'fbc-anchor';
      const inner = build();
      anchor.appendChild(inner);
      wrap.appendChild(anchor);
      this.root.appendChild(wrap);
      it = { wrap, inner, used: false, shown: true, px: NaN, py: NaN, val: NaN, str: '' };
      pool.set(id, it);
    }
    it.used = true;
    if (!it.shown) { it.wrap.style.display = ''; it.shown = true; }
    return it;
  }

  ring(id: string, x: number, y: number, z: number, progress: number, player: boolean): void {
    const it = this.item('ring', id, () => {
      const d = document.createElement('div');
      d.className = 'fbc-ring';
      d.innerHTML = `<svg viewBox="0 0 46 46"><circle class="trk" cx="23" cy="23" r="20"/><circle class="bar" cx="23" cy="23" r="20" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>${TOOTH}`;
      return d;
    });
    this.place(it.wrap, it, x, y, z);
    const q = Math.round(progress * 100);
    if (q !== it.val) {
      it.val = q;
      (it.inner.querySelector('.bar') as SVGCircleElement).style.strokeDashoffset = String(RING_C * (1 - q / 100));
    }
    const s = player ? 'p' : 'n';
    if (s !== it.str) { it.str = s; it.inner.classList.toggle('player', player); }
  }

  alert(id: string, x: number, y: number, z: number, opId: string): void {
    const it = this.item('alert', id, () => {
      const d = document.createElement('div');
      d.className = 'fbc-alert';
      d.textContent = '!';
      d.setAttribute('role', 'button');
      d.setAttribute('aria-label', 'Patient waiting in your chair');
      return d;
    });
    it.inner.dataset.op = opId;
    this.place(it.wrap, it, x, y, z);
  }

  bar(id: string, x: number, y: number, z: number, frac: number): void {
    const it = this.item('bar', id, () => {
      const d = document.createElement('div');
      d.className = 'fbc-bar';
      d.innerHTML = '<i></i>';
      return d;
    });
    this.place(it.wrap, it, x, y, z);
    const q = Math.round(Math.max(0, Math.min(1, frac)) * 50);
    if (q !== it.val) {
      it.val = q;
      const f = q / 50;
      const i = it.inner.firstChild as HTMLElement;
      i.style.transform = `scaleX(${Math.max(0.04, f)})`;
      i.style.backgroundColor = f > 0.55 ? '#3DD6B5' : f > 0.28 ? '#FFD166' : '#F0555B';
      it.inner.classList.toggle('low', f <= 0.28);
    }
  }

  mood(id: string, x: number, y: number, z: number, m: Mood): void {
    const it = this.item('mood', id, () => document.createElement('div'));
    if (it.str !== m) { it.str = m; it.inner.innerHTML = face(m); }
    this.place(it.wrap, it, x, y, z);
  }

  tag(id: string, x: number, y: number, z: number, text: string, you = false): void {
    const it = this.item('tag', id, () => { const d = document.createElement('div'); d.className = 'fbc-tag'; return d; });
    if (it.str !== text) { it.str = text; it.inner.textContent = text; it.inner.classList.toggle('you', you); }
    this.place(it.wrap, it, x, y, z);
  }

  plus(id: string, x: number, y: number, z: number, slot: number): void {
    const it = this.item('plus', id, () => {
      const d = document.createElement('div');
      d.className = 'fbc-plus';
      d.innerHTML = PLUS;
      d.setAttribute('role', 'button');
      d.setAttribute('aria-label', 'Add operatory');
      return d;
    });
    it.inner.dataset.slot = String(slot);
    this.place(it.wrap, it, x, y, z);
  }

  // ---------------------------------------------------------------- one-shot pops

  private pop(html: string | HTMLElement, x: number, y: number, z: number, life: number): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'fbc-item k-pop';
    const a = document.createElement('div');
    a.className = 'fbc-anchor';
    if (typeof html === 'string') a.innerHTML = html; else a.appendChild(html);
    wrap.appendChild(a);
    this.root.appendChild(wrap);
    const p: Pop = { wrap, x, y, z, until: this.now + life, px: NaN, py: NaN };
    this.pops.push(p);
    if (this.cam) this.place(wrap, p, x, y, z);
    return wrap;
  }

  cash(x: number, y: number, z: number, text: string): void {
    const d = document.createElement('div');
    d.className = 'fbc-pop';
    d.innerHTML = `<div class="fbc-cash">${COIN}<span></span></div>`;
    (d.querySelector('span') as HTMLElement).textContent = text;
    for (let i = 0; i < 5; i++) {
      const c = document.createElement('div');
      c.className = 'fbc-coin';
      c.innerHTML = COIN;
      const a = -Math.PI / 2 + (i - 2) * 0.45;
      c.style.setProperty('--dx', `${Math.round(Math.cos(a) * 46)}px`);
      c.style.setProperty('--dy', `${Math.round(Math.sin(a) * 40 - 10)}px`);
      c.style.setProperty('--rot', `${(i - 2) * 40}deg`);
      c.style.animationDelay = `${i * 40}ms`;
      d.appendChild(c);
    }
    this.pop(d, x, y, z, 1.6);
  }

  stars(x: number, y: number, z: number, n: number): void {
    const d = document.createElement('div');
    d.className = 'fbc-pop';
    let s = '<div class="fbc-stars">';
    for (let i = 0; i < 5; i++) s += i < n ? STAR_ON : STAR_OFF;
    d.innerHTML = s + '</div>';
    this.pop(d, x, y, z, 1.6);
  }

  puff(x: number, y: number, z: number): void { this.pop(PUFF, x, y, z, 1.5); }
  sparkle(x: number, y: number, z: number): void { this.pop(SPARK, x, y, z, 1.1); }

  clear(): void {
    for (const k in this.pools) { for (const it of this.pools[k as Kind].values()) it.wrap.remove(); this.pools[k as Kind].clear(); }
    for (const p of this.pops) p.wrap.remove();
    this.pops.length = 0;
  }

  dispose(): void { this.clear(); this.root.remove(); }
}
