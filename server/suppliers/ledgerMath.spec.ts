import { describe, expect, it } from 'vitest';
import { buildSupplierLedger, paidAtPurchase, statusFor } from './ledgerMath';

const purchase = (id: number, date: string, netTotal: number, paid = 0) =>
  ({ id, invoiceNo: `PUR-${id}`, supplierInvoiceNo: null, date, netTotal, paidAtPurchase: paid });
const payment = (id: number, date: string, amount: number) =>
  ({ id, date, amount, method: 'cash', reference: null, notes: null });

describe('paidAtPurchase', () => {
  it('counts Paid rows as fully paid and caps partial amounts', () => {
    expect(paidAtPurchase('Paid', 500, 0)).toBe(500);
    expect(paidAtPurchase('Partial', 500, 200)).toBe(200);
    expect(paidAtPurchase('Pending', 500, 900)).toBe(500);
  });
});

describe('statusFor', () => {
  it('derives the status from what was settled', () => {
    expect(statusFor(100, 100)).toBe('Paid');
    expect(statusFor(100, 40)).toBe('Partial');
    expect(statusFor(100, 0)).toBe('Pending');
  });
});

describe('buildSupplierLedger', () => {
  it('works out the balance and settles the oldest purchase first', () => {
    const ledger = buildSupplierLedger(
      [purchase(2, '2026-10-05', 300), purchase(1, '2026-10-01', 1000, 200)],
      [payment(1, '2026-10-06', 900)],
      []
    );
    expect(ledger.totals).toEqual({ purchased: 1300, paid: 1100, returned: 0, balance: 200 });
    expect(ledger.dues.map(d => [d.invoiceNo, d.status, d.due])).toEqual([['PUR-1', 'Paid', 0], ['PUR-2', 'Partial', 200]]);
  });

  it('keeps a running balance in date order', () => {
    const ledger = buildSupplierLedger(
      [purchase(1, '2026-10-01', 1000)],
      [payment(1, '2026-10-02', 400)],
      [{ id: 1, returnNo: 'PR-1', date: '2026-10-03', amount: 100 }]
    );
    expect(ledger.entries.map(e => e.balance)).toEqual([1000, 600, 500]);
    expect(ledger.totals.balance).toBe(500);
  });
});
