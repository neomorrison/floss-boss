// The hands-on clean controller: input, tools, floss, case mechanics, twists, juice, tutorial, finale,
// before/after snapshots and the debug hook (DESIGN 5 v2).
import * as THREE from 'three';
import type { CleanResult, CleanSetup, ToolSlot } from '../core/types';
import { attachRenderer, getRenderer } from '../core/renderer';
import { loadModel } from '../core/assets';
import { loadSettings, saveSettings, type Settings } from '../core/save';
import { bus } from '../core/bus';
import { isMolar, TEETH_PER_ARCH, TOOTH_COUNT } from '../core/mouth';
import { MOUTH_MODELS, type Mood, type SfxKey } from '../data/assets';
import { toolTier } from '../data/tools';
import { audio, type LoopHandle } from '../audio';
import {
  applyGel, applyLamp, applyPocket, applyPolisher, applyRinse, applyScaler, applySuction, applyWaterFloss, bitsLeft, bonusState, cellCenterU,
  cellCenterV, cheat, cleanScore, createModel, flossStroke, gelCoverage, goldProgress, meanShade, messState, reassure, scoreClean, tickModel,
  toothBlocked, toothDirtLeft, twistList, wrapRate, type CleanEvent, type CleanModel, type Debris, type FlossTarget,
} from './dirt';
import { flossHook, flossMove, flossRelease, flossTick, FLOSS, newFloss, type FlossEvent, type FlossState } from './floss';
import { MouthScene, makeHit, type Hit, type Models } from './scene';
import { MouthCamera, type ViewId } from './camera';
import { CleanHud } from './hud';
import { allSlots, slotModel, type SlotId } from './slots';

/** Harness / debug switches (not part of the game contract). */
export const cleanOptions = { procedural: false };

const LOAD_TIMEOUT = 6000;
const TOUCH_OFFSET = 40;
const HOOK_RADIUS = 0.45;

export function neededModels(setup: CleanSetup | null): string[] {
  const keys: string[] = [...MOUTH_MODELS];
  if (setup) for (const s of allSlots(setup)) keys.push(slotModel(setup, s));
  return keys;
}

interface Ptr { id: number; x: number; y: number; type: string; button: number; off: number; x0: number; y0: number }
interface FlossAim { target: FlossTarget; bracket: boolean; debId: number; gum: THREE.Vector3; tip: THREE.Vector3; axis: { x: number; y: number }; len: number; perp0: number; lastAlong: number }

const TUTORIAL_STEPS = [
  'Select the scaler',
  'Scrape the yellow crust at the gumline',
  'Switch to the polisher and polish the brown stain',
  'Floss: press the glowing gap, push down through, then saw up and down',
  'Rinse the crumbs and paste, then suction them up',
  'Clean the rest, then press Done',
];

const REASSURE_LINES = ['Okay...', 'Thanks.', 'That helps.', 'Mm-kay.', 'Phew.'];
const LOOP_KEYS: readonly SfxKey[] = ['ultrasonic_loop', 'polish_loop', 'suction_loop', 'rinse_loop', 'lamp_loop'];

export class CleanController {
  readonly root: HTMLDivElement;
  private canvasHost: HTMLDivElement;
  private model: CleanModel;
  private hud: CleanHud;
  private scene: MouthScene | null = null;
  private cam = new MouthCamera();
  private snapCam = new MouthCamera();
  private renderer: THREE.WebGLRenderer | null = null;
  private detach: (() => void) | null = null;
  private raf = 0;
  private lastT = 0;
  private settings: Settings;
  private slots: SlotId[];
  private slot: SlotId | null;
  private disposed = false;
  private finished = false;
  private extPaused = false;
  private hiddenPaused = false;
  private introPaused = false;
  private elapsed = 0;
  private hitch = 0;
  private resolveDone: (r: CleanResult) => void;
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  // input
  private ptrs = new Map<number, Ptr>();
  private mode: 'none' | 'tool' | 'orbit' = 'none';
  private toolPtr = -1;
  private hoverX = -1; private hoverY = -1; private hoverIn = false;
  private pinchD = 0;
  private hit: Hit = makeHit();
  private lastTooth = -1;
  private lastPoint = new THREE.Vector3();
  private strokeAcc = 0;
  private ptrSpeed = 0;
  private lastMoveT = 0;
  private holdTooth = -1;
  private holdTime = 0;
  private width = 1; private height = 1;
  // floss
  private fl: FlossState = newFloss();
  private flAim: FlossAim | null = null;
  private flEvents: FlossEvent[] = [];
  private markerPts: THREE.Vector3[] = [];
  private markerVis: boolean[] = [];
  private markerClock = 0;
  // tool pose
  private toolPos = new THREE.Vector3(6, -6, 8);
  private toolQuat = new THREE.Quaternion();
  private toolTouching = false;
  private toolTip = new THREE.Vector3();
  private lastNormal = new THREE.Vector3(0, 0, 1);
  private everTouched = false;
  private pY = new THREE.Vector3(); private pZ = new THREE.Vector3(); private pX = new THREE.Vector3(); private pUp = new THREE.Vector3();
  // juice
  private loops: Partial<Record<SfxKey, LoopHandle>> = {};
  private loopVol: Partial<Record<SfxKey, number>> = {};
  private lastVibe = 0;
  private wowUntil = -1;
  private eagleClock = 0;
  private hudClock = 0;
  private focusTooth = -1;
  private gumFlash = 0;
  private hints = new Map<string, number>();
  private clinkT = 0;
  private gelSfxT = 0;
  private snoreT = 0;
  private joltAnim = 0;
  private lastBonus: string = '';
  private readyGlow = false;
  // tutorial
  private tut = -1;
  private tutDep = -1;
  private tutStainTooth = -1;
  private tutStain0 = 0;
  private tutWaterPeak = 0;
  // snapshots
  private needBefore = false;
  private needAfter: CleanResult | null = null;
  private before: string | null = null;
  private after: string | null = null;
  // temps
  private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3(); private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3(); private v5 = new THREE.Vector3(); private v6 = new THREE.Vector3();
  private m1 = new THREE.Matrix4(); private q1 = new THREE.Quaternion();
  private s1 = { x: 0, y: 0 }; private s2 = { x: 0, y: 0 };
  private mapDirt = new Float32Array(TOOTH_COUNT);
  private mapDone = new Uint8Array(TOOTH_COUNT);
  private disclose = false;
  private useOut = { working: false, molar: false, gum: false, gumRisk: 0, scaling: false };
  private toolAt = { tooth: -1, u: 0, v: 0 };

  constructor(private container: HTMLElement, private setup: CleanSetup, resolve: (r: CleanResult) => void) {
    this.resolveDone = resolve;
    this.settings = loadSettings();
    this.model = createModel(setup);
    this.slots = allSlots(setup);
    this.slot = setup.tutorial ? null : 'scaler';
    this.root = document.createElement('div');
    this.root.className = 'fbc';
    this.canvasHost = document.createElement('div');
    this.canvasHost.className = 'fbc-canvas';
    this.root.appendChild(this.canvasHost);
    if (typeof getComputedStyle === 'function' && getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(this.root);
    const owned = setup.tools.extras;
    this.disclose = owned.includes('disclosing') && this.settings.disclosing;
    this.hud = new CleanHud(this.root, setup, {
      tool: (s) => this.selectTool(s),
      reassure: () => this.doReassure(),
      done: () => this.requestDone(),
      view: (id) => this.setView(id),
      focusTooth: (i) => this.focus(i),
      disclose: () => this.toggleDisclose(),
      leave: () => this.leave(),
      skipTutorial: () => this.endTutorial(),
    }, { disclosing: owned.includes('disclosing'), slots: this.slots, objectives: this.model.objectives, twists: twistList(setup), nudge: this.model.tw.sleepy });
    this.hud.setTool(this.slot);
    this.hud.setView('front');
    this.hud.setDisclose(this.disclose);
    this.hud.setComfort(this.model.comfort);
    this.hud.setMood('neutral');
    this.hud.setClean(0, false);
    this.hud.setObjectives(this.model.objectives);
    if (setup.bonus) this.hud.setBonus('open');
    if (this.model.caseType === 'whitening') this.hud.setShade(meanShade(this.model));
    this.hud.loading(true);
    this.installDebug();
    this.init().catch((e) => {
      console.error('[clean] 3D view failed', e);
      if (!this.disposed) { this.hud.loading(false); this.hud.notice('This device cannot show the 3D view'); }
    });
  }

  // ---------------------------------------------------------------- setup

  private async init() {
    const keys = cleanOptions.procedural ? [] : neededModels(this.setup);
    const models: Models = {};
    const timeout = new Promise<void>((r) => setTimeout(r, LOAD_TIMEOUT));
    await Promise.race([Promise.all(keys.map(async (k) => { models[k] = await loadModel(k); })), timeout]);
    if (this.disposed) return;
    for (const k of keys) if (!(k in models)) models[k] = null;
    const renderer = getRenderer();
    this.renderer = renderer;
    const low = this.settings.quality === 'low';
    const slotModels: Record<string, string> = {};
    for (const s of this.slots) slotModels[s] = slotModel(this.setup, s);
    this.scene = new MouthScene(renderer, this.model, models, {
      lowQuality: low, headlamp: this.setup.tools.extras.includes('headlamp'), procedural: cleanOptions.procedural,
      slots: this.slots, slotModels,
    });
    this.scene.shared.uDisclose.value = this.disclose ? 1 : 0;
    this.scene.shared.uPlaqueBoost.value = this.setup.tools.extras.includes('headlamp') ? 1 : 0;
    if (this.setup.tools.extras.includes('loupes')) this.cam.minDist = 3.8;
    this.cam.view('front', true);
    this.snapCam.view('front', true);
    this.detach = attachRenderer(this.canvasHost, (w, h) => this.onResize(w, h));
    renderer.shadowMap.enabled = !low;
    this.bindInput();
    this.hud.loading(false);
    audio.music('music_clean');
    this.needBefore = true;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000));
      this.lastT = t;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
    if (this.setup.tutorial) { this.startTutorial(); return; }
    // the case card: the first time explains the case and waits; otherwise a 2 s checklist
    this.introPaused = true;
    await this.hud.showIntro(!!this.setup.firstOfCase);
    if (this.disposed) return;
    this.introPaused = false;
    if (this.setup.patient.archetype === 'pirate') this.sfx('arr', 0.8);
    window.setTimeout(() => { if (!this.disposed && !this.finished) this.hud.say(this.greeting(), 2400); }, 400);
  }

  private greeting(): string {
    const a = this.setup.patient.archetype;
    if (a === 'mannequin') return '...';
    if (a === 'nervous') return 'Please be gentle.';
    if (a === 'kid') return 'Will it tickle?';
    return this.setup.lines[0] ?? 'Hi there.';
  }

  private onResize(w: number, h: number) {
    this.width = w; this.height = h;
    this.cam.resize(w, h);
    this.snapCam.resize(w, h);
    if (this.scene && this.renderer) {
      const px = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(this.cam.camera.fov / 2)));
      this.scene.fx.setPointScale(px);
    }
    requestAnimationFrame(() => this.layoutShift());
  }

  /** Keep the mouth clear of the HUD columns: shift the picture (not the camera) away from them. */
  private layoutShift() {
    if (this.disposed || !this.scene) return;
    const host = this.root.getBoundingClientRect();
    const w = this.width, h = this.height;
    const caseR = this.hud.caseEl.getBoundingClientRect();
    let sx = 0, sy = 0;
    if (w / h > 1.25) {
      // landscape: the case card is a left column; move the mouth right until the back molars clear it
      this.snapCam.view('front', true);
      this.snapCam.update(0, true);
      this.scene.scene.updateMatrixWorld(true);
      let left = Infinity;
      for (const i of [0, 1, TEETH_PER_ARCH, TEETH_PER_ARCH + 1]) {
        if (!this.scene.teeth[i]) continue;
        const p = this.scene.toothCenter(i, this.v1).project(this.snapCam.camera);
        left = Math.min(left, (p.x * 0.5 + 0.5) * w - 34);
      }
      const need = caseR.right - host.left + 12 - left;
      if (isFinite(need)) sx = THREE.MathUtils.clamp(need, 0, w * 0.14);
    } else {
      // portrait: centre the mouth between the top cards and the bottom bar
      const top = Math.max(caseR.bottom, (this.root.querySelector('.fbc-top-left') as HTMLElement).getBoundingClientRect().bottom) - host.top;
      const views = (this.root.querySelector('.fbc-top-right') as HTMLElement).getBoundingClientRect();
      const bottom = views.top - host.top;
      if (bottom > top) sy = THREE.MathUtils.clamp((top + bottom) / 2 - h / 2, -h * 0.12, h * 0.12);
    }
    this.cam.setShift(-sx, -sy);
  }

  private on(t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    t.addEventListener(type, fn, opts);
    this.listeners.push([t, type, fn, opts]);
  }

  private bindInput() {
    const c = this.canvasHost;
    this.on(c, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.on(window, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.on(window, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.on(window, 'pointercancel', (e) => this.onUp(e as PointerEvent));
    this.on(c, 'lostpointercapture', (e) => this.onUp(e as PointerEvent));
    this.on(c, 'pointerleave', () => { this.hoverIn = false; });
    this.on(c, 'wheel', (e) => { const w = e as WheelEvent; w.preventDefault(); this.cam.zoom(Math.exp(w.deltaY * 0.0012)); this.hud.setView(null); }, { passive: false });
    this.on(c, 'contextmenu', (e) => e.preventDefault());
    this.on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    this.on(document, 'visibilitychange', () => { this.hiddenPaused = document.hidden; this.applyPause(); });
    this.on(window, 'blur', () => this.resetPointers());
    this.on(this.root, 'touchmove', (e) => e.preventDefault(), { passive: false });
    const off = bus.on('settings:changed', () => { this.settings = loadSettings(); });
    this.listeners.push([window, '__bus', off as unknown as EventListener]);
  }

  // ---------------------------------------------------------------- input

  private toCanvas(e: PointerEvent, out: { x: number; y: number }) {
    const r = this.canvasHost.getBoundingClientRect();
    out.x = e.clientX - r.left; out.y = e.clientY - r.top;
    return out;
  }
  private ndcX(x: number) { return (x / this.width) * 2 - 1; }
  private ndcY(y: number) { return -(y / this.height) * 2 + 1; }
  private pickAt(x: number, y: number, slot: SlotId | null): Hit {
    return this.scene!.pick(this.ndcX(x), this.ndcY(y), this.cam.camera, this.hit, slot === 'suction' || slot === 'rinse');
  }

  private onDown(e: PointerEvent) {
    if (!this.scene || this.finished || this.hud.modalOpen || this.introPaused) return;
    const p = this.toCanvas(e, this.s1);
    // on touch the tool works above the fingertip so the finger does not hide the work
    const off = e.pointerType === 'touch' ? TOUCH_OFFSET : 0;
    this.ptrs.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, type: e.pointerType, button: e.button, off, x0: p.x, y0: p.y });
    try { this.canvasHost.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this.ptrs.size >= 2) {
      this.releaseTool();
      this.mode = 'orbit';
      this.pinchD = this.pinchDistance();
      return;
    }
    this.hoverX = p.x; this.hoverY = p.y - off; this.hoverIn = true;
    if (e.button === 2 || e.button === 1) { this.mode = 'orbit'; return; }
    const slot = this.slot;
    if (!slot) { this.mode = 'orbit'; return; }
    const hit = this.pickAt(p.x, p.y - off, slot);
    const k = hit.kind;
    if (k === 'none' || k === 'face') { this.mode = 'orbit'; return; }
    this.mode = 'tool';
    this.toolPtr = e.pointerId;
    this.lastTooth = -1;
    this.strokeAcc = 0;
    this.lastMoveT = performance.now();
    if (slot === 'floss' && this.setup.tools.floss < 3) this.tryHook(p.x, p.y - off, hit);
  }

  private onMove(e: PointerEvent) {
    if (!this.scene) return;
    const p = this.toCanvas(e, this.s1);
    const ptr = this.ptrs.get(e.pointerId);
    if (!ptr) {
      if (e.pointerType === 'mouse') {
        this.hoverX = p.x; this.hoverY = p.y;
        this.hoverIn = p.x >= 0 && p.y >= 0 && p.x <= this.width && p.y <= this.height && e.target === this.renderer?.domElement;
      }
      return;
    }
    // a lost pointerup (window blur while dragging): a buttonless mouse move ends the drag
    if (ptr.type === 'mouse' && e.buttons === 0) { this.onUp(e); return; }
    const dx = p.x - ptr.x, dy = p.y - ptr.y;
    ptr.x = p.x; ptr.y = p.y;
    if (this.mode === 'orbit') {
      if (this.ptrs.size >= 2) {
        const d = this.pinchDistance();
        if (this.pinchD > 0 && d > 0) this.cam.zoom(this.pinchD / d);
        this.pinchD = d;
        this.cam.orbit(dx / this.ptrs.size, dy / this.ptrs.size);
      } else this.cam.orbit(dx, dy);
      this.hud.setView(null);
      this.focusTooth = -1;
      return;
    }
    if (this.mode === 'tool' && e.pointerId === this.toolPtr) {
      this.hoverX = p.x; this.hoverY = p.y - ptr.off; this.hoverIn = true;
      const now = performance.now();
      const dtm = Math.max(1, now - this.lastMoveT);
      this.lastMoveT = now;
      this.ptrSpeed = this.ptrSpeed * 0.6 + (Math.hypot(dx, dy) / dtm) * 1000 * 0.4;
      if (this.slot === 'floss' && this.flAim && this.fl.phase !== 'idle') this.flossPointer(p.x, p.y - ptr.off);
    }
  }

  private onUp(e: PointerEvent) {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    try { this.canvasHost.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (e.pointerId === this.toolPtr) this.releaseTool();
    if (this.ptrs.size === 0) this.mode = 'none';
    else if (this.ptrs.size === 1) { this.mode = 'orbit'; this.pinchD = 0; }
    if (e.pointerType !== 'mouse') this.hoverIn = false;
  }

  /** Window blur: forget every pointer so a lost pointerup cannot leave the camera orbiting. */
  private resetPointers() {
    this.releaseTool();
    for (const id of this.ptrs.keys()) { try { this.canvasHost.releasePointerCapture(id); } catch { /* ignore */ } }
    this.ptrs.clear();
    this.mode = 'none';
    this.pinchD = 0;
    this.hoverIn = false;
  }

  private releaseTool() {
    this.toolPtr = -1;
    if (this.mode === 'tool') this.mode = 'none';
    this.lastTooth = -1;
    this.ptrSpeed = 0;
    this.holdTooth = -1;
    this.holdTime = 0;
    if (this.fl.phase !== 'idle') flossRelease(this.fl);
    this.flAim = null;
    this.hud.setThread(0, 0, -1);
    this.scene?.setWrap(-1, 0, 0, '#fff');
  }

  private pinchDistance(): number {
    const a = [...this.ptrs.values()];
    if (a.length < 2) return 0;
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  }

  private onKey(e: KeyboardEvent) {
    if (this.finished || this.hud.modalOpen || this.paused) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= this.slots.length) { this.selectTool(this.slots[n - 1]); e.preventDefault(); return; }
    if (e.code === 'Space') { this.doReassure(); e.preventDefault(); return; }
    if (e.key === 'Enter') { this.requestDone(); e.preventDefault(); }
  }

  // ---------------------------------------------------------------- actions

  selectTool(s: SlotId) {
    if (this.finished || !this.slots.includes(s)) return;
    if (this.slot !== s) this.sfx('ui_click', 0.5);
    this.slot = s;
    this.releaseTool();
    this.hud.setTool(s);
    if (this.scene) for (const k of this.slots) this.scene.tools[k].holder.visible = false;
  }

  private doReassure() {
    if (this.finished || this.introPaused) return;
    if (!reassure(this.model)) this.sfx('error', 0.35);
  }

  private setView(id: ViewId) {
    this.cam.view(id);
    this.hud.setView(id);
    this.focusTooth = -1;
  }

  /** Frame a tooth; back molars use the side view at distance, and the yaw softens while the cheek is in the way. */
  private focus(i: number) {
    const sc = this.scene;
    if (!sc || !sc.teeth[i]) return;
    const p = this.model.placements[i];
    const back = p.pos <= 1 || p.pos >= 12;
    sc.toothCenter(i, this.v1);
    sc.root.worldToLocal(this.v1);
    let k = 1, extra = 0;
    for (let tries = 0; tries < 6; tries++) {
      this.cam.focus(this.v1, p.nx, p.nz, p.arch === 'upper' ? -0.22 : 0.24, back, k, extra);
      const from = this.cam.goalPosition(this.v2);
      if (sc.firstHitKind(from, sc.toothCenter(i, this.v3)) !== 'face') break;
      k *= 0.7; extra += 0.8;
    }
    this.focusTooth = i;
    this.hud.setView(null);
  }

  private toggleDisclose() {
    this.disclose = !this.disclose;
    if (this.scene) this.scene.shared.uDisclose.value = this.disclose ? 1 : 0;
    this.hud.setDisclose(this.disclose);
    this.sfx('splash', 0.4);
    try { saveSettings({ ...loadSettings(), disclosing: this.disclose }); } catch { /* ignore */ }
  }

  private async leave() {
    if (this.finished) return;
    this.releaseTool();
    const was = this.extPaused;
    this.extPaused = true; this.applyPause();
    const ok = await this.hud.confirmLeave();
    this.extPaused = was; this.applyPause();
    if (ok) this.finish('abort');
  }

  /** Done: ignored until the scene has loaded; below 80% asks first (DESIGN 5.8). */
  private async requestDone() {
    if (!this.scene || this.finished || this.hud.modalOpen || this.introPaused) return;
    const clean = cleanScore(this.model);
    const pct = Math.floor(clean * 100 + 1e-6);
    if (pct < 80) {
      this.releaseTool();
      const left = this.model.objectives.filter((o) => !o.done).slice(0, 2).map((o) => o.label);
      const was = this.extPaused;
      this.extPaused = true; this.applyPause();
      const ok = await this.hud.confirmFinish(pct, left.length ? `Still to do: ${left.join(', ').toLowerCase()}.` : 'Some work is left.');
      this.extPaused = was; this.applyPause();
      if (!ok) return;
    }
    this.finish('done');
  }

  pause(p: boolean) { this.extPaused = p; this.applyPause(); }
  private applyPause() {
    if (this.paused) { for (const k in this.loops) this.loops[k as SfxKey]!.setVolume(0); this.releaseTool(); }
  }
  private get paused() { return this.extPaused || this.hiddenPaused || this.introPaused; }

  // ---------------------------------------------------------------- frame

  private frame(dt: number) {
    const sc = this.scene;
    if (!sc || !this.renderer) return;
    let simDt = dt;
    if (this.hitch > 0) { this.hitch -= dt; simDt = dt * 0.12; }
    const running = !this.paused && !this.finished;
    const out = this.useOut;
    out.working = false; out.molar = false; out.gum = false; out.gumRisk = 0; out.scaling = false;
    const loopTargets = this.loopVol;
    for (const k in loopTargets) loopTargets[k as SfxKey] = 0;
    // pointer speed decays when the pointer stops (the polisher slows down when held still)
    this.ptrSpeed *= Math.exp(-dt * 10);
    this.toolAt.tooth = -1;

    if (running) {
      this.elapsed += dt;
      if (this.mode === 'tool' && this.slot && this.model.jawClosed <= 0) this.useTool(simDt);
      else this.toolTouching = false;
      if (this.slot === 'floss' && this.fl.phase !== 'idle') this.flossFrame(dt);
      const mods = this.setup.tools;
      tickModel(this.model, {
        dt: simDt, working: out.working, molar: out.molar, gum: out.gum, gumRisk: out.gumRisk, scaling: out.scaling,
        headphones: mods.extras.includes('headphones'), numbing: mods.numbingGel, tool: this.toolAt.tooth >= 0 ? this.toolAt : null,
      });
      this.drainEvents();
      this.tutorialTick();
    } else this.toolTouching = false;
    if (this.mode !== 'tool' || (this.slot !== 'polisher' && this.slot !== 'gel')) sc.setWrap(-1, 0, 0, '#fff');

    // loops
    for (const k of LOOP_KEYS) {
      const v = running ? (loopTargets[k] ?? 0) : 0;
      let h = this.loops[k];
      if (!h && v > 0) { h = audio.loop(k, { volume: 0 }); this.loops[k] = h; }
      h?.setVolume(v);
    }

    // jaw (chat, gag, doze), fidget, hiccup jolt, gums
    const m = this.model;
    const jawGoal = Math.max(m.jawClosed > 0 ? 1 : 0, m.doze * 0.92);
    const jk = jawGoal > sc.jaw ? (m.doze > 0 && m.jawClosed <= 0 ? 3 : 14) : 5;
    sc.setJaw(sc.jaw + (jawGoal - sc.jaw) * Math.min(1, dt * jk));
    const fid = m.tw.fidget * this.setup.mods.fidget;
    const t = this.elapsed;
    sc.root.rotation.y = fid > 0 ? Math.sin(t * 1.3) * 0.045 * fid + Math.sin(t * 3.1) * 0.012 * fid : 0;
    sc.root.rotation.z = fid > 0 ? Math.sin(t * 1.7 + 1) * 0.025 * fid : 0;
    sc.root.position.x = fid > 0 ? Math.sin(t * 0.9) * 0.22 * fid : 0;
    if (this.joltAnim > 0) {
      this.joltAnim = Math.max(0, this.joltAnim - dt);
      const j = this.settings.reducedMotion ? 0 : Math.sin((0.35 - this.joltAnim) * 30) * this.joltAnim * 0.9;
      sc.root.position.y = j;
    } else sc.root.position.y = 0;
    this.gumFlash = m.gumHurting ? Math.min(1, this.gumFlash + dt * 8) : Math.max(0, this.gumFlash - dt * 3);
    const gi = this.gumFlash * (0.35 + 0.15 * Math.sin(this.elapsed * 30));
    for (let i = 0; i < sc.gumMats.length; i++) sc.gumMats[i].emissiveIntensity = gi;
    this.hud.uneasy(m.gagWarned);
    if (m.dozing) {
      this.snoreT -= dt;
      if (this.snoreT <= 0 && running) { this.snoreT = 2.6; this.sfx('snore', 0.5); }
    }

    // eagle eye pulse: 2 s of outline every 6 s
    let eagle = 0;
    if (this.setup.mods.eagleEye) {
      this.eagleClock = (this.eagleClock + dt) % 6;
      eagle = this.eagleClock < 2 ? Math.sin((this.eagleClock / 2) * Math.PI) : 0;
    }
    sc.shared.uEagle.value = eagle;

    const buzz = this.toolTouching && this.slot === 'scaler' && toolTier('scaler', this.setup.tools.scaler).timeBased ? 1 : 0;
    sc.uploadDirty();
    sc.update(simDt, this.elapsed, buzz, this.tutDep, eagle);
    this.updateMarkers(dt);
    this.poseTool(dt);
    this.cam.update(dt, this.settings.reducedMotion);

    // HUD (cheap updates every frame, heavier ones throttled)
    this.hud.setTimer(this.elapsed);
    this.hud.setComfort(m.comfort);
    this.hud.setReassure(m.reassureCd / 18);
    this.hud.setMood(this.currentMood());
    this.hudClock -= dt;
    if (this.hudClock <= 0) {
      this.hudClock = 0.2;
      this.refreshStats();
    }
    // before / after snapshots (front view, rendered and read in the same task)
    if (this.needBefore) { this.needBefore = false; this.before = this.snapshot(); }
    if (this.needAfter) { const r = this.needAfter; this.needAfter = null; this.after = this.snapshot(); this.afterDone(r); }
    this.renderer.render(sc.scene, this.cam.camera);
  }

  private snapshot(): string | null {
    const sc = this.scene;
    if (!sc || !this.renderer) return null;
    this.snapCam.view('front', true);
    this.snapCam.update(0, true);
    const jaw = sc.jaw, rx = sc.root.rotation.y, rz = sc.root.rotation.z, px = sc.root.position.x, py = sc.root.position.y;
    sc.setJaw(0); sc.root.rotation.set(0, 0, 0); sc.root.position.set(0, 0, 0);
    sc.update(0, this.elapsed, 0, -1, 0);
    sc.scene.updateMatrixWorld(true);
    const url = sc.snapshot(this.renderer, this.snapCam.camera);
    sc.setJaw(jaw); sc.root.rotation.set(0, rx, rz); sc.root.position.set(px, py, 0);
    sc.update(0, this.elapsed, 0, this.tutDep, 0);
    return url;
  }

  private refreshStats() {
    const m = this.model;
    const clean = cleanScore(m);
    const allDone = m.objectives.every((o) => o.done);
    const ready = this.tut >= 0 ? clean >= 0.7 : allDone;
    this.hud.setClean(clean, ready);
    if (allDone && !this.readyGlow) { this.readyGlow = true; if (!this.setup.tutorial) this.hud.showCombo('All done'); }
    this.hud.setObjectives(m.objectives);
    let t = 0, d = 0;
    for (const x of m.tartar) if (!x.popped && !x.hidden) t++;
    for (const x of m.debris) if (!x.popped) d++;
    let resting = 0, floating = 0;
    for (const b of m.bits) { if (b.state === 'resting') resting++; else if (b.state === 'floating') floating++; }
    this.hud.setCounts(t, d, resting, floating, m.water);
    for (let i = 0; i < TOOTH_COUNT; i++) {
      const td = m.teeth[i];
      this.mapDirt[i] = td.present && td.problem ? toothDirtLeft(m, i) : 0;
      this.mapDone[i] = td.present && td.problem && td.snapped ? 1 : 0;
    }
    this.hud.setMap(this.mapDirt, this.mapDone, this.focusTooth);
    if (this.setup.bonus) {
      const b = bonusState(m, this.elapsed);
      this.hud.setBonus(b);
      if (b === 'met' && this.lastBonus !== 'met') { this.sfx('star', 0.8); this.hud.showCombo('Bonus'); }
      this.lastBonus = b;
    }
    if (m.caseType === 'whitening') this.hud.setShade(meanShade(m));
    this.hud.setDozing(m.dozing);
  }

  private currentMood(): Mood {
    const m = this.model;
    if (m.time - m.lastHurt < 1.1 || m.comfort < 30 || m.gagWarned) return 'pain';
    if (m.time < this.wowUntil) return 'wow';
    return m.comfort > 60 ? 'happy' : 'neutral';
  }

  // ---------------------------------------------------------------- tools

  private useTool(dt: number) {
    const sc = this.scene!;
    const slot = this.slot!;
    const out = this.useOut;
    const ptr = this.ptrs.get(this.toolPtr);
    if (!ptr) return;
    const hit = this.pickAt(ptr.x, ptr.y - ptr.off, slot);
    this.toolTouching = hit.kind !== 'none' && hit.kind !== 'face';
    const m = this.model;
    if (hit.kind === 'tooth' || hit.kind === 'bracket') { this.toolAt.tooth = hit.tooth; this.toolAt.u = hit.u; this.toolAt.v = hit.v; }
    const onTooth = hit.kind === 'tooth';
    if (onTooth && toothBlocked(m, hit.tooth) && m.doze > 0) this.hint('doze', 'Nudge them awake', hit.point);
    // hold time on one tooth (wrap assist)
    if (onTooth && hit.tooth === this.holdTooth) this.holdTime += dt;
    else { this.holdTooth = onTooth ? hit.tooth : -1; this.holdTime = 0; }
    switch (slot) {
      case 'scaler': {
        const tool = toolTier('scaler', this.setup.tools.scaler);
        out.gumRisk = tool.gumRisk;
        // a red gum pocket: hold the scaler on it to open it
        let pocket = hit.kind === 'pocket' ? hit.pocket : -1;
        if (pocket < 0 && hit.kind === 'gum') { const pk = sc.pocketNear(hit.point, 0.4); if (pk) pocket = pk.id; }
        if (pocket < 0 && onTooth && hit.v < 0.12) { const pk = sc.pocketNear(hit.point, 0.32); if (pk) pocket = pk.id; }
        if (pocket >= 0 && applyPocket(m, pocket, dt)) {
          out.working = true;
          this.loopVol.ultrasonic_loop = 0.25;
          if (Math.random() < dt * 10) sc.fx.flakes(this.rootLocal(hit.point, this.v2), this.v3.copy(hit.normal), 1, '#FF7A8E', 0.8, 0.5);
          this.lastTooth = -1;
          break;
        }
        if (hit.kind === 'gum') {
          // aim assist: slipping just off a gumline lump still scrapes the lump, not the gum
          const near = sc.nearestDeposit(hit.point, 0.32);
          if (near) { hit.kind = 'tooth'; hit.tooth = near.tooth; hit.u = near.u; hit.v = Math.max(0.03, near.v); }
        }
        if (hit.kind === 'bracket') { this.clink(hit); this.lastTooth = -1; break; }
        if (hit.kind === 'tooth') {
          const stroke = this.lastTooth === hit.tooth ? hit.point.distanceTo(this.lastPoint) : 0;
          const r = applyScaler(m, hit.tooth, hit.u, hit.v, stroke, dt);
          out.working = true;
          out.scaling = tool.timeBased || stroke > 0.004;
          out.molar = isMolar(hit.tooth);
          out.gum = hit.v < 0.02;
          if (tool.timeBased) {
            this.loopVol.ultrasonic_loop = 0.55;
            if (r.plaque > 0.05 && Math.random() < 0.3) this.dust(hit, '#F2DE8A', 1);
            if (Math.random() < dt * 14) sc.fx.drop(this.rootLocal(hit.point, this.v2), (Math.random() - 0.5) * 2, 1 + Math.random(), 1 + Math.random(), 0.07, 0.4);
          } else {
            this.strokeAcc += stroke;
            if (this.strokeAcc > 0.22) {
              this.strokeAcc = 0;
              const k = (['scrape_1', 'scrape_2', 'scrape_3'] as SfxKey[])[Math.floor(Math.random() * 3)];
              this.sfx(k, 0.35 + Math.min(0.4, r.plaque * 0.5), 0.9 + Math.random() * 0.25);
            }
            if (r.plaque > 0.08 && Math.random() < 0.35) this.dust(hit, '#F2DE8A', 1);
          }
          this.lastTooth = hit.tooth;
          this.lastPoint.copy(hit.point);
        } else if (hit.kind === 'gum') {
          out.working = true; out.gum = true; out.scaling = true;
          this.lastTooth = -1;
        } else this.lastTooth = -1;
        break;
      }
      case 'polisher': {
        if (hit.kind === 'bracket') { this.clink(hit); break; }
        if (onTooth) {
          const moving = Math.min(1, this.ptrSpeed / 350);
          const r = applyPolisher(m, hit.tooth, hit.u, hit.v, dt, moving, this.holdTime);
          out.working = true;
          out.molar = isMolar(hit.tooth);
          this.loopVol.polish_loop = 0.45 + 0.25 * moving;
          sc.setWrap(hit.tooth, hit.v, (wrapRate(this.holdTime) - 0.4) / 0.3, '#FFE7F0');
          if (r.stain > 0.02 && Math.random() < 0.5) this.dust(hit, '#9A6A3A', 1);
          if (r.plaque > 0.02 && Math.random() < 0.4) this.dust(hit, '#F2DE8A', 1);
          if (Math.random() < dt * 8) sc.fx.flakes(this.rootLocal(hit.point, this.v2), this.v3.copy(hit.normal), 1, '#FFB3C9', 0.9, 0.45);
          if (r.polish > 0.05 && Math.random() < 0.3) sc.fx.sparkle(this.rootLocal(hit.point, this.v2), 1, 0.18, 0.1);
          if (toolTier('polisher', this.setup.tools.polisher).water > 0 && Math.random() < dt * 30) this.sprayAt(hit, 1);
        } else this.loopVol.polish_loop = 0.25;
        break;
      }
      case 'floss': {
        if (this.setup.tools.floss >= 3 && this.toolTouching) {
          // water flosser: point at a gap or a bracket and hold
          const tg = this.nearestTarget(hit, ptr.x, ptr.y - ptr.off);
          if (tg) {
            applyWaterFloss(m, tg.target.a, tg.target.b, dt);
            out.working = true;
            out.molar = isMolar(tg.target.a);
          }
          this.loopVol.rinse_loop = 0.35;
          if (Math.random() < dt * 40) this.sprayAt(hit, 1);
        }
        break;
      }
      case 'suction': {
        if (this.toolTouching) {
          const l = this.rootLocal(hit.point, this.v2);
          l.sub(sc.lower.position);
          const resting = applySuction(m, l.x, l.y, l.z, dt);
          this.loopVol.suction_loop = 0.5 + (m.water > 0.02 ? 0.3 : 0);
          out.working = hit.kind === 'tooth';
          if (resting > 0 && !m.bits.some((b) => b.state === 'floating')) this.hint('rinse', 'Rinse first', hit.point);
          if (m.water > 0.02 && Math.random() < dt * 12) sc.fx.drop(l.add(sc.lower.position), (Math.random() - 0.5), 1.5, 0.5, 0.06, 0.25);
        }
        break;
      }
      case 'rinse': {
        if (this.toolTouching) {
          const l = this.rootLocal(hit.point, this.v2);
          applyRinse(m, l.x, l.y < 0 ? l.y - sc.lower.position.y : l.y, l.z, dt);
          this.loopVol.rinse_loop = 0.5;
          if (Math.random() < dt * 60) this.sprayAt(hit, 2);
        }
        break;
      }
      case 'gel': {
        if (hit.kind === 'bracket') { this.clink(hit); break; }
        if (onTooth) {
          const added = applyGel(m, hit.tooth, hit.u, hit.v, dt, this.holdTime);
          out.working = true;
          out.molar = isMolar(hit.tooth);
          sc.setWrap(hit.tooth, m.caseType === 'whitening' ? hit.v : 0.95, (wrapRate(this.holdTime) - 0.4) / 0.3, m.caseType === 'whitening' ? '#9FE8FF' : '#FFFFFF');
          this.gelSfxT -= dt;
          if (added > 0.02 && this.gelSfxT <= 0) { this.gelSfxT = 0.32; this.sfx('gel_paint', 0.45, 0.9 + Math.random() * 0.2); }
          if (added > 0.02 && Math.random() < dt * 10) sc.fx.drop(this.rootLocal(hit.point, this.v2), 0, 0.3, 0.3, 0.05, 0.3);
        }
        break;
      }
      case 'lamp': {
        if (onTooth) {
          applyLamp(m, hit.tooth, dt);
          out.working = true;
          out.molar = isMolar(hit.tooth);
          sc.setLamp(hit.point, hit.tooth, this.toolNozzleWorld(this.v4));
          this.loopVol.lamp_loop = 0.45;
          const t = m.teeth[hit.tooth];
          if (t.gelTarget && gelCoverage(m, hit.tooth) < 0.45) this.hint('gel', 'Paint gel first', hit.point);
        } else this.loopVol.lamp_loop = 0.15;
        break;
      }
    }
    // loupes: outline dirt around the brush
    if (this.setup.tools.extras.includes('loupes') && onTooth) sc.shared.uBrush.value.set(hit.point.x, hit.point.y, hit.point.z, 0.45);
    else sc.shared.uBrush.value.w = 0;
  }

  private clink(hit: Hit) {
    if (this.model.time - this.clinkT < 0.22) return;
    this.clinkT = this.model.time;
    this.sfx('coin_clink', 0.3, 1.7 + Math.random() * 0.2);
    this.scene!.fx.sparkle(this.rootLocal(hit.point, this.v2), 2, 0.08, 0.14, '#FFFFFF', 0.3);
    this.hint('bracket', 'Brackets block that spot', hit.point);
  }

  /** A short floating hint, at most once per 5 s per kind. */
  private hint(kind: string, text: string, world: THREE.Vector3 | null) {
    const now = this.elapsed;
    if (now - (this.hints.get(kind) ?? -99) < 5) return;
    this.hints.set(kind, now);
    if (world) this.project(world, this.s2);
    else { this.s2.x = this.width / 2; this.s2.y = this.height * 0.4; }
    this.hud.float(this.s2.x, this.s2.y - 26, text, 'hint');
  }

  // ---------------------------------------------------------------- floss (DESIGN 5.4)

  /** Every place that still needs floss: debris in gaps and food under the wire at brackets. */
  private flossTargets(): Debris[] {
    return this.model.debris.filter((d) => !d.popped);
  }

  /** The marker point of a floss target (world): the outward edge of the gap at the contact, or the bracket. */
  private targetPoint(d: Debris, out: THREE.Vector3): THREE.Vector3 {
    const sc = this.scene!;
    sc.gapPoints(d.a, d.b, this.v5, this.v6);
    const s = d.bracket ? 0.55 : 1 - d.v;
    return out.lerpVectors(this.v6, this.v5, THREE.MathUtils.clamp(s, 0.2, 0.8));
  }

  private nearestTarget(hit: Hit, x: number, y: number): { target: FlossTarget; deb: Debris } | null {
    let best: Debris | null = null, bd = Infinity;
    for (const d of this.flossTargets()) {
      const p = this.targetPoint(d, this.v1);
      let dist: number;
      if (hit.kind !== 'none' && hit.kind !== 'face') dist = p.distanceTo(hit.point) / HOOK_RADIUS;
      else dist = Infinity;
      this.project(p, this.s2);
      dist = Math.min(dist, Math.hypot(this.s2.x - x, this.s2.y - y) / 34);
      if (dist < 1 && dist < bd) { bd = dist; best = d; }
    }
    return best ? { target: { a: best.a, b: best.b }, deb: best } : null;
  }

  private tryHook(x: number, y: number, hit: Hit) {
    const found = this.nearestTarget(hit, x, y);
    if (!found) {
      this.hint('gap', this.flossTargets().length ? 'Press a glowing gap' : 'No food left to floss', hit.point);
      return;
    }
    const sc = this.scene!;
    const d = found.deb;
    const gum = new THREE.Vector3(), tip = new THREE.Vector3();
    sc.gapPoints(d.a, d.b, gum, tip);
    const gs = this.project(gum, { x: 0, y: 0 }), ts = this.project(tip, { x: 0, y: 0 });
    let ax = gs.x - ts.x, ay = gs.y - ts.y;
    const len = Math.max(40, Math.hypot(ax, ay));
    const l = Math.hypot(ax, ay) || 1;
    ax /= l; ay /= l;
    const aim: FlossAim = {
      target: found.target, bracket: d.bracket, debId: d.id, gum, tip, axis: { x: ax, y: ay }, len,
      perp0: -ay * x + ax * y, lastAlong: ax * x + ay * y,
    };
    this.flAim = aim;
    flossHook(this.fl, !!this.setup.special?.braces, d.bracket);
    if (this.fl.phase === 'thread') this.sfx('floss_creak', 0.25, 1.4);
    else this.sfx('floss_snap', 0.35, 1.3);
    this.vibe(6);
  }

  /** Pointer motion while hooked: split into the gap axis and the cross axis. */
  private flossPointer(x: number, y: number) {
    const a = this.flAim!;
    const along = a.axis.x * x + a.axis.y * y;
    const perp = -a.axis.y * x + a.axis.x * y;
    const dAlong = (along - a.lastAlong) / a.len;
    a.lastAlong = along;
    const cross = (perp - a.perp0) / a.len;
    this.flEvents.length = 0;
    flossMove(this.fl, dAlong, cross, this.flEvents);
    this.flossEvents();
  }

  private flossFrame(dt: number) {
    const ptr = this.ptrs.get(this.toolPtr);
    const still = !!ptr && Math.hypot(ptr.x - ptr.x0, ptr.y - ptr.y0) < 12;
    this.flEvents.length = 0;
    flossTick(this.fl, dt, still, this.flEvents);
    this.flossEvents();
    if (this.flAim) this.useOut.working = true;
    if (this.flAim) this.useOut.molar = isMolar(this.flAim.target.a);
  }

  private flossEvents() {
    const a = this.flAim;
    if (!a) return;
    const sc = this.scene!;
    for (const e of this.flEvents) {
      switch (e) {
        case 'creak': this.sfx('floss_creak', 0.45, 0.9 + Math.random() * 0.25); this.vibe(4); break;
        case 'press': this.sfx('floss_creak', 0.3, 1.2); break;
        case 'thwip': {
          this.sfx('floss_thwip', 0.85, 0.95 + Math.random() * 0.1);
          if (!this.settings.reducedMotion) this.cam.jolt(0.14);
          this.targetPoint(this.model.debris.find((d) => d.id === a.debId) ?? this.model.debris[0], this.v1);
          sc.fx.sparkle(this.rootLocal(this.v1, this.v2), 5, 0.12, 0.2, '#FFFFFF', 0.5);
          this.vibe(14);
          break;
        }
        case 'threaded': this.sfx('floss_thwip', 0.6, 1.25); this.vibe(10); break;
        case 'stroke': {
          const hitSome = flossStroke(this.model, a.target);
          this.sfx('floss_snap', hitSome ? 0.55 : 0.28, 0.85 + Math.random() * 0.3);
          const d = this.model.debris.find((x) => x.id === a.debId);
          if (d) this.targetPoint(d, this.v1); else sc.gapPoints(a.target.a, a.target.b, this.v1, this.v2);
          if (hitSome) sc.fx.flakes(this.rootLocal(this.v1, this.v3), this.v2.set(0, 0, 1), 3, '#F7E7A6', 1.2, 0.6);
          this.vibe(8);
          // popped: the floss slides out by itself
          if (d && d.popped) { flossRelease(this.fl); this.flAim = null; this.sfx('floss_zip', 0.5, 1.1); }
          break;
        }
        case 'zip': this.sfx('floss_zip', 0.7); this.flAim = null; break;
        case 'slip': this.sfx('floss_zip', 0.3, 1.3); this.flAim = null; break;
      }
    }
  }

  /** Floss visuals: markers on every target, the string between two gloved hands. */
  private updateMarkers(dt: number) {
    const sc = this.scene!;
    const show = this.slot === 'floss' && !this.finished;
    if (!show) { sc.setMarkers([], this.elapsed); sc.setFloss(null); this.hud.setThread(0, 0, -1); return; }
    const targets = this.flossTargets();
    while (this.markerPts.length < targets.length) this.markerPts.push(new THREE.Vector3());
    this.markerClock -= dt;
    const recheck = this.markerClock <= 0;
    if (recheck) this.markerClock = 0.2;
    const pts: THREE.Vector3[] = [];
    let focus = -1;
    for (let i = 0; i < targets.length; i++) {
      const p = this.targetPoint(targets[i], this.markerPts[i]);
      // only markers a camera can see (the doubloon hides behind the cheek until a side view)
      if (recheck) this.markerVis[i] = !sc.occluded(this.cam.camera.position, p);
      if (!this.markerVis[i]) continue;
      if (this.flAim && targets[i].id === this.flAim.debId) focus = pts.length;
      pts.push(p);
    }
    sc.setMarkers(this.flAim ? [] : pts, this.elapsed, focus);
    // the string
    const water = this.setup.tools.floss >= 3;
    const a = this.flAim;
    if (water) { sc.setFloss(null); return; }
    if (a && this.fl.phase !== 'idle') {
      const d = this.model.debris.find((x) => x.id === a.debId);
      const gum = a.gum, tip = a.tip;
      const s = THREE.MathUtils.clamp(this.fl.s, -0.3, 1);
      const handS = s + this.fl.pressure * 0.35 - this.fl.pull * 0.3;
      const mid = this.v1.lerpVectors(tip, gum, THREE.MathUtils.clamp(s, 0, 1));
      if (s < 0) mid.addScaledVector(this.v2.subVectors(tip, gum), -s);
      // outward normal and arch tangent at the gap
      const pa = this.model.placements[a.target.a], pb = this.model.placements[a.target.b];
      const n = this.v3.set((pa.nx + pb.nx) / 2, 0, (pa.nz + pb.nz) / 2).normalize();
      const tan = this.v4.set(n.z, 0, -n.x);
      const hand = this.v5.lerpVectors(tip, gum, THREE.MathUtils.clamp(handS, -0.3, 1.3)).addScaledVector(n, 0.55);
      hand.addScaledVector(tan, this.fl.bend * 0.8);
      const l = new THREE.Vector3().copy(hand).addScaledVector(tan, -0.7);
      const r = new THREE.Vector3().copy(hand).addScaledVector(tan, 0.7);
      mid.addScaledVector(n, a.bracket ? 0.05 : 0.02);
      const tension = Math.max(this.fl.pressure, this.fl.pull, Math.abs(this.fl.bend), this.fl.phase === 'through' ? 0.35 : 0);
      sc.setFloss(l, mid, r, this.cam.camera, tension);
      if (this.fl.phase === 'thread') {
        this.project(d ? this.targetPoint(d, this.v6) : mid, this.s2);
        this.hud.setThread(this.s2.x, this.s2.y, this.fl.thread);
      } else this.hud.setThread(0, 0, -1);
      return;
    }
    this.hud.setThread(0, 0, -1);
    // not hooked: slack string between the hands around the pointer
    const has = (this.mode === 'tool' || (this.hoverIn && this.mode === 'none')) && this.hit.kind !== 'none' && this.hit.kind !== 'face';
    if (!has) { sc.setFloss(null); return; }
    const c = this.v1.copy(this.hit.point).addScaledVector(this.hit.normal, 0.35);
    const camRight = this.v2.set(1, 0, 0).applyQuaternion(this.cam.camera.quaternion);
    const l = new THREE.Vector3().copy(c).addScaledVector(camRight, -0.8).addScaledVector(this.hit.normal, 0.3);
    const r = new THREE.Vector3().copy(c).addScaledVector(camRight, 0.8).addScaledVector(this.hit.normal, 0.3);
    sc.setFloss(l, c, r, this.cam.camera, 0);
  }

  private dust(hit: Hit, color: string, n: number) {
    const sc = this.scene!;
    const p = this.rootLocal(hit.point, this.v3);
    sc.fx.flakes(p, this.v4.copy(hit.normal), n, color, 1.2, 0.55);
  }

  private sprayAt(hit: Hit, n: number) {
    const sc = this.scene!;
    const nozzle = this.toolNozzleWorld(this.v3);
    const from = this.rootLocal(nozzle, this.v4);
    const to = this.rootLocal(hit.point, this.v2);
    for (let i = 0; i < n; i++) {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      const t = 0.18;
      sc.fx.drop(from, dx / t + (Math.random() - 0.5) * 1.5, dy / t + (Math.random() - 0.5) * 1.5 + 1.2, dz / t + (Math.random() - 0.5) * 1.5, 0.07 + Math.random() * 0.06, 0.3);
    }
    if (Math.random() < 0.3) sc.fx.splash(to, 2, 1.2);
  }

  private toolNozzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const sc = this.scene!;
    if (!this.slot) return out.copy(this.toolPos);
    const t = sc.tools[this.slot];
    return t.parts.group.localToWorld(out.copy(t.parts.nozzle));
  }

  /** Place the active tool: tip on the surface under the pointer, handle toward the camera's lower right. */
  private poseTool(dt: number) {
    const sc = this.scene!;
    const slot = this.slot;
    const stringFloss = slot === 'floss' && this.setup.tools.floss < 3;
    for (const k of this.slots) sc.tools[k].holder.visible = k === slot && !this.finished && !stringFloss;
    const tp = this.ptrs.get(this.toolPtr);
    this.hud.setReticle(this.hoverX, this.hoverY, !!tp && tp.off > 0 && this.mode === 'tool', this.toolTouching);
    if (!slot || stringFloss) { this.renderer!.domElement.style.cursor = this.mode === 'orbit' ? 'grabbing' : 'crosshair'; if (stringFloss && this.mode !== 'tool' && this.hoverIn) this.pickAt(this.hoverX, this.hoverY, slot); return; }
    const t = sc.tools[slot];
    const pressing = this.mode === 'tool';
    let has = false;
    if (pressing) has = this.hit.kind !== 'none' && this.hit.kind !== 'face';
    else if (this.hoverIn && this.mode === 'none') {
      this.pickAt(this.hoverX, this.hoverY, slot);
      has = this.hit.kind !== 'none' && this.hit.kind !== 'face';
      if (this.setup.tools.extras.includes('loupes') && this.hit.kind === 'tooth') sc.shared.uBrush.value.set(this.hit.point.x, this.hit.point.y, this.hit.point.z, 0.45);
    }
    const cam = this.cam.camera;
    const canvas = this.renderer!.domElement;
    canvas.style.cursor = this.mode === 'orbit' ? 'grabbing' : has ? 'none' : 'grab';
    const target = this.v1;
    const normal = this.v2;
    if (has) {
      normal.copy(this.hit.normal);
      const lift = pressing ? (slot === 'suction' || slot === 'rinse' ? 0.12 : slot === 'lamp' ? 0.9 : 0.015) : slot === 'lamp' ? 1.1 : 0.35;
      target.copy(this.hit.point).addScaledVector(normal, lift);
      this.toolTip.copy(this.hit.point);
      this.lastNormal.copy(normal);
      this.everTouched = true;
    } else {
      if (!this.everTouched || (this.hoverIn && this.mode === 'none')) { t.holder.visible = false; return; }
      normal.copy(this.lastNormal);
      target.copy(this.toolTip).addScaledVector(normal, 0.5);
    }
    const toCam = this.v3.copy(cam.position).sub(target).normalize();
    const right = this.v4.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = this.pUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const Y = this.pY.copy(toCam).multiplyScalar(0.55).addScaledVector(right, 0.5).addScaledVector(up, -0.42).addScaledVector(normal, 0.25);
    if (slot === 'lamp') Y.copy(toCam).multiplyScalar(0.7).addScaledVector(right, 0.35).addScaledVector(up, -0.3);
    Y.normalize();
    const Z = this.pZ.copy(normal).addScaledVector(Y, -normal.dot(Y));
    if (Z.lengthSq() < 1e-4) Z.copy(toCam).addScaledVector(Y, -toCam.dot(Y));
    Z.normalize();
    const X = this.pX.crossVectors(Y, Z).normalize();
    this.m1.makeBasis(X, Y, Z);
    this.q1.setFromRotationMatrix(this.m1);
    const k = pressing ? 1 - Math.exp(-dt * 40) : 1 - Math.exp(-dt * 16);
    if (!t.holder.visible || this.toolPos.distanceTo(target) > 6) { this.toolPos.copy(target); this.toolQuat.copy(this.q1); }
    this.toolPos.lerp(target, k);
    this.toolQuat.slerp(this.q1, k);
    t.holder.position.copy(this.toolPos);
    t.holder.quaternion.copy(this.toolQuat);
    // keep the tool about the same size on screen when the camera moves in close
    t.holder.scale.setScalar(THREE.MathUtils.clamp(this.cam.camera.position.distanceTo(this.toolPos) / 12, 0.5, 1.05));
    const touching = this.toolTouching;
    const time = this.elapsed;
    if (slot === 'scaler' && touching && toolTier('scaler', this.setup.tools.scaler).timeBased) {
      t.holder.position.x += Math.sin(time * 173) * 0.018; t.holder.position.y += Math.cos(time * 151) * 0.018;
    }
    if (t.spinner) t.spinner.rotation[t.parts.spinAxis] += dt * (touching ? 38 : 7) * (0.5 + 0.5 * Math.min(1, this.ptrSpeed / 350));
    if (slot === 'suction' && touching) t.parts.group.scale.setScalar(0.72 * (1 + Math.sin(time * 22) * 0.015));
  }

  private rootLocal(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return this.scene!.root.worldToLocal(out.copy(world));
  }

  private project(world: THREE.Vector3, out: { x: number; y: number }) {
    const v = this.v6.copy(world).project(this.cam.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    return out;
  }

  // ---------------------------------------------------------------- events -> juice

  private drainEvents() {
    const evs = this.model.events;
    if (!evs.length) return;
    for (let i = 0; i < evs.length; i++) this.onEvent(evs[i]);
    evs.length = 0;
  }

  private onEvent(e: CleanEvent) {
    const sc = this.scene!;
    const motion = !this.settings.reducedMotion;
    switch (e.type) {
      case 'tartarHit': {
        const w = sc.depositWorld(e.dep.id, this.v1);
        if (w) {
          const n = this.hit.kind === 'tooth' ? this.hit.normal : this.v2.set(0, 0, 1);
          sc.fx.flakes(this.rootLocal(w, this.v3), n, 4 + Math.floor(Math.random() * 3), e.dep.kind === 'barnacle' ? '#E9E4D6' : '#D8B04A', 2.2, 0.9);
        }
        this.sfx('flake', 0.55, 0.85 + Math.random() * 0.4);
        if (motion) { this.hitch = Math.max(this.hitch, 0.02); this.cam.shake(0.02, 0.08); }
        this.vibe();
        break;
      }
      case 'tartarCrack': {
        const w = sc.depositWorld(e.dep.id, this.v1);
        const shell = e.dep.kind === 'barnacle';
        if (w) sc.fx.flakes(this.rootLocal(w, this.v3), this.v2.set(0, 0.5, 1).normalize(), e.stage === 2 ? 9 : 6, shell ? '#F1ECDF' : '#D8B04A', 2.6, 1);
        this.sfx(shell ? 'shell_crack' : e.stage === 2 ? 'crack_big' : 'flake', e.stage === 2 ? 0.7 : 0.6, 0.95 + Math.random() * 0.2);
        if (w && e.stage === 2) { this.project(w, this.s1); this.hud.float(this.s1.x, this.s1.y - 10, 'Crack', 'gold'); }
        if (motion) { this.hitch = Math.max(this.hitch, 0.035); this.cam.shake(0.05, 0.12); }
        this.vibe(10);
        break;
      }
      case 'tartarPop': {
        const big = e.dep.size >= 1.2 || e.dep.kind === 'barnacle';
        const shell = e.dep.kind === 'barnacle';
        const w = sc.popDeposit(e.dep, this.v1);
        const l = this.rootLocal(w, this.v3);
        sc.fx.flakes(l, this.v2.set(0, 0.6, 1).normalize(), big ? 18 : 12, shell ? '#EDE6D2' : '#D8B04A', 3, 1.1);
        sc.fx.sparkle(l, big ? 12 : 8, 0.35, 0.45, '#FFF6D0');
        this.sfx('crunch_pop', 0.9, 0.85 + Math.random() * 0.35);
        if (shell) this.sfx('shell_crack', 0.8, 0.8);
        else if (big) this.sfx('crack_big', 0.8, 0.9 + Math.random() * 0.2);
        for (const b of e.bits) sc.addBit(b);
        this.project(w, this.s1);
        this.hud.float(this.s1.x, this.s1.y, e.dep.kind === 'hidden' ? 'Got it' : big ? 'Crack' : 'Pop', 'gold');
        if (e.combo >= 2) { this.hud.showCombo(`Combo x${e.combo}`); this.sfx('combo', 0.6, 0.9 + Math.min(0.6, e.combo * 0.06)); }
        if (motion) { this.hitch = Math.max(this.hitch, big ? 0.09 : 0.05); this.cam.shake(big ? 0.12 : 0.05, big ? 0.25 : 0.14); }
        this.vibe(big ? 20 : 12);
        this.wowUntil = this.model.time + 0.8;
        break;
      }
      case 'debrisHit': {
        const w = sc.debrisWorld(e.deb.id, this.v1);
        if (w) sc.fx.sparkle(this.rootLocal(w, this.v2), 2, 0.1, 0.15, '#FFFFFF', 0.4);
        break;
      }
      case 'debrisPop': {
        const w = sc.popDebris(e.deb, this.v1);
        const l = this.rootLocal(w, this.v3);
        for (const b of e.bits) sc.addBit(b);
        this.project(w, this.s1);
        if (e.deb.kind === 'doubloon') {
          sc.fx.sparkle(l, 22, 0.5, 0.5, '#FFD866', 1.6);
          this.sfx('coin_clink', 1, 1);
          window.setTimeout(() => { if (!this.disposed) this.sfx('coin_clink', 0.7, 1.25); }, 180);
          window.setTimeout(() => { if (!this.disposed) this.sfx('arr', 0.8); }, 650);
          this.hud.float(this.s1.x, this.s1.y - 20, 'Treasure', 'gold');
          this.hud.showCombo('Doubloon');
          this.vibe(30);
        } else {
          sc.fx.sparkle(l, 10, 0.3, 0.4, '#FFFFFF');
          this.sfx('debris_pop', 0.9, 0.9 + Math.random() * 0.3);
          this.hud.float(this.s1.x, this.s1.y, 'Pop', 'pink');
          if (e.combo >= 2) { this.hud.showCombo(`Combo x${e.combo}`); this.sfx('combo', 0.6, 0.9 + Math.min(0.6, e.combo * 0.06)); }
          this.vibe(12);
        }
        if (motion) this.cam.shake(0.04, 0.12);
        this.wowUntil = this.model.time + 0.8;
        break;
      }
      case 'toothSnap': {
        sc.snapTooth(e.tooth);
        sc.toothCenter(e.tooth, this.v1);
        sc.fx.sparkle(this.rootLocal(this.v1, this.v3), 16, 0.55, 0.42, '#FFFFFF', 1.2);
        // the chime rises a step with every tooth snapped this clean
        this.sfx('tooth_done', 0.85, Math.min(2, Math.pow(2, (e.n - 1) / 12 * 2)));
        this.project(this.v1, this.s1);
        this.hud.float(this.s1.x, this.s1.y - 20, 'Clean', 'mint');
        this.wowUntil = this.model.time + 1.2;
        this.vibe(10);
        break;
      }
      case 'bitFloat': sc.floatBit(e.bit); break;
      case 'bitSucked': {
        if (this.slot === 'suction' && this.toolTouching) sc.suckBit(e.bit, this.toolTip);
        else sc.removeBitNow(e.bit);
        this.sfx('splash', 0.25, 1.4 + Math.random() * 0.2);
        break;
      }
      case 'pasteRinsed': {
        sc.rinseReveal(e.tooth);
        sc.toothCenter(e.tooth, this.v1);
        sc.fx.sparkle(this.rootLocal(this.v1, this.v3), 5, 0.4, 0.3, '#FFFFFF', 1.4);
        if (this.model.time - this.clinkT > 0.25) { this.clinkT = this.model.time; this.sfx('sparkle', 0.45, 1 + Math.random() * 0.3); }
        break;
      }
      case 'bugSquash': {
        const w = sc.squashBug(e.bug, this.v1);
        const l = this.rootLocal(w, this.v3);
        sc.fx.flakes(l, this.v2.set(0, 0.5, 1).normalize(), 10, '#C77DFF', 2.2, 0.8);
        sc.fx.flakes(l, this.v2, 5, '#FF7AC8', 1.8, 0.7);
        this.sfx('squish', 0.9, 0.9 + Math.random() * 0.25);
        this.project(w, this.s1);
        this.hud.float(this.s1.x, this.s1.y, 'Squish', 'violet');
        if (e.combo >= 2) { this.hud.showCombo(`Combo x${e.combo}`); this.sfx('combo', 0.6, 0.9 + Math.min(0.6, e.combo * 0.06)); }
        if (motion) { this.hitch = Math.max(this.hitch, 0.05); this.cam.shake(0.05, 0.12); }
        this.vibe(16);
        this.wowUntil = this.model.time + 0.8;
        break;
      }
      case 'bugSpread': break;
      case 'gelDone': {
        sc.toothCenter(e.tooth, this.v1);
        sc.fx.sparkle(this.rootLocal(this.v1, this.v3), 6, 0.35, 0.3, e.seal ? '#FFFFFF' : '#A9ECFF', 1);
        this.sfx(e.seal ? 'tooth_ding' : 'gel_paint', 0.6, 1.2);
        if (e.seal) { this.project(this.v1, this.s1); this.hud.float(this.s1.x, this.s1.y - 20, 'Sealed', 'mint'); }
        break;
      }
      case 'shadeTick': {
        sc.toothCenter(e.tooth, this.v1);
        sc.fx.sparkle(this.rootLocal(this.v1, this.v3), 3, 0.3, 0.25, '#FFFFFF', 0.8);
        const s0 = this.setup.special?.startShade || 12;
        this.sfx('shade_tick', 0.55, 0.9 + Math.min(0.8, (s0 - e.shade) * 0.08));
        break;
      }
      case 'zing': {
        this.hud.say('Ooh, cold!', 1300);
        this.hud.wince();
        this.sfx('ow', 0.5, 1.3);
        this.hud.hurtFlash();
        break;
      }
      case 'goldShine': {
        sc.toothCenter(e.tooth, this.v1);
        const l = this.rootLocal(this.v1, this.v3);
        sc.fx.sparkle(l, 24, 0.5, 0.55, '#FFE27A', 1.4);
        this.sfx('gold_ting', 1);
        this.project(this.v1, this.s1);
        this.hud.float(this.s1.x, this.s1.y - 20, 'Shiny', 'gold');
        this.wowUntil = this.model.time + 1.4;
        break;
      }
      case 'pocketOpen': {
        const w = sc.pocketWorld(e.pocket.id, this.v1);
        if (w) sc.fx.flakes(this.rootLocal(w, this.v3), this.v2.set(0, 0.4, 1).normalize(), 8, '#FF6B81', 1.8, 0.6);
        this.sfx('pocket_open', 0.85);
        if (w) { this.project(w, this.s1); this.hud.float(this.s1.x, this.s1.y, 'Opened', 'pink'); }
        this.vibe(12);
        break;
      }
      case 'pocketHeal': {
        const w = sc.pocketWorld(e.pocket.id, this.v1);
        if (w) sc.fx.sparkle(this.rootLocal(w, this.v3), 14, 0.4, 0.4, '#FFD6E2', 1);
        this.sfx('sparkle', 0.7, 1.1);
        if (w) { this.project(w, this.s1); this.hud.float(this.s1.x, this.s1.y - 16, 'Healed', 'mint'); }
        break;
      }
      case 'objective': {
        this.sfx('check', 0.9);
        this.hud.setObjectives(this.model.objectives);
        break;
      }
      case 'ow': {
        this.hud.say(this.setup.patient.archetype === 'mannequin' ? '(clunk)' : 'Ow!', 1400);
        this.hud.wince();
        this.hud.hurtFlash();
        this.sfx('ow', 0.8, 0.9 + Math.random() * 0.2);
        if (this.hit.kind !== 'none') { this.project(this.hit.point, this.s1); this.hud.float(this.s1.x, this.s1.y, 'Ow', 'ow'); }
        this.vibe(25);
        break;
      }
      case 'gagWarn': {
        this.hud.say('Hng...', 1200);
        this.sfx('gag', 0.22, 1.35);
        break;
      }
      case 'gag': {
        this.hud.say('Hurk!', 1600);
        this.hud.wince();
        this.sfx('gag', 0.9);
        if (motion) this.cam.shake(0.3, 0.5);
        this.releaseTool();
        this.vibe(40);
        break;
      }
      case 'hic': {
        this.hud.say('hic!', 900, 'tell');
        this.sfx('hiccup', 0.8);
        break;
      }
      case 'jolt': {
        this.joltAnim = 0.35;
        if (motion) this.cam.jolt(0.2);
        this.vibe(15);
        break;
      }
      case 'doze': {
        this.hud.say('Zzz...', 1800, 'tell');
        this.snoreT = 0.8;
        break;
      }
      case 'wake': {
        this.hud.say('Huh? I am awake.', 1400);
        this.sfx('mmhm', 0.6, 1.1);
        break;
      }
      case 'chat': {
        this.hud.say(e.line, e.closesJaw ? 2400 : 2800);
        this.sfx(e.closesJaw ? 'chatter' : this.setup.patient.archetype === 'kid' ? 'giggle' : 'mmhm', 0.6);
        if (e.closesJaw) this.releaseTool();
        break;
      }
      case 'reassure': {
        this.sfx('reassure', 0.7);
        if (!this.model.tw.sleepy) this.hud.say(this.setup.patient.archetype === 'mannequin' ? '...' : REASSURE_LINES[Math.floor(Math.random() * REASSURE_LINES.length)], 1500);
        const r = this.hud.root.querySelector('.fbc-portrait')!.getBoundingClientRect();
        const h = this.root.getBoundingClientRect();
        this.hud.float(r.left - h.left + r.width / 2, r.top - h.top + 10, `+${Math.round(e.amount)}`, 'pink');
        break;
      }
      case 'walkout': {
        this.walkout();
        break;
      }
    }
  }

  private sfx(key: SfxKey, volume = 1, rate = 1) {
    try { audio.play(key, { volume, rate }); } catch { /* audio is optional */ }
  }

  private vibe(ms = 8) {
    if (!this.settings.haptics) return;
    const now = performance.now();
    if (now - this.lastVibe < 60) return;
    this.lastVibe = now;
    try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
  }

  // ---------------------------------------------------------------- tutorial

  private startTutorial() {
    this.tut = 0;
    this.showTutorial();
  }

  private showTutorial() {
    if (this.tut < 0) return;
    if (this.tut >= TUTORIAL_STEPS.length) { this.endTutorial(); return; }
    const sc = this.scene;
    if (sc) for (const tv of sc.teeth) if (tv) tv.tm.highlight.value = 0;
    this.tutDep = -1;
    switch (this.tut) {
      case 1: {
        const d = this.model.tartar.find((x) => !x.popped && !x.hidden);
        if (d) { this.tutDep = d.id; this.focus(d.tooth); }
        break;
      }
      case 2: {
        let best = -1, bs = 0;
        for (const i of this.model.problem) {
          const s = this.faceStain(i);
          if (s > bs) { bs = s; best = i; }
        }
        this.tutStainTooth = best;
        this.tutStain0 = best >= 0 ? this.faceStain(best) : 0;
        if (best < 0 || this.tutStain0 <= 0.5) { this.tut++; this.showTutorial(); return; }
        this.focus(best);
        if (sc?.teeth[best]) sc.teeth[best]!.tm.highlight.value = 1;
        break;
      }
      case 3: {
        const d = this.model.debris.find((x) => !x.popped);
        if (!d) { this.tut++; this.showTutorial(); return; }
        this.focus(d.a);
        if (sc) { if (sc.teeth[d.a]) sc.teeth[d.a]!.tm.highlight.value = 1; if (sc.teeth[d.b]) sc.teeth[d.b]!.tm.highlight.value = 1; }
        break;
      }
      case 4: this.setView('lower'); this.tutWaterPeak = 0; break;
      case 5: this.setView('front'); break;
    }
    this.hud.tutorial(this.tut + 1, TUTORIAL_STEPS.length, TUTORIAL_STEPS[this.tut], this.tutorialTarget());
  }

  private faceStain(i: number): number {
    const t = this.model.teeth[i];
    let s = 0;
    for (let c = 0; c < t.stain.length; c++) {
      const u = cellCenterU(c), v = cellCenterV(c);
      if (v < 0.86 && Math.abs(u - 0.5) < 0.22) s += t.stain[c];
    }
    return s;
  }

  private tutorialTarget(): HTMLElement | null {
    switch (this.tut) {
      case 0: return this.hud.slotEl('scaler');
      case 1: return this.slot === 'scaler' ? null : this.hud.slotEl('scaler');
      case 2: return this.slot === 'polisher' ? null : this.hud.slotEl('polisher');
      case 3: return this.slot === 'floss' ? null : this.hud.slotEl('floss');
      case 4: {
        const floating = this.model.bits.some((b) => b.state === 'floating');
        const resting = this.model.bits.some((b) => b.state === 'resting');
        const needRinse = resting || messState(this.model).paste > 0 || this.tutWaterPeak < 0.12;
        if (needRinse && !floating) return this.slot === 'rinse' ? null : this.hud.slotEl('rinse');
        return this.slot === 'suction' ? null : this.hud.slotEl('suction');
      }
      case 5: return cleanScore(this.model) >= 0.7 ? this.hud.done : this.hud.caseEl;
    }
    return null;
  }

  private tutorialTick() {
    if (this.tut < 0) return;
    const m = this.model;
    let next = false;
    switch (this.tut) {
      case 0: next = this.slot === 'scaler'; break;
      case 1: next = m.chunks >= 1 || !m.tartar.some((d) => !d.popped && !d.hidden); break;
      case 2: {
        if (this.tutStainTooth < 0) { next = true; break; }
        next = m.teeth[this.tutStainTooth].snapped || this.faceStain(this.tutStainTooth) <= this.tutStain0 * 0.5;
        break;
      }
      case 3: next = !m.debris.some((d) => !d.popped); break;
      case 4: {
        this.tutWaterPeak = Math.max(this.tutWaterPeak, m.water);
        const s = messState(m);
        next = this.tutWaterPeak >= 0.12 && s.resting === 0 && s.floating === 0 && m.water <= 0.05;
        break;
      }
      default: break;
    }
    if (next) { this.tut++; this.sfx('star', 0.6); this.showTutorial(); }
    else this.hud.pulse(this.tutorialTarget());
  }

  private endTutorial() {
    this.tut = -1;
    this.tutDep = -1;
    if (this.scene) for (const tv of this.scene.teeth) if (tv) tv.tm.highlight.value = 0;
    this.hud.endTutorial();
  }

  // ---------------------------------------------------------------- finish

  private walkout() {
    if (this.finished) return;
    this.finished = true;
    this.releaseTool();
    this.stopLoops();
    this.endTutorial();
    const result = scoreClean(this.model, 'walkout', this.elapsed);
    this.hud.notice(`${this.setup.patient.name} walked out`);
    this.sfx('review_bad', 0.6);
    this.needAfter = result;
    window.setTimeout(() => this.resolve(result), 1700);
  }

  finish(quit: 'done' | 'abort') {
    if (this.finished) return;
    this.finished = true;
    this.releaseTool();
    this.stopLoops();
    this.endTutorial();
    const result = scoreClean(this.model, quit, this.elapsed);
    if (quit === 'abort' || !this.scene) { this.resolve(result); return; }
    // the after shot is rendered on the next frame, then the finale (if perfect) or the result
    this.needAfter = result;
  }

  private afterDone(result: CleanResult) {
    if (result.quit === 'walkout') return;
    if (result.perfect && this.scene) this.finale(result);
    else this.resolve(result);
  }

  private finale(result: CleanResult) {
    const sc = this.scene!;
    this.cam.view('front');
    this.hud.setView('front');
    this.sfx('perfect', 0.9);
    this.hud.finale('Sparkling Smile', 'Perfect clean');
    let n = 0;
    const burst = () => {
      if (this.disposed) return;
      for (let k = 0; k < 4; k++) {
        const i = Math.floor(Math.random() * TOOTH_COUNT);
        const tv = sc.teeth[i];
        if (!tv) continue;
        tv.tm.flash.value = 0.8;
        sc.toothCenter(i, this.v1);
        sc.fx.sparkle(this.rootLocal(this.v1, this.v3), 8, 0.6, 0.42, k % 2 ? '#FFF6D0' : '#FFFFFF', 1.4);
      }
      if (n % 3 === 0) this.sfx('sparkle', 0.5, 0.9 + Math.random() * 0.3);
      if (++n < 16) window.setTimeout(burst, 150);
    };
    burst();
    window.setTimeout(() => this.resolve(result), 2900);
  }

  private resolved = false;
  private resolve(r: CleanResult) {
    if (this.resolved) return;
    this.resolved = true;
    r.before = this.before;
    r.after = this.after;
    this.resolveDone(r);
  }

  private stopLoops() {
    for (const k in this.loops) { try { this.loops[k as SfxKey]!.stop(); } catch { /* ignore */ } }
    this.loops = {};
  }

  // ---------------------------------------------------------------- debug hook

  private installDebug() {
    const self = this;
    (window as any).__fbClean = {
      summary() {
        const m = self.model;
        const f = scoreClean(m, 'done', self.elapsed);
        const s = messState(m);
        return {
          clean: cleanScore(m), tartar: f.tartar, plaque: f.plaque, stain: f.stain, debris: f.debris, polish: f.polish, mess: f.mess,
          comfort: m.comfort, water: m.water, chunks: m.chunks, snaps: m.snaps,
          caseType: m.caseType, twists: twistList(self.setup), bonus: self.setup.bonus, bonusState: bonusState(m, self.elapsed),
          objectives: m.objectives.map((o) => ({ id: o.id, label: o.label, progress: +o.progress.toFixed(3), done: o.done, have: o.have, count: o.count })),
          problem: m.problem, snapped: m.problem.filter((i) => m.teeth[i].snapped),
          tartarLeft: m.tartar.filter((d) => !d.popped).length, hiddenLeft: m.tartar.filter((d) => d.hidden).length,
          debrisLeft: m.debris.filter((d) => !d.popped).length, bugsLeft: m.bugs.filter((b) => b.alive).length,
          pockets: m.pockets.map((p) => ({ id: p.id, tooth: p.tooth, open: +p.open.toFixed(2), opened: p.opened, healed: p.healed })),
          shade: m.caseType === 'whitening' ? +meanShade(m).toFixed(2) : null, gold: m.teeth.some((t) => t.gold) ? +goldProgress(m).toFixed(3) : null,
          treasure: m.treasure, paste: s.paste, gel: s.gel, resting: s.resting, floating: s.floating,
          bitsLeft: bitsLeft(m), bitsCreated: m.bitsCreated, seconds: self.elapsed, tool: self.slot,
          combo: m.combo, bestCombo: m.bestCombo, gumHits: m.gumHits, gags: m.gags, doze: +m.doze.toFixed(2),
          floss: { phase: self.fl.phase, s: +self.fl.s.toFixed(3), pressure: +self.fl.pressure.toFixed(2), bend: +self.fl.bend.toFixed(2), strokes: self.fl.strokes, target: self.flAim?.debId ?? null },
          ready: !!self.scene, intro: self.introPaused, tutorialStep: self.tut, par: self.setup.parSeconds,
        };
      },
      cheat(fraction: number) { cheat(self.model, fraction); },
      toothState(i: number) {
        const t = self.model.teeth[i];
        let p = 0, st = 0, pol = 0, pa = 0;
        for (let c = 0; c < t.plaque.length; c++) { p += t.plaque[c]; st += t.stain[c]; pol += t.polish[c]; pa += t.paste[c]; }
        return { problem: t.problem, plaque: t.plaque0 ? p / t.plaque0 : 0, stain: t.stain0 ? st / t.stain0 : 0, polish: pol / Math.max(1, t.reachCount), paste: pa, snapped: t.snapped, shade: t.shade, gel: gelCoverage(self.model, i) };
      },
      pickAt(x: number, y: number) {
        const sc = self.scene; if (!sc) return null;
        const h = sc.pick(self.ndcX(x), self.ndcY(y), self.cam.camera, makeHit(), true);
        return { kind: h.kind, tooth: h.tooth, u: +h.u.toFixed(3), v: +h.v.toFixed(3), pocket: h.pocket };
      },
      hide(kind: string, on = false) { self.scene?.scene.traverse((o) => { if (o.userData.kind === kind) o.visible = on; }); },
      finish() { self.finish('done'); },
      done() { void self.requestDone(); },
      skipIntro() { (self.root.querySelector('.fbc-intro-back') as HTMLElement | null)?.dispatchEvent(new PointerEvent('pointerdown')); (self.root.querySelector('.fbc-intro-go') as HTMLElement | null)?.click(); },
      setTool(slot: SlotId | ToolSlot | number) { self.selectTool(typeof slot === 'number' ? self.slots[slot - 1] : slot); },
      view(id: ViewId) { self.setView(id); self.cam.snap(); },
      focus(i: number) { self.focus(i); self.cam.snap(); },
      memory() { const r = self.renderer; return r ? { ...r.info.memory, programs: r.info.programs?.length ?? 0 } : null; },
      /** Screen positions (CSS px in the clean container) of work targets. */
      targets() {
        const sc = self.scene;
        if (!sc) return null;
        self.cam.update(0, true);
        sc.scene.updateMatrixWorld(true);
        const s = { x: 0, y: 0 };
        const P = (w: THREE.Vector3) => { self.project(w, s); return { x: Math.round(s.x), y: Math.round(s.y) }; };
        const m = self.model;
        const dep = m.tartar.filter((d) => !d.popped && !d.hidden).map((d) => { const w = sc.depositCenter(d.id, new THREE.Vector3()); return w ? { id: d.id, tooth: d.tooth, kind: d.kind, ...P(w) } : null; }).filter(Boolean);
        const deb = m.debris.filter((d) => !d.popped).map((d) => {
          const g = new THREE.Vector3(), t = new THREE.Vector3();
          sc.gapPoints(d.a, d.b, g, t);
          const mk = self.targetPoint(d, new THREE.Vector3());
          return { id: d.id, a: d.a, b: d.b, kind: d.kind, bracket: d.bracket, ...P(mk), tip: P(t), gum: P(g) };
        });
        const teeth = sc.teeth.map((tv, i) => { if (!tv) return null; const w = sc.toothCenter(i, new THREE.Vector3()); return { i, problem: m.teeth[i].problem, ...P(w) }; }).filter(Boolean);
        const bugs = m.bugs.filter((b) => b.alive).map((b) => { const w = sc.bugWorld(b.id, new THREE.Vector3()); return w ? { id: b.id, tooth: b.tooth, ...P(w) } : null; }).filter(Boolean);
        const pockets = m.pockets.filter((p) => !p.opened).map((p) => { const w = sc.pocketWorld(p.id, new THREE.Vector3()); return w ? { id: p.id, tooth: p.tooth, ...P(w) } : null; }).filter(Boolean);
        const bits = m.bits.filter((b) => b.state !== 'gone').map((b) => { const w = sc.lower.localToWorld(new THREE.Vector3(b.x, b.y, b.z)); return { id: b.id, state: b.state, ...P(w) }; });
        return { deposits: dep, debris: deb, teeth, bugs, pockets, bits };
      },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.stopLoops();
    for (const [t, type, fn, opts] of this.listeners) {
      if (type === '__bus') { (fn as unknown as () => void)(); continue; }
      t.removeEventListener(type, fn, opts);
    }
    this.listeners = [];
    this.detach?.();
    this.scene?.dispose();
    this.scene = null;
    this.hud.dispose();
    this.root.remove();
    if ((window as any).__fbClean) delete (window as any).__fbClean;
    if (!this.resolved) this.resolve(scoreClean(this.model, 'abort', this.elapsed));
  }
}

export { FLOSS };
