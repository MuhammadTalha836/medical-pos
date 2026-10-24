import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { sessionIdentity, sendError } from '../http/context';

// Customers and credit ledger (khata)
const router = Router();

router.get('/api/customers', async (_req: Request, res: Response) => {
  try {
    const customers = await prisma.$queryRaw<any[]>`
      SELECT c.id, c.name, c.phone, c.address, c.credit_limit, c.current_balance, c.created_at,
        (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) as invoices_count,
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

router.post('/api/customers', async (req: Request, res: Response) => {
  try {
    const { name, phone, address, credit_limit } = req.body;
    const newCustomer = await prisma.customer.create({
      data: {
        name: name.trim(),
        phone: phone || null,
        address: address || null,
        creditLimit: parseFloat(credit_limit) || 0,
        currentBalance: 0.0
      }
    });
    res.json({ success: true, id: newCustomer.id });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.put('/api/customers/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const { name, phone, address, credit_limit } = req.body;
    await prisma.customer.update({
      where: { id: idNum },
      data: {
        name: name.trim(),
        phone: phone || null,
        address: address || null,
        creditLimit: parseFloat(credit_limit) || 0
      }
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.post('/api/customers/:id/payment', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const { amount, payment_method, notes, shift_id } = req.body;
    // Identity always comes from the login session, never from the request body
    const { user_id, user_name } = await sessionIdentity(req);
    const paymentAmt = parseFloat(amount);
    if (isNaN(paymentAmt) || paymentAmt <= 0) {
      return res.status(400).json({ error: 'Valid positive payment amount required' });
    }

    const customer = await prisma.customer.findUnique({ where: { id: idNum } });
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    let activeShiftId = shift_id ? Number(shift_id) : null;
    if (!activeShiftId && user_id) {
      const activeShift = await prisma.cashierShift.findFirst({
        where: { userId: Number(user_id), status: 'open' },
        orderBy: { id: 'desc' }
      });
      if (activeShift) {
        activeShiftId = activeShift.id;
      }
    }

    const newBalance = Math.max(0, customer.currentBalance - paymentAmt);

    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: idNum },
        data: { currentBalance: newBalance }
      });

      await tx.customerPayment.create({
        data: {
          customerId: idNum,
          amount: paymentAmt,
          paymentMethod: payment_method || 'cash',
          notes: notes || null,
          previousBalance: customer.currentBalance,
          newBalance: newBalance,
          userName: user_name || 'Cashier',
          shiftId: activeShiftId
        }
      });

      await tx.auditLog.create({
        data: {
          action: 'CUSTOMER_PAYMENT',
          module: 'Khata',
          details: `Payment received: ${paymentAmt} (${payment_method || 'Cash'}). Previous: ${customer.currentBalance}, New Balance: ${newBalance}. Notes: ${notes || 'None'}`,
          userName: 'Cashier'
        }
      });
    });

    res.json({ success: true, new_balance: newBalance });
  } catch (error: unknown) {
    sendError(res, error);
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
        status: true
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
        status: s.status
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

export default router;
