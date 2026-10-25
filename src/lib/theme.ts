import type { ThemeMode } from '../db/types';

const LIGHT_THEME_COLOR = '#f6faf7';
const DARK_THEME_COLOR = '#0f1410';

// Apply the user's chosen theme (light / dark / auto) to the live DOM by
// setting (or removing) the data-theme attribute on the root html element.
// Also keeps the iOS status-bar tint (<meta name="theme-color">) in sync
// so the system chrome matches the app's background colour.
//
// index.html ships two theme-color metas, one per prefers-color-scheme
// media query, and the browser uses whichever one's media matches. So
// every meta has to be updated: in a forced mode they all get the forced
// colour (otherwise forcing Dark on a light-mode phone left the light
// meta in charge), and in auto mode each one gets the colour for its own
// media query back.
export function applyThemeFromSettings(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'auto') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }

  let metas = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  );
  if (metas.length === 0) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
    metas = [meta];
  }
  for (const meta of metas) {
    meta.content = mode === 'auto' ? autoColorForMeta(meta) : resolveThemeColor(mode);
  }
}

// In auto mode a media-scoped meta keeps the colour for its own scheme;
// an unscoped one follows the current system preference.
function autoColorForMeta(meta: HTMLMetaElement): string {
  const media = meta.getAttribute('media') ?? '';
  if (media.includes('dark')) return DARK_THEME_COLOR;
  if (media.includes('light')) return LIGHT_THEME_COLOR;
  return resolveThemeColor('auto');
}

// Resolve the concrete colour string for the iOS status-bar tint. In auto
// mode, queries the system preference via matchMedia — falls back to dark
// in non-browser contexts (SSR, tests).
function resolveThemeColor(mode: ThemeMode): string {
  if (mode === 'light') return LIGHT_THEME_COLOR;
  if (mode === 'dark') return DARK_THEME_COLOR;

  const prefersLight =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? LIGHT_THEME_COLOR : DARK_THEME_COLOR;
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
