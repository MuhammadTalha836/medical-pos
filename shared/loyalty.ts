// Loyalty points and member plans (M10). Pure rules shared by the server (which prices every sale) and the POS
// (which shows the same numbers before saving). No database imports (unit-tested in loyalty.spec.ts).

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 1e-9;

export interface LoyaltyPlanRules {
  name: string;
  /** Points earned for every Rs 100 actually paid */
  pointsPer100: number;
  /** Rupees one point is worth when redeemed */
  pointValue: number;
  /** Bills below this earn no points */
  minBillToEarn: number;
  /** Member discount on the bill, applied automatically */
  discountPct: number;
  /** Fewest points that can be used at once */
  minRedeemPoints: number;
  /** Largest share of a bill that points may pay */
  maxRedeemPct: number;
  /** Points expire this many months after they were earned; 0 = never */
  expiryMonths: number;
  /** Udhaar (credit) sales earn points too */
  earnOnCredit: boolean;
  /** Customers move up to this plan after this much buying in 12 months; 0 = no automatic move */
  upgradeSpend: number;
}

export const LOYALTY_PLAN_NAME_MAX = 40;
export const LOYALTY_NOTES_MAX = 200;
export const LOYALTY_ADJUST_MAX = 1_000_000;
/** How far back buying counts for an automatic plan upgrade */
export const UPGRADE_WINDOW_DAYS = 365;

/** Ready-made plans the Admin can add and then change */
export const LOYALTY_TEMPLATES: Array<LoyaltyPlanRules & { key: string; description: string }> = [
  {
    key: 'regular', name: 'Regular', description: 'Every saved customer: 1 point per Rs 100, 1 point = Rs 1.',
    pointsPer100: 1, pointValue: 1, minBillToEarn: 100, discountPct: 0, minRedeemPoints: 50, maxRedeemPct: 20,
    expiryMonths: 12, earnOnCredit: false, upgradeSpend: 0
  },
  {
    key: 'silver', name: 'Silver', description: 'Regular buyers: more points and 2% off, from Rs 25,000 a year.',
    pointsPer100: 1.5, pointValue: 1, minBillToEarn: 100, discountPct: 2, minRedeemPoints: 50, maxRedeemPct: 25,
    expiryMonths: 12, earnOnCredit: false, upgradeSpend: 25000
  },
  {
    key: 'gold', name: 'Gold', description: 'Best customers: 2 points and 5% off, from Rs 75,000 a year.',
    pointsPer100: 2, pointValue: 1, minBillToEarn: 100, discountPct: 5, minRedeemPoints: 50, maxRedeemPct: 30,
    expiryMonths: 12, earnOnCredit: false, upgradeSpend: 75000
  },
  {
    key: 'chronic', name: 'Chronic Care', description: 'Monthly medicine patients (sugar, BP, heart): 5% off, points never expire, udhaar earns too.',
    pointsPer100: 2, pointValue: 1, minBillToEarn: 0, discountPct: 5, minRedeemPoints: 50, maxRedeemPct: 30,
    expiryMonths: 0, earnOnCredit: true, upgradeSpend: 0
  }
];

/** Why a plan's rules are not usable, or null */
export function planRulesError(plan: LoyaltyPlanRules): string | null {
  if (!plan.name.trim()) return 'Give the plan a name.';
  if (plan.name.trim().length > LOYALTY_PLAN_NAME_MAX) return `The plan name cannot exceed ${LOYALTY_PLAN_NAME_MAX} characters.`;
  if (!(plan.pointsPer100 >= 0 && plan.pointsPer100 <= 100)) return 'Points per Rs 100 must be between 0 and 100.';
  if (!(plan.pointValue > 0 && plan.pointValue <= 1000)) return 'A point must be worth more than Rs 0 (at most Rs 1000).';
  if (!(plan.minBillToEarn >= 0)) return 'The smallest bill that earns points cannot be negative.';
  if (!(plan.discountPct >= 0 && plan.discountPct <= 100)) return 'The member discount must be between 0% and 100%.';
  if (!(Number.isInteger(plan.minRedeemPoints) && plan.minRedeemPoints >= 0)) return 'The fewest points to use must be a whole number.';
  if (!(plan.maxRedeemPct >= 0 && plan.maxRedeemPct <= 100)) return 'The share of a bill points may pay must be between 0% and 100%.';
  if (!(Number.isInteger(plan.expiryMonths) && plan.expiryMonths >= 0 && plan.expiryMonths <= 120)) return 'Expiry must be 0 (never) to 120 months.';
  if (!(plan.upgradeSpend >= 0)) return 'The buying amount for an upgrade cannot be negative.';
  return null;
}

/**
 * The member discount on top of any bill discount the cashier gave. It needs no discount permission, but the two
 * together never pass the store's maximum bill discount.
 */
export function memberDiscount(subtotal: number, planPct: number, requestedBillPct: number, maxBillPct: number): { pct: number; amount: number } {
  const room = Math.max(0, Math.min(100, maxBillPct) - Math.max(0, requestedBillPct));
  const pct = round2(Math.max(0, Math.min(planPct, room)));
  return { pct, amount: round2(Math.max(0, subtotal) * pct / 100) };
}

/** The most points that can be used on a bill (0 when fewer than the plan's minimum would be allowed) */
export function redeemLimit(balance: number, bill: number, plan: Pick<LoyaltyPlanRules, 'pointValue' | 'maxRedeemPct' | 'minRedeemPoints'>): number {
  if (!(plan.pointValue > 0) || bill <= 0 || balance <= 0) return 0;
  const byBill = Math.floor((bill * plan.maxRedeemPct) / 100 / plan.pointValue + EPS);
  const limit = Math.max(0, Math.min(Math.floor(balance), byBill));
  return limit < plan.minRedeemPoints ? 0 : limit;
}

/** Why these points cannot be used, or null */
export function redeemError(points: number, balance: number, bill: number, plan: Pick<LoyaltyPlanRules, 'pointValue' | 'maxRedeemPct' | 'minRedeemPoints'>): string | null {
  if (!Number.isInteger(points) || points < 0) return 'Points to use must be a whole number.';
  if (points === 0) return null;
  if (points > balance) return `The customer has only ${Math.max(0, balance)} points.`;
  if (points < plan.minRedeemPoints) return `At least ${plan.minRedeemPoints} points must be used at a time.`;
  const byBill = Math.floor((bill * plan.maxRedeemPct) / 100 / plan.pointValue + EPS);
  if (points > byBill) return `Points can pay at most ${plan.maxRedeemPct}% of this bill (${Math.max(0, byBill)} points).`;
  return null;
}

/** Points for a paid bill: on what was actually paid, after discounts and points */
export function pointsEarned(paid: number, plan: Pick<LoyaltyPlanRules, 'pointsPer100' | 'minBillToEarn' | 'earnOnCredit'>, paymentType: string): number {
  if (paymentType === 'Credit' && !plan.earnOnCredit) return 0;
  if (paid <= 0 || paid + EPS < plan.minBillToEarn) return 0;
  return Math.max(0, Math.floor((paid / 100) * plan.pointsPer100 + EPS));
}

export interface LoyaltyBill {
  memberDiscountPct: number;
  memberDiscountAmt: number;
  pointsRedeemed: number;
  pointsRedeemedValue: number;
  netTotal: number;
}

/**
 * Applies a plan to a bill already totalled: member discount on the subtotal, then the points used.
 * `netBefore` is the subtotal minus the bill discount. Throws when the points cannot be used.
 */
export function applyLoyalty(
  bill: { subtotal: number; billDiscountPct: number; netBefore: number },
  plan: LoyaltyPlanRules,
  maxBillPct: number,
  balance: number,
  redeemPoints: number
): LoyaltyBill {
  const member = memberDiscount(bill.subtotal, plan.discountPct, bill.billDiscountPct, maxBillPct);
  const afterMember = round2(Math.max(0, bill.netBefore - member.amount));
  const error = redeemError(redeemPoints, balance, afterMember, plan);
  if (error) throw new Error(error);
  const value = round2(Math.min(afterMember, redeemPoints * plan.pointValue));
  return {
    memberDiscountPct: member.pct,
    memberDiscountAmt: member.amount,
    pointsRedeemed: redeemPoints,
    pointsRedeemedValue: value,
    netTotal: round2(Math.max(0, afterMember - value))
  };
}

/** YYYY-MM-DD the points of `date` expire on; null = never */
export function expiryDate(date: string, months: number): string | null {
  if (!months || months <= 0) return null;
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export interface PointsLot {
  id: number;
  remaining: number;
  expiresAt: string | null;
}

/** Which earned points to use: the earliest to expire first, never-expiring ones last, then oldest */
export function consumeOldestFirst(lots: PointsLot[], points: number): { allocations: Array<{ id: number; points: number }>; short: number } {
  const ordered = lots.filter(l => l.remaining > 0).sort((a, b) =>
    (a.expiresAt === null ? 1 : 0) - (b.expiresAt === null ? 1 : 0) ||
    (a.expiresAt ?? '').localeCompare(b.expiresAt ?? '') ||
    a.id - b.id
  );
  const allocations: Array<{ id: number; points: number }> = [];
  let left = Math.max(0, points);
  for (const lot of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, lot.remaining);
    allocations.push({ id: lot.id, points: take });
    left -= take;
  }
  return { allocations, short: left };
}

/** The plan a customer moves up to after `spend` of buying, or null. Never moves anyone down. */
export function planForSpend<T extends { id: number; upgradeSpend: number; status: string }>(plans: T[], currentUpgradeSpend: number, spend: number): T | null {
  const candidates = plans.filter(p => p.status === 'active' && p.upgradeSpend > 0 && p.upgradeSpend <= spend + EPS && p.upgradeSpend > currentUpgradeSpend);
  return candidates.sort((a, b) => b.upgradeSpend - a.upgradeSpend)[0] ?? null;
}

/** Share of an invoice returned so far (0..1), by each line's net amount */
export function returnedShare(
  sold: Array<{ key: string; quantity: number; netAmount: number }>,
  returned: Array<{ key: string; quantity: number }>
): number {
  const lines = new Map<string, { quantity: number; net: number }>();
  for (const line of sold) {
    const entry = lines.get(line.key) ?? { quantity: 0, net: 0 };
    entry.quantity += line.quantity;
    entry.net += line.netAmount;
    lines.set(line.key, entry);
  }
  const total = [...lines.values()].reduce((s, l) => s + l.net, 0);
  const returnedQty = new Map<string, number>();
  for (const r of returned) returnedQty.set(r.key, (returnedQty.get(r.key) ?? 0) + r.quantity);
  if (total <= 0) {
    // Nothing was charged: share by quantity
    const qty = [...lines.values()].reduce((s, l) => s + l.quantity, 0);
    const back = [...lines.entries()].reduce((s, [k, l]) => s + Math.min(l.quantity, returnedQty.get(k) ?? 0), 0);
    return qty > 0 ? Math.min(1, back / qty) : 0;
  }
  let back = 0;
  for (const [key, line] of lines) {
    const qty = Math.min(line.quantity, returnedQty.get(key) ?? 0);
    if (line.quantity > 0) back += (line.net * qty) / line.quantity;
  }
  return Math.min(1, back / total);
}

/** Points still to take back (or give back) so the total matches the returned share; a full return settles all of it */
export function shareDue(total: number, share: number, alreadyDone: number): number {
  const target = share >= 1 - EPS ? total : Math.round(total * share);
  return Math.max(0, target - alreadyDone);
}

/** Plain-language example for a plan, shown under its rules */
export function planExample(plan: LoyaltyPlanRules, money: (value: number) => string): string {
  const earned = pointsEarned(1000, plan, 'Cash');
  const parts = [`A ${money(1000)} bill earns ${earned} point${earned === 1 ? '' : 's'} (worth ${money(round2(earned * plan.pointValue))}).`];
  parts.push(`100 points pay ${money(round2(100 * plan.pointValue))}, up to ${plan.maxRedeemPct}% of a bill.`);
  if (plan.discountPct > 0) parts.push(`Members also get ${plan.discountPct}% off every bill.`);
  parts.push(plan.expiryMonths > 0 ? `Points expire after ${plan.expiryMonths} months.` : 'Points never expire.');
  return parts.join(' ');
}
