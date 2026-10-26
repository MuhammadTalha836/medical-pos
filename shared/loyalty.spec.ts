import { describe, expect, it } from 'vitest';
import {
  LOYALTY_TEMPLATES, applyLoyalty, consumeOldestFirst, expiryDate, memberDiscount, planForSpend, planRulesError,
  pointsEarned, redeemError, redeemLimit, returnedShare, shareDue, type LoyaltyPlanRules
} from './loyalty';

const plan: LoyaltyPlanRules = {
  name: 'Test', pointsPer100: 1, pointValue: 1, minBillToEarn: 100, discountPct: 5, minRedeemPoints: 50,
  maxRedeemPct: 20, expiryMonths: 12, earnOnCredit: false, upgradeSpend: 0
};

describe('earning', () => {
  it('earns on what was paid, rounded down', () => {
    expect(pointsEarned(1250, plan, 'Cash')).toBe(12);
    expect(pointsEarned(1250, { ...plan, pointsPer100: 1.5 }, 'Card')).toBe(18);
  });

  it('nothing below the minimum bill, and nothing on credit unless the plan allows it', () => {
    expect(pointsEarned(99, plan, 'Cash')).toBe(0);
    expect(pointsEarned(500, plan, 'Credit')).toBe(0);
    expect(pointsEarned(500, { ...plan, earnOnCredit: true }, 'Credit')).toBe(5);
  });
});

describe('member discount', () => {
  it('applies the plan percentage', () => {
    expect(memberDiscount(1000, 5, 0, 14)).toEqual({ pct: 5, amount: 50 });
  });

  it('together with the bill discount stays within the store maximum', () => {
    expect(memberDiscount(1000, 5, 12, 14)).toEqual({ pct: 2, amount: 20 });
    expect(memberDiscount(1000, 5, 14, 14)).toEqual({ pct: 0, amount: 0 });
  });
});

describe('redeeming', () => {
  it('is limited by the balance and the share of the bill', () => {
    expect(redeemLimit(500, 1000, plan)).toBe(200);
    expect(redeemLimit(120, 1000, plan)).toBe(120);
    expect(redeemLimit(40, 1000, plan)).toBe(0); // below the minimum of 50
    expect(redeemLimit(500, 0, plan)).toBe(0);
  });

  it('explains what is wrong', () => {
    expect(redeemError(0, 10, 1000, plan)).toBeNull();
    expect(redeemError(100, 500, 1000, plan)).toBeNull();
    expect(redeemError(1.5, 500, 1000, plan)).toMatch(/whole number/);
    expect(redeemError(600, 500, 1000, plan)).toMatch(/only 500 points/);
    expect(redeemError(20, 500, 1000, plan)).toMatch(/At least 50/);
    expect(redeemError(250, 500, 1000, plan)).toMatch(/at most 20%/);
  });

  it('applies the member discount, then the points', () => {
    const bill = applyLoyalty({ subtotal: 1000, billDiscountPct: 0, netBefore: 1000 }, plan, 14, 500, 150);
    expect(bill).toEqual({ memberDiscountPct: 5, memberDiscountAmt: 50, pointsRedeemed: 150, pointsRedeemedValue: 150, netTotal: 800 });
    expect(() => applyLoyalty({ subtotal: 1000, billDiscountPct: 0, netBefore: 1000 }, plan, 14, 500, 300)).toThrow(/at most 20%/);
  });
});

describe('expiry and order of use', () => {
  it('adds months, keeping month ends valid', () => {
    expect(expiryDate('2026-10-26', 12)).toBe('2027-10-26');
    expect(expiryDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(expiryDate('2026-01-31', 0)).toBeNull();
  });

  it('uses the points that expire first, never-expiring ones last', () => {
    const lots = [
      { id: 1, remaining: 30, expiresAt: null },
      { id: 2, remaining: 20, expiresAt: '2027-05-01' },
      { id: 3, remaining: 10, expiresAt: '2027-01-01' }
    ];
    expect(consumeOldestFirst(lots, 35)).toEqual({ allocations: [{ id: 3, points: 10 }, { id: 2, points: 20 }, { id: 1, points: 5 }], short: 0 });
    expect(consumeOldestFirst(lots, 70).short).toBe(10);
  });
});

describe('plans', () => {
  const plans = [
    { id: 1, upgradeSpend: 0, status: 'active' },
    { id: 2, upgradeSpend: 25000, status: 'active' },
    { id: 3, upgradeSpend: 75000, status: 'active' },
    { id: 4, upgradeSpend: 50000, status: 'archived' }
  ];

  it('moves up to the highest plan reached, never down', () => {
    expect(planForSpend(plans, 0, 30000)?.id).toBe(2);
    expect(planForSpend(plans, 0, 80000)?.id).toBe(3);
    expect(planForSpend(plans, 75000, 30000)).toBeNull();
    expect(planForSpend(plans, 0, 1000)).toBeNull();
  });

  it('the ready-made templates are valid', () => {
    for (const t of LOYALTY_TEMPLATES) expect(planRulesError(t)).toBeNull();
    expect(planRulesError({ ...plan, pointValue: 0 })).toMatch(/worth/);
  });
});

describe('returns', () => {
  const sold = [{ key: 'a', quantity: 2, netAmount: 600 }, { key: 'b', quantity: 1, netAmount: 400 }];

  it('shares by the net amount of what came back', () => {
    expect(returnedShare(sold, [{ key: 'a', quantity: 1 }])).toBeCloseTo(0.3);
    expect(returnedShare(sold, [{ key: 'a', quantity: 2 }, { key: 'b', quantity: 1 }])).toBe(1);
  });

  it('a full return settles everything, partial ones round', () => {
    expect(shareDue(12, 0.3, 0)).toBe(4);
    expect(shareDue(12, 1, 4)).toBe(8);
    expect(shareDue(12, 0.3, 4)).toBe(0);
  });
});
