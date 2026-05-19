import type { ConsumptionUnit, FuelUp, RecordField, VehicleType } from '../db/types';
import { fmtMoney, fmtNumber } from './format';
import type { Interval } from './stats';
import { displayUnitLabel, toDisplay } from './units';

// Catalog of every field the user can pick for the Records-screen rows.
// Each entry knows its label, a one-line description for the picker, and
// — most importantly — a `compute` function that turns a (FuelUp, closing
// Interval | null) pair into the displayed string. Returning null from
// compute renders as "—" in the row, which is the right thing to do when
// the entry isn't a closing-full-fill-up (no interval yet) or the metric
// doesn't apply to this particular entry.
//
// Consumption-style fields always read from `interval`, which the caller
// computes via the same `computeIntervals` function the Dashboard uses.
// This guarantees the numbers on Records exactly match the dots on the
// Dashboard chart — there is no second derivation path that could drift.
export interface RecordFieldDef {
  key: RecordField;
  label: string;        // shown in the picker
  shortLabel: string;   // shown under each row (more compact)
  // Compute the display string given the entry and (if it closes a valid
  // interval) the interval that ends at it. Returns null to render "—".
  compute(
    entry: FuelUp,
    interval: Interval | null,
    ctx: { vehicleType: VehicleType; currency: string; consumptionUnit: ConsumptionUnit },
  ): string | null;
}

// Decimal formatting for unit price (€/l, €/kWh): 3 dp because pump prices
// like 1.847 are normal. fmtMoney handles currency symbol + nbsp.
function fmtUnitPriceMoney(v: number | null, currency: string): string | null {
  if (v == null || !isFinite(v) || v <= 0) return null;
  return fmtMoney(v, currency, 3);
}

// Render a km/l value through the user's display-unit preference (km/l
// stays as-is; l/100km is the reciprocal × 100). Mirrors Dashboard's
// fmtConsumption helper so the displayed numbers and labels match.
function fmtConsumptionFromKmPerL(
  kmPerL: number | null,
  consumptionUnit: ConsumptionUnit,
): string | null {
  if (kmPerL == null || !isFinite(kmPerL) || kmPerL <= 0) return null;
  return `${fmtNumber(toDisplay(kmPerL, consumptionUnit), 1)} ${displayUnitLabel(consumptionUnit)}`;
}

export const RECORD_FIELDS: Record<RecordField, RecordFieldDef> = {
  refuelCost: {
    key: 'refuelCost',
    label: 'Refuel cost',
    shortLabel: 'Refuel cost',
    compute(entry, _interval, { currency }) {
      if (entry.totalCost == null) return null;
      return fmtMoney(entry.totalCost, currency, 2);
    },
  },

  refuelQuantity: {
    key: 'refuelQuantity',
    label: 'Refuel quantity',
    shortLabel: 'Refuel qty',
    compute(entry, _interval, { vehicleType }) {
      // EV stores volume as kWhCharged; everything else as gasLiters.
      if (vehicleType === 'ev') {
        if (entry.kWhCharged == null) return null;
        return `${fmtNumber(entry.kWhCharged, 2)} kWh`;
      }
      if (entry.gasLiters == null) return null;
      return `${fmtNumber(entry.gasLiters, 2)} l`;
    },
  },

  unitPrice: {
    key: 'unitPrice',
    label: 'Unit price (€/l or €/kWh)',
    shortLabel: 'Unit price',
    compute(entry, _interval, { vehicleType, currency }) {
      const sym = currency;
      const isEv = vehicleType === 'ev';
      const v = isEv ? entry.kWhPrice : entry.gasPricePerLiter;
      const formatted = fmtUnitPriceMoney(v, sym);
      if (formatted == null) return null;
      return `${formatted}/${isEv ? 'kWh' : 'l'}`;
    },
  },

  avgFuelConsumption: {
    key: 'avgFuelConsumption',
    label: 'Avg. fuel consumption',
    shortLabel: 'Avg fuel',
    compute(_entry, interval, { vehicleType, consumptionUnit }) {
      // Gas km/l only — meaningless on EVs.
      if (vehicleType === 'ev') return null;
      if (interval == null) return null;
      if (interval.gasLitersUsed <= 0) return null;
      return fmtConsumptionFromKmPerL(interval.kmPerL, consumptionUnit);
    },
  },

  avgEquivalentFuelConsumption: {
    key: 'avgEquivalentFuelConsumption',
    label: 'Avg. equivalent fuel consumption',
    shortLabel: 'Avg equiv',
    compute(_entry, interval, { vehicleType, consumptionUnit }) {
      // PHEV-only metric (it's the cost-equivalent km/l blending gas +
      // electricity costs at the closing pump price). For ICE/HEV the
      // equivalent reduces to plain km/l so we could show it, but the
      // user explicitly wanted this option hidden outside PHEV — see the
      // allowed-fields-per-type map below.
      if (vehicleType !== 'phev') return null;
      if (interval == null) return null;
      if (!(interval.equivalentKmPerL > 0)) return null;
      return fmtConsumptionFromKmPerL(interval.equivalentKmPerL, consumptionUnit);
    },
  },

  avgElectricityConsumption: {
    key: 'avgElectricityConsumption',
    label: 'Avg. electricity consumption',
    shortLabel: 'Avg elec',
    compute(_entry, interval, { vehicleType }) {
      if (vehicleType !== 'phev' && vehicleType !== 'ev') return null;
      if (interval == null) return null;
      if (interval.kWhUsed <= 0) return null;
      return `${fmtNumber(interval.kWhPer100Km, 1)} kWh/100km`;
    },
  },

  electricityCost: {
    key: 'electricityCost',
    label: 'Electricity cost',
    shortLabel: 'Elec cost',
    compute(entry, interval, { vehicleType, currency }) {
      // For an EV every entry IS an electricity purchase, so use the
      // entry's totalCost directly even when no interval exists yet.
      if (vehicleType === 'ev') {
        if (entry.totalCost == null) return null;
        return fmtMoney(entry.totalCost, currency, 2);
      }
      // For PHEV electricity cost is derived from
      // phevKwhPer100Km × interval distance × phevKwhPrice, which is
      // computed inside the interval. It only exists at a closing full
      // fill-up with valid phev electricity data.
      if (vehicleType === 'phev') {
        if (interval == null) return null;
        if (!(interval.electricityCost > 0)) return null;
        return fmtMoney(interval.electricityCost, currency, 2);
      }
      // ICE / HEV: no electricity cost.
      return null;
    },
  },
};

// Which RecordField keys are offered to the user per vehicle type. The
// picker filters its options through this map AND the Settings reader
// uses it to coerce stored configs back into the allowed set when a
// vehicle's type changes (or when a config imported from another phone
// has a now-disallowed combination).
export const ALLOWED_FIELDS_BY_TYPE: Record<VehicleType, readonly RecordField[]> = {
  ice: ['refuelCost', 'refuelQuantity', 'unitPrice', 'avgFuelConsumption'],
  hybrid: ['refuelCost', 'refuelQuantity', 'unitPrice', 'avgFuelConsumption'],
  phev: [
    'refuelCost',
    'refuelQuantity',
    'unitPrice',
    'avgFuelConsumption',
    'avgEquivalentFuelConsumption',
    'avgElectricityConsumption',
    'electricityCost',
  ],
  ev: [
    'refuelCost',
    'refuelQuantity',
    'unitPrice',
    'avgElectricityConsumption',
    'electricityCost',
  ],
};

// Walk through a stored field tuple and replace any entries that aren't
// allowed for this vehicle type with the first allowed default. Keeps the
// tuple exactly 3 fields long so the row layout is always stable.
export function sanitizeRecordFields(
  fields: readonly RecordField[],
  vehicleType: VehicleType,
  defaults: readonly RecordField[],
): [RecordField, RecordField, RecordField] {
  const allowed = ALLOWED_FIELDS_BY_TYPE[vehicleType];
  const isAllowed = (f: RecordField) => allowed.includes(f);

  const out: RecordField[] = [];
  for (let i = 0; i < 3; i++) {
    const candidate = fields[i];
    if (candidate != null && isAllowed(candidate)) {
      out.push(candidate);
    } else {
      // Fall back to the default for that slot if it's allowed, otherwise
      // to the first allowed field overall.
      const dflt = defaults[i];
      out.push(dflt != null && isAllowed(dflt) ? dflt : allowed[0]);
    }
  }
  return [out[0], out[1], out[2]];
}
