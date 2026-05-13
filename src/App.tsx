import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { BackupBanner } from './components/BackupBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InstallPrompt } from './components/InstallPrompt';
import { TabBar, type Tab } from './components/TabBar';
import { db, getSettings } from './db/db';
import { safeGet, safeSet } from './lib/storage';
import {
  buildPayload,
  exportBackup,
  isBackupOverdue,
  payloadHash,
} from './lib/backup';
import { applyThemeFromSettings } from './lib/theme';
import { AddEntryScreen } from './screens/AddEntry';
import { DashboardScreen } from './screens/Dashboard';
import { RecordsScreen } from './screens/Records';
import { SettingsScreen } from './screens/Settings';
import { VehiclesScreen } from './screens/Vehicles';

export function App() {
  const settings = useLiveQuery(() => getSettings(), []);
  const [tab, setTabRaw] = useState<Tab>('dashboard');
  // Reset scroll position whenever the user switches tabs — otherwise opening
  // (say) Add Entry after scrolling down on Dashboard keeps the previous
  // scroll offset and shows the new screen mid-page. Wraps setTabRaw so every
  // call site (including the TabBar onChange) gets the behaviour for free.
  const setTab = (next: Tab) => {
    setTabRaw(next);
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      // 'instant' isn't recognised on older WebKit; fall back to plain scroll.
      window.scrollTo(0, 0);
    }
  };
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bannerHash, setBannerHash] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Vehicle selection — shared across Dashboard / Records / AddEntry. Hydrated
  // from localStorage on first paint, then maintained in state and mirrored
  // back to localStorage on every change.
  const [activeVehicleId, setActiveVehicleIdState] = useState<string | null>(
    () => safeGet('ft.lastVehicleId'),
  );
  const setActiveVehicleId = (id: string | null) => {
    setActiveVehicleIdState(id);
    if (id) safeSet('ft.lastVehicleId', id);
  };

  const vehicles = useLiveQuery(() => db.vehicles.orderBy('createdAt').toArray(), []) ?? [];

  // Once vehicles are loaded, make sure activeVehicleId points at something
  // real. If we have nothing selected yet, or the persisted id no longer
  // exists, fall back to the first vehicle.
  useEffect(() => {
    if (!vehicles.length) return;
    if (!activeVehicleId || !vehicles.some((v) => v.id === activeVehicleId)) {
      setActiveVehicleId(vehicles[0].id);
    }
  }, [vehicles, activeVehicleId]);

  // Whenever the chosen theme mode changes, re-apply it to the document.
  useEffect(() => {
    if (settings?.themeMode) applyThemeFromSettings(settings.themeMode);
  }, [settings?.themeMode]);

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW() {
      // SW registered
    },
  });
  const [refreshState] = needRefresh;

  const vehicleCount = vehicles.length;
  const entryCount = useLiveQuery(() => db.fuelups.count(), []) ?? 0;

  // Pop a toast that auto-dismisses
  const pushToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  // Compute current payload hash for the backup banner decision. Wrapped so
  // that a failure here (e.g. crypto.subtle unavailable in an unusual
  // context) doesn't surface as an unhandled rejection — we just skip the
  // banner. The export flow re-computes the hash with its own try/catch.
  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await buildPayload();
        const h = await payloadHash(p);
        if (!cancelled) setBannerHash(h);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('payloadHash skipped:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings, vehicleCount, entryCount]);

  const showBackupBanner = useMemo(() => {
    if (!settings || bannerDismissed || !bannerHash) return false;
    if (vehicleCount === 0 || entryCount === 0) return false;
    return isBackupOverdue(settings, bannerHash);
  }, [settings, bannerHash, bannerDismissed, vehicleCount, entryCount]);

  const daysSinceBackup = settings?.lastBackupAt
    ? Math.floor(
        (Date.now() - new Date(settings.lastBackupAt).getTime()) / (1000 * 60 * 60 * 24),
      )
    : null;

  const handleBannerBackup = async () => {
    try {
      const payload = await buildPayload();
      const ok = await exportBackup(payload);
      if (ok) {
        const hash = await payloadHash(payload);
        await db.settings.update('global', {
          lastBackupAt: new Date().toISOString(),
          lastBackupHash: hash,
        });
        pushToast('Backup ready');
      }
      setBannerDismissed(true);
    } catch (e) {
      console.error(e);
      pushToast('Backup failed');
    }
  };

  const goAddNew = () => {
    setEditingEntryId(null);
    setTab('add');
  };

  if (!settings) {
    return <div className="screen">Loading…</div>;
  }

  return (
    <div className="app">
      {showBackupBanner && (
        <div style={{ padding: '12px 16px 0' }}>
          <BackupBanner
            daysAgo={daysSinceBackup}
            onBackup={handleBannerBackup}
            onDismiss={() => setBannerDismissed(true)}
          />
        </div>
      )}

      {refreshState && (
        <div style={{ padding: '12px 16px 0' }}>
          <div className="banner" role="status">
            <div className="banner-text">A new version is available.</div>
            <button onClick={() => updateServiceWorker(true)}>Reload</button>
          </div>
        </div>
      )}

      {tab === 'dashboard' && (
        <ErrorBoundary label="Dashboard">
          <DashboardScreen
            settings={settings}
            vehicles={vehicles}
            activeVehicleId={activeVehicleId}
            onActiveVehicleChange={setActiveVehicleId}
          />
        </ErrorBoundary>
      )}
      {tab === 'records' && (
        <ErrorBoundary label="Records">
          <RecordsScreen
            settings={settings}
            vehicles={vehicles}
            activeVehicleId={activeVehicleId}
            onActiveVehicleChange={setActiveVehicleId}
            onEdit={(id) => {
              setEditingEntryId(id);
              setTab('add');
            }}
          />
        </ErrorBoundary>
      )}
      {tab === 'add' && (
        <ErrorBoundary label="Entry form">
          <AddEntryScreen
            settings={settings}
            vehicles={vehicles}
            activeVehicleId={activeVehicleId}
            onActiveVehicleChange={setActiveVehicleId}
            editingId={editingEntryId}
            onSaved={() => {
              pushToast(editingEntryId ? 'Updated' : 'Saved');
              setEditingEntryId(null);
              setTab('records');
            }}
            onCancel={() => {
              setEditingEntryId(null);
              setTab(editingEntryId ? 'records' : 'dashboard');
            }}
          />
        </ErrorBoundary>
      )}
      {tab === 'vehicles' && (
        <ErrorBoundary label="Vehicles">
          <VehiclesScreen settings={settings} />
        </ErrorBoundary>
      )}
      {tab === 'settings' && (
        <ErrorBoundary label="Settings">
          <SettingsScreen onToast={pushToast} />
        </ErrorBoundary>
      )}

      <TabBar
        active={tab}
        onChange={(t) => {
          if (t === 'add') goAddNew();
          else setTab(t);
        }}
      />

      {toast && <div className="toast">{toast}</div>}

      <InstallPrompt />
    </div>
  );
}
