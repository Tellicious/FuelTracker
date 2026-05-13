import type { ConsumptionUnit } from '../db/types';

// Convert an internal km/l value to whichever unit the user has chosen for
// display. We always store + compute in km/l internally because it's the
// unit of the underlying physical relation (distance ÷ fuel). l/100 km is
// just the reciprocal scaled by 100 — easy to derive at the edge.
export function toDisplay(kmPerL: number, unit: ConsumptionUnit): number {
  if (unit === 'km/l') return kmPerL;
  return kmPerL > 0 ? 100 / kmPerL : 0;
}

// Human-readable label for the user's chosen display unit. Used in chart
// axis titles, table headers, and tooltip rows.
export function displayUnitLabel(unit: ConsumptionUnit): string {
  return unit === 'km/l' ? 'km/l' : 'l/100 km';
}
