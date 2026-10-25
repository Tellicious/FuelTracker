import { db, getSettings } from '../../db/db';
import { SCHEMA_VERSION, type FuelUp, type Settings, type Vehicle } from '../../db/types';
import { csvToFuelups, fuelupsToCsv } from './csv';
import { configToJson, jsonToConfig } from './json';

export type { ConfigJson } from './json';
export type { CsvParseResult } from './csv';
export { fuelupsToCsv, csvToFuelups, configToJson, jsonToConfig };

export interface BackupPayload {
  schemaVersion: number;
  exportedAt: string;
  vehicles: Vehicle[];
  fuelups: FuelUp[];
  settings: Settings;
}

// Snapshot the entire user state (vehicles + entries + settings) into a
// single BackupPayload, ready to serialize. Runs the three DB reads in
// parallel since they're independent.
export async function buildPayload(): Promise<BackupPayload> {
  const [vehicles, fuelups, settings] = await Promise.all([
    db.vehicles.toArray(),
    db.fuelups.toArray(),
    getSettings(),
  ]);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    vehicles,
    fuelups,
    settings,
  };
}

// Compute a short stable hash of a payload's *contents* (sorted by id,
// with backup-metadata fields nulled out). Used by `isBackupOverdue` to
// suppress the backup nag when the data hasn't actually changed since the
// last backup. Returns the first 8 hex chars of SHA-256 — plenty of
// collision resistance for this use case.
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

// Convert the days-since-last-backup count to a number, or null if there's
// never been a backup. Floors to whole days so "less than 24h ago" reads as 0.
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

// Decide whether the user should be prompted to back up. Compares the
// configured cadence (off / weekly / biweekly / monthly) against the time
// since the last backup. Returns false when the current data hash matches
// the last-backed-up hash — no point pestering the user about backing up
// data that hasn't changed.
export function isBackupOverdue(settings: Settings, currentHash: string): boolean {
  if (settings.backupCadence === 'off') return false;
  if (!settings.lastBackupAt) return true;
  if (settings.lastBackupHash === currentHash) return false;
  const days = daysSince(settings.lastBackupAt) ?? 0;
  const threshold =
    settings.backupCadence === 'weekly' ? 7 : settings.backupCadence === 'biweekly' ? 14 : 30;
  return days >= threshold;
}

// "YYYY-MM-DD" stamp for embedding in filenames. Uses local date components
// rather than ISO/UTC so the date in the filename matches the user's wall
// clock the way they'd expect when looking at it in Files later.
function dateStamp(d: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Fallback path for environments without Web Share API (or where share
// rejected): trigger a regular browser download by clicking a synthesized
// anchor tag pointing at an object URL. Revokes the URL after a delay so
// the download has time to actually start.
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

// Prefer the Web Share API with files (so iOS users get the native share
// sheet → Files / iCloud Drive flow), fall back to direct download on
// platforms without it. Passes ONLY `files` (no `title`/`text`) because
// iOS materialises those as a junk .txt attachment when saving to Files.
// Returns false if the user explicitly cancelled the share, true otherwise.
async function shareOrDownload(files: File[]): Promise<boolean> {
  try {
    const navAny = navigator as unknown as {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (navAny.canShare && navAny.share && navAny.canShare({ files })) {
      await navAny.share({ files });
      return true;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
  }
  for (const f of files) downloadFile(f);
  return true;
}

// Export both files — the entries CSV (history table) AND the config JSON
// (vehicles + settings) — as a single share-sheet action. The user can
// drag one or both to iCloud Drive in one swipe.
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

// Export only the entries CSV (handy when the user just wants to spot-check
// numbers in Numbers / Excel without producing a full backup).
export async function exportEntriesCsvOnly(payload: BackupPayload): Promise<boolean> {
  const file = new File(
    [fuelupsToCsv(payload.fuelups, payload.vehicles)],
    `fueltracker-entries-${dateStamp()}.csv`,
    { type: 'text/csv' },
  );
  return shareOrDownload([file]);
}

// Export only the config JSON (vehicles + global settings). Useful for
// transferring app config to a new phone without dragging along the
// history table.
export async function exportConfigJsonOnly(payload: BackupPayload): Promise<boolean> {
  const file = new File(
    [configToJson(payload.vehicles, payload.settings)],
    `fueltracker-config-${dateStamp()}.json`,
    { type: 'application/json' },
  );
  return shareOrDownload([file]);
}

export interface ImportResult {
  kind: 'csv' | 'json';
  fuelupsImported: number;
  vehiclesImported: number;
  settingsImported: boolean;
  createdStubVehicles: string[];
  // Entries deleted because a replace removed their vehicle.
  fuelupsRemoved: number;
}

// Entry point for restoring from a user-selected file. Sniffs the format
// (.json with a schemaVersion → config; otherwise CSV entries) and routes
// to the matching importer. `mode` controls whether existing data is kept
// ('merge') or replaced ('replace'). Replace swaps out exactly what the
// file carries and never leaves orphans behind:
//   CSV  → all entries are replaced; vehicles and settings are kept.
//   JSON → all vehicles and settings are replaced; entries whose vehicle
//          is not in the file are deleted (they'd otherwise be orphans
//          that no screen shows but backups and the data hash still carry).
// See describeReplace() for the user-facing wording.
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

// User-facing description of what a replace import deletes, keyed off
// the file name (the same extension check importFile uses first).
export function describeReplace(fileName: string): string {
  return fileName.toLowerCase().endsWith('.json')
    ? 'all vehicles and settings (entries of vehicles not in the file are deleted)'
    : 'all entries (vehicles and settings are kept)';
}

// Restore vehicles + settings from a config JSON export. Refuses to load
// when the file's schemaVersion doesn't match the running app — the user
// would need to update the app first. Preserves the existing backup
// metadata (lastBackupAt/Hash) since those are device-specific.
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
  let fuelupsRemoved = 0;
  await db.transaction('rw', db.vehicles, db.fuelups, db.settings, async () => {
    if (mode === 'replace') {
      await db.vehicles.clear();
      const keep = new Set(cfg.vehicles.map((v) => v.id));
      fuelupsRemoved = await db.fuelups
        .filter((f) => !keep.has(f.vehicleId))
        .delete();
    }
    if (cfg.vehicles.length) await db.vehicles.bulkPut(cfg.vehicles);
    if (cfg.settings) {
      const existing = await getSettings();

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
    fuelupsRemoved,
  };
}

// Restore fuel-up rows from an entries CSV export. Rows whose vehicle
// can't be matched (by id, then by name) get a placeholder vehicle from
// csvToFuelups that keeps the CSV's vehicleId, so restoring the config
// JSON afterwards overwrites it instead of creating a duplicate. Returns
// counts plus the names of any placeholders so the UI can call them out.
async function importEntriesCsv(
  text: string,
  mode: 'merge' | 'replace',
): Promise<ImportResult> {
  const existingVehicles = await db.vehicles.toArray();
  const { fuelups, newVehicles } = csvToFuelups(text, existingVehicles);

  await db.transaction('rw', db.vehicles, db.fuelups, async () => {
    if (mode === 'replace') {
      await db.fuelups.clear();
    }
    if (newVehicles.length) await db.vehicles.bulkPut(newVehicles);
    if (fuelups.length) await db.fuelups.bulkPut(fuelups);
  });

  return {
    kind: 'csv',
    fuelupsImported: fuelups.length,
    vehiclesImported: newVehicles.length,
    settingsImported: false,
    createdStubVehicles: newVehicles.map((v) => v.name),
    fuelupsRemoved: 0,
  };
}
