import type { FuelUp, VehicleType } from '../db/types';

/**
 * One full-to-full consumption interval. `from*` is the closing odometer of
 * the previous full fuel-up; `to*` is the closing odometer of this interval's
 * full fuel-up. Partials in between are aggregated into the interval.
 *
 * Each interval carries totals (gas litres, kWh, costs) for everything that
 * happened between the two anchors, and the derived rates (km/l, kWh/100km,
 * equivalent km/l, €/km).
 */
export interface Interval {
  fromOdometer: number;
  toOdometer: number;
  fromDate: string;
  toDate: string;
  distanceKm: number;
  gasLitersUsed: number;
  kWhUsed: number;
  gasCost: number;
  electricityCost: number;
  totalCost: number;
  kmPerL: number;
  kWhPer100Km: number;
  equivalentKmPerL: number;
  eurPerKm: number;
  endEntryId: string;
}

export interface DashboardStats {
  totalTrackedKm: number;
  avgEurPerKm: number | null;
  lastEurPerKm: number | null;

  lastKmPerL: number | null;
  avgKmPerL: number | null;
  bestKmPerL: number | null;
  bestKmPerLDate: string | null;

  lastKWhPer100Km: number | null;
  avgKWhPer100Km: number | null;
  bestKWhPer100Km: number | null;
  bestKWhPer100KmDate: string | null;

  lastEquivalentKmPerL: number | null;
  avgEquivalentKmPerL: number | null;
  bestEquivalentKmPerL: number | null;
  bestEquivalentKmPerLDate: string | null;

  intervals: Interval[];
}

/** Chronological sort with odometer tie-break. */
export function sortFuelUps(entries: FuelUp[]): FuelUp[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.odometer - b.odometer;
  });
}

/**
 * Walk the sorted fuel-ups and emit one Interval per full-to-full segment.
 * Partial entries inside an interval roll into the closing full entry.
 *
 * Vehicle-type semantics:
 *   - ice / hybrid: gas fields are the source of truth, electricity is
 *     ignored. HEVs charge from regen/engine, so they don't separately pay
 *     for electricity.
 *   - phev: gas fields + the phevKwhPer100Km/phevKwhPrice "since previous
 *     entry" stats. Electricity is layered on top of gas for the equivalent
 *     km/l calculation.
 *   - ev: kWhCharged + kWhPrice. No gas fields.
 */
export function computeIntervals(
  entries: FuelUp[],
  vehicleType: VehicleType = 'ice',
): Interval[] {
  const sorted = sortFuelUps(entries);
  const intervals: Interval[] = [];

  let anchorIdx = sorted.findIndex((e) => !e.partial);
  if (anchorIdx < 0) return intervals;

  const isEv = vehicleType === 'ev';
  const isPhev = vehicleType === 'phev';

  for (let i = anchorIdx + 1; i < sorted.length; i++) {
    const end = sorted[i];
    if (end.partial) continue;

    const start = sorted[anchorIdx];
    let gasLitersUsed = 0;
    let kWhUsed = 0;
    let gasCost = 0;
    let electricityCost = 0;
    // A missed flag anywhere in this segment means there was an unlogged
    // fuel-up between the previous full entry and this one, so the recorded
    // fuel doesn't cover the full distance. We exclude the whole interval
    // from stats rather than synthesise an unreliable estimate.
    let containsMissed = false;

    for (let j = anchorIdx + 1; j <= i; j++) {
      const e = sorted[j];
      if (e.missed) containsMissed = true;

      if (isEv) {
        // EV: each entry is a charge event. kWhCharged & kWhPrice carry the
        // energy and cost.
        if (e.kWhCharged != null) kWhUsed += e.kWhCharged;
        if (e.totalCost != null) electricityCost += e.totalCost;
      } else {
        // ICE / HEV / PHEV: gas fields carry the gas purchase. Both partials
        // and the closing full entry contribute their gas to this interval.
        if (e.gasLiters != null) gasLitersUsed += e.gasLiters;
        if (e.totalCost != null) gasCost += e.totalCost;
      }
    }

    const distanceKm = end.odometer - start.odometer;
    const hasMeaningfulData = isEv ? kWhUsed > 0 : gasLitersUsed > 0;
    if (distanceKm <= 0 || !hasMeaningfulData || containsMissed) {
      anchorIdx = i;
      continue;
    }

    // PHEV electricity: the CLOSING full entry's phevKwhPer100Km describes
    // the average rate over the whole interval (from the previous full fill
    // to this one). The user reads it off the car's trip computer, reset at
    // each fill-up. Any phev fields on intermediate partial entries are
    // intentionally ignored — partials shouldn't drive a separate electricity
    // rate, since the interval has only one "since previous full" reading.
    if (isPhev && end.phevKwhPer100Km != null) {
      const kWh = (end.phevKwhPer100Km / 100) * distanceKm;
      kWhUsed += kWh;
      if (end.phevKwhPrice != null) {
        electricityCost += kWh * end.phevKwhPrice;
      }
    }

    const kmPerL = gasLitersUsed > 0 ? distanceKm / gasLitersUsed : 0;
    const totalCost = gasCost + electricityCost;
    const kWhPer100Km = kWhUsed > 0 ? (kWhUsed / distanceKm) * 100 : 0;

    // Equivalent km/l: total fuel cost expressed as gas-equivalent litres,
    // distance per those litres. We use the CLOSING entry's own pump price
    // here — the price you actually paid for the gas in this fill-up — so
    // each historical point is anchored to its own cost basis rather than
    // drifting whenever today's gas price changes. Only PHEV mixes fuels;
    // for ICE/HEV equivalent equals gas km/l; for EV there's no gas
    // reference and we leave it at 0.
    let equivalentKmPerL = 0;
    if (isPhev) {
      const pumpPriceForEquivalent = end.gasPricePerLiter ?? 0;
      if (pumpPriceForEquivalent > 0 && totalCost > 0) {
        equivalentKmPerL = distanceKm / (totalCost / pumpPriceForEquivalent);
      }
    } else if (!isEv) {
      equivalentKmPerL = kmPerL;
    }

    const eurPerKm = totalCost > 0 ? totalCost / distanceKm : 0;
    intervals.push({
      fromOdometer: start.odometer,
      toOdometer: end.odometer,
      fromDate: start.date,
      toDate: end.date,
      distanceKm,
      gasLitersUsed,
      kWhUsed,
      gasCost,
      electricityCost,
      totalCost,
      kmPerL,
      kWhPer100Km,
      equivalentKmPerL,
      eurPerKm,
      endEntryId: end.id,
    });

    anchorIdx = i;
  }

  return intervals;
}

/**
 * Dashboard aggregates for a single vehicle. Each average is the simple mean
 * of the per-interval value (each fuel-up contributes equally regardless of
 * distance) — except for gas km/l and kWh/100km, which are physically
 * meaningful as fleet-wide rates and so use the total-fuel-over-total-
 * distance form.
 *
 * "Best" is the interval whose value is most favourable (highest for km/l
 * variants, lowest for kWh/100 km).
 */
export function computeDashboard(
  entries: FuelUp[],
  vehicleType: VehicleType = 'ice',
): DashboardStats {
  const sorted = sortFuelUps(entries);
  if (sorted.length === 0) return emptyDashboard();

  const intervals = computeIntervals(sorted, vehicleType);

  // Tracked km = km for which we actually have a consumption reading
  // (i.e., km that ended up inside a full-to-full interval). This excludes:
  //   - the leading entry (no interval ends at it)
  //   - intervals dropped because they contained a missed fuel-up
  //   - dangling partials at the end of the dataset (waiting for the next
  //     full fill-up to close them)
  // Total cost is summed from the same intervals so the €/km basis is
  // consistent.
  const totalTrackedKm = intervals.reduce((s, iv) => s + iv.distanceKm, 0);
  const totalCostTracked = intervals.reduce((s, iv) => s + iv.totalCost, 0);
  const avgEurPerKm = totalTrackedKm > 0 ? totalCostTracked / totalTrackedKm : null;

  const last = intervals[intervals.length - 1] ?? null;

  // Gas km/l — distance-weighted average (physical fuel-economy rate).
  const intervalsWithGas = intervals.filter((iv) => iv.gasLitersUsed > 0);
  const avgKmPerL =
    intervalsWithGas.length > 0
      ? intervalsWithGas.reduce((s, iv) => s + iv.distanceKm, 0) /
        intervalsWithGas.reduce((s, iv) => s + iv.gasLitersUsed, 0)
      : null;
  const bestGas = pickBest(intervals, (iv) => iv.kmPerL, 'max');

  // Electricity kWh/100km — energy-weighted average; lower is better.
  const intervalsWithKwh = intervals.filter((iv) => iv.kWhUsed > 0);
  const avgKWhPer100Km =
    intervalsWithKwh.length > 0
      ? (intervalsWithKwh.reduce((s, iv) => s + iv.kWhUsed, 0) /
          intervalsWithKwh.reduce((s, iv) => s + iv.distanceKm, 0)) *
        100
      : null;
  const bestElec = pickBest(intervals, (iv) => iv.kWhPer100Km, 'min');

  let lastKWhPer100Km: number | null = null;
  for (let i = intervals.length - 1; i >= 0; i--) {
    if (intervals[i].kWhUsed > 0) {
      lastKWhPer100Km = intervals[i].kWhPer100Km;
      break;
    }
  }

  // Equivalent km/l aggregates over valid intervals only (partials are
  // already rolled into their closing interval; intervals containing a
  // missed flag are absent from `intervals` entirely).
  //
  //   avg = (totalGasCost / totalGasQuantity) / (totalOverallCost / totalKm)
  //       = avgPumpPrice / costPerKm
  //
  //   Reading: "Across all the driving you have a consumption reading for,
  //   you spent your overall energy money at an average cost of X €/km;
  //   converted back into gas litres at the average pump price you paid,
  //   that's Y km per equivalent litre."
  //
  //   For ICE/HEV (no electricity recorded), this falls back to the gas
  //   km/l identity since totalOverallCost == totalGasCost.
  //
  //   best = the single interval with the highest equivalentKmPerL value
  //   (each interval's equivalent uses its OWN closing pump price — chart
  //   points and "best" stay matched).
  let avgEquivalentKmPerL: number | null = null;
  {
    const totalGasCost = intervals.reduce((s, iv) => s + iv.gasCost, 0);
    const totalGasQuantity = intervals.reduce((s, iv) => s + iv.gasLitersUsed, 0);
    // totalCostTracked and totalTrackedKm are already computed above over the
    // same intervals — reuse them so the basis can't drift.
    if (totalGasQuantity > 0 && totalTrackedKm > 0 && totalCostTracked > 0) {
      const avgPumpPrice = totalGasCost / totalGasQuantity;
      const costPerKm = totalCostTracked / totalTrackedKm;
      if (avgPumpPrice > 0 && costPerKm > 0) {
        avgEquivalentKmPerL = avgPumpPrice / costPerKm;
      }
    }
  }
  const bestEquiv = pickBest(intervals, (iv) => iv.equivalentKmPerL, 'max');

  return {
    totalTrackedKm,
    avgEurPerKm,
    lastEurPerKm: last?.eurPerKm ?? null,

    lastKmPerL: last && last.gasLitersUsed > 0 ? last.kmPerL : null,
    avgKmPerL,
    bestKmPerL: bestGas?.kmPerL ?? null,
    bestKmPerLDate: bestGas?.toDate ?? null,

    lastKWhPer100Km,
    avgKWhPer100Km,
    bestKWhPer100Km: bestElec?.kWhPer100Km ?? null,
    bestKWhPer100KmDate: bestElec?.toDate ?? null,

    lastEquivalentKmPerL: last && last.equivalentKmPerL > 0 ? last.equivalentKmPerL : null,
    avgEquivalentKmPerL,
    bestEquivalentKmPerL: bestEquiv?.equivalentKmPerL ?? null,
    bestEquivalentKmPerLDate: bestEquiv?.toDate ?? null,

    intervals,
  };
}

/** Pick the interval whose selector returns the most/least favourable value. */
function pickBest(
  intervals: Interval[],
  selector: (iv: Interval) => number,
  mode: 'min' | 'max',
): Interval | null {
  let best: Interval | null = null;
  let bestVal = mode === 'max' ? -Infinity : Infinity;
  for (const iv of intervals) {
    const v = selector(iv);
    if (v <= 0) continue;
    if ((mode === 'max' && v > bestVal) || (mode === 'min' && v < bestVal)) {
      best = iv;
      bestVal = v;
    }
  }
  return best;
}

function emptyDashboard(): DashboardStats {
  return {
    totalTrackedKm: 0,
    avgEurPerKm: null,
    lastEurPerKm: null,
    lastKmPerL: null,
    avgKmPerL: null,
    bestKmPerL: null,
    bestKmPerLDate: null,
    lastKWhPer100Km: null,
    avgKWhPer100Km: null,
    bestKWhPer100Km: null,
    bestKWhPer100KmDate: null,
    lastEquivalentKmPerL: null,
    avgEquivalentKmPerL: null,
    bestEquivalentKmPerL: null,
    bestEquivalentKmPerLDate: null,
    intervals: [],
  };
}
