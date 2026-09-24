// Tiny typed event bus shared by UI modules.
import type { SimEvent } from './types';
export type BusEvents = {
  'state:changed': void;
  'toast': { text: string; kind?: 'info' | 'good' | 'bad' };
  'sfx': { key: string; volume?: number; rate?: number };
  'music': { key: string | null };
  'navigate': { screen: string; params?: Record<string, unknown> };
  'sim:events': SimEvent[];
  'settings:changed': void;
};
type Handler<T> = (payload: T) => void;
const handlers = new Map<string, Set<Handler<any>>>();

export const bus = {
  on<K extends keyof BusEvents>(name: K, fn: Handler<BusEvents[K]>): () => void {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name)!.add(fn);
    return () => handlers.get(name)!.delete(fn);
  },
  emit<K extends keyof BusEvents>(name: K, payload: BusEvents[K]): void {
    handlers.get(name)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
  },
};
