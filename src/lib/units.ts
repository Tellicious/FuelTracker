import type { ConsumptionUnit } from '../db/types';

/**
 * Convert an internal km/l number to whatever consumption unit the user has
 * selected for display.
 *
 *   km/l    → km/l    (identity)
 *   l/100km → 100 / km/l
 */
export function toDisplay(kmPerL: number, unit: ConsumptionUnit): number {
  if (unit === 'km/l') return kmPerL;
  return kmPerL > 0 ? 100 / kmPerL : 0;
}

export function displayUnitLabel(unit: ConsumptionUnit): string {
  return unit === 'km/l' ? 'km/l' : 'l/100 km';
}
