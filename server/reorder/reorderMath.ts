// Reorder (short) list: which medicines to order and how many boxes. Pure, no database imports (unit-tested).

export const SALES_WINDOW_DAYS = 30;
export const MIN_COVER_DAYS = 1;
export const MAX_COVER_DAYS = 60;

export interface ReorderProduct {
  packing: number;
  stockBoxes: number;
  stockLoose: number;
  /** Alert level in boxes (0 = no minimum) */
  minStockAlert: number;
}

export interface ReorderSuggestion {
  stockUnits: number;
  avgDailyUnits: number;
  /** Days the current stock lasts at the recent sales speed (null when nothing sold) */
  daysLeft: number | null;
  reason: 'below_minimum' | 'running_out';
  suggestedBoxes: number;
}

export const clampCoverDays = (value: unknown, fallback: number): number => {
  const n = Math.floor(Number(value));
  const days = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(MAX_COVER_DAYS, Math.max(MIN_COVER_DAYS, days));
};

/**
 * Suggests an order for one medicine, or null when it does not need one.
 * soldUnits: units sold in the last SALES_WINDOW_DAYS days (returns already taken off).
 */
export function suggestReorder(product: ReorderProduct, soldUnits: number, coverDays: number): ReorderSuggestion | null {
  const packing = Math.max(1, product.packing || 1);
  const stockUnits = product.stockBoxes * packing + product.stockLoose;
  const stockInBoxes = stockUnits / packing;
  const avgDailyUnits = Math.max(0, soldUnits) / SALES_WINDOW_DAYS;
  const daysLeft = avgDailyUnits > 0 ? stockUnits / avgDailyUnits : null;

  const belowMinimum = product.minStockAlert > 0 && stockInBoxes <= product.minStockAlert;
  const runningOut = daysLeft !== null && daysLeft < coverDays;
  if (!belowMinimum && !runningOut) return null;

  const toMinimum = product.minStockAlert * 2 - stockInBoxes;
  const toCover = (avgDailyUnits * coverDays - stockUnits) / packing;
  const suggestedBoxes = Math.max(1, Math.ceil(Math.max(toMinimum, toCover) - 1e-9));

  return {
    stockUnits,
    avgDailyUnits: Math.round(avgDailyUnits * 100) / 100,
    daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
    reason: belowMinimum ? 'below_minimum' : 'running_out',
    suggestedBoxes
  };
}
