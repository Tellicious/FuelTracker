export type VehicleType = 'ice' | 'hybrid' | 'phev' | 'ev';
export type ConsumptionUnit = 'km/l' | 'l/100km';
export type BackupCadence = 'off' | 'weekly' | 'biweekly' | 'monthly';
export type ThemeMode = 'auto' | 'light' | 'dark';

// Identifiers for the per-entry "summary fields" rendered under each
// Records-screen row. The user can choose any three to display; the set
// of choices that make sense depends on vehicle type (see
// records-fields.ts → ALLOWED_FIELDS_BY_TYPE).
export type RecordField =
  | 'refuelCost'           // entry.totalCost
  | 'refuelQuantity'       // entry.gasLiters / entry.kWhCharged
  | 'unitPrice'            // entry.gasPricePerLiter / entry.kWhPrice → "€/l" or "€/kWh"
  | 'avgFuelConsumption'   // interval.kmPerL (or l/100km depending on unit pref)
  | 'avgEquivalentFuelConsumption' // interval.equivalentKmPerL
  | 'avgElectricityConsumption'    // interval.kWhPer100Km
  | 'electricityCost';     // interval.electricityCost (PHEV) or entry.totalCost (EV)

// Per-vehicle-type field selection for the Records screen. Each type
// stores its own list of three field keys; the picker on Settings →
// Records display is type-aware.
export interface RecordFieldsByType {
  ice: [RecordField, RecordField, RecordField];
  hybrid: [RecordField, RecordField, RecordField];
  phev: [RecordField, RecordField, RecordField];
  ev: [RecordField, RecordField, RecordField];
}

export interface Vehicle {
  id: string;
  name: string;
  type: VehicleType;
  defaultElectricityCost: number | null;
  createdAt: string;
}

export interface FuelUp {

  id: string;
  vehicleId: string;


  date: string;
  odometer: number;


  totalCost: number | null;
  partial: boolean;

  missed: boolean;
  notes: string | null;


  gasLiters: number | null;
  gasPricePerLiter: number | null;


  kWhCharged: number | null;
  kWhPrice: number | null;




  phevKwhPer100Km: number | null;
  phevKwhPrice: number | null;
}

// Schema version stays at 2. The new Settings fields (recordFieldsByType
// and the five warning-threshold knobs) don't require a migration: any
// missing fields are hydrated at read time by getSettings, which merges
// DEFAULT_SETTINGS over the stored row. Adding optional settings fields
// isn't a breaking change.
export const SCHEMA_VERSION = 2;

export interface Settings {
  id: 'global';
  consumptionUnit: ConsumptionUnit;
  defaultElectricityCost: number;
  currency: string;
  schemaVersion: number;
  backupCadence: BackupCadence;
  lastBackupAt: string | null;
  lastBackupHash: string | null;
  themeMode: ThemeMode;
  smoothingWindow: number;

  // Records-screen per-vehicle-type field configuration. Three fields per
  // vehicle type, chosen from the union allowed for that type.
  recordFieldsByType: RecordFieldsByType;

  // Consistency-check thresholds — all user-tunable in Settings.
  // A: consumption ±N% vs running average (default 50)
  warnConsumptionPercent: number;
  // B: unit price ±N% vs median of last 5 same-vehicle entries (default 50)
  warnPricePercent: number;
  // D: new-interval distance > N × average interval distance (default 3)
  warnDistanceMultiplier: number;
  // H: another entry within ±N minutes is treated as a candidate dup
  warnDuplicateMinutes: number;
  // H: …AND within ±N km on the odometer
  warnDuplicateKm: number;
}

// Sensible per-vehicle-type defaults for the Records-screen field rows.
// Picked to match the user's stated preferences in the design discussion.
export const DEFAULT_RECORD_FIELDS: RecordFieldsByType = {
  ice: ['refuelCost', 'unitPrice', 'avgFuelConsumption'],
  hybrid: ['refuelCost', 'unitPrice', 'avgFuelConsumption'],
  phev: ['refuelCost', 'unitPrice', 'avgEquivalentFuelConsumption'],
  ev: ['refuelCost', 'unitPrice', 'avgElectricityConsumption'],
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'global',
  consumptionUnit: 'km/l',
  defaultElectricityCost: 0.25,
  currency: 'EUR',
  schemaVersion: SCHEMA_VERSION,
  backupCadence: 'weekly',
  lastBackupAt: null,
  lastBackupHash: null,
  themeMode: 'auto',
  smoothingWindow: 5,
  recordFieldsByType: DEFAULT_RECORD_FIELDS,
  warnConsumptionPercent: 50,
  warnPricePercent: 50,
  warnDistanceMultiplier: 3,
  warnDuplicateMinutes: 30,
  warnDuplicateKm: 5,
};

export const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
};

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP'] as const;
