import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { buildSupplierLedger, paidAtPurchase, type SupplierLedger } from './ledgerMath';

type Db = typeof prisma | Prisma.TransactionClient;

/** Reads one supplier's purchases, payments and return credits and builds the ledger (inside a transaction when given one) */
export async function loadSupplierLedger(companyId: number, db: Db = prisma): Promise<SupplierLedger> {
  const [purchases, payments, returns] = await Promise.all([
    db.purchase.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
    db.supplierPayment.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
    db.purchaseReturn.findMany({ where: { companyId }, orderBy: { id: 'asc' } })
  ]);
  return buildSupplierLedger(
    purchases.map(p => ({
      id: p.id,
      invoiceNo: p.invoiceNo,
      supplierInvoiceNo: p.supplierInvoiceNo,
      date: p.purchaseDate,
      netTotal: p.netTotal,
      paidAtPurchase: paidAtPurchase(p.paymentStatus, p.netTotal, p.paidAmount)
    })),
    payments.map(p => ({ id: p.id, date: p.paymentDate, amount: p.amount, method: p.paymentMethod, reference: p.reference, notes: p.notes })),
    returns.map(r => ({ id: r.id, returnNo: r.returnNo, date: r.returnDate, amount: r.totalRefund, isExpiryClaim: r.isExpiryClaim === 1 }))
  );
}
