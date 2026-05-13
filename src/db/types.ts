export type VehicleType = 'ice' | 'hybrid' | 'phev' | 'ev';
export type ConsumptionUnit = 'km/l' | 'l/100km';
export type BackupCadence = 'off' | 'weekly' | 'biweekly' | 'monthly';
export type ThemeMode = 'auto' | 'light' | 'dark';

export interface Vehicle {
  id: string;
  name: string;
  type: VehicleType;
  defaultElectricityCost: number | null; // €/kWh, overrides global
  createdAt: string; // ISO
}

export interface FuelUp {
  // Identity
  id: string;
  vehicleId: string;

  // When + where
  date: string;     // ISO 8601
  odometer: number; // km

  // Universal
  totalCost: number | null; // € paid for this entry's purchase
  partial: boolean;         // partial fill / charge — rolls into next full entry
  /**
   * Set when the user knows a fuel-up between the previous entry and this one
   * wasn't logged. The interval ending at this entry has incomplete data
   * (less fuel logged than was actually used), so it's EXCLUDED from stats
   * and chart points entirely rather than fudged with an estimated value.
   */
  missed: boolean;
  notes: string | null;

  // Gas refueling — used by ICE / HEV / PHEV gas fills (null for EV)
  gasLiters: number | null;
  gasPricePerLiter: number | null;

  // EV charging event — used by EV vehicles (null for ICE / HEV / PHEV)
  kWhCharged: number | null;
  kWhPrice: number | null;

  // PHEV-only: average electricity stats covering the segment up to this entry.
  // (PHEVs report electricity as a since-last-entry summary rather than as
  // discrete charge events.)
  phevKwhPer100Km: number | null;
  phevKwhPrice: number | null;
}

export const SCHEMA_VERSION = 2;

export interface Settings {
  id: 'global';
  consumptionUnit: ConsumptionUnit;
  defaultElectricityCost: number; // €/kWh
  currency: string; // ISO code, default 'EUR'
  schemaVersion: number;
  backupCadence: BackupCadence;
  lastBackupAt: string | null; // ISO
  lastBackupHash: string | null;
  themeMode: ThemeMode;
}

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
};

export const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
};

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP'] as const;
