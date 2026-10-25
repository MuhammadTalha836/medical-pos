import { describe, expect, it } from 'vitest';
import { genericKey, rankSubstitutes } from './generic';

describe('genericKey', () => {
  it('ignores case, spacing and ingredient order', () => {
    expect(genericKey('Paracetamol + Caffeine')).toBe(genericKey('  caffeine+PARACETAMOL '));
    expect(genericKey('Amoxicillin and Clavulanic Acid')).toBe(genericKey('Clavulanic acid, Amoxicillin'));
    expect(genericKey('Paracetamol 500 mg')).toBe(genericKey('paracetamol 500mg'));
    expect(genericKey('Paracetamol 120 mg / 5 ml')).toBe(genericKey('paracetamol 120mg/5ml'));
  });

  it('keeps strengths apart and gives an empty key for no formula', () => {
    expect(genericKey('Paracetamol 500mg')).not.toBe(genericKey('Paracetamol 650mg'));
    expect(genericKey('')).toBe('');
    expect(genericKey(null)).toBe('');
  });
});

describe('rankSubstitutes', () => {
  const target = { id: 1, name: 'Panadol', generic_name: 'Paracetamol', unit_type: 'Tablets', packing: 10, stock_boxes: 0, stock_loose: 0 };
  const med = (id: number, name: string, extra: Record<string, unknown> = {}) =>
    ({ id, name, generic_name: 'paracetamol', unit_type: 'Tablets', packing: 10, stock_boxes: 1, stock_loose: 0, status: 'active', ...extra });

  it('keeps only other active medicines with the same formula', () => {
    const list = [med(1, 'Panadol'), med(2, 'Calpol'), med(3, 'Old', { status: 'inactive' }), med(4, 'Brufen', { generic_name: 'Ibuprofen' })];
    expect(rankSubstitutes(target, list).map(m => m.id)).toEqual([2]);
  });

  it('puts in-stock first, then same unit, then more stock, then name', () => {
    const list = [
      med(2, 'Out', { stock_boxes: 0 }),
      med(3, 'Syrup', { unit_type: 'Syrup', stock_boxes: 9 }),
      med(4, 'Bravo', { stock_boxes: 2 }),
      med(5, 'Alpha', { stock_boxes: 2 }),
      med(6, 'Big', { stock_boxes: 5 })
    ];
    expect(rankSubstitutes(target, list).map(m => m.name)).toEqual(['Big', 'Alpha', 'Bravo', 'Syrup', 'Out']);
  });

  it('finds nothing when the medicine has no formula', () => {
    expect(rankSubstitutes({ ...target, generic_name: '' }, [med(2, 'Calpol')])).toEqual([]);
  });
});
