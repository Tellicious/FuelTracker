
// Safely read a string from localStorage. Returns null on access denial
// (Safari private mode, embedded iframe with denied storage, etc.) so
// callers can fall back without a try/catch at every callsite.
export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Safely write a string to localStorage. Silently no-ops on access denial
// or quota-exceeded errors — the app is offline-first so localStorage is a
// nice-to-have for UI prefs, not a source of truth.
export function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

// Safely delete a key from localStorage. Same defensive shape as safeSet:
// callers never have to think about the storage API throwing.
export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
