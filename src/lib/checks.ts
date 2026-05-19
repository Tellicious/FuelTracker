import type { FuelUp, VehicleType } from '../db/types';
import { computeIntervals, sortFuelUps } from './stats';

// One soft warning surfaced to the user. None of these block save — the
// user can review them in a confirm() dialog and proceed if they meant it.
export interface Warning {
  // Field this warning is tied to. The form uses this to render the
  // matching inline help text under that field while the user is typing.
  // 'general' for warnings that don't attach to a specific input.
  field:
    | 'consumption'
    | 'unitPrice'
    | 'odometer'
    | 'date'
    | 'duplicate'
    | 'general';
  message: string;
}

// Input passed to all the check helpers. Captures the candidate entry
// (the fuel-up the user is about to save) and the rest of the vehicle's
// existing entries (excluding the one being edited, if any).
export interface CheckContext {
  candidate: {
    id: string | null;
    date: string;
    odometer: number;
    vehicleType: VehicleType;
    partial: boolean;
    missed: boolean;
    gasLiters: number | null;
    gasPricePerLiter: number | null;
    kWhCharged: number | null;
    kWhPrice: number | null;
    totalCost: number | null;
    phevKwhPer100Km: number | null;
    phevKwhPrice: number | null;
  };
  // Every other fuel-up for this vehicle. The candidate is appended
  // internally for the interval-based checks (A, D) so the same code path
  // computes what the new full-to-full interval looks like.
  otherEntries: FuelUp[];
  thresholds: {
    consumptionPercent: number;
    pricePercent: number;
    distanceMultiplier: number;
    duplicateMinutes: number;
    duplicateKm: number;
  };
}

// Pretty-printing helpers — the warning messages are user-visible so we
// want one decimal place and a "%" suffix on the percent diffs, etc.
function pct(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

// Build the synthetic FuelUp the candidate would become if saved. Used by
// the interval-based checks so they can re-run computeIntervals over the
// would-be future state of the DB.
function candidateAsFuelUp(c: CheckContext['candidate']): FuelUp {
  return {
    id: c.id ?? '__candidate__',
    vehicleId: '__vehicle__',
    date: c.date,
    odometer: c.odometer,
    partial: c.partial,
    missed: c.missed,
    totalCost: c.totalCost,
    notes: null,
    gasLiters: c.gasLiters,
    gasPricePerLiter: c.gasPricePerLiter,
    kWhCharged: c.kWhCharged,
    kWhPrice: c.kWhPrice,
    phevKwhPer100Km: c.phevKwhPer100Km,
    phevKwhPrice: c.phevKwhPrice,
  };
}

// (A) Consumption vs historical average. Recomputes intervals on the
// vehicle as if the candidate were already saved, finds the interval that
// closes AT the candidate (if any), and compares its key consumption
// metric against the average of all OTHER intervals.
//
// Metric picked per vehicle type:
//   ICE / HEV / PHEV-without-electricity → kmPerL
//   EV                                    → kWhPer100Km (inverted comparison: higher = worse)
//   PHEV with electricity                 → equivalentKmPerL
//
// Skipped silently when there's not enough prior history to compare against
// (need at least 2 other valid intervals so the average isn't a single
// outlier) or when the candidate doesn't close a valid interval (e.g.
// partial, missed, or first full fill-up).
export function checkConsumption(ctx: CheckContext): Warning | null {
  const c = ctx.candidate;
  const all = [...ctx.otherEntries.filter((e) => e.id !== c.id), candidateAsFuelUp(c)];
  const intervals = computeIntervals(all, c.vehicleType);
  if (intervals.length < 3) return null;
  // The candidate's interval is the one whose endEntryId matches it.
  const candIdx = intervals.findIndex((iv) => iv.endEntryId === (c.id ?? '__candidate__'));
  if (candIdx < 0) return null;

  const cand = intervals[candIdx];
  const others = intervals.filter((_, i) => i !== candIdx);
  if (others.length < 2) return null;

  // Pick the comparable metric.
  let label: string;
  let candVal: number;
  let avgVal: number;
  // "higher is better" is true for km/l metrics, false for kWh/100km.
  let higherIsBetter = true;

  if (c.vehicleType === 'ev') {
    if (cand.kWhPer100Km <= 0) return null;
    const valid = others.filter((iv) => iv.kWhPer100Km > 0);
    if (valid.length === 0) return null;
    label = 'electricity consumption';
    candVal = cand.kWhPer100Km;
    avgVal = valid.reduce((s, iv) => s + iv.kWhPer100Km, 0) / valid.length;
    higherIsBetter = false;
  } else if (c.vehicleType === 'phev' && cand.equivalentKmPerL > 0 && cand.electricityCost > 0) {
    const valid = others.filter((iv) => iv.equivalentKmPerL > 0);
    if (valid.length === 0) return null;
    label = 'equivalent fuel consumption';
    candVal = cand.equivalentKmPerL;
    avgVal = valid.reduce((s, iv) => s + iv.equivalentKmPerL, 0) / valid.length;
  } else {
    if (cand.kmPerL <= 0) return null;
    const valid = others.filter((iv) => iv.kmPerL > 0);
    if (valid.length === 0) return null;
    label = 'fuel consumption';
    candVal = cand.kmPerL;
    avgVal = valid.reduce((s, iv) => s + iv.kmPerL, 0) / valid.length;
  }

  if (!(avgVal > 0)) return null;
  const deltaPct = ((candVal - avgVal) / avgVal) * 100;
  if (Math.abs(deltaPct) <= ctx.thresholds.consumptionPercent) return null;

  const dir = deltaPct > 0
    ? higherIsBetter ? 'better' : 'worse'
    : higherIsBetter ? 'worse' : 'better';
  return {
    field: 'consumption',
    message: `Calculated ${label} (${round1(candVal)}) is ${pct(deltaPct)} ${
      deltaPct > 0 ? 'above' : 'below'
    } the average (${round1(avgVal)}) — ${dir} than usual.`,
  };
}

// (B) Unit price vs median of the last 5 same-vehicle entries' unit
// prices. Uses median (not mean) so one outlier doesn't poison the
// comparison. Per-vehicle-type: gasPricePerLiter for ICE/HEV/PHEV
// (which is what the user types into the gas form), kWhPrice for EV.
// Skipped when there are fewer than 3 prior prices.
export function checkUnitPrice(ctx: CheckContext): Warning | null {
  const c = ctx.candidate;
  const isEv = c.vehicleType === 'ev';
  const candPrice = isEv ? c.kWhPrice : c.gasPricePerLiter;
  if (candPrice == null || !(candPrice > 0)) return null;

  // Gather the last 5 prior same-type prices, sorted by date desc.
  const sorted = [...ctx.otherEntries]
    .filter((e) => e.id !== c.id && e.date < c.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const prevPrices: number[] = [];
  for (const e of sorted) {
    const p = isEv ? e.kWhPrice : e.gasPricePerLiter;
    if (p != null && p > 0) prevPrices.push(p);
    if (prevPrices.length >= 5) break;
  }
  if (prevPrices.length < 3) return null;

  // Median of the gathered prices.
  const sortedAsc = [...prevPrices].sort((a, b) => a - b);
  const mid = Math.floor(sortedAsc.length / 2);
  const median = sortedAsc.length % 2 === 1
    ? sortedAsc[mid]
    : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
  if (!(median > 0)) return null;

  const deltaPct = ((candPrice - median) / median) * 100;
  if (Math.abs(deltaPct) <= ctx.thresholds.pricePercent) return null;

  const unit = isEv ? '/kWh' : '/l';
  return {
    field: 'unitPrice',
    message: `Unit price (${candPrice.toFixed(3)}${unit}) is ${pct(deltaPct)} ${
      deltaPct > 0 ? 'above' : 'below'
    } the recent median (${median.toFixed(3)}${unit}) — possible typo.`,
  };
}

// (D) Distance plausibility: warn if the new odometer would create a gap
// larger than `distanceMultiplier × averageIntervalKm`. Average is taken
// over ALL valid existing intervals for this vehicle. Skipped if there
// are fewer than 3 valid intervals to draw an average from — not enough
// signal to know what's normal yet.
export function checkDistance(ctx: CheckContext): Warning | null {
  const c = ctx.candidate;
  // Find the previous entry (by date) for the vehicle. This matches the
  // previousOdometer logic in AddEntry so warnings line up with the value
  // shown on screen.
  const prev = [...ctx.otherEntries]
    .filter((e) => e.id !== c.id && e.date <= c.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .at(-1);
  if (!prev) return null;
  const gap = c.odometer - prev.odometer;
  if (gap <= 0) return null;

  const intervals = computeIntervals(
    ctx.otherEntries.filter((e) => e.id !== c.id),
    c.vehicleType,
  );
  const valid = intervals.filter((iv) => iv.distanceKm > 0);
  if (valid.length < 3) return null;
  const avgKm = valid.reduce((s, iv) => s + iv.distanceKm, 0) / valid.length;
  const threshold = avgKm * ctx.thresholds.distanceMultiplier;
  if (gap <= threshold) return null;

  return {
    field: 'odometer',
    message: `Distance since previous entry (${Math.round(gap).toLocaleString()} km) is more than ${
      ctx.thresholds.distanceMultiplier
    }× the average interval (${Math.round(avgKm).toLocaleString()} km) — possible odometer typo.`,
  };
}

// (E) Date order: warn if the new entry's date is BEFORE the most recent
// existing entry for this vehicle. This catches the mistake of forgetting
// to update the date when re-using a previous template, or accidentally
// typing the wrong month.
export function checkDateOrder(ctx: CheckContext): Warning | null {
  const c = ctx.candidate;
  const others = ctx.otherEntries.filter((e) => e.id !== c.id);
  if (others.length === 0) return null;
  const latest = others.reduce((max, e) => (e.date > max.date ? e : max), others[0]);
  if (c.date >= latest.date) return null;
  return {
    field: 'date',
    message: `Entry date is earlier than the most recent existing entry (${new Date(
      latest.date,
    ).toLocaleDateString()}) — check the date.`,
  };
}

// (H) Duplicate detection: another entry for the same vehicle within
// ±N minutes of the candidate's date AND within ±N km on the odometer.
// Both conditions must hold — that way a legitimate same-day fill-up at
// a different odometer doesn't trip it.
export function checkDuplicate(ctx: CheckContext): Warning | null {
  const c = ctx.candidate;
  const candT = new Date(c.date).getTime();
  if (!isFinite(candT)) return null;
  const minutesMs = ctx.thresholds.duplicateMinutes * 60 * 1000;

  for (const e of ctx.otherEntries) {
    if (e.id === c.id) continue;
    const t = new Date(e.date).getTime();
    if (!isFinite(t)) continue;
    if (Math.abs(t - candT) > minutesMs) continue;
    if (Math.abs(e.odometer - c.odometer) > ctx.thresholds.duplicateKm) continue;
    return {
      field: 'duplicate',
      message: `Another entry exists within ${ctx.thresholds.duplicateMinutes} min and ${ctx.thresholds.duplicateKm} km — possible duplicate.`,
    };
  }
  return null;
}

// Run every check and return the warnings that fired. The caller decides
// how to present them (inline help + save-time confirm dialog).
export function runAllChecks(ctx: CheckContext): Warning[] {
  const out: Warning[] = [];
  const a = checkConsumption(ctx);
  if (a) out.push(a);
  const b = checkUnitPrice(ctx);
  if (b) out.push(b);
  const d = checkDistance(ctx);
  if (d) out.push(d);
  const e = checkDateOrder(ctx);
  if (e) out.push(e);
  const h = checkDuplicate(ctx);
  if (h) out.push(h);
  return out;
}

// Sorted-by-date utility for callers that want to inspect the
// chronological position of the candidate among existing entries.
// (Re-exports sortFuelUps for convenience.)
export { sortFuelUps };
