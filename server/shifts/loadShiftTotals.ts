import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { computeShiftTotals, type ShiftTotals } from './shiftTotals';

type Db = typeof prisma | Prisma.TransactionClient;

/** Reads a shift's sales, returns, khata payments and expenses and reconciles them (inside a transaction when given one) */
export async function loadShiftTotals(shift: { id: number; openingCash: number }, db: Db = prisma): Promise<ShiftTotals> {
  const [sales, returns, payments, expenses] = await Promise.all([
    db.sale.findMany({ where: { shiftId: shift.id }, select: { netTotal: true, paymentType: true } }),
    db.saleReturn.findMany({ where: { shiftId: shift.id }, select: { refundAmount: true, sale: { select: { paymentType: true } } } }),
    db.customerPayment.findMany({ where: { shiftId: shift.id }, select: { amount: true, paymentMethod: true } }),
    db.expense.findMany({ where: { shiftId: shift.id }, select: { amount: true, paymentMethod: true } })
  ]);
  return computeShiftTotals(
    shift.openingCash,
    sales,
    returns.map(r => ({ refundAmount: r.refundAmount, originalPaymentType: r.sale?.paymentType ?? null })),
    payments,
    expenses
  );
}
