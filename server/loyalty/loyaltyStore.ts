import type { LoyaltyPlan, Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import type { Actor } from '../http/context';
import { localDateString } from '../../shared/dates';
import { consumeOldestFirst, planForSpend, UPGRADE_WINDOW_DAYS, type LoyaltyPlanRules } from '../../shared/loyalty';

// Loyalty points ledger (M10). Rules live in shared/loyalty.ts. Callers pass their transaction, so the ledger rows,
// the lots' remaining points and the cached customers.loyalty_points always change together.
// Plus rows (earn, redeem_refunded, positive adjust) are "lots" with remaining points; minus rows use the oldest first.

type Db = typeof prisma | Prisma.TransactionClient;

export const LOYALTY_UNAVAILABLE = 'Loyalty points are not available for this store.';

/** Rows that add points and can later be used or expire */
const LOT_TYPES = ['earn', 'redeem_refunded', 'adjust'];

async function settingValues(db: Db) {
  const rows = await db.systemSetting.findMany({ where: { key: { in: ['loyalty_feature_allowed', 'loyalty_enabled'] } } });
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

/** The Developer allowed loyalty for this store */
export async function loyaltyAllowed(db: Db = prisma): Promise<boolean> {
  return (await settingValues(db)).loyalty_feature_allowed === 'true';
}

/** Allowed by the Developer and switched on by the Admin: only then are points earned and used */
export async function loyaltyActive(db: Db = prisma): Promise<boolean> {
  const s = await settingValues(db);
  return s.loyalty_feature_allowed === 'true' && s.loyalty_enabled === 'true';
}

export function planRules(plan: LoyaltyPlan): LoyaltyPlanRules {
  return {
    name: plan.name,
    pointsPer100: plan.pointsPer100,
    pointValue: plan.pointValue,
    minBillToEarn: plan.minBillToEarn,
    discountPct: plan.discountPct,
    minRedeemPoints: plan.minRedeemPoints,
    maxRedeemPct: plan.maxRedeemPct,
    expiryMonths: plan.expiryMonths,
    earnOnCredit: plan.earnOnCredit === 1,
    upgradeSpend: plan.upgradeSpend
  };
}

/** Client contract for a plan */
export function planPayload(plan: LoyaltyPlan, members?: number) {
  return {
    id: plan.id,
    name: plan.name,
    points_per_100: plan.pointsPer100,
    point_value: plan.pointValue,
    min_bill_to_earn: plan.minBillToEarn,
    discount_pct: plan.discountPct,
    min_redeem_points: plan.minRedeemPoints,
    max_redeem_pct: plan.maxRedeemPct,
    expiry_months: plan.expiryMonths,
    earn_on_credit: plan.earnOnCredit === 1,
    upgrade_spend: plan.upgradeSpend,
    is_default: plan.isDefault === 1,
    status: plan.status,
    ...(members !== undefined ? { members } : {})
  };
}

export async function defaultPlan(db: Db): Promise<LoyaltyPlan | null> {
  return db.loyaltyPlan.findFirst({ where: { isDefault: 1, status: 'active' } });
}

/** The customer's plan; a customer without one is on the default plan. An archived plan still serves its members. */
export async function planOf(db: Db, customer: { loyaltyPlanId: number | null }): Promise<LoyaltyPlan | null> {
  if (customer.loyaltyPlanId) {
    const plan = await db.loyaltyPlan.findUnique({ where: { id: customer.loyaltyPlanId } });
    if (plan) return plan;
  }
  return defaultPlan(db);
}

const actorName = (actor: Actor | null) => (actor ? actor.fullName || actor.username : 'System');

/** Sets the cached balance from the ledger and returns it */
export async function recomputeBalance(db: Db, customerId: number): Promise<number> {
  const sum = await db.loyaltyTransaction.aggregate({ where: { customerId }, _sum: { points: true } });
  const balance = Math.max(0, sum._sum.points ?? 0);
  await db.customer.update({ where: { id: customerId }, data: { loyaltyPoints: balance } });
  return balance;
}

/** Points whose expiry date has come are written off (an expire row per lot) */
export async function expireDuePoints(db: Db, customerId: number, today: string = localDateString()): Promise<number> {
  const due = await db.loyaltyTransaction.findMany({
    where: { customerId, type: { in: LOT_TYPES }, remaining: { gt: 0 }, expiresAt: { not: null, lte: today } }
  });
  let expired = 0;
  for (const lot of due) {
    await db.loyaltyTransaction.update({ where: { id: lot.id }, data: { remaining: 0 } });
    await db.loyaltyTransaction.create({
      data: { customerId, type: 'expire', points: -lot.remaining, notes: `Points from ${lot.createdAt.toISOString().slice(0, 10)} expired on ${lot.expiresAt}`, userName: 'System' }
    });
    expired += lot.remaining;
  }
  if (expired > 0) await recomputeBalance(db, customerId);
  return expired;
}

/** Uses points from the lots, earliest expiry first (or from the named lots first). Returns how many could not be taken. */
async function takeFromLots(db: Db, customerId: number, points: number, preferLotIds: number[] = []): Promise<number> {
  let left = points;
  if (preferLotIds.length) {
    const preferred = await db.loyaltyTransaction.findMany({ where: { id: { in: preferLotIds }, remaining: { gt: 0 } } });
    for (const lot of preferred) {
      if (left <= 0) break;
      const take = Math.min(left, lot.remaining);
      await db.loyaltyTransaction.update({ where: { id: lot.id }, data: { remaining: lot.remaining - take } });
      left -= take;
    }
  }
  if (left <= 0) return 0;
  const lots = await db.loyaltyTransaction.findMany({ where: { customerId, type: { in: LOT_TYPES }, remaining: { gt: 0 } } });
  const { allocations, short } = consumeOldestFirst(lots.map(l => ({ id: l.id, remaining: l.remaining, expiresAt: l.expiresAt })), left);
  for (const a of allocations) {
    const lot = lots.find(l => l.id === a.id)!;
    await db.loyaltyTransaction.update({ where: { id: a.id }, data: { remaining: lot.remaining - a.points } });
  }
  return short;
}

interface Entry {
  customerId: number;
  saleId?: number | null;
  saleReturnId?: number | null;
  notes?: string | null;
  actor: Actor | null;
}

/** Adds points as a new lot (earned, given back, or a plus adjustment) */
export async function addPoints(db: Db, type: 'earn' | 'redeem_refunded' | 'adjust', points: number, expiresAt: string | null, entry: Entry) {
  if (points <= 0) return null;
  return db.loyaltyTransaction.create({
    data: {
      customerId: entry.customerId,
      saleId: entry.saleId ?? null,
      saleReturnId: entry.saleReturnId ?? null,
      type,
      points,
      remaining: points,
      expiresAt,
      notes: entry.notes ?? null,
      userId: entry.actor?.id ?? null,
      userName: actorName(entry.actor)
    }
  });
}

/**
 * Takes points away (used on a bill, taken back on a return, minus adjustment). Never below zero: when the customer
 * no longer has enough, only what is there is taken and the row says so. Returns the points taken.
 */
export async function removePoints(db: Db, type: 'redeem' | 'earn_reversed' | 'adjust', points: number, entry: Entry & { preferLotIds?: number[] }): Promise<number> {
  if (points <= 0) return 0;
  const short = await takeFromLots(db, entry.customerId, points, entry.preferLotIds);
  const taken = points - short;
  if (taken <= 0 && type !== 'earn_reversed') return 0;
  await db.loyaltyTransaction.create({
    data: {
      customerId: entry.customerId,
      saleId: entry.saleId ?? null,
      saleReturnId: entry.saleReturnId ?? null,
      type,
      points: -taken,
      remaining: 0,
      notes: [entry.notes, short > 0 ? `${short} point(s) were already used, so they could not be taken back` : null].filter(Boolean).join('. ') || null,
      userId: entry.actor?.id ?? null,
      userName: actorName(entry.actor)
    }
  });
  return taken;
}

/** Net buying in the last 12 months: invoices (not fully returned) minus refunds */
export async function spendLastYear(db: Db, customerId: number, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - UPGRADE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [sales, refunds] = await Promise.all([
    db.sale.aggregate({ where: { customerId, saleDate: { gte: since }, status: { in: ['completed', 'partially_returned'] } }, _sum: { netTotal: true } }),
    db.saleReturn.aggregate({ where: { sale: { customerId, status: 'partially_returned' }, createdAt: { gte: since } }, _sum: { refundAmount: true } })
  ]);
  return Math.max(0, (sales._sum.netTotal ?? 0) - (refunds._sum.refundAmount ?? 0));
}

/** Moves the customer up to the best plan their buying has reached (never down). Returns the new plan or null. */
export async function maybeUpgrade(db: Db, customerId: number, actor: Actor | null): Promise<LoyaltyPlan | null> {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return null;
  const current = await planOf(db, customer);
  const plans = await db.loyaltyPlan.findMany({ where: { status: 'active', upgradeSpend: { gt: 0 } } });
  if (!plans.length) return null;
  const spend = await spendLastYear(db, customerId);
  const next = planForSpend(plans, current?.upgradeSpend ?? 0, spend);
  if (!next || next.id === current?.id) return null;
  await db.customer.update({ where: { id: customerId }, data: { loyaltyPlanId: next.id } });
  await db.loyaltyTransaction.create({
    data: {
      customerId,
      type: 'plan_change',
      points: 0,
      notes: `Moved up from ${current?.name ?? 'no plan'} to ${next.name} after ${Math.round(spend)} of buying in 12 months`,
      userId: actor?.id ?? null,
      userName: 'System'
    }
  });
  return next;
}
