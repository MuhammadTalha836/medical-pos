import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { getActingUser, hasRolePermission, requirePermission, sessionIdentity, sendError } from '../http/context';
import { customerSchema, parseBody } from '../validation/schemas';
import { normalizePhone } from '../../shared/customers';
import { logSecurityAudit } from '../security/audit';
import { defaultPlan, loyaltyActive, planPayload } from '../loyalty/loyaltyStore';

// Customers and credit ledger (khata)
const router = Router();

const CUSTOMER_NOT_FOUND = 'Customer not found';

router.get('/api/customers', async (_req: Request, res: Response) => {
  try {
    const customers = await prisma.$queryRaw<any[]>`
      SELECT c.id, c.name, c.phone, c.address, c.credit_limit, c.current_balance, c.created_at,
        c.loyalty_points, c.loyalty_plan_id, (SELECT lp.name FROM loyalty_plans lp WHERE lp.id = c.loyalty_plan_id) as loyalty_plan_name,
        (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) as invoices_count,
        (SELECT COALESCE(SUM(s.net_total), 0) FROM sales s WHERE s.customer_id = c.id AND s.status != 'returned')
          - (SELECT COALESCE(SUM(r.refund_amount), 0) FROM sale_returns r JOIN sales s ON s.id = r.sale_id
             WHERE s.customer_id = c.id AND s.status = 'partially_returned') as total_purchases,
        (SELECT COALESCE(SUM(s.net_total), 0) FROM sales s WHERE s.customer_id = c.id AND s.payment_type = 'Credit') as total_credit_sales,
        (SELECT COALESCE(SUM(p.amount), 0) FROM customer_payments p WHERE p.customer_id = c.id) as total_payments
      FROM customers c
      ORDER BY c.current_balance DESC, c.name ASC
    `;
    res.json(customers);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

type CustomerRow = { id: number; name: string; phone: string | null; currentBalance: number; creditLimit: number; loyaltyPoints?: number; loyaltyPlanId?: number | null };

// Client contract (snake_case), as in GET /api/customers
const customerPayload = (c: CustomerRow & { address?: string | null }) => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  address: c.address ?? null,
  current_balance: c.currentBalance,
  credit_limit: c.creditLimit,
  loyalty_points: c.loyaltyPoints ?? 0,
  loyalty_plan_id: c.loyaltyPlanId ?? null
});

const customerFields = { id: true, name: true, phone: true, address: true, currentBalance: true, creditLimit: true, loyaltyPoints: true, loyaltyPlanId: true } as const;

// Phones are stored as typed; two customers match when their digits match
async function findByPhone(phone: string, exceptId?: number) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const withPhone = await prisma.customer.findMany({ where: { phone: { not: null } }, select: customerFields });
  return withPhone.find(c => c.id !== exceptId && normalizePhone(c.phone) === digits) ?? null;
}

const duplicatePhone = (res: Response, existing: CustomerRow) =>
  res.status(409).json({
    error: `This phone number already belongs to ${existing.name}.`,
    customer: customerPayload(existing)
  });

// POS customer picker: name or phone search
router.get('/api/customers/search', async (req: Request, res: Response) => {
  try {
    const actor = await getActingUser(req);
    if (!actor || !((await hasRolePermission(actor.role, 'pos')) || (await hasRolePermission(actor.role, 'khata')))) {
      return res.status(403).json({ error: 'You do not have permission to look up customers.' });
    }
    const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 80);
    if (!q) return res.json([]);
    const digits = normalizePhone(q);

    const all = await prisma.customer.findMany({ select: customerFields });
    const rank = (c: CustomerRow) => {
      const name = c.name.toLowerCase();
      const phone = normalizePhone(c.phone);
      if (digits.length >= 3 && phone === digits) return 0;
      if (name === q) return 1;
      if (name.startsWith(q)) return 2;
      if (name.includes(q)) return 3;
      if (digits.length >= 3 && phone.includes(digits)) return 4;
      return -1;
    };
    const matches = all
      .map(c => ({ c, r: rank(c) }))
      .filter(m => m.r >= 0)
      .sort((a, b) => a.r - b.r || a.c.name.localeCompare(b.c.name))
      .slice(0, 8)
      .map(m => customerPayload(m.c));
    // While loyalty is on, each customer carries their plan so the POS can show the discount and points before saving
    if (await loyaltyActive()) {
      const plans = await prisma.loyaltyPlan.findMany();
      const fallback = plans.find(p => p.isDefault === 1 && p.status === 'active') ?? null;
      return res.json(matches.map(c => {
        const plan = plans.find(p => p.id === c.loyalty_plan_id) ?? fallback;
        return { ...c, loyalty_plan: plan ? planPayload(plan) : null, points_value: plan ? Math.round(c.loyalty_points * plan.pointValue * 100) / 100 : 0 };
      }));
    }
    res.json(matches);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/customers', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_add_customer', 'You do not have permission to add customers.'))) return;
    const body = parseBody(customerSchema, req.body, res);
    if (!body) return;

    const existing = await findByPhone(body.phone);
    if (existing) return duplicatePhone(res, existing);

    const created = await prisma.customer.create({
      data: {
        name: body.name,
        phone: body.phone,
        address: body.address || null,
        creditLimit: body.credit_limit ?? 0,
        currentBalance: 0.0,
        // New customers start on the default loyalty plan (if one is set)
        loyaltyPlanId: (await defaultPlan(prisma))?.id ?? null
      },
      select: customerFields
    });
    res.json({ success: true, id: created.id, customer: customerPayload(created) });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.put('/api/customers/:id', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_edit_customer', 'You do not have permission to edit customers.'))) return;
    const idNum = Number(req.params.id);
    const body = parseBody(customerSchema, req.body, res);
    if (!body) return;

    const existing = await findByPhone(body.phone, idNum);
    if (existing) return duplicatePhone(res, existing);

    await prisma.customer.update({
      where: { id: idNum },
      data: {
        name: body.name,
        phone: body.phone,
        address: body.address || null,
        creditLimit: body.credit_limit ?? 0
      }
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.post('/api/customers/:id/payment', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_receive_payment', 'You do not have permission to receive khata payments.'))) return;
    const idNum = Number(req.params.id);
    const { amount, payment_method, notes } = req.body;
    // Identity always comes from the login session, never from the request body
    const { user_id, user_name } = await sessionIdentity(req);
    const paymentAmt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(paymentAmt) || paymentAmt <= 0) {
      return res.status(400).json({ error: 'Valid positive payment amount required' });
    }

    // The payment is counted in the receiving user's own open shift (never a shift id from the client)
    const activeShift = user_id
      ? await prisma.cashierShift.findFirst({ where: { userId: Number(user_id), status: 'open' }, orderBy: { id: 'desc' }, select: { id: true } })
      : null;

    // Read and write the balance in one transaction, so two payments at once cannot overwrite each other
    const newBalance = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: idNum } });
      if (!customer) throw new Error(CUSTOMER_NOT_FOUND);
      if (paymentAmt > customer.currentBalance + 0.005) {
        throw new Error(`The payment (${paymentAmt.toFixed(2)}) is more than ${customer.name}'s balance (${customer.currentBalance.toFixed(2)}).`);
      }
      const balanceAfter = Math.max(0, Math.round((customer.currentBalance - paymentAmt) * 100) / 100);

      await tx.customer.update({
        where: { id: idNum },
        data: { currentBalance: balanceAfter }
      });

      await tx.customerPayment.create({
        data: {
          customerId: idNum,
          amount: paymentAmt,
          paymentMethod: payment_method || 'cash',
          notes: notes || null,
          previousBalance: customer.currentBalance,
          newBalance: balanceAfter,
          userName: user_name || 'Cashier',
          shiftId: activeShift?.id ?? null
        }
      });

      await tx.auditLog.create({
        data: {
          action: 'CUSTOMER_PAYMENT',
          module: 'Khata',
          details: `Payment received from ${customer.name}: ${paymentAmt} (${payment_method || 'Cash'}). Previous: ${customer.currentBalance}, New Balance: ${balanceAfter}. Notes: ${notes || 'None'}`,
          userName: user_name || 'Cashier'
        }
      });
      return balanceAfter;
    });

    res.json({ success: true, new_balance: newBalance });
  } catch (error: unknown) {
    sendError(res, error, error instanceof Error && error.message === CUSTOMER_NOT_FOUND ? 404 : 400);
  }
});

router.get('/api/customers/:id/ledger', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const customer = await prisma.customer.findUnique({ where: { id: idNum } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const sales = await prisma.sale.findMany({
      where: { customerId: idNum },
      select: {
        id: true,
        invoiceNo: true,
        saleDate: true,
        netTotal: true,
        paymentType: true,
        status: true,
        _count: { select: { items: true } }
      },
      orderBy: { id: 'desc' }
    });

    const payments = await prisma.customerPayment.findMany({
      where: { customerId: idNum },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        notes: true,
        previousBalance: true,
        newBalance: true,
        paymentDate: true,
        userName: true
      },
      orderBy: { id: 'desc' }
    });

    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        credit_limit: customer.creditLimit,
        current_balance: customer.currentBalance,
        created_at: customer.createdAt
      },
      sales: sales.map(s => ({
        id: s.id,
        invoice_no: s.invoiceNo,
        sale_date: s.saleDate,
        net_total: s.netTotal,
        payment_type: s.paymentType,
        status: s.status,
        items_count: s._count.items
      })),
      payments: payments.map(p => ({
        id: p.id,
        amount: p.amount,
        payment_method: p.paymentMethod,
        notes: p.notes,
        previous_balance: p.previousBalance,
        new_balance: p.newBalance,
        payment_date: p.paymentDate,
        user_name: p.userName
      }))
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Only a customer without history can be deleted: invoices and payments feed shift totals and reports
router.delete('/api/customers/:id', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_delete_customer', 'You do not have permission to delete customers.');
    if (!actor) return;
    const idNum = Number(req.params.id);
    const customer = await prisma.customer.findUnique({
      where: { id: idNum },
      include: { _count: { select: { sales: true, payments: true } } }
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const history = [
      customer._count.sales > 0 && `${customer._count.sales} invoice(s)`,
      customer._count.payments > 0 && `${customer._count.payments} khata payment(s)`,
      Math.abs(customer.currentBalance) > 0.004 && 'an outstanding khata balance'
    ].filter(Boolean);
    if (history.length > 0) {
      return res.status(409).json({
        error: `${customer.name} has ${history.join(', ')}. Customers with history cannot be deleted.`
      });
    }

    await prisma.customer.delete({ where: { id: idNum } });
    await logSecurityAudit({
      action: 'CUSTOMER_DELETED',
      module: 'Customers',
      details: `Deleted customer #${customer.id} ${customer.name} (${customer.phone || 'no phone'})`,
      affectedUser: customer.name,
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
