// Legacy (New Game+) state that survives across runs (DESIGN 11.4). Stored apart from the run save,
// in localStorage with a small cookie copy, so starting a new game never wipes it.
import type { LegacyPerkId } from './types';

export interface LegacyState {
  points: number;             // unspent Legacy points
  earned: number;             // lifetime points earned
  owned: LegacyPerkId[];      // perks bought (each once); the player picks which to bring into a run
  wins: number;               // Golden Molars won
  runs: number;               // careers retired
  veteranUnlocked: boolean;   // Veteran is always selectable; this marks that it was earned
}

const LS_KEY = 'flossboss.legacy';
const COOKIE = 'fb_legacy';
const EMPTY: LegacyState = { points: 0, earned: 0, owned: [], wins: 0, runs: 0, veteranUnlocked: false };

function cookiePath(): string {
  if (typeof location === 'undefined') return '/';
  const p = location.pathname;
  return p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1) || '/';
}

export function loadLegacy(): LegacyState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  try {
    if (typeof document !== 'undefined') {
      const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
      if (m) return { ...EMPTY, ...JSON.parse(decodeURIComponent(m[1])) };
    }
  } catch { /* ignore */ }
  return { ...EMPTY };
}

export function saveLegacy(l: LegacyState): void {
  const json = JSON.stringify(l);
  try { localStorage.setItem(LS_KEY, json); } catch { /* ignore */ }
  try {
    if (typeof document !== 'undefined') document.cookie = `${COOKIE}=${encodeURIComponent(json)}; max-age=315360000; path=${cookiePath()}; SameSite=Lax`;
  } catch { /* ignore */ }
}
