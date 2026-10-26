import { Router, type Request, type Response } from 'express';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { logSecurityAudit } from '../security/audit';
import { customerPlanSchema, loyaltyAdjustSchema, loyaltyPlanSchema, parseBody } from '../validation/schemas';
import { getActingUser, hasRolePermission, requirePermission, sendError, type Actor } from '../http/context';
import {
  addPoints, defaultPlan, expireDuePoints, LOYALTY_UNAVAILABLE, loyaltyActive, loyaltyAllowed, planOf, planPayload,
  recomputeBalance, removePoints, spendLastYear
} from '../loyalty/loyaltyStore';
import { expiryDate, LOYALTY_TEMPLATES } from '../../shared/loyalty';
import { localDateString } from '../../shared/dates';

// Loyalty plans, members and points (M10). Nothing here works until the Developer allows loyalty for the store.
const router = Router();

const MANAGE_DENIED = 'You do not have permission to manage loyalty points.';
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The Developer gate first, then the permission */
async function requireLoyalty(req: Request, res: Response, permission = 'can_manage_loyalty'): Promise<Actor | null> {
  if (!(await loyaltyAllowed())) {
    res.status(403).json({ error: LOYALTY_UNAVAILABLE });
    return null;
  }
  return requirePermission(req, res, permission, MANAGE_DENIED);
}

const planData = (body: NonNullable<ReturnType<typeof loyaltyPlanSchema.parse>>) => ({
  name: body.name.trim(),
  pointsPer100: body.points_per_100,
  pointValue: body.point_value,
  minBillToEarn: body.min_bill_to_earn,
  discountPct: body.discount_pct,
  minRedeemPoints: body.min_redeem_points,
  maxRedeemPct: body.max_redeem_pct,
  expiryMonths: body.expiry_months,
  earnOnCredit: body.earn_on_credit ? 1 : 0,
  upgradeSpend: body.upgrade_spend
});

async function nameTaken(name: string, exceptId?: number) {
  const plans = await prisma.loyaltyPlan.findMany({ select: { id: true, name: true } });
  return plans.some(p => p.id !== exceptId && p.name.trim().toLowerCase() === name.trim().toLowerCase());
}

router.get('/api/loyalty/plans', async (req: Request, res: Response) => {
  try {
    if (!(await requireLoyalty(req, res))) return;
    const plans = await prisma.loyaltyPlan.findMany({ orderBy: [{ status: 'asc' }, { upgradeSpend: 'asc' }, { id: 'asc' }], include: { _count: { select: { customers: true } } } });
    res.json(plans.map(p => planPayload(p, p._count.customers)));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.get('/api/loyalty/templates', async (req: Request, res: Response) => {
  try {
    if (!(await requireLoyalty(req, res))) return;
    res.json(LOYALTY_TEMPLATES.map(t => ({
      key: t.key,
      description: t.description,
      name: t.name,
      points_per_100: t.pointsPer100,
      point_value: t.pointValue,
      min_bill_to_earn: t.minBillToEarn,
      discount_pct: t.discountPct,
      min_redeem_points: t.minRedeemPoints,
      max_redeem_pct: t.maxRedeemPct,
      expiry_months: t.expiryMonths,
      earn_on_credit: t.earnOnCredit,
      upgrade_spend: t.upgradeSpend
    })));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/loyalty/plans', async (req: Request, res: Response) => {
  try {
    const actor = await requireLoyalty(req, res);
    if (!actor) return;
    const body = parseBody(loyaltyPlanSchema, req.body, res);
    if (!body) return;
    if (await nameTaken(body.name)) return res.status(409).json({ error: `A plan named "${body.name.trim()}" already exists.` });
    const plan = await prisma.$transaction(async (tx) => {
      // The first plan becomes the default, so new customers always land somewhere
      const isDefault = body.is_default || (await tx.loyaltyPlan.count({ where: { isDefault: 1, status: 'active' } })) === 0;
      if (isDefault) await tx.loyaltyPlan.updateMany({ where: { isDefault: 1 }, data: { isDefault: 0 } });
      return tx.loyaltyPlan.create({ data: { ...planData(body), isDefault: isDefault ? 1 : 0 } });
    });
    await logSecurityAudit({ action: 'LOYALTY_PLAN_CREATED', module: 'Loyalty', details: `Plan "${plan.name}" created`, userId: actor.id, userName: actor.username });
    res.json({ success: true, plan: planPayload(plan) });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.put('/api/loyalty/plans/:id', async (req: Request, res: Response) => {
  try {
    const actor = await requireLoyalty(req, res);
    if (!actor) return;
    const body = parseBody(loyaltyPlanSchema, req.body, res);
    if (!body) return;
    const id = Number(req.params.id) || 0;
    const existing = await prisma.loyaltyPlan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Plan not found' });
    if (await nameTaken(body.name, id)) return res.status(409).json({ error: `A plan named "${body.name.trim()}" already exists.` });
    const plan = await prisma.$transaction(async (tx) => {
      if (body.is_default) await tx.loyaltyPlan.updateMany({ where: { isDefault: 1, id: { not: id } }, data: { isDefault: 0 } });
      return tx.loyaltyPlan.update({
        where: { id },
        data: { ...planData(body), ...(body.is_default ? { isDefault: 1, status: 'active' } : {}) }
      });
    });
    await logSecurityAudit({ action: 'LOYALTY_PLAN_UPDATED', module: 'Loyalty', details: `Plan "${plan.name}" changed`, userId: actor.id, userName: actor.username });
    res.json({ success: true, plan: planPayload(plan) });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

// Archived plans take no new members (members keep it); restoring makes it active again
router.post('/api/loyalty/plans/:id/archive', async (req: Request, res: Response) => {
  try {
    const actor = await requireLoyalty(req, res);
    if (!actor) return;
    const id = Number(req.params.id) || 0;
    const plan = await prisma.loyaltyPlan.findUnique({ where: { id } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const archive = req.body?.restore !== true;
    if (archive && plan.isDefault === 1) return res.status(409).json({ error: 'Choose another default plan before archiving this one.' });
    await prisma.loyaltyPlan.update({ where: { id }, data: { status: archive ? 'archived' : 'active' } });
    await logSecurityAudit({ action: archive ? 'LOYALTY_PLAN_ARCHIVED' : 'LOYALTY_PLAN_RESTORED', module: 'Loyalty', details: `Plan "${plan.name}"`, userId: actor.id, userName: actor.username });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.delete('/api/loyalty/plans/:id', async (req: Request, res: Response) => {
  try {
    const actor = await requireLoyalty(req, res);
    if (!actor) return;
    const id = Number(req.params.id) || 0;
    const plan = await prisma.loyaltyPlan.findUnique({ where: { id }, include: { _count: { select: { customers: true } } } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const usedOnSales = await prisma.sale.count({ where: { loyaltyPlanName: plan.name } });
    if (plan._count.customers > 0 || usedOnSales > 0) {
      return res.status(409).json({ error: `"${plan.name}" has been used by customers. Archive it instead.` });
    }
    if (plan.isDefault === 1) return res.status(409).json({ error: 'Choose another default plan before deleting this one.' });
    await prisma.loyaltyPlan.delete({ where: { id } });
    await logSecurityAudit({ action: 'LOYALTY_PLAN_DELETED', module: 'Loyalty', details: `Plan "${plan.name}" deleted`, userId: actor.id, userName: actor.username });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Members with their plan, points and value
router.get('/api/loyalty/members', async (req: Request, res: Response) => {
  try {
    if (!(await requireLoyalty(req, res))) return;
    const planId = Number(req.query.plan_id) || null;
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const fallback = await defaultPlan(prisma);
    const plans = await prisma.loyaltyPlan.findMany();
    const where: Prisma.CustomerWhereInput = {};
    if (planId) where.OR = [{ loyaltyPlanId: planId }, ...(fallback?.id === planId ? [{ loyaltyPlanId: null }] : [])];
    const customers = await prisma.customer.findMany({ where, orderBy: [{ loyaltyPoints: 'desc' }, { name: 'asc' }] });
    const filtered = q ? customers.filter(c => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)) : customers;
    const last = await prisma.loyaltyTransaction.groupBy({ by: ['customerId'], _max: { createdAt: true }, where: { customerId: { in: filtered.map(c => c.id) } } });
    const lastBy = new Map(last.map(l => [l.customerId, l._max.createdAt]));
    const rows = filtered.map(c => {
      const plan = plans.find(p => p.id === c.loyaltyPlanId) ?? fallback;
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        plan_id: plan?.id ?? null,
        plan_name: plan?.name ?? null,
        points: c.loyaltyPoints,
        points_value: plan ? round2(c.loyaltyPoints * plan.pointValue) : 0,
        last_activity: lastBy.get(c.id) ?? null
      };
    });
    res.json({
      members: rows,
      totals: { members: rows.length, points: rows.reduce((s, r) => s + r.points, 0), value: round2(rows.reduce((s, r) => s + r.points_value, 0)) }
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// One customer's points, plan and history (counter staff see it too)
router.get('/api/customers/:id/loyalty', async (req: Request, res: Response) => {
  try {
    if (!(await loyaltyAllowed())) return res.status(403).json({ error: LOYALTY_UNAVAILABLE });
    const actor = await getActingUser(req);
    if (!actor || !((await hasRolePermission(actor.role, 'khata')) || (await hasRolePermission(actor.role, 'pos')))) {
      return res.status(403).json({ error: 'You do not have permission to see customers.' });
    }
    const id = Number(req.params.id) || 0;
    if (!(await prisma.customer.findUnique({ where: { id } }))) return res.status(404).json({ error: 'Customer not found' });
    await prisma.$transaction(tx => expireDuePoints(tx, id));
    const customer = (await prisma.customer.findUnique({ where: { id } }))!;
    const plan = await planOf(prisma, customer);
    const soon = localDateString(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    const expiring = await prisma.loyaltyTransaction.aggregate({
      where: { customerId: id, remaining: { gt: 0 }, expiresAt: { not: null, lte: soon } },
      _sum: { remaining: true }
    });
    const history = await prisma.loyaltyTransaction.findMany({ where: { customerId: id }, orderBy: { id: 'desc' }, take: 300 });
    const invoices = new Map((await prisma.sale.findMany({
      where: { id: { in: history.map(h => h.saleId).filter((s): s is number => s !== null) } }, select: { id: true, invoiceNo: true }
    })).map(s => [s.id, s.invoiceNo]));
    res.json({
      customer_id: customer.id,
      name: customer.name,
      points: customer.loyaltyPoints,
      points_value: plan ? round2(customer.loyaltyPoints * plan.pointValue) : 0,
      plan: plan ? planPayload(plan) : null,
      plan_assigned: customer.loyaltyPlanId !== null,
      spend_12m: round2(await spendLastYear(prisma, id)),
      expiring_30d: expiring._sum.remaining ?? 0,
      active: await loyaltyActive(),
      history: history.map(h => ({
        id: h.id,
        type: h.type,
        points: h.points,
        remaining: h.remaining,
        expires_at: h.expiresAt,
        invoice_no: h.saleId ? invoices.get(h.saleId) ?? null : null,
        notes: h.notes,
        user_name: h.userName,
        created_at: h.createdAt
      }))
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Manual points change with a reason (a gift, a correction)
router.post('/api/customers/:id/loyalty/adjust', async (req: Request, res: Response) => {
  try {
    const actor = await requireLoyalty(req, res);
    if (!actor) return;
    const body = parseBody(loyaltyAdjustSchema, req.body, res);
    if (!body) return;
    const id = Number(req.params.id) || 0;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (body.points < 0 && -body.points > customer.loyaltyPoints) {
      return res.status(400).json({ error: `${customer.name} has only ${customer.loyaltyPoints} points.` });
    }
    const balance = await prisma.$transaction(async (tx) => {
      const entry = { customerId: id, notes: body.notes, actor };
      if (body.points > 0) {
        const plan = await planOf(tx, customer);
        await addPoints(tx, 'adjust', body.points, expiryDate(localDateString(), plan?.expiryMonths ?? 0), entry);
      } else {
        await removePoints(tx, 'adjust', -body.points, entry);
      }
      return recomputeBalance(tx, id);
    });
    await logSecurityAudit({
      action: 'LOYALTY_POINTS_ADJUSTED',
      module: 'Loyalty',
      details: `${customer.name}: ${body.points > 0 ? '+' : ''}${body.points} points (${body.notes}), balance ${customer.loyaltyPoints} -> ${balance}`,
      affectedUser: customer.name,
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true, points: balance });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

// Put a customer on a plan (null = the default plan)
router.put('/api/customers/:id/plan', async (req: Request, res: Response) => {
  try {
    const actor = await requireLoyalty(req, res);
    if (!actor) return;
    const body = parseBody(customerPlanSchema, req.body, res);
    if (!body) return;
    const id = Number(req.params.id) || 0;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const before = await planOf(prisma, customer);
    const plan = body.plan_id ? await prisma.loyaltyPlan.findUnique({ where: { id: body.plan_id } }) : null;
    if (body.plan_id && (!plan || plan.status !== 'active')) return res.status(400).json({ error: 'Choose an active plan.' });
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { loyaltyPlanId: plan?.id ?? null } });
      await tx.loyaltyTransaction.create({
        data: {
          customerId: id,
          type: 'plan_change',
          points: 0,
          notes: `Plan changed from ${before?.name ?? 'none'} to ${plan?.name ?? 'the default plan'}`,
          userId: actor.id,
          userName: actor.fullName || actor.username
        }
      });
    });
    await logSecurityAudit({
      action: 'LOYALTY_PLAN_ASSIGNED',
      module: 'Loyalty',
      details: `${customer.name}: ${before?.name ?? 'none'} -> ${plan?.name ?? 'default plan'}`,
      affectedUser: customer.name,
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
