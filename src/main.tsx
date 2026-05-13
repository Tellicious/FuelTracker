import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeSettings } from './db/db';
import { applyThemeFromSettings, watchSystemTheme } from './lib/theme';
import './styles.css';

/**
 * Visibly surface an error in the page's reserved #ft-error pre tag. Used as
 * a backstop when something fails so badly that neither React nor the
 * top-level capture-phase listener in index.html can describe it.
 */
function paintError(prefix: string, err: unknown) {
  const el = document.getElementById('ft-error');
  if (!el) return;
  const e = err as { message?: string; stack?: string } | null;
  const msg = (e && (e.message ?? String(e))) || 'unknown';
  const stack = (e && e.stack) || '';
  el.style.display = 'block';
  el.textContent =
    prefix +
    '\n\n' +
    msg +
    '\npage url: ' +
    location.href +
    '\nUA: ' +
    navigator.userAgent +
    (stack ? '\n\n' + stack : '');
  // Also log for remote-inspect / Safari → Mac debugging.
  // eslint-disable-next-line no-console
  console.error(prefix, err);
}

// Register additional same-origin handlers from inside the module so that
// errors thrown in our own code don't get cross-origin-masked into a generic
// "Script error" with no details.
window.addEventListener('error', (e) => {
  if (e.error) paintError('Uncaught error (module-scope)', e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  paintError('Unhandled rejection (module-scope)', e.reason);
});

async function bootstrap() {
  try {
    const settings = await initializeSettings();
    applyThemeFromSettings(settings.themeMode);
    watchSystemTheme();
  } catch (err) {
    // IndexedDB unavailable (e.g. some private modes) — log but continue;
    // components will surface the problem.
    // eslint-disable-next-line no-console
    console.error('FuelTracker: settings initialization failed', err);
  }

  const rootEl = document.getElementById('root');
  if (!rootEl) {
    paintError('Bootstrap failed', new Error('#root element not found'));
    return;
  }

  try {
    createRoot(rootEl).render(
      <StrictMode>
        <ErrorBoundary label="App">
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
  } catch (err) {
    paintError('Render failed', err);
    throw err;
  }
}

bootstrap().catch((err) => paintError('Bootstrap failed', err));
