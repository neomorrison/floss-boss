// Save system: the game state is saved to cookies (the primary store the owner asked for)
// and mirrored to localStorage. Both hold the same LZ-compressed JSON; on load the newer copy wins.
//
// Cookies: chunks of <= 3800 chars named fb_s0..fb_sN plus fb_meta = "<chunks>|<savedAt>|<checksum>",
// scoped to the page's directory path so other apps on the same github.io domain are untouched.
// Budget: at most MAX_CHUNKS chunks. If the compressed save is bigger, bulky history
// (ledger, day reports, reviews) is trimmed from the cookie copy only.
import LZString from 'lz-string';
import type { GameState } from './types';

export const SAVE_VERSION = 1;
const PREFIX = 'fb_s';
const META = 'fb_meta';
const CHUNK = 3800;
const MAX_CHUNKS = 24;         // ~91 KB; GitHub Pages accepted 100 KB cookie headers in testing (2026-09-23)
const LS_KEY = 'flossboss.save';
const LS_SETTINGS = 'flossboss.settings';
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

function cookiePath(): string {
  if (typeof location === 'undefined') return '/';
  const p = location.pathname;
  return p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1) || '/';
}

function setCookie(name: string, value: string, maxAge = TEN_YEARS) {
  document.cookie = `${name}=${value}; max-age=${maxAge}; path=${cookiePath()}; SameSite=Lax`;
}
function getCookies(): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof document === 'undefined' || !document.cookie) return out;
  for (const part of document.cookie.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function checksum(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function encodeSave(state: GameState): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(state));
}
export function decodeSave(data: string): GameState | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(data);
    if (!json) return null;
    const s = JSON.parse(json) as GameState;
    if (!s || typeof s !== 'object' || typeof s.day !== 'number') return null;
    return s;
  } catch {
    return null;
  }
}

function trimmedForCookie(state: GameState): string {
  let data = encodeSave(state);
  if (data.length <= CHUNK * MAX_CHUNKS) return data;
  const slim: GameState = { ...state, ledger: [], reports: state.reports.slice(-5) };
  data = encodeSave(slim);
  if (data.length <= CHUNK * MAX_CHUNKS) return data;
  const trimClinic = (c: GameState['locations'][number]) => ({ ...c, reviews: c.reviews.slice(-10) });
  const slimmer: GameState = { ...slim, reports: [], candidates: [], locations: slim.locations.map(trimClinic), employer: slim.employer ? trimClinic(slim.employer) : null };
  return encodeSave(slimmer);
}

function writeCookies(data: string, savedAt: number): boolean {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += CHUNK) chunks.push(data.slice(i, i + CHUNK));
  if (chunks.length > MAX_CHUNKS) return false;
  const old = getCookies();
  chunks.forEach((c, i) => setCookie(PREFIX + i, c));
  for (let i = chunks.length; i < 64; i++) {
    if (old[PREFIX + i] === undefined) break;
    setCookie(PREFIX + i, '', 0);
  }
  setCookie(META, `${chunks.length}|${savedAt}|${checksum(data)}`);
  return true;
}

function readCookies(): { data: string; savedAt: number } | null {
  const c = getCookies();
  const meta = c[META];
  if (!meta) return null;
  const [n, at, sum] = meta.split('|');
  const count = Number(n);
  if (!count || count > 64) return null;
  let data = '';
  for (let i = 0; i < count; i++) {
    const part = c[PREFIX + i];
    if (part === undefined) return null;
    data += part;
  }
  if (checksum(data) !== sum) return null;
  return { data, savedAt: Number(at) || 0 };
}

export interface SaveInfo { ok: boolean; bytes: number; cookie: boolean; local: boolean }

export function saveGame(state: GameState): SaveInfo {
  const savedAt = Date.now();
  let cookie = false;
  let local = false;
  const full = encodeSave(state);
  try {
    cookie = writeCookies(trimmedForCookie(state), savedAt);
  } catch (e) {
    console.warn('cookie save failed', e);
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ savedAt, data: full }));
    local = true;
  } catch {
    /* private mode or quota */
  }
  return { ok: cookie || local, bytes: full.length, cookie, local };
}

export function loadGame(): GameState | null {
  const fromCookie = (() => { try { return readCookies(); } catch { return null; } })();
  const fromLocal = (() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw) as { savedAt: number; data: string };
      return o && o.data ? o : null;
    } catch {
      return null;
    }
  })();
  const candidates = [fromCookie, fromLocal].filter(Boolean) as { data: string; savedAt: number }[];
  candidates.sort((a, b) => b.savedAt - a.savedAt);
  for (const c of candidates) {
    const s = decodeSave(c.data);
    if (s) return s;
  }
  return null;
}

export function hasSave(): boolean {
  return loadGame() !== null;
}

export function deleteSave(): void {
  const c = getCookies();
  for (const k of Object.keys(c)) if (k.startsWith(PREFIX) || k === META) setCookie(k, '', 0);
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

// Export and import as a copyable text code (Settings screen).
export function exportSave(state: GameState): string { return 'FLOSS1:' + encodeSave(state); }
export function importSave(code: string): GameState | null {
  const t = code.trim();
  return decodeSave(t.startsWith('FLOSS1:') ? t.slice(7) : t);
}

// ---------------------------------------------------------------- settings (not part of the save)
export interface Settings {
  master: number; music: number; sfx: number;
  quality: 'low' | 'high';       // pixel ratio cap, shadows, particle counts
  reducedMotion: boolean;        // no camera shake or hitch
  haptics: boolean;              // navigator.vibrate where supported
  showHints: boolean;
  disclosing: boolean;           // last toggle state of the disclosing solution
}
export const DEFAULT_SETTINGS: Settings = {
  master: 0.8, music: 0.5, sfx: 0.8, quality: 'high', reducedMotion: false, haptics: true, showHints: true, disclosing: false,
};
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch { /* ignore */ }
}
