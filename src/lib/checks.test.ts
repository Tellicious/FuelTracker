import { describe, expect, it } from 'vitest';
import type { FuelUp, VehicleType } from '../db/types';
import {
  checkConsumption,
  checkDateOrder,
  checkDistance,
  checkDuplicate,
  checkUnitPrice,
  runAllChecks,
  type CheckContext,
} from './checks';

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

const DEFAULT_THRESHOLDS = {
  consumptionPercent: 50,
  pricePercent: 50,
  distanceMultiplier: 3,
  duplicateMinutes: 30,
  duplicateKm: 5,
};

function mkCtx(
  candidate: Partial<CheckContext['candidate']> & { vehicleType: VehicleType },
  otherEntries: FuelUp[],
  thresholds = DEFAULT_THRESHOLDS,
): CheckContext {
  return {
    candidate: {
      id: candidate.id ?? null,
      date: candidate.date ?? '2026-02-01T00:00:00Z',
      odometer: candidate.odometer ?? 0,
      vehicleType: candidate.vehicleType,
      partial: candidate.partial ?? false,
      missed: candidate.missed ?? false,
      gasLiters: candidate.gasLiters ?? null,
      gasPricePerLiter: candidate.gasPricePerLiter ?? null,
      kWhCharged: candidate.kWhCharged ?? null,
      kWhPrice: candidate.kWhPrice ?? null,
      totalCost: candidate.totalCost ?? null,
      phevKwhPer100Km: candidate.phevKwhPer100Km ?? null,
      phevKwhPrice: candidate.phevKwhPrice ?? null,
    },
    otherEntries,
    thresholds,
  };
}

describe('checkConsumption (A)', () => {
  it('fires when km/l is more than 50% below the running average (ICE)', () => {
    // History: three intervals of ~16.7 km/l (500km / 30L)
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-30', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-02-25', odometer: 11000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
    ];
    // Candidate: 500km / 80L = 6.25 km/l — drastically worse.
    const ctx = mkCtx(
      {
        vehicleType: 'ice',
        date: '2026-03-20T00:00:00Z',
        odometer: 11500,
        gasLiters: 80,
        gasPricePerLiter: 1.85,
        totalCost: 148,
      },
      history,
    );
    const w = checkConsumption(ctx);
    expect(w).not.toBeNull();
    expect(w!.field).toBe('consumption');
    expect(w!.message).toContain('fuel consumption');
    expect(w!.message).toContain('below');
  });

  it('stays silent when km/l is within 50% of average', () => {
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-30', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-02-25', odometer: 11000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
    ];
    // 500 / 35 = 14.3 km/l vs avg ~16.7 → about -14%.
    const ctx = mkCtx(
      {
        vehicleType: 'ice',
        date: '2026-03-20T00:00:00Z',
        odometer: 11500,
        gasLiters: 35,
        gasPricePerLiter: 1.85,
        totalCost: 64.75,
      },
      history,
    );
    expect(checkConsumption(ctx)).toBeNull();
  });

  it('skips when there is insufficient history (only one prior interval)', () => {
    // History: 2 entries → 1 prior interval. Candidate adds another →
    // 2 intervals total, others = 1. Below the new "need ≥ 2 others"
    // threshold so the check stays silent.
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-30', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
    ];
    const ctx = mkCtx(
      {
        vehicleType: 'ice',
        date: '2026-02-25T00:00:00Z',
        odometer: 11000,
        gasLiters: 80,
        gasPricePerLiter: 1.85,
        totalCost: 148,
      },
      history,
    );
    expect(checkConsumption(ctx)).toBeNull();
  });

  it('fires for EV when kWh/100km is more than 50% above the average', () => {
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, kWhCharged: 50, kWhPrice: 0.3, totalCost: 15 }),
      mkEntry({ date: '2026-01-15', odometer: 10500, kWhCharged: 50, kWhPrice: 0.3, totalCost: 15 }),
      mkEntry({ date: '2026-02-01', odometer: 11000, kWhCharged: 50, kWhPrice: 0.3, totalCost: 15 }),
    ];
    // Candidate uses way more energy per 100 km.
    const ctx = mkCtx(
      {
        vehicleType: 'ev',
        date: '2026-02-20T00:00:00Z',
        odometer: 11200,
        kWhCharged: 60,
        kWhPrice: 0.3,
        totalCost: 18,
      },
      history,
    );
    const w = checkConsumption(ctx);
    expect(w).not.toBeNull();
    expect(w!.message).toContain('electricity consumption');
    expect(w!.message).toContain('worse');
  });
});

describe('checkUnitPrice (B)', () => {
  it('fires when gas price is +50% over recent median', () => {
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-10', odometer: 10300, gasLiters: 30, gasPricePerLiter: 1.86, totalCost: 55.8 }),
      mkEntry({ date: '2026-01-20', odometer: 10600, gasLiters: 30, gasPricePerLiter: 1.84, totalCost: 55.2 }),
    ];
    const ctx = mkCtx(
      {
        vehicleType: 'ice',
        date: '2026-02-01T00:00:00Z',
        odometer: 11000,
        gasLiters: 30,
        gasPricePerLiter: 18.5, // typo: missing decimal
        totalCost: 555,
      },
      history,
    );
    const w = checkUnitPrice(ctx);
    expect(w).not.toBeNull();
    expect(w!.field).toBe('unitPrice');
  });

  it('stays silent when price is within 50% of recent median', () => {
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-10', odometer: 10300, gasLiters: 30, gasPricePerLiter: 1.86, totalCost: 55.8 }),
      mkEntry({ date: '2026-01-20', odometer: 10600, gasLiters: 30, gasPricePerLiter: 1.84, totalCost: 55.2 }),
    ];
    const ctx = mkCtx(
      {
        vehicleType: 'ice',
        date: '2026-02-01T00:00:00Z',
        odometer: 11000,
        gasLiters: 30,
        gasPricePerLiter: 2.10, // ~+13%, well under 50%
        totalCost: 63,
      },
      history,
    );
    expect(checkUnitPrice(ctx)).toBeNull();
  });

  it('skips when fewer than 3 prior prices exist', () => {
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-10', odometer: 10300, gasLiters: 30, gasPricePerLiter: 1.86, totalCost: 55.8 }),
    ];
    const ctx = mkCtx(
      {
        vehicleType: 'ice',
        date: '2026-02-01T00:00:00Z',
        odometer: 11000,
        gasLiters: 30,
        gasPricePerLiter: 18.5,
        totalCost: 555,
      },
      history,
    );
    expect(checkUnitPrice(ctx)).toBeNull();
  });

  it('uses kWhPrice for EVs', () => {
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, kWhCharged: 50, kWhPrice: 0.30, totalCost: 15 }),
      mkEntry({ date: '2026-01-15', odometer: 10500, kWhCharged: 50, kWhPrice: 0.28, totalCost: 14 }),
      mkEntry({ date: '2026-02-01', odometer: 11000, kWhCharged: 50, kWhPrice: 0.32, totalCost: 16 }),
    ];
    const ctx = mkCtx(
      {
        vehicleType: 'ev',
        date: '2026-02-20T00:00:00Z',
        odometer: 11500,
        kWhCharged: 50,
        kWhPrice: 0.80, // way over median ~0.30
        totalCost: 40,
      },
      history,
    );
    expect(checkUnitPrice(ctx)).not.toBeNull();
  });
});

describe('checkDistance (D)', () => {
  it('fires when the gap is more than 3× the average interval', () => {
    // Three intervals at 500 km each → avg = 500, threshold = 1500.
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-15', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-02-01', odometer: 11000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-02-15', odometer: 11500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
    ];
    // Candidate odometer 13500 → gap of 2000 km, > 1500 threshold.
    const ctx = mkCtx(
      {
        vehicleType: 'ice',
        date: '2026-03-15T00:00:00Z',
        odometer: 13500,
        gasLiters: 30,
        gasPricePerLiter: 1.85,
        totalCost: 55.5,
      },
      history,
    );
    const w = checkDistance(ctx);
    expect(w).not.toBeNull();
    expect(w!.field).toBe('odometer');
    expect(w!.message).toContain('3×');
  });

  it('stays silent when the gap is within the threshold', () => {
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-15', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-02-01', odometer: 11000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-02-15', odometer: 11500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
    ];
    // Candidate odometer 12300 → gap of 800 km, well under 1500.
    const ctx = mkCtx(
      {
        vehicleType: 'ice',
        date: '2026-03-01T00:00:00Z',
        odometer: 12300,
        gasLiters: 30,
        gasPricePerLiter: 1.85,
        totalCost: 55.5,
      },
      history,
    );
    expect(checkDistance(ctx)).toBeNull();
  });

  it('skips when there are fewer than 3 valid intervals', () => {
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-15', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
    ];
    // Only one prior interval available.
    const ctx = mkCtx(
      {
        vehicleType: 'ice',
        date: '2026-02-15T00:00:00Z',
        odometer: 99999,
        gasLiters: 30,
        gasPricePerLiter: 1.85,
        totalCost: 55.5,
      },
      history,
    );
    expect(checkDistance(ctx)).toBeNull();
  });
});

describe('checkDateOrder (E)', () => {
  it('fires when entry date is earlier than the latest existing entry', () => {
    const history = [
      mkEntry({ date: '2026-01-01T00:00:00Z', odometer: 10000 }),
      mkEntry({ date: '2026-03-01T00:00:00Z', odometer: 10500 }),
    ];
    const ctx = mkCtx(
      { vehicleType: 'ice', date: '2026-02-01T00:00:00Z', odometer: 10800 },
      history,
    );
    const w = checkDateOrder(ctx);
    expect(w).not.toBeNull();
    expect(w!.field).toBe('date');
  });

  it('stays silent when the date is the same as or after the latest', () => {
    const history = [
      mkEntry({ date: '2026-01-01T00:00:00Z', odometer: 10000 }),
      mkEntry({ date: '2026-03-01T00:00:00Z', odometer: 10500 }),
    ];
    const ctx = mkCtx(
      { vehicleType: 'ice', date: '2026-03-15T00:00:00Z', odometer: 10800 },
      history,
    );
    expect(checkDateOrder(ctx)).toBeNull();
  });

  it('skips when there are no prior entries', () => {
    const ctx = mkCtx(
      { vehicleType: 'ice', date: '2026-01-01T00:00:00Z', odometer: 10000 },
      [],
    );
    expect(checkDateOrder(ctx)).toBeNull();
  });
});

describe('checkDuplicate (H)', () => {
  it('fires when another entry is within 30 min AND 5 km', () => {
    const history = [
      mkEntry({ date: '2026-01-01T10:00:00Z', odometer: 10000 }),
    ];
    const ctx = mkCtx(
      { vehicleType: 'ice', date: '2026-01-01T10:15:00Z', odometer: 10002 },
      history,
    );
    const w = checkDuplicate(ctx);
    expect(w).not.toBeNull();
    expect(w!.field).toBe('duplicate');
  });

  it('stays silent when only the time overlaps but odometer is far apart', () => {
    const history = [
      mkEntry({ date: '2026-01-01T10:00:00Z', odometer: 10000 }),
    ];
    const ctx = mkCtx(
      { vehicleType: 'ice', date: '2026-01-01T10:15:00Z', odometer: 10500 },
      history,
    );
    expect(checkDuplicate(ctx)).toBeNull();
  });

  it('stays silent when odometer overlaps but time is far apart', () => {
    const history = [
      mkEntry({ date: '2026-01-01T10:00:00Z', odometer: 10000 }),
    ];
    const ctx = mkCtx(
      { vehicleType: 'ice', date: '2026-01-01T12:00:00Z', odometer: 10002 },
      history,
    );
    expect(checkDuplicate(ctx)).toBeNull();
  });

  it('ignores the entry being edited (same id)', () => {
    const editing = mkEntry({ id: 'edit-me', date: '2026-01-01T10:00:00Z', odometer: 10000 });
    const ctx = mkCtx(
      {
        id: 'edit-me',
        vehicleType: 'ice',
        date: '2026-01-01T10:05:00Z',
        odometer: 10001,
      },
      [editing],
    );
    expect(checkDuplicate(ctx)).toBeNull();
  });
});

describe('runAllChecks', () => {
  it('collects multiple warnings together', () => {
    const history = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-15', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.86, totalCost: 55.8 }),
      mkEntry({ date: '2026-02-01', odometer: 11000, gasLiters: 30, gasPricePerLiter: 1.84, totalCost: 55.2 }),
      mkEntry({ date: '2026-02-15', odometer: 11500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
    ];
    // Candidate: earlier-than-latest date (E), huge odometer jump (D),
    // typo'd unit price (B). Consumption (A) likely too.
    const ctx = mkCtx(
      {
        vehicleType: 'ice',
        date: '2026-02-10T00:00:00Z', // earlier than the 2026-02-15 entry
        odometer: 99999,                // huge jump
        gasLiters: 30,
        gasPricePerLiter: 18.5,         // typo
        totalCost: 555,
      },
      history,
    );
    const ws = runAllChecks(ctx);
    expect(ws.length).toBeGreaterThanOrEqual(2);
    const fields = ws.map((w) => w.field);
    expect(fields).toContain('date');
    expect(fields).toContain('unitPrice');
    expect(fields).toContain('odometer');
  });
});
