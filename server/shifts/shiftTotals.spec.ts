import { describe, expect, it } from 'vitest';
import { computeShiftTotals } from './shiftTotals';

describe('computeShiftTotals', () => {
  it('only cash refunds leave the drawer', () => {
    const t = computeShiftTotals(
      1000,
      [{ netTotal: 500, paymentType: 'Cash' }, { netTotal: 2000, paymentType: 'Credit' }, { netTotal: 300, paymentType: 'Online' }],
      [{ refundAmount: 2000, originalPaymentType: 'Credit' }, { refundAmount: 100, originalPaymentType: 'Cash' }],
      [{ amount: 250, paymentMethod: 'cash' }, { amount: 50, paymentMethod: 'card' }]
    );
    expect(t.expectedCash).toBe(1000 + 500 + 250 - 100);
    expect(t.totalReturnsCash).toBe(100);
    expect(t.totalCardSales).toBe(300);
    expect(t.totalSalesAmount).toBe(2800);
  });

  it('a return without an invoice counts as cash', () => {
    expect(computeShiftTotals(0, [], [{ refundAmount: 40, originalPaymentType: null }], []).expectedCash).toBe(-40);
  });

  it('cash expenses leave the drawer; bank and online ones do not', () => {
    const t = computeShiftTotals(1000, [{ netTotal: 800, paymentType: 'Cash' }], [], [], [
      { amount: 150, paymentMethod: 'cash' },
      { amount: 5000, paymentMethod: 'bank' },
      { amount: 70, paymentMethod: 'online' }
    ]);
    expect(t.totalExpensesCash).toBe(150);
    expect(t.expectedCash).toBe(1000 + 800 - 150);
  });

  it('split bills, stored cash refunds and cash pay-in/out (C4)', () => {
    const t = computeShiftTotals(
      1000,
      [{ netTotal: 500, paymentType: 'Split', paidCash: 300, paidCard: 100, paidCredit: 100 }, { netTotal: 200, paymentType: 'Cash' }],
      [{ refundAmount: 150, refundCash: 50, originalPaymentType: 'Split' }, { refundAmount: 20, refundCash: null, originalPaymentType: 'Cash' }],
      [],
      [],
      [{ direction: 'in', amount: 500 }, { direction: 'out', amount: 300 }]
    );
    expect(t.totalCashSales).toBe(500);
    expect(t.totalCardSales).toBe(100);
    expect(t.totalCreditSales).toBe(100);
    expect(t.totalReturnsCash).toBe(70);
    expect(t.totalCashIn).toBe(500);
    expect(t.totalCashOut).toBe(300);
    expect(t.expectedCash).toBe(1000 + 500 - 70 + 500 - 300);
  });
});
