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
  applyGel, applyLamp, gelAllowed, lampTeeth, applyPocket, applyPolisher, applyRinse, applyScaler, applySuction, applyWaterFloss, bitsLeft, bonusState, cellCenterU,
  cellCenterV, cheat, cleanScore, createModel, flossStroke, gelCoverage, gelNeed, gelReady, goldProgress, meanShade, messState, reassure, scoreClean, tickModel,
  lastBits, toothBlocked, toothDirtLeft, twistList, wrapRate, applyGemBuff, applyGrillHold, liveStars, snapAt, GRILL_TEETH,
  type CleanEvent, type CleanModel, type Debris, type FlossTarget,
} from './dirt';
import { flossHook, flossMove, flossRelease, flossTick, FLOSS, newFloss, type FlossEvent, type FlossState } from './floss';
import { depthAt, drawnDepth, screenAxis, splitStep, STRING, stringPath, tautness, type ScreenAxis } from './flossgeo';
import { GEL_PURPLE, MouthScene, makeHit, type FlossGap, type Hit, type Models } from './scene';
import { focusAngles, MouthCamera, type ViewId } from './camera';
import { CleanHud } from './hud';
import { allSlots, slotModel, type SlotId } from './slots';

/** Harness / debug switches (not part of the game contract). */
export const cleanOptions = { procedural: false };

const LOAD_TIMEOUT = 6000;
const TOUCH_OFFSET = 40;
const HOOK_RADIUS = 0.45;
/** The shortest on-screen gap length the floss input is scaled by (px), so tiny far-away gaps stay usable. */
const FLOSS_MIN_LEN = 56;

export function neededModels(setup: CleanSetup | null): string[] {
  const keys: string[] = [...MOUTH_MODELS];
  if (setup) for (const s of allSlots(setup)) keys.push(slotModel(setup, s));
  return keys;
}

interface Ptr { id: number; x: number; y: number; type: string; button: number; off: number; x0: number; y0: number }
/**
 * A hooked gap: its frame (arch space, rides the jaw), the on-screen axis re-projected on every move, the last
 * pointer position and the accumulated sideways offset (gap lengths).
 */
interface FlossAim { target: FlossTarget; bracket: boolean; debId: number; gap: FlossGap; axis: ScreenAxis; px: number; py: number; cross: number }

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
  private strokeIdle = 0;
  private ptrSpeed = 0;
  private lastMoveT = 0;
  private holdTooth = -1;
  private holdTime = 0;
  private width = 1; private height = 1;
  // floss
  private fl: FlossState = newFloss();
  private flAim: FlossAim | null = null;
  private flEvents: FlossEvent[] = [];
  private stringPts: THREE.Vector3[] = Array.from({ length: 49 }, () => new THREE.Vector3());
  private slackPts: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
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
  private gelTaught = false;       // whitening: the "front teeth" tip on first picking the gel brush
  private gelRejected = false;     // whitening: the one-time "Front teeth only" hint
  private shadeSfxT = -1;
  private hollywoodDone = false;
  private zings = 0;
  private gelNeed = new Uint8Array(TOOTH_COUNT);
  private snoreT = 0;
  private joltAnim = 0;
  private lastBonus: string = '';
  private readyGlow = false;
  private comfortTaught = false;
  private comfortPulse = 0;
  private tutComfort = false;
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
  // grillz
  private grillHeld = false;       // the pointer held the grill this frame (the fill ring shows)
  private grillRing = false;
  private gleamDone = false;
  private buffSfxT = 0;

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
    if (this.model.grill) this.hud.setGrillMap(this.model.grill.state === 'in');
    if (this.model.crowd >= 0) this.hud.setCrowd(this.model.crowd);
    this.hud.setStars(liveStars(this.model, 0));
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
    this.scene.onGrillLand = (where) => this.grillLanded(where);
    // sample every floss gap now (a few dozen rays each) so picking up the floss never hitches
    if (this.slots.includes('floss')) for (const d of this.model.debris) this.scene.flossGap(d.a, d.b);
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
    if (this.model.grill?.state === 'in') this.hud.tip('Hold on the grill to take it out', 4200);
    if (this.model.crowd >= 0) this.sfx('crowd_cheer', 0.35, 0.9);
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
    this.placeTray();
  }

  /** grillz: park the grill tray in a free spot of the view (under the case card, above the tool bar). */
  private placeTray() {
    const sc = this.scene;
    if (!sc || !this.model.grill) return;
    const host = this.root.getBoundingClientRect();
    const w = this.width, h = this.height;
    const caseR = this.hud.caseEl.getBoundingClientRect();
    const bottomTop = (this.root.querySelector('.fbc-bottom') as HTMLElement | null)?.getBoundingClientRect().top ?? host.bottom;
    const bar = bottomTop - host.top;
    let x: number, y: number;
    if (w / h > 1.25) {
      x = caseR.left - host.left + 124;
      y = THREE.MathUtils.clamp((caseR.bottom - host.top + bar) / 2, caseR.bottom - host.top + 80, bar - 70);
    } else {
      // portrait: on the left under the top cards (the map and views sit above the tool bar)
      const tl = (this.root.querySelector('.fbc-top-left') as HTMLElement).getBoundingClientRect();
      const phone = w < 560;
      const top = Math.max(tl.bottom, phone ? caseR.bottom : tl.bottom) - host.top;
      x = w * (phone ? 0.16 : 0.2);
      y = Math.min(bar - 90, top + (phone ? 58 : 110));
    }
    sc.trayNdc.set((x / w) * 2 - 1, -((y / h) * 2 - 1));
    sc.trayScale = THREE.MathUtils.clamp((w / h) / 1.3, 0.5, 1);
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
    const sc = this.scene!;
    const hit = sc.pick(this.ndcX(x), this.ndcY(y), this.cam.camera, this.hit, slot === 'suction' || slot === 'rinse');
    // grab assist: while the grill is on, a press on a tooth under it or in a gap of the band takes the grill
    const g = this.model.grill;
    if (g && g.state === 'in' && hit.kind !== 'grill' && hit.kind !== 'none' && hit.kind !== 'face' && slot !== 'rinse' && slot !== 'suction'
      && ((hit.kind === 'tooth' && GRILL_TEETH.includes(hit.tooth)) || sc.grillUnder(this.ndcX(x), this.ndcY(y), this.cam.camera))) {
      hit.kind = 'grill';
      hit.gem = -1;
      hit.tooth = -1;
    }
    return hit;
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
    const hit = this.pickAt(p.x, p.y - off, slot);
    const k = hit.kind;
    // an empty hand only takes the grill out; anything else orbits
    if (!slot && k !== 'grill') { this.mode = 'orbit'; return; }
    if (k === 'none' || k === 'face') { this.mode = 'orbit'; return; }
    this.mode = 'tool';
    this.toolPtr = e.pointerId;
    this.lastTooth = -1;
    this.strokeAcc = 0;
    this.lastMoveT = performance.now();
    if (slot === 'floss' && this.setup.tools.floss < 3 && k !== 'grill') this.tryHook(p.x, p.y - off, hit);
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
    this.rehook = false;
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

  /**
   * The jaw closed (chat, gag): the held stroke pauses and resumes by itself when the jaw opens (frame() skips
   * the tool while jawClosed > 0). Only the stroke bookkeeping resets, so the scaler does not count a jump.
   */
  private pauseStroke() {
    this.lastTooth = -1;
    this.strokeAcc = 0;
    this.holdTooth = -1;
    this.holdTime = 0;
    if (this.fl.phase !== 'idle') { flossRelease(this.fl); this.flAim = null; this.hud.setThread(0, 0, -1); this.rehook = true; }
  }
  private rehook = false;

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
    if (s === 'gel' && this.model.caseType === 'whitening' && !this.gelTaught && this.model.teeth.some((t) => t.gelTarget && !t.gelled)) {
      this.gelTaught = true;
      this.hud.tip('Gel goes on the front teeth: the ones glowing purple', 3800);
    }
    this.refreshGelNeed();
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

  /** Frame a tooth from the angle that shows most of it (focusAngles); if the cheek still blocks, look straight on. */
  private focus(i: number) {
    const sc = this.scene;
    if (!sc || !sc.teeth[i]) return;
    const p = this.model.placements[i];
    sc.toothCenter(i, this.v1);
    sc.root.worldToLocal(this.v1);
    const a = focusAngles(p.pos, p.arch === 'upper', p.nx, p.nz);
    this.cam.focus(this.v1, a.yaw, a.pitch, a.dist);
    if (sc.firstHitKind(this.cam.goalPosition(this.v2), sc.toothCenter(i, this.v3)) === 'face') this.cam.focus(this.v1, 0, a.pitch, a.dist);
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

    this.grillHeld = false;
    if (running) {
      this.elapsed += dt;
      if (this.mode === 'tool' && (this.slot || this.model.grill) && this.model.jawClosed <= 0) this.useTool(simDt);
      else this.toolTouching = false;
      if (this.slot === 'floss' && this.fl.phase !== 'idle') this.flossFrame(dt);
      const mods = this.setup.tools;
      tickModel(this.model, {
        dt: simDt, working: out.working, molar: out.molar, gum: out.gum, gumRisk: out.gumRisk, scaling: out.scaling,
        headphones: mods.extras.includes('headphones'), numbing: mods.numbingGel, tool: this.toolAt.tooth >= 0 ? this.toolAt : null,
      });
      this.drainEvents();
      this.comfortCheck(dt);
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
    if (m.grill) {
      this.cam.camera.updateMatrixWorld();
      sc.updateGrill(simDt, this.elapsed, this.cam.camera);
      // the hold ring on the grill shows only while it is held
      if (this.grillRing && !this.grillHeld) { this.grillRing = false; this.hud.setThread(0, 0, -1); }
    }
    if (m.crowd >= 0) this.hud.setCrowd(m.crowd);

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
    // the stars it would get now: the same function and rules as the result and the sim
    this.hud.setStars(liveStars(m, this.elapsed));
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
      if (td.present && td.problem) this.scene?.setLastBits(i, lastBits(m, i));
    }
    this.hud.setMap(this.mapDirt, this.mapDone, this.focusTooth);
    if (this.setup.bonus) {
      const b = bonusState(m, this.elapsed);
      this.hud.setBonus(b);
      if (b === 'met' && this.lastBonus !== 'met') { this.sfx('star', 0.8); this.hud.showCombo('Bonus'); }
      this.lastBonus = b;
    }
    if (m.caseType === 'whitening') { this.hud.setShade(meanShade(m)); this.refreshGelNeed(); }
    this.hud.setDozing(m.dozing);
  }

  /**
   * Whitening: the front teeth that still need gel glow purple (brighter with the gel brush in hand) and are
   * marked on the mini-map. One threshold (gelReady) decides the outline, the checklist and the lamp; a partial
   * coat dims the outline as it grows (gelNeed).
   */
  private refreshGelNeed() {
    const m = this.model;
    if (m.caseType !== 'whitening') return;
    const k = this.slot === 'gel' ? 1 : 0.45;
    for (let i = 0; i < TOOTH_COUNT; i++) {
      const need = gelNeed(m, i);
      this.gelNeed[i] = need > 0 ? 1 : 0;
      this.scene?.setGelNeed(i, need * k);
    }
    this.hud.setGelMap(this.gelNeed);
  }

  /** Whitening goal reached: a "Hollywood white" sparkle wave sweeps across the front teeth. */
  private hollywood() {
    if (this.hollywoodDone || this.model.caseType !== 'whitening') return;
    this.hollywoodDone = true;
    this.hud.shadeGoal();
    this.hud.showCombo('Hollywood white');
    this.sfx('perfect', 0.8);
    this.wowUntil = this.model.time + 2;
    this.vibe(20);
    // upper and lower front teeth together, left to right as the player sees them
    const cols = new Map<number, number[]>();
    for (const t of this.model.teeth) {
      if (!t.gelTarget || !t.present) continue;
      const pos = t.index % TEETH_PER_ARCH;
      cols.set(pos, [...(cols.get(pos) ?? []), t.index]);
    }
    [...cols.keys()].sort((a, b) => a - b).forEach((pos, k) => {
      window.setTimeout(() => {
        const sc = this.scene;
        if (this.disposed || !sc) return;
        for (const i of cols.get(pos)!) {
          sc.pop(i, 1);
          sc.toothCenter(i, this.v1);
          sc.fx.sparkle(this.rootLocal(this.v1, this.v3), 7, 0.4, 0.4, k % 2 ? '#FFF6D0' : '#FFFFFF', 1.2);
        }
        if (k % 2 === 0) this.sfx('sparkle', 0.45, 1 + k * 0.08);
      }, 90 * k);
    });
    window.setTimeout(() => { if (!this.disposed) this.sfx('tooth_done', 0.7, 1.5); }, 90 * cols.size);
  }

  /**
   * Teach Reassure: the first time comfort drops below 50 in a clean, a one-time hint and a pulsing button
   * (in the tutorial it becomes a step until Reassure is used).
   */
  private comfortCheck(dt: number) {
    const m = this.model;
    if (!this.comfortTaught && m.comfort < 50 && !m.walkout) {
      this.comfortTaught = true;
      const text = `Comfort is dropping: tap ${m.tw.sleepy ? 'Nudge' : 'Reassure'}`;
      if (this.tut >= 0) {
        this.tutComfort = true;
        this.hud.tutorial(this.tut + 1, TUTORIAL_STEPS.length, text, this.hud.reassureEl);
      } else {
        this.hud.tip(text, 5000);
        this.comfortPulse = 8;
        this.hud.pulse(this.hud.reassureEl);
      }
      this.sfx('notify', 0.4);
    }
    if (this.comfortPulse > 0) {
      this.comfortPulse -= dt;
      if (this.comfortPulse <= 0) this.hud.pulse(null);
    }
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
    const out = this.useOut;
    const ptr = this.ptrs.get(this.toolPtr);
    if (!ptr) return;
    const hit = this.pickAt(ptr.x, ptr.y - ptr.off, this.slot);
    this.toolTouching = hit.kind !== 'none' && hit.kind !== 'face';
    const m = this.model;
    // grillz: the grill itself (rinse and suction just spray and slurp over it)
    if (hit.kind === 'grill' && this.slot !== 'rinse' && this.slot !== 'suction') { this.useGrill(hit, dt); return; }
    if (!this.slot) return;
    const slot = this.slot;
    // gum-edge assist: the polisher cup reaches plaque right at the gumline (the gum is soft, only scalers slip)
    if (slot === 'polisher' && hit.kind === 'gum') {
      const ge = sc.gumEdgeTooth(hit.point);
      if (ge) { hit.kind = 'tooth'; hit.tooth = ge.tooth; hit.u = ge.u; hit.v = 0.02; }
    }
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
          // the stroke speed cap covers the time since the pointer last moved: on a 120+ Hz display the pointer
          // moves on some frames only, and a per-frame cap would throw most of each stroke away
          const capDt = Math.min(0.1, this.strokeIdle + dt);
          this.strokeIdle = stroke > 0 ? 0 : capDt;
          const r = applyScaler(m, hit.tooth, hit.u, hit.v, stroke, tool.timeBased ? dt : capDt);
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
        // the jaw reopened under a held string: hook the gap under the pointer again
        if (this.rehook && this.setup.tools.floss < 3 && !this.flAim) {
          this.rehook = false;
          if (this.nearestTarget(hit, ptr.x, ptr.y - ptr.off)) this.tryHook(ptr.x, ptr.y - ptr.off, hit);
        }
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
        if (onTooth && !gelAllowed(m, hit.tooth)) {
          // whitening gel is for the front teeth only: nothing sticks here
          if (!this.gelRejected) {
            this.gelRejected = true;
            this.hint('gelFront', 'Front teeth only', hit.point);
            this.sfx('error', 0.3);
          }
          break;
        }
        if (onTooth) {
          const added = applyGel(m, hit.tooth, hit.u, hit.v, dt, this.holdTime);
          out.working = true;
          out.molar = isMolar(hit.tooth);
          const whiteGel = m.caseType === 'whitening';
          sc.setWrap(hit.tooth, whiteGel ? hit.v : 0.95, (wrapRate(this.holdTime) - 0.4) / 0.3, whiteGel ? GEL_PURPLE : '#FFFFFF', !whiteGel);
          this.gelSfxT -= dt;
          if (added > 0.02 && this.gelSfxT <= 0) { this.gelSfxT = 0.32; this.sfx('gel_paint', 0.45, 0.9 + Math.random() * 0.2); }
          if (added > 0.02 && Math.random() < dt * 10) sc.fx.drop(this.rootLocal(hit.point, this.v2), 0, 0.3, 0.3, 0.05, 0.3);
        }
        break;
      }
      case 'lamp': {
        if (onTooth) {
          // the beam reaches one tooth further on the side of the tooth it is aimed at (tooth index grows with world x)
          const side = hit.point.x >= sc.toothCenter(hit.tooth, this.v5).x ? 1 : -1;
          const beam = applyLamp(m, hit.tooth, dt, side);
          out.working = true;
          out.molar = isMolar(hit.tooth);
          sc.setLamp(hit.point, hit.tooth, this.toolNozzleWorld(this.v4), beam);
          this.loopVol.lamp_loop = 0.45;
          const t = m.teeth[hit.tooth];
          if (t.gelTarget && !gelReady(m, hit.tooth)) this.hint('gel', 'Paint gel first', hit.point);
          else if (!lampTeeth(hit.tooth, beam).some((n) => m.teeth[n].gelTarget)) this.hint('lampFront', 'Front teeth only', hit.point);
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

  // ---------------------------------------------------------------- grillz (DESIGN 11.6)

  /** A pointer held on the grill: hold to take it out (any tool or an empty hand); once it is back in, the polisher buffs the diamonds. */
  private useGrill(hit: Hit, dt: number) {
    const sc = this.scene!;
    const m = this.model;
    const g = m.grill;
    const out = this.useOut;
    if (!g || !sc.grillInMouth) return;
    if (g.state === 'in') {
      const f = applyGrillHold(m, dt);
      if (f < 0) return;
      out.working = true;
      this.grillHeld = true;
      this.grillRing = true;
      this.project(hit.point, this.s2);
      this.hud.setThread(this.s2.x, this.s2.y, f);
      if (Math.random() < dt * 6) sc.fx.sparkle(this.rootLocal(hit.point, this.v2), 1, 0.15, 0.2, '#FFF6D0', 0.5);
      return;
    }
    if (g.state !== 'back') return;
    if (this.slot === 'polisher') {
      const id = hit.gem >= 0 ? hit.gem : sc.gemNear(hit.point, 0.55);
      const moving = Math.min(1, this.ptrSpeed / 350);
      this.loopVol.polish_loop = 0.4 + 0.25 * moving;
      if (id < 0) return;
      const added = applyGemBuff(m, id, dt, moving);
      out.working = true;
      if (added > 0) {
        const w = sc.gemWorld(id, this.v1);
        if (w && Math.random() < dt * 14) sc.fx.sparkle(this.rootLocal(w, this.v2), 1, 0.2, 0.22, '#E8F6FF', 0.6);
        this.buffSfxT -= dt;
        if (this.buffSfxT <= 0) { this.buffSfxT = 0.28; this.sfx('sparkle', 0.18, 1.5 + Math.random() * 0.3); }
      }
      return;
    }
    // other tools only clink on the metal
    if (this.slot) {
      if (m.time - this.clinkT >= 0.22) {
        this.clinkT = m.time;
        this.sfx('coin_clink', 0.3, 1.8 + Math.random() * 0.2);
        sc.fx.sparkle(this.rootLocal(hit.point, this.v2), 2, 0.08, 0.14, '#FFFFFF', 0.3);
      }
      this.hint('gems', 'Buff the diamonds with the polisher', hit.point);
    }
  }

  /** The grill landed on the tray, or clicked back onto the teeth. */
  private grillLanded(where: 'tray' | 'mouth') {
    if (this.disposed || this.finished) return;
    if (where === 'tray') { this.sfx('coin_clink', 0.55, 0.75); return; }
    this.sfx('grill_pop', 0.7, 1.25);
    this.sfx('bling', 0.55, 1.1);
    const w = this.scene?.grillWorld(this.v1);
    if (w) { this.project(w, this.s1); this.hud.float(this.s1.x, this.s1.y - 30, 'Back in', 'gold'); }
    if (this.model.grill?.gems.some((x) => !x.done)) this.hud.tip('Polish every diamond until it glints', 3600);
  }

  /** Every diamond buffed: the grill gleams, a sparkle sweep runs across the stones and the star says ayy. */
  private grillFinale() {
    const sc = this.scene;
    const g = this.model.grill;
    if (!sc || !g || this.gleamDone) return;
    this.gleamDone = true;
    sc.grillGleam();
    this.hud.showCombo('Iced out');
    this.wowUntil = this.model.time + 2.2;
    this.vibe(20);
    const order = g.gems.map((x) => ({ id: x.id, x: sc.gemWorld(x.id, new THREE.Vector3())?.x ?? 0 })).sort((a, b) => a.x - b.x);
    order.forEach((o, k) => {
      window.setTimeout(() => {
        if (this.disposed || !this.scene) return;
        this.scene.gemPop(o.id);
        const w = this.scene.gemWorld(o.id, this.v1);
        if (w) this.scene.fx.sparkle(this.rootLocal(w, this.v3), 6, 0.35, 0.34, k % 2 ? '#FFF6D0' : '#E8F6FF', 1.2);
        if (k % 2 === 0) this.sfx('sparkle', 0.4, 1 + k * 0.06);
      }, 70 * k);
    });
    window.setTimeout(() => {
      if (this.disposed) return;
      this.sfx('ayy', 0.9);
      this.sfx('bling', 0.6, 1.3);
      if (!this.finished) this.hud.say('Ayy! Look at that ice.', 2000);
    }, 70 * order.length + 60);
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

  /** The marker point of a floss target (world): in front of the gap at the food's height, or at the bracket. */
  private targetPoint(d: Debris, out: THREE.Vector3): THREE.Vector3 {
    const sc = this.scene!;
    const g = sc.flossGap(d.a, d.b);
    if (!g) { sc.gapPoints(d.a, d.b, this.v5, out); return out; }
    const p = g.prof;
    const hTooth = ((sc.teeth[d.a]?.h ?? 1) + (sc.teeth[d.b]?.h ?? 1)) / 2;
    const h = THREE.MathUtils.clamp((d.bracket ? 0.33 : d.v) * hTooth, p.hGum + 0.04, p.hEdge - 0.04);
    const n = depthAt(p, g.env, 0) + STRING.margin + (d.bracket ? 0.1 : 0.02);
    g.arch.updateWorldMatrix(true, false);
    return sc.gapWorld(g, 0, h, n, out);
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
    const d = found.deb;
    const gap = this.scene!.flossGap(d.a, d.b);
    if (!gap) return;
    const aim: FlossAim = { target: found.target, bracket: d.bracket, debId: d.id, gap, axis: { x: 0, y: 1, len: FLOSS_MIN_LEN }, px: x, py: y, cross: 0 };
    aim.axis = this.flossAxis(aim);
    this.flAim = aim;
    flossHook(this.fl, !!this.setup.special?.braces, d.bracket);
    if (this.fl.phase === 'thread') this.sfx('floss_creak', 0.25, 1.4);
    else this.sfx('floss_snap', 0.35, 1.3);
    this.vibe(6);
  }

  /**
   * The hooked gap's axis on screen right now: from the biting edge toward the visible gumline at the gap, as
   * the current camera (focus glide, sway, jolt) sees the arch in its current pose (jaw, fidget).
   */
  private flossAxis(a: FlossAim): ScreenAxis {
    const sc = this.scene!;
    const g = a.gap, p = g.prof;
    g.arch.updateWorldMatrix(true, false);
    this.cam.camera.updateMatrixWorld();
    const n = depthAt(p, g.env, 0) + STRING.margin;
    const e = { x: 0, y: 0 }, u = { x: 0, y: 0 };
    this.project(sc.gapWorld(g, 0, p.hEdge, n, this.v1), e);
    this.project(sc.gapWorld(g, 0, p.hGum, n, this.v1), u);
    return screenAxis(e, u, FLOSS_MIN_LEN, a.axis);
  }

  /** Pointer motion while hooked: each step split along the gap's current axis and across it. */
  private flossPointer(x: number, y: number) {
    const a = this.flAim!;
    a.axis = this.flossAxis(a);
    const step = splitStep(a.axis, x - a.px, y - a.py);
    a.px = x; a.py = y;
    a.cross = THREE.MathUtils.clamp(a.cross + step.cross, -1.4, 1.4);
    this.flEvents.length = 0;
    flossMove(this.fl, step.along, a.cross, this.flEvents);
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
    if (!show) { sc.setMarkers([], this.elapsed); sc.setFloss(null); if (!this.grillHeld) this.hud.setThread(0, 0, -1); return; }
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
      const g = a.gap;
      g.arch.updateWorldMatrix(true, false);
      const taut = tautness(this.fl);
      const path = stringPath(g.prof, g.env, drawnDepth(this.fl), this.fl.bend, taut, this.stringPts.length);
      for (let i = 0; i < path.pts.length; i++) { const q = path.pts[i]; sc.gapWorld(g, q.t, q.h, q.n, this.stringPts[i]); }
      sc.setFloss(this.stringPts, this.cam.camera, taut);
      if (this.fl.phase === 'thread') {
        this.project(d ? this.targetPoint(d, this.v2) : this.stringPts[this.stringPts.length >> 1], this.s2);
        this.hud.setThread(this.s2.x, this.s2.y, this.fl.thread);
      } else this.hud.setThread(0, 0, -1);
      return;
    }
    this.hud.setThread(0, 0, -1);
    // not hooked: slack string between the hands around the pointer
    const has = (this.mode === 'tool' || (this.hoverIn && this.mode === 'none')) && this.hit.kind !== 'none' && this.hit.kind !== 'face';
    if (!has) { sc.setFloss(null); return; }
    const [l, c, r] = this.slackPts;
    c.copy(this.hit.point).addScaledVector(this.hit.normal, 0.35);
    const camRight = this.v2.set(1, 0, 0).applyQuaternion(this.cam.camera.quaternion);
    l.copy(c).addScaledVector(camRight, -0.8).addScaledVector(this.hit.normal, 0.3);
    r.copy(c).addScaledVector(camRight, 0.8).addScaledVector(this.hit.normal, 0.3);
    c.y -= 0.06;
    sc.setFloss(this.slackPts, this.cam.camera, 0);
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
        sc.fx.sparkle(this.rootLocal(this.v1, this.v3), e.seal ? 6 : 8, 0.35, 0.3, e.seal ? '#FFFFFF' : '#C4B5FD', 1);
        if (e.seal) {
          this.sfx('tooth_ding', 0.6, 1.2);
          this.project(this.v1, this.s1); this.hud.float(this.s1.x, this.s1.y - 20, 'Sealed', 'mint');
        } else {
          // the coat snaps on: a small squish and a gloss pop
          sc.pop(e.tooth, 0.55);
          this.sfx('squish', 0.35, 1.45 + Math.random() * 0.15);
          this.sfx('gel_paint', 0.5, 1.25);
          this.refreshGelNeed();
        }
        break;
      }
      case 'shadeTick': {
        // every step pops the tooth; the tick climbs in pitch as the whole smile nears the goal
        sc.pop(e.tooth, 0.42);
        sc.toothCenter(e.tooth, this.v1);
        sc.fx.sparkle(this.rootLocal(this.v1, this.v3), 3, 0.3, 0.25, '#FFFFFF', 0.8);
        const s0 = this.setup.special?.startShade || 12;
        const tgt = Math.max(1, this.setup.special?.targetShade || 1);
        const mean = meanShade(this.model);
        const prog = Math.max(0, Math.min(1, (s0 - mean) / Math.max(1, s0 - tgt)));
        if (this.elapsed - this.shadeSfxT > 0.06) { this.shadeSfxT = this.elapsed; this.sfx('shade_tick', 0.55, 0.85 + prog * 0.9); }
        this.hud.setShade(mean);
        this.hud.shadeStep();
        break;
      }
      case 'zing': {
        this.zings++;
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
        if (e.obj.id === 'cure') this.hollywood();
        if (e.obj.id === 'gems') this.grillFinale();
        break;
      }
      case 'grillOut': {
        sc.grillOut();
        this.grillRing = false;
        this.hud.setThread(0, 0, -1);
        this.releaseTool();
        this.sfx('grill_pop', 0.95);
        window.setTimeout(() => { if (!this.disposed) this.sfx('bling', 0.6); }, 120);
        const w = sc.grillWorld(this.v1);
        if (w) {
          sc.fx.sparkle(this.rootLocal(w, this.v3), 18, 0.8, 0.4, '#FFF6D0', 1.2);
          this.project(w, this.s1);
          this.hud.float(this.s1.x, this.s1.y - 20, 'Grill out', 'gold');
        }
        if (motion) this.cam.shake(0.06, 0.16);
        this.wowUntil = this.model.time + 1;
        this.vibe(16);
        this.hud.setGrillMap(false);
        this.hud.tip('Clean the teeth that were under the grill', 3600);
        break;
      }
      case 'grillBack': {
        sc.grillBack();
        this.releaseTool();
        this.hud.showCombo('Grill back in');
        break;
      }
      case 'gemDone': {
        sc.gemPop(e.gem.id);
        const w = sc.gemWorld(e.gem.id, this.v1);
        if (w) {
          sc.fx.sparkle(this.rootLocal(w, this.v3), 12, 0.4, 0.36, '#E8F6FF', 1.3);
          this.project(w, this.s1);
          this.hud.float(this.s1.x, this.s1.y - 18, 'Shine', 'gold');
        }
        // the bling climbs with every diamond finished this clean
        const total = Math.max(1, this.model.grill?.gems.length ?? 1);
        this.sfx('bling', 0.75, 0.85 + 0.75 * ((e.n - 1) / Math.max(1, total - 1)));
        this.wowUntil = this.model.time + 0.8;
        this.vibe(10);
        break;
      }
      case 'crowdCheer': {
        this.sfx('crowd_cheer', 0.25 + 0.1 * e.level, 0.95 + 0.05 * e.level);
        this.hud.crowdCheer();
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
        this.pauseStroke();
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
        if (e.closesJaw) this.pauseStroke();
        break;
      }
      case 'reassure': {
        this.sfx('reassure', 0.7);
        if (this.comfortPulse > 0) { this.comfortPulse = 0; this.hud.pulse(null); this.hud.tip(null); }
        if (this.tutComfort) { this.tutComfort = false; this.showTutorial(); }
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
    if (this.tutComfort) { this.hud.pulse(this.hud.reassureEl); return; }
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
    // the gala: 4 stars or more and the hall erupts
    if (this.setup.special?.showcase && result.stars >= 4) {
      this.sfx('fanfare_gala', 1);
      window.setTimeout(() => { if (!this.disposed) this.sfx('crowd_cheer', 0.85); }, 250);
    }
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
    const grill = this.model.caseType === 'grillz';
    this.hud.finale(this.setup.special?.showcase ? 'Showstopper' : grill ? 'Iced Out' : 'Sparkling Smile', 'Perfect clean');
    if (grill) { sc.grillGleam(); window.setTimeout(() => { if (!this.disposed) this.sfx('ayy', 0.8); }, 500); }
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
          zings: self.zings, ready: !!self.scene, intro: self.introPaused, tutorialStep: self.tut, par: self.setup.parSeconds,
          rules: self.setup.rules ?? null, snapAt: snapAt(m), stars: liveStars(m, self.elapsed), quality: f.quality,
          grill: m.grill ? {
            state: m.grill.state, hold: +m.grill.hold.toFixed(2), inMouth: !!self.scene?.grillInMouth,
            gems: m.grill.gems.length, gemsDone: m.grill.gems.filter((x) => x.done).length,
            shine: m.grill.gems.map((x) => +x.shine.toFixed(2)),
          } : null,
          crowd: m.crowd >= 0 ? +m.crowd.toFixed(3) : null,
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
      /**
       * Cell reachability (QA): for each tooth in `teeth` (default all), the dirt cells whose surface point a
       * pointer can press with the current camera: the pick through that pixel lands on that tooth within
       * 0.06 units of the point, or (gumline cells) on the gum collar the polisher gum-edge assist maps to it.
       * Pixels under the HUD do not count; touchOffset is the finger offset below the work point.
       */
      scanCells(touchOffset = 0, teeth: number[] | null = null) {
        const sc = self.scene;
        if (!sc) return null;
        self.cam.update(0, true);
        sc.scene.updateMatrixWorld(true);
        const canvas = self.renderer!.domElement;
        const r = canvas.getBoundingClientRect();
        const out: Record<number, { ray: number[]; edge: number[]; hid: number[] }> = {};
        const h = makeHit();
        const w = new THREE.Vector3();
        const s = { x: 0, y: 0 };
        sc.teethOnlyPick(true);
        try {
          for (const i of teeth ?? Array.from({ length: TOOTH_COUNT }, (_, k) => k)) {
            const td = self.model.teeth[i];
            if (!td.present || !sc.teeth[i]) continue;
            const ray: number[] = [], edge: number[] = [], hid: number[] = [];
            for (let c = 0; c < td.reach.length; c++) {
              if (!td.reach[c]) continue;
              const u = cellCenterU(c), v = cellCenterV(c);
              if (!sc.cellWorld(i, u, v, w)) continue;
              self.project(w, s);
              if (s.x < 1 || s.y < 1 || s.x > self.width - 1 || s.y > self.height - 1) continue;
              const fy = s.y + touchOffset;
              if (fy >= self.height) continue;
              if (document.elementFromPoint(r.left + s.x, r.top + fy) !== canvas) continue;
              sc.pick(self.ndcX(s.x), self.ndcY(s.y), self.cam.camera, h, false);
              if (h.kind === 'tooth' && h.tooth === i && h.point.distanceTo(w) < 0.06) { ray.push(c); if (sc.gumCovers(self.cam.camera.position, w)) hid.push(c); }
              else if (h.kind === 'gum' && v < 0.12) { const ge = sc.gumEdgeTooth(h.point); if (ge && ge.tooth === i) edge.push(c); }
            }
            out[i] = { ray, edge, hid };
          }
        } finally { sc.teethOnlyPick(false); }
        return out;
      },
      /** QA: screen rects (CSS px, page) of the HUD controls a player presses. */
      ui() {
        const R = (e: Element | null) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) }; };
        const slots: Record<string, unknown> = {};
        for (const s of self.slots) slots[s] = R(self.hud.slotEl(s));
        const map = [...self.root.querySelectorAll('.fbc-map .fbc-tooth')].map(R);
        const views: Record<string, unknown> = {};
        self.root.querySelectorAll('.fbc-view').forEach((b) => { views[(b.textContent || '').toLowerCase()] = R(b); });
        const modal = [...self.root.querySelectorAll('.fbc-modal .fbc-btn')].map((b) => ({ text: b.textContent, ...R(b) }));
        const canvas = self.canvasHost.getBoundingClientRect();
        return { slots, map, views, done: R(self.hud.done), reassure: R(self.hud.reassureEl), modal, canvas: { x: canvas.left, y: canvas.top } };
      },
      /**
       * QA: screen points (canvas CSS px) of the dirty cells of tooth i a pointer can press right now
       * (plaque + stain above `min`), the way a player sees what is left.
       */
      dirtSpots(i: number, min = 0.04) {
        const sc = self.scene;
        if (!sc) return [];
        self.cam.update(0, true);
        sc.scene.updateMatrixWorld(true);
        const t = self.model.teeth[i];
        const out: { x: number; y: number; a: number }[] = [];
        const w = new THREE.Vector3(), s = { x: 0, y: 0 }, h = makeHit();
        sc.teethOnlyPick(true);
        try {
          for (let c = 0; c < t.plaque.length; c++) {
            const a = t.plaque[c] + t.stain[c];
            if (a <= min || !t.reach[c]) continue;
            if (!sc.cellWorld(i, cellCenterU(c), cellCenterV(c), w)) continue;
            self.project(w, s);
            if (s.x < 0 || s.y < 0 || s.x > self.width || s.y > self.height) continue;
            sc.pick(self.ndcX(s.x), self.ndcY(s.y), self.cam.camera, h, false);
            if (h.kind === 'tooth' && h.tooth === i && h.point.distanceTo(w) < 0.08) out.push({ x: Math.round(s.x), y: Math.round(s.y), a: +a.toFixed(2) });
          }
        } finally { sc.teethOnlyPick(false); }
        return out;
      },
      hide(kind: string, on = false) { self.scene?.scene.traverse((o) => { if (o.userData.kind === kind) o.visible = on; }); },
      finish() { self.finish('done'); },
      done() { void self.requestDone(); },
      skipIntro() { (self.root.querySelector('.fbc-intro-back') as HTMLElement | null)?.dispatchEvent(new PointerEvent('pointerdown')); (self.root.querySelector('.fbc-intro-go') as HTMLElement | null)?.click(); },
      setTool(slot: SlotId | ToolSlot | number) { self.selectTool(typeof slot === 'number' ? self.slots[slot - 1] : slot); },
      view(id: ViewId) { self.setView(id); self.cam.snap(); },
      focus(i: number) { self.focus(i); self.cam.snap(); },
      /** QA: the orbit camera (goals, snap) for camera experiments. */
      get cam() { return self.cam; },
      memory() { const r = self.renderer; return r ? { ...r.info.memory, programs: r.info.programs?.length ?? 0 } : null; },
      /**
       * QA: the hooked string on screen (canvas px) and where its gap is: the string's points, the gap's biting-edge
       * and gumline points, the current input axis. null when nothing is hooked.
       */
      flossString() {
        const sc = self.scene, a = self.flAim;
        if (!sc || !a || self.fl.phase === 'idle') return null;
        const s = { x: 0, y: 0 };
        const P = (w: THREE.Vector3) => { self.project(w, s); return { x: +s.x.toFixed(1), y: +s.y.toFixed(1) }; };
        const g = a.gap, n = depthAt(g.prof, g.env, 0) + STRING.margin;
        return {
          pts: self.stringPts.map(P),
          edge: P(sc.gapWorld(g, 0, g.prof.hEdge, n, new THREE.Vector3())),
          gum: P(sc.gapWorld(g, 0, g.prof.hGum, n, new THREE.Vector3())),
          axis: { ...a.axis }, cross: +a.cross.toFixed(3),
        };
      },
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
          const fg = sc.flossGap(d.a, d.b);
          if (fg) {
            const n = depthAt(fg.prof, fg.env, 0) + STRING.margin;
            sc.gapWorld(fg, 0, fg.prof.hGum, n, g); sc.gapWorld(fg, 0, fg.prof.hEdge, n, t);
          } else sc.gapPoints(d.a, d.b, g, t);
          const mk = self.targetPoint(d, new THREE.Vector3());
          return { id: d.id, a: d.a, b: d.b, kind: d.kind, bracket: d.bracket, ...P(mk), tip: P(t), gum: P(g) };
        });
        const teeth = sc.teeth.map((tv, i) => { if (!tv) return null; const w = sc.toothCenter(i, new THREE.Vector3()); return { i, problem: m.teeth[i].problem, gelTarget: m.teeth[i].gelTarget, gelled: m.teeth[i].gelled, shade: m.teeth[i].shade, ...P(w) }; }).filter(Boolean);
        const bugs = m.bugs.filter((b) => b.alive).map((b) => { const w = sc.bugWorld(b.id, new THREE.Vector3()); return w ? { id: b.id, tooth: b.tooth, ...P(w) } : null; }).filter(Boolean);
        const pockets = m.pockets.filter((p) => !p.opened).map((p) => { const w = sc.pocketWorld(p.id, new THREE.Vector3()); return w ? { id: p.id, tooth: p.tooth, ...P(w) } : null; }).filter(Boolean);
        const bits = m.bits.filter((b) => b.state !== 'gone').map((b) => { const w = sc.lower.localToWorld(new THREE.Vector3(b.x, b.y, b.z)); return { id: b.id, state: b.state, ...P(w) }; });
        const gw = m.grill ? sc.grillWorld(new THREE.Vector3()) : null;
        const grill = gw ? { state: m.grill!.state, inMouth: sc.grillInMouth, ...P(gw) } : null;
        const gems = m.grill ? m.grill.gems.map((x) => { const w = sc.gemWorld(x.id, new THREE.Vector3()); return w ? { id: x.id, tooth: x.tooth, done: x.done, shine: +x.shine.toFixed(2), ...P(w) } : null; }).filter(Boolean) : [];
        return { deposits: dep, debris: deb, teeth, bugs, pockets, bits, grill, gems };
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
