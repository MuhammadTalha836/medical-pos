import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { computeShiftTotals, type ShiftTotals } from './shiftTotals';

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Reads a shift's sales, returns, khata payments, expenses and cash pay-in/out and reconciles them (inside a
 * transaction when given one). Voided (cancelled) bills never count.
 */
export async function loadShiftTotals(shift: { id: number; openingCash: number }, db: Db = prisma): Promise<ShiftTotals> {
  const [sales, returns, payments, expenses, cashMovements] = await Promise.all([
    db.sale.findMany({
      where: { shiftId: shift.id, status: { not: 'cancelled' } },
      select: { netTotal: true, paymentType: true, paidCash: true, paidCard: true, paidCredit: true }
    }),
    db.saleReturn.findMany({ where: { shiftId: shift.id }, select: { refundAmount: true, refundCash: true, sale: { select: { paymentType: true } } } }),
    db.customerPayment.findMany({ where: { shiftId: shift.id }, select: { amount: true, paymentMethod: true } }),
    db.expense.findMany({ where: { shiftId: shift.id }, select: { amount: true, paymentMethod: true } }),
    db.cashMovement.findMany({ where: { shiftId: shift.id }, select: { direction: true, amount: true } })
  ]);
  return computeShiftTotals(
    shift.openingCash,
    sales,
    returns.map(r => ({ refundAmount: r.refundAmount, refundCash: r.refundCash, originalPaymentType: r.sale?.paymentType ?? null })),
    payments,
    expenses,
    cashMovements
  );
}
