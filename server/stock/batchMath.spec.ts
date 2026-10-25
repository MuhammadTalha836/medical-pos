import { describe, expect, it } from 'vitest';
import { allocate, fefoOrder, fromUnits, reconcile, toUnits } from './batchMath';

const today = '2026-10-25';
const b = (id: number, expiryDate: string, units: number) => ({ id, expiryDate, units });

describe('units', () => {
  it('converts between units and boxes + loose', () => {
    expect(toUnits(2, 3, 10)).toBe(23);
    expect(fromUnits(23, 10)).toEqual({ boxes: 2, loose: 3 });
  });
});

describe('fefoOrder', () => {
  it('uses the earliest valid expiry first, undated next, expired last', () => {
    const order = fefoOrder([b(1, '', 5), b(2, '2027-06-01', 5), b(3, '2026-01-01', 5), b(4, '2026-12-01', 5)], today);
    expect(order.map(x => x.id)).toEqual([4, 2, 1, 3]);
  });
});

describe('allocate', () => {
  it('splits across batches by expiry', () => {
    const r = allocate([b(1, '2027-01-01', 10), b(2, '2026-12-01', 4)], 7, today, false);
    expect(r).toEqual({ ok: true, allocations: [{ batchId: 2, units: 4 }, { batchId: 1, units: 3 }] });
  });

  it('never sells expired stock and says how much is expired', () => {
    const r = allocate([b(1, '2026-01-01', 10), b(2, '2027-01-01', 3)], 5, today, false);
    expect(r).toEqual({ ok: false, available: 3, expiredUnits: 10 });
  });

  it('can take expired stock when allowed (returns to supplier)', () => {
    const r = allocate([b(1, '2026-01-01', 10)], 5, today, true);
    expect(r.ok && r.allocations).toEqual([{ batchId: 1, units: 5 }]);
  });
});

describe('reconcile', () => {
  it('puts uncovered stock in the opening batch', () => {
    expect(reconcile([b(1, '2027-01-01', 5)], 12)).toEqual({ openingUnits: 7, trims: [] });
  });

  it('trims extra batch stock by earliest expiry, expired included (older stock sold first)', () => {
    expect(reconcile([b(1, '2027-01-01', 10), b(2, '2026-01-01', 10), b(3, '', 5)], 12).trims)
      .toEqual([{ batchId: 2, units: 10 }, { batchId: 1, units: 3 }]);
  });

  it('does nothing when they already match', () => {
    expect(reconcile([b(1, '', 5)], 5)).toEqual({ openingUnits: 0, trims: [] });
  });
});
