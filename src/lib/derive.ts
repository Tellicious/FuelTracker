/**
 * Two-of-three reconciliation for the cost-entry form.
 *
 * The form has three numeric inputs:
 *   - `amount`     — physical quantity purchased: litres of gas, or kWh charged
 *   - `unitPrice`  — price per unit: €/l, or €/kWh
 *   - `totalCost`  — total paid: €
 *
 * They're related by `totalCost = amount × unitPrice`. The user is expected to
 * fill any two; we derive the third. If they fill all three (e.g. overwriting
 * a previously-derived value), we re-derive whichever was least-recently
 * touched.
 *
 * These names are deliberately vehicle-type-agnostic — the same logic works
 * for both gas refuelling and EV charging.
 */

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
  /** Which field was computed (vs. taken straight from input). */
  derivedField: DeriveField;
}

const ALL_FIELDS: DeriveField[] = ['amount', 'unitPrice', 'totalCost'];

function round(n: number, places: number): number {
  const m = 10 ** places;
  return Math.round(n * m) / m;
}

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
  // unitPrice
  if (v.totalCost == null || v.amount == null || v.amount === 0) return null;
  return {
    amount: v.amount,
    unitPrice: round(v.totalCost / v.amount, 3),
    totalCost: v.totalCost,
    derivedField: 'unitPrice',
  };
}

/**
 * Resolve the form values according to the rules above.
 *
 *   - exactly 1 field empty → derive it from the other two
 *   - all 3 filled         → re-derive the field NOT in the top 2 of
 *                             `lastTouched` (least-recently-touched wins)
 *   - 0 or only 1 filled   → returns null (can't derive anything)
 *
 * `lastTouched` is most-recent first.
 */
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
