import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { db, getSettings } from '../db/db';
import type {
  BackupCadence,
  ConsumptionUnit,
  RecordField,
  RecordFieldsByType,
  Settings,
  ThemeMode,
  VehicleType,
} from '../db/types';
import { DEFAULT_RECORD_FIELDS, SUPPORTED_CURRENCIES } from '../db/types';
import {
  buildPayload,
  exportBackup,
  exportConfigJsonOnly,
  exportEntriesCsvOnly,
  importFile,
  payloadHash,
} from '../lib/backup';
import { currencySymbol, fmtDate } from '../lib/format';
import { DecimalInput } from '../components/DecimalInput';
import { ALLOWED_FIELDS_BY_TYPE, RECORD_FIELDS, sanitizeRecordFields } from '../lib/records-fields';

const CURRENCIES = SUPPORTED_CURRENCIES;

const CADENCE_LABEL: Record<BackupCadence, string> = {
  off: 'Off',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
};

const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  ice: 'ICE / Hybrid',
  hybrid: 'ICE / Hybrid', // unused — ICE and HEV share one pane (see VEHICLE_TYPE_TABS)
  phev: 'PHEV',
  ev: 'EV',
};

// User decided ICE and HEV share the same field config (they're typed
// separately in the DB so the picker writes the same tuple to both
// keys). The picker tab list collapses them into a single "ICE / Hybrid"
// entry.
const VEHICLE_TYPE_TABS: { tab: 'iceHybrid' | 'phev' | 'ev'; label: string; types: VehicleType[] }[] = [
  { tab: 'iceHybrid', label: 'ICE / Hybrid', types: ['ice', 'hybrid'] },
  { tab: 'phev', label: 'PHEV', types: ['phev'] },
  { tab: 'ev', label: 'EV', types: ['ev'] },
];

interface Props {
  onToast: (msg: string) => void;
}

// Settings screen — global preferences (theme, currency, consumption unit,
// default electricity cost) plus backup actions (export CSV / export JSON /
// import a previously-exported file). Also: per-vehicle-type Records-row
// field selection (which three fields appear under each entry), and
// consistency-warning thresholds for the AddEntry checks. All settings
// live in a single 'global' row in the Dexie settings table.
export function SettingsScreen({ onToast }: Props) {
  const settings = useLiveQuery(() => getSettings(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fieldsTab, setFieldsTab] = useState<'iceHybrid' | 'phev' | 'ev'>('iceHybrid');

  if (!settings) return <div className="screen">Loading…</div>;

  const update = (patch: Partial<Settings>) => db.settings.update('global', patch);


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

  // Write the three-field tuple back to settings.recordFieldsByType for
  // every vehicle type the active tab represents (ICE and HEV share, so
  // a change there writes to both keys). Sanitises through the allowed
  // set for that type as a safety net.
  const updateRecordFields = (tab: 'iceHybrid' | 'phev' | 'ev', fields: [RecordField, RecordField, RecordField]) => {
    const current: RecordFieldsByType = settings.recordFieldsByType ?? DEFAULT_RECORD_FIELDS;
    const next: RecordFieldsByType = { ...current };
    const types = VEHICLE_TYPE_TABS.find((t) => t.tab === tab)?.types ?? [];
    for (const t of types) {
      next[t] = sanitizeRecordFields(fields, t, DEFAULT_RECORD_FIELDS[t]);
    }
    update({ recordFieldsByType: next });
  };

  // Helper that pulls the three-field tuple to display in the picker for
  // the active tab. ICE/HEV share so we read either (they're kept in sync).
  const currentFieldsForTab = (tab: 'iceHybrid' | 'phev' | 'ev'): [RecordField, RecordField, RecordField] => {
    const cfg = settings.recordFieldsByType ?? DEFAULT_RECORD_FIELDS;
    const primaryType = VEHICLE_TYPE_TABS.find((t) => t.tab === tab)?.types[0] ?? 'ice';
    return sanitizeRecordFields(cfg[primaryType], primaryType, DEFAULT_RECORD_FIELDS[primaryType]);
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

      {/*
        Records display picker — three slots, one segmented control per
        slot showing only the fields allowed for the active vehicle-type
        tab. The selected fields appear under every record row on the
        Records screen for vehicles of that type. ICE and HEV share a
        single config (the user requested they stay identical).
      */}
      <div className="section-title">Records display</div>
      <div className="card">
        <div className="field">
          <label className="field-label">Vehicle type</label>
          <div className="segment" style={{ alignSelf: 'flex-start' }}>
            {VEHICLE_TYPE_TABS.map((t) => (
              <button
                key={t.tab}
                className={fieldsTab === t.tab ? 'active' : ''}
                onClick={() => setFieldsTab(t.tab)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="input-help">
            Choose the three fields that appear under each record on the Records screen.
          </div>
        </div>
        {([0, 1, 2] as const).map((slot) => {
          const fields = currentFieldsForTab(fieldsTab);
          const primaryType = VEHICLE_TYPE_TABS.find((t) => t.tab === fieldsTab)!.types[0];
          const allowed = ALLOWED_FIELDS_BY_TYPE[primaryType];
          return (
            <div key={slot} className="field" style={{ marginTop: 12 }}>
              <label className="field-label">Field {slot + 1}</label>
              <select
                value={fields[slot]}
                onChange={(e) => {
                  const next: [RecordField, RecordField, RecordField] = [...fields] as [
                    RecordField,
                    RecordField,
                    RecordField,
                  ];
                  next[slot] = e.target.value as RecordField;
                  updateRecordFields(fieldsTab, next);
                }}
              >
                {allowed.map((f) => (
                  <option key={f} value={f}>
                    {RECORD_FIELDS[f].label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="section-title">Electricity</div>
      <div className="card">
        <div className="field">
          <label className="field-label">
            Default electricity cost ({currencySymbol(settings.currency)}/kWh)
          </label>
          <DecimalInput
            value={settings.defaultElectricityCost}
            allowEmpty={false}
            onChange={(n) => update({ defaultElectricityCost: n ?? 0 })}
          />
          <div className="input-help">
            Pre-fills new entries. Per-vehicle overrides take precedence.
          </div>
        </div>
      </div>

      <div className="section-title">Chart</div>
      <div className="card">
        <div className="field">
          <label className="field-label">Smoothing window</label>
          <div className="segment" style={{ alignSelf: 'flex-start' }}>
            {[3, 5, 7, 9, 11].map((n) => (
              <button
                key={n}
                className={settings.smoothingWindow === n ? 'active' : ''}
                onClick={() => update({ smoothingWindow: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="input-help">
            How many neighboring entries to average when the chart's
            "Smooth" toggle is on. Larger = smoother but less responsive.
          </div>
        </div>
      </div>

      {/*
        Consistency warnings — five soft checks the AddEntry form runs
        against new entries. Thresholds are user-tunable here; the
        warnings themselves never block save, they just surface a
        confirm() dialog. See lib/checks.ts for the per-check logic.
      */}
      <div className="section-title">Consistency warnings</div>
      <div className="card">
        <div className="field">
          <label className="field-label">Consumption tolerance (±%)</label>
          <DecimalInput
            value={settings.warnConsumptionPercent}
            allowEmpty={false}
            onChange={(n) => update({ warnConsumptionPercent: Math.max(0, n ?? 0) })}
          />
          <div className="input-help">
            Warn when the new interval's avg consumption differs from the running average by more than this percentage.
          </div>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label className="field-label">Unit-price tolerance (±%)</label>
          <DecimalInput
            value={settings.warnPricePercent}
            allowEmpty={false}
            onChange={(n) => update({ warnPricePercent: Math.max(0, n ?? 0) })}
          />
          <div className="input-help">
            Warn when €/l or €/kWh differs from the median of the last 5 entries by more than this percentage.
          </div>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label className="field-label">Distance multiplier (× avg interval)</label>
          <DecimalInput
            value={settings.warnDistanceMultiplier}
            allowEmpty={false}
            onChange={(n) => update({ warnDistanceMultiplier: Math.max(1, n ?? 1) })}
          />
          <div className="input-help">
            Warn when the gap since the previous entry exceeds this multiple of the average interval distance.
          </div>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label className="field-label">Duplicate window (minutes)</label>
          <DecimalInput
            value={settings.warnDuplicateMinutes}
            allowEmpty={false}
            onChange={(n) => update({ warnDuplicateMinutes: Math.max(0, n ?? 0) })}
          />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label className="field-label">Duplicate window (km)</label>
          <DecimalInput
            value={settings.warnDuplicateKm}
            allowEmpty={false}
            onChange={(n) => update({ warnDuplicateKm: Math.max(0, n ?? 0) })}
          />
          <div className="input-help">
            Warn when another entry exists within both this many minutes AND this many km of the new one.
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
        FuelTracker PWA v{settings.schemaVersion} · Tellicious 2026 </div>
    </div>
  );
}
