// Drawer reconciliation for a cashier shift. One calculation for the live summary, the close, the list,
// the details view and the admin force-close, so they can never disagree.
import { tenderSplit, type TenderSource } from '../sales/saleMath';

/** A sale with its stored tender split (C4); older bills count wholly in their one payment type */
export type ShiftSaleRow = TenderSource;
/**
 * originalPaymentType: how the returned invoice was paid (null for a return without an invoice).
 * refundCash: the cash paid out, stored since split payments (C4); when missing the old rule applies.
 */
export interface ShiftReturnRow { refundAmount: number; originalPaymentType: string | null; refundCash?: number | null }
export interface ShiftPaymentRow { amount: number; paymentMethod: string }
export interface ShiftExpenseRow { amount: number; paymentMethod: string }
/** Cash put into ('in') or taken out of ('out') the drawer during the shift */
export interface ShiftCashMovementRow { direction: string; amount: number }

export interface ShiftTotals {
  salesCount: number;
  returnsCount: number;
  totalSalesAmount: number;
  totalCashSales: number;
  /** Card and Online (digital) sales */
  totalCardSales: number;
  totalCreditSales: number;
  /** Refunds paid out of the drawer: returns of cash invoices */
  totalReturnsCash: number;
  totalCustomerPaymentsCash: number;
  /** Shop expenses paid out of the drawer during the shift */
  totalExpensesCash: number;
  /** Cash pay-in / pay-out (C4) */
  totalCashIn: number;
  totalCashOut: number;
  expectedCash: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function computeShiftTotals(
  openingCash: number,
  sales: ShiftSaleRow[],
  returns: ShiftReturnRow[],
  payments: ShiftPaymentRow[],
  expenses: ShiftExpenseRow[] = [],
  cashMovements: ShiftCashMovementRow[] = []
): ShiftTotals {
  let totalSalesAmount = 0, totalCashSales = 0, totalCardSales = 0, totalCreditSales = 0;
  for (const sale of sales) {
    totalSalesAmount += sale.netTotal;
    const tenders = tenderSplit(sale);
    totalCashSales += tenders.cash;
    totalCardSales += tenders.card;
    totalCreditSales += tenders.credit;
  }

  // A credit return lowers the khata balance and a card return goes back to the card: no cash leaves the drawer.
  // Returns saved since split payments carry the cash actually paid out.
  const totalReturnsCash = returns.reduce((sum, r) => {
    if (r.refundCash !== undefined && r.refundCash !== null) return sum + r.refundCash;
    return r.originalPaymentType === null || r.originalPaymentType === 'Cash' ? sum + r.refundAmount : sum;
  }, 0);
  const totalCustomerPaymentsCash = payments
    .filter(p => p.paymentMethod.toLowerCase() === 'cash')
    .reduce((sum, p) => sum + p.amount, 0);
  // Bank, cheque and online expenses never touch the drawer
  const totalExpensesCash = expenses
    .filter(e => e.paymentMethod.toLowerCase() === 'cash')
    .reduce((sum, e) => sum + e.amount, 0);
  const totalCashIn = cashMovements.filter(m => m.direction === 'in').reduce((sum, m) => sum + m.amount, 0);
  const totalCashOut = cashMovements.filter(m => m.direction === 'out').reduce((sum, m) => sum + m.amount, 0);

  return {
    salesCount: sales.length,
    returnsCount: returns.length,
    totalSalesAmount: round2(totalSalesAmount),
    totalCashSales: round2(totalCashSales),
    totalCardSales: round2(totalCardSales),
    totalCreditSales: round2(totalCreditSales),
    totalReturnsCash: round2(totalReturnsCash),
    totalCustomerPaymentsCash: round2(totalCustomerPaymentsCash),
    totalExpensesCash: round2(totalExpensesCash),
    totalCashIn: round2(totalCashIn),
    totalCashOut: round2(totalCashOut),
    expectedCash: round2(openingCash + totalCashSales + totalCustomerPaymentsCash - totalReturnsCash - totalExpensesCash + totalCashIn - totalCashOut)
  };
}
