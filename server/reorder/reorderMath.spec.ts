import { describe, expect, it } from 'vitest';
import { clampCoverDays, suggestReorder } from './reorderMath';

const med = (overrides: Partial<{ packing: number; stockBoxes: number; stockLoose: number; minStockAlert: number }> = {}) =>
  ({ packing: 10, stockBoxes: 3, stockLoose: 0, minStockAlert: 10, ...overrides });

describe('suggestReorder', () => {
  it('orders up to twice the minimum when at or below it', () => {
    const s = suggestReorder(med(), 0, 7);
    expect(s?.reason).toBe('below_minimum');
    expect(s?.suggestedBoxes).toBe(17);
  });

  it('counts loose units and rounds up', () => {
    // 3.5 boxes on the shelf: 20 - 3.5 = 16.5 -> 17
    expect(suggestReorder(med({ stockLoose: 5 }), 0, 7)?.suggestedBoxes).toBe(17);
  });

  it('orders by sales speed when stock runs out before the cover days', () => {
    // 300 units in 30 days = 10/day; 50 units last 5 days < 7; need 70 - 50 = 20 units = 2 boxes
    const s = suggestReorder(med({ stockBoxes: 5, minStockAlert: 0 }), 300, 7);
    expect(s?.reason).toBe('running_out');
    expect(s?.daysLeft).toBe(5);
    expect(s?.suggestedBoxes).toBe(2);
  });

  it('more cover days means a bigger order', () => {
    expect(suggestReorder(med({ stockBoxes: 5, minStockAlert: 0 }), 300, 30)?.suggestedBoxes).toBe(25);
  });

  it('leaves well-stocked medicines out', () => {
    expect(suggestReorder(med({ stockBoxes: 50 }), 30, 7)).toBeNull();
  });

  it('leaves out a medicine with no minimum and no sales', () => {
    expect(suggestReorder(med({ stockBoxes: 0, minStockAlert: 0 }), 0, 7)).toBeNull();
  });
});

describe('clampCoverDays', () => {
  it('keeps cover days within 1-60 and falls back on bad input', () => {
    expect(clampCoverDays('abc', 7)).toBe(7);
    expect(clampCoverDays(500, 7)).toBe(60);
    expect(clampCoverDays(15, 7)).toBe(15);
  });
});
