// Save system: the game state is saved to cookies (the primary store the owner asked for)
// and mirrored to localStorage. Both hold the same LZ-compressed JSON; on load the newer copy wins.
//
// Cookies: chunks of <= 3800 chars named fb_s0..fb_sN plus fb_meta = "<chunks>|<savedAt>|<checksum>",
// scoped to the page's directory path so other apps on the same github.io domain are untouched.
// localStorage holds the full save and is the primary store. Cookies ride along on every HTTP request
// to the game path, and hosts reject request headers past ~16 KB (HTTP 431 locks the whole site), so
// the cookie copy is a compact backup with a hard budget of MAX_CHUNKS chunks (~7.6 KB): history and
// today's patients are dropped from it, and if it still does not fit, no cookie is written at all.
// The loader prefers localStorage and only falls back to the cookie when localStorage is empty.
import LZString from 'lz-string';
import type { GameState } from './types';

export const SAVE_VERSION = 1;
const PREFIX = 'fb_s';
const META = 'fb_meta';
const CHUNK = 3800;
const MAX_CHUNKS = 2;          // ~7.6 KB: Node/Vite reject > 16 KB of headers (431), so stay far below
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

function trimmedForCookie(state: GameState): string | null {
  const fits = (d: string) => d.length <= CHUNK * MAX_CHUNKS;
  // compact backup: no history, no candidates, no reviews text, no patients of the day
  const trimClinic = (c: GameState['locations'][number]) => ({ ...c, reviews: c.reviews.slice(-5), patients: [] });
  const slim: GameState = {
    ...state, ledger: [], reports: [], candidates: [],
    locations: state.locations.map(trimClinic), employer: state.employer ? trimClinic(state.employer) : null,
  };
  const data = encodeSave(slim);
  if (fits(data)) return data;
  const slimmer: GameState = { ...slim, locations: slim.locations.map((c) => ({ ...c, reviews: [] })), employer: slim.employer ? { ...slim.employer, reviews: [] } : null };
  const d2 = encodeSave(slimmer);
  return fits(d2) ? d2 : null;
}

function clearCookieSave(): void {
  const c = getCookies();
  for (const k of Object.keys(c)) if (k.startsWith(PREFIX) || k === META) setCookie(k, '', 0);
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
    const compact = trimmedForCookie(state);
    if (compact) cookie = writeCookies(compact, savedAt);
    else clearCookieSave();
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
  // The full localStorage copy wins unless the compact cookie is strictly newer (localStorage failed).
  const cookieFirst = !!fromCookie && (!fromLocal || fromCookie.savedAt > fromLocal.savedAt);
  const candidates = (cookieFirst ? [fromCookie, fromLocal] : [fromLocal, fromCookie]).filter(Boolean) as { data: string; savedAt: number }[];
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
