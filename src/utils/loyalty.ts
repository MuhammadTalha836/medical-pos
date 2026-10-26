import type { LoyaltyPlan } from '../types';
import type { LoyaltyPlanRules } from '../../shared/loyalty';

/** The API's plan (snake_case) as the shared rules (camelCase) */
export const planRulesOf = (plan: Pick<LoyaltyPlan, 'name' | 'points_per_100' | 'point_value' | 'min_bill_to_earn' | 'discount_pct' | 'min_redeem_points' | 'max_redeem_pct' | 'expiry_months' | 'earn_on_credit' | 'upgrade_spend'>): LoyaltyPlanRules => ({
  name: plan.name,
  pointsPer100: plan.points_per_100,
  pointValue: plan.point_value,
  minBillToEarn: plan.min_bill_to_earn,
  discountPct: plan.discount_pct,
  minRedeemPoints: plan.min_redeem_points,
  maxRedeemPct: plan.max_redeem_pct,
  expiryMonths: plan.expiry_months,
  earnOnCredit: plan.earn_on_credit,
  upgradeSpend: plan.upgrade_spend
});

/** Loyalty runs only when the Developer allowed it and the Admin switched it on */
export const loyaltyOn = (settings?: { loyalty_feature_allowed?: string; loyalty_enabled?: string } | null) =>
  settings?.loyalty_feature_allowed === 'true' && settings?.loyalty_enabled === 'true';
