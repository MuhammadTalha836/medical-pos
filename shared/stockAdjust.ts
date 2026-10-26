// Stock counts and adjustments (M9): reasons, the direction each one allows, and limits.
// Shared by the server (validation) and the UI (forms, filters, labels).

export const ADJUST_REASONS = ['damaged', 'expired', 'lost', 'found', 'correction', 'count', 'opening', 'stock_zero'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

export const ADJUST_REASON_LABELS: Record<AdjustReason, string> = {
  damaged: 'Damaged / broken',
  expired: 'Expired (thrown away)',
  lost: 'Lost / missing',
  found: 'Found extra stock',
  correction: 'Correction',
  count: 'Stock count',
  opening: 'Opening stock',
  stock_zero: 'Stock zero reset'
};

/** Reasons a person can pick for a single adjustment; the others are written by the app itself */
export const MANUAL_ADJUST_REASONS: AdjustReason[] = ['damaged', 'expired', 'lost', 'found', 'correction'];

/** 'out' = stock may only go down, 'in' = only up, 'both' = either way */
export const ADJUST_REASON_DIRECTION: Record<AdjustReason, 'out' | 'in' | 'both'> = {
  damaged: 'out',
  expired: 'out',
  lost: 'out',
  found: 'in',
  correction: 'both',
  count: 'both',
  opening: 'in',
  stock_zero: 'out'
};

export const STOCK_NOTES_MAX = 200;
/** The largest count or change for one medicine, in units */
export const STOCK_UNITS_MAX = 10_000_000;

export const isAdjustReason = (value: unknown): value is AdjustReason =>
  typeof value === 'string' && (ADJUST_REASONS as readonly string[]).includes(value);

/** "3 box(es) + 4 Tablets", "-2 box(es)" */
export function unitsText(units: number, packing: number, unitType = 'units'): string {
  const p = Math.max(1, packing || 1);
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(Math.round(units));
  const boxes = Math.floor(abs / p);
  const loose = abs % p;
  if (p === 1) return `${sign}${abs} ${unitType}`;
  return loose > 0 ? `${sign}${boxes} box(es) + ${loose} ${unitType}` : `${sign}${boxes} box(es)`;
}
