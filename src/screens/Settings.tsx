import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { db, getSettings } from '../db/db';
import type { BackupCadence, ConsumptionUnit, Settings, ThemeMode } from '../db/types';
import { SUPPORTED_CURRENCIES } from '../db/types';
import {
  buildPayload,
  exportBackup,
  exportConfigJsonOnly,
  exportEntriesCsvOnly,
  importFile,
  payloadHash,
} from '../lib/backup';
import { currencySymbol, fmtDate, parseDecimalInput } from '../lib/format';

const CURRENCIES = SUPPORTED_CURRENCIES;

const CADENCE_LABEL: Record<BackupCadence, string> = {
  off: 'Off',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
};

interface Props {
  onToast: (msg: string) => void;
}

export function SettingsScreen({ onToast }: Props) {
  const settings = useLiveQuery(() => getSettings(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!settings) return <div className="screen">Loading…</div>;

  const update = (patch: Partial<Settings>) => db.settings.update('global', patch);

  /** Mark a successful export by stamping the last-backup metadata. */
  const stampBackup = async () => {
    const payload = await buildPayload();
    const hash = await payloadHash(payload);
    await update({ lastBackupAt: new Date().toISOString(), lastBackupHash: hash });
  };

  const doExportBoth = async () => {
    setBusy(true);
    try {
      const payload = await buildPayload();
      const ok = await exportBackup(payload);
      if (ok) {
        await stampBackup();
        onToast('Exported entries CSV + config JSON');
      }
    } catch (e) {
      onToast('Export failed');
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const doExportEntries = async () => {
    setBusy(true);
    try {
      const payload = await buildPayload();
      const ok = await exportEntriesCsvOnly(payload);
      if (ok) onToast('Exported entries CSV');
    } catch (e) {
      onToast('Export failed');
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const doExportConfig = async () => {
    setBusy(true);
    try {
      const payload = await buildPayload();
      const ok = await exportConfigJsonOnly(payload);
      if (ok) onToast('Exported config JSON');
    } catch (e) {
      onToast('Export failed');
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    (async () => {
      try {
        const mode = confirm(
          'Press OK to MERGE (keeps existing data), or Cancel to REPLACE all data.',
        )
          ? 'merge'
          : 'replace';
        if (mode === 'replace') {
          const confirmText = prompt('Type DELETE to confirm replacing all data');
          if (confirmText !== 'DELETE') {
            onToast('Replace cancelled');
            return;
          }
        }
        const result = await importFile(file, mode);
        if (result.kind === 'json') {
          onToast(`Imported config (${result.vehiclesImported} vehicles, ${mode})`);
        } else {
          const stubMsg = result.createdStubVehicles.length
            ? ` (+ ${result.createdStubVehicles.length} new vehicles)`
            : '';
          onToast(`Imported ${result.fuelupsImported} entries${stubMsg} (${mode})`);
        }
      } catch (err) {
        console.error(err);
        const msg = err instanceof Error ? err.message : 'Import failed';
        onToast(msg);
      } finally {
        if (fileRef.current) fileRef.current.value = '';
      }
    })();
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Settings</h1>

      <div className="section-title">Display</div>
      <div className="card">
        <div className="field">
          <label className="field-label">Appearance</label>
          <div className="segment" style={{ alignSelf: 'flex-start' }}>
            {(['auto', 'light', 'dark'] as ThemeMode[]).map((m) => (
              <button
                key={m}
                className={settings.themeMode === m ? 'active' : ''}
                onClick={() => update({ themeMode: m })}
              >
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <div className="input-help">Auto follows the system light/dark setting.</div>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label className="field-label">Consumption unit</label>
          <div className="segment" style={{ alignSelf: 'flex-start' }}>
            {(['km/l', 'l/100km'] as ConsumptionUnit[]).map((u) => (
              <button
                key={u}
                className={settings.consumptionUnit === u ? 'active' : ''}
                onClick={() => update({ consumptionUnit: u })}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label className="field-label">Currency</label>
          <select
            value={settings.currency}
            onChange={(e) => update({ currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c} ({currencySymbol(c)})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="section-title">Electricity</div>
      <div className="card">
        <div className="field">
          <label className="field-label">
            Default electricity cost ({currencySymbol(settings.currency)}/kWh)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={settings.defaultElectricityCost}
            onChange={(e) => {
              const n = parseDecimalInput(e.target.value);
              update({ defaultElectricityCost: Number.isFinite(n) ? n : 0 });
            }}
          />
          <div className="input-help">
            Pre-fills new entries. Per-vehicle overrides take precedence.
          </div>
        </div>
      </div>

      <div className="section-title">Backups</div>
      <div className="card stack">
        <div>
          <div className="field-label">Last backed up</div>
          <div className="mono" style={{ marginTop: 4 }}>
            {settings.lastBackupAt ? fmtDate(settings.lastBackupAt) : 'Never'}
          </div>
        </div>

        <button className="btn btn-primary btn-block" onClick={doExportBoth} disabled={busy}>
          {busy ? 'Preparing…' : 'Back up now'}
        </button>

        <div className="field">
          <label className="field-label">Backup cadence</label>
          <select
            value={settings.backupCadence}
            onChange={(e) =>
              update({ backupCadence: e.target.value as BackupCadence })
            }
          >
            {(Object.keys(CADENCE_LABEL) as BackupCadence[]).map((c) => (
              <option key={c} value={c}>
                {CADENCE_LABEL[c]}
              </option>
            ))}
          </select>
          <div className="input-help">
            "Back up now" exports two files: the entries CSV (your fuel-ups, openable in Excel)
            and a config JSON (vehicles + app settings). On iOS the share sheet shows both —
            pick <strong>Save to Files → iCloud Drive</strong>.
          </div>
        </div>
      </div>

      <div className="section-title">Data</div>
      <div className="card stack">
        <button className="btn btn-block" onClick={doExportEntries} disabled={busy}>
          Export entries (CSV)
        </button>
        <button className="btn btn-block" onClick={doExportConfig} disabled={busy}>
          Export config (JSON)
        </button>
        <button
          className="btn btn-block"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          Import file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          style={{ display: 'none' }}
          onChange={onImportFile}
        />
        <div className="input-help">
          Drop in a <code>.csv</code> (entries) or <code>.json</code> (vehicles + settings).
          You'll be asked to merge or replace. Vehicle names in the CSV that don't match an
          existing vehicle will auto-create stub entries.
        </div>
      </div>

      <div className="section-title">About</div>
      <div className="card mono" style={{ fontSize: 13, color: 'var(--muted)' }}>
        FuelTracker · schema v{settings.schemaVersion} · offline-first PWA
      </div>
    </div>
  );
}
