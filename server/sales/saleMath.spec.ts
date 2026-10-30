import { describe, expect, it } from 'vitest';
import { checkSplit, priceReturn, priceSaleLine, refundTenders, roundOff, settleCash, tenderSplit, totalSale } from './saleMath';

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

describe('round-off (C1)', () => {
  it('rounds to the nearest step and reports what was added', () => {
    expect(roundOff(198, 10)).toEqual({ netTotal: 200, roundOff: 2 });
    expect(roundOff(196, 5)).toEqual({ netTotal: 195, roundOff: -1 });
    expect(roundOff(197.6, 1)).toEqual({ netTotal: 198, roundOff: 0.4 });
    expect(roundOff(203, 10)).toEqual({ netTotal: 200, roundOff: -3 });
  });

  it('is off for 0, unknown steps and empty bills', () => {
    expect(roundOff(198.4, 0)).toEqual({ netTotal: 198.4, roundOff: 0 });
    expect(roundOff(198.4, 3)).toEqual({ netTotal: 198.4, roundOff: 0 });
    expect(roundOff(0, 10)).toEqual({ netTotal: 0, roundOff: 0 });
  });

  it('a bill rounded up refunds the rounded amount on a full return', () => {
    const sold = [{ productId: 1, productName: 'A', isLoose: false, quantity: 2, netAmount: 198 }];
    expect(priceReturn(sold, 200, [], [{ productId: 1, isLoose: false, quantity: 2 }]).totalRefund).toBe(200);
  });
});

describe('tenders and split payment (C4)', () => {
  it('older bills count wholly in their one payment type', () => {
    expect(tenderSplit({ paymentType: 'Cash', netTotal: 100 })).toEqual({ cash: 100, card: 0, credit: 0 });
    expect(tenderSplit({ paymentType: 'Online', netTotal: 100 })).toEqual({ cash: 0, card: 100, credit: 0 });
    expect(tenderSplit({ paymentType: 'Credit', netTotal: 100, paidCash: 0, paidCard: 0, paidCredit: 0 })).toEqual({ cash: 0, card: 0, credit: 100 });
    expect(tenderSplit({ paymentType: 'Split', netTotal: 100, paidCash: 60, paidCard: 0, paidCredit: 40 })).toEqual({ cash: 60, card: 0, credit: 40 });
  });

  it('a split must use two parts and add up to the bill', () => {
    expect(checkSplit(500, { cash: 200, card: '100', credit: 200 })).toEqual({ cash: 200, card: 100, credit: 200 });
    expect(() => checkSplit(500, { cash: 500 })).toThrow(/at least two parts/);
    expect(() => checkSplit(500, { cash: 200, credit: 200 })).toThrow(/add up to 400.00/);
    expect(() => checkSplit(500, { cash: -1, credit: 501 })).toThrow(/negative/);
  });

  it('a split refund lowers the khata part first, then pays cash', () => {
    const sale = { paymentType: 'Split', netTotal: 500, paidCash: 300, paidCard: 0, paidCredit: 200 };
    expect(refundTenders(sale, 0, 150)).toEqual({ cash: 0, credit: 150 });
    expect(refundTenders(sale, 150, 100)).toEqual({ cash: 50, credit: 50 });
    expect(refundTenders(sale, 250, 250)).toEqual({ cash: 250, credit: 0 });
  });

  it('single-type refunds keep their old rule', () => {
    expect(refundTenders({ paymentType: 'Cash', netTotal: 100 }, 0, 40)).toEqual({ cash: 40, credit: 0 });
    expect(refundTenders({ paymentType: 'Card', netTotal: 100 }, 0, 40)).toEqual({ cash: 0, credit: 0 });
    expect(refundTenders({ paymentType: 'Credit', netTotal: 100 }, 0, 40)).toEqual({ cash: 0, credit: 40 });
  });
});
