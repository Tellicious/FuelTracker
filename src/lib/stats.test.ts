import { describe, expect, it } from 'vitest';
import type { FuelUp } from '../db/types';
import { computeDashboard, computeIntervals } from './stats';

function mkEntry(partial: Partial<FuelUp>): FuelUp {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    vehicleId: 'v1',
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

describe('computeIntervals', () => {
  it('emits one interval per full-to-full segment', () => {
    const entries: FuelUp[] = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-30', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-02-15', odometer: 11000, gasLiters: 32, gasPricePerLiter: 1.85, totalCost: 59.2 }),
    ];
    const ivs = computeIntervals(entries, 'ice');
    expect(ivs.length).toBe(2);
    expect(ivs[0].distanceKm).toBe(500);
    expect(ivs[0].kmPerL).toBeCloseTo(500 / 30, 3);
    expect(ivs[1].distanceKm).toBe(500);
    expect(ivs[1].kmPerL).toBeCloseTo(500 / 32, 3);
  });

  it('rolls partial fuel-ups into the next full one', () => {
    const entries: FuelUp[] = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.8, totalCost: 54 }),
      mkEntry({ date: '2026-01-10', odometer: 10200, gasLiters: 15, gasPricePerLiter: 1.85, totalCost: 27.75, partial: true }),
      mkEntry({ date: '2026-01-25', odometer: 10500, gasLiters: 20, gasPricePerLiter: 1.85, totalCost: 37 }),
    ];
    const ivs = computeIntervals(entries, 'ice');
    expect(ivs.length).toBe(1);
    expect(ivs[0].distanceKm).toBe(500);
    expect(ivs[0].gasLitersUsed).toBe(35); // 15 partial + 20 closing
  });

  it('PHEV: closing entry phev rate applies to the FULL interval, even with a partial in between', () => {
    // Bug report repro: 752 km full-to-full, with a tiny partial fill at the
    // ~595 km mark. The closing entry says 3.80 kWh/100 km — that rate must
    // apply to ALL 752 km (the trip-computer figure resets at the previous
    // full fill, not at the partial). Expected equiv ≈ 25 km/l, NOT 28.3.
    const entries: FuelUp[] = [
      mkEntry({ date: '2026-03-01T00:00:00Z', odometer: 43515, gasLiters: 30, gasPricePerLiter: 1.70, totalCost: 51.0 }),
      // Tiny partial in the middle — gas only, no phev fields recorded
      mkEntry({ date: '2026-04-10T00:00:00Z', odometer: 44110, gasLiters: 12, gasPricePerLiter: 1.71, totalCost: 20.52, partial: true }),
      mkEntry({
        date: '2026-04-26T15:33:00Z',
        odometer: 44267,
        gasLiters: 25.63,
        gasPricePerLiter: 1.717,
        totalCost: 44.01,
        phevKwhPer100Km: 3.80,
        phevKwhPrice: 0.27,
      }),
    ];
    const ivs = computeIntervals(entries, 'phev');
    expect(ivs.length).toBe(1);
    const iv = ivs[0];
    expect(iv.distanceKm).toBe(752);
    // Electricity: 3.80% × 752 = 28.576 kWh; × 0.27 €/kWh = 7.71552 €.
    // This is the headline fix — pre-fix, only the partial→closing segment
    // (~157 km) was being counted and we'd get ~5.97 kWh instead.
    expect(iv.kWhUsed).toBeCloseTo(28.576, 2);
    expect(iv.electricityCost).toBeCloseTo(7.7155, 3);
    // Gas (interval-only, anchor excluded): partial 12 + closing 25.63 = 37.63 L
    // and 20.52 + 44.01 = 64.53 €.
    expect(iv.gasLitersUsed).toBeCloseTo(37.63, 2);
    expect(iv.gasCost).toBeCloseTo(64.53, 2);
  });

  it('PHEV: equivalent km/l matches the bug report (752 km, 25.63 L, 3.80 kWh/100km)', () => {
    // Simpler version: no partial in between. Repro the user's quoted
    // expectation of ~25 km/l equivalent.
    const entries: FuelUp[] = [
      mkEntry({ date: '2026-03-01T00:00:00Z', odometer: 43515, gasLiters: 30, gasPricePerLiter: 1.70, totalCost: 51.0 }),
      mkEntry({
        date: '2026-04-26T15:33:00Z',
        odometer: 44267,
        gasLiters: 25.63,
        gasPricePerLiter: 1.717,
        totalCost: 44.01,
        phevKwhPer100Km: 3.80,
        phevKwhPrice: 0.27,
      }),
    ];
    const ivs = computeIntervals(entries, 'phev');
    expect(ivs.length).toBe(1);
    // total = 44.01 + 7.7155 = 51.7255; equiv L = 30.125; equiv km/l ≈ 24.96
    expect(ivs[0].equivalentKmPerL).toBeCloseTo(24.96, 1);
  });

  it('PHEV: a later, higher-priced entry must NOT change earlier intervals equivalent km/l', () => {
    // Before the per-interval-pump-price fix, the equivalent used
    // mostRecentPumpPrice(allEntries), so adding a later expensive fill
    // would inflate every historical equiv. Lock that down: each interval's
    // equiv uses ITS OWN closing pump price.
    const userBugEntries: FuelUp[] = [
      mkEntry({ date: '2026-03-01T00:00:00Z', odometer: 43515, gasLiters: 30, gasPricePerLiter: 1.70, totalCost: 51.0 }),
      mkEntry({
        date: '2026-04-26T15:33:00Z',
        odometer: 44267,
        gasLiters: 25.63,
        gasPricePerLiter: 1.717,
        totalCost: 44.01,
        phevKwhPer100Km: 3.80,
        phevKwhPrice: 0.27,
      }),
    ];

    // Same data, but with a later entry where gas got expensive
    const withLaterExpensive: FuelUp[] = [
      ...userBugEntries,
      mkEntry({
        date: '2026-05-10T00:00:00Z',
        odometer: 44800,
        gasLiters: 25,
        gasPricePerLiter: 1.95,
        totalCost: 48.75,
        phevKwhPer100Km: 4.0,
        phevKwhPrice: 0.27,
      }),
    ];

    const before = computeIntervals(userBugEntries, 'phev');
    const after = computeIntervals(withLaterExpensive, 'phev');
    // The April 26 interval is the SAME in both — its equivalent must not
    // be perturbed by the May 10 fill-up's higher price.
    expect(after[0].equivalentKmPerL).toBeCloseTo(before[0].equivalentKmPerL, 3);
    expect(after[0].equivalentKmPerL).toBeCloseTo(24.96, 1);
  });
  it('skips intervals containing a missed entry (no fake estimate)', () => {
    const entries: FuelUp[] = [
      // Good interval
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-30', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      // User forgot to log one in between; the closing entry is flagged missed
      mkEntry({
        date: '2026-02-15',
        odometer: 11500,
        gasLiters: 32,
        gasPricePerLiter: 1.9,
        totalCost: 60.8,
        missed: true,
      }),
      // Good interval again
      mkEntry({ date: '2026-03-01', odometer: 12000, gasLiters: 25, gasPricePerLiter: 1.9, totalCost: 47.5 }),
    ];
    const ivs = computeIntervals(entries, 'ice');
    // Three potential intervals, but the middle one is excluded entirely.
    expect(ivs.length).toBe(2);
    expect(ivs[0].fromOdometer).toBe(10000);
    expect(ivs[0].toOdometer).toBe(10500);
    expect(ivs[1].fromOdometer).toBe(11500);
    expect(ivs[1].toOdometer).toBe(12000);
  });
});

describe('computeDashboard', () => {
  it('returns nulls for empty input', () => {
    const d = computeDashboard([]);
    expect(d.totalTrackedKm).toBe(0);
    expect(d.avgEurPerKm).toBeNull();
    expect(d.bestKmPerL).toBeNull();
  });

  it('basic ICE: total km, avg €/km, best km/l', () => {
    const entries: FuelUp[] = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 33, gasPricePerLiter: 1.85, totalCost: 61.05 }),
      mkEntry({ date: '2026-02-01', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.9, totalCost: 57 }),
    ];
    const d = computeDashboard(entries);
    expect(d.totalTrackedKm).toBe(500);
    expect(d.bestKmPerL).toBeCloseTo(500 / 30, 3);
    expect(d.avgEurPerKm).toBeCloseTo(57 / 500, 4);
  });

  it('totalTrackedKm excludes km from missed intervals', () => {
    // 10000 → 10500 (good, 500 km)
    // 10500 → 11500 (MISSED — closing flagged, dropped from stats)
    // 11500 → 12000 (good, 500 km)
    // Final odometer is 12000, but only 1000 km of that has a real
    // consumption reading behind it.
    const entries: FuelUp[] = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-30', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({
        date: '2026-02-15',
        odometer: 11500,
        gasLiters: 32,
        gasPricePerLiter: 1.9,
        totalCost: 60.8,
        missed: true,
      }),
      mkEntry({ date: '2026-03-01', odometer: 12000, gasLiters: 25, gasPricePerLiter: 1.9, totalCost: 47.5 }),
    ];
    const d = computeDashboard(entries);
    expect(d.totalTrackedKm).toBe(1000); // not 12000 − 10000 = 2000
    expect(d.avgEurPerKm).toBeCloseTo((55.5 + 47.5) / 1000, 4);
  });

  it('treats HEV like ICE — ignores phevKwh* even if stray data is present', () => {
    const entries: FuelUp[] = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({
        date: '2026-02-01',
        odometer: 11000,
        gasLiters: 60,
        gasPricePerLiter: 1.85,
        totalCost: 111,
        phevKwhPer100Km: 10,
        phevKwhPrice: 0.25,
      }),
    ];
    const d = computeDashboard(entries, 'hybrid');
    expect(d.avgKWhPer100Km).toBeNull();
    expect(d.lastKWhPer100Km).toBeNull();
    expect(d.lastEquivalentKmPerL).toBeCloseTo(1000 / 60, 3);
    expect(d.lastKmPerL).toBeCloseTo(1000 / 60, 3);
  });

  it('equivalent km/l avg uses the global (avgPumpPrice / costPerKm) formula', () => {
    // Two intervals — anchor + two closing fulls. Compute the totals
    // explicitly so the test reads as a spec for the formula.
    //
    //   IV1: 500 km, 30 L gas @ 1.85 (only gas)   → gasCost 55.5,  total 55.5
    //   IV2: 500 km, 30 L gas @ 1.85 + 10 kWh/100km @ 0.25 €/kWh over 500 km
    //          → kWh = 50, elec cost = 12.5      → gasCost 55.5, total 68
    //
    //   Σ gasCost      = 111
    //   Σ gasQuantity  = 60 L
    //   Σ totalCost    = 123.5
    //   Σ km           = 1000
    //   avgPumpPrice   = 111 / 60     = 1.85
    //   costPerKm      = 123.5 / 1000 = 0.1235
    //   avgEquiv       = 1.85 / 0.1235 ≈ 14.98 km/l
    const entries: FuelUp[] = [
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({ date: '2026-01-15', odometer: 10500, gasLiters: 30, gasPricePerLiter: 1.85, totalCost: 55.5 }),
      mkEntry({
        date: '2026-02-01',
        odometer: 11000,
        gasLiters: 30,
        gasPricePerLiter: 1.85,
        totalCost: 55.5,
        phevKwhPer100Km: 10,
        phevKwhPrice: 0.25,
      }),
    ];
    const d = computeDashboard(entries, 'phev');
    const totalGasCost = 55.5 + 55.5;
    const totalGasQuantity = 30 + 30;
    const totalOverallCost = 55.5 + 68;
    const totalKm = 1000;
    const expected =
      (totalGasCost / totalGasQuantity) / (totalOverallCost / totalKm);
    expect(d.avgEquivalentKmPerL).toBeCloseTo(expected, 2);
    expect(d.avgEquivalentKmPerL).toBeCloseTo(14.98, 2);
    // bestEquiv is still max per-interval (chart-points stay matched)
    const equiv1 = d.intervals[0].equivalentKmPerL;
    const equiv2 = d.intervals[1].equivalentKmPerL;
    expect(d.bestEquivalentKmPerL).toBeCloseTo(Math.max(equiv1, equiv2), 2);
  });

  it('equivalent avg respects partials (rolled in) and missed (excluded)', () => {
    // Three full-to-full intervals built, but one is dropped via missed.
    // The avg uses only the valid intervals' totals.
    const entries: FuelUp[] = [
      // Interval 1: anchor → partial → closing. Partial rolls in.
      mkEntry({ date: '2026-01-01', odometer: 10000, gasLiters: 30, gasPricePerLiter: 1.70, totalCost: 51.0 }),
      mkEntry({ date: '2026-01-10', odometer: 10300, gasLiters: 18, gasPricePerLiter: 1.70, totalCost: 30.6, partial: true }),
      mkEntry({
        date: '2026-01-20',
        odometer: 10500,
        gasLiters: 12,
        gasPricePerLiter: 1.72,
        totalCost: 20.64,
        phevKwhPer100Km: 5,
        phevKwhPrice: 0.25,
      }),
      // Interval 2: MISSED — must be excluded from avg
      mkEntry({
        date: '2026-02-15',
        odometer: 11500,
        gasLiters: 32,
        gasPricePerLiter: 1.9,
        totalCost: 60.8,
        missed: true,
      }),
      // Interval 3: clean
      mkEntry({
        date: '2026-03-01',
        odometer: 12000,
        gasLiters: 25,
        gasPricePerLiter: 1.9,
        totalCost: 47.5,
        phevKwhPer100Km: 8,
        phevKwhPrice: 0.30,
      }),
    ];
    const d = computeDashboard(entries, 'phev');
    expect(d.intervals.length).toBe(2);
    // Interval 1: 500 km. gas = 30L (50.4€... wait let me recompute):
    //   partial+closing gas = 18 + 12 = 30 L, gas cost = 30.6 + 20.64 = 51.24 €
    //   elec = 5/100 × 500 = 25 kWh × 0.25 = 6.25 €
    //   total = 57.49 €
    // Interval 3: 500 km. gas = 25L (47.5€), elec = 8/100 × 500 = 40 kWh × 0.30 = 12€
    //   total = 59.5 €
    //
    // Sums (only valid):
    //   gasCost     = 51.24 + 47.5  = 98.74
    //   gasQuantity = 30    + 25    = 55
    //   totalCost   = 57.49 + 59.5  = 116.99
    //   km          = 500   + 500   = 1000
    //   avgPumpPrice = 98.74 / 55 = 1.7953
    //   costPerKm    = 116.99 / 1000 = 0.11699
    //   avgEquiv     = 15.34 km/l
    const expected = (98.74 / 55) / (116.99 / 1000);
    expect(d.avgEquivalentKmPerL).toBeCloseTo(expected, 2);
  });

  it('EV: kWhCharged drives consumption, gas metrics are null', () => {
    const entries: FuelUp[] = [
      mkEntry({ date: '2026-01-01', odometer: 10000, kWhCharged: 50, kWhPrice: 0.30, totalCost: 15 }),
      mkEntry({ date: '2026-01-15', odometer: 10500, kWhCharged: 60, kWhPrice: 0.30, totalCost: 18 }),
      mkEntry({ date: '2026-02-01', odometer: 11000, kWhCharged: 50, kWhPrice: 0.30, totalCost: 15 }),
    ];
    const d = computeDashboard(entries, 'ev');
    expect(d.lastKWhPer100Km).toBeCloseTo(10, 2);
    expect(d.bestKWhPer100Km).toBeCloseTo(10, 2);
    expect(d.avgKWhPer100Km).toBeCloseTo(11, 2);
    expect(d.lastKmPerL).toBeNull();
    expect(d.bestKmPerL).toBeNull();
    expect(d.avgEurPerKm).toBeCloseTo(33 / 1000, 4);
  });
});

describe('large dataset', () => {
  it('produces correct totals across 100 entries', () => {
    const entries: FuelUp[] = [];
    let odo = 10000;
    for (let i = 0; i < 100; i++) {
      odo += 500;
      entries.push(
        mkEntry({
          date: new Date(2026, 0, 1 + i).toISOString(),
          odometer: odo,
          gasLiters: 30,
          gasPricePerLiter: 1.85,
          totalCost: 55.5,
        }),
      );
    }
    const d = computeDashboard(entries);
    expect(d.totalTrackedKm).toBe(99 * 500);
    expect(d.intervals.length).toBe(99);
  });
});
