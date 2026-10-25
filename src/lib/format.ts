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

// Format a number as a currency value following the user's locale: symbol
// position, spacing and separators come from Intl ("63,20 €" in it-IT,
// "€63.20" in en-GB). narrowSymbol keeps "$" rather than "US$". Where a
// locale puts a space between amount and symbol, Intl uses a non-breaking
// one, so values still don't wrap mid-amount in narrow containers like the
// dashboard KPI columns. Formatters are cached because Records renders
// several amounts per row. If Intl rejects the currency code or the
// narrowSymbol option (older engines), falls back to the previous
// "symbol + nbsp + number" form. `locale` is a parameter for tests.
const moneyFormatters = new Map<string, Intl.NumberFormat | null>();

function moneyFormatter(locale: string, currency: string, decimals: number): Intl.NumberFormat | null {
  const key = `${locale}|${currency}|${decimals}`;
  if (!moneyFormatters.has(key)) {
    let f: Intl.NumberFormat | null;
    try {
      f = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    } catch {
      f = null;
    }
    moneyFormatters.set(key, f);
  }
  return moneyFormatters.get(key) ?? null;
}

export function fmtMoney(
  n: number | null | undefined,
  currency: string,
  decimals = 2,
  locale: string = userLocale,
): string {
  if (n == null || !isFinite(n)) return '—';
  const f = moneyFormatter(locale, currency, decimals);
  if (f) return f.format(n);
  const sym = CURRENCY_SYMBOL[currency] ?? currency;
  return sym + '\u00A0' + n.toLocaleString(locale, {
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

// Parse a date string from an import file and normalise it to the
// canonical stored form (Date.toISOString(), UTC with milliseconds), so
// entries sort correctly by plain string comparison. Only ISO 8601 is
// accepted: YYYY-MM-DD, optionally followed by T or space and HH:MM[:SS[.sss]]
// and an optional Z or ±HH:MM offset. Date-only and offset-less values are
// read as local time (same as the entry form's date picker). Returns null
// for anything else — including locale formats such as 14/05/2026, which
// are ambiguous (dd/mm vs mm/dd) and which JS engines parse inconsistently —
// and for impossible days such as 2026-02-30 (which engines silently roll
// over to March).
const ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function parseIsoDate(raw: string): string | null {
  const m = ISO_DATE_RE.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  const normalised = m[4] === undefined ? `${m[0].trim()}T00:00` : raw.trim().replace(' ', 'T');
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
// as local time; new Date() interprets it that way. Returns null for an
// empty or unparseable value (e.g. the user tapped "Clear" in the iOS
// picker) — new Date('').toISOString() would throw a RangeError.
export function fromInputDateTime(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
