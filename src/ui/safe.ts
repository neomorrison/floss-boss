// Guards around the modules built in parallel (sim, clean, clinic). A call that throws (for example
// "not built yet") returns the fallback, so screens stay usable and show a neutral placeholder.
const warned = new Set<string>();

export function isNotBuilt(e: unknown): boolean {
  return e instanceof Error && /not built yet/.test(e.message);
}

export function attempt<T>(fn: () => T, fallback: T, label = ''): T {
  try {
    return fn();
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)) + (label ? ` (${label})` : '');
    if (!warned.has(msg)) {
      warned.add(msg);
      if (isNotBuilt(e)) console.info('[ui] waiting on', msg);
      else console.warn('[ui]', msg, e);
    }
    return fallback;
  }
}

/** Run an action; returns the error instead of throwing. */
export function tryRun<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error };
  }
}
