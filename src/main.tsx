import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeSettings } from './db/db';
import { applyThemeFromSettings, watchSystemTheme } from './lib/theme';
import './styles.css';

// Uncaught errors and unhandled rejections are reported by the inline
// script in index.html, which paints them in the #ft-diag card together
// with its diagnostic log (in dev and prod alike). bootstrap() therefore
// just throws: a rejected bootstrap promise reaches that card through its
// unhandledrejection handler.
async function bootstrap() {
  try {
    const settings = await initializeSettings();
    applyThemeFromSettings(settings.themeMode);
    watchSystemTheme();
  } catch (err) {



    console.error('FuelTracker: settings initialization failed', err);
  }

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Bootstrap failed: #root element not found');

  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary label="App">
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

void bootstrap();

// Ask the browser to treat this origin's storage as persistent. All data
// lives only in this device's IndexedDB, so eviction under storage
// pressure (or Safari's inactivity-based clean-up for sites opened in a
// tab) would lose it. Best-effort: browsers decide by their own heuristics
// (Firefox may show a permission prompt), and a refusal changes nothing
// else — backups remain the safety net. Not awaited, so it never delays
// the first render.
async function requestPersistentStorage(): Promise<void> {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    const granted = await navigator.storage.persist();
    console.log('[ft] persistent storage', granted ? 'granted' : 'not granted');
  } catch (err) {
    console.warn('[ft] persistent storage request failed:', err);
  }
}

void requestPersistentStorage();

// Service-worker registration lives in App (useRegisterSW) so there is a
// single registration that also drives the "new version" banner.
