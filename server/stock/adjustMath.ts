// Stock counts and adjustments (M9). Pure, no database imports (unit-tested).
import { ADJUST_REASON_DIRECTION, ADJUST_REASON_LABELS, type AdjustReason } from '../../shared/stockAdjust';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Counted minus what the system held when the line was counted */
export const countDelta = (systemUnits: number, countedUnits: number) => countedUnits - systemUnits;

/**
 * Stock after applying a count line. The difference is taken against the stock at counting time, so sales made
 * between counting and applying stay sold: new = current + (counted - system at count), never below 0.
 */
export function applyCountLine(currentUnits: number, systemAtCount: number, countedUnits: number): number {
  return Math.max(0, currentUnits + countDelta(systemAtCount, countedUnits));
}

/** Why an adjustment cannot be made, or null when it can */
export function adjustmentError(reason: AdjustReason, delta: number, currentUnits: number): string | null {
  if (!Number.isInteger(delta) || delta === 0) return 'Enter how much stock to add or take off.';
  const direction = ADJUST_REASON_DIRECTION[reason];
  if (direction === 'out' && delta > 0) return `"${ADJUST_REASON_LABELS[reason]}" can only lower the stock.`;
  if (direction === 'in' && delta < 0) return `"${ADJUST_REASON_LABELS[reason]}" can only add stock.`;
  if (currentUnits + delta < 0) return 'Stock cannot go below zero.';
  return null;
}

/** Cost of one unit: box trade price shared over the packing */
export const unitCost = (boxTradePrice: number, packing: number) => round2((boxTradePrice || 0) / Math.max(1, packing || 1));

/** Value of a change at cost: negative = loss, positive = gain */
export const adjustmentValue = (deltaUnits: number, cost: number) => round2(deltaUnits * cost);

export interface AdjustmentTotals {
  count: number;
  lossUnits: number;
  gainUnits: number;
  lossValue: number;
  gainValue: number;
  netValue: number;
}

export function adjustmentTotals(rows: Array<{ deltaUnits: number; unitCost: number }>): AdjustmentTotals {
  const totals = { count: rows.length, lossUnits: 0, gainUnits: 0, lossValue: 0, gainValue: 0, netValue: 0 };
  for (const row of rows) {
    const value = adjustmentValue(row.deltaUnits, row.unitCost);
    if (row.deltaUnits < 0) {
      totals.lossUnits += -row.deltaUnits;
      totals.lossValue += -value;
    } else {
      totals.gainUnits += row.deltaUnits;
      totals.gainValue += value;
    }
  }
  totals.lossValue = round2(totals.lossValue);
  totals.gainValue = round2(totals.gainValue);
  totals.netValue = round2(totals.gainValue - totals.lossValue);
  return totals;
}
