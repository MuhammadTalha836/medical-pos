import { describe, expect, it } from 'vitest';
import { lineCostRate, pricePurchaseReturn, type ReturnProduct, type ReturnPurchaseLine } from './returnMath';

const product = (id: number, overrides: Partial<ReturnProduct> = {}): ReturnProduct =>
  ({ id, name: `Med ${id}`, companyId: 1, stockBoxes: 10, boxTradePrice: 90, ...overrides });
const purchaseLine = (id: number, overrides: Partial<ReturnPurchaseLine> = {}): ReturnPurchaseLine =>
  ({ id, purchaseCompanyId: 1, productId: 1, quantityBoxes: 5, bonusBoxes: 1, boxCostPrice: 100, discountPct: 10, batchNo: 'B1', returnedBoxes: 0, ...overrides });

const products = new Map([[1, product(1)], [2, product(2, { companyId: 2 })]]);

describe('lineCostRate', () => {
  it('takes the line discount off the box cost', () => {
    expect(lineCostRate({ boxCostPrice: 100, discountPct: 10 })).toBe(90);
  });
});

describe('pricePurchaseReturn', () => {
  it('credits a purchase line at its cost after discount and keeps its batch', () => {
    const r = pricePurchaseReturn(1, [{ productId: 1, quantityBoxes: 2, purchaseItemId: 7 }], products, new Map([[7, purchaseLine(7)]]));
    expect(r.totalCredit).toBe(180);
    expect(r.lines[0].batchNo).toBe('B1');
  });

  it('credits unlinked stock at the trade price', () => {
    expect(pricePurchaseReturn(1, [{ productId: 1, quantityBoxes: 3 }], products, new Map()).totalCredit).toBe(270);
  });

  it('refuses more than is left on the purchase line (bonus included, earlier returns counted)', () => {
    const lines = new Map([[7, purchaseLine(7, { returnedBoxes: 4 })]]);
    expect(() => pricePurchaseReturn(1, [{ productId: 1, quantityBoxes: 3, purchaseItemId: 7 }], products, lines)).toThrow(/Only 2/);
  });

  it('refuses more than the stock, across lines of the same medicine', () => {
    expect(() => pricePurchaseReturn(1, [{ productId: 1, quantityBoxes: 6 }, { productId: 1, quantityBoxes: 5 }], products, new Map())).toThrow(/Only 4/);
  });

  it('refuses another supplier\'s medicine or purchase', () => {
    expect(() => pricePurchaseReturn(1, [{ productId: 2, quantityBoxes: 1 }], products, new Map())).toThrow(/not supplied/);
    const other = new Map([[7, purchaseLine(7, { purchaseCompanyId: 3 })]]);
    expect(() => pricePurchaseReturn(1, [{ productId: 1, quantityBoxes: 1, purchaseItemId: 7 }], products, other)).toThrow(/another supplier/);
  });

  it('refuses fractions and empty returns', () => {
    expect(() => pricePurchaseReturn(1, [{ productId: 1, quantityBoxes: 1.5 }], products, new Map())).toThrow(/whole boxes/);
    expect(() => pricePurchaseReturn(1, [], products, new Map())).toThrow(/at least one/);
  });
});
