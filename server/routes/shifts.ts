import { Router, type Request, type Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { runShiftCloseBackup } from '../backup/scheduler';
import { parseBody, shiftReopenSchema } from '../validation/schemas';
import { getActingUser, sessionIdentity, hasRolePermission, hasAnyPermission, sendError, SESSION_REQUIRED_ERROR, type Actor } from '../http/context';
import { logDenied } from '../security/audit';
import { loadShiftTotals } from '../shifts/loadShiftTotals';
import type { ShiftTotals } from '../shifts/shiftTotals';
import { localDateKey } from '../../shared/dates';
import { requestTerminal } from '../lan/lanGate';

// Cashier shifts and drawer reconciliation
const router = Router();

type ShiftRecord = Prisma.CashierShiftGetPayload<object>;

const OTHER_SHIFT_DENIED = 'You can only see your own shifts.';

/** Shift managers see every cashier's shifts; everyone else only their own */
const canSeeAllShifts = (actor: Actor) => hasAnyPermission(actor.role, ['shifts', 'can_manage_shifts']);

/** The signed-in user when they may read this shift; otherwise answers (401/403) and returns null */
async function shiftReader(req: Request, res: Response, shift: { userId: number }): Promise<Actor | null> {
  const actor = await getActingUser(req);
  if (!actor) {
    res.status(401).json(SESSION_REQUIRED_ERROR);
    return null;
  }
  if (shift.userId === actor.id || await canSeeAllShifts(actor)) return actor;
  await logDenied(actor, 'can_manage_shifts', req);
  res.status(403).json({ error: OTHER_SHIFT_DENIED });
  return null;
}

/** A shift in the client's snake_case shape; open shifts show live totals, closed ones their saved figures */
function shiftPayload(shift: ShiftRecord, live: ShiftTotals | null, durationMinutes: number | null) {
  return {
    id: shift.id,
    shift_no: shift.shiftNo,
    user_id: shift.userId,
    user_name: shift.userName,
    start_time: shift.startTime,
    end_time: shift.endTime,
    duration_minutes: durationMinutes,
    opening_cash: shift.openingCash,
    closing_cash: shift.closingCash,
    expected_cash: live ? live.expectedCash : shift.expectedCash,
    cash_difference: shift.cashDifference,
    total_sales_count: live ? live.salesCount : shift.totalSalesCount,
    total_sales_amount: live ? live.totalSalesAmount : shift.totalSalesAmount,
    total_cash_sales: live ? live.totalCashSales : shift.totalCashSales,
    total_card_sales: live ? live.totalCardSales : shift.totalCardSales,
    total_credit_sales: live ? live.totalCreditSales : shift.totalCreditSales,
    total_returns_amount: live ? live.totalReturnsCash : shift.totalReturnsAmount,
    total_customer_payments: live ? live.totalCustomerPaymentsCash : shift.totalCustomerPayments,
    total_expenses_cash: live ? live.totalExpensesCash : shift.totalExpensesCash,
    notes: shift.notes,
    status: shift.status,
    terminal_id: shift.terminalId,
    terminal_name: shift.terminalName,
    created_at: shift.createdAt,
    updated_at: shift.updatedAt
  };
}

function summaryPayload(shift: ShiftRecord, totals: ShiftTotals, durationMinutes: number) {
  return {
    opening_cash: shift.openingCash,
    total_sales_cash: totals.totalCashSales,
    total_sales_card: totals.totalCardSales,
    total_sales_credit: totals.totalCreditSales,
    total_returns_cash: totals.totalReturnsCash,
    total_customer_payments_cash: totals.totalCustomerPaymentsCash,
    total_expenses_cash: totals.totalExpensesCash,
    expected_cash: totals.expectedCash,
    invoices_count: totals.salesCount,
    returns_count: totals.returnsCount,
    duration_formatted: formatShiftDuration(durationMinutes)
  };
}

const minutesSince = (start: Date, end: Date = new Date()) =>
  Math.max(0, Math.floor((end.getTime() - new Date(start).getTime()) / 60000));

/** Closes an open shift with its final totals. Fails if it was closed meanwhile (two closes at once). */
async function closeShiftRecord(shift: ShiftRecord, closingCash: number, notes: string | null) {
  return prisma.$transaction(async (tx) => {
    const totals = await loadShiftTotals(shift, tx);
    const now = new Date();
    const durationMinutes = Math.max(1, Math.round((now.getTime() - new Date(shift.startTime).getTime()) / 60000));
    const difference = Math.round((closingCash - totals.expectedCash) * 100) / 100;
    const closed = await tx.cashierShift.updateMany({
      where: { id: shift.id, status: 'open' },
      data: {
        status: 'closed',
        endTime: now,
        durationMinutes,
        closingCash,
        expectedCash: totals.expectedCash,
        cashDifference: difference,
        totalSalesCount: totals.salesCount,
        totalSalesAmount: totals.totalSalesAmount,
        totalCashSales: totals.totalCashSales,
        totalCardSales: totals.totalCardSales,
        totalCreditSales: totals.totalCreditSales,
        totalReturnsAmount: totals.totalReturnsCash,
        totalCustomerPayments: totals.totalCustomerPaymentsCash,
        totalExpensesCash: totals.totalExpensesCash,
        notes
      }
    });
    if (closed.count === 0) throw new Error('Shift is already closed and locked.');
    const updated = await tx.cashierShift.findUniqueOrThrow({ where: { id: shift.id } });
    return { updated, totals, durationMinutes, difference };
  });
}

/** A cash amount from the request: a finite number of at least 0, or null */
function cashAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function formatShiftDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// 1. The signed-in user's own open shift (a user_id in the query is ignored)
router.get('/api/shifts/active', async (req: Request, res: Response) => {
  try {
    const actor = await getActingUser(req);
    if (!actor) return res.status(401).json(SESSION_REQUIRED_ERROR);

    const shift = await prisma.cashierShift.findFirst({
      where: {
        userId: actor.id,
        status: 'open'
      },
      orderBy: { id: 'desc' }
    });

    if (!shift) {
      return res.json({ activeShift: null });
    }

    const totals = await loadShiftTotals(shift);
    const elapsedMinutes = minutesSince(shift.startTime);
    res.json({
      activeShift: shiftPayload(shift, totals, elapsedMinutes),
      summary: summaryPayload(shift, totals, elapsedMinutes)
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
    const openingCash = opening_cash === undefined || opening_cash === '' ? 0 : cashAmount(opening_cash);
    if (openingCash === null) {
      return res.status(400).json({ error: 'Opening cash must be a number of 0 or more.' });
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

    // Unique shift number, e.g. SH-YYYYMMDD-0001. Two counters may start shifts at the same moment (LAN mode),
    // so a number taken in between is retried with the next one.
    const today = localDateKey();
    const terminal = requestTerminal(res);
    let newShift: Awaited<ReturnType<typeof prisma.cashierShift.create>> | null = null;
    for (let attempt = 0; !newShift; attempt++) {
      const countToday = await prisma.cashierShift.count({
        where: { shiftNo: { startsWith: `SH-${today}-` } }
      });
      try {
        newShift = await prisma.cashierShift.create({
          data: {
            shiftNo: `SH-${today}-${String(countToday + 1 + attempt).padStart(4, '0')}`,
            userId: Number(user_id),
            userName: user_name || 'Cashier',
            startTime: new Date(),
            openingCash,
            notes: notes || null,
            status: 'open',
            terminalId: terminal?.id ?? null,
            terminalName: terminal?.name ?? null
          }
        });
      } catch (err: any) {
        if (err?.code === 'P2002' || String(err?.message).includes('Unique constraint')) {
          // Another counter opened a shift for this user at the same moment (one open shift per user index)
          const raced = await prisma.cashierShift.findFirst({ where: { userId: Number(user_id), status: 'open' } });
          if (raced) {
            return res.status(400).json({
              error: `User already has an active open shift (${raced.shiftNo}). You must close it before starting a new one.`,
              activeShift: raced
            });
          }
          if (attempt < 4) continue;
        }
        throw err;
      }
    }
    const shiftNo = newShift.shiftNo;

    await prisma.auditLog.create({
      data: {
        action: 'SHIFT_OPENED',
        module: 'Shift Management',
        details: `Shift ${shiftNo} opened by ${user_name} with opening float ${openingCash}`,
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
    if (!(await shiftReader(req, res, shift))) return;

    const totals = await loadShiftTotals(shift);
    const durationMinutes = Math.max(1, minutesSince(shift.startTime, shift.endTime || new Date()));
    // A closed shift keeps the figures it was closed with
    const live = shift.status === 'open' ? totals : null;
    res.json({
      shift: shiftPayload(shift, live, durationMinutes),
      summary: summaryPayload(shift, live ? totals : {
        ...totals,
        totalCashSales: shift.totalCashSales,
        totalCardSales: shift.totalCardSales,
        totalCreditSales: shift.totalCreditSales,
        totalReturnsCash: shift.totalReturnsAmount,
        totalCustomerPaymentsCash: shift.totalCustomerPayments,
        totalExpensesCash: shift.totalExpensesCash,
        expectedCash: shift.expectedCash ?? totals.expectedCash
      }, durationMinutes)
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

    // A cashier closes their own shift with the closing permission; someone else's needs shift management
    const actor = await getActingUser(req);
    if (!actor) return res.status(401).json(SESSION_REQUIRED_ERROR);
    if (shift.userId !== actor.id && !(await hasRolePermission(actor.role, 'can_manage_shifts'))) {
      await logDenied(actor, 'can_manage_shifts', req);
      return res.status(403).json({ error: 'You can only close your own shift.' });
    }
    if (shift.userId === actor.id && !(await hasRolePermission(actor.role, 'can_shift_close'))) {
      await logDenied(actor, 'can_shift_close', req);
      return res.status(403).json({ error: 'You do not have permission to close shifts. Ask a manager to close it.' });
    }

    const actualCashNum = cashAmount(actual_cash);
    if (actualCashNum === null) {
      return res.status(400).json({ error: 'Enter the cash counted in the drawer (0 or more).' });
    }
    const { updated: updatedShift, totals, durationMinutes, difference } = await closeShiftRecord(shift, actualCashNum, notes || shift.notes);
    const expectedCash = totals.expectedCash;

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
      shift: shiftPayload(updatedShift, null, updatedShift.durationMinutes),
      backup: backupResult
    });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

// 5. List all shifts with filters
router.get('/api/shifts', async (req: Request, res: Response) => {
  try {
    const actor = await getActingUser(req);
    if (!actor) return res.status(401).json(SESSION_REQUIRED_ERROR);
    const { user_id, status, date_from, date_to } = req.query;
    const where: Prisma.CashierShiftWhereInput = {};

    // Without shift management only the user's own shifts are listed, whatever the query asks
    if (!(await canSeeAllShifts(actor))) where.userId = actor.id;
    else if (user_id) where.userId = Number(user_id);
    if (status) where.status = String(status);
    // Dates are the shop's local calendar days
    if (date_from || date_to) {
      where.startTime = {};
      if (date_from) where.startTime.gte = new Date(`${date_from}T00:00:00`);
      if (date_to) where.startTime.lte = new Date(`${date_to}T23:59:59.999`);
    }

    const shifts = await prisma.cashierShift.findMany({
      where,
      orderBy: { id: 'desc' }
    });

    const result = await Promise.all(shifts.map(async (s) =>
      s.status === 'open'
        ? shiftPayload(s, await loadShiftTotals(s), minutesSince(s.startTime))
        : shiftPayload(s, null, s.durationMinutes)
    ));

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
        },
        expenses: {
          select: { id: true, category: true, amount: true, paymentMethod: true, notes: true, createdAt: true },
          orderBy: { id: 'desc' }
        }
      }
    });

    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (!(await shiftReader(req, res, shift))) return;

    const live = shift.status === 'open' ? await loadShiftTotals(shift) : null;
    res.json({
      shift: shiftPayload(shift, live, live ? minutesSince(shift.startTime) : shift.durationMinutes),
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
      })),
      expenses: shift.expenses.map(e => ({
        id: e.id,
        category: e.category,
        amount: e.amount,
        payment_method: e.paymentMethod,
        notes: e.notes,
        created_at: e.createdAt
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
    if (shift.userId) {
      const otherOpen = await prisma.cashierShift.findFirst({ where: { userId: shift.userId, status: 'open' }, select: { shiftNo: true } });
      if (otherOpen) {
        return res.status(400).json({ error: `${shift.userName} already has an open shift (${otherOpen.shiftNo}). Close it before reopening this one.` });
      }
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
      shift: shiftPayload(updated, null, updated.durationMinutes)
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

    const newClosingCash = cashAmount(corrected_closing_cash);
    if (newClosingCash === null) {
      return res.status(400).json({ error: 'Enter the corrected cash amount (0 or more).' });
    }
    const expected = shift.expectedCash || 0;
    const newDifference = Math.round((newClosingCash - expected) * 100) / 100;
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
      shift: shiftPayload(updated, null, updated.durationMinutes)
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

    // No count given: the drawer is taken as holding exactly the expected cash
    const counted = cashAmount(actual_cash);
    if (actual_cash !== undefined && actual_cash !== null && actual_cash !== '' && counted === null) {
      return res.status(400).json({ error: 'Enter the cash counted in the drawer (0 or more).' });
    }
    const adminNote = `[Force-Closed by ${admin_name || 'Admin'}: ${String(reason).trim()}]`;
    const expectedNow = (await loadShiftTotals(shift)).expectedCash;
    const { updated: updatedShift, totals, durationMinutes, difference } =
      await closeShiftRecord(shift, counted ?? expectedNow, notes ? `${notes} | ${adminNote}` : adminNote);
    const expectedCash = totals.expectedCash;
    const actualCashNum = updatedShift.closingCash ?? 0;

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
      shift: shiftPayload(updatedShift, null, updatedShift.durationMinutes)
    });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
