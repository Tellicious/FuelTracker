import type { ThemeMode } from '../db/types';

// Apply the user's chosen theme (light / dark / auto) to the live DOM by
// setting (or removing) the data-theme attribute on the root html element.
// Also keeps the iOS status-bar tint (<meta name="theme-color">) in sync
// so the system chrome matches the app's background colour.
export function applyThemeFromSettings(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'auto') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }

  const themeColor = resolveThemeColor(mode);
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = themeColor;
}

// Resolve the concrete colour string for the iOS status-bar tint. In auto
// mode, queries the system preference via matchMedia — falls back to dark
// in non-browser contexts (SSR, tests).
function resolveThemeColor(mode: ThemeMode): string {
  if (mode === 'light') return '#f6faf7';
  if (mode === 'dark') return '#0f1410';

  const prefersLight =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? '#f6faf7' : '#0f1410';
}

let systemWatcherInstalled = false;
// Install a one-time listener on the system colour-scheme media query so
// that when the user is in "auto" mode AND the OS flips dark↔light, the
// theme-color meta tag updates immediately. No-ops if the watcher is
// already installed (idempotent) or matchMedia isn't available.
export function watchSystemTheme(): void {
  if (systemWatcherInstalled || typeof window === 'undefined' || !window.matchMedia) return;
  systemWatcherInstalled = true;
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => {
    if (!document.documentElement.hasAttribute('data-theme')) {
      applyThemeFromSettings('auto');
    }
  };
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else mq.addListener(handler);
}
