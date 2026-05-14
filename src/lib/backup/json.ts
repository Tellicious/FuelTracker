import { SCHEMA_VERSION, type Settings, type Vehicle } from '../../db/types';

export interface ConfigJson {
  schemaVersion: number;
  exportedAt: string;
  vehicles: Vehicle[];
  settings: Settings;
}

// Serialize vehicles + settings to a pretty-printed JSON string for the
// config backup file. Strips per-device backup metadata (lastBackupAt,
// lastBackupHash) on its way out so the file is portable between phones.
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

// Parse + validate a config JSON file. Throws on syntactic JSON errors and
// on structural problems (missing schemaVersion / vehicles / settings).
// Schema-version compatibility is enforced at a higher level in
// importConfigJson.
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
