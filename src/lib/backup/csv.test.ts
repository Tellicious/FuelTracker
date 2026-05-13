import { describe, expect, it } from 'vitest';
import type { FuelUp, Vehicle } from '../../db/types';
import { csvToFuelups, fuelupsToCsv } from './csv';

const vehicle: Vehicle = {
  id: 'v1',
  name: 'Audi A3 TFSIe',
  type: 'phev',
  defaultElectricityCost: 0.32,
  createdAt: '2024-01-01T00:00:00.000Z',
};

const evVehicle: Vehicle = {
  id: 'v-ev',
  name: 'Tesla',
  type: 'ev',
  defaultElectricityCost: 0.25,
  createdAt: '2024-01-01T00:00:00.000Z',
};

function mkEntry(partial: Partial<FuelUp>): FuelUp {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    vehicleId: partial.vehicleId ?? 'v1',
    date: partial.date ?? '2026-01-01T00:00:00Z',
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

describe('CSV round-trip', () => {
  it('exports and re-imports fuel-ups with full fidelity', () => {
    const entries: FuelUp[] = [
      mkEntry({
        date: '2024-01-15T10:00:00.000Z',
        odometer: 12345,
        gasLiters: 30.5,
        gasPricePerLiter: 1.85,
        totalCost: 56.43,
        notes: 'Shell, A1 motorway',
      }),
      mkEntry({
        date: '2024-02-01T09:30:00.000Z',
        odometer: 12900,
        gasLiters: 28.2,
        gasPricePerLiter: 1.92,
        totalCost: 54.14,
        phevKwhPer100Km: 12.5,
        phevKwhPrice: 0.28,
      }),
    ];
    const csv = fuelupsToCsv(entries, [vehicle]);
    expect(csv.split('\n')[0]).toContain(
      'date,vehicle,vehicleId,odometer,gasLiters,gasPricePerLiter,kWhCharged,kWhPrice',
    );

    const { fuelups, unknownVehicleNames } = csvToFuelups(csv, [vehicle]);
    expect(unknownVehicleNames).toHaveLength(0);
    expect(fuelups).toHaveLength(2);
    expect(fuelups[0].gasLiters).toBe(30.5);
    expect(fuelups[0].notes).toBe('Shell, A1 motorway');
    expect(fuelups[1].phevKwhPer100Km).toBe(12.5);
  });

  it('survives notes containing quotes, commas, and the word "true"', () => {
    const entries = [
      mkEntry({
        date: '2024-01-01T00:00:00.000Z',
        odometer: 10000,
        gasLiters: 30,
        gasPricePerLiter: 1.85,
        totalCost: 55.5,
        notes: 'He said "fill it", and I did. (true story)',
      }),
    ];
    const csv = fuelupsToCsv(entries, [vehicle]);
    const { fuelups } = csvToFuelups(csv, [vehicle]);
    expect(fuelups[0].notes).toBe('He said "fill it", and I did. (true story)');
  });

  it('flags unknown vehicle names when the matching vehicle is missing', () => {
    const entries = [
      mkEntry({
        date: '2024-01-01T00:00:00.000Z',
        odometer: 10000,
        gasLiters: 30,
      }),
    ];
    const csv = fuelupsToCsv(entries, [vehicle]);
    const { unknownVehicleNames } = csvToFuelups(csv, []);
    expect(unknownVehicleNames).toContain('Audi A3 TFSIe');
  });

  it('writes kWhCharged / kWhPrice for EV entries (not gasLiters)', () => {
    const entries = [
      mkEntry({
        vehicleId: 'v-ev',
        date: '2024-01-01T00:00:00.000Z',
        odometer: 10000,
        kWhCharged: 45,
        kWhPrice: 0.30,
        totalCost: 13.5,
      }),
    ];
    const csv = fuelupsToCsv(entries, [evVehicle]);
    expect(csv).toContain(',,,45,0.3,'); // empty gasLiters/gasPricePerLiter, then 45,0.3
    const { fuelups } = csvToFuelups(csv, [evVehicle]);
    expect(fuelups[0].kWhCharged).toBe(45);
    expect(fuelups[0].kWhPrice).toBe(0.3);
    expect(fuelups[0].gasLiters).toBeNull();
  });

  it('rejects clearly non-FuelTracker CSVs', () => {
    expect(() => csvToFuelups('totally,not,a,backup\n1,2,3,4\n', [])).toThrow();
  });
});

describe('legacy CSV import (schema v1)', () => {
  it('routes legacy liters/pricePerLiter to gas fields for ICE vehicles', () => {
    const legacy = [
      'date,vehicle,vehicleId,odometer,liters,pricePerLiter,totalCost,partial,missed,avgElectricityConsumption,avgElectricityCost,notes,id',
      `2024-01-01T00:00:00Z,Audi A3 TFSIe,v1,12000,30,1.85,55.5,false,false,12,0.28,test,e1`,
    ].join('\n');
    const { fuelups } = csvToFuelups(legacy, [vehicle]);
    expect(fuelups[0].gasLiters).toBe(30);
    expect(fuelups[0].gasPricePerLiter).toBe(1.85);
    expect(fuelups[0].kWhCharged).toBeNull();
    expect(fuelups[0].phevKwhPer100Km).toBe(12);
    expect(fuelups[0].phevKwhPrice).toBe(0.28);
    // `missed` column is silently ignored
  });

  it('routes legacy liters to kWhCharged for EV vehicles', () => {
    const legacy = [
      'date,vehicle,vehicleId,odometer,liters,pricePerLiter,totalCost,partial,missed,avgElectricityConsumption,avgElectricityCost,notes,id',
      `2024-01-01T00:00:00Z,Tesla,v-ev,10000,45,0.3,13.5,false,false,,,,e2`,
    ].join('\n');
    const { fuelups } = csvToFuelups(legacy, [evVehicle]);
    expect(fuelups[0].kWhCharged).toBe(45);
    expect(fuelups[0].kWhPrice).toBe(0.3);
    expect(fuelups[0].gasLiters).toBeNull();
    expect(fuelups[0].gasPricePerLiter).toBeNull();
  });
});
