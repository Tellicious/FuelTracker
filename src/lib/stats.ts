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
  // IDs of every entry that contributed to this interval (anchor + every
  // entry from anchor+1 to closer, inclusive). Used by computeDashboard
  // to count how many fill-ups participated in the valid intervals.
  entryIds: string[];
}

export interface DashboardStats {
  totalTrackedKm: number;
  avgEurPerKm: number | null;
  lastEurPerKm: number | null;

  // Count of distinct entries that participated in any valid interval.
  // Kept coherent with totalTrackedKm — only entries inside non-skipped
  // intervals count. The "Fill-ups" / "Charges" pill on the Dashboard.
  totalRefuels: number;

  // Sum of gas + electricity spend across the same set of entries used
  // for totalTrackedKm, plus the PHEV-imputed electricity cost from
  // valid intervals (PHEV electricity isn't a separate entry).
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

  // Count of distinct entries that participated in any valid interval.
  // Anchors are shared between consecutive intervals — the Set collapses
  // those naturally so each fill-up is counted once.
  const usedEntryIds = new Set<string>();
  for (const iv of intervals) {
    for (const id of iv.entryIds) usedEntryIds.add(id);
  }
  const totalRefuels = usedEntryIds.size;

  // Sum the receipt costs of the entries that participated in valid
  // intervals (this naturally includes the very first anchor's cost,
  // which doesn't appear in any interval.totalCost). For PHEV, add the
  // imputed electricity cost on top — that's not stored on any entry, it
  // comes from interval.electricityCost. For ICE/HEV electricity is
  // always 0; for EV the entries already store electricity as totalCost,
  // so adding interval.electricityCost would double-count.
  const usedEntries = entries.filter((e) => usedEntryIds.has(e.id));
  const sumOfEntryCosts = usedEntries.reduce(
    (s, e) => s + (e.totalCost ?? 0),
    0,
  );
  const phevImputedElectricity =
    vehicleType === 'phev'
      ? intervals.reduce((s, iv) => s + iv.electricityCost, 0)
      : 0;
  const totalCost = sumOfEntryCosts + phevImputedElectricity;

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