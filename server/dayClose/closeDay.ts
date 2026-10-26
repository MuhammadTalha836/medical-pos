import { prisma } from '../database/prisma';
import type { Actor } from '../http/context';
import { dayBounds, loadDayClose } from './loadDayClose';
import type { DayCloseFigures } from './dayCloseMath';

export const AUTOMATIC_CLOSER = 'Automatic';

/** Refusal with its own status code */
export class DayCloseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * Saves the day's figures in daily_closings and marks it closed (which locks its expenses).
 * `actor` null means the automatic midnight close. Throws DayCloseError 409 when the day is already closed.
 */
export async function closeDay(date: string, actor: Actor | null, notes: string | null) {
  const { figures, openShifts } = await loadDayClose(date);
  const data = {
    closingTime: new Date(),
    userId: actor?.id ?? null,
    userName: actor ? actor.fullName || actor.username : AUTOMATIC_CLOSER,
    autoClosed: actor ? 0 : 1,
    openingCash: figures.shifts.openingCash,
    totalSalesCash: figures.salesCash,
    totalSalesCard: figures.salesCard,
    totalSalesCredit: figures.salesCredit,
    totalReturns: figures.returnsTotal,
    totalPurchasesPaid: figures.supplierPaid,
    expensesTotal: figures.expensesTotal,
    expectedCash: figures.shifts.expectedCash,
    actualCash: figures.shifts.countedCash,
    difference: figures.shifts.difference,
    invoicesCount: figures.invoicesCount,
    totalCostOfGoods: figures.costOfGoods,
    customerPaymentsCash: figures.customerPaymentsCash,
    netProfit: figures.netProfit,
    openShiftsAtClose: openShifts.length,
    notes,
    isClosed: 1
  };

  // Checked again inside the transaction, so a manual close and the midnight close cannot both write
  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.dailyClosing.findUnique({ where: { closingDate: date } });
    if (existing?.isClosed === 1) throw new DayCloseError('This day is already closed.', 409);
    return existing
      ? tx.dailyClosing.update({ where: { id: existing.id }, data })
      : tx.dailyClosing.create({ data: { ...data, closingDate: date, openingTime: dayBounds(date).start } });
  });
  return { saved, figures, openShifts };
}

/** One-line summary for the audit log */
export function closeSummary(date: string, figures: DayCloseFigures, openShiftCount: number): string {
  return `Day ${date} closed. Net sales ${figures.netSales.toFixed(2)}, cost ${figures.costOfGoods.toFixed(2)}, expenses ${figures.expensesTotal.toFixed(2)}, net profit ${figures.netProfit.toFixed(2)}${openShiftCount ? `, ${openShiftCount} shift(s) still open` : ''}`;
}
