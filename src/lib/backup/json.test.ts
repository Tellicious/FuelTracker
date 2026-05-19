import { describe, expect, it } from 'vitest';
import type { Settings, Vehicle } from '../../db/types';
import { DEFAULT_RECORD_FIELDS } from '../../db/types';
import { configToJson, jsonToConfig } from './json';

describe('JSON config round-trip', () => {
  it('exports and re-imports vehicles + settings', () => {
    const vehicles: Vehicle[] = [
      {
        id: 'v1',
        name: 'Audi A3',
        type: 'phev',
        defaultElectricityCost: 0.32,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'v2',
        name: 'Tesla',
        type: 'ev',
        defaultElectricityCost: 0.25,
        createdAt: '2024-02-01T00:00:00.000Z',
      },
    ];
    const settings: Settings = {
      id: 'global',
      consumptionUnit: 'km/l',
      currency: 'GBP',
      defaultElectricityCost: 0.25,
      backupCadence: 'weekly',
      themeMode: 'dark',
      smoothingWindow: 5,
      schemaVersion: 2,
      lastBackupAt: '2024-05-01T00:00:00.000Z',
      lastBackupHash: 'deadbeef',
      // New optional fields — verify they survive serialisation too.
      // No schema bump for these; getSettings hydrates missing fields at
      // read time so older backups still load.
      recordFieldsByType: {
        ice: ['refuelCost', 'unitPrice', 'avgFuelConsumption'],
        hybrid: ['refuelCost', 'unitPrice', 'avgFuelConsumption'],
        phev: ['refuelCost', 'unitPrice', 'avgEquivalentFuelConsumption'],
        ev: ['refuelCost', 'unitPrice', 'avgElectricityConsumption'],
      },
      warnConsumptionPercent: 35,
      warnPricePercent: 40,
      warnDistanceMultiplier: 2.5,
      warnDuplicateMinutes: 20,
      warnDuplicateKm: 4,
    };
    const text = configToJson(vehicles, settings);
    const parsed = jsonToConfig(text);

    expect(parsed.vehicles).toHaveLength(2);
    expect(parsed.vehicles[1].type).toBe('ev');
    expect(parsed.settings.currency).toBe('GBP');
    expect(parsed.settings.themeMode).toBe('dark');


    expect(parsed.settings.lastBackupAt).toBeNull();
    expect(parsed.settings.lastBackupHash).toBeNull();

    // New v3 fields round-trip cleanly.
    expect(parsed.settings.recordFieldsByType.phev[2]).toBe('avgEquivalentFuelConsumption');
    expect(parsed.settings.recordFieldsByType.ev[2]).toBe('avgElectricityConsumption');
    expect(parsed.settings.warnConsumptionPercent).toBe(35);
    expect(parsed.settings.warnPricePercent).toBe(40);
    expect(parsed.settings.warnDistanceMultiplier).toBe(2.5);
    expect(parsed.settings.warnDuplicateMinutes).toBe(20);
    expect(parsed.settings.warnDuplicateKm).toBe(4);
  });

  it('rejects malformed JSON', () => {
    expect(() => jsonToConfig('not even json {')).toThrow();
    expect(() => jsonToConfig('{}')).toThrow();
    expect(() => jsonToConfig('{"schemaVersion":1}')).toThrow();
  });

  it('round-trips with DEFAULT_RECORD_FIELDS for new users', () => {
    const settings: Settings = {
      id: 'global',
      consumptionUnit: 'km/l',
      currency: 'EUR',
      defaultElectricityCost: 0.25,
      backupCadence: 'weekly',
      themeMode: 'auto',
      smoothingWindow: 5,
      schemaVersion: 2,
      lastBackupAt: null,
      lastBackupHash: null,
      recordFieldsByType: DEFAULT_RECORD_FIELDS,
      warnConsumptionPercent: 50,
      warnPricePercent: 50,
      warnDistanceMultiplier: 3,
      warnDuplicateMinutes: 30,
      warnDuplicateKm: 5,
    };
    const text = configToJson([], settings);
    const parsed = jsonToConfig(text);
    expect(parsed.settings.recordFieldsByType.ice).toEqual(DEFAULT_RECORD_FIELDS.ice);
    expect(parsed.settings.recordFieldsByType.hybrid).toEqual(DEFAULT_RECORD_FIELDS.hybrid);
    expect(parsed.settings.warnDistanceMultiplier).toBe(3);
  });
});
