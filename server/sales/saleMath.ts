// Pure pricing and return rules for counter sales. The server prices every sale itself from the product
// record, so a tampered request cannot change prices, discounts or totals. No database imports (unit-tested).

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const PRICE_TOLERANCE = 0.005;

export interface PricingProduct {
  name: string;
  boxRetailPrice: number;
  unitRetailPrice: number;
  defaultDiscountPct: number;
}

export interface PricingRules {
  /** The seller's role has can_discount: may change the rate and give line discounts */
  canDiscount: boolean;
  /** Store-wide bill discount ceiling (system setting max_bill_discount_pct) */
  maxBillDiscountPct: number;
}

export interface PricedLine {
  unitPrice: number;
  grossAmount: number;
  discountPct: number;
  discountAmount: number;
  netAmount: number;
}

const toNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Prices one sale line. Without can_discount the rate must be the list price and the line discount may not
 * exceed the medicine's default discount (which the POS applies on its own).
 */
export function priceSaleLine(
  product: PricingProduct,
  isLoose: boolean,
  quantity: number,
  requested: { unitPrice?: unknown; discountPct?: unknown },
  rules: PricingRules
): PricedLine {
  const listPrice = isLoose ? product.unitRetailPrice : product.boxRetailPrice;
  const askedPrice = toNumber(requested.unitPrice);
  const askedPct = toNumber(requested.discountPct);

  let unitPrice = listPrice;
  if (askedPrice !== null) {
    if (askedPrice < 0) throw new Error(`The rate for "${product.name}" cannot be negative.`);
    if (Math.abs(askedPrice - listPrice) > PRICE_TOLERANCE) {
      if (!rules.canDiscount) {
        throw new Error(`The rate for "${product.name}" is ${listPrice.toFixed(2)}. Remove it and add it again; only staff with discount permission can change rates.`);
      }
      unitPrice = askedPrice;
    }
  }

  let discountPct = askedPct ?? 0;
  if (discountPct < 0 || discountPct > 100) {
    throw new Error(`The discount for "${product.name}" must be between 0% and 100%.`);
  }
  if (!rules.canDiscount && discountPct > (product.defaultDiscountPct || 0) + PRICE_TOLERANCE) {
    throw new Error(`You do not have permission to give a discount on "${product.name}".`);
  }

  const grossAmount = round2(quantity * unitPrice);
  const discountAmount = round2(grossAmount * discountPct / 100);
  return {
    unitPrice: round2(unitPrice),
    grossAmount,
    discountPct,
    discountAmount,
    netAmount: round2(grossAmount - discountAmount)
  };
}

export interface SaleTotals {
  totalGross: number;
  totalItemDiscount: number;
  billDiscountPct: number;
  billDiscountAmt: number;
  netTotal: number;
}

/** Bill totals from priced lines; the bill discount is a percentage of the subtotal (after line discounts). */
export function totalSale(lines: PricedLine[], billDiscountPct: unknown, rules: PricingRules): SaleTotals {
  const pct = toNumber(billDiscountPct) ?? 0;
  if (pct < 0) throw new Error('The bill discount cannot be negative.');
  if (pct > 0 && !rules.canDiscount) throw new Error('You do not have permission to give a bill discount.');
  const ceiling = Math.min(100, Math.max(0, rules.maxBillDiscountPct));
  if (pct > ceiling + PRICE_TOLERANCE) {
    throw new Error(`The bill discount cannot be more than ${ceiling}%.`);
  }

  const totalGross = round2(lines.reduce((sum, line) => sum + line.grossAmount, 0));
  const totalItemDiscount = round2(lines.reduce((sum, line) => sum + line.discountAmount, 0));
  const subtotal = round2(lines.reduce((sum, line) => sum + line.netAmount, 0));
  const billDiscountAmt = round2(subtotal * pct / 100);
  return {
    totalGross,
    totalItemDiscount,
    billDiscountPct: pct,
    billDiscountAmt,
    netTotal: round2(Math.max(0, subtotal - billDiscountAmt))
  };
}

/** Cash received for a sale: blank or 0 means the exact amount; less than the total is refused for Cash. */
export function settleCash(paymentType: string, netTotal: number, cashTendered: unknown): { cashTendered: number; changeDue: number } {
  const tendered = toNumber(cashTendered) ?? 0;
  if (tendered < 0) throw new Error('Cash received cannot be negative.');
  if (paymentType !== 'Cash' || tendered === 0) return { cashTendered: netTotal, changeDue: 0 };
  if (tendered < netTotal - PRICE_TOLERANCE) {
    throw new Error(`Cash received (${tendered.toFixed(2)}) is less than the bill total (${netTotal.toFixed(2)}).`);
  }
  return { cashTendered: round2(tendered), changeDue: round2(tendered - netTotal) };
}

/** Allowed round-off steps (setting round_off_to); 0 = off */
export const ROUND_OFF_STEPS = [0, 1, 5, 10] as const;

/** Rounds the bill to the nearest step (198 -> 200 with 10, 196 -> 195 with 5); roundOff is what was added (signed) */
export function roundOff(netTotal: number, step: unknown): { netTotal: number; roundOff: number } {
  const size = Number(step);
  if (!ROUND_OFF_STEPS.includes(size as typeof ROUND_OFF_STEPS[number]) || size === 0 || netTotal <= 0) {
    return { netTotal, roundOff: 0 };
  }
  const rounded = round2(Math.round(netTotal / size) * size);
  return { netTotal: rounded, roundOff: round2(rounded - netTotal) };
}

// ---------------------------------------------------------------------------------------------------------
// Tenders (C4): how a bill was paid. Card covers Card and Online.

export interface Tenders { cash: number; card: number; credit: number }

export interface TenderSource {
  paymentType: string;
  netTotal: number;
  paidCash?: number | null;
  paidCard?: number | null;
  paidCredit?: number | null;
}

/** The tender split of a sale: the stored amounts, or (bills from before split payment) the whole net in its one type */
export function tenderSplit(sale: TenderSource): Tenders {
  const cash = Number(sale.paidCash) || 0, card = Number(sale.paidCard) || 0, credit = Number(sale.paidCredit) || 0;
  if (cash + card + credit > 0) return { cash, card, credit };
  if (sale.paymentType === 'Cash') return { cash: sale.netTotal, card: 0, credit: 0 };
  if (sale.paymentType === 'Card' || sale.paymentType === 'Online') return { cash: 0, card: sale.netTotal, credit: 0 };
  if (sale.paymentType === 'Credit') return { cash: 0, card: 0, credit: sale.netTotal };
  return { cash: 0, card: 0, credit: 0 };
}

/**
 * Checks a split payment: every part 0 or more, at least two parts used, and together exactly the bill.
 * Returns the parts rounded to paisa.
 */
export function checkSplit(netTotal: number, split: { cash?: unknown; card?: unknown; credit?: unknown } | null | undefined): Tenders {
  const part = (value: unknown, name: string) => {
    const n = toNumber(value) ?? 0;
    if (n < 0) throw new Error(`The ${name} part cannot be negative.`);
    return round2(n);
  };
  const tenders = { cash: part(split?.cash, 'cash'), card: part(split?.card, 'card'), credit: part(split?.credit, 'credit') };
  if ([tenders.cash, tenders.card, tenders.credit].filter(v => v > 0).length < 2) {
    throw new Error('A split payment needs at least two parts (cash, card or credit).');
  }
  const total = round2(tenders.cash + tenders.card + tenders.credit);
  if (Math.abs(total - netTotal) > PRICE_TOLERANCE) {
    throw new Error(`The split parts add up to ${total.toFixed(2)}, but the bill is ${netTotal.toFixed(2)}.`);
  }
  return tenders;
}

/** Tenders for a single-type bill */
export function singleTender(paymentType: string, netTotal: number): Tenders {
  return tenderSplit({ paymentType, netTotal });
}

/**
 * How a refund is paid back (owner rule for split bills): first it lowers what is still owed on the khata (the
 * bill's credit part, less credit already taken back by earlier returns), and the rest is cash from the drawer.
 * Single-type bills keep their rule: Cash -> drawer, Card/Online -> back to the card, Credit -> khata.
 */
export function refundTenders(sale: TenderSource, refundedBefore: number, refund: number): { cash: number; credit: number } {
  if (sale.paymentType !== 'Split') {
    if (sale.paymentType === 'Cash') return { cash: refund, credit: 0 };
    if (sale.paymentType === 'Credit') return { cash: 0, credit: refund };
    return { cash: 0, credit: 0 };
  }
  const creditPart = tenderSplit(sale).credit;
  const credit = round2(Math.min(refundedBefore + refund, creditPart) - Math.min(refundedBefore, creditPart));
  return { cash: round2(refund - credit), credit };
}

// ---------------------------------------------------------------------------------------------------------
// Returns

export interface SoldLine {
  productId: number;
  productName: string;
  isLoose: boolean;
  quantity: number;
  netAmount: number;
}

export interface ReturnedLine {
  productId: number;
  isLoose: boolean;
  quantity: number;
}

export interface ReturnRequestLine {
  productId: number;
  isLoose: boolean;
  quantity: number;
}

export interface PricedReturnLine extends ReturnRequestLine {
  productName: string;
  unitRefundPrice: number;
  totalRefund: number;
}

const lineKey = (productId: number, isLoose: boolean) => `${productId}:${isLoose ? 1 : 0}`;

/**
 * Checks a return against the invoice and prices it. Each medicine/unit type can come back at most as often as
 * it was sold (minus earlier returns). The refund is the price actually paid: the line's net amount with the
 * bill discount shared out proportionally.
 */
export function priceReturn(
  sold: SoldLine[],
  saleNetTotal: number,
  alreadyReturned: ReturnedLine[],
  requested: ReturnRequestLine[]
): { lines: PricedReturnLine[]; totalRefund: number; fullyReturned: boolean } {
  const soldByKey = new Map<string, { productName: string; quantity: number; net: number }>();
  for (const line of sold) {
    const key = lineKey(line.productId, line.isLoose);
    const entry = soldByKey.get(key) ?? { productName: line.productName, quantity: 0, net: 0 };
    entry.quantity += line.quantity;
    entry.net += line.netAmount;
    soldByKey.set(key, entry);
  }
  const subtotal = sold.reduce((sum, line) => sum + line.netAmount, 0);
  // The net may sit a little above the subtotal when the bill was rounded up (C1), so no cap at 1
  const paidShare = subtotal > 0 ? Math.max(0, saleNetTotal / subtotal) : 0;

  const returnedByKey = new Map<string, number>();
  for (const line of alreadyReturned) {
    const key = lineKey(line.productId, line.isLoose);
    returnedByKey.set(key, (returnedByKey.get(key) ?? 0) + line.quantity);
  }

  const lines: PricedReturnLine[] = [];
  for (const line of requested) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error('Each returned item needs a whole quantity greater than zero.');
    }
    const key = lineKey(line.productId, line.isLoose);
    const entry = soldByKey.get(key);
    if (!entry) throw new Error('A returned item is not on this invoice (or was sold in the other unit type).');
    const left = entry.quantity - (returnedByKey.get(key) ?? 0);
    if (line.quantity > left + 1e-9) {
      throw new Error(`Only ${Math.max(0, left)} of "${entry.productName}" can still be returned on this invoice.`);
    }
    returnedByKey.set(key, (returnedByKey.get(key) ?? 0) + line.quantity);

    const unitRefundPrice = round2(entry.net * paidShare / entry.quantity);
    // The last unit of a line takes the rounding remainder, so a full return refunds exactly what was paid
    const returnedAfter = returnedByKey.get(key) ?? 0;
    const isLastOfLine = Math.abs(returnedAfter - entry.quantity) < 1e-9;
    const paidForLine = round2(entry.net * paidShare);
    const refundedBefore = round2(unitRefundPrice * (returnedAfter - line.quantity));
    const totalRefund = isLastOfLine
      ? round2(paidForLine - refundedBefore)
      : round2(unitRefundPrice * line.quantity);
    lines.push({ ...line, productName: entry.productName, unitRefundPrice, totalRefund });
  }

  const fullyReturned = [...soldByKey.entries()].every(([key, entry]) => (returnedByKey.get(key) ?? 0) >= entry.quantity - 1e-9);
  return { lines, totalRefund: round2(lines.reduce((sum, line) => sum + line.totalRefund, 0)), fullyReturned };
}
