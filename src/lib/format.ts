import { CURRENCY_SYMBOL } from '../db/types';

const userLocale = (() => {
  try {
    return navigator.language || 'en-GB';
  } catch {
    return 'en-GB';
  }
})();

/** Return the bare symbol for a currency code (€ / $ / £, fallback: code itself). */
export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? currency;
}

export function fmtNumber(n: number | null | undefined, decimals = 2): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString(userLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Parse a user-typed decimal string accepting either `.` or `,` as the
 * decimal separator. Returns NaN for unparseable input (caller should
 * guard with isNaN / Number.isFinite). Designed for iPhone keyboards in
 * locales where the comma is the decimal key — `parseFloat("0,30")` would
 * stop at the comma and return 0, which is the bug this helper exists to
 * prevent.
 */
export function parseDecimalInput(v: string): number {
  return parseFloat((v || '').trim().replace(',', '.'));
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return Math.round(n).toLocaleString(userLocale);
}

export function fmtMoney(n: number | null | undefined, currency: string, decimals = 2): string {
  if (n == null || !isFinite(n)) return '—';
  const sym = CURRENCY_SYMBOL[currency] ?? currency;
  // Non-breaking space between symbol and number so the value never wraps
  // mid-token in narrow containers (e.g. the 3-column KPI grid on iPhone).
  return sym + '\u00A0' + n.toLocaleString(userLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

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

export function isoDate(d: Date = new Date()): string {
  // ISO datetime, second precision
  return d.toISOString();
}

export function toInputDateTime(iso: string): string {
  // Format expected by <input type="datetime-local"> (no timezone, local time)
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInputDateTime(local: string): string {
  // Treat as local time and emit ISO
  return new Date(local).toISOString();
}
