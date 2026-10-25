import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type FuelUp, type Vehicle } from '../../db/types';
import { configToJson } from './json';
import { fuelupsToCsv } from './csv';
import { describeReplace, planImport, type ImportSource } from './index';

const audi: Vehicle = {
  id: 'v-audi',
  name: 'Audi A3',
  type: 'phev',
  defaultElectricityCost: 0.32,
  createdAt: '2024-01-01T00:00:00.000Z',
};

const oldCar: Vehicle = {
  id: 'v-old',
  name: 'Old car',
  type: 'ice',
  defaultElectricityCost: null,
  createdAt: '2023-01-01T00:00:00.000Z',
};

function mkEntry(partial: Partial<FuelUp>): FuelUp {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    vehicleId: partial.vehicleId ?? 'v-audi',
    date: partial.date ?? '2026-01-01T00:00:00.000Z',
    odometer: partial.odometer ?? 0,
    partial: partial.partial ?? false,
    missed: partial.missed ?? false,
    totalCost: partial.totalCost ?? null,
    notes: partial.notes ?? null,
    gasLiters: partial.gasLiters ?? null,
    gasPricePerLiter: partial.gasPricePerLiter ?? null,
    kWhCharged: partial.kWhCharged ?? null,
    kWhPrice: partial.kWhPrice ?? null,
    phevKwhPer100Km: partial.phevKwhPer100Km ?? null,
    phevKwhPrice: partial.phevKwhPrice ?? null,
  };
}

// The two files "Back up now" produces for a device with one vehicle.
const backupJson: ImportSource = {
  name: 'fueltracker-config-2026-10-24.json',
  text: configToJson([audi], { ...DEFAULT_SETTINGS, currency: 'GBP' }),
};
const backupCsv: ImportSource = {
  name: 'fueltracker-entries-2026-10-24.csv',
  text: fuelupsToCsv(
    [
      mkEntry({ odometer: 1000, gasLiters: 30 }),
      mkEntry({ date: '2026-02-01T00:00:00.000Z', odometer: 1500, gasLiters: 31 }),
    ],
    [audi],
  ),
};

describe('planImport — both backup files at once', () => {
  it('attaches CSV rows to the JSON vehicles on an empty device (no placeholders)', () => {
    const plan = planImport([backupJson, backupCsv], [], 'merge');
    expect(plan.vehicles).toEqual([audi]);
    expect(plan.summary.createdStubVehicles).toEqual([]);
    expect(plan.fuelups).toHaveLength(2);
    expect(plan.fuelups.every((f) => f.vehicleId === 'v-audi')).toBe(true);
    expect(plan.settings?.currency).toBe('GBP');
  });

  it('gives the same result whichever order the files were picked in', () => {
    const a = planImport([backupJson, backupCsv], [], 'merge');
    const b = planImport([backupCsv, backupJson], [], 'merge');
    expect(b.vehicles).toEqual(a.vehicles);
    expect(b.fuelups.map((f) => f.id)).toEqual(a.fuelups.map((f) => f.id));
    expect(b.summary.createdStubVehicles).toEqual([]);
  });

  it('replace with both files replaces vehicles, settings and entries', () => {
    const plan = planImport([backupJson, backupCsv], [oldCar], 'replace');
    expect(plan.clearVehicles).toBe(true);
    expect(plan.clearFuelups).toBe(true);
    expect(plan.keepFuelupsOfVehicles).toBeNull();
  });

  it('replace with a JSON ignores current vehicles when resolving CSV rows', () => {
    // The CSV row points at a vehicle that only exists on the device. The
    // JSON replace will clear it, so the row must get a placeholder rather
    // than be attached to a vehicle that's about to be deleted.
    const csv: ImportSource = {
      name: 'entries.csv',
      text: fuelupsToCsv([mkEntry({ vehicleId: 'v-old', odometer: 1, gasLiters: 20 })], [oldCar]),
    };
    const plan = planImport([backupJson, csv], [oldCar], 'replace');
    expect(plan.vehicles.map((v) => v.id)).toEqual(['v-audi', 'v-old']);
    expect(plan.summary.createdStubVehicles).toEqual(['Old car']);
  });
});

describe('planImport — single files keep their earlier behaviour', () => {
  it('CSV replace clears entries only', () => {
    const plan = planImport([backupCsv], [audi], 'replace');
    expect(plan.clearVehicles).toBe(false);
    expect(plan.clearFuelups).toBe(true);
    expect(plan.settings).toBeNull();
  });

  it('JSON replace clears vehicles and keeps only entries of the JSON vehicles', () => {
    const plan = planImport([backupJson], [oldCar], 'replace');
    expect(plan.clearVehicles).toBe(true);
    expect(plan.clearFuelups).toBe(false);
    expect([...(plan.keepFuelupsOfVehicles ?? [])]).toEqual(['v-audi']);
  });

  it('merge clears nothing', () => {
    const plan = planImport([backupJson, backupCsv], [oldCar], 'merge');
    expect(plan.clearVehicles).toBe(false);
    expect(plan.clearFuelups).toBe(false);
    expect(plan.keepFuelupsOfVehicles).toBeNull();
  });
});

describe('planImport — validation happens before anything is written', () => {
  it('throws naming the bad file, even when the other file is valid', () => {
    const badCsv: ImportSource = {
      name: 'broken.csv',
      text: 'date,vehicle,vehicleId,odometer\n14/05/2026,,v-audi,1000\n',
    };
    expect(() => planImport([backupJson, badCsv], [], 'merge')).toThrow(
      /^broken\.csv: Row 2: invalid date/,
    );
  });

  it('refuses a config from another schema version', () => {
    const future: ImportSource = {
      name: 'future.json',
      text: JSON.stringify({ ...JSON.parse(backupJson.text), schemaVersion: 99 }),
    };
    expect(() => planImport([future], [], 'merge')).toThrow(/future\.json: schema mismatch/);
  });
});

describe('describeReplace', () => {
  it('describes what each combination replaces', () => {
    expect(describeReplace(['a.csv'])).toMatch(/^all entries/);
    expect(describeReplace(['a.json'])).toMatch(/^all vehicles and settings/);
    expect(describeReplace(['a.csv', 'a.json'])).toBe('all vehicles, settings and entries');
  });
});
