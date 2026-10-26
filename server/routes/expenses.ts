import { Router, type Request, type Response } from 'express';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { logSecurityAudit } from '../security/audit';
import { expenseSchema, parseBody } from '../validation/schemas';
import { hasRolePermission, requirePermission, sendError, type Actor } from '../http/context';
import { localDateString } from '../../shared/dates';
import { DEFAULT_EXPENSE_CATEGORIES } from '../../shared/expenses';

// Shop expenses (M8). A cash expense paid during the user's open shift lowers that shift's expected cash.
const router = Router();

type Db = typeof prisma | Prisma.TransactionClient;

/** A refusal with its own status code (our message reaches the screen through sendError) */
class ExpenseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const DAY_CLOSED = 'This day is closed. Reopen the day close to change its expenses.';
const SHIFT_CLOSED = 'This cash expense belongs to a closed shift, whose cash count is final. Ask a manager to reopen the shift first.';
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

async function assertDayOpen(db: Db, date: string) {
  const closing = await db.dailyClosing.findUnique({ where: { closingDate: date }, select: { isClosed: true } });
  if (closing?.isClosed === 1) throw new ExpenseError(DAY_CLOSED, 409);
}

/** The open shift a cash expense dated today is paid from: the owner's own open shift, if any */
async function drawerShiftId(db: Db, userId: number | null, method: string, date: string): Promise<number | null> {
  if (method !== 'cash' || date !== localDateString() || !userId) return null;
  const shift = await db.cashierShift.findFirst({ where: { userId, status: 'open' }, select: { id: true } });
  return shift?.id ?? null;
}

const actorName = (actor: Actor) => actor.fullName || actor.username;

type ExpenseRecord = Prisma.ExpenseGetPayload<{ include: { shift: { select: { shiftNo: true; status: true } } } }>;

function expensePayload(e: ExpenseRecord, closedDates: Set<string>) {
  const lockedReason = closedDates.has(e.expenseDate) ? DAY_CLOSED : e.shift?.status === 'closed' ? SHIFT_CLOSED : null;
  return {
    id: e.id,
    category: e.category,
    amount: e.amount,
    payment_method: e.paymentMethod,
    reference: e.reference,
    notes: e.notes,
    expense_date: e.expenseDate,
    shift_id: e.shiftId,
    shift_no: e.shift?.shiftNo ?? null,
    user_id: e.userId,
    user_name: e.userName,
    created_at: e.createdAt,
    locked_reason: lockedReason
  };
}

router.get('/api/expenses', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'expenses', 'You do not have access to shop expenses.');
    if (!actor) return;
    // Managers (who close the day) see everyone's expenses; others see their own
    const seeAll = await hasRolePermission(actor.role, 'can_day_close');
    const { date_from, date_to, category } = req.query;
    const expenseDate: Prisma.StringFilter = {};
    if (isDate(date_from)) expenseDate.gte = date_from;
    if (isDate(date_to)) expenseDate.lte = date_to;

    const where: Prisma.ExpenseWhereInput = {
      ...(Object.keys(expenseDate).length ? { expenseDate } : {}),
      ...(typeof category === 'string' && category.trim() ? { category: category.trim() } : {}),
      ...(seeAll ? {} : { userId: actor.id })
    };
    const [expenses, used] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: { shift: { select: { shiftNo: true, status: true } } },
        orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
        take: 1000
      }),
      prisma.expense.findMany({ distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } })
    ]);

    const dates = [...new Set(expenses.map(e => e.expenseDate))];
    const closed = dates.length
      ? await prisma.dailyClosing.findMany({ where: { closingDate: { in: dates }, isClosed: 1 }, select: { closingDate: true } })
      : [];
    const closedDates = new Set(closed.map(c => c.closingDate));

    res.json({
      expenses: expenses.map(e => expensePayload(e, closedDates)),
      total: round2(expenses.reduce((sum, e) => sum + e.amount, 0)),
      categories: [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...used.map(u => u.category)])],
      closed_dates: [...closedDates],
      sees_all: seeAll
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/expenses', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_add_expense', 'You do not have permission to record expenses.');
    if (!actor) return;
    const body = parseBody(expenseSchema, req.body, res);
    if (!body) return;
    const date = body.expense_date ?? localDateString();
    if (date > localDateString()) return res.status(400).json({ error: 'An expense cannot be dated in the future.' });
    const method = body.payment_method ?? 'cash';
    const amount = round2(body.amount);

    // Checked and written together, so a day close at the same moment cannot slip in between
    const created = await prisma.$transaction(async (tx) => {
      await assertDayOpen(tx, date);
      return tx.expense.create({
        data: {
          category: body.category,
          amount,
          paymentMethod: method,
          reference: body.reference || null,
          notes: body.notes || null,
          expenseDate: date,
          shiftId: await drawerShiftId(tx, actor.id, method, date),
          userId: actor.id,
          userName: actorName(actor)
        }
      });
    });

    await logSecurityAudit({
      action: 'EXPENSE_ADDED',
      module: 'Expenses',
      details: `Expense ${amount.toFixed(2)} (${created.category}, ${method}) for ${date}${created.shiftId ? ' paid from the shift drawer' : ''}`,
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true, id: created.id, shift_id: created.shiftId });
  } catch (error: unknown) {
    sendError(res, error, error instanceof ExpenseError ? error.status : 400);
  }
});

/** Loads an expense the actor may change, or throws why not */
async function changeableExpense(db: Db, actor: Actor, id: number) {
  const expense = await db.expense.findUnique({ where: { id }, include: { shift: { select: { status: true } } } });
  if (!expense) throw new ExpenseError('Expense not found.', 404);
  if (expense.userId !== actor.id && !(await hasRolePermission(actor.role, 'can_day_close'))) {
    throw new ExpenseError('You can only change expenses you recorded.', 403);
  }
  await assertDayOpen(db, expense.expenseDate);
  if (expense.shift?.status === 'closed') throw new ExpenseError(SHIFT_CLOSED, 409);
  return expense;
}

router.put('/api/expenses/:id', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_add_expense', 'You do not have permission to change expenses.');
    if (!actor) return;
    const body = parseBody(expenseSchema, req.body, res);
    if (!body) return;
    const id = Number(req.params.id) || 0;

    const { before, after } = await prisma.$transaction(async (tx) => {
      const existing = await changeableExpense(tx, actor, id);
      const date = body.expense_date ?? existing.expenseDate;
      if (date > localDateString()) throw new ExpenseError('An expense cannot be dated in the future.', 400);
      if (date !== existing.expenseDate) await assertDayOpen(tx, date);
      const method = body.payment_method ?? existing.paymentMethod;
      // Still cash on the same day: it stays with its shift; otherwise it is linked again (or unlinked)
      const shiftId = method === 'cash' && date === existing.expenseDate && existing.shiftId
        ? existing.shiftId
        : await drawerShiftId(tx, existing.userId, method, date);
      const updated = await tx.expense.update({
        where: { id: existing.id },
        data: {
          category: body.category,
          amount: round2(body.amount),
          paymentMethod: method,
          reference: body.reference || null,
          notes: body.notes || null,
          expenseDate: date,
          shiftId
        }
      });
      return { before: existing, after: updated };
    });

    await logSecurityAudit({
      action: 'EXPENSE_UPDATED',
      module: 'Expenses',
      details: `Expense #${after.id} changed: ${before.amount.toFixed(2)} ${before.category} (${before.paymentMethod}, ${before.expenseDate}) → ${after.amount.toFixed(2)} ${after.category} (${after.paymentMethod}, ${after.expenseDate})`,
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, error instanceof ExpenseError ? error.status : 400);
  }
});

router.delete('/api/expenses/:id', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_add_expense', 'You do not have permission to delete expenses.');
    if (!actor) return;
    const id = Number(req.params.id) || 0;

    const removed = await prisma.$transaction(async (tx) => {
      const existing = await changeableExpense(tx, actor, id);
      await tx.expense.delete({ where: { id: existing.id } });
      return existing;
    });

    await logSecurityAudit({
      action: 'EXPENSE_DELETED',
      module: 'Expenses',
      details: `Expense #${removed.id} deleted: ${removed.amount.toFixed(2)} ${removed.category} (${removed.paymentMethod}, ${removed.expenseDate}, by ${removed.userName ?? 'unknown'})`,
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, error instanceof ExpenseError ? error.status : 400);
  }
});

export default router;
