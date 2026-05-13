import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS, type FuelUp, type Settings, type Vehicle } from './types';

/**
 * Schema history:
 *
 *   v1: original
 *     - fuelups.liters / .pricePerLiter were dual-purpose (gas L for ICE/HEV/PHEV,
 *       kWh for EV), .missed flag synthesized "estimated" intervals,
 *       .avgElectricityConsumption / .avgElectricityCost for PHEV.
 *
 *   v2: cleaner field names
 *     - split liters/pricePerLiter into separate gas* and kWh* pairs by
 *       vehicle type, drop missed, rename avgElectricity* to phevKwh*.
 */
interface LegacyFuelUp {
  id: string;
  vehicleId: string;
  date: string;
  odometer: number;
  liters?: number | null;
  pricePerLiter?: number | null;
  totalCost: number | null;
  partial: boolean;
  missed?: boolean;
  avgElectricityConsumption?: number | null;
  avgElectricityCost?: number | null;
  notes: string | null;
}

export class FuelTrackerDB extends Dexie {
  vehicles!: Table<Vehicle, string>;
  fuelups!: Table<FuelUp, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('fueltracker');

    this.version(1).stores({
      vehicles: 'id, name, type, createdAt',
      fuelups: 'id, vehicleId, date, [vehicleId+odometer], [vehicleId+date]',
      settings: 'id',
    });

    // v2: rename fields. Indexes unchanged.
    this.version(2)
      .stores({
        vehicles: 'id, name, type, createdAt',
        fuelups: 'id, vehicleId, date, [vehicleId+odometer], [vehicleId+date]',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        // Build a vehicleId → type lookup so we know how to interpret the
        // old dual-purpose liters/pricePerLiter fields.
        const allVehicles = await tx.table('vehicles').toArray() as Vehicle[];
        const typeByVehicleId = new Map(allVehicles.map((v) => [v.id, v.type]));

        await tx
          .table('fuelups')
          .toCollection()
          .modify((raw: LegacyFuelUp & Partial<FuelUp>) => {
            const isEv = typeByVehicleId.get(raw.vehicleId) === 'ev';

            if (isEv) {
              raw.kWhCharged = raw.liters ?? null;
              raw.kWhPrice = raw.pricePerLiter ?? null;
              raw.gasLiters = null;
              raw.gasPricePerLiter = null;
            } else {
              raw.gasLiters = raw.liters ?? null;
              raw.gasPricePerLiter = raw.pricePerLiter ?? null;
              raw.kWhCharged = null;
              raw.kWhPrice = null;
            }
            raw.phevKwhPer100Km = raw.avgElectricityConsumption ?? null;
            raw.phevKwhPrice = raw.avgElectricityCost ?? null;

            // `missed` is preserved (it marks intervals with unlogged fills
            // and excludes them from stats — see lib/stats.ts).
            raw.missed = raw.missed ?? false;

            // Strip legacy column names
            delete raw.liters;
            delete raw.pricePerLiter;
            delete raw.avgElectricityConsumption;
            delete raw.avgElectricityCost;
          });
      });
  }
}

export const db = new FuelTrackerDB();

// Ensure singleton settings row exists. Performs a WRITE if missing —
// callers must invoke this OUTSIDE a useLiveQuery callback (Dexie runs
// live-query callbacks in a read-only transaction context).
export async function initializeSettings(): Promise<Settings> {
  const existing = await db.settings.get('global');
  if (existing) return existing;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

// Read-only settings fetch — safe inside useLiveQuery callbacks.
// Falls back to DEFAULT_SETTINGS if the row hasn't been initialized yet, and
// merges in defaults for any new fields that older records may be missing.
export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('global');
  if (!existing) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...existing };
}

// Back-compat alias: kept for code paths that already run outside liveQuery
// (e.g. buildPayload). Equivalent to initializeSettings.
export const ensureSettings = initializeSettings;

export function uid(): string {
  // crypto.randomUUID is available in iOS Safari 15.4+ and all modern browsers.
  return crypto.randomUUID();
}
