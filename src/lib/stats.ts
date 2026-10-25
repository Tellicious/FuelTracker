import type { FuelUp, VehicleType } from '../db/types';

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
  // IDs of every entry in this interval: the anchor first, then every
  // entry from anchor+1 to the closer, inclusive. computeDashboard counts
  // entryIds.slice(1) — the fill-ups whose fuel was used in this interval.
  entryIds: string[];
}

export interface DashboardStats {
  totalTrackedKm: number;
  avgEurPerKm: number | null;
  lastEurPerKm: number | null;

  // Count of fill-ups whose fuel/energy was used within tracked distance:
  // for every valid interval, the entries after its anchor up to and
  // including its closer. Anchors are excluded (their fuel covered
  // distance before tracking started), so N back-to-back full fill-ups
  // give N-1 intervals and N-1 fill-ups. The "Fill-ups" / "Charges" pill.
  totalRefuels: number;

  // Spend over the tracked distance: Σ interval.totalCost (gas receipts
  // plus electricity — EV receipts, or PHEV-imputed electricity). Same
  // basis as avgEurPerKm, so totalCost / totalTrackedKm === avgEurPerKm.
  totalCost: number;

  // totalTrackedKm / totalRefuels, or null when totalRefuels === 0.
  // The "Avg km / fill-up" pill on the Dashboard.
  avgKmPerRefuel: number | null;

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

export function sortFuelUps(entries: FuelUp[]): FuelUp[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.odometer - b.odometer;
  });
}

// PHEV electricity used over the interval sorted[from] → sorted[to].
// The car's trip computer resets at every refuel, partial ones included,
// so each entry's phevKwhPer100Km is the average over the stretch since
// the PREVIOUS entry, and its phevKwhPrice prices that stretch. The
// interval's electricity is the sum over its stretches. (Applying the
// closing entry's reading to the whole interval, as before, was wrong
// whenever a partial fill-up split it: that reading only covers the last
// stretch.)
// Gaps: a stretch without a reading uses the distance-weighted average of
// the interval's readings; a stretch without a price uses the
// energy-weighted average of the interval's prices. With no reading at
// all the interval has no electricity; with no price at all, no
// electricity cost.
function phevElectricity(
  sorted: FuelUp[],
  from: number,
  to: number,
): { kWh: number; cost: number } {
  const stretches: { km: number; rate: number | null; price: number | null }[] = [];
  for (let j = from + 1; j <= to; j++) {
    stretches.push({
      km: Math.max(0, sorted[j].odometer - sorted[j - 1].odometer),
      rate: sorted[j].phevKwhPer100Km,
      price: sorted[j].phevKwhPrice,
    });
  }

  let ratedKm = 0;
  let ratedKwh = 0;
  for (const s of stretches) {
    if (s.rate == null) continue;
    ratedKm += s.km;
    ratedKwh += (s.rate / 100) * s.km;
  }
  if (ratedKm <= 0) return { kWh: 0, cost: 0 };
  const avgRate = (ratedKwh / ratedKm) * 100;

  const energy = stretches.map((s) => ((s.rate ?? avgRate) / 100) * s.km);

  let pricedKwh = 0;
  let pricedCost = 0;
  stretches.forEach((s, k) => {
    if (s.price == null) return;
    pricedKwh += energy[k];
    pricedCost += energy[k] * s.price;
  });
  const avgPrice = pricedKwh > 0 ? pricedCost / pricedKwh : null;

  let kWh = 0;
  let cost = 0;
  stretches.forEach((s, k) => {
    kWh += energy[k];
    const price = s.price ?? avgPrice;
    if (price != null) cost += energy[k] * price;
  });
  return { kWh, cost };
}

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
    let containsMissed = false;

    for (let j = anchorIdx + 1; j <= i; j++) {
      const e = sorted[j];
      if (e.missed) containsMissed = true;
      if (isEv) {
        if (e.kWhCharged != null) kWhUsed += e.kWhCharged;
        if (e.totalCost != null) electricityCost += e.totalCost;
      } else {
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

    if (isPhev) {
      const electricity = phevElectricity(sorted, anchorIdx, i);
      kWhUsed += electricity.kWh;
      electricityCost += electricity.cost;
    }

    const kmPerL = gasLitersUsed > 0 ? distanceKm / gasLitersUsed : 0;
    const totalCost = gasCost + electricityCost;
    const kWhPer100Km = kWhUsed > 0 ? (kWhUsed / distanceKm) * 100 : 0;

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
      entryIds: sorted.slice(anchorIdx, i + 1).map((e) => e.id),
    });

    anchorIdx = i;
  }

  return intervals;
}

export function computeDashboard(
  entries: FuelUp[],
  vehicleType: VehicleType = 'ice',
): DashboardStats {
  const sorted = sortFuelUps(entries);
  if (sorted.length === 0) return emptyDashboard();

  const intervals = computeIntervals(sorted, vehicleType);

  const totalTrackedKm = intervals.reduce((s, iv) => s + iv.distanceKm, 0);
  const totalCostTracked = intervals.reduce((s, iv) => s + iv.totalCost, 0);
  const avgEurPerKm = totalTrackedKm > 0 ? totalCostTracked / totalTrackedKm : null;

  // Fill-ups whose fuel was used within the tracked distance: every entry
  // after an interval's anchor, up to and including its closer. The
  // anchor is excluded — its fuel covered distance before the interval
  // started. (Counting anchors made "Avg km / fill-up" read 300 for two
  // fills 600 km apart, and added the anchor's receipt to Total cost.)
  const usedEntryIds = new Set<string>();
  for (const iv of intervals) {
    for (const id of iv.entryIds.slice(1)) usedEntryIds.add(id);
  }
  const totalRefuels = usedEntryIds.size;

  // Same costs as avgEurPerKm, so Total cost ÷ Tracked km = Avg €/km.
  // interval.totalCost already holds gas receipts plus electricity (EV
  // receipts, or the PHEV imputed amount), so nothing is double-counted.
  const totalCost = totalCostTracked;

  const avgKmPerRefuel = totalRefuels > 0 ? totalTrackedKm / totalRefuels : null;

  const last = intervals[intervals.length - 1] ?? null;

  const intervalsWithGas = intervals.filter((iv) => iv.gasLitersUsed > 0);
  const avgKmPerL =
    intervalsWithGas.length > 0
      ? intervalsWithGas.reduce((s, iv) => s + iv.distanceKm, 0) /
        intervalsWithGas.reduce((s, iv) => s + iv.gasLitersUsed, 0)
      : null;
  const bestGas = pickBest(intervals, (iv) => iv.kmPerL, 'max');

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

  let avgEquivalentKmPerL: number | null = null;
  {
    const totalGasCost = intervals.reduce((s, iv) => s + iv.gasCost, 0);
    const totalGasQuantity = intervals.reduce((s, iv) => s + iv.gasLitersUsed, 0);
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
    totalRefuels,
    totalCost,
    avgKmPerRefuel,
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
    totalRefuels: 0,
    totalCost: 0,
    avgKmPerRefuel: null,
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

// Centered moving average over a numeric series. Nulls remain null in the
// output (so gaps in data don't get filled in), but a value's window still
// includes any non-null neighbors that fall within ±half. The default
// window is 5, which feels right for fuel-economy traces (smooths out the
// jitter from individual fill-ups without erasing real trends). Used by
// the LineChart smoothing toggle.
export function smoothSeries(
  values: (number | null)[],
  window = 5,
): (number | null)[] {
  const half = Math.floor(window / 2);
  return values.map((v, i) => {
    if (v == null) return null;
    let sum = 0;
    let n = 0;
    for (let j = -half; j <= half; j++) {
      const k = i + j;
      if (k < 0 || k >= values.length) continue;
      const x = values[k];
      if (x == null) continue;
      sum += x;
      n += 1;
    }
    return n > 0 ? sum / n : v;
  });
}