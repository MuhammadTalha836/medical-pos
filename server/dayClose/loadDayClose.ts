import { prisma } from '../database/prisma';
import { loadShiftTotals } from '../shifts/loadShiftTotals';
import { paidAtPurchase } from '../suppliers/ledgerMath';
import { activeDays, computeDayClose, inputForDay, type DatedDayInput, type DayCloseFigures } from './dayCloseMath';
import { localDateString } from '../../shared/dates';

/** Start of the local calendar day and the start of the next one */
export function dayBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export interface OpenShift { shift_no: string; user_name: string; day: string }

export interface PeriodFigures {
  totals: DayCloseFigures;
  /** Days with any activity, newest first */
  days: { date: string; figures: DayCloseFigures }[];
  openShifts: OpenShift[];
}

/** Reads a period's (local days from..to) sales, returns, expenses, payments and shifts and adds them up, in all and per day */
export async function loadPeriod(from: string, to: string): Promise<PeriodFigures> {
  const range = { gte: dayBounds(from).start, lt: dayBounds(to).end };
  const nextDay = localDateString(dayBounds(to).end);

  const [sales, returns, expenses, customerPayments, supplierPayments, purchases, shifts] = await Promise.all([
    // Cancelled invoices (older data) never count; returned ones do, their refund counts on its own day
    prisma.sale.findMany({
      where: { saleDate: range, status: { not: 'cancelled' } },
      select: { saleDate: true, netTotal: true, paymentType: true, paidCash: true, paidCard: true, paidCredit: true, items: { select: { quantity: true, unitCost: true } } }
    }),
    prisma.saleReturn.findMany({
      where: { createdAt: range },
      select: {
        createdAt: true,
        refundAmount: true,
        items: { select: { productId: true, isLoose: true, quantity: true } },
        sale: { select: { items: { select: { productId: true, isLoose: true, quantity: true, unitCost: true } } } }
      }
    }),
    prisma.expense.findMany({ where: { expenseDate: { gte: from, lte: to } }, select: { expenseDate: true, category: true, amount: true, paymentMethod: true } }),
    prisma.customerPayment.findMany({ where: { paymentDate: range }, select: { paymentDate: true, amount: true, paymentMethod: true } }),
    prisma.supplierPayment.findMany({ where: { paymentDate: { gte: from, lte: to } }, select: { paymentDate: true, amount: true } }),
    // purchase_date may carry a time after the day, so the upper bound is the next day
    prisma.purchase.findMany({
      where: { purchaseDate: { gte: from, lt: nextDay } },
      select: { purchaseDate: true, paymentStatus: true, netTotal: true, paidAmount: true }
    }),
    prisma.cashierShift.findMany({ where: { startTime: range }, orderBy: { startTime: 'asc' } })
  ]);

  const dayOf = (value: Date) => localDateString(new Date(value));

  const rows: DatedDayInput = {
    sales: sales.map(s => ({ day: dayOf(s.saleDate), netTotal: s.netTotal, paymentType: s.paymentType, paidCash: s.paidCash, paidCard: s.paidCard, paidCredit: s.paidCredit, items: s.items })),
    // A returned line costs what its sale line cost (averaged when the invoice had the medicine twice)
    returns: returns.map(r => ({
      day: dayOf(r.createdAt),
      refundAmount: r.refundAmount,
      items: r.items.map(item => {
        const lines = (r.sale?.items ?? []).filter(l => l.productId === item.productId && l.isLoose === item.isLoose);
        const units = lines.reduce((total, l) => total + l.quantity, 0);
        const unitCost = units > 0 ? lines.reduce((total, l) => total + l.quantity * l.unitCost, 0) / units : 0;
        return { quantity: item.quantity, unitCost };
      })
    })),
    expenses: expenses.map(e => ({ day: e.expenseDate, category: e.category, amount: e.amount, paymentMethod: e.paymentMethod })),
    customerPayments: customerPayments.map(p => ({ day: dayOf(p.paymentDate), amount: p.amount, paymentMethod: p.paymentMethod })),
    supplierPayments: [
      ...supplierPayments.map(p => ({ day: p.paymentDate, amount: p.amount })),
      ...purchases
        .map(p => ({ day: p.purchaseDate.slice(0, 10), amount: paidAtPurchase(p.paymentStatus, p.netTotal, p.paidAmount) }))
        .filter(p => p.amount > 0)
    ],
    shifts: await Promise.all(shifts.map(async s => ({
      day: dayOf(s.startTime),
      status: s.status,
      openingCash: s.openingCash,
      expectedCash: s.status === 'open' ? (await loadShiftTotals(s)).expectedCash : (s.expectedCash ?? 0),
      closingCash: s.status === 'open' ? null : s.closingCash
    })))
  };

  return {
    totals: computeDayClose(inputForDay(rows)),
    days: activeDays(rows).map(date => ({ date, figures: computeDayClose(inputForDay(rows, date)) })),
    openShifts: shifts.filter(s => s.status === 'open').map(s => ({ shift_no: s.shiftNo, user_name: s.userName, day: dayOf(s.startTime) }))
  };
}

/** One local day's figures and its still-open shifts */
export async function loadDayClose(date: string): Promise<{ figures: DayCloseFigures; openShifts: OpenShift[] }> {
  const { totals, openShifts } = await loadPeriod(date, date);
  return { figures: totals, openShifts };
}
