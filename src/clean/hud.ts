// DOM HUD for the clean scene: patient card, comfort, speech bubbles, timer vs par, clean ring,
// mini-map, views, tool bar, reassure, done, tutorial banner, combo and floating labels.
import './hud.css';
import type { ArchetypeId, CleanSetup, ToolSlot } from '../core/types';
import { TOOL_SLOTS, TOOL_SLOT_NAMES, TOOLS } from '../data/tools';
import { ARCHETYPES } from '../data/patients';
import { portraitUrl, type Mood } from '../data/assets';
import { probeImage } from '../core/assets';
import { TEETH_PER_ARCH } from '../core/mouth';
import { ICONS, TOOL_ICONS } from './icons';
import type { ViewId } from './camera';

export interface HudHandlers {
  tool(slot: ToolSlot): void;
  reassure(): void;
  done(): void;
  view(id: ViewId): void;
  focusTooth(i: number): void;
  disclose(): void;
  leave(): void;
  skipTutorial(): void;
}

const VIEW_LABELS: [ViewId, string][] = [['front', 'Front'], ['left', 'Left'], ['right', 'Right'], ['upper', 'Upper'], ['lower', 'Lower']];
const PORTRAIT_BG: Record<string, string> = {
  mannequin: '#E4E9EE', regular: '#BDEFE3', coffee: '#F3DCC2', kid: '#FFE6A8', nervous: '#D9E4FF', gagger: '#D8F2C9',
  smoker: '#E7DDD3', senior: '#EBDDF5', influencer: '#FFD1E3', athlete: '#C9EEFF', chatty: '#FFE0CC',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class CleanHud {
  readonly root: HTMLDivElement;
  private slots = new Map<ToolSlot, HTMLButtonElement>();
  private badges = new Map<ToolSlot, HTMLElement>();
  private waterBar!: HTMLElement;
  private comfortFill!: HTMLElement;
  private portrait!: HTMLDivElement;
  private portraitImg: HTMLImageElement | null = null;
  private moodOk: Partial<Record<Mood, boolean>> = {};
  private mood: Mood | null = null;
  private bubble: HTMLDivElement | null = null;
  private bubbleTimer = 0;
  private timeEl!: HTMLElement;
  private parEl!: HTMLElement;
  private ringFg!: SVGCircleElement;
  private ringPct!: HTMLElement;
  private ring!: HTMLElement;
  private reassureBtn!: HTMLButtonElement;
  private doneBtn!: HTMLButtonElement;
  private teeth: HTMLButtonElement[] = [];
  private viewBtns = new Map<ViewId, HTMLButtonElement>();
  private dyeBtn: HTMLButtonElement | null = null;
  private tut: HTMLDivElement | null = null;
  private pulsed: HTMLElement | null = null;
  private combo!: HTMLDivElement;
  private floats: HTMLDivElement[] = [];
  private floatNext = 0;
  private flash!: HTMLDivElement;
  private last = { comfort: -1, time: '', clean: -1, cd: -1, water: -1 };
  private counts: Record<string, number> = {};
  private modal: HTMLDivElement | null = null;

  constructor(host: HTMLElement, private setup: CleanSetup, private h: HudHandlers, hasDisclosing: boolean) {
    this.root = el('div', 'fbc-hud');
    host.appendChild(this.root);
    // mouse clicks do not leave buttons focused (Space is Reassure, not "click the last button")
    this.root.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
    this.buildTopLeft();
    this.buildStatus();
    this.buildMap();
    this.buildBottom();
    if (hasDisclosing) {
      const side = el('div', 'fbc-side');
      this.dyeBtn = el('button', 'fbc-dye', `<span class="fbc-ico">${ICONS.drop}</span>Dye`);
      this.dyeBtn.setAttribute('aria-label', 'Disclosing solution');
      this.dyeBtn.addEventListener('click', () => this.h.disclose());
      side.appendChild(this.dyeBtn);
      this.root.appendChild(side);
    }
    this.combo = el('div', 'fbc-combo');
    this.root.appendChild(this.combo);
    for (let i = 0; i < 14; i++) { const f = el('div', 'fbc-float'); this.root.appendChild(f); this.floats.push(f); }
    this.flash = el('div', 'fbc-flash');
    this.root.appendChild(this.flash);
  }

  // ---------------------------------------------------------------- build

  private buildTopLeft() {
    const wrap = el('div', 'fbc-top-left');
    const leave = el('button', 'fbc-leave', ICONS.back);
    leave.setAttribute('aria-label', 'Leave');
    leave.addEventListener('click', () => this.h.leave());
    const card = el('div', 'fbc-card fbc-patient');
    this.portrait = el('div', 'fbc-portrait');
    const a = this.setup.patient.archetype;
    this.portrait.style.background = PORTRAIT_BG[a] || '#BDEFE3';
    const initials = this.setup.patient.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
    this.portrait.innerHTML = `<div class="fbc-initials">${initials}</div>`;
    const info = el('div', 'fbc-pinfo');
    const name = el('div', 'fbc-pname');
    name.textContent = this.setup.patient.name;
    const label = el('div', 'fbc-plabel');
    label.textContent = ARCHETYPES[a]?.label ?? '';
    const comfort = el('div', 'fbc-comfort');
    comfort.innerHTML = `<span class="fbc-hicon">${ICONS.heartFill}</span>`;
    const track = el('div', 'fbc-bar-track');
    this.comfortFill = el('div', 'fbc-bar-fill');
    track.appendChild(this.comfortFill);
    comfort.appendChild(track);
    comfort.setAttribute('aria-label', 'Comfort');
    info.append(name, label, comfort);
    card.append(this.portrait, info);
    wrap.append(leave, card);
    this.root.appendChild(wrap);
    // portraits load lazily; the initials stay if an image is missing
    const moods: Mood[] = ['neutral', 'happy', 'pain', 'wow'];
    for (const m of moods) {
      probeImage(portraitUrl(this.portraitKey, m)).then((ok) => {
        this.moodOk[m] = ok;
        if (ok && (this.mood === m || (this.mood === null && m === 'neutral'))) this.showMood(m);
      });
    }
  }

  private buildStatus() {
    const s = el('div', 'fbc-card fbc-status');
    this.ring = el('div', 'fbc-ring');
    this.ring.innerHTML = `<svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="26" fill="none" stroke-width="8"/><circle class="fg" cx="32" cy="32" r="26" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="163.4" stroke-dashoffset="163.4"/></svg><div class="fbc-pct">0%</div>`;
    this.ringFg = this.ring.querySelector('.fg') as SVGCircleElement;
    this.ringPct = this.ring.querySelector('.fbc-pct') as HTMLElement;
    this.ring.setAttribute('aria-label', 'Clean');
    const t = el('div');
    this.timeEl = el('div', 'fbc-time', '0:00');
    this.parEl = el('div', 'fbc-par');
    this.parEl.textContent = `Par ${fmt(this.setup.parSeconds)}`;
    t.append(this.timeEl, this.parEl);
    s.append(this.ring, t);
    this.root.appendChild(s);
  }

  private buildMap() {
    const wrap = el('div', 'fbc-top-right');
    const map = el('div', 'fbc-card fbc-map');
    for (const arch of ['upper', 'lower'] as const) {
      const row = el('div', `fbc-map-row ${arch}`);
      for (let p = 0; p < TEETH_PER_ARCH; p++) {
        const i = (arch === 'upper' ? 0 : TEETH_PER_ARCH) + p;
        const b = el('button', 'fbc-tooth');
        b.setAttribute('aria-label', `Tooth ${i + 1}`);
        if (this.setup.missingTeeth.includes(i)) b.classList.add('missing');
        b.addEventListener('click', () => this.h.focusTooth(i));
        row.appendChild(b);
        this.teeth[i] = b;
      }
      map.appendChild(row);
    }
    const views = el('div', 'fbc-card fbc-views');
    for (const [id, label] of VIEW_LABELS) {
      const b = el('button', 'fbc-view');
      b.textContent = label;
      b.addEventListener('click', () => this.h.view(id));
      views.appendChild(b);
      this.viewBtns.set(id, b);
    }
    wrap.append(map);
    this.root.appendChild(wrap);
    this.root.appendChild(views);
  }

  private buildBottom() {
    const bottom = el('div', 'fbc-bottom');
    this.reassureBtn = el('button', 'fbc-round fbc-reassure', `<span class="fbc-cd"></span><span class="fbc-ico">${ICONS.heartFill}</span><span class="fbc-k">Space</span><span class="fbc-lbl">Reassure</span>`);
    this.reassureBtn.setAttribute('aria-label', 'Reassure');
    this.reassureBtn.addEventListener('click', () => this.h.reassure());
    const tools = el('div', 'fbc-card fbc-tools');
    TOOL_SLOTS.forEach((slot, k) => {
      const tier = this.setup.tools[slot];
      const b = el('button', 'fbc-slot');
      const dots = TOOLS[slot].length > 1 ? `<span class="fbc-tier">${TOOLS[slot].map((_, j) => `<i class="${j < tier ? 'on' : ''}"></i>`).join('')}</span>` : '';
      b.innerHTML = `<span class="fbc-key">${k + 1}</span>${dots}<span class="fbc-ico">${TOOL_ICONS[slot]}</span><span class="fbc-name">${TOOL_SLOT_NAMES[slot]}</span>`;
      const t = TOOLS[slot][Math.max(0, Math.min(TOOLS[slot].length - 1, tier - 1))];
      b.title = t.name;
      b.setAttribute('aria-label', t.name);
      b.addEventListener('click', () => this.h.tool(slot));
      if (slot === 'suction') {
        const w = el('span', 'fbc-water', '<i></i>');
        this.waterBar = w;
        b.appendChild(w);
      }
      if (slot !== 'polisher') {
        const badge = el('span', 'fbc-badge zero', '0');
        b.appendChild(badge);
        this.badges.set(slot, badge);
      }
      tools.appendChild(b);
      this.slots.set(slot, b);
    });
    this.doneBtn = el('button', 'fbc-done', `<span class="fbc-ico">${ICONS.check}</span>Done`);
    this.doneBtn.addEventListener('click', () => this.h.done());
    bottom.append(this.reassureBtn, tools, this.doneBtn);
    this.root.appendChild(bottom);
  }

  // ---------------------------------------------------------------- updates

  setTool(slot: ToolSlot | null) {
    for (const [s, b] of this.slots) b.classList.toggle('on', s === slot);
  }

  setView(id: ViewId | null) {
    for (const [v, b] of this.viewBtns) b.classList.toggle('on', v === id);
  }

  setComfort(v: number) {
    const r = Math.round(v);
    if (r === this.last.comfort) return;
    this.last.comfort = r;
    this.comfortFill.style.width = `${Math.max(2, r)}%`;
    this.comfortFill.style.backgroundPosition = `${-(100 - r) * 0.8}px 0`;
    this.comfortFill.classList.toggle('low', r < 30);
  }

  setMood(m: Mood) {
    if (m === this.mood) return;
    this.mood = m;
    this.showMood(m);
  }

  private showMood(m: Mood) {
    const use: Mood | null = this.moodOk[m] ? m : this.moodOk.neutral ? 'neutral' : null;
    if (!use) {
      // CSS face under the initials
      let face = this.portrait.querySelector('.fbc-face') as SVGElement | null;
      if (!face) {
        this.portrait.insertAdjacentHTML('beforeend', '<svg class="fbc-face" viewBox="0 0 22 9"></svg>');
        face = this.portrait.querySelector('.fbc-face') as SVGElement;
      }
      const path = m === 'happy' ? 'M3 2 Q11 10 19 2' : m === 'wow' ? 'M8 4 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0' : m === 'pain' ? 'M3 6 L7 3 L11 6 L15 3 L19 6' : 'M5 5 L17 5';
      face.innerHTML = `<path d="${path}" fill="none" stroke="#16323A" stroke-width="2.2" stroke-linecap="round"/>`;
      return;
    }
    if (!this.portraitImg) {
      this.portraitImg = document.createElement('img');
      this.portraitImg.alt = '';
      this.portraitImg.draggable = false;
      this.portrait.innerHTML = '';
      this.portrait.appendChild(this.portraitImg);
    }
    this.portraitImg.src = portraitUrl(this.portraitKey, use);
  }

  /** The portrait image key: setup.patient.portrait when it names an archetype set, else the archetype. */
  private get portraitKey(): ArchetypeId {
    const p = this.setup.patient.portrait as ArchetypeId;
    return p && ARCHETYPES[p] ? p : this.setup.patient.archetype;
  }

  wince() {
    this.portrait.classList.remove('wince');
    void this.portrait.offsetWidth;
    this.portrait.classList.add('wince');
  }

  say(text: string, ms = 2600) {
    if (this.bubble) this.bubble.remove();
    const b = el('div', 'fbc-bubble');
    b.textContent = text;
    (this.root.querySelector('.fbc-patient') as HTMLElement).appendChild(b);
    this.bubble = b;
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => {
      b.classList.add('out');
      window.setTimeout(() => b.remove(), 260);
      if (this.bubble === b) this.bubble = null;
    }, ms);
  }

  setTimer(sec: number) {
    const s = fmt(sec);
    if (s === this.last.time) return;
    this.last.time = s;
    this.timeEl.textContent = s;
    this.timeEl.classList.toggle('over', sec > this.setup.parSeconds);
  }

  setClean(frac: number) {
    const p = Math.floor(frac * 100 + 1e-6);
    if (p === this.last.clean) return;
    this.last.clean = p;
    this.ringFg.style.strokeDashoffset = String(163.4 * (1 - Math.min(1, frac)));
    this.ringPct.textContent = `${p}%`;
    this.ring.classList.toggle('full', p >= 97);
    this.doneBtn.classList.toggle('ready', p >= 97);
  }

  setReassure(cdFrac: number) {
    const q = Math.round(cdFrac * 60) / 60;
    if (q === this.last.cd) return;
    this.last.cd = q;
    this.reassureBtn.style.setProperty('--cd', `${q * 360}deg`);
    this.reassureBtn.classList.toggle('cool', q > 0);
  }

  setCounts(tartar: number, debris: number, bits: number, water: number) {
    this.badge('scaler', tartar);
    this.badge('floss', debris);
    this.badge('rinse', bits);
    this.badge('suction', bits);
    const w = Math.round(water * 50) / 50;
    if (w !== this.last.water) {
      this.last.water = w;
      (this.waterBar.firstElementChild as HTMLElement).style.width = `${w * 100}%`;
      this.waterBar.classList.toggle('high', w > 0.6);
    }
  }
  private badge(slot: ToolSlot, n: number) {
    if (this.counts[slot] === n) return;
    this.counts[slot] = n;
    const b = this.badges.get(slot);
    if (!b) return;
    b.textContent = String(n);
    b.classList.toggle('zero', n <= 0);
  }

  /** Remaining dirt per tooth 0..1 (NaN = missing), `clean` flags, `focus` tooth or -1. */
  setMap(dirt: Float32Array, clean: Uint8Array, focus: number) {
    for (let i = 0; i < this.teeth.length; i++) {
      const b = this.teeth[i];
      if (b.classList.contains('missing')) continue;
      const d = dirt[i];
      b.style.background = dirtColor(d);
      b.classList.toggle('clean', !!clean[i]);
      b.classList.toggle('focus', i === focus);
    }
  }

  setDisclose(on: boolean) { this.dyeBtn?.classList.toggle('on', on); }

  showCombo(text: string) {
    const c = this.combo;
    c.textContent = text;
    c.classList.remove('go');
    void c.offsetWidth;
    c.classList.add('go');
  }

  float(x: number, y: number, text: string, cls = '') {
    const f = this.floats[this.floatNext];
    this.floatNext = (this.floatNext + 1) % this.floats.length;
    f.className = 'fbc-float ' + cls;
    f.textContent = text;
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    void f.offsetWidth;
    f.classList.add('go');
  }

  hurtFlash() {
    this.flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flash.classList.remove('on')));
  }

  // ---------------------------------------------------------------- tutorial

  tutorial(step: number, total: number, text: string, target: HTMLElement | null) {
    if (!this.tut) {
      this.tut = el('div', 'fbc-card fbc-tut');
      this.root.appendChild(this.tut);
    }
    this.tut.innerHTML = `<div class="fbc-tut-step">${step} / ${total}</div><div class="fbc-tut-text"></div>`;
    (this.tut.querySelector('.fbc-tut-text') as HTMLElement).textContent = text;
    const skip = el('button', 'fbc-tut-skip', 'Skip');
    skip.addEventListener('click', () => this.h.skipTutorial());
    this.tut.appendChild(skip);
    this.tut.style.animation = 'none';
    void this.tut.offsetWidth;
    this.tut.style.animation = '';
    this.pulse(target);
  }
  endTutorial() {
    this.tut?.remove();
    this.tut = null;
    this.pulse(null);
  }
  pulse(target: HTMLElement | null) {
    if (this.pulsed === target) return;
    this.pulsed?.classList.remove('fbc-pulse');
    this.pulsed = target;
    target?.classList.add('fbc-pulse');
  }
  slotEl(slot: ToolSlot) { return this.slots.get(slot)!; }
  get done() { return this.doneBtn; }

  // ---------------------------------------------------------------- overlays

  finale(sub: string) {
    const f = el('div', 'fbc-finale', `<div><div class="fbc-finale-title">Sparkling Smile</div><div class="fbc-finale-sub"></div></div>`);
    (f.querySelector('.fbc-finale-sub') as HTMLElement).textContent = sub;
    this.root.appendChild(f);
  }

  notice(text: string) {
    const n = el('div', 'fbc-card fbc-notice');
    n.textContent = text;
    this.root.appendChild(n);
  }

  confirmLeave(): Promise<boolean> {
    if (this.modal) return Promise.resolve(false);
    return new Promise((resolve) => {
      const back = el('div', 'fbc-modal-back');
      back.innerHTML = `<div class="fbc-card fbc-modal"><h3>Leave this patient?</h3><p>They will reschedule. No pay for this visit.</p><div class="row"></div></div>`;
      const row = back.querySelector('.row') as HTMLElement;
      const stay = el('button', 'fbc-btn primary', 'Keep cleaning');
      const go = el('button', 'fbc-btn danger', 'Leave');
      row.append(stay, go);
      const close = (v: boolean) => { back.remove(); this.modal = null; resolve(v); };
      stay.addEventListener('click', () => close(false));
      go.addEventListener('click', () => close(true));
      this.root.appendChild(back);
      this.modal = back;
    });
  }
  get modalOpen() { return !!this.modal; }

  dispose() {
    clearTimeout(this.bubbleTimer);
    this.root.remove();
  }
}

export function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function dirtColor(d: number): string {
  if (!(d > 0.02)) return '#FFFFFF';
  // mint-white -> butter -> mustard -> coffee
  const stops = [[255, 251, 238], [250, 232, 160], [234, 196, 92], [206, 150, 60]];
  const t = Math.min(0.999, d) * (stops.length - 1);
  const i = Math.floor(t), f = t - i;
  const a = stops[i], b = stops[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
