import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS, type FuelUp, type Settings, type Vehicle } from './types';

// Dexie wrapper around the IndexedDB store. Three tables: `vehicles` (one
// row per car), `fuelups` (one row per fill-up / charge event), `settings`
// (one global row keyed 'global'). The schema is split per vehicle type:
// gas columns (gasLiters/gasPricePerLiter) for ICE/HEV/PHEV fills,
// electricity columns (kWhCharged/kWhPrice) for EV charges, and PHEV-only
// columns (phevKwhPer100Km/phevKwhPrice) for electricity-since-last-full.
//
// Note on the recently-added Settings fields (recordFieldsByType and the
// five warning thresholds): no schema bump or migration is needed. The
// getSettings helper below merges DEFAULT_SETTINGS over the stored row
// at read time, so any field that wasn't in v2 storage is hydrated on
// the fly. Adding optional Settings fields isn't a breaking change.
export class FuelTrackerDB extends Dexie {
  vehicles!: Table<Vehicle, string>;
  fuelups!: Table<FuelUp, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('fueltracker');

    this.version(2).stores({
      vehicles: 'id, name, type, createdAt',
      fuelups: 'id, vehicleId, date, [vehicleId+odometer], [vehicleId+date]',
      settings: 'id',
    });
  }
}

export const db = new FuelTrackerDB();

// Insert the global settings row if it's missing, returning it either way.
// Called once at app boot to make sure the rest of the app can read
// settings without nullability concerns.
export async function initializeSettings(): Promise<Settings> {
  const existing = await db.settings.get('global');
  if (existing) return existing;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

// Read the global settings row, merging with DEFAULT_SETTINGS so any
// recently-added fields are populated even on an old DB that predates them.
// This is the mechanism that makes the new recordFieldsByType + warning
// threshold fields available on a v2 database without needing a migration.
export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('global');
  if (!existing) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...existing };
}

export const ensureSettings = initializeSettings;

// Generate a globally-unique ID using the browser's crypto API. Used for
// all primary keys (vehicles, fuelups). Modern Safari/Chrome guarantee
// uniqueness via UUID v4.
export function uid(): string {
  return crypto.randomUUID();
}
