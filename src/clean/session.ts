// The hands-on clean controller: input, tool logic, juice, tutorial, finale and the debug hook.
import * as THREE from 'three';
import type { CleanResult, CleanSetup, ToolSlot } from '../core/types';
import { attachRenderer, getRenderer } from '../core/renderer';
import { loadModel } from '../core/assets';
import { loadSettings, saveSettings, type Settings } from '../core/save';
import { bus } from '../core/bus';
import { isMolar, TEETH_PER_ARCH, TOOTH_COUNT } from '../core/mouth';
import { MOUTH_MODELS, type Mood, type SfxKey } from '../data/assets';
import { TOOL_SLOTS, toolTier } from '../data/tools';
import { audio, type LoopHandle } from '../audio';
import {
  applyPolisher, applyRinse, cellCenterU, cellCenterV, applyScaler, applySuction, applyWaterFloss, bitsLeft, cheat, createModel, flossSwipe,
  fractions, reassure, scoreClean, sideU, tickModel, toothDirtLeft, type CleanEvent, type CleanModel,
} from './dirt';
import { MouthScene, makeHit, type Hit, type Models } from './scene';
import { MouthCamera, type ViewId } from './camera';
import { CleanHud } from './hud';

/** Harness / debug switches (not part of the game contract). */
export const cleanOptions = { procedural: false };

const LOAD_TIMEOUT = 6000;

export function neededModels(setup: CleanSetup | null): string[] {
  const keys: string[] = [...MOUTH_MODELS];
  if (setup) for (const s of TOOL_SLOTS) keys.push(toolTier(s, setup.tools[s]).model);
  return keys;
}

interface Ptr { id: number; x: number; y: number; type: string; button: number }

const TUTORIAL_STEPS = [
  'Select the scaler',
  'Scrape the yellow crust at the gumline',
  'Switch to the polisher and polish the brown stains',
  'Floss the popcorn stuck between two teeth',
  'Rinse, then suction the water',
  'Press Done',
];

const REASSURE_LINES = ['Okay...', 'Thanks.', 'That helps.', 'Mm-kay.', 'Phew.'];
const LOOP_KEYS: readonly SfxKey[] = ['ultrasonic_loop', 'polish_loop', 'suction_loop', 'rinse_loop'];

export class CleanController {
  readonly root: HTMLDivElement;
  private canvasHost: HTMLDivElement;
  private model: CleanModel;
  private hud: CleanHud;
  private scene: MouthScene | null = null;
  private cam = new MouthCamera();
  private renderer: THREE.WebGLRenderer | null = null;
  private detach: (() => void) | null = null;
  private raf = 0;
  private lastT = 0;
  private settings: Settings;
  private slot: ToolSlot | null;
  private disposed = false;
  private finished = false;
  private extPaused = false;
  private hiddenPaused = false;
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
  private gapCooldown = new Float32Array(TOOTH_COUNT);
  private width = 1; private height = 1;
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
  private lastSpotless = -9;
  private wowUntil = -1;
  private eagleClock = 0;
  private hudClock = 0;
  private focusTooth = -1;
  private gumFlash = 0;
  private jawGoal = 0;
  // tutorial
  private tut = -1;
  private tutDep = -1;
  private tutStainTooth = -1;
  private tutStain0 = 0;
  private tutWaterPeak = 0;
  // temps
  private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3(); private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3(); private m1 = new THREE.Matrix4(); private q1 = new THREE.Quaternion();
  private s1 = { x: 0, y: 0 }; private s2 = { x: 0, y: 0 };
  private mapDirt = new Float32Array(TOOTH_COUNT);
  private mapClean = new Uint8Array(TOOTH_COUNT);
  private mapWeight = new Float32Array(TOOTH_COUNT);
  private disclose = false;
  private useOut = { working: false, molar: false, gum: false, gumRisk: 0 };

  constructor(private container: HTMLElement, private setup: CleanSetup, resolve: (r: CleanResult) => void) {
    this.resolveDone = resolve;
    this.settings = loadSettings();
    this.model = createModel(setup);
    this.slot = setup.tutorial ? null : 'scaler';
    this.root = document.createElement('div');
    this.root.className = 'fbc';
    this.canvasHost = document.createElement('div');
    this.canvasHost.className = 'fbc-canvas';
    this.root.appendChild(this.canvasHost);
    // the scene fills its container; make sure absolute children resolve against it
    if (typeof getComputedStyle === 'function' && getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(this.root);
    const owned = setup.tools.extras;
    this.disclose = owned.includes('disclosing') && this.settings.disclosing;
    this.hud = new CleanHud(this.root, setup, {
      tool: (s) => this.selectTool(s),
      reassure: () => this.doReassure(),
      done: () => this.finish('done'),
      view: (id) => this.setView(id),
      focusTooth: (i) => this.focus(i),
      disclose: () => this.toggleDisclose(),
      leave: () => this.leave(),
      skipTutorial: () => this.endTutorial(),
    }, owned.includes('disclosing'));
    this.hud.setTool(this.slot);
    this.hud.setView('front');
    this.hud.setDisclose(this.disclose);
    this.hud.setComfort(this.model.comfort);
    this.hud.setMood('neutral');
    this.hud.setClean(0);
    this.computeMapWeights();
    this.installDebug();
    this.init().catch((e) => {
      // no WebGL (or a broken driver): keep the HUD so the player can still finish or leave
      console.error('[clean] 3D view failed', e);
      if (!this.disposed) this.hud.notice('This device cannot show the 3D view');
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
    this.scene = new MouthScene(renderer, this.model, models, {
      lowQuality: low, headlamp: this.setup.tools.extras.includes('headlamp'), procedural: cleanOptions.procedural,
    });
    this.scene.shared.uDisclose.value = this.disclose ? 1 : 0;
    this.scene.shared.uPlaqueBoost.value = this.setup.tools.extras.includes('headlamp') ? 1 : 0;
    if (this.setup.tools.extras.includes('loupes')) this.cam.minDist = 3.8;
    this.cam.view('front', true);
    this.detach = attachRenderer(this.canvasHost, (w, h) => this.onResize(w, h));
    renderer.shadowMap.enabled = !low;
    this.bindInput();
    audio.music('music_clean');
    if (this.setup.tutorial) this.startTutorial();
    else {
      window.setTimeout(() => { if (!this.disposed && !this.finished) this.hud.say(this.greeting(), 2400); }, 700);
    }
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000));
      this.lastT = t;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
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
    if (this.scene && this.renderer) {
      const px = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(this.cam.camera.fov / 2)));
      this.scene.fx.setPointScale(px);
    }
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
    this.on(c, 'pointerleave', () => { this.hoverIn = false; });
    this.on(c, 'wheel', (e) => { const w = e as WheelEvent; w.preventDefault(); this.cam.zoom(Math.exp(w.deltaY * 0.0012)); this.hud.setView(null); }, { passive: false });
    this.on(c, 'contextmenu', (e) => e.preventDefault());
    this.on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
    this.on(document, 'visibilitychange', () => { this.hiddenPaused = document.hidden; this.applyPause(); });
    this.on(window, 'blur', () => { this.releaseTool(); });
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

  private onDown(e: PointerEvent) {
    if (!this.scene || this.finished || this.hud.modalOpen) return;
    const p = this.toCanvas(e, this.s1);
    this.ptrs.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, type: e.pointerType, button: e.button });
    try { this.canvasHost.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this.ptrs.size >= 2) {
      // second finger: switch to orbit + pinch
      this.releaseTool();
      this.mode = 'orbit';
      this.pinchD = this.pinchDistance();
      return;
    }
    this.hoverX = p.x; this.hoverY = p.y; this.hoverIn = true;
    if (e.button === 2 || e.button === 1) { this.mode = 'orbit'; return; }
    const slot = this.slot;
    if (!slot) { this.mode = 'orbit'; return; }
    const hit = this.scene.pick(this.ndcX(p.x), this.ndcY(p.y), this.cam.camera, this.hit, slot === 'suction' || slot === 'rinse');
    // anything inside the mouth takes the tool (slide onto a tooth to start working); the lips, cheeks,
    // two fingers and the right mouse button orbit
    const k = hit.kind;
    if (k !== 'none' && k !== 'face') {
      this.mode = 'tool';
      this.toolPtr = e.pointerId;
      this.lastTooth = -1;
      this.strokeAcc = 0;
      this.lastMoveT = performance.now();
    } else this.mode = 'orbit';
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
    const dx = p.x - ptr.x, dy = p.y - ptr.y;
    const px = ptr.x, py = ptr.y;
    ptr.x = p.x; ptr.y = p.y;
    if (this.mode === 'orbit') {
      if (this.ptrs.size >= 2) {
        const d = this.pinchDistance();
        if (this.pinchD > 0 && d > 0) this.cam.zoom(this.pinchD / d);
        this.pinchD = d;
        this.cam.orbit(dx / this.ptrs.size, dy / this.ptrs.size);
      } else this.cam.orbit(dx, dy);
      this.hud.setView(null);
      return;
    }
    if (this.mode === 'tool' && e.pointerId === this.toolPtr) {
      this.hoverX = p.x; this.hoverY = p.y; this.hoverIn = true;
      const now = performance.now();
      const dtm = Math.max(1, now - this.lastMoveT);
      this.lastMoveT = now;
      this.ptrSpeed = this.ptrSpeed * 0.6 + (Math.hypot(dx, dy) / dtm) * 1000 * 0.4;
      if (this.slot === 'floss' && this.setup.tools.floss < 3) this.flossSegment(px, py, p.x, p.y);
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

  private releaseTool() {
    this.toolPtr = -1;
    if (this.mode === 'tool') this.mode = 'none';
    this.lastTooth = -1;
    this.ptrSpeed = 0;
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
    if (n >= 1 && n <= 5) { this.selectTool(TOOL_SLOTS[n - 1]); e.preventDefault(); return; }
    if (e.code === 'Space') { this.doReassure(); e.preventDefault(); return; }
    if (e.key === 'Enter') { this.finish('done'); e.preventDefault(); }
  }

  // ---------------------------------------------------------------- actions

  selectTool(s: ToolSlot) {
    if (this.finished) return;
    if (this.slot !== s) this.sfx('ui_click', 0.5);
    this.slot = s;
    this.releaseTool();
    this.hud.setTool(s);
    if (this.scene) for (const k of TOOL_SLOTS) this.scene.tools[k].holder.visible = false;
  }

  private doReassure() {
    if (this.finished) return;
    if (reassure(this.model)) {
      /* feedback runs from the event */
    } else this.sfx('error', 0.35);
  }

  private setView(id: ViewId) {
    this.cam.view(id);
    this.hud.setView(id);
    this.focusTooth = -1;
  }

  private focus(i: number) {
    if (!this.scene || !this.scene.teeth[i]) return;
    const p = this.model.placements[i];
    this.scene.toothCenter(i, this.v1);
    this.scene.root.worldToLocal(this.v1);
    this.cam.focus(this.v1, p.nx, p.nz, p.arch === 'upper' ? -0.22 : 0.24);
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

  pause(p: boolean) { this.extPaused = p; this.applyPause(); }
  private applyPause() {
    if (this.paused) { for (const k in this.loops) this.loops[k as SfxKey]!.setVolume(0); this.releaseTool(); }
  }
  private get paused() { return this.extPaused || this.hiddenPaused; }

  // ---------------------------------------------------------------- frame

  private frame(dt: number) {
    const sc = this.scene;
    if (!sc || !this.renderer) return;
    let simDt = dt;
    if (this.hitch > 0) { this.hitch -= dt; simDt = dt * 0.12; }
    const running = !this.paused && !this.finished;
    let working = false, molar = false, gum = false, gumRisk = 0;
    const loopTargets = this.loopVol;
    for (const k in loopTargets) loopTargets[k as SfxKey] = 0;

    if (running) {
      this.elapsed += dt;
      // tool
      if (this.mode === 'tool' && this.slot && this.model.jawClosed <= 0) {
        const r = this.useTool(simDt);
        working = r.working; molar = r.molar; gum = r.gum; gumRisk = r.gumRisk;
      } else this.toolTouching = false;
      const mods = this.setup.tools;
      tickModel(this.model, {
        dt: simDt, working, molar, gum, gumRisk,
        headphones: mods.extras.includes('headphones'), numbing: mods.numbingGel,
      });
      this.drainEvents();
      this.tutorialTick();
    } else this.toolTouching = false;

    // loops
    for (const k of LOOP_KEYS) {
      const v = running ? (loopTargets[k] ?? 0) : 0;
      let h = this.loops[k];
      if (!h && v > 0) { h = audio.loop(k, { volume: 0 }); this.loops[k] = h; }
      h?.setVolume(v);
    }

    // jaw, fidget, gums
    this.jawGoal = this.model.jawClosed > 0 ? 1 : 0;
    const jk = this.jawGoal > sc.jaw ? 14 : 5;
    sc.setJaw(sc.jaw + (this.jawGoal - sc.jaw) * Math.min(1, dt * jk));
    const fid = this.setup.traits.fidget * this.setup.mods.fidget;
    if (fid > 0) {
      const t = this.elapsed;
      sc.root.rotation.y = Math.sin(t * 1.3) * 0.045 * fid + Math.sin(t * 3.1) * 0.012 * fid;
      sc.root.rotation.z = Math.sin(t * 1.7 + 1) * 0.025 * fid;
      sc.root.position.x = Math.sin(t * 0.9) * 0.22 * fid;
    }
    this.gumFlash = this.model.gumHurting ? Math.min(1, this.gumFlash + dt * 8) : Math.max(0, this.gumFlash - dt * 3);
    const gi = this.gumFlash * (0.35 + 0.15 * Math.sin(this.elapsed * 30));
    for (let i = 0; i < sc.gumMats.length; i++) sc.gumMats[i].emissiveIntensity = gi;

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
    this.poseTool(dt);
    this.cam.update(dt, this.settings.reducedMotion);

    // HUD (cheap updates every frame, heavier ones throttled)
    this.hud.setTimer(this.elapsed);
    this.hud.setComfort(this.model.comfort);
    this.hud.setReassure(this.model.reassureCd / 12);
    this.hud.setMood(this.currentMood());
    this.hudClock -= dt;
    if (this.hudClock <= 0) {
      this.hudClock = 0.25;
      this.refreshStats();
    }
    this.renderer.render(sc.scene, this.cam.camera);
  }

  private refreshStats() {
    const f = fractions(this.model);
    this.hud.setClean(f.clean);
    let t = 0, d = 0;
    for (const x of this.model.tartar) if (!x.popped) t++;
    for (const x of this.model.debris) if (!x.popped) d++;
    this.hud.setCounts(t, d, bitsLeft(this.model), this.model.water);
    for (let i = 0; i < TOOTH_COUNT; i++) {
      const td = this.model.teeth[i];
      this.mapDirt[i] = td.present ? toothDirtLeft(this.model, i) * this.mapWeight[i] : NaN;
      this.mapClean[i] = td.present && td.sparkled ? 1 : 0;
    }
    this.hud.setMap(this.mapDirt, this.mapClean, this.focusTooth);
  }

  /** Each tooth's starting dirt relative to the dirtiest tooth, so the map shows where the work is. */
  private computeMapWeights() {
    const m = this.model;
    const w = this.mapWeight;
    let max = 0;
    for (let i = 0; i < TOOTH_COUNT; i++) {
      const t = m.teeth[i];
      let tar = 0;
      for (const d of m.tartar) if (d.tooth === i) tar += d.hp0;
      let deb = 0;
      for (const d of m.debris) if (d.a === i || d.b === i) deb += 1;
      w[i] = t.present ? t.plaque0 / 60 + t.stain0 / 60 + tar * 1.2 + deb * 0.8 : 0;
      max = Math.max(max, w[i]);
    }
    for (let i = 0; i < TOOTH_COUNT; i++) w[i] = max > 0 ? 0.25 + 0.75 * (w[i] / max) : 0;
  }

  private currentMood(): Mood {
    const m = this.model;
    if (m.time - m.lastHurt < 1.1 || m.comfort < 30) return 'pain';
    if (m.time < this.wowUntil) return 'wow';
    return m.comfort > 60 ? 'happy' : 'neutral';
  }

  // ---------------------------------------------------------------- tools

  private useTool(dt: number): { working: boolean; molar: boolean; gum: boolean; gumRisk: number } {
    const sc = this.scene!;
    const slot = this.slot!;
    const out = this.useOut;
    out.working = false; out.molar = false; out.gum = false; out.gumRisk = 0;
    const ptr = this.ptrs.get(this.toolPtr);
    if (!ptr) return out;
    const hit = sc.pick(this.ndcX(ptr.x), this.ndcY(ptr.y), this.cam.camera, this.hit, slot === 'suction' || slot === 'rinse');
    this.toolTouching = hit.kind !== 'none' && hit.kind !== 'face';
    const m = this.model;
    switch (slot) {
      case 'scaler': {
        const tool = toolTier('scaler', this.setup.tools.scaler);
        out.gumRisk = tool.gumRisk;
        if (hit.kind === 'gum') {
          // aim assist: slipping just off a gumline lump still scrapes the lump, not the gum
          const near = sc.nearestDeposit(hit.point, 0.32);
          if (near) { hit.kind = 'tooth'; hit.tooth = near.tooth; hit.u = near.u; hit.v = Math.max(0.03, near.v); }
        }
        if (hit.kind === 'tooth') {
          const stroke = this.lastTooth === hit.tooth ? hit.point.distanceTo(this.lastPoint) : 0;
          const r = applyScaler(m, hit.tooth, hit.u, hit.v, stroke, dt);
          out.working = true;
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
          out.working = true; out.gum = true;
          this.lastTooth = -1;
        } else this.lastTooth = -1;
        break;
      }
      case 'polisher': {
        if (hit.kind === 'tooth') {
          const moving = Math.min(1, this.ptrSpeed / 350);
          const r = applyPolisher(m, hit.tooth, hit.u, hit.v, dt, moving);
          out.working = true;
          out.molar = isMolar(hit.tooth);
          this.loopVol.polish_loop = 0.45 + 0.25 * moving;
          if (r.stain > 0.02 && Math.random() < 0.5) this.dust(hit, '#9A6A3A', 1);
          if (r.plaque > 0.02 && Math.random() < 0.4) this.dust(hit, '#F2DE8A', 1);
          if (r.polish > 0.05 && Math.random() < 0.3) sc.fx.sparkle(this.rootLocal(hit.point, this.v2), 1, 0.18, 0.1);
          if (toolTier('polisher', this.setup.tools.polisher).water > 0 && Math.random() < dt * 30) this.sprayAt(hit, 1);
        } else this.loopVol.polish_loop = 0.25;
        break;
      }
      case 'floss': {
        if (this.setup.tools.floss >= 3 && hit.kind === 'tooth') {
          // water flosser: point at a gap
          const neighbour = this.nearGap(hit);
          if (neighbour >= 0) {
            const a = Math.min(hit.tooth, neighbour), b = Math.max(hit.tooth, neighbour);
            applyWaterFloss(m, a, b, dt);
            out.working = true;
            out.molar = isMolar(hit.tooth);
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
          applySuction(m, l.x, l.y, l.z, dt);
          this.loopVol.suction_loop = 0.5 + (m.water > 0.02 ? 0.3 : 0);
          out.working = hit.kind === 'tooth';
          if (m.water > 0.02 && Math.random() < dt * 12) sc.fx.drop(l.add(sc.lower.position), (Math.random() - 0.5), 1.5, 0.5, 0.06, 0.25);
        }
        break;
      }
      case 'rinse': {
        if (this.toolTouching) {
          const l = this.rootLocal(hit.point, this.v2);
          applyRinse(m, l.x, l.y - sc.lower.position.y, l.z, dt);
          this.loopVol.rinse_loop = 0.5;
          if (Math.random() < dt * 60) this.sprayAt(hit, 2);
          if (hit.kind === 'tooth') { const tv = sc.teeth[hit.tooth]; if (tv) tv.tm.wet.value = 1; }
        }
        break;
      }
    }
    // loupes: outline dirt around the brush
    if (this.setup.tools.extras.includes('loupes') && hit.kind === 'tooth') sc.shared.uBrush.value.set(hit.point.x, hit.point.y, hit.point.z, 0.45);
    else sc.shared.uBrush.value.w = 0;
    return out;
  }

  private nearGap(hit: Hit): number {
    const p = this.model.placements[hit.tooth];
    const arch = Math.floor(hit.tooth / TEETH_PER_ARCH);
    let best = -1, bd = 0.2;
    for (let n = hit.tooth - 1; n <= hit.tooth + 1; n += 2) {
      if (n < 0 || n >= TOOTH_COUNT || Math.floor(n / TEETH_PER_ARCH) !== arch || !this.model.teeth[n].present) continue;
      const d = Math.abs(hit.u - sideU(p, n));
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** String floss: a pointer segment crossing a gap line on screen is one swipe. */
  private flossSegment(x0: number, y0: number, x1: number, y1: number) {
    const sc = this.scene;
    if (!sc || this.model.jawClosed > 0 || this.finished || this.paused) return;
    if (Math.hypot(x1 - x0, y1 - y0) < 1) return;
    const now = this.model.time;
    for (let a = 0; a < TOOTH_COUNT; a++) {
      if (a % TEETH_PER_ARCH === TEETH_PER_ARCH - 1) continue;
      const b = a + 1;
      if (!this.model.teeth[a].present || !this.model.teeth[b].present) continue;
      if (now - this.gapCooldown[a] < 0.1) continue;
      if (!sc.gapPoints(a, b, this.v1, this.v2)) continue;
      this.project(this.v1, this.s1);
      this.project(this.v2, this.s2);
      // extend the gap segment a little both ways
      const ex = (this.s2.x - this.s1.x) * 0.15, ey = (this.s2.y - this.s1.y) * 0.15;
      if (!segmentsCross(x0, y0, x1, y1, this.s1.x - ex, this.s1.y - ey, this.s2.x + ex, this.s2.y + ey)) continue;
      this.gapCooldown[a] = now;
      const hitSomething = flossSwipe(this.model, a, b);
      this.v3.lerpVectors(this.v1, this.v2, 0.45);
      this.sfx('floss_snap', hitSomething ? 0.6 : 0.3, 0.9 + Math.random() * 0.3);
      if (hitSomething) this.scene!.fx.flakes(this.rootLocal(this.v3, this.v4), this.v2.set(0, 0, 1), 3, '#F7E7A6', 1.2, 0.6);
      this.vibe();
      const str = sc.tools.floss.parts.string;
      if (str) str.userData.twang = 1;
    }
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
    for (const k of TOOL_SLOTS) sc.tools[k].holder.visible = k === slot && !this.finished;
    if (!slot) return;
    const t = sc.tools[slot];
    const pressing = this.mode === 'tool';
    let has = false;
    if (pressing) has = this.hit.kind !== 'none' && this.hit.kind !== 'face';
    else if (this.hoverIn && this.mode === 'none') {
      sc.pick(this.ndcX(this.hoverX), this.ndcY(this.hoverY), this.cam.camera, this.hit, slot === 'suction' || slot === 'rinse');
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
      const lift = pressing ? (slot === 'suction' || slot === 'rinse' ? 0.12 : 0.015) : 0.35;
      target.copy(this.hit.point).addScaledVector(normal, lift);
      this.toolTip.copy(this.hit.point);
      this.lastNormal.copy(normal);
      this.everTouched = true;
    } else {
      // no surface under the pointer: hover just above the last spot (touch) or hide (mouse off the mouth)
      if (!this.everTouched || (this.hoverIn && this.mode === 'none')) { t.holder.visible = false; return; }
      normal.copy(this.lastNormal);
      target.copy(this.toolTip).addScaledVector(normal, 0.5);
    }
    // basis: handle (Y) toward camera + screen lower right, working face (Z) along the surface normal
    const toCam = this.v3.copy(cam.position).sub(target).normalize();
    const right = this.v4.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = this.pUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const Y = this.pY.copy(toCam).multiplyScalar(0.55).addScaledVector(right, 0.5).addScaledVector(up, -0.42).addScaledVector(normal, 0.25);
    if (slot === 'floss') Y.copy(toCam).multiplyScalar(0.8).addScaledVector(up, 0.3).addScaledVector(right, 0.3);
    Y.normalize();
    const Z = this.pZ.copy(normal).addScaledVector(Y, -normal.dot(Y));
    if (Z.lengthSq() < 1e-4) Z.copy(toCam).addScaledVector(Y, -toCam.dot(Y));
    if (slot === 'floss') Z.copy(toCam).addScaledVector(Y, -toCam.dot(Y));
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
    // tool-specific motion
    const touching = this.toolTouching;
    const time = this.elapsed;
    if (slot === 'scaler' && touching && toolTier('scaler', this.setup.tools.scaler).timeBased) {
      t.holder.position.x += Math.sin(time * 173) * 0.018; t.holder.position.y += Math.cos(time * 151) * 0.018;
    }
    if (t.spinner) t.spinner.rotation[t.parts.spinAxis] += dt * (touching ? 38 : 7);
    if (slot === 'suction' && touching) t.parts.group.scale.setScalar(0.72 * (1 + Math.sin(time * 22) * 0.015));
    const str = t.parts.string;
    if (str) {
      const tw = (str.userData.twang as number) || 0;
      str.scale.set(1, 1 + tw * 2 * Math.abs(Math.sin(time * 60)), 1);
      str.userData.twang = Math.max(0, tw - dt * 5);
    }
  }

  private rootLocal(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return this.scene!.root.worldToLocal(out.copy(world));
  }

  private project(world: THREE.Vector3, out: { x: number; y: number }) {
    const v = this.v4.copy(world).project(this.cam.camera);
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
          sc.fx.flakes(this.rootLocal(w, this.v3), n, 4 + Math.floor(Math.random() * 3), '#D8B04A', 2.2, 0.9);
        }
        this.sfx('flake', 0.55, 0.85 + Math.random() * 0.4);
        if (motion) { this.hitch = Math.max(this.hitch, 0.025); this.cam.shake(0.02, 0.08); }
        this.vibe();
        break;
      }
      case 'tartarPop': {
        const big = e.dep.size >= 1.2;
        const w = sc.popDeposit(e.dep, this.v1);
        const l = this.rootLocal(w, this.v3);
        sc.fx.flakes(l, this.v2.set(0, 0.6, 1).normalize(), big ? 18 : 12, '#D8B04A', 3, 1.1);
        sc.fx.sparkle(l, big ? 12 : 8, 0.35, 0.45, '#FFF6D0');
        this.sfx('crunch_pop', 0.9, 0.85 + Math.random() * 0.35);
        if (big) this.sfx('crack_big', 0.8, 0.9 + Math.random() * 0.2);
        for (const b of e.bits) sc.addBit(b);
        this.project(w, this.s1);
        this.hud.float(this.s1.x, this.s1.y, big ? 'Crack' : '+1', 'gold');
        if (e.combo >= 2) { this.hud.showCombo(`Tartar x${e.combo}`); this.sfx('combo', 0.6, 0.9 + Math.min(0.6, e.combo * 0.06)); }
        if (motion) { this.hitch = Math.max(this.hitch, big ? 0.09 : 0.05); this.cam.shake(big ? 0.12 : 0.05, big ? 0.25 : 0.14); }
        this.vibe(big ? 20 : 12);
        this.wowUntil = this.model.time + 0.8;
        break;
      }
      case 'debrisHit': {
        this.sfx('floss_snap', 0.5, 1 + Math.random() * 0.2);
        break;
      }
      case 'debrisPop': {
        const w = sc.popDebris(e.deb, this.v1);
        const l = this.rootLocal(w, this.v3);
        sc.fx.sparkle(l, 10, 0.3, 0.4, '#FFFFFF');
        this.sfx('debris_pop', 0.9, 0.9 + Math.random() * 0.3);
        this.project(w, this.s1);
        this.hud.float(this.s1.x, this.s1.y, 'Pop', 'pink');
        if (e.combo >= 2) { this.hud.showCombo(`Combo x${e.combo}`); this.sfx('combo', 0.6, 0.9 + Math.min(0.6, e.combo * 0.06)); }
        if (motion) this.cam.shake(0.04, 0.12);
        this.vibe(12);
        this.wowUntil = this.model.time + 0.8;
        break;
      }
      case 'toothClean': {
        const tv = sc.teeth[e.tooth];
        if (!tv) break;
        tv.tm.flash.value = 1;
        sc.toothCenter(e.tooth, this.v1);
        sc.fx.sparkle(this.rootLocal(this.v1, this.v3), 14, 0.55, 0.4, '#FFFFFF', 1.2);
        this.sfx('tooth_ding', 0.8, 0.95 + Math.random() * 0.15);
        this.sfx('sparkle', 0.5);
        if (this.model.time - this.lastSpotless > 0.35) {
          this.lastSpotless = this.model.time;
          this.project(this.v1, this.s1);
          this.hud.float(this.s1.x, this.s1.y - 20, 'Spotless', '');
        }
        this.wowUntil = this.model.time + 1.2;
        break;
      }
      case 'bitSucked': {
        if (this.slot === 'suction' && this.toolTouching) sc.suckBit(e.bit, this.toolTip);
        else sc.removeBitNow(e.bit);
        this.sfx('splash', 0.25, 1.4);
        break;
      }
      case 'bitWashed': {
        sc.sinkBit(e.bit);
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
      case 'gag': {
        this.hud.say('Hurk!', 1600);
        this.hud.wince();
        this.sfx('gag', 0.9);
        if (motion) this.cam.shake(0.3, 0.5);
        this.releaseTool();
        this.vibe(40);
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
        this.hud.say(this.setup.patient.archetype === 'mannequin' ? '...' : REASSURE_LINES[Math.floor(Math.random() * REASSURE_LINES.length)], 1500);
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
    // tooth highlights and camera
    if (sc) for (const tv of sc.teeth) if (tv) tv.tm.highlight.value = 0;
    this.tutDep = -1;
    switch (this.tut) {
      case 1: {
        const d = this.model.tartar.find((x) => !x.popped);
        if (d) { this.tutDep = d.id; this.focus(d.tooth); }
        break;
      }
      case 2: {
        let best = -1, bs = 0;
        for (const t of this.model.teeth) {
          if (!t.present) continue;
          const p = this.model.placements[t.index];
          const front = p.pos >= 4 && p.pos <= 9;
          const s = this.faceStain(t.index) * (front ? 3 : 1);
          if (s > bs) { bs = s; best = t.index; }
        }
        this.tutStainTooth = best;
        this.tutStain0 = best >= 0 ? this.faceStain(best) : 0;
        if (best >= 0) { this.focus(best); if (sc?.teeth[best]) sc.teeth[best]!.tm.highlight.value = 1; }
        break;
      }
      case 3: {
        const d = this.model.debris.find((x) => !x.popped);
        if (d) {
          this.focus(d.a);
          if (sc) { if (sc.teeth[d.a]) sc.teeth[d.a]!.tm.highlight.value = 1; if (sc.teeth[d.b]) sc.teeth[d.b]!.tm.highlight.value = 1; }
        }
        break;
      }
      case 4: this.setView('lower'); this.tutWaterPeak = 0; break;
      case 5: this.setView('front'); break;
    }
    this.hud.tutorial(this.tut + 1, TUTORIAL_STEPS.length, TUTORIAL_STEPS[this.tut], this.tutorialTarget());
  }

  /** Stain on the outward face of a tooth (what the player sees from the front). */
  private faceStain(i: number): number {
    const t = this.model.teeth[i];
    let s = 0;
    for (let c = 0; c < t.stain.length; c++) {
      const u = cellCenterU(c), v = cellCenterV(c);
      if (v < 0.86 && Math.abs(u - t.uFront) < 0.22) s += t.stain[c];
    }
    return s;
  }

  private tutorialTarget(): HTMLElement | null {
    switch (this.tut) {
      case 0: return this.hud.slotEl('scaler');
      case 1: return this.slot === 'scaler' ? null : this.hud.slotEl('scaler');
      case 2: return this.slot === 'polisher' ? null : this.hud.slotEl('polisher');
      case 3: return this.slot === 'floss' ? null : this.hud.slotEl('floss');
      case 4: return this.tutWaterPeak < 0.12 ? (this.slot === 'rinse' ? null : this.hud.slotEl('rinse')) : (this.slot === 'suction' ? null : this.hud.slotEl('suction'));
      case 5: return this.hud.done;
    }
    return null;
  }

  private tutorialTick() {
    if (this.tut < 0) return;
    const m = this.model;
    let next = false;
    switch (this.tut) {
      case 0: next = this.slot === 'scaler'; break;
      case 1: next = m.chunks >= 1 || !m.tartar.some((d) => !d.popped); break;
      case 2: {
        if (this.tutStainTooth < 0) { next = true; break; }
        next = this.tutStain0 <= 0.5 || this.faceStain(this.tutStainTooth) <= this.tutStain0 * 0.65 || fractions(m).stain >= 0.15;
        break;
      }
      case 3: next = !m.debris.some((d) => !d.popped); break;
      case 4: this.tutWaterPeak = Math.max(this.tutWaterPeak, m.water); next = this.tutWaterPeak >= 0.12 && m.water <= 0.03; break;
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
    const result = scoreClean(this.model, 'walkout', this.elapsed);
    this.hud.notice(`${this.setup.patient.name} walked out`);
    this.sfx('review_bad', 0.6);
    window.setTimeout(() => this.resolve(result), 1700);
  }

  finish(quit: 'done' | 'abort') {
    if (this.finished) return;
    this.finished = true;
    this.releaseTool();
    this.stopLoops();
    this.endTutorial();
    const result = scoreClean(this.model, quit, this.elapsed);
    if (quit === 'done' && result.perfect && this.scene) {
      this.finale(result);
      return;
    }
    this.resolve(result);
  }

  private finale(result: CleanResult) {
    const sc = this.scene!;
    this.cam.view('front');
    this.hud.setView('front');
    this.sfx('perfect', 0.9);
    this.hud.finale('Perfect clean');
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
        const f = fractions(self.model);
        return {
          ...f, comfort: self.model.comfort, water: self.model.water, chunks: self.model.chunks,
          tartarLeft: self.model.tartar.filter((d) => !d.popped).length, debrisLeft: self.model.debris.filter((d) => !d.popped).length,
          bitsLeft: bitsLeft(self.model), bitsCreated: self.model.bitsCreated, seconds: self.elapsed, tool: self.slot,
          combo: self.model.combo, bestCombo: self.model.bestCombo, gumHits: self.model.gumHits, gags: self.model.gags,
          ready: !!self.scene, tutorialStep: self.tut,
        };
      },
      cheat(fraction: number) { cheat(self.model, fraction); },
      toothState(i: number) {
        const t = self.model.teeth[i];
        let p = 0, st = 0, pol = 0;
        for (let c = 0; c < t.plaque.length; c++) { p += t.plaque[c]; st += t.stain[c]; pol += t.polish[c]; }
        return { plaque: t.plaque0 ? p / t.plaque0 : 0, stain: t.stain0 ? st / t.stain0 : 0, polish: pol / Math.max(1, t.reachCount), spotless: t.sparkled };
      },
      pickAt(x: number, y: number) {
        const sc = self.scene; if (!sc) return null;
        const h = sc.pick(self.ndcX(x), self.ndcY(y), self.cam.camera, makeHit(), true);
        return { kind: h.kind, tooth: h.tooth, u: +h.u.toFixed(3), v: +h.v.toFixed(3), obj: '' };
      },
      /** Hide scene parts by hit kind (debug): e.g. hide('face'). */
      hideName(name: string, on = false) { const o = self.scene?.scene.getObjectByName(name); if (o) o.visible = on; return !!o; },
      hide(kind: string, on = false) { self.scene?.scene.traverse((o) => { if (o.userData.kind === kind) o.visible = on; }); },
      finish() { self.finish('done'); },
      setTool(slot: ToolSlot | number) { self.selectTool(typeof slot === 'number' ? TOOL_SLOTS[slot - 1] : slot); },
      view(id: ViewId) { self.setView(id); self.cam.snap(); },
      focus(i: number) { self.focus(i); self.cam.snap(); },
      /** Screen positions (CSS px in the clean container) of unpopped deposits, debris and tooth centres. */
      targets() {
        const sc = self.scene;
        if (!sc) return null;
        self.cam.update(0, true);
        sc.scene.updateMatrixWorld(true);
        const s = { x: 0, y: 0 };
        const dep = self.model.tartar.filter((d) => !d.popped).map((d) => { const w = sc.depositCenter(d.id, new THREE.Vector3()); if (!w) return null; self.project(w, s); return { id: d.id, tooth: d.tooth, x: Math.round(s.x), y: Math.round(s.y) }; }).filter(Boolean);
        const deb = self.model.debris.filter((d) => !d.popped).map((d) => {
          const g = new THREE.Vector3(), t = new THREE.Vector3();
          sc.gapPoints(d.a, d.b, g, t);
          const a = { ...self.project(g, { x: 0, y: 0 }) }, b = { ...self.project(t, { x: 0, y: 0 }) };
          return { id: d.id, a: d.a, x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
        });
        const teeth = sc.teeth.map((tv, i) => { if (!tv) return null; const w = sc.toothCenter(i, new THREE.Vector3()); self.project(w, s); return { i, x: Math.round(s.x), y: Math.round(s.y) }; }).filter(Boolean);
        return { deposits: dep, debris: deb, teeth };
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

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay), d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy), d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}
