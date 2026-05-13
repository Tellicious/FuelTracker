import { db, ensureSettings, uid } from '../../db/db';
import { SCHEMA_VERSION, type FuelUp, type Settings, type Vehicle } from '../../db/types';
import { csvToFuelups, fuelupsToCsv } from './csv';
import { configToJson, jsonToConfig } from './json';

export type { ConfigJson } from './json';
export type { CsvParseResult } from './csv';
export { fuelupsToCsv, csvToFuelups, configToJson, jsonToConfig };

// ---------------------------------------------------------------------------
// Payload (live snapshot of the DB)
// ---------------------------------------------------------------------------

export interface BackupPayload {
  schemaVersion: number;
  exportedAt: string;
  vehicles: Vehicle[];
  fuelups: FuelUp[];
  settings: Settings;
}

export async function buildPayload(): Promise<BackupPayload> {
  const [vehicles, fuelups, settings] = await Promise.all([
    db.vehicles.toArray(),
    db.fuelups.toArray(),
    ensureSettings(),
  ]);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    vehicles,
    fuelups,
    settings,
  };
}

// ---------------------------------------------------------------------------
// Backup-overdue hash (used by the banner)
// ---------------------------------------------------------------------------

/**
 * Stable hash of the meaningful data — ignores serialization order and the
 * per-device backup-tracking fields. 16-character hex prefix of a SHA-256.
 */
export async function payloadHash(p: BackupPayload): Promise<string> {
  const stable = JSON.stringify({
    schemaVersion: p.schemaVersion,
    vehicles: [...p.vehicles].sort((a, b) => (a.id < b.id ? -1 : 1)),
    fuelups: [...p.fuelups].sort((a, b) => (a.id < b.id ? -1 : 1)),
    settings: { ...p.settings, lastBackupAt: null, lastBackupHash: null },
  });
  const buf = new TextEncoder().encode(stable);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export function isBackupOverdue(settings: Settings, currentHash: string): boolean {
  if (settings.backupCadence === 'off') return false;
  if (!settings.lastBackupAt) return true;
  if (settings.lastBackupHash === currentHash) return false;
  const days = daysSince(settings.lastBackupAt) ?? 0;
  const threshold =
    settings.backupCadence === 'weekly' ? 7 : settings.backupCadence === 'biweekly' ? 14 : 30;
  return days >= threshold;
}

// ---------------------------------------------------------------------------
// Export — Web Share API with download fallback
// ---------------------------------------------------------------------------

function dateStamp(d: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareOrDownload(files: File[]): Promise<boolean> {
  try {
    const navAny = navigator as unknown as {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (navAny.canShare && navAny.share && navAny.canShare({ files })) {
      await navAny.share({
        files,
        title: 'FuelTracker backup',
        text: 'Save these files to iCloud Drive to back up your fuel log.',
      });
      return true;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
  }
  for (const f of files) downloadFile(f);
  return true;
}

/** Combined export: entries CSV + config JSON, both at once. */
export async function exportBackup(payload: BackupPayload): Promise<boolean> {
  const stamp = dateStamp();
  const csvFile = new File(
    [fuelupsToCsv(payload.fuelups, payload.vehicles)],
    `fueltracker-entries-${stamp}.csv`,
    { type: 'text/csv' },
  );
  const jsonFile = new File(
    [configToJson(payload.vehicles, payload.settings)],
    `fueltracker-config-${stamp}.json`,
    { type: 'application/json' },
  );
  return shareOrDownload([csvFile, jsonFile]);
}

export async function exportEntriesCsvOnly(payload: BackupPayload): Promise<boolean> {
  const file = new File(
    [fuelupsToCsv(payload.fuelups, payload.vehicles)],
    `fueltracker-entries-${dateStamp()}.csv`,
    { type: 'text/csv' },
  );
  return shareOrDownload([file]);
}

export async function exportConfigJsonOnly(payload: BackupPayload): Promise<boolean> {
  const file = new File(
    [configToJson(payload.vehicles, payload.settings)],
    `fueltracker-config-${dateStamp()}.json`,
    { type: 'application/json' },
  );
  return shareOrDownload([file]);
}

// ---------------------------------------------------------------------------
// Import — auto-detect CSV vs JSON
// ---------------------------------------------------------------------------

export interface ImportResult {
  kind: 'csv' | 'json';
  fuelupsImported: number;
  vehiclesImported: number;
  settingsImported: boolean;
  createdStubVehicles: string[];
}

export async function importFile(
  file: File,
  mode: 'merge' | 'replace',
): Promise<ImportResult> {
  const text = await file.text();
  const ext = file.name.toLowerCase().split('.').pop();
  const looksJson = ext === 'json' || (text.trim().startsWith('{') && text.includes('"schemaVersion"'));

  if (looksJson) {
    return importConfigJson(text, mode);
  }
  return importEntriesCsv(text, mode);
}

async function importConfigJson(
  text: string,
  mode: 'merge' | 'replace',
): Promise<ImportResult> {
  const cfg = jsonToConfig(text);
  if (cfg.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Schema mismatch (file v${cfg.schemaVersion}, app v${SCHEMA_VERSION}).`,
    );
  }
  await db.transaction('rw', db.vehicles, db.settings, async () => {
    if (mode === 'replace') {
      await db.vehicles.clear();
    }
    if (cfg.vehicles.length) await db.vehicles.bulkPut(cfg.vehicles);
    if (cfg.settings) {
      const existing = await ensureSettings();
      // Preserve per-device backup tracking
      await db.settings.put({
        ...cfg.settings,
        id: 'global',
        lastBackupAt: existing.lastBackupAt,
        lastBackupHash: existing.lastBackupHash,
      });
    }
  });
  return {
    kind: 'json',
    fuelupsImported: 0,
    vehiclesImported: cfg.vehicles.length,
    settingsImported: true,
    createdStubVehicles: [],
  };
}

async function importEntriesCsv(
  text: string,
  mode: 'merge' | 'replace',
): Promise<ImportResult> {
  const existingVehicles = await db.vehicles.toArray();
  const { fuelups, unknownVehicleNames } = csvToFuelups(text, existingVehicles);

  // Auto-create stub vehicles for any unrecognized names. The CSV parser
  // leaves rows with vehicleId equal to whatever the CSV had — we re-resolve
  // them below to point at the freshly-created stubs.
  const stubsByName = new Map<string, Vehicle>();
  for (const name of unknownVehicleNames) {
    stubsByName.set(name.toLowerCase(), {
      id: uid(),
      name,
      type: 'ice',
      defaultElectricityCost: null,
      createdAt: new Date().toISOString(),
    });
  }

  if (stubsByName.size) {
    const existingIds = new Set(existingVehicles.map((v) => v.id));
    const headerCells = parseHeaderCells(text);
    const idxVehicleName = headerCells.indexOf('vehicle');
    const idxVehicleId = headerCells.indexOf('vehicleId');
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    for (let i = 1; i < lines.length && i - 1 < fuelups.length; i++) {
      const cells = splitCsvLine(lines[i]);
      const givenId = (cells[idxVehicleId] ?? '').trim();
      const name = (cells[idxVehicleName] ?? '').trim();
      if ((!givenId || !existingIds.has(givenId)) && name) {
        const stub = stubsByName.get(name.toLowerCase());
        if (stub) fuelups[i - 1].vehicleId = stub.id;
      }
    }
  }

  await db.transaction('rw', db.vehicles, db.fuelups, async () => {
    if (mode === 'replace') {
      await db.fuelups.clear();
    }
    if (stubsByName.size) await db.vehicles.bulkPut([...stubsByName.values()]);
    if (fuelups.length) await db.fuelups.bulkPut(fuelups);
  });

  return {
    kind: 'csv',
    fuelupsImported: fuelups.length,
    vehiclesImported: stubsByName.size,
    settingsImported: false,
    createdStubVehicles: [...stubsByName.keys()].map(
      (k) => stubsByName.get(k)!.name,
    ),
  };
}

// Tiny re-implementations to keep the stub-resolution logic self-contained.
function parseHeaderCells(text: string): string[] {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  return splitCsvLine(firstLine).map((c) => c.trim());
}
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else if (c === '"' && cur === '') {
      inQuotes = true;
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}
