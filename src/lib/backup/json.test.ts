import { describe, expect, it } from 'vitest';
import type { Settings, Vehicle } from '../../db/types';
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
    };
    const text = configToJson(vehicles, settings);
    const parsed = jsonToConfig(text);

    expect(parsed.vehicles).toHaveLength(2);
    expect(parsed.vehicles[1].type).toBe('ev');
    expect(parsed.settings.currency).toBe('GBP');
    expect(parsed.settings.themeMode).toBe('dark');


    expect(parsed.settings.lastBackupAt).toBeNull();
    expect(parsed.settings.lastBackupHash).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(() => jsonToConfig('not even json {')).toThrow();
    expect(() => jsonToConfig('{}')).toThrow();
    expect(() => jsonToConfig('{"schemaVersion":1}')).toThrow();
  });
});
