import { Router, type Request, type Response } from 'express';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { logSecurityAudit } from '../security/audit';
import { dayCloseSchema, parseBody } from '../validation/schemas';
import { hasRolePermission, requirePermission, sendError } from '../http/context';
import { loadDayClose, loadPeriod } from '../dayClose/loadDayClose';
import { closeDay, closeSummary, DayCloseError } from '../dayClose/closeDay';
import type { DayCloseFigures } from '../dayClose/dayCloseMath';
import { localDateString } from '../../shared/dates';

// Day close (M8): the day's sales, returns, cost of goods, expenses and profit, saved in daily_closings.
// A closed day locks its expenses until someone with can_day_close reopens it. Finished days also close on
// their own after midnight (server/dayClose/autoClose.ts).
const router = Router();

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const RANGE_MAX_DAYS = 366;

function figuresPayload(f: DayCloseFigures) {
  return {
    invoices_count: f.invoicesCount,
    sales_total: f.salesTotal,
    sales_cash: f.salesCash,
    sales_card: f.salesCard,
    sales_credit: f.salesCredit,
    returns_count: f.returnsCount,
    returns_total: f.returnsTotal,
    net_sales: f.netSales,
    cost_of_goods: f.costOfGoods,
    gross_profit: f.grossProfit,
    expenses_total: f.expensesTotal,
    expenses_cash: f.expensesCash,
    expenses_by_category: f.expensesByCategory,
    net_profit: f.netProfit,
    customer_payments_cash: f.customerPaymentsCash,
    supplier_paid: f.supplierPaid,
    shifts: {
      count: f.shifts.count,
      open_count: f.shifts.openCount,
      opening_cash: f.shifts.openingCash,
      expected_cash: f.shifts.expectedCash,
      counted_cash: f.shifts.countedCash,
      difference: f.shifts.difference
    }
  };
}

type ClosingRecord = Prisma.DailyClosingGetPayload<object>;

function closingPayload(c: ClosingRecord) {
  return {
    date: c.closingDate,
    is_closed: c.isClosed === 1,
    closing_time: c.closingTime,
    user_name: c.userName,
    auto_closed: c.autoClosed === 1,
    notes: c.notes,
    invoices_count: c.invoicesCount,
    sales_cash: c.totalSalesCash,
    sales_card: c.totalSalesCard,
    sales_credit: c.totalSalesCredit,
    returns_total: c.totalReturns,
    cost_of_goods: c.totalCostOfGoods,
    expenses_total: c.expensesTotal,
    net_profit: c.netProfit,
    supplier_paid: c.totalPurchasesPaid,
    customer_payments_cash: c.customerPaymentsCash,
    opening_cash: c.openingCash,
    expected_cash: c.expectedCash,
    counted_cash: c.actualCash,
    difference: c.difference,
    open_shifts_at_close: c.openShiftsAtClose
  };
}

const canView = async (req: Request, res: Response) =>
  (await requirePermission(req, res, 'reports', 'You do not have access to reports.')) &&
  requirePermission(req, res, 'can_view_financial_kpis', 'You do not have permission to view profit and revenue reports.');

router.get('/api/day-close/history', async (req: Request, res: Response) => {
  try {
    if (!(await canView(req, res))) return;
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 366);
    const rows = await prisma.dailyClosing.findMany({ orderBy: { closingDate: 'desc' }, take: limit });
    res.json(rows.map(closingPayload));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.get('/api/day-close/range', async (req: Request, res: Response) => {
  try {
    if (!(await canView(req, res))) return;
    const { from, to } = req.query;
    if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'Choose the From and To dates.' });
    if (from > to) return res.status(400).json({ error: 'The From date must be on or before the To date.' });
    if (to > localDateString()) return res.status(400).json({ error: 'The To date cannot be in the future.' });
    const days = Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000) + 1;
    if (days > RANGE_MAX_DAYS) return res.status(400).json({ error: `Choose at most ${RANGE_MAX_DAYS} days.` });

    const [period, closings] = await Promise.all([
      loadPeriod(from, to),
      prisma.dailyClosing.findMany({ where: { closingDate: { gte: from, lte: to } } })
    ]);
    const closingByDate = new Map(closings.map(c => [c.closingDate, c]));
    res.json({
      from,
      to,
      totals: figuresPayload(period.totals),
      days: period.days.map(({ date, figures }) => {
        const c = closingByDate.get(date);
        return {
          date,
          invoices_count: figures.invoicesCount,
          sales_total: figures.salesTotal,
          returns_total: figures.returnsTotal,
          net_sales: figures.netSales,
          cost_of_goods: figures.costOfGoods,
          gross_profit: figures.grossProfit,
          expenses_total: figures.expensesTotal,
          net_profit: figures.netProfit,
          closing: c ? { is_closed: c.isClosed === 1, auto_closed: c.autoClosed === 1, user_name: c.userName } : null
        };
      }),
      open_shifts: period.openShifts
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.get('/api/day-close', async (req: Request, res: Response) => {
  try {
    const actor = await canView(req, res);
    if (!actor) return;
    const today = localDateString();
    const date = isDate(req.query.date) ? req.query.date : today;
    const [{ figures, openShifts }, closing] = await Promise.all([
      loadDayClose(date),
      prisma.dailyClosing.findUnique({ where: { closingDate: date } })
    ]);
    res.json({
      date,
      today,
      figures: figuresPayload(figures),
      closing: closing ? closingPayload(closing) : null,
      open_shifts: openShifts,
      can_close: await hasRolePermission(actor.role, 'can_day_close')
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/day-close', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_day_close', 'You do not have permission to close the day.');
    if (!actor) return;
    const body = parseBody(dayCloseSchema, req.body, res);
    if (!body) return;
    if (body.date > localDateString()) return res.status(400).json({ error: 'A day in the future cannot be closed.' });

    const { saved, figures, openShifts } = await closeDay(body.date, actor, body.notes || null);

    await logSecurityAudit({
      action: 'DAY_CLOSED',
      module: 'Day Close',
      details: closeSummary(body.date, figures, openShifts.length),
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true, closing: closingPayload(saved) });
  } catch (error: unknown) {
    sendError(res, error, error instanceof DayCloseError ? error.status : 400);
  }
});

router.post('/api/day-close/:date/reopen', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_day_close', 'You do not have permission to reopen the day.');
    if (!actor) return;
    const date = req.params.date;
    if (!isDate(date)) return res.status(400).json({ error: 'Choose the day to reopen.' });

    const reopened = await prisma.dailyClosing.updateMany({ where: { closingDate: date, isClosed: 1 }, data: { isClosed: 0 } });
    if (reopened.count === 0) return res.status(409).json({ error: 'This day is not closed.' });

    await logSecurityAudit({
      action: 'DAY_REOPENED',
      module: 'Day Close',
      details: `Day ${date} reopened; its expenses can be changed again`,
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
