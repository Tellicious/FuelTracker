export type VehicleType = 'ice' | 'hybrid' | 'phev' | 'ev';
export type ConsumptionUnit = 'km/l' | 'l/100km';
export type BackupCadence = 'off' | 'weekly' | 'biweekly' | 'monthly';
export type ThemeMode = 'auto' | 'light' | 'dark';

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
  smoothingWindow: 5,
};

export const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
};

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP'] as const;
