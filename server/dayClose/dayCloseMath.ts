// Day close (cash book) for one local calendar day. Pure: the route loads the rows, this adds them up.
// Sales are counted on the day they were made and returns on the day they were refunded, so an
// invoice returned a week later lowers that later day, not the original one.

import { tenderSplit, type TenderSource } from '../sales/saleMath';

/** A sale with its tender split (C4); older bills count wholly in their one payment type */
export type DaySaleRow = TenderSource;
/** One line sold that day: quantity in its own unit (box or loose) and the cost of that unit */
export interface DaySaleItemRow { quantity: number; unitCost: number }
export interface DayReturnRow { refundAmount: number }
/** One line returned that day, with the unit cost of the sale line it came from (0 when unknown) */
export interface DayReturnItemRow { quantity: number; unitCost: number }
export interface DayExpenseRow { category: string; amount: number; paymentMethod: string }
export interface DayPaymentRow { amount: number; paymentMethod: string }
export interface DayShiftRow { status: string; openingCash: number; expectedCash: number; closingCash: number | null }

export interface DayCloseInput {
  sales: DaySaleRow[];
  saleItems: DaySaleItemRow[];
  returns: DayReturnRow[];
  returnItems: DayReturnItemRow[];
  expenses: DayExpenseRow[];
  customerPayments: DayPaymentRow[];
  /** Money paid to suppliers that day: payments plus amounts paid with that day's purchases */
  supplierPaid: number;
  shifts: DayShiftRow[];
}

export interface DayCloseFigures {
  invoicesCount: number;
  salesTotal: number;
  salesCash: number;
  /** Card and Online */
  salesCard: number;
  salesCredit: number;
  returnsCount: number;
  returnsTotal: number;
  netSales: number;
  costOfGoods: number;
  grossProfit: number;
  expensesTotal: number;
  expensesCash: number;
  expensesByCategory: { category: string; amount: number; count: number }[];
  netProfit: number;
  customerPaymentsCash: number;
  supplierPaid: number;
  shifts: {
    count: number;
    openCount: number;
    openingCash: number;
    /** Live figure for open shifts, the saved one for closed shifts */
    expectedCash: number;
    /** Counted cash of the closed shifts only */
    countedCash: number;
    /** Counted minus expected, for the closed shifts only */
    difference: number;
  };
}

/** The same rows for a period, each tagged with the local day it belongs to */
export interface DatedDayInput {
  sales: (DaySaleRow & { day: string; items: DaySaleItemRow[] })[];
  returns: (DayReturnRow & { day: string; items: DayReturnItemRow[] })[];
  expenses: (DayExpenseRow & { day: string })[];
  customerPayments: (DayPaymentRow & { day: string })[];
  /** Supplier payments and amounts paid with purchases */
  supplierPayments: { day: string; amount: number }[];
  shifts: (DayShiftRow & { day: string })[];
}

/** The input for one day, or for the whole period when no day is given */
export function inputForDay(rows: DatedDayInput, day?: string): DayCloseInput {
  const pick = <T extends { day: string }>(list: T[]) => (day === undefined ? list : list.filter(r => r.day === day));
  const sales = pick(rows.sales);
  const returns = pick(rows.returns);
  return {
    sales,
    saleItems: sales.flatMap(s => s.items),
    returns,
    returnItems: returns.flatMap(r => r.items),
    expenses: pick(rows.expenses),
    customerPayments: pick(rows.customerPayments),
    supplierPaid: round2(sum(pick(rows.supplierPayments), p => p.amount)),
    shifts: pick(rows.shifts)
  };
}

/** Days that had any sale, return, expense, payment or shift, newest first */
export function activeDays(rows: DatedDayInput): string[] {
  const days = new Set<string>();
  for (const list of [rows.sales, rows.returns, rows.expenses, rows.customerPayments, rows.supplierPayments, rows.shifts]) {
    for (const r of list) days.add(r.day);
  }
  return [...days].sort().reverse();
}

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);

export function computeDayClose(input: DayCloseInput): DayCloseFigures {
  const salesTotal = sum(input.sales, s => s.netTotal);
  const salesCash = sum(input.sales, s => tenderSplit(s).cash);
  const salesCard = sum(input.sales, s => tenderSplit(s).card);
  const salesCredit = sum(input.sales, s => tenderSplit(s).credit);
  const returnsTotal = sum(input.returns, r => r.refundAmount);
  const netSales = salesTotal - returnsTotal;

  // Cost of what left the shelf that day, less the cost of what came back
  const costOfGoods = sum(input.saleItems, i => i.quantity * i.unitCost) - sum(input.returnItems, i => i.quantity * i.unitCost);
  const grossProfit = netSales - costOfGoods;

  const byCategory = new Map<string, { amount: number; count: number }>();
  for (const e of input.expenses) {
    const key = e.category.trim() || 'Other';
    const entry = byCategory.get(key) ?? { amount: 0, count: 0 };
    entry.amount += Number(e.amount) || 0;
    entry.count += 1;
    byCategory.set(key, entry);
  }
  const expensesTotal = sum(input.expenses, e => e.amount);
  const expensesCash = sum(input.expenses.filter(e => e.paymentMethod.toLowerCase() === 'cash'), e => e.amount);

  const closed = input.shifts.filter(s => s.status !== 'open');
  const countedCash = sum(closed, s => s.closingCash ?? 0);

  return {
    invoicesCount: input.sales.length,
    salesTotal: round2(salesTotal),
    salesCash: round2(salesCash),
    salesCard: round2(salesCard),
    salesCredit: round2(salesCredit),
    returnsCount: input.returns.length,
    returnsTotal: round2(returnsTotal),
    netSales: round2(netSales),
    costOfGoods: round2(costOfGoods),
    grossProfit: round2(grossProfit),
    expensesTotal: round2(expensesTotal),
    expensesCash: round2(expensesCash),
    expensesByCategory: [...byCategory.entries()]
      .map(([category, e]) => ({ category, amount: round2(e.amount), count: e.count }))
      .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category)),
    netProfit: round2(grossProfit - expensesTotal),
    customerPaymentsCash: round2(sum(input.customerPayments.filter(p => p.paymentMethod.toLowerCase() === 'cash'), p => p.amount)),
    supplierPaid: round2(input.supplierPaid),
    shifts: {
      count: input.shifts.length,
      openCount: input.shifts.length - closed.length,
      openingCash: round2(sum(input.shifts, s => s.openingCash)),
      expectedCash: round2(sum(input.shifts, s => s.expectedCash)),
      countedCash: round2(countedCash),
      difference: round2(countedCash - sum(closed, s => s.expectedCash))
    }
  };
}
