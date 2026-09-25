import { describe, it, expect, beforeEach } from 'vitest';
import * as sim from '../src/sim';
import { activeSlot, setActiveSlot, saveGame, loadGame, listSlots, deleteSave, firstEmptySlot, anySave, encodeSave } from '../src/core/save';

// Minimal browser stubs: localStorage and a cookie jar (the save module writes both).
function installStubs() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
  const jar = new Map<string, string>();
  (globalThis as any).document = {
    get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(v: string) {
      const [pair, ...attrs] = v.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim();
      const val = pair.slice(i + 1).trim();
      if (attrs.some((a) => a.trim() === 'max-age=0')) jar.delete(k); else jar.set(k, val);
    },
  };
  (globalThis as any).location = { pathname: '/floss-boss/' };
  return store;
}

const game = (name: string) => sim.newGame({ name, avatar: 1, seed: 7, nowMs: 0 });

describe('save slots', () => {
  let store: Map<string, string>;
  beforeEach(() => { store = installStubs(); });

  it('defaults to slot 1 and keeps the original key for it (old saves become slot 1)', () => {
    const old = game('Legacy');
    store.set('flossboss.save', JSON.stringify({ savedAt: 5, data: encodeSave(old) }));
    expect(activeSlot()).toBe(1);
    const slots = listSlots();
    expect(slots[0].exists).toBe(true);
    expect(slots[0].head?.name).toBe('Legacy');
    expect(slots[1].exists).toBe(false);
    expect(loadGame(1)?.player.name).toBe('Legacy');
  });

  it('keeps three independent slots and remembers the active one', () => {
    saveGame(game('Ann'), 1);
    saveGame(game('Bo'), 2);
    setActiveSlot(3);
    saveGame(game('Cy'));
    expect(activeSlot()).toBe(3);
    expect(listSlots().map((s) => s.head?.name)).toEqual(['Ann', 'Bo', 'Cy']);
    expect(loadGame(2)?.player.name).toBe('Bo');
    expect(loadGame()?.player.name).toBe('Cy');
    expect(firstEmptySlot()).toBeNull();
  });

  it('deleting one slot leaves the others', () => {
    saveGame(game('Ann'), 1);
    saveGame(game('Bo'), 2);
    deleteSave(1);
    expect(listSlots()[0].exists).toBe(false);
    expect(loadGame(2)?.player.name).toBe('Bo');
    expect(firstEmptySlot()).toBe(1);
    expect(anySave()).toBe(true);
  });

  it('the cookie backup restores only its own slot', () => {
    saveGame(game('Ann'), 2);
    store.delete('flossboss.save.2');     // localStorage wiped, cookie remains
    expect(loadGame(2)?.player.name).toBe('Ann');
    expect(loadGame(1)).toBeNull();
    expect(listSlots()[1].exists).toBe(true);
  });

  it('the slot head carries what the picker shows', () => {
    const s = game('Dee');
    s.cash = 1234.4;
    saveGame(s, 1);
    const head = listSlots()[0].head!;
    expect(head).toMatchObject({ name: 'Dee', avatar: 1, phase: 'school', cash: 1234, difficulty: 'standard' });
    expect(head.cityPct).toBeGreaterThan(0);
  });
});
