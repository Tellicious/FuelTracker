

export type DeriveField = 'amount' | 'unitPrice' | 'totalCost';

export interface DeriveValues {
  amount: number | null;
  unitPrice: number | null;
  totalCost: number | null;
}

export interface DeriveResult {
  amount: number;
  unitPrice: number;
  totalCost: number;

  derivedField: DeriveField;
}

const ALL_FIELDS: DeriveField[] = ['amount', 'unitPrice', 'totalCost'];

// Round to a fixed number of decimal places. Used to keep derived values
// looking clean (3 decimals for unit price, 2 for total cost, etc.).
function round(n: number, places: number): number {
  const m = 10 ** places;
  return Math.round(n * m) / m;
}

// Given two of the three values (amount × unitPrice = totalCost), compute
// the third. Returns null if any required input is missing or zero
// (zero would make some divisions infinite or undefined).
function computeFrom(
  target: DeriveField,
  v: DeriveValues,
): DeriveResult | null {
  if (target === 'totalCost') {
    if (v.amount == null || v.unitPrice == null) return null;
    return {
      amount: v.amount,
      unitPrice: v.unitPrice,
      totalCost: round(v.amount * v.unitPrice, 2),
      derivedField: 'totalCost',
    };
  }
  if (target === 'amount') {
    if (v.totalCost == null || v.unitPrice == null || v.unitPrice === 0) return null;
    return {
      amount: round(v.totalCost / v.unitPrice, 3),
      unitPrice: v.unitPrice,
      totalCost: v.totalCost,
      derivedField: 'amount',
    };
  }

  if (v.totalCost == null || v.amount == null || v.amount === 0) return null;
  return {
    amount: v.amount,
    unitPrice: round(v.totalCost / v.amount, 3),
    totalCost: v.totalCost,
    derivedField: 'unitPrice',
  };
}

// 2-of-3 reconciliation for the (amount, unitPrice, totalCost) triplet.
// When exactly two fields are filled, derives the third. When all three are
// filled, derives whichever the user touched LEAST recently — `lastTouched`
// is a stack of the most-recently-edited fields, so the field not in the
// top two is the one we recalculate. Returns null when fewer than two
// fields are filled (caller should leave the form alone).
export function reconcile(
  v: DeriveValues,
  lastTouched: DeriveField[],
): DeriveResult | null {
  const isFilled = {
    amount: v.amount != null && v.amount > 0,
    unitPrice: v.unitPrice != null && v.unitPrice > 0,
    totalCost: v.totalCost != null && v.totalCost > 0,
  };
  const filledCount = (Object.values(isFilled) as boolean[]).filter(Boolean).length;

  if (filledCount === 2) {
    const target = ALL_FIELDS.find((f) => !isFilled[f])!;
    return computeFrom(target, v);
  }
  if (filledCount === 3) {
    const top2 = lastTouched.slice(0, 2);
    const target = ALL_FIELDS.find((f) => !top2.includes(f)) ?? ALL_FIELDS[2];
    return computeFrom(target, v);
  }
  return null;
}
