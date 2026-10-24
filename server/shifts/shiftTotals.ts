// Drawer reconciliation for a cashier shift. One calculation for the live summary, the close, the list,
// the details view and the admin force-close, so they can never disagree.

export interface ShiftSaleRow { netTotal: number; paymentType: string }
/** originalPaymentType: how the returned invoice was paid (null for a return without an invoice) */
export interface ShiftReturnRow { refundAmount: number; originalPaymentType: string | null }
export interface ShiftPaymentRow { amount: number; paymentMethod: string }

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
  expectedCash: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function computeShiftTotals(openingCash: number, sales: ShiftSaleRow[], returns: ShiftReturnRow[], payments: ShiftPaymentRow[]): ShiftTotals {
  let totalSalesAmount = 0, totalCashSales = 0, totalCardSales = 0, totalCreditSales = 0;
  for (const sale of sales) {
    totalSalesAmount += sale.netTotal;
    if (sale.paymentType === 'Cash') totalCashSales += sale.netTotal;
    else if (sale.paymentType === 'Card' || sale.paymentType === 'Online') totalCardSales += sale.netTotal;
    else if (sale.paymentType === 'Credit') totalCreditSales += sale.netTotal;
  }

  // A credit return lowers the khata balance and a card return goes back to the card: no cash leaves the drawer
  const totalReturnsCash = returns
    .filter(r => r.originalPaymentType === null || r.originalPaymentType === 'Cash')
    .reduce((sum, r) => sum + r.refundAmount, 0);
  const totalCustomerPaymentsCash = payments
    .filter(p => p.paymentMethod.toLowerCase() === 'cash')
    .reduce((sum, p) => sum + p.amount, 0);

  return {
    salesCount: sales.length,
    returnsCount: returns.length,
    totalSalesAmount: round2(totalSalesAmount),
    totalCashSales: round2(totalCashSales),
    totalCardSales: round2(totalCardSales),
    totalCreditSales: round2(totalCreditSales),
    totalReturnsCash: round2(totalReturnsCash),
    totalCustomerPaymentsCash: round2(totalCustomerPaymentsCash),
    expectedCash: round2(openingCash + totalCashSales + totalCustomerPaymentsCash - totalReturnsCash)
  };
}
