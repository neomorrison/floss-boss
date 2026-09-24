// Clinic diorama test bed. Builds a FAKE clinic (no sim dependency) and runs a tiny state machine that
// walks patients through the whole flow: door, desk, seat, operatory, desk, door, with walkouts, reviews
// and payments, so the view can be watched at speed.
//
// URL params: tier=t1..t4  speed=0|1|2|4|8  minute=600 (start clock, the clinic is warmed up to it)
//   seed=1  owned=1|0  ops=<built operatories>  equip=all|none|some  player=1|0 (you at op 0, hands-on)
//   clean=1 (hide the harness panels)  focus=<slot>  select=<slot>  standins=1 (ignore GLBs)
//   gallery=1 (every model on a grid; fallback=1 shows the procedural stand-ins)
import * as THREE from 'three';
import { createClinicView, preloadClinic } from '../src/clinic';
import { makeProp, modelBounds, loadedModel, useStandInsOnly } from '../src/clinic/props';
import { createPerson, type PersonKind } from '../src/clinic/people';
import { attachRenderer, getRenderer } from '../src/core/renderer';
import { CLINIC_MODELS, PEOPLE_MODELS } from '../src/data/assets';
import type { ArchetypeId, ChairTier, Clinic, DayPatient, EquipId, OfficeTierId, Operatory, OpUpgradeId, SimEvent, Staff, StaffRole } from '../src/core/types';
import { OFFICES } from '../src/data/offices';
import { EQUIP_ORDER } from '../src/data/upgrades';
import { ARCHETYPES, PATIENT_ARCHETYPES, LAST_NAMES } from '../src/data/patients';
import { STAFF_FIRST, STAFF_LAST } from '../src/data/staff';
import { defaultPrices } from '../src/data/services';
import { makeRng } from '../src/core/rng';
import { CHECKOUT_MIN, CLOSE_MIN, OPEN_MIN, PLAYER_ID, REAL_SEC_PER_GAME_MIN, WALK_MIN } from '../src/core/constants';
import { clock, money } from '../src/core/format';

const q = new URLSearchParams(location.search);
const tier = (q.get('tier') ?? 't2') as OfficeTierId;
let speed = Number(q.get('speed') ?? 2);
const seed = Number(q.get('seed') ?? 7);
const owned = q.get('owned') !== '0';
const withPlayer = q.get('player') !== '0';
const office = OFFICES[tier] ?? OFFICES.t2;
const opsBuilt = Math.min(office.opSlots, Number(q.get('ops') ?? office.opSlots));
const equipMode = q.get('equip') ?? (tier === 't1' ? 'some' : 'all');
if (q.get('clean') === '1') document.body.classList.add('clean');
const rng = makeRng(seed);

function runHarness(): void {
  // ------------------------------------------------------------------ fake clinic

  const CHAIR_BY_SLOT: ChairTier[] = ['deluxe', 'comfort', 'basic', 'comfort', 'basic', 'deluxe', 'comfort', 'basic'];
  const UPG_BY_SLOT: OpUpgradeId[][] = [['tv', 'intraoralCam'], ['whiteningLamp'], [], ['tv'], ['whiteningLamp', 'tv'], [], ['intraoralCam'], []];
  let nextId = 1;
  const uid = (p: string) => `${p}${nextId++}`;

  function person(role: StaffRole): Staff {
    return {
      id: uid('s'), name: `${rng.pick(STAFF_FIRST)} ${rng.pick(STAFF_LAST)}`, role, portrait: 'staff_0',
      skill: rng.int(40, 90), speed: rng.int(40, 90), bedside: rng.int(40, 90), salary: 200, ask: 200, morale: 70,
      traits: [], level: 1, xp: 0, hiredDay: 1, offUntilDay: 0, patientsToday: 0,
      task: 'idle', targetOpId: null, busyUntil: null,
    };
  }

  function makeOp(slot: number, staffId: string | null): Operatory {
    return {
      id: 'op' + slot, slot, chair: CHAIR_BY_SLOT[slot % 8], upgrades: [...UPG_BY_SLOT[slot % 8]],
      staffId, assistantId: null, patientId: null, playerMode: 'hands',
    };
  }

  function buildClinic(): Clinic {
    const staff: Staff[] = [];
    const ops: Operatory[] = [];
    for (let s = 0; s < opsBuilt; s++) {
      if (s === 0 && withPlayer) { ops.push(makeOp(s, PLAYER_ID)); continue; }
      const h = person('hygienist');
      staff.push(h);
      ops.push(makeOp(s, h.id));
    }
    const rec = person('receptionist'); staff.push(rec);
    if (tier !== 't1') {
      const asst = person('assistant'); staff.push(asst);
      const target = ops.find((o) => o.staffId !== PLAYER_ID);
      if (target) target.assistantId = asst.id;
      staff.push(person('dentist'));
    }
    if (tier === 't3' || tier === 't4') { staff.push(person('manager')); staff.push(person('receptionist')); }
    staff.push(person('hygienist'));   // one without an operatory, idles in the break area
    const equipment: EquipId[] = equipMode === 'all' ? [...EQUIP_ORDER] : equipMode === 'none' ? [] : ['espresso', 'kidsCorner', 'fishTank', 'deepCert'];
    return {
      id: 'harness-' + tier, name: tier === 't2' && !owned ? 'Bright Smiles Dental' : ({ t1: 'Floss Boss Dental', t2: 'Main Street Smiles', t3: 'Plaza Dental Care', t4: 'Smile Tower' } as const)[tier],
      tier, ownedByPlayer: owned, ops, equipment: tier === 't1' ? equipment.filter((e) => e !== 'breakRoom') : equipment, staff,
      prices: defaultPrices(), marketing: 1, rating: 4.3, reviews: [], served: 120, patients: [],
      day: { booked: 0, demand: 0, turnedAway: 0, noShows: 0, walkIns: 0, served: 0, walkouts: 0, revenue: 0, tips: 0, supplies: 0, addonsSold: 0, fiveStars: 0, handsOn: 0 },
      checkinBusyUntil: 0,
    };
  }

  const clinic = buildClinic();
  let minute = OPEN_MIN;
  let nextArrival = OPEN_MIN + 1;
  let revenue = 0;
  let reviews = 0;
  let log = '';
  const mix = (a: ArchetypeId) => ARCHETYPES[a].weight[tier] ?? 1;

  function spawn(evts: SimEvent[]): void {
    const archetype = rng.weighted(PATIENT_ARCHETYPES, mix);
    const A = ARCHETYPES[archetype];
    const p: DayPatient = {
      id: uid('p'), name: `${rng.pick(A.firstNames)} ${rng.pick(LAST_NAMES)}`, archetype, portrait: archetype,
      service: 'cleaning', addons: [], apptMin: minute, walkIn: false, state: 'entering', since: minute, until: minute + WALK_MIN,
      seat: null, opId: null, staffId: null, awaitingPlayer: false, arrivedMin: minute, waitedMin: 0, patience: Math.min(60, A.patience),
      dirtLevel: rng.next(), quality: null, comfort: null, stars: null, fee: 120, tip: 0, isPlayerPatient: false, mood: 'ok',
    };
    clinic.patients.push(p);
    evts.push({ type: 'arrive', clinicId: clinic.id, patientId: p.id });
  }

  function freeSeat(): number {
    const taken = new Set<number>();
    for (const p of clinic.patients) if (p.state === 'waiting' && p.seat !== null) taken.add(p.seat);
    for (let i = 0; i < office.seats; i++) if (!taken.has(i)) return i;
    return -1;
  }

  let deskFree = 0;
  /** Advance the fake clinic to minute m in small steps. */
  function tick(m: number, evts: SimEvent[]): void {
    while (minute < m) {
      minute = Math.min(m, minute + 0.5);
      const busy = clinic.patients.filter((p) => p.state !== 'gone').length;
      const perHour = 60 / Math.max(3, 14 - opsBuilt * 1.3);
      if (minute >= nextArrival && minute < CLOSE_MIN - 45) {
        if (busy < office.seats + opsBuilt + 4 && freeSeat() >= 0) spawn(evts);
        nextArrival = minute + rng.range(0.5, 1.5) * (60 / perHour);
      }
      for (const p of clinic.patients) step(p, evts);
      // the dentist drops in on busy operatories
      for (const s of clinic.staff) {
        if (s.role !== 'dentist') continue;
        if (s.task === 'exam' && s.busyUntil !== null && minute >= s.busyUntil) { s.task = 'idle'; s.targetOpId = null; s.busyUntil = minute + rng.range(6, 16); }
        else if (s.task === 'idle' && (s.busyUntil === null || minute >= s.busyUntil)) {
          const busyOps = clinic.ops.filter((o) => o.patientId && clinic.patients.find((p) => p.id === o.patientId)?.state === 'inChair');
          if (busyOps.length) { const o = rng.pick(busyOps); s.task = 'exam'; s.targetOpId = o.id; s.busyUntil = minute + 10; }
          else s.busyUntil = minute + 5;
        }
      }
    }
  }

  function step(p: DayPatient, evts: SimEvent[]): void {
    const done = p.until !== null && minute >= p.until;
    switch (p.state) {
      case 'entering':
        if (done) { p.state = 'checkin'; p.since = minute; p.until = Math.max(minute, deskFree) + 3; deskFree = p.until; }
        break;
      case 'checkin':
        if (done) {
          const s = freeSeat();
          p.state = 'waiting'; p.since = minute; p.until = null; p.seat = s >= 0 ? s : null; p.arrivedMin = minute; p.waitedMin = 0;
        }
        break;
      case 'waiting': {
        p.waitedMin = minute - p.since;
        if (p.waitedMin > p.patience) {
          p.state = 'walkout'; p.since = minute; p.until = minute + WALK_MIN; p.seat = null; p.mood = 'angry';
          evts.push({ type: 'walkout', clinicId: clinic.id, patientId: p.id, reason: 'wait' });
          evts.push({ type: 'review', clinicId: clinic.id, stars: 1, text: 'Waited forever.', name: p.name });
          break;
        }
        // first waiting patient in line takes the first free staffed operatory
        const first = clinic.patients.find((x) => x.state === 'waiting');
        if (first !== p) break;
        const op = clinic.ops.find((o) => o.staffId && !o.patientId);
        if (op) {
          op.patientId = p.id; p.opId = op.id; p.staffId = op.staffId; p.seat = null;
          p.state = 'toChair'; p.since = minute; p.until = minute + WALK_MIN;
          evts.push({ type: 'seated', clinicId: clinic.id, patientId: p.id, opId: op.id });
        }
        break;
      }
      case 'toChair':
        if (done) {
          const op = clinic.ops.find((o) => o.id === p.opId)!;
          p.state = 'inChair'; p.since = minute;
          if (op.staffId === PLAYER_ID) {
            p.awaitingPlayer = true; p.until = null; p.waitedMin = 0;
            evts.push({ type: 'awaitingPlayer', clinicId: clinic.id, patientId: p.id, opId: op.id });
          } else p.until = minute + rng.range(28, 55) * (op.assistantId ? 0.8 : 1);
        }
        break;
      case 'inChair':
        if (p.awaitingPlayer) {
          p.waitedMin = minute - p.since;
          if (p.waitedMin > 14) { p.awaitingPlayer = false; p.since = minute; p.until = minute + 45; }   // "you" start a quick clean
          break;
        }
        if (done) {
          const op = clinic.ops.find((o) => o.id === p.opId);
          if (op) op.patientId = null;
          p.quality = rng.range(0.55, 0.99);
          p.mood = p.quality > 0.85 ? 'happy' : p.quality > 0.72 ? 'ok' : 'grumpy';
          p.stars = p.quality > 0.9 ? 5 : p.quality > 0.8 ? 4 : 3;
          p.fee = 120 + (rng.chance(0.4) ? 35 : 0); p.tip = Math.round(rng.range(0, 25));
          evts.push({ type: 'cleaned', clinicId: clinic.id, patientId: p.id, staffId: p.staffId ?? '', quality: p.quality });
          p.state = 'toDesk'; p.since = minute; p.until = minute + WALK_MIN;
        }
        break;
      case 'toDesk':
        if (done) { p.state = 'checkout'; p.since = minute; p.until = minute + CHECKOUT_MIN; }
        break;
      case 'checkout':
        if (done) {
          p.state = 'exiting'; p.since = minute; p.until = minute + WALK_MIN;
          revenue += p.fee + p.tip;
          evts.push({ type: 'paid', clinicId: clinic.id, patientId: p.id, amount: p.fee + p.tip });
          if (rng.chance(0.6)) { reviews++; evts.push({ type: 'review', clinicId: clinic.id, stars: p.stars ?? 4, text: 'Teeth feel fresh.', name: p.name }); }
        }
        break;
      case 'exiting': case 'walkout':
        if (done) { p.state = 'gone'; p.since = minute; p.until = null; p.opId = null; }
        break;
      default: break;
    }
  }

  // warm up to the start minute so the office is busy from the first frame
  const startMinute = Number(q.get('minute') ?? 600);
  tick(Math.max(OPEN_MIN, Math.min(CLOSE_MIN + 30, startMinute)), []);
  clinic.patients = clinic.patients.filter((p) => p.state !== 'gone');

  // ------------------------------------------------------------------ view

  const view = createClinicView(document.getElementById('view')!, {
    onOpClick: (id) => { say(`Operatory ${id}`); view.select(id); },
    onEmptySlotClick: (slot) => { say(`Empty slot ${slot}`); addOp(slot); },
    onStaffClick: (id) => { const s = clinic.staff.find((x) => x.id === id); say(`Staff ${s?.name ?? id} (${s?.role ?? '?'})`); },
    onPatientClick: (id) => { const p = clinic.patients.find((x) => x.id === id); say(`Patient ${p?.name ?? id} (${p?.state ?? '?'})`); },
    onDeskClick: () => say('Front desk'),
  });

  function addOp(slot?: number): void {
    const s = slot ?? [...Array(office.opSlots).keys()].find((i) => !clinic.ops.some((o) => o.slot === i));
    if (s === undefined || clinic.ops.some((o) => o.slot === s)) return;
    const h = person('hygienist');
    clinic.staff.push(h);
    clinic.ops.push({ ...makeOp(s, h.id), chair: 'basic', upgrades: [] });
  }
  function buy(): void {
    const miss = EQUIP_ORDER.filter((e) => !clinic.equipment.includes(e) && (tier !== 't1' || e !== 'breakRoom'));
    if (miss.length) clinic.equipment.push(miss[0]);
  }
  function say(t: string): void { log = t; }

  // ------------------------------------------------------------------ panel

  const panel = document.getElementById('panel')!;
  const hud = document.getElementById('hud')!;
  function btn(label: string, fn: () => void, on = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label; b.onclick = fn;
    if (on) b.classList.add('on');
    panel.appendChild(b);
    return b;
  }
  for (const t of ['t1', 't2', 't3', 't4']) btn(t.toUpperCase(), () => { q.set('tier', t); location.search = q.toString(); }, t === tier);
  const speedBtns: HTMLButtonElement[] = [];
  for (const s of [0, 1, 2, 4, 8]) speedBtns.push(btn(s === 0 ? 'Pause' : `${s}x`, () => setSpeed(s), s === speed));
  function setSpeed(s: number): void { speed = s; speedBtns.forEach((b, i) => b.classList.toggle('on', [0, 1, 2, 4, 8][i] === s)); }
  let focusIdx = -1;
  btn('Focus next', () => { focusIdx = (focusIdx + 1) % Math.max(1, clinic.ops.length); view.focusOp(clinic.ops[focusIdx]?.id ?? null); });
  btn('Overview', () => view.focusOp(null));
  btn('+1 h', () => { pending.push(...jump(60)); });
  btn('3:45 PM', () => { pending.push(...jump(Math.max(0, 945 - minute))); });
  btn('Add op', () => addOp());
  btn('Buy', () => buy());
  btn('Hide', () => { view.setVisible(false); setTimeout(() => view.setVisible(true), 1500); });

  function jump(mins: number): SimEvent[] { const e: SimEvent[] = []; tick(minute + mins, e); return e; }

  // ------------------------------------------------------------------ loop

  let pending: SimEvent[] = [];
  let last = performance.now();
  function loop(t: number): void {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (speed > 0 && minute < CLOSE_MIN + 40) tick(minute + (dt / REAL_SEC_PER_GAME_MIN) * speed, pending);
    if (pending.length) { view.events(pending); pending = []; }
    clinic.patients = clinic.patients.filter((p) => p.state !== 'gone' || minute - p.since < 5);
    view.frame(clinic, minute, dt);
    hud.innerHTML = `${clock(minute)} &middot; ${money(revenue)} &middot; ${reviews} reviews<small>${log}</small>`;
    requestAnimationFrame(loop);
  }
  preloadClinic().then(() => { (window as any).__harnessReady = true; });
  requestAnimationFrame(loop);

  const focus = q.get('focus');
  if (focus !== null) setTimeout(() => view.focusOp('op' + focus), 50);
  const sel = q.get('select');
  if (sel !== null) setTimeout(() => view.select('op' + sel), 50);

  (window as any).__harness = {
    clinic, view,
    get minute() { return minute; },
    setSpeed, addOp, buy, jump: (m: number) => { pending.push(...jump(m)); },
    focus: (slot: number | null) => view.focusOp(slot === null ? null : 'op' + slot),
    select: (slot: number | null) => view.select(slot === null ? null : 'op' + slot),
    log: () => log,
  };
}

// ------------------------------------------------------------------ model gallery (?gallery=1, ?fallback=1)

async function gallery(root: HTMLElement, fallback: boolean): Promise<void> {
  document.body.classList.add('clean');
  await preloadClinic();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#EAF7F3');
  scene.add(new THREE.HemisphereLight('#ffffff', '#d8c7b0', 1.4));
  const sun = new THREE.DirectionalLight('#fff3e0', 2.2);
  sun.position.set(-6, 12, 8);
  scene.add(sun);
  const keys = [...CLINIC_MODELS, 'office_desk', ...PEOPLE_MODELS];
  const cols = 8;
  const labels: { el: HTMLDivElement; p: THREE.Vector3 }[] = [];
  const kinds: Record<string, PersonKind> = { char_adult: 'adult', char_kid: 'kid', char_senior: 'senior', char_staff: 'staff', char_dentist: 'dentist' };
  keys.forEach((k, i) => {
    const x = (i % cols) * 2.6, z = Math.floor(i / cols) * 3.2;
    const obj = kinds[k]
      ? createPerson(kinds[k], { skin: '#EDBB94', hair: '#6B4526', shirt: '#5FA8F5', pants: '#3D5A80', shoes: '#ffffff', scrubs: '#2BB3A3', hairStyle: 1 }, false, fallback).root
      : makeProp(k, 0, fallback);
    obj.position.set(x, 0, z);
    scene.add(obj);
    const src = loadedModel(k);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3), new THREE.MeshStandardMaterial({ color: src ? '#FFFFFF' : '#FFE3E3' }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(x, -0.001, z);
    scene.add(floor);
    const b = src ? modelBounds(src) : null;
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;font:800 11px Nunito,sans-serif;color:#16323A;background:rgba(255,255,255,.85);padding:2px 5px;border-radius:6px;transform:translate(-50%,0);white-space:nowrap';
    el.textContent = k + (b ? ` ${(b.max.x - b.min.x).toFixed(2)}x${(b.max.y - b.min.y).toFixed(2)}x${(b.max.z - b.min.z).toFixed(2)}` : ' (stand-in)');
    root.appendChild(el);
    labels.push({ el, p: new THREE.Vector3(x, 0, z + 1.25) });
  });
  const cam = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  const rows = Math.ceil(keys.length / cols);
  const cx = (cols - 1) * 1.3, cz = (rows - 1) * 1.6;
  let w = 1, h = 1;
  attachRenderer(root, (ww, hh) => { w = ww; h = hh; cam.aspect = ww / hh; cam.updateProjectionMatrix(); });
  const d = Number(q.get('dist') ?? 34);
  const el = THREE.MathUtils.degToRad(50), az = THREE.MathUtils.degToRad(17);
  const tx = Number(q.get('gx') ?? cx), tz = Number(q.get('gz') ?? cz);
  cam.position.set(tx + d * Math.cos(el) * Math.sin(az), d * Math.sin(el), tz + d * Math.cos(el) * Math.cos(az));
  cam.lookAt(tx, 0, tz);
  const v = new THREE.Vector3();
  const loop = () => {
    for (const l of labels) {
      v.copy(l.p).project(cam);
      l.el.style.left = `${(v.x + 1) / 2 * w}px`;
      l.el.style.top = `${(1 - v.y) / 2 * h}px`;
    }
    getRenderer().render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
  (window as any).__harnessReady = true;
}

if (q.get('standins') === '1') useStandInsOnly(true);
if (q.get('gallery') === '1') void gallery(document.getElementById('view')!, q.get('fallback') === '1');
else runHarness();
