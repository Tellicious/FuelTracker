import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS, type FuelUp, type Settings, type Vehicle } from './types';

// Shape of the v1 fuel-up row. Pre-migration the schema lumped both gas
// liters and EV kWh into a single `liters`/`pricePerLiter` pair — the v2
// migration splits them apart based on the vehicle's type.
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

// Dexie wrapper around the IndexedDB store. Three tables: `vehicles` (one
// row per car), `fuelups` (one row per fill-up / charge event), `settings`
// (one global row keyed 'global'). The v1→v2 upgrade splits the legacy
// liters/pricePerLiter pair into vehicle-type-specific columns: for EVs
// they become kWhCharged/kWhPrice, for everything else gasLiters/
// gasPricePerLiter. Existing PHEV electricity-since-last-full columns
// (`phevKwhPer100Km`, `phevKwhPrice`) are populated from their legacy
// names, and the `missed` flag is defaulted to false where absent.
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


    this.version(2)
      .stores({
        vehicles: 'id, name, type, createdAt',
        fuelups: 'id, vehicleId, date, [vehicleId+odometer], [vehicleId+date]',
        settings: 'id',
      })
      .upgrade(async (tx) => {
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

            raw.missed = raw.missed ?? false;

            delete raw.liters;
            delete raw.pricePerLiter;
            delete raw.avgElectricityConsumption;
            delete raw.avgElectricityCost;
          });
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
