import { describe, expect, it } from 'vitest';
import { activeDays, computeDayClose, inputForDay, type DatedDayInput, type DayCloseInput } from './dayCloseMath';

const empty: DayCloseInput = {
  sales: [], saleItems: [], returns: [], returnItems: [], expenses: [], customerPayments: [], supplierPaid: 0, shifts: []
};

describe('computeDayClose', () => {
  it('a split bill counts each part in its own bucket (C4)', () => {
    const f = computeDayClose({ ...empty, sales: [{ netTotal: 500, paymentType: 'Split', paidCash: 200, paidCard: 100, paidCredit: 200 }, { netTotal: 50, paymentType: 'Cash' }] });
    expect(f.salesTotal).toBe(550);
    expect(f.salesCash).toBe(250);
    expect(f.salesCard).toBe(100);
    expect(f.salesCredit).toBe(200);
  });

  it('splits sales by payment and takes returns and their cost back', () => {
    const d = computeDayClose({
      ...empty,
      sales: [
        { netTotal: 1000, paymentType: 'Cash' },
        { netTotal: 400, paymentType: 'Online' },
        { netTotal: 250, paymentType: 'Card' },
        { netTotal: 600, paymentType: 'Credit' }
      ],
      saleItems: [{ quantity: 2, unitCost: 300 }, { quantity: 10, unitCost: 50 }, { quantity: 1, unitCost: 400 }],
      returns: [{ refundAmount: 150 }],
      returnItems: [{ quantity: 1, unitCost: 100 }]
    });
    expect(d.invoicesCount).toBe(4);
    expect(d.salesTotal).toBe(2250);
    expect(d.salesCash).toBe(1000);
    expect(d.salesCard).toBe(650);
    expect(d.salesCredit).toBe(600);
    expect(d.returnsTotal).toBe(150);
    expect(d.netSales).toBe(2100);
    expect(d.costOfGoods).toBe(600 + 500 + 400 - 100);
    expect(d.grossProfit).toBe(2100 - 1400);
  });

  it('takes every expense off the profit and lists them by category', () => {
    const d = computeDayClose({
      ...empty,
      sales: [{ netTotal: 5000, paymentType: 'Cash' }],
      saleItems: [{ quantity: 1, unitCost: 3000 }],
      expenses: [
        { category: 'Tea & Refreshments', amount: 120, paymentMethod: 'cash' },
        { category: 'Electricity', amount: 900, paymentMethod: 'bank' },
        { category: 'Tea & Refreshments', amount: 80, paymentMethod: 'cash' }
      ]
    });
    expect(d.expensesTotal).toBe(1100);
    expect(d.expensesCash).toBe(200);
    expect(d.expensesByCategory).toEqual([
      { category: 'Electricity', amount: 900, count: 1 },
      { category: 'Tea & Refreshments', amount: 200, count: 2 }
    ]);
    expect(d.netProfit).toBe(5000 - 3000 - 1100);
  });

  it('adds up the shifts; counted cash and difference come from closed shifts only', () => {
    const d = computeDayClose({
      ...empty,
      customerPayments: [{ amount: 300, paymentMethod: 'cash' }, { amount: 700, paymentMethod: 'online' }],
      supplierPaid: 2500,
      shifts: [
        { status: 'closed', openingCash: 1000, expectedCash: 4000, closingCash: 3950 },
        { status: 'open', openingCash: 500, expectedCash: 900, closingCash: null }
      ]
    });
    expect(d.customerPaymentsCash).toBe(300);
    expect(d.supplierPaid).toBe(2500);
    expect(d.shifts).toEqual({ count: 2, openCount: 1, openingCash: 1500, expectedCash: 4900, countedCash: 3950, difference: -50 });
  });

  it('an empty day is all zeros', () => {
    const d = computeDayClose(empty);
    expect(d.netProfit).toBe(0);
    expect(d.expensesByCategory).toEqual([]);
    expect(d.shifts.difference).toBe(0);
  });
});

describe('period by day', () => {
  const rows: DatedDayInput = {
    sales: [
      { day: '2026-10-24', netTotal: 1000, paymentType: 'Cash', items: [{ quantity: 1, unitCost: 600 }] },
      { day: '2026-10-25', netTotal: 500, paymentType: 'Credit', items: [{ quantity: 2, unitCost: 100 }] }
    ],
    returns: [{ day: '2026-10-25', refundAmount: 200, items: [{ quantity: 1, unitCost: 120 }] }],
    expenses: [{ day: '2026-10-24', category: 'Rent', amount: 100, paymentMethod: 'bank' }],
    customerPayments: [{ day: '2026-10-23', amount: 50, paymentMethod: 'cash' }],
    supplierPayments: [{ day: '2026-10-25', amount: 300 }],
    shifts: []
  };

  it('lists the active days newest first', () => {
    expect(activeDays(rows)).toEqual(['2026-10-25', '2026-10-24', '2026-10-23']);
  });

  it('splits rows by day, and the period totals equal the sum of the days', () => {
    const day24 = computeDayClose(inputForDay(rows, '2026-10-24'));
    expect(day24.netProfit).toBe(1000 - 600 - 100);
    const day25 = computeDayClose(inputForDay(rows, '2026-10-25'));
    expect(day25.netProfit).toBe(500 - 200 - (200 - 120));
    expect(day25.supplierPaid).toBe(300);
    const total = computeDayClose(inputForDay(rows));
    const days = activeDays(rows).map(d => computeDayClose(inputForDay(rows, d)));
    expect(total.netProfit).toBe(days.reduce((s, d) => s + d.netProfit, 0));
    expect(total.customerPaymentsCash).toBe(50);
  });
});
