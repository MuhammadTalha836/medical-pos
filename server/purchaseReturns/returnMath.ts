// Returns to a supplier (purchase returns, expiry claims). Pure: checks every line and works out the credit.
// No database imports (unit-tested).

import { round2 } from '../suppliers/ledgerMath';

export interface ReturnProduct {
  id: number;
  name: string;
  companyId: number | null;
  stockBoxes: number;
  /** Current trade price per box: the credit rate for stock not linked to a purchase line */
  boxTradePrice: number;
}

export interface ReturnPurchaseLine {
  id: number;
  purchaseCompanyId: number;
  productId: number;
  quantityBoxes: number;
  bonusBoxes: number;
  boxCostPrice: number;
  discountPct: number;
  batchNo: string;
  /** Boxes of this line already sent back */
  returnedBoxes: number;
}

export interface ReturnRequestLine {
  productId: number;
  quantityBoxes: number;
  purchaseItemId?: number | null;
  batchNo?: string | null;
}

export interface PricedReturnLine {
  productId: number;
  productName: string;
  purchaseItemId: number | null;
  batchNo: string | null;
  quantityBoxes: number;
  rate: number;
  credit: number;
}

/** Credit rate of a purchase line: its box cost after the line discount */
export const lineCostRate = (line: Pick<ReturnPurchaseLine, 'boxCostPrice' | 'discountPct'>) =>
  round2(line.boxCostPrice * (1 - (line.discountPct || 0) / 100));

export function pricePurchaseReturn(
  companyId: number,
  requested: ReturnRequestLine[],
  products: Map<number, ReturnProduct>,
  purchaseLines: Map<number, ReturnPurchaseLine>
): { lines: PricedReturnLine[]; totalCredit: number } {
  if (requested.length === 0) throw new Error('Add at least one medicine to return.');
  const stockLeft = new Map<number, number>();
  const lineLeft = new Map<number, number>();

  const lines = requested.map(req => {
    const product = products.get(req.productId);
    if (!product) throw new Error(`Medicine #${req.productId} was not found.`);
    if (!Number.isInteger(req.quantityBoxes) || req.quantityBoxes < 1) {
      throw new Error(`Enter whole boxes (at least 1) for "${product.name}".`);
    }

    let rate: number;
    let batchNo = req.batchNo?.trim() || null;
    const purchaseItemId = req.purchaseItemId ?? null;
    if (purchaseItemId !== null) {
      const line = purchaseLines.get(purchaseItemId);
      if (!line || line.productId !== product.id) throw new Error(`"${product.name}" is not on the chosen purchase.`);
      if (line.purchaseCompanyId !== companyId) throw new Error('The chosen purchase belongs to another supplier.');
      const left = lineLeft.get(line.id) ?? line.quantityBoxes + line.bonusBoxes - line.returnedBoxes;
      if (req.quantityBoxes > left) {
        throw new Error(`Only ${Math.max(0, left)} box(es) of "${product.name}" from this purchase can still be returned.`);
      }
      lineLeft.set(line.id, left - req.quantityBoxes);
      rate = lineCostRate(line);
      batchNo = batchNo ?? (line.batchNo && line.batchNo !== 'NA' ? line.batchNo : null);
    } else {
      if (product.companyId !== companyId) throw new Error(`"${product.name}" is not supplied by this company.`);
      rate = round2(product.boxTradePrice);
    }

    const stock = stockLeft.get(product.id) ?? product.stockBoxes;
    if (req.quantityBoxes > stock) {
      throw new Error(`Only ${Math.max(0, stock)} box(es) of "${product.name}" are in stock.`);
    }
    stockLeft.set(product.id, stock - req.quantityBoxes);

    return {
      productId: product.id,
      productName: product.name,
      purchaseItemId,
      batchNo,
      quantityBoxes: req.quantityBoxes,
      rate,
      credit: round2(rate * req.quantityBoxes)
    };
  });

  return { lines, totalCredit: round2(lines.reduce((sum, l) => sum + l.credit, 0)) };
}
