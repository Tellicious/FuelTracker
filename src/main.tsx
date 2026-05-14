import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeSettings } from './db/db';
import { applyThemeFromSettings, watchSystemTheme } from './lib/theme';
import './styles.css';

// Render an uncaught-error message into the #ft-error placeholder in
// index.html (which is hidden by default). Used by the global error
// handlers below as a last-resort visible failure mode when the React
// tree itself can't mount — without this, an early crash would leave the
// user staring at a blank white screen.
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


  console.error(prefix, err);
}

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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onRegisteredSW(swUrl) {
          console.log('[ft] service worker registered:', swUrl);
        },
        onRegisterError(err) {
          console.error('[ft] service worker registration failed:', err);
        },
      });
    })
    .catch((err) => {
      console.log('[ft] virtual:pwa-register import failed (offline support disabled):', err);
    });
}
