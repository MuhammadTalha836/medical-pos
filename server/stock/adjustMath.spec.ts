import { describe, expect, it } from 'vitest';
import { adjustmentError, adjustmentTotals, adjustmentValue, applyCountLine, countDelta, unitCost } from './adjustMath';
import { unitsText } from '../../shared/stockAdjust';

describe('stock count', () => {
  it('the difference is counted minus system', () => {
    expect(countDelta(50, 47)).toBe(-3);
    expect(countDelta(10, 12)).toBe(2);
  });

  it('applying keeps sales made after the line was counted', () => {
    // Counted 47 when the system had 50 (3 missing), then 5 more were sold before Apply
    expect(applyCountLine(45, 50, 47)).toBe(42);
    expect(applyCountLine(50, 50, 50)).toBe(50);
  });

  it('never goes below zero', () => {
    expect(applyCountLine(1, 10, 0)).toBe(0);
  });
});

describe('single adjustment', () => {
  it('checks the direction of each reason', () => {
    expect(adjustmentError('damaged', -2, 10)).toBeNull();
    expect(adjustmentError('damaged', 2, 10)).toMatch(/only lower/);
    expect(adjustmentError('found', -1, 10)).toMatch(/only add/);
    expect(adjustmentError('found', 4, 10)).toBeNull();
    expect(adjustmentError('correction', -3, 10)).toBeNull();
    expect(adjustmentError('correction', 3, 10)).toBeNull();
  });

  it('refuses zero, fractions and going below zero', () => {
    expect(adjustmentError('correction', 0, 10)).toMatch(/how much/);
    expect(adjustmentError('correction', 1.5, 10)).toMatch(/how much/);
    expect(adjustmentError('lost', -11, 10)).toMatch(/below zero/);
    expect(adjustmentError('lost', -10, 10)).toBeNull();
  });
});

describe('value at cost', () => {
  it('shares the box trade price over the packing', () => {
    expect(unitCost(300, 10)).toBe(30);
    expect(unitCost(100, 0)).toBe(100);
    expect(adjustmentValue(-3, 30)).toBe(-90);
  });

  it('adds up losses and gains', () => {
    expect(adjustmentTotals([{ deltaUnits: -3, unitCost: 30 }, { deltaUnits: 2, unitCost: 10 }, { deltaUnits: -1, unitCost: 5 }])).toEqual({
      count: 3, lossUnits: 4, gainUnits: 2, lossValue: 95, gainValue: 20, netValue: -75
    });
  });

  it('writes units as boxes and loose', () => {
    expect(unitsText(23, 10, 'Tablets')).toBe('2 box(es) + 3 Tablets');
    expect(unitsText(-20, 10)).toBe('-2 box(es)');
    expect(unitsText(5, 1, 'Bottles')).toBe('5 Bottles');
  });
});
