import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { parseBody, supplierPaymentSchema } from '../validation/schemas';
import { requirePermission, sendError } from '../http/context';
import { logSecurityAudit } from '../security/audit';
import { loadSupplierLedger } from '../suppliers/loadLedger';
import { round2 } from '../suppliers/ledgerMath';
import { localDateString } from '../../shared/dates';

// Supplier (distributor) payables: what the store owes each company, payments and statements
const router = Router();

const SUPPLIER_NOT_FOUND = 'Supplier not found';

router.get('/api/suppliers', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'purchases', 'You do not have access to suppliers.'))) return;
    const companies = await prisma.company.findMany({ orderBy: { name: 'asc' } });
    const rows = await Promise.all(companies.map(async (c) => {
      const ledger = await loadSupplierLedger(c.id);
      const last = ledger.dues[ledger.dues.length - 1];
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        contact_person: c.contactPerson,
        phone: c.phone,
        status: c.status,
        total_purchased: ledger.totals.purchased,
        total_paid: ledger.totals.paid,
        total_returned: ledger.totals.returned,
        balance: ledger.totals.balance,
        unpaid_bills: ledger.dues.filter(d => d.due > 0.005).length,
        last_purchase_date: last?.date ?? null
      };
    }));
    // Suppliers owed money first, then the rest by name
    rows.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    res.json(rows);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.get('/api/suppliers/:id/ledger', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'purchases', 'You do not have access to suppliers.'))) return;
    const company = await prisma.company.findUnique({ where: { id: Number(req.params.id) || 0 } });
    if (!company) return res.status(404).json({ error: SUPPLIER_NOT_FOUND });
    const ledger = await loadSupplierLedger(company.id);
    res.json({
      supplier: { id: company.id, code: company.code, name: company.name, phone: company.phone, address: company.address, contact_person: company.contactPerson },
      totals: ledger.totals,
      dues: ledger.dues.map(d => ({
        id: d.id,
        invoice_no: d.invoiceNo,
        supplier_invoice_no: d.supplierInvoiceNo,
        date: d.date,
        net_total: d.netTotal,
        settled: d.settled,
        due: d.due,
        status: d.status
      })),
      entries: ledger.entries
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/suppliers/:id/payments', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_pay_supplier', 'You do not have permission to pay suppliers.');
    if (!actor) return;
    const body = parseBody(supplierPaymentSchema, req.body, res);
    if (!body) return;
    const companyId = Number(req.params.id) || 0;
    const amount = round2(body.amount);

    // Checked and written in one transaction, so two payments at once cannot both pass the balance check
    const payment = await prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (!company) throw new Error(SUPPLIER_NOT_FOUND);
      const { totals } = await loadSupplierLedger(company.id, tx);
      if (amount > totals.balance + 0.005) {
        throw new Error(`The payment (${amount.toFixed(2)}) is more than what is owed to ${company.name} (${totals.balance.toFixed(2)}).`);
      }
      const created = await tx.supplierPayment.create({
        data: {
          companyId: company.id,
          amount,
          paymentMethod: body.payment_method ?? 'cash',
          reference: body.reference || null,
          notes: body.notes || null,
          paymentDate: body.payment_date ?? localDateString(),
          userId: actor.id,
          userName: actor.fullName || actor.username
        }
      });
      return { created, company, balanceAfter: round2(totals.balance - amount) };
    });

    await logSecurityAudit({
      action: 'SUPPLIER_PAYMENT',
      module: 'Purchases',
      status: 'SUCCESS',
      details: `Paid ${amount.toFixed(2)} to ${payment.company.name} (${payment.created.paymentMethod}${payment.created.reference ? `, ${payment.created.reference}` : ''}). Balance now ${payment.balanceAfter.toFixed(2)}`,
      userId: actor.id,
      userName: actor.username
    });

    res.json({ success: true, id: payment.created.id, balance: payment.balanceAfter });
  } catch (error: unknown) {
    sendError(res, error, error instanceof Error && error.message === SUPPLIER_NOT_FOUND ? 404 : 400);
  }
});

export default router;
