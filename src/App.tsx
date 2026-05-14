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

// Root component. Owns the active-tab state and the active-vehicle id,
// both of which are persisted to localStorage so navigation survives a
// page reload. Renders the active tab inside an ErrorBoundary so a crash
// in one screen doesn't take down the rest of the app. The TabBar is
// pinned to the bottom and switches between five views (Dashboard /
// Records / AddEntry / Vehicles / Settings); switching tabs scrolls the
// screen back to the top.
export function App() {
  const settings = useLiveQuery(() => getSettings(), []);
  const [tab, setTabRaw] = useState<Tab>('dashboard');




  const setTab = (next: Tab) => {
    setTabRaw(next);
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {

      window.scrollTo(0, 0);
    }
  };
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bannerHash, setBannerHash] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);




  const [activeVehicleId, setActiveVehicleIdState] = useState<string | null>(
    () => safeGet('ft.lastVehicleId'),
  );
  const setActiveVehicleId = (id: string | null) => {
    setActiveVehicleIdState(id);
    if (id) safeSet('ft.lastVehicleId', id);
  };

  const vehicles = useLiveQuery(() => db.vehicles.orderBy('createdAt').toArray(), []) ?? [];




  useEffect(() => {
    if (!vehicles.length) return;
    if (!activeVehicleId || !vehicles.some((v) => v.id === activeVehicleId)) {
      setActiveVehicleId(vehicles[0].id);
    }
  }, [vehicles, activeVehicleId]);


  useEffect(() => {
    if (settings?.themeMode) applyThemeFromSettings(settings.themeMode);
  }, [settings?.themeMode]);

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW() {

    },
  });
  const [refreshState] = needRefresh;

  const vehicleCount = vehicles.length;
  const entryCount = useLiveQuery(() => db.fuelups.count(), []) ?? 0;


  const pushToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };





  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await buildPayload();
        const h = await payloadHash(p);
        if (!cancelled) setBannerHash(h);
      } catch (err) {

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
