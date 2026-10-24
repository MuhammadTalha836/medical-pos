import { describe, expect, it } from 'vitest';
import { priceReturn, priceSaleLine, settleCash, totalSale } from './saleMath';

const panadol = { name: 'Panadol', boxRetailPrice: 120, unitRetailPrice: 12, defaultDiscountPct: 0 };
const cashier = { canDiscount: false, maxBillDiscountPct: 14 };
const admin = { canDiscount: true, maxBillDiscountPct: 14 };

describe('priceSaleLine', () => {
  it('uses the list price for boxes and loose units', () => {
    expect(priceSaleLine(panadol, false, 2, {}, cashier).netAmount).toBe(240);
    expect(priceSaleLine(panadol, true, 5, { unitPrice: 12 }, cashier).netAmount).toBe(60);
  });

  it('refuses a changed rate or a discount without permission', () => {
    expect(() => priceSaleLine(panadol, false, 1, { unitPrice: 1 }, cashier)).toThrow(/rate/);
    expect(() => priceSaleLine(panadol, false, 1, { discountPct: 50 }, cashier)).toThrow(/permission/);
  });

  it('allows the medicine default discount without permission', () => {
    const line = priceSaleLine({ ...panadol, defaultDiscountPct: 5 }, false, 1, { discountPct: 5 }, cashier);
    expect(line.netAmount).toBe(114);
  });

  it('accepts a changed rate and discount with permission', () => {
    const line = priceSaleLine(panadol, false, 2, { unitPrice: 100, discountPct: 10 }, admin);
    expect(line).toMatchObject({ grossAmount: 200, discountAmount: 20, netAmount: 180 });
  });
});

describe('totalSale', () => {
  const lines = [priceSaleLine(panadol, false, 10, {}, admin)];

  it('works out the bill discount from the percentage', () => {
    expect(totalSale(lines, 10, admin)).toMatchObject({ billDiscountAmt: 120, netTotal: 1080 });
  });

  it('caps the bill discount and needs permission', () => {
    expect(() => totalSale(lines, 50, admin)).toThrow(/more than 14%/);
    expect(() => totalSale(lines, 5, cashier)).toThrow(/permission/);
  });
});

describe('settleCash', () => {
  it('treats blank cash as the exact amount', () => {
    expect(settleCash('Cash', 900, 0)).toEqual({ cashTendered: 900, changeDue: 0 });
  });
  it('refuses cash below the total', () => {
    expect(() => settleCash('Cash', 900, 500)).toThrow(/less than/);
  });
  it('gives change', () => {
    expect(settleCash('Cash', 900, 1000)).toEqual({ cashTendered: 1000, changeDue: 100 });
  });
  it('ignores cash for other payment types', () => {
    expect(settleCash('Credit', 900, 5)).toEqual({ cashTendered: 900, changeDue: 0 });
  });
});

describe('priceReturn', () => {
  const sold = [
    { productId: 1, productName: 'Panadol', isLoose: false, quantity: 3, netAmount: 300 },
    { productId: 1, productName: 'Panadol', isLoose: true, quantity: 10, netAmount: 100 }
  ];

  it('refunds what was paid, bill discount included', () => {
    const r = priceReturn(sold, 360, [], [{ productId: 1, isLoose: false, quantity: 1 }]);
    expect(r.totalRefund).toBe(90);
    expect(r.fullyReturned).toBe(false);
  });

  it('keeps boxes and loose units apart', () => {
    const r = priceReturn(sold, 400, [], [{ productId: 1, isLoose: true, quantity: 10 }]);
    expect(r.totalRefund).toBe(100);
    expect(() => priceReturn(sold, 400, [], [{ productId: 1, isLoose: true, quantity: 11 }])).toThrow(/Only 10/);
  });

  it('counts earlier returns and reports a full return', () => {
    const earlier = [{ productId: 1, isLoose: false, quantity: 3 }];
    expect(() => priceReturn(sold, 400, earlier, [{ productId: 1, isLoose: false, quantity: 1 }])).toThrow(/Only 0/);
    expect(priceReturn(sold, 400, earlier, [{ productId: 1, isLoose: true, quantity: 10 }]).fullyReturned).toBe(true);
  });

  it('the last unit takes the rounding remainder', () => {
    const odd = [{ productId: 2, productName: 'X', isLoose: false, quantity: 3, netAmount: 100 }];
    const first = priceReturn(odd, 100, [], [{ productId: 2, isLoose: false, quantity: 2 }]);
    const last = priceReturn(odd, 100, [{ productId: 2, isLoose: false, quantity: 2 }], [{ productId: 2, isLoose: false, quantity: 1 }]);
    expect(round(first.totalRefund + last.totalRefund)).toBe(100);
  });

  it('refuses items that are not on the invoice', () => {
    expect(() => priceReturn(sold, 400, [], [{ productId: 9, isLoose: false, quantity: 1 }])).toThrow(/not on this invoice/);
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
