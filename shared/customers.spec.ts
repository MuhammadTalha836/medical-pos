import { describe, expect, it } from 'vitest';
import { isCounterCustomer, isValidPhone, normalizePhone } from './customers';

describe('customer rules', () => {
  it('compares phones by digits only', () => {
    expect(normalizePhone('0300-123 4567')).toBe('03001234567');
    expect(normalizePhone('+92 (300) 1234567')).toBe('923001234567');
    expect(normalizePhone(null)).toBe('');
  });

  it('accepts 7 to 15 digit phones', () => {
    expect(isValidPhone('0300-1234567')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
    expect(isValidPhone('1234567890123456')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });

  it('treats an empty or default name as the walk-in customer', () => {
    expect(isCounterCustomer('')).toBe(true);
    expect(isCounterCustomer('  counter customer ')).toBe(true);
    expect(isCounterCustomer('Ali')).toBe(false);
  });
});
