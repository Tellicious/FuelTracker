import { SCHEMA_VERSION, type Settings, type Vehicle } from '../../db/types';

/**
 * JSON format for vehicles + settings. Everything that isn't fuel-up data
 * goes here — the CSV stays a flat, Excel-friendly table.
 */
export interface ConfigJson {
  schemaVersion: number;
  exportedAt: string;
  vehicles: Vehicle[];
  settings: Settings;
}

/** Serialize the config payload. Backup-tracking fields are scrubbed so
 *  they don't follow data across devices. */
export function configToJson(vehicles: Vehicle[], settings: Settings): string {
  const cleanSettings: Settings = {
    ...settings,
    lastBackupAt: null,
    lastBackupHash: null,
  };
  const cfg: ConfigJson = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    vehicles,
    settings: cleanSettings,
  };
  return JSON.stringify(cfg, null, 2);
}

/** Parse and validate a config JSON file. Throws on missing required fields. */
export function jsonToConfig(text: string): ConfigJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Config file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Config file is not a JSON object.');
  }
  const p = parsed as Partial<ConfigJson>;
  if (typeof p.schemaVersion !== 'number') {
    throw new Error('Config file is missing schemaVersion.');
  }
  if (!Array.isArray(p.vehicles)) {
    throw new Error('Config file is missing vehicles array.');
  }
  if (!p.settings || typeof p.settings !== 'object') {
    throw new Error('Config file is missing settings.');
  }
  return p as ConfigJson;
}
