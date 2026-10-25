import { describe, expect, it } from 'vitest';
import { fromInputDateTime } from './format';

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
