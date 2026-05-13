/**
 * iOS Safari can throw on localStorage access in private browsing or
 * standalone-PWA mode under specific conditions (storage quota, sandboxing).
 * Wrapping every access in try/catch keeps a flaky storage layer from
 * crashing the whole app — the worst case is that preferences don't
 * persist, which is acceptable.
 */
export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
