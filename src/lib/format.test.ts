import { describe, expect, it } from 'vitest';
import { fmtMoney, fromInputDateTime } from './format';

describe('fromInputDateTime', () => {
  it('converts a datetime-local value to an ISO timestamp', () => {
    const iso = fromInputDateTime('2026-05-14T10:30');
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getTime()).toBe(new Date('2026-05-14T10:30').getTime());
  });

  it('returns null for an empty value instead of throwing', () => {
    // Regression: clearing the iOS date picker passed '' here and
    // new Date('').toISOString() threw a RangeError.
    expect(fromInputDateTime('')).toBeNull();
  });

  it('returns null for an unparseable value', () => {
    expect(fromInputDateTime('not a date')).toBeNull();
  });
});

describe('fmtMoney', () => {
  it('follows the locale for symbol position and separators', () => {
    expect(fmtMoney(63.2, 'EUR', 2, 'it-IT')).toBe('63,20\u00A0€');
    expect(fmtMoney(63.2, 'EUR', 2, 'en-GB')).toBe('€63.20');
    expect(fmtMoney(0.118, 'USD', 3, 'it-IT')).toBe('0,118\u00A0$');
  });

  it('honours the requested number of decimals', () => {
    expect(fmtMoney(1234.5, 'EUR', 0, 'en-GB')).toBe('€1,235');
  });

  it('returns a dash for missing or non-finite values', () => {
    expect(fmtMoney(null, 'EUR')).toBe('—');
    expect(fmtMoney(Infinity, 'EUR')).toBe('—');
  });

  it('falls back to symbol + nbsp + number when Intl rejects the currency', () => {
    expect(fmtMoney(5, 'EURO', 2, 'en-GB')).toBe('EURO\u00A05.00');
  });
});
