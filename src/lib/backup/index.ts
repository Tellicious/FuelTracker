import { db, getSettings } from '../../db/db';
import { SCHEMA_VERSION, type FuelUp, type Settings, type Vehicle } from '../../db/types';
import { csvToFuelups, fuelupsToCsv } from './csv';
import { configToJson, jsonToConfig, type ConfigJson } from './json';

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
  configFiles: number;
  csvFiles: number;
  // Vehicles from config JSON files (CSV placeholders are listed separately).
  vehiclesImported: number;
  settingsImported: boolean;
  fuelupsImported: number;
  // Names of placeholder vehicles created for CSV rows with no known vehicle.
  createdStubVehicles: string[];
  // Entries deleted because a replace removed their vehicle.
  fuelupsRemoved: number;
}

export interface ImportSource {
  name: string;
  text: string;
}

// Everything an import will write, worked out before anything is written.
export interface ImportPlan {
  clearVehicles: boolean;
  clearFuelups: boolean;
  // When set, existing entries whose vehicle isn't in this set are
  // deleted (a JSON replace with no CSV in the same import).
  keepFuelupsOfVehicles: Set<string> | null;
  vehicles: Vehicle[];
  settings: Settings | null;
  fuelups: FuelUp[];
  summary: Omit<ImportResult, 'fuelupsRemoved'>;
}

// A file is a config JSON if it has a .json extension, or if its content
// looks like one (a JSON object carrying a schemaVersion); anything else
// is treated as an entries CSV.
function isConfigJson(source: ImportSource): boolean {
  const ext = source.name.toLowerCase().split('.').pop();
  const text = source.text.trim();
  return ext === 'json' || (text.startsWith('{') && text.includes('"schemaVersion"'));
}

// Work out what importing these files will do, without touching the DB.
// Throws (naming the file) on the first invalid file, so a bad file means
// nothing is written. Config JSON files are applied before entries CSVs
// whatever order they were picked in, and CSV rows are resolved against
// the vehicles that will exist after the JSON step, so picking both
// backup files together restores everything in one go with no
// placeholders.
//
// `mode` controls whether existing data is kept ('merge') or replaced
// ('replace'). Replace swaps out exactly what the files carry and never
// leaves orphans behind:
//   CSV only    → all entries are replaced; vehicles and settings are kept.
//   JSON only   → all vehicles and settings are replaced; entries whose
//                 vehicle is not in the file are deleted (they'd otherwise
//                 be orphans that no screen shows but backups still carry).
//   JSON + CSV  → vehicles, settings and entries are all replaced.
// See describeReplace() for the user-facing wording.
export function planImport(
  sources: ImportSource[],
  dbVehicles: Vehicle[],
  mode: 'merge' | 'replace',
): ImportPlan {
  const configs: ConfigJson[] = [];
  const csvs: ImportSource[] = [];
  for (const source of sources) {
    if (!isConfigJson(source)) {
      csvs.push(source);
      continue;
    }
    const cfg = withFileName(source.name, () => jsonToConfig(source.text));
    // A config from a different schema version is refused: the user needs
    // to update the app first.
    if (cfg.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(
        `${source.name}: schema mismatch (file v${cfg.schemaVersion}, app v${SCHEMA_VERSION}).`,
      );
    }
    configs.push(cfg);
  }

  const replace = mode === 'replace';
  const replacesVehicles = replace && configs.length > 0;
  const configVehicles = configs.flatMap((c) => c.vehicles);

  // Vehicles that will exist once the config step has run. When a JSON
  // replace clears the vehicles table, the current DB vehicles won't
  // survive, so CSV rows must not be matched to them.
  const afterConfig = new Map<string, Vehicle>();
  if (!replacesVehicles) for (const v of dbVehicles) afterConfig.set(v.id, v);
  for (const v of configVehicles) afterConfig.set(v.id, v);

  const fuelups: FuelUp[] = [];
  const placeholders: Vehicle[] = [];
  for (const source of csvs) {
    // Earlier files' placeholders are passed in too, so two CSVs naming
    // the same unknown vehicle share one placeholder.
    const parsed = withFileName(source.name, () =>
      csvToFuelups(source.text, [...afterConfig.values(), ...placeholders]),
    );
    fuelups.push(...parsed.fuelups);
    placeholders.push(...parsed.newVehicles);
  }

  return {
    clearVehicles: replacesVehicles,
    clearFuelups: replace && csvs.length > 0,
    keepFuelupsOfVehicles:
      replacesVehicles && csvs.length === 0
        ? new Set(configVehicles.map((v) => v.id))
        : null,
    vehicles: [...configVehicles, ...placeholders],
    settings: configs.length > 0 ? configs[configs.length - 1].settings : null,
    fuelups,
    summary: {
      configFiles: configs.length,
      csvFiles: csvs.length,
      vehiclesImported: configVehicles.length,
      settingsImported: configs.length > 0,
      fuelupsImported: fuelups.length,
      createdStubVehicles: placeholders.map((v) => v.name),
    },
  };
}

// Prefix a parse error with the file it came from, so "Row 5: invalid
// date" says which of the picked files is wrong.
function withFileName<T>(fileName: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${fileName}: ${msg}`);
  }
}

// Entry point for restoring from one or more user-selected files (e.g. the
// entries CSV and config JSON of one backup, picked together). Every file
// is read and validated first (planImport), then everything is written in
// a single transaction, so either all files are imported or none is.
// Existing backup metadata (lastBackupAt/Hash) is kept: it's per-device.
export async function importFiles(
  files: File[],
  mode: 'merge' | 'replace',
): Promise<ImportResult> {
  const sources = await Promise.all(
    files.map(async (f) => ({ name: f.name, text: await f.text() })),
  );
  const plan = planImport(sources, await db.vehicles.toArray(), mode);

  let fuelupsRemoved = 0;
  await db.transaction('rw', db.vehicles, db.fuelups, db.settings, async () => {
    if (plan.clearVehicles) await db.vehicles.clear();
    if (plan.clearFuelups) {
      await db.fuelups.clear();
    } else if (plan.keepFuelupsOfVehicles) {
      const keep = plan.keepFuelupsOfVehicles;
      fuelupsRemoved = await db.fuelups.filter((f) => !keep.has(f.vehicleId)).delete();
    }
    if (plan.vehicles.length) await db.vehicles.bulkPut(plan.vehicles);
    if (plan.settings) {
      const existing = await getSettings();
      await db.settings.put({
        ...plan.settings,
        id: 'global',
        lastBackupAt: existing.lastBackupAt,
        lastBackupHash: existing.lastBackupHash,
      });
    }
    if (plan.fuelups.length) await db.fuelups.bulkPut(plan.fuelups);
  });

  return { ...plan.summary, fuelupsRemoved };
}

// User-facing description of what a replace import replaces, keyed off
// the picked files' names (the same extension check isConfigJson uses
// first).
export function describeReplace(fileNames: string[]): string {
  const isJson = (n: string) => n.toLowerCase().endsWith('.json');
  const hasJson = fileNames.some(isJson);
  const hasCsv = fileNames.some((n) => !isJson(n));
  if (hasJson && hasCsv) return 'all vehicles, settings and entries';
  return hasJson
    ? 'all vehicles and settings (entries of vehicles not in the file are deleted)'
    : 'all entries (vehicles and settings are kept)';
}
