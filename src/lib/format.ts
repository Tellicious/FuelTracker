import { CURRENCY_SYMBOL } from '../db/types';

// Resolved at module load. Wrapped in try/catch because some runtimes
// (older WebViews) throw on navigator.language access.
const userLocale = (() => {
  try {
    return navigator.language || 'en-GB';
  } catch {
    return 'en-GB';
  }
})();

// Map an ISO currency code (EUR, USD, GBP) to its display symbol. Falls
// back to the code itself if no mapping is defined.
export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? currency;
}

// Format a number with locale-correct thousands + decimal separators, fixed
// fraction digits. Returns "—" for null/undefined/Infinity/NaN.
export function fmtNumber(n: number | null | undefined, decimals = 2): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString(userLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Parse a user-typed decimal string accepting either "." or "," as the
// decimal separator (for iPhone keyboards in comma-locale countries where
// the keypad shows a comma). Returns NaN on unparseable input.
export function parseDecimalInput(v: string): number {
  return parseFloat((v || '').trim().replace(',', '.'));
}

// Format a number as a locale-correct integer with thousands separators.
// Used for odometer readings and km tracking totals.
export function fmtInt(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return Math.round(n).toLocaleString(userLocale);
}

// Format a number as a currency value. The non-breaking space between the
// symbol and the digits keeps "€ 0.118" from wrapping mid-value in narrow
// containers like the dashboard KPI columns.
export function fmtMoney(n: number | null | undefined, currency: string, decimals = 2): string {
  if (n == null || !isFinite(n)) return '—';
  const sym = CURRENCY_SYMBOL[currency] ?? currency;
  return sym + '\u00A0' + n.toLocaleString(userLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Format an ISO date as a long-form locale-aware string (e.g. "14 May 2026"
// in en-GB, "14 mag 2026" in it-IT). Falls back to the raw ISO string if
// the date is unparseable.
export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(userLocale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  } catch {
    return iso;
  }
}

// Format an ISO date as a year-less short form ("14 May"). Used in compact
// list rows where the year is implied by context.
export function fmtDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(userLocale, {
      month: 'short',
      day: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ISO 8601 timestamp for a Date (defaults to now). Used for storing fuel-up
// dates in the DB so they're tz-portable.
export function isoDate(d: Date = new Date()): string {
  return d.toISOString();
}

// Convert a stored ISO timestamp to the local-time string format expected
// by <input type="datetime-local"> ("YYYY-MM-DDTHH:MM"). The browser then
// renders its native date+time picker against this seeded value.
export function toInputDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert the local-time string returned by <input type="datetime-local">
// back to a tz-aware ISO timestamp for storage. The input value is treated
// as local time; new Date() interprets it that way.
export function fromInputDateTime(local: string): string {
  return new Date(local).toISOString();
}
