import { describe, expect, it } from 'vitest';
import { reconcile } from './derive';

describe('reconcile (2-of-3 cost fields)', () => {
  it('derives the empty field when exactly two are filled', () => {
    const r = reconcile(
      { amount: 30, unitPrice: 1.85, totalCost: null },
      ['unitPrice', 'amount'],
    );
    expect(r?.derivedField).toBe('totalCost');
    expect(r?.totalCost).toBeCloseTo(55.5, 2);
  });

  it('derives amount when total + unitPrice are given', () => {
    const r = reconcile(
      { amount: null, unitPrice: 1.85, totalCost: 74 },
      ['totalCost', 'unitPrice'],
    );
    expect(r?.derivedField).toBe('amount');
    expect(r?.amount).toBeCloseTo(40, 2);
  });

  it('derives unitPrice when total + amount are given', () => {
    const r = reconcile(
      { amount: 40, unitPrice: null, totalCost: 74 },
      ['amount', 'totalCost'],
    );
    expect(r?.derivedField).toBe('unitPrice');
    expect(r?.unitPrice).toBeCloseTo(1.85, 2);
  });

  it('re-derives the oldest-touched field when all three are filled', () => {


    let r = reconcile(
      { amount: 30, unitPrice: 1.85, totalCost: 60 },
      ['totalCost', 'unitPrice', 'amount'],
    );
    expect(r?.derivedField).toBe('amount');
    expect(r?.amount).toBeCloseTo(60 / 1.85, 3);


    r = reconcile(
      { amount: 35, unitPrice: 1.85, totalCost: 60 },
      ['amount', 'totalCost', 'unitPrice'],
    );
    expect(r?.derivedField).toBe('unitPrice');
    expect(r?.unitPrice).toBeCloseTo(60 / 35, 3);
  });

  it('keeps stored values untouched when all three are filled and nothing was touched', () => {
    // Regression: an entry saved as 35.12 l / 63.20 total had its price
    // derived and rounded to 1.8. Re-opening it for editing used to
    // re-derive liters as 63.20 / 1.8 = 35.111, silently changing the
    // stored amount on the next save.
    const r = reconcile({ amount: 35.12, unitPrice: 1.8, totalCost: 63.2 }, []);
    expect(r?.derivedField).toBeNull();
    expect(r?.amount).toBe(35.12);
    expect(r?.unitPrice).toBe(1.8);
    expect(r?.totalCost).toBe(63.2);
  });

  it('returns null when fewer than 2 fields are filled', () => {
    expect(
      reconcile({ amount: 30, unitPrice: null, totalCost: null }, ['amount']),
    ).toBeNull();
    expect(
      reconcile({ amount: null, unitPrice: null, totalCost: null }, []),
    ).toBeNull();
  });
});
