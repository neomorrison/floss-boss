// DOM HUD for the clean scene: patient card, comfort, speech bubbles, the case card (clean ring, timer vs
// par, live objective checklist, bonus, shade meter), mini-map, views, tool bar (with the case tools),
// reassure / nudge, done, the case intro card, tutorial banner, combo and floating labels, touch reticle.
import './hud.css';
import type { ArchetypeId, BonusId, CleanSetup, TwistId } from '../core/types';
import { TOOLS } from '../data/tools';
import { ARCHETYPES } from '../data/patients';
import { BONUSES, CASES, TWISTS } from '../data/cases';
import { portraitUrl, type Mood } from '../data/assets';
import { probeImage } from '../core/assets';
import { TEETH_PER_ARCH } from '../core/mouth';
import { ICONS, TOOL_ICONS } from './icons';
import type { ViewId } from './camera';
import type { Objective } from './dirt';
import { CASE_TOOL_NAMES, SLOT_NAMES, isCaseSlot, type SlotId } from './slots';

export interface HudHandlers {
  tool(slot: SlotId): void;
  reassure(): void;
  done(): void;
  view(id: ViewId): void;
  focusTooth(i: number): void;
  disclose(): void;
  leave(): void;
  skipTutorial(): void;
}

export interface HudOptions {
  disclosing: boolean;
  slots: SlotId[];
  objectives: Objective[];
  twists: TwistId[];
  nudge: boolean;
}

const VIEW_LABELS: [ViewId, string][] = [['front', 'Front'], ['left', 'Left'], ['right', 'Right'], ['upper', 'Upper'], ['lower', 'Lower']];
const PORTRAIT_BG: Record<string, string> = {
  mannequin: '#E4E9EE', regular: '#BDEFE3', coffee: '#F3DCC2', kid: '#FFE6A8', nervous: '#D9E4FF', gagger: '#D8F2C9',
  smoker: '#E7DDD3', senior: '#EBDDF5', influencer: '#FFD1E3', athlete: '#C9EEFF', chatty: '#FFE0CC', pirate: '#FFE3B0',
};
/** Shade guide swatches 1 (brightest) .. 16. */
const SHADE_COLORS = Array.from({ length: 16 }, (_, i) => {
  const t = i / 15;
  const r = Math.round(255 - 30 * t), g = Math.round(252 - 60 * t), b = Math.round(244 - 120 * t);
  return `rgb(${r},${g},${b})`;
});

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

interface ObjRow { row: HTMLElement; n: HTMLElement; bar: HTMLElement; done: boolean; last: string }

export class CleanHud {
  readonly root: HTMLDivElement;
  private slots = new Map<SlotId, HTMLButtonElement>();
  private badges = new Map<SlotId, HTMLElement>();
  private waterBar!: HTMLElement;
  private comfortFill!: HTMLElement;
  private portrait!: HTMLDivElement;
  private portraitImg: HTMLImageElement | null = null;
  private moodOk: Partial<Record<Mood, boolean>> = {};
  private mood: Mood | null = null;
  private bubble: HTMLDivElement | null = null;
  private bubbleTimer = 0;
  private timeEl!: HTMLElement;
  private ringFg!: SVGCircleElement;
  private ringPct!: HTMLElement;
  private ring!: HTMLElement;
  private reassureBtn!: HTMLButtonElement;
  private reassureLbl!: HTMLElement;
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
  private last = { comfort: -1, time: '', clean: -1, cd: -1, water: -1, shade: -1, bonus: '' };
  private counts: Record<string, number> = {};
  private modal: HTMLDivElement | null = null;
  private objRows = new Map<string, ObjRow>();
  private bonusEl: HTMLElement | null = null;
  private shadeEl: HTMLElement | null = null;
  private shadeMark: HTMLElement | null = null;
  private shadeNow: HTMLElement | null = null;
  private reticle!: HTMLDivElement;
  private thread!: HTMLDivElement;
  private threadFg!: SVGCircleElement;
  private loadingEl: HTMLDivElement | null = null;
  private intro: HTMLDivElement | null = null;
  private introTimer = 0;
  private caseCard!: HTMLDivElement;

  constructor(host: HTMLElement, private setup: CleanSetup, private h: HudHandlers, private o: HudOptions) {
    this.root = el('div', 'fbc-hud');
    host.appendChild(this.root);
    // mouse clicks do not leave buttons focused (Space is Reassure, not "click the last button")
    this.root.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
    this.buildTopLeft();
    this.buildCase();
    this.buildMap();
    this.buildBottom();
    if (o.disclosing) {
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
    this.reticle = el('div', 'fbc-reticle');
    this.thread = el('div', 'fbc-thread', `<svg viewBox="0 0 48 48"><circle class="bg" cx="24" cy="24" r="19" fill="none" stroke-width="5"/><circle class="fg" cx="24" cy="24" r="19" fill="none" stroke-width="5" stroke-linecap="round" stroke-dasharray="119.4" stroke-dashoffset="119.4"/></svg>`);
    this.threadFg = this.thread.querySelector('.fg') as SVGCircleElement;
    this.root.append(this.reticle, this.thread);
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
    const pwrap = el('div', 'fbc-pwrap');
    pwrap.appendChild(this.portrait);
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
    if (this.o.twists.length) {
      const tw = el('div', 'fbc-twists');
      for (const t of this.o.twists) { const c = el('span', 'fbc-chip'); c.textContent = TWISTS[t].name; c.title = TWISTS[t].text; tw.appendChild(c); }
      info.appendChild(tw);
    }
    card.append(pwrap, info);
    wrap.append(leave, card);
    this.root.appendChild(wrap);
    const moods: Mood[] = ['neutral', 'happy', 'pain', 'wow'];
    for (const m of moods) {
      probeImage(portraitUrl(this.portraitKey, m)).then((ok) => {
        this.moodOk[m] = ok;
        if (ok && (this.mood === m || (this.mood === null && m === 'neutral'))) this.showMood(m);
      });
    }
  }

  private buildCase() {
    const c = el('div', 'fbc-card fbc-case');
    this.caseCard = c;
    const head = el('div', 'fbc-case-head');
    this.ring = el('div', 'fbc-ring');
    this.ring.innerHTML = `<svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="26" fill="none" stroke-width="8"/><circle class="fg" cx="32" cy="32" r="26" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="163.4" stroke-dashoffset="163.4"/></svg><div class="fbc-pct">0%</div>`;
    this.ringFg = this.ring.querySelector('.fg') as SVGCircleElement;
    this.ringPct = this.ring.querySelector('.fbc-pct') as HTMLElement;
    this.ring.setAttribute('aria-label', 'Clean');
    const t = el('div', 'fbc-case-info');
    const name = el('div', 'fbc-case-name');
    name.textContent = CASES[this.setup.caseType]?.name ?? 'Cleaning';
    const clock = el('div', 'fbc-clock');
    this.timeEl = el('span', 'fbc-time', '0:00');
    const par = el('span', 'fbc-par');
    par.textContent = `Par ${fmt(this.setup.parSeconds)}`;
    clock.append(this.timeEl, par);
    t.append(name, clock);
    head.append(this.ring, t);
    c.appendChild(head);
    const list = el('ul', 'fbc-objs');
    for (const o of this.o.objectives) {
      const row = el('li', 'fbc-obj');
      row.innerHTML = `<i class="fbc-box">${ICONS.check}</i><span class="fbc-obj-label"></span><span class="fbc-obj-n"></span><span class="fbc-obj-bar"><i></i></span>`;
      (row.querySelector('.fbc-obj-label') as HTMLElement).textContent = o.label;
      const n = row.querySelector('.fbc-obj-n') as HTMLElement;
      const bar = row.querySelector('.fbc-obj-bar') as HTMLElement;
      if (o.count > 0) bar.remove(); else n.remove();
      list.appendChild(row);
      this.objRows.set(o.id, { row, n, bar, done: false, last: '' });
      if (o.id === 'cure') {
        // shade meter under the cure row
        const sh = el('li', 'fbc-shade');
        sh.innerHTML = `<div class="fbc-shade-bar">${SHADE_COLORS.map((col) => `<i style="background:${col}"></i>`).join('')}<b class="tgt"></b><b class="now"></b></div><div class="fbc-shade-lbl"><span class="n"></span></div>`;
        list.appendChild(sh);
        this.shadeEl = sh;
        this.shadeMark = sh.querySelector('.tgt') as HTMLElement;
        this.shadeNow = sh.querySelector('.now') as HTMLElement;
        const tgt = Math.max(1, this.setup.special?.targetShade || 1);
        this.shadeMark.style.left = `${((tgt - 0.5) / 16) * 100}%`;
      }
    }
    c.appendChild(list);
    const bonus: BonusId | null = this.setup.bonus ?? null;
    if (bonus) {
      this.bonusEl = el('div', 'fbc-bonus', `<i class="fbc-star">${ICONS.sparkle}</i><span></span>`);
      (this.bonusEl.querySelector('span') as HTMLElement).textContent = `Bonus: ${BONUSES[bonus].text}`;
      c.appendChild(this.bonusEl);
    }
    this.root.appendChild(c);
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
        if (this.setup.problemTeeth?.includes(i)) b.classList.add('prob');
        if (this.setup.special?.goldTooth === i) b.classList.add('gold');
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
    wrap.append(map, views);
    this.root.appendChild(wrap);
  }

  private buildBottom() {
    const bottom = el('div', 'fbc-bottom');
    this.reassureBtn = el('button', 'fbc-round fbc-reassure', `<span class="fbc-cd"></span><span class="fbc-ico">${ICONS.heartFill}</span><span class="fbc-k">Space</span><span class="fbc-lbl"></span>`);
    this.reassureLbl = this.reassureBtn.querySelector('.fbc-lbl') as HTMLElement;
    this.reassureLbl.textContent = this.o.nudge ? 'Nudge' : 'Reassure';
    this.reassureBtn.setAttribute('aria-label', this.o.nudge ? 'Nudge' : 'Reassure');
    this.reassureBtn.addEventListener('click', () => this.h.reassure());
    const tools = el('div', 'fbc-card fbc-tools');
    tools.style.setProperty('--n', String(this.o.slots.length));
    this.o.slots.forEach((slot, k) => {
      const b = el('button', 'fbc-slot' + (isCaseSlot(slot) ? ' case' : ''));
      let dots = '', title: string;
      if (isCaseSlot(slot)) title = CASE_TOOL_NAMES[slot];
      else {
        const tier = this.setup.tools[slot];
        dots = TOOLS[slot].length > 1 ? `<span class="fbc-tier">${TOOLS[slot].map((_, j) => `<i class="${j < tier ? 'on' : ''}"></i>`).join('')}</span>` : '';
        title = TOOLS[slot][Math.max(0, Math.min(TOOLS[slot].length - 1, tier - 1))].name;
      }
      b.innerHTML = `<span class="fbc-key">${k + 1}</span>${dots}<span class="fbc-ico">${TOOL_ICONS[slot]}</span><span class="fbc-name">${SLOT_NAMES[slot]}</span>`;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', () => this.h.tool(slot));
      if (slot === 'suction') {
        const w = el('span', 'fbc-water', '<i></i>');
        this.waterBar = w;
        b.appendChild(w);
      }
      if (slot === 'scaler' || slot === 'floss' || slot === 'rinse' || slot === 'suction') {
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

  setTool(slot: SlotId | null) {
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

  private get portraitKey(): ArchetypeId {
    const p = this.setup.patient.portrait as ArchetypeId;
    return p && ARCHETYPES[p] ? p : this.setup.patient.archetype;
  }

  wince() {
    this.portrait.classList.remove('wince');
    void this.portrait.offsetWidth;
    this.portrait.classList.add('wince');
  }

  /** Gag warning: a ring pulses around the portrait. */
  uneasy(on: boolean) { this.portrait.parentElement!.classList.toggle('uneasy', on); }

  say(text: string, ms = 2600, cls = '') {
    if (this.bubble) this.bubble.remove();
    const b = el('div', 'fbc-bubble' + (cls ? ' ' + cls : ''));
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

  /** Overall clean 0..1; `ready` makes Done glow. */
  setClean(frac: number, ready: boolean) {
    const p = Math.floor(frac * 100 + 1e-6);
    if (p !== this.last.clean) {
      this.last.clean = p;
      this.ringFg.style.strokeDashoffset = String(163.4 * (1 - Math.min(1, frac)));
      this.ringPct.textContent = `${p}%`;
      this.ring.classList.toggle('full', p >= 100);
    }
    this.doneBtn.classList.toggle('ready', ready);
  }

  /** Live checklist. Returns the ids that just ticked (for the caller's juice). */
  setObjectives(objs: Objective[]) {
    for (const o of objs) {
      const r = this.objRows.get(o.id);
      if (!r) continue;
      const key = o.count > 0 ? `${o.have}/${o.count}` : String(Math.round(o.progress * 100));
      if (key !== r.last) {
        r.last = key;
        if (o.count > 0) r.n.textContent = key;
        else (r.bar.firstElementChild as HTMLElement).style.width = `${Math.round(o.progress * 100)}%`;
      }
      if (o.done !== r.done) {
        r.done = o.done;
        r.row.classList.toggle('done', o.done);
        if (o.done) { r.row.classList.remove('tick'); void r.row.offsetWidth; r.row.classList.add('tick'); }
      }
    }
  }

  setBonus(state: 'open' | 'met' | 'failed') {
    if (!this.bonusEl || state === this.last.bonus) return;
    const was = this.last.bonus;
    this.last.bonus = state;
    this.bonusEl.classList.toggle('met', state === 'met');
    this.bonusEl.classList.toggle('failed', state === 'failed');
    if (state === 'met' && was) { this.bonusEl.classList.remove('tick'); void this.bonusEl.offsetWidth; this.bonusEl.classList.add('tick'); }
  }

  setShade(mean: number) {
    if (!this.shadeEl || !this.shadeNow) return;
    const q = Math.round(mean * 10) / 10;
    if (q === this.last.shade) return;
    this.last.shade = q;
    this.shadeNow.style.left = `${((mean - 0.5) / 16) * 100}%`;
    (this.shadeEl.querySelector('.n') as HTMLElement).textContent = `Shade ${Math.round(mean)}, goal ${Math.max(1, this.setup.special?.targetShade || 1)}`;
  }

  setReassure(cdFrac: number) {
    const q = Math.round(cdFrac * 60) / 60;
    if (q === this.last.cd) return;
    this.last.cd = q;
    this.reassureBtn.style.setProperty('--cd', `${q * 360}deg`);
    this.reassureBtn.classList.toggle('cool', q > 0);
  }

  /** Sleepy twist: the Nudge button pulses while the patient dozes. */
  setDozing(on: boolean) { this.reassureBtn.classList.toggle('wake', on); }

  setCounts(tartar: number, debris: number, resting: number, floating: number, water: number) {
    this.badge('scaler', tartar);
    this.badge('floss', debris);
    this.badge('rinse', resting);
    this.badge('suction', floating);
    const w = Math.round(water * 50) / 50;
    if (w !== this.last.water && this.waterBar) {
      this.last.water = w;
      (this.waterBar.firstElementChild as HTMLElement).style.width = `${w * 100}%`;
      this.waterBar.classList.toggle('high', w > 0.6);
    }
  }
  private badge(slot: SlotId, n: number) {
    if (this.counts[slot] === n) return;
    this.counts[slot] = n;
    const b = this.badges.get(slot);
    if (!b) return;
    b.textContent = String(n);
    b.classList.toggle('zero', n <= 0);
  }

  /** Remaining dirt per problem tooth 0..1, `done` flags (snapped), `focus` tooth or -1. */
  setMap(dirt: Float32Array, done: Uint8Array, focus: number) {
    for (let i = 0; i < this.teeth.length; i++) {
      const b = this.teeth[i];
      if (b.classList.contains('missing')) continue;
      const prob = b.classList.contains('prob');
      b.style.background = prob && !done[i] ? dirtColor(dirt[i]) : '';
      b.classList.toggle('done', !!done[i]);
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

  /** Touch: a small ring where the tool works (40 px above the finger). */
  setReticle(x: number, y: number, on: boolean, active = false) {
    this.reticle.classList.toggle('on', on);
    this.reticle.classList.toggle('active', active);
    if (on) this.reticle.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Braces floss threading ring at (x, y); frac < 0 hides it. */
  setThread(x: number, y: number, frac: number) {
    const on = frac >= 0;
    this.thread.classList.toggle('on', on);
    if (!on) return;
    this.thread.style.transform = `translate(${x}px, ${y}px)`;
    this.threadFg.style.strokeDashoffset = String(119.4 * (1 - Math.min(1, frac)));
  }

  loading(on: boolean) {
    if (on && !this.loadingEl) {
      this.loadingEl = el('div', 'fbc-card fbc-loading', '<span class="fbc-spin"></span>Loading');
      this.root.appendChild(this.loadingEl);
    } else if (!on && this.loadingEl) {
      this.loadingEl.remove();
      this.loadingEl = null;
    }
  }

  // ---------------------------------------------------------------- case intro

  /**
   * The case card at the start of a clean. First time for this case type: explains the case and waits
   * for Start. Otherwise shows the checklist for about 2 s (tap to skip).
   */
  showIntro(first: boolean): Promise<void> {
    const c = CASES[this.setup.caseType];
    return new Promise((resolve) => {
      const back = el('div', 'fbc-intro-back' + (first ? ' first' : ''));
      const card = el('div', 'fbc-card fbc-intro');
      const tag = el('div', 'fbc-intro-tag');
      tag.textContent = first ? 'New case' : this.setup.patient.name;
      const title = el('div', 'fbc-intro-title');
      title.textContent = c?.name ?? 'Cleaning';
      const blurb = el('div', 'fbc-intro-blurb');
      blurb.textContent = c?.blurb ?? '';
      card.append(tag, title, blurb);
      if (first && c?.tip) {
        const tip = el('div', 'fbc-intro-tip');
        tip.textContent = c.tip;
        card.appendChild(tip);
      }
      const list = el('ul', 'fbc-intro-objs');
      for (const o of this.o.objectives) {
        const li = el('li');
        li.innerHTML = `<i>${ICONS.check}</i><span></span>`;
        (li.querySelector('span') as HTMLElement).textContent = o.count > 0 ? `${o.label} (${o.count})` : o.label;
        list.appendChild(li);
      }
      card.appendChild(list);
      if (this.o.twists.length || this.setup.bonus) {
        const extra = el('div', 'fbc-intro-extra');
        for (const t of this.o.twists) {
          const chip = el('div', 'fbc-intro-twist');
          chip.innerHTML = `<b></b><span></span>`;
          (chip.querySelector('b') as HTMLElement).textContent = TWISTS[t].name;
          (chip.querySelector('span') as HTMLElement).textContent = TWISTS[t].text;
          extra.appendChild(chip);
        }
        if (this.setup.bonus) {
          const chip = el('div', 'fbc-intro-twist bonus');
          chip.innerHTML = `<b>Bonus</b><span></span>`;
          (chip.querySelector('span') as HTMLElement).textContent = BONUSES[this.setup.bonus].text;
          extra.appendChild(chip);
        }
        card.appendChild(extra);
      }
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(this.introTimer);
        back.classList.add('out');
        window.setTimeout(() => back.remove(), 220);
        this.intro = null;
        resolve();
      };
      if (first) {
        const go = el('button', 'fbc-btn primary fbc-intro-go', 'Start');
        go.addEventListener('click', close);
        card.appendChild(go);
      } else {
        const bar = el('div', 'fbc-intro-bar', '<i></i>');
        card.appendChild(bar);
        back.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
        this.introTimer = window.setTimeout(close, 2200);
      }
      back.appendChild(card);
      this.root.appendChild(back);
      this.intro = back;
    });
  }
  get introOpen() { return !!this.intro; }

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
  slotEl(slot: SlotId) { return this.slots.get(slot) ?? null; }
  get done() { return this.doneBtn; }
  get caseEl() { return this.caseCard; }

  // ---------------------------------------------------------------- overlays

  finale(title: string, sub: string) {
    const f = el('div', 'fbc-finale', `<div><div class="fbc-finale-title"></div><div class="fbc-finale-sub"></div></div>`);
    (f.querySelector('.fbc-finale-title') as HTMLElement).textContent = title;
    (f.querySelector('.fbc-finale-sub') as HTMLElement).textContent = sub;
    this.root.appendChild(f);
  }

  notice(text: string) {
    const n = el('div', 'fbc-card fbc-notice');
    n.textContent = text;
    this.root.appendChild(n);
  }

  private confirm(title: string, body: string, stayLabel: string, goLabel: string, danger: boolean): Promise<boolean> {
    if (this.modal) return Promise.resolve(false);
    return new Promise((resolve) => {
      const back = el('div', 'fbc-modal-back');
      back.innerHTML = `<div class="fbc-card fbc-modal"><h3></h3><p></p><div class="row"></div></div>`;
      (back.querySelector('h3') as HTMLElement).textContent = title;
      (back.querySelector('p') as HTMLElement).textContent = body;
      const row = back.querySelector('.row') as HTMLElement;
      const stay = el('button', 'fbc-btn primary', stayLabel);
      const go = el('button', 'fbc-btn ' + (danger ? 'danger' : ''), goLabel);
      row.append(stay, go);
      const close = (v: boolean) => { back.remove(); this.modal = null; resolve(v); };
      stay.addEventListener('click', () => close(false));
      go.addEventListener('click', () => close(true));
      this.root.appendChild(back);
      this.modal = back;
    });
  }

  confirmLeave(): Promise<boolean> {
    return this.confirm('Leave this patient?', 'They will reschedule. No pay for this visit.', 'Keep cleaning', 'Leave', true);
  }

  /** Done below 80% asks first (DESIGN 5.8). */
  confirmFinish(pct: number, left: string): Promise<boolean> {
    return this.confirm(`Finish at ${pct}%?`, left, 'Keep cleaning', 'Finish', false);
  }
  get modalOpen() { return !!this.modal; }

  dispose() {
    clearTimeout(this.bubbleTimer);
    clearTimeout(this.introTimer);
    this.root.remove();
  }
}

export function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function dirtColor(d: number): string {
  if (!(d > 0.02)) return '#FFFFFF';
  const stops = [[255, 251, 238], [250, 232, 160], [234, 196, 92], [206, 150, 60]];
  const t = Math.min(0.999, 0.25 + d * 0.75) * (stops.length - 1);
  const i = Math.floor(t), f = t - i;
  const a = stops[i], b = stops[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
