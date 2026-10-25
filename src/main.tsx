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

// Service-worker registration lives in App (useRegisterSW) so there is a
// single registration that also drives the "new version" banner.
