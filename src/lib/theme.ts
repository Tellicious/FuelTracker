import type { ThemeMode } from '../db/types';

/**
 * Applies the chosen theme to the document root.
 * - 'auto' removes the attribute and lets prefers-color-scheme decide
 * - 'light' / 'dark' set the attribute explicitly, overriding the OS preference
 */
export function applyThemeFromSettings(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'auto') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }
  // Sync the theme-color meta tag so the iOS status bar tint follows the theme.
  const themeColor = resolveThemeColor(mode);
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = themeColor;
}

function resolveThemeColor(mode: ThemeMode): string {
  if (mode === 'light') return '#f6faf7';
  if (mode === 'dark') return '#0f1410';
  // auto
  const prefersLight =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? '#f6faf7' : '#0f1410';
}

/**
 * Listens for OS-level theme changes and updates the theme-color meta tag
 * when the user has chosen 'auto'. Idempotent — calling it multiple times
 * adds only one listener.
 */
let systemWatcherInstalled = false;
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
  else mq.addListener(handler); // Safari < 14
}
