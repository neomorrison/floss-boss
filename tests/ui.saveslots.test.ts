import { describe, expect, it } from 'vitest';
import type { SlotId, SlotInfo } from '../src/core/save';
import { relativeTime, titleButtonState } from '../src/ui/logic';

const empty = (slot: SlotId): SlotInfo => ({ slot, exists: false, savedAt: 0, head: null });
const filled = (slot: SlotId, savedAt = 1000): SlotInfo => ({
  slot, exists: true, savedAt,
  head: { name: 'Ann', avatar: 0, title: 'Hygienist', phase: 'owner', day: 5, cash: 100, cityPct: 10, difficulty: 'standard', goldenMolar: false },
});

describe('relativeTime', () => {
  const NOW = Date.UTC(2026, 8, 24, 12, 0, 0); // 2026-09-24 12:00 UTC

  it('reads as just now under a minute', () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe('Just now');
    expect(relativeTime(NOW, NOW)).toBe('Just now');
  });

  it('counts minutes under an hour', () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(relativeTime(NOW - 59 * 60_000, NOW)).toBe('59 min ago');
  });

  it('counts hours under a day', () => {
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe('2 h ago');
    expect(relativeTime(NOW - 23 * 3_600_000, NOW)).toBe('23 h ago');
  });

  it('calls 24 to 48 hours ago "Yesterday"', () => {
    expect(relativeTime(NOW - 25 * 3_600_000, NOW)).toBe('Yesterday');
    expect(relativeTime(NOW - 47 * 3_600_000, NOW)).toBe('Yesterday');
  });

  it('counts days under a week', () => {
    expect(relativeTime(NOW - 3 * 86_400_000, NOW)).toBe('3 d ago');
    expect(relativeTime(NOW - 6 * 86_400_000, NOW)).toBe('6 d ago');
  });

  it('falls back to a short date past a week', () => {
    expect(relativeTime(Date.UTC(2026, 8, 1), NOW)).toBe('Sep 1');
    expect(relativeTime(Date.UTC(2026, 0, 5), NOW)).toBe('Jan 5');
  });

  it('never goes negative for a clock skewed slightly into the future', () => {
    expect(relativeTime(NOW + 5000, NOW)).toBe('Just now');
  });

  it('is blank with no save yet', () => {
    expect(relativeTime(0, NOW)).toBe('');
  });
});

describe('titleButtonState', () => {
  it('shows nothing to load on a blank slate: New game picks slot 1', () => {
    const slots = [empty(1), empty(2), empty(3)];
    const s = titleButtonState(slots, 1, false);
    expect(s).toEqual({ showContinue: false, showLoadGame: false, showSaves: false, newGameSlot: 1 });
  });

  it('shows Continue for a loaded active slot, and Saves to reach the others', () => {
    const slots = [filled(1), empty(2), empty(3)];
    const s = titleButtonState(slots, 1, true);
    expect(s.showContinue).toBe(true);
    expect(s.showLoadGame).toBe(false);
    expect(s.showSaves).toBe(true);
    expect(s.newGameSlot).toBe(2);
  });

  it('shows Load game (not Saves, not Continue) when the active slot is empty but another slot has a save', () => {
    const slots = [empty(1), filled(2), empty(3)];
    const s = titleButtonState(slots, 1, false);
    expect(s.showContinue).toBe(false);
    expect(s.showLoadGame).toBe(true);
    expect(s.showSaves).toBe(false);
    expect(s.newGameSlot).toBe(1);
  });

  it('treats an active slot that failed to load in memory the same as empty', () => {
    // listSlots() says slot 1 exists (it is on disk) but store.loaded is false (e.g. a corrupt decode)
    const slots = [filled(1), filled(2), empty(3)];
    const s = titleButtonState(slots, 1, false);
    expect(s.showContinue).toBe(false);
    expect(s.showLoadGame).toBe(true);
    expect(s.newGameSlot).toBe(3);
  });

  it('has no empty slot to jump into once all three are full', () => {
    const slots = [filled(1), filled(2), filled(3)];
    const s = titleButtonState(slots, 2, true);
    expect(s.newGameSlot).toBeNull();
    expect(s.showContinue).toBe(true);
    expect(s.showSaves).toBe(true);
  });

  it('hides every button on a totally blank slate with nothing loaded', () => {
    const slots = [empty(1), empty(2), empty(3)];
    const s = titleButtonState(slots, 1, false);
    expect(s.showContinue).toBe(false);
    expect(s.showLoadGame).toBe(false);
    expect(s.showSaves).toBe(false);
  });
});
