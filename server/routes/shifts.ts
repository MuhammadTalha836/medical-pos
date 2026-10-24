import { Router, type Request, type Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { runShiftCloseBackup } from '../backup/scheduler';
import { parseBody, shiftReopenSchema } from '../validation/schemas';
import { getActingUser, sessionIdentity, hasRolePermission, sendError } from '../http/context';

// Cashier shifts and drawer reconciliation
const router = Router();

function formatShiftDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// 1. Get active shift for a cashier user
router.get('/api/shifts/active', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const shift = await prisma.cashierShift.findFirst({
      where: {
        userId: Number(user_id),
        status: 'open'
      },
      orderBy: { id: 'desc' }
    });

    if (!shift) {
      return res.json({ activeShift: null });
    }

    // Compute live shift stats
    const [sales, returns, customerPayments] = await Promise.all([
      prisma.sale.findMany({
        where: { shiftId: shift.id },
        select: { netTotal: true, cashTendered: true, changeDue: true, paymentType: true }
      }),
      prisma.saleReturn.findMany({
        where: { shiftId: shift.id },
        select: { refundAmount: true }
      }),
      prisma.customerPayment.findMany({
        where: { shiftId: shift.id },
        select: { amount: true, paymentMethod: true }
      })
    ]);

    let totalCashSales = 0;
    let totalCardSales = 0;
    let totalCreditSales = 0;
    let totalSalesAmount = 0;

    for (const s of sales) {
      totalSalesAmount += s.netTotal;
      if (s.paymentType === 'Cash') {
        totalCashSales += s.netTotal;
      } else if (s.paymentType === 'Card') {
        totalCardSales += s.netTotal;
      } else if (s.paymentType === 'Credit') {
        totalCreditSales += s.netTotal;
      }
    }

    let totalReturnsCash = 0;
    for (const r of returns) {
      totalReturnsCash += r.refundAmount;
    }

    let totalCustomerPaymentsCash = 0;
    for (const cp of customerPayments) {
      if (cp.paymentMethod.toLowerCase() === 'cash') {
        totalCustomerPaymentsCash += cp.amount;
      }
    }

    const expectedCash = shift.openingCash + totalCashSales + totalCustomerPaymentsCash - totalReturnsCash;
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(shift.startTime).getTime()) / 60000));

    res.json({
      activeShift: {
        id: shift.id,
        shift_no: shift.shiftNo,
        user_id: shift.userId,
        user_name: shift.userName,
        start_time: shift.startTime,
        end_time: shift.endTime,
        duration_minutes: elapsedMinutes,
        opening_cash: shift.openingCash,
        closing_cash: shift.closingCash,
        expected_cash: expectedCash,
        cash_difference: shift.cashDifference,
        total_sales_count: sales.length,
        total_sales_amount: totalSalesAmount,
        total_cash_sales: totalCashSales,
        total_card_sales: totalCardSales,
        total_credit_sales: totalCreditSales,
        total_returns_amount: totalReturnsCash,
        total_customer_payments: totalCustomerPaymentsCash,
        notes: shift.notes,
        status: shift.status
      },
      summary: {
        opening_cash: shift.openingCash,
        total_sales_cash: totalCashSales,
        total_sales_card: totalCardSales,
        total_sales_credit: totalCreditSales,
        total_returns_cash: totalReturnsCash,
        total_customer_payments_cash: totalCustomerPaymentsCash,
        expected_cash: expectedCash,
        invoices_count: sales.length,
        returns_count: returns.length,
        duration_formatted: formatShiftDuration(elapsedMinutes)
      }
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// 2. Open a new cashier shift
router.post('/api/shifts/start', async (req: Request, res: Response) => {
  try {
    const { opening_cash, notes } = req.body;
    // Identity always comes from the login session, never from the request body
    const { user_id, user_name } = await sessionIdentity(req);
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Check if user already has an open shift
    const existingOpen = await prisma.cashierShift.findFirst({
      where: {
        userId: Number(user_id),
        status: 'open'
      }
    });

    if (existingOpen) {
      return res.status(400).json({
        error: `User already has an active open shift (${existingOpen.shiftNo}). You must close it before starting a new one.`,
        activeShift: existingOpen
      });
    }

    // Generate unique shift number: e.g. SH-YYYYMMDD-0001
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await prisma.cashierShift.count({
      where: { shiftNo: { startsWith: `SH-${today}-` } }
    });
    const shiftNo = `SH-${today}-${String(countToday + 1).padStart(4, '0')}`;

    const newShift = await prisma.cashierShift.create({
      data: {
        shiftNo,
        userId: Number(user_id),
        userName: user_name || 'Cashier',
        startTime: new Date(),
        openingCash: parseFloat(opening_cash) || 0,
        notes: notes || null,
        status: 'open'
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'SHIFT_OPENED',
        module: 'Shift Management',
        details: `Shift ${shiftNo} opened by ${user_name} with opening float ${opening_cash || 0}`,
        userId: Number(user_id),
        userName: user_name || 'Cashier'
      }
    });

    res.json({
      success: true,
      shift: {
        id: newShift.id,
        shift_no: newShift.shiftNo,
        user_id: newShift.userId,
        user_name: newShift.userName,
        start_time: newShift.startTime,
        opening_cash: newShift.openingCash,
        status: newShift.status,
        notes: newShift.notes
      }
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// 3. Get live summary for active shift closing modal
router.get('/api/shifts/:id/summary', async (req: Request, res: Response) => {
  try {
    const shiftId = Number(req.params.id);
    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const [sales, returns, customerPayments] = await Promise.all([
      prisma.sale.findMany({
        where: { shiftId: shift.id },
        select: { id: true, invoiceNo: true, netTotal: true, cashTendered: true, changeDue: true, paymentType: true, saleDate: true }
      }),
      prisma.saleReturn.findMany({
        where: { shiftId: shift.id },
        select: { id: true, returnNo: true, refundAmount: true, createdAt: true }
      }),
      prisma.customerPayment.findMany({
        where: { shiftId: shift.id },
        select: { id: true, amount: true, paymentMethod: true, paymentDate: true }
      })
    ]);

    let totalCashSales = 0;
    let totalCardSales = 0;
    let totalCreditSales = 0;
    let totalSalesAmount = 0;

    for (const s of sales) {
      totalSalesAmount += s.netTotal;
      if (s.paymentType === 'Cash') {
        totalCashSales += s.netTotal;
      } else if (s.paymentType === 'Card') {
        totalCardSales += s.netTotal;
      } else if (s.paymentType === 'Credit') {
        totalCreditSales += s.netTotal;
      }
    }

    let totalReturnsCash = 0;
    for (const r of returns) {
      totalReturnsCash += r.refundAmount;
    }

    let totalCustomerPaymentsCash = 0;
    for (const cp of customerPayments) {
      if (cp.paymentMethod.toLowerCase() === 'cash') {
        totalCustomerPaymentsCash += cp.amount;
      }
    }

    const expectedCash = shift.openingCash + totalCashSales + totalCustomerPaymentsCash - totalReturnsCash;
    const endTime = shift.endTime || new Date();
    const durationMinutes = Math.max(1, Math.round((new Date(endTime).getTime() - new Date(shift.startTime).getTime()) / 60000));

    res.json({
      shift: {
        id: shift.id,
        shift_no: shift.shiftNo,
        user_id: shift.userId,
        user_name: shift.userName,
        start_time: shift.startTime,
        end_time: shift.endTime,
        duration_minutes: durationMinutes,
        opening_cash: shift.openingCash,
        closing_cash: shift.closingCash,
        expected_cash: shift.expectedCash || expectedCash,
        cash_difference: shift.cashDifference,
        total_sales_count: sales.length,
        total_sales_amount: totalSalesAmount,
        total_cash_sales: totalCashSales,
        total_card_sales: totalCardSales,
        total_credit_sales: totalCreditSales,
        total_returns_amount: totalReturnsCash,
        total_customer_payments: totalCustomerPaymentsCash,
        notes: shift.notes,
        status: shift.status
      },
      summary: {
        opening_cash: shift.openingCash,
        total_sales_cash: totalCashSales,
        total_sales_card: totalCardSales,
        total_sales_credit: totalCreditSales,
        total_returns_cash: totalReturnsCash,
        total_customer_payments_cash: totalCustomerPaymentsCash,
        expected_cash: expectedCash,
        invoices_count: sales.length,
        returns_count: returns.length,
        duration_formatted: formatShiftDuration(durationMinutes)
      }
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// 4. Reconcile, close, and lock shift
router.post('/api/shifts/:id/close', async (req: Request, res: Response) => {
  try {
    const shiftId = Number(req.params.id);
    const { actual_cash, notes } = req.body;
    // Identity always comes from the login session, never from the request body
    const { user_id, user_name } = await sessionIdentity(req);

    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    if (shift.status === 'closed') {
      return res.status(400).json({ error: 'Shift is already closed and locked.' });
    }

    const [sales, returns, customerPayments] = await Promise.all([
      prisma.sale.findMany({
        where: { shiftId: shift.id },
        select: { netTotal: true, paymentType: true }
      }),
      prisma.saleReturn.findMany({
        where: { shiftId: shift.id },
        select: { refundAmount: true }
      }),
      prisma.customerPayment.findMany({
        where: { shiftId: shift.id },
        select: { amount: true, paymentMethod: true }
      })
    ]);

    let totalCashSales = 0;
    let totalCardSales = 0;
    let totalCreditSales = 0;
    let totalSalesAmount = 0;

    for (const s of sales) {
      totalSalesAmount += s.netTotal;
      if (s.paymentType === 'Cash') totalCashSales += s.netTotal;
      else if (s.paymentType === 'Card') totalCardSales += s.netTotal;
      else if (s.paymentType === 'Credit') totalCreditSales += s.netTotal;
    }

    let totalReturnsCash = 0;
    for (const r of returns) {
      totalReturnsCash += r.refundAmount;
    }

    let totalCustomerPaymentsCash = 0;
    for (const cp of customerPayments) {
      if (cp.paymentMethod.toLowerCase() === 'cash') totalCustomerPaymentsCash += cp.amount;
    }

    const expectedCash = shift.openingCash + totalCashSales + totalCustomerPaymentsCash - totalReturnsCash;
    const actualCashNum = parseFloat(actual_cash) || 0;
    const difference = actualCashNum - expectedCash;
    const now = new Date();
    const durationMinutes = Math.max(1, Math.round((now.getTime() - new Date(shift.startTime).getTime()) / 60000));

    const updatedShift = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: 'closed',
        endTime: now,
        durationMinutes: durationMinutes,
        closingCash: actualCashNum,
        expectedCash: expectedCash,
        cashDifference: difference,
        totalSalesCount: sales.length,
        totalSalesAmount: totalSalesAmount,
        totalCashSales: totalCashSales,
        totalCardSales: totalCardSales,
        totalCreditSales: totalCreditSales,
        totalReturnsAmount: totalReturnsCash,
        totalCustomerPayments: totalCustomerPaymentsCash,
        notes: notes || shift.notes
      }
    });

    // Shift-close backup runs alongside the schedule unless the Developer switched automatic backups off
    const backupResult = await runShiftCloseBackup({ id: shift.userId, username: shift.userName });

    // Write audit log
    await prisma.auditLog.create({
      data: {
        action: 'SHIFT_CLOSED',
        module: 'Shift Management',
        details: `Shift ${shift.shiftNo} closed by ${user_name || shift.userName}. Duration: ${formatShiftDuration(durationMinutes)}. Expected: ${expectedCash}, Actual: ${actualCashNum}, Variance: ${difference}`,
        userId: user_id ? Number(user_id) : shift.userId,
        userName: user_name || shift.userName
      }
    });

    res.json({
      success: true,
      message: 'Shift reconciled and locked successfully.',
      shift: {
        id: updatedShift.id,
        shift_no: updatedShift.shiftNo,
        user_id: updatedShift.userId,
        user_name: updatedShift.userName,
        start_time: updatedShift.startTime,
        end_time: updatedShift.endTime,
        duration_minutes: updatedShift.durationMinutes,
        opening_cash: updatedShift.openingCash,
        closing_cash: updatedShift.closingCash,
        expected_cash: updatedShift.expectedCash,
        cash_difference: updatedShift.cashDifference,
        total_sales_count: updatedShift.totalSalesCount,
        total_sales_amount: updatedShift.totalSalesAmount,
        total_cash_sales: updatedShift.totalCashSales,
        total_card_sales: updatedShift.totalCardSales,
        total_credit_sales: updatedShift.totalCreditSales,
        total_returns_amount: updatedShift.totalReturnsAmount,
        total_customer_payments: updatedShift.totalCustomerPayments,
        notes: updatedShift.notes,
        status: updatedShift.status
      },
      backup: backupResult
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// 5. List all shifts with filters
router.get('/api/shifts', async (req: Request, res: Response) => {
  try {
    const { user_id, status, date_from, date_to } = req.query;
    const where: Prisma.CashierShiftWhereInput = {};

    if (user_id) where.userId = Number(user_id);
    if (status) where.status = String(status);
    if (date_from || date_to) {
      where.startTime = {};
      if (date_from) where.startTime.gte = new Date(`${date_from}T00:00:00.000Z`);
      if (date_to) where.startTime.lte = new Date(`${date_to}T23:59:59.999Z`);
    }

    const shifts = await prisma.cashierShift.findMany({
      where,
      orderBy: { id: 'desc' }
    });

    const result = await Promise.all(shifts.map(async (s) => {
      if (s.status === 'open') {
        const [sales, returns, customerPayments] = await Promise.all([
          prisma.sale.findMany({
            where: { shiftId: s.id },
            select: { netTotal: true, paymentType: true }
          }),
          prisma.saleReturn.findMany({
            where: { shiftId: s.id },
            select: { refundAmount: true }
          }),
          prisma.customerPayment.findMany({
            where: { shiftId: s.id },
            select: { amount: true, paymentMethod: true }
          })
        ]);

        let totalCashSales = 0;
        let totalCardSales = 0;
        let totalCreditSales = 0;
        let totalSalesAmount = 0;
        for (const sale of sales) {
          totalSalesAmount += sale.netTotal;
          if (sale.paymentType === 'Cash') totalCashSales += sale.netTotal;
          else if (sale.paymentType === 'Card') totalCardSales += sale.netTotal;
          else if (sale.paymentType === 'Credit') totalCreditSales += sale.netTotal;
        }

        const totalReturnsAmount = returns.reduce((sum, r) => sum + r.refundAmount, 0);
        const totalCustomerPayments = customerPayments.filter(p => p.paymentMethod.toLowerCase() === 'cash').reduce((sum, p) => sum + p.amount, 0);
        const expectedCash = s.openingCash + totalCashSales + totalCustomerPayments - totalReturnsAmount;
        const durationMinutes = Math.max(0, Math.floor((Date.now() - new Date(s.startTime).getTime()) / 60000));

        return {
          id: s.id,
          shift_no: s.shiftNo,
          user_id: s.userId,
          user_name: s.userName,
          start_time: s.startTime,
          end_time: s.endTime,
          duration_minutes: durationMinutes,
          opening_cash: s.openingCash,
          closing_cash: s.closingCash,
          expected_cash: expectedCash,
          cash_difference: s.cashDifference,
          total_sales_count: sales.length,
          total_sales_amount: totalSalesAmount,
          total_cash_sales: totalCashSales,
          total_card_sales: totalCardSales,
          total_credit_sales: totalCreditSales,
          total_returns_amount: totalReturnsAmount,
          total_customer_payments: totalCustomerPayments,
          notes: s.notes,
          status: s.status,
          created_at: s.createdAt,
          updated_at: s.updatedAt
        };
      }

      return {
        id: s.id,
        shift_no: s.shiftNo,
        user_id: s.userId,
        user_name: s.userName,
        start_time: s.startTime,
        end_time: s.endTime,
        duration_minutes: s.durationMinutes,
        opening_cash: s.openingCash,
        closing_cash: s.closingCash,
        expected_cash: s.expectedCash,
        cash_difference: s.cashDifference,
        total_sales_count: s.totalSalesCount,
        total_sales_amount: s.totalSalesAmount,
        total_cash_sales: s.totalCashSales,
        total_card_sales: s.totalCardSales,
        total_credit_sales: s.totalCreditSales,
        total_returns_amount: s.totalReturnsAmount,
        total_customer_payments: s.totalCustomerPayments,
        notes: s.notes,
        status: s.status,
        created_at: s.createdAt,
        updated_at: s.updatedAt
      };
    }));

    res.json(result);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// 6. Get shift details with transactions
router.get('/api/shifts/:id', async (req: Request, res: Response) => {
  try {
    const shiftId = Number(req.params.id);
    const shift = await prisma.cashierShift.findUnique({
      where: { id: shiftId },
      include: {
        sales: {
          select: {
            id: true,
            invoiceNo: true,
            customerName: true,
            totalGross: true,
            netTotal: true,
            paymentType: true,
            saleDate: true,
            status: true
          },
          orderBy: { id: 'desc' }
        },
        saleReturns: {
          select: {
            id: true,
            returnNo: true,
            originalInvoiceNo: true,
            customerName: true,
            refundAmount: true,
            reason: true,
            createdAt: true
          },
          orderBy: { id: 'desc' }
        },
        customerPayments: {
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
            notes: true,
            paymentDate: true
          },
          orderBy: { id: 'desc' }
        }
      }
    });

    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    let totalSalesCount = shift.totalSalesCount;
    let totalSalesAmount = shift.totalSalesAmount;
    let totalCashSales = shift.totalCashSales;
    let totalCardSales = shift.totalCardSales;
    let totalCreditSales = shift.totalCreditSales;
    let totalReturnsAmount = shift.totalReturnsAmount;
    let totalCustomerPayments = shift.totalCustomerPayments;
    let expectedCash = shift.expectedCash;
    let durationMinutes = shift.durationMinutes;

    if (shift.status === 'open') {
      totalSalesCount = shift.sales.length;
      totalSalesAmount = 0;
      totalCashSales = 0;
      totalCardSales = 0;
      totalCreditSales = 0;
      for (const s of shift.sales) {
        totalSalesAmount += s.netTotal;
        if (s.paymentType === 'Cash') totalCashSales += s.netTotal;
        else if (s.paymentType === 'Card') totalCardSales += s.netTotal;
        else if (s.paymentType === 'Credit') totalCreditSales += s.netTotal;
      }
      totalReturnsAmount = shift.saleReturns.reduce((sum, r) => sum + r.refundAmount, 0);
      totalCustomerPayments = shift.customerPayments.filter(p => p.paymentMethod.toLowerCase() === 'cash').reduce((sum, p) => sum + p.amount, 0);
      expectedCash = shift.openingCash + totalCashSales + totalCustomerPayments - totalReturnsAmount;
      durationMinutes = Math.max(0, Math.floor((Date.now() - new Date(shift.startTime).getTime()) / 60000));
    }

    res.json({
      shift: {
        id: shift.id,
        shift_no: shift.shiftNo,
        user_id: shift.userId,
        user_name: shift.userName,
        start_time: shift.startTime,
        end_time: shift.endTime,
        duration_minutes: durationMinutes,
        opening_cash: shift.openingCash,
        closing_cash: shift.closingCash,
        expected_cash: expectedCash,
        cash_difference: shift.cashDifference,
        total_sales_count: totalSalesCount,
        total_sales_amount: totalSalesAmount,
        total_cash_sales: totalCashSales,
        total_card_sales: totalCardSales,
        total_credit_sales: totalCreditSales,
        total_returns_amount: totalReturnsAmount,
        total_customer_payments: totalCustomerPayments,
        notes: shift.notes,
        status: shift.status
      },
      sales: shift.sales.map(s => ({
        id: s.id,
        invoice_no: s.invoiceNo,
        customer_name: s.customerName,
        total_gross: s.totalGross,
        net_total: s.netTotal,
        payment_type: s.paymentType,
        sale_date: s.saleDate,
        status: s.status
      })),
      returns: shift.saleReturns.map(r => ({
        id: r.id,
        return_no: r.returnNo,
        original_invoice_no: r.originalInvoiceNo,
        customer_name: r.customerName,
        refund_amount: r.refundAmount,
        reason: r.reason,
        created_at: r.createdAt
      })),
      payments: shift.customerPayments.map(p => ({
        id: p.id,
        amount: p.amount,
        payment_method: p.paymentMethod,
        notes: p.notes,
        payment_date: p.paymentDate
      }))
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// 7. Admin Exceptional Reopen
router.post('/api/shifts/:id/admin/reopen', async (req: Request, res: Response) => {
  try {
    const shiftManager = await getActingUser(req);
    if (!shiftManager || !(await hasRolePermission(shiftManager.role, 'can_manage_shifts'))) {
      return res.status(403).json({ error: 'Access denied: shift management permission required' });
    }
    const shiftId = Number(req.params.id);
    if (!parseBody(shiftReopenSchema, req.body, res)) return;
    const { reason } = req.body;
    // Identity always comes from the login session, never from the request body
    const { admin_id, admin_name } = await sessionIdentity(req);

    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    if (shift.status === 'open') {
      return res.status(400).json({ error: 'Shift is already open.' });
    }

    const updated = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: 'open',
        endTime: null,
        durationMinutes: null
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_SHIFT_REOPEN',
        module: 'Shift Management',
        details: `Shift ${shift.shiftNo} reopened by Admin ${admin_name || 'Admin'} (ID #${admin_id}). Reason: ${reason}`,
        userId: admin_id ? Number(admin_id) : null,
        userName: admin_name || 'Admin'
      }
    });

    res.json({
      success: true,
      message: `Shift ${shift.shiftNo} reopened successfully.`,
      shift: {
        id: updated.id,
        shift_no: updated.shiftNo,
        user_id: updated.userId,
        user_name: updated.userName,
        start_time: updated.startTime,
        end_time: updated.endTime,
        duration_minutes: updated.durationMinutes,
        opening_cash: updated.openingCash,
        closing_cash: updated.closingCash,
        expected_cash: updated.expectedCash,
        cash_difference: updated.cashDifference,
        status: updated.status,
        notes: updated.notes
      }
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// 8. Admin Exceptional Cash Reconciliation Correction
router.post('/api/shifts/:id/admin/correct', async (req: Request, res: Response) => {
  try {
    const shiftManager = await getActingUser(req);
    if (!shiftManager || !(await hasRolePermission(shiftManager.role, 'can_manage_shifts'))) {
      return res.status(403).json({ error: 'Access denied: shift management permission required' });
    }
    const shiftId = Number(req.params.id);
    const { corrected_closing_cash, reason } = req.body;
    // Identity always comes from the login session, never from the request body
    const { admin_id, admin_name } = await sessionIdentity(req);

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A mandatory reason is required for correcting shift cash figures.' });
    }

    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const newClosingCash = parseFloat(corrected_closing_cash) || 0;
    const expected = shift.expectedCash || 0;
    const newDifference = newClosingCash - expected;
    const oldClosingCash = shift.closingCash;

    const updated = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        closingCash: newClosingCash,
        cashDifference: newDifference,
        notes: shift.notes ? `${shift.notes} | [Corrected by ${admin_name}: ${reason}]` : `[Corrected by ${admin_name}: ${reason}]`
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_SHIFT_CORRECT',
        module: 'Shift Management',
        details: `Shift ${shift.shiftNo} closing cash corrected by Admin ${admin_name || 'Admin'}. Old: ${oldClosingCash}, New: ${newClosingCash}, New Variance: ${newDifference}. Reason: ${reason}`,
        userId: admin_id ? Number(admin_id) : null,
        userName: admin_name || 'Admin'
      }
    });

    res.json({
      success: true,
      message: `Shift ${shift.shiftNo} cash figures corrected successfully.`,
      shift: {
        id: updated.id,
        shift_no: updated.shiftNo,
        user_id: updated.userId,
        user_name: updated.userName,
        start_time: updated.startTime,
        end_time: updated.endTime,
        duration_minutes: updated.durationMinutes,
        opening_cash: updated.openingCash,
        closing_cash: updated.closingCash,
        expected_cash: updated.expectedCash,
        cash_difference: updated.cashDifference,
        status: updated.status,
        notes: updated.notes
      }
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// 9. Admin Force-Close an Active Shift (emergency recovery for abandoned shifts)
router.post('/api/shifts/:id/admin/force-close', async (req: Request, res: Response) => {
  try {
    const shiftManager = await getActingUser(req);
    if (!shiftManager || !(await hasRolePermission(shiftManager.role, 'can_manage_shifts'))) {
      return res.status(403).json({ error: 'Access denied: shift management permission required' });
    }
    const shiftId = Number(req.params.id);
    const { actual_cash, notes, reason } = req.body;
    // Identity always comes from the login session, never from the request body
    const { admin_id, admin_name } = await sessionIdentity(req);

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A mandatory administrative reason is required to force-close a shift.' });
    }

    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (shift.status !== 'open') {
      return res.status(400).json({ error: 'Shift is already closed.' });
    }

    const [sales, returns, customerPayments] = await Promise.all([
      prisma.sale.findMany({
        where: { shiftId: shift.id },
        select: { netTotal: true, paymentType: true }
      }),
      prisma.saleReturn.findMany({
        where: { shiftId: shift.id },
        select: { refundAmount: true }
      }),
      prisma.customerPayment.findMany({
        where: { shiftId: shift.id },
        select: { amount: true, paymentMethod: true }
      })
    ]);

    let totalCashSales = 0, totalCardSales = 0, totalCreditSales = 0, totalSalesAmount = 0;
    for (const s of sales) {
      totalSalesAmount += s.netTotal;
      if (s.paymentType === 'Cash') totalCashSales += s.netTotal;
      else if (s.paymentType === 'Card') totalCardSales += s.netTotal;
      else if (s.paymentType === 'Credit') totalCreditSales += s.netTotal;
    }
    let totalReturnsCash = 0;
    for (const r of returns) totalReturnsCash += r.refundAmount;
    let totalCustomerPaymentsCash = 0;
    for (const cp of customerPayments) {
      if (cp.paymentMethod.toLowerCase() === 'cash') totalCustomerPaymentsCash += cp.amount;
    }

    const expectedCash = shift.openingCash + totalCashSales + totalCustomerPaymentsCash - totalReturnsCash;
    const actualCashNum = parseFloat(actual_cash) ?? expectedCash;
    const difference = actualCashNum - expectedCash;
    const now = new Date();
    const durationMinutes = Math.max(1, Math.round((now.getTime() - new Date(shift.startTime).getTime()) / 60000));

    const adminNote = `[Force-Closed by ${admin_name || 'Admin'}: ${String(reason).trim()}]`;
    const updatedShift = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: 'closed',
        endTime: now,
        durationMinutes,
        closingCash: actualCashNum,
        expectedCash,
        cashDifference: difference,
        totalSalesCount: sales.length,
        totalSalesAmount,
        totalCashSales,
        totalCardSales,
        totalCreditSales,
        totalReturnsAmount: totalReturnsCash,
        totalCustomerPayments: totalCustomerPaymentsCash,
        notes: notes ? `${notes} | ${adminNote}` : adminNote
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_SHIFT_FORCE_CLOSE',
        module: 'Shift Management',
        details: `Shift ${shift.shiftNo} force-closed by Admin ${admin_name || 'Admin'} (ID #${admin_id}). Duration: ${formatShiftDuration(durationMinutes)}. Expected: ${expectedCash.toFixed(2)}, Actual: ${actualCashNum.toFixed(2)}, Variance: ${difference.toFixed(2)}. Reason: ${reason}`,
        userId: admin_id ? Number(admin_id) : null,
        userName: admin_name || 'Admin'
      }
    });

    res.json({
      success: true,
      message: `Shift ${shift.shiftNo} has been force-closed by admin.`,
      shift: {
        id: updatedShift.id,
        shift_no: updatedShift.shiftNo,
        user_id: updatedShift.userId,
        user_name: updatedShift.userName,
        start_time: updatedShift.startTime,
        end_time: updatedShift.endTime,
        duration_minutes: updatedShift.durationMinutes,
        opening_cash: updatedShift.openingCash,
        closing_cash: updatedShift.closingCash,
        expected_cash: updatedShift.expectedCash,
        cash_difference: updatedShift.cashDifference,
        total_sales_count: updatedShift.totalSalesCount,
        total_sales_amount: updatedShift.totalSalesAmount,
        total_cash_sales: updatedShift.totalCashSales,
        total_card_sales: updatedShift.totalCardSales,
        total_credit_sales: updatedShift.totalCreditSales,
        total_returns_amount: updatedShift.totalReturnsAmount,
        total_customer_payments: updatedShift.totalCustomerPayments,
        notes: updatedShift.notes,
        status: updatedShift.status
      }
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
