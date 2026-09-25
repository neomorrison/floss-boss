import { describe, expect, it } from 'vitest';
import type { GameState, SimEvent } from '../src/core/types';
import {
  autoPauseOn, autoRaiseOn, holdLabel, holdReason, NoticeQueue, onScreen, raisePct, setGameSettings, Tallies, tallyView,
  type HoldInput, type NoticeItem, type NoticeKind,
} from '../src/ui/pause';

const idle: HoldInput = { cleaning: false, hidden: false, notice: false, huddle: false, modals: 0, panel: false };

describe('auto-pause: the clock hold', () => {
  it('runs when nothing covers the clinic', () => {
    expect(holdReason(idle)).toBeNull();
  });

  it('holds for any panel, modal, notice or huddle', () => {
    expect(holdReason({ ...idle, panel: true })).toBe('panel');
    expect(holdReason({ ...idle, modals: 1 })).toBe('modal');
    expect(holdReason({ ...idle, notice: true, modals: 1 })).toBe('notice');
    expect(holdReason({ ...idle, huddle: true, modals: 1 })).toBe('huddle');
    expect(holdReason({ ...idle, cleaning: true, panel: true })).toBe('clean');
    expect(holdReason({ ...idle, hidden: true })).toBe('hidden');
  });

  it('labels the held clock in product voice', () => {
    expect(holdLabel('panel')).toBe('Paused while a menu is open');
    expect(holdLabel('modal')).toBe(holdLabel('panel'));
    expect(holdLabel('notice')).toBe('Paused until you resume');
    expect(holdLabel(null)).toBe('');
    for (const r of ['panel', 'modal', 'notice', 'huddle', 'clean', 'hidden'] as const) expect(holdLabel(r)).not.toMatch(/—/);
  });
});

describe('auto-pause: game settings', () => {
  const st = (settings: Partial<GameState['settings']>) => ({ settings: { autoHuddle: false, ...settings } }) as Pick<GameState, 'settings'>;

  it('pauses on key events unless turned off', () => {
    expect(autoPauseOn(st({}))).toBe(true);
    expect(autoPauseOn(st({ autoPause: true }))).toBe(true);
    expect(autoPauseOn(st({ autoPause: false }))).toBe(false);
    expect(autoPauseOn(null)).toBe(true);
  });

  it('approves raises only when chosen', () => {
    expect(autoRaiseOn(st({}))).toBe(false);
    expect(autoRaiseOn(st({ autoRaise: true }))).toBe(true);
  });

  it('writes one option and keeps the others', () => {
    const s = st({ autoHuddle: true, autoRaise: true });
    setGameSettings(s, { autoPause: false });
    expect(s.settings).toEqual({ autoHuddle: true, autoRaise: true, autoPause: false });
    const empty = { settings: undefined } as unknown as Pick<GameState, 'settings'>;
    setGameSettings(empty, { autoRaise: true });
    expect(empty.settings).toEqual({ autoHuddle: false, autoRaise: true });
  });
});

describe('multi-location overlays', () => {
  it('shows owner effects only for the location on screen', () => {
    expect(onScreen('owner', 'a', 'a')).toBe(true);
    expect(onScreen('owner', 'a', 'b')).toBe(false);
    expect(onScreen('employee', 'emp', 'other')).toBe(true);
    expect(onScreen('owner', null, 'b')).toBe(true);
  });

  const ev: SimEvent[] = [
    { type: 'paid', clinicId: 'a', patientId: 'p1', amount: 120 },
    { type: 'paid', clinicId: 'b', patientId: 'p2', amount: 90 },
    { type: 'paid', clinicId: 'b', patientId: 'p3', amount: 110 },
    { type: 'review', clinicId: 'b', stars: 5, text: 'x', name: 'n' },
    { type: 'review', clinicId: 'b', stars: 4, text: 'y', name: 'm' },
    { type: 'review', clinicId: 'a', stars: 1, text: 'z', name: 'o' },
    { type: 'walkout', clinicId: 'c', patientId: 'p4', reason: 'wait' },
    { type: 'paid', clinicId: 'x', patientId: 'p5', amount: 999 },
    { type: 'seated', clinicId: 'b', patientId: 'p2', opId: 'o1' },
  ];

  it('tallies payments, reviews and walkouts off screen', () => {
    const t = new Tallies();
    expect(t.add(ev, 'a', ['a', 'b', 'c'])).toBe(true);
    expect(t.get('a')).toBeNull();
    expect(t.get('x')).toBeNull();
    expect(t.get('b')).toEqual({ paid: 2, revenue: 200, reviews: 2, stars: 9, low: 0, walkouts: 0 });
    expect(t.get('c')).toMatchObject({ walkouts: 1, paid: 0 });
    const k = t.key();
    t.clear('b');
    expect(t.get('b')).toBeNull();
    expect(t.key()).not.toBe(k);
    t.clearAll();
    expect(t.key()).toBe('');
    expect(t.add([{ type: 'seated', clinicId: 'b', patientId: 'p', opId: 'o' }], 'a', ['a', 'b'])).toBe(false);
  });

  it('turns a tally into a tab badge', () => {
    const t = new Tallies();
    t.add(ev, 'a', ['a', 'b', 'c']);
    const b = tallyView(t.get('b'))!;
    expect(b.cash).toBe('+$200');
    expect(b.stars).toBe('4.5');
    expect(b.tone).toBe('good');
    expect(b.title).toBe('Since you last looked: 2 patients paid $200, 2 reviews, 4.5 average');
    const c = tallyView(t.get('c'))!;
    expect(c).toMatchObject({ cash: '', stars: '', walkouts: 1, tone: 'bad' });
    expect(c.title).toBe('Since you last looked: 1 walkout');
    expect(tallyView(null)).toBeNull();
  });
});

describe('key event notices', () => {
  const item = (id: string, clinicId = 'a', extra: Partial<NoticeItem> = {}): NoticeItem => ({ id, clinicId, ...extra });
  const all = () => true;

  it('collects items of one kind into one notice and never duplicates', () => {
    const q = new NoticeQueue();
    expect(q.push('raise', item('s1', 'a', { ask: 400 }))).toBe(true);
    expect(q.push('raise', item('s2'))).toBe(true);
    expect(q.push('raise', item('s1', 'a', { ask: 420 }))).toBe(false);
    expect(q.size).toBe(1);
    const n = q.next(all)!;
    expect(n.kind).toBe('raise');
    expect(n.items.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(n.items[0].ask).toBe(420);
    expect(q.size).toBe(0);
  });

  it('shows one at a time in a fixed order: quits, raises, perks, chair', () => {
    const q = new NoticeQueue();
    q.push('chair', item('p1'));
    q.push('perk', item('s3'));
    q.push('raise', item('s2'));
    q.push('quit', item('s1'));
    const order: NoticeKind[] = [];
    for (let n = q.next(all); n; n = q.next(all)) { order.push(n.kind); q.done(); }
    expect(order).toEqual(['quit', 'raise', 'perk', 'chair']);
  });

  it('skips the one on screen and starts a new notice for later items', () => {
    const q = new NoticeQueue();
    q.push('perk', item('s1'));
    q.next(all);
    expect(q.showing?.kind).toBe('perk');
    expect(q.push('perk', item('s1'))).toBe(false);
    expect(q.push('perk', item('s2'))).toBe(true);
    expect(q.size).toBe(1);
    q.done();
    expect(q.showing).toBeNull();
    expect(q.next(all)!.items.map((x) => x.id)).toEqual(['s2']);
  });

  it('drops items that no longer matter (raised already, perk picked, patient gone)', () => {
    const q = new NoticeQueue();
    q.push('raise', item('s1'));
    q.push('raise', item('s2'));
    q.push('perk', item('s3'));
    const n = q.next((kind, it) => kind === 'raise' && it.id === 's2')!;
    expect(n.items.map((x) => x.id)).toEqual(['s2']);
    q.done();
    expect(q.next((kind) => kind !== 'perk')).toBeNull();
    expect(q.size).toBe(0);
  });

  it('clears everything when leaving the hub', () => {
    const q = new NoticeQueue();
    q.push('quit', item('s1'));
    q.next(all);
    q.push('raise', item('s2'));
    q.clear();
    expect(q.size).toBe(0);
    expect(q.showing).toBeNull();
  });

  it('shows a raise as a percentage', () => {
    expect(raisePct(400, 448)).toBe('+12%');
    expect(raisePct(400, 400)).toBe('');
    expect(raisePct(0, 100)).toBe('');
  });
});
