import { describe, expect, it } from 'vitest';
import { customerStatement, isCounterCustomer, isValidPhone, normalizePhone } from './customers';

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

describe('customerStatement', () => {
  const sales = [
    { invoice_no: 'INV-1', sale_date: '2026-10-01T10:00:00.000Z', net_total: 1000, payment_type: 'Credit' },
    { invoice_no: 'INV-2', sale_date: '2026-10-02T10:00:00.000Z', net_total: 300, payment_type: 'Cash' },
    { invoice_no: 'INV-3', sale_date: '2026-10-05T10:00:00.000Z', net_total: 500, payment_type: 'Credit' }
  ];
  const returns = [{ return_no: 'RET-1', invoice_no: 'INV-1', created_at: '2026-10-03T10:00:00.000Z', refund_amount: 200 }];
  const payments = [{ payment_date: '2026-10-04T10:00:00.000Z', amount: 400, payment_method: 'Cash', notes: null }];

  it('lists credit bills, returns and payments in date order with a running balance', () => {
    const s = customerStatement(sales, returns, payments, 900);
    expect(s.entries.map(e => e.kind)).toEqual(['bill', 'return', 'payment', 'bill']);
    expect(s.entries.map(e => e.balance)).toEqual([1000, 800, 400, 900]);
    expect(s.totals).toEqual({ billed: 1500, paid: 400, returned: 200, balance: 900 });
  });

  it('adds an opening line when the entries do not explain the saved balance', () => {
    const s = customerStatement(sales, returns, payments, 1150);
    expect(s.entries[0]).toMatchObject({ kind: 'opening', debit: 250, balance: 250 });
    expect(s.entries[s.entries.length - 1].balance).toBe(1150);
  });

  it('ignores cash bills and is empty for a customer without khata', () => {
    expect(customerStatement([sales[1]], [], [], 0).entries).toEqual([]);
  });
});
