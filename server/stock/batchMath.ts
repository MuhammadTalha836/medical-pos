// Batches and FEFO (first expiry, first out). Pure, no database imports (unit-tested).
// Every unit on the shelf belongs to a batch: the sum of a product's batch units equals its stock.

export const OPENING_BATCH_NO = 'OPENING';

export interface BatchUnits {
  id: number;
  /** YYYY-MM-DD, or '' when not known (opening stock) */
  expiryDate: string;
  units: number;
}

export interface Allocation {
  batchId: number;
  units: number;
}

export const toUnits = (boxes: number, loose: number, packing: number) => boxes * Math.max(1, packing || 1) + loose;

export function fromUnits(units: number, packing: number): { boxes: number; loose: number } {
  const p = Math.max(1, packing || 1);
  const safe = Math.max(0, Math.round(units));
  return { boxes: Math.floor(safe / p), loose: safe % p };
}

export const isExpired = (expiryDate: string, today: string) => expiryDate !== '' && expiryDate <= today;

/** Usable dated batches by earliest expiry, then batches with no date, then expired batches */
export function fefoOrder<T extends BatchUnits>(batches: T[], today: string): T[] {
  const rank = (b: T) => (isExpired(b.expiryDate, today) ? 2 : b.expiryDate === '' ? 1 : 0);
  return [...batches].sort((a, b) =>
    rank(a) - rank(b) ||
    (a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : 0) ||
    a.id - b.id
  );
}

export type AllocationResult =
  | { ok: true; allocations: Allocation[] }
  | { ok: false; available: number; expiredUnits: number };

/** Takes units FEFO. Sales leave expired batches alone (includeExpired: false). */
export function allocate(batches: BatchUnits[], units: number, today: string, includeExpired: boolean): AllocationResult {
  const usable = fefoOrder(batches.filter(b => b.units > 0), today).filter(b => includeExpired || !isExpired(b.expiryDate, today));
  const available = usable.reduce((s, b) => s + b.units, 0);
  if (units > available) {
    const expiredUnits = includeExpired ? 0 : batches.filter(b => b.units > 0 && isExpired(b.expiryDate, today)).reduce((s, b) => s + b.units, 0);
    return { ok: false, available, expiredUnits };
  }
  const allocations: Allocation[] = [];
  let left = units;
  for (const b of usable) {
    if (left <= 0) break;
    const take = Math.min(left, b.units);
    allocations.push({ batchId: b.id, units: take });
    left -= take;
  }
  return { ok: true, allocations };
}

/**
 * What to change so the batches add up to the product's stock: extra stock goes to the opening batch
 * (openingUnits > 0); stock the batches have too much of is trimmed by earliest expiry, expired included (trims).
 */
export function reconcile(batches: BatchUnits[], productUnits: number): { openingUnits: number; trims: Allocation[] } {
  const total = batches.reduce((s, b) => s + Math.max(0, b.units), 0);
  if (total === productUnits) return { openingUnits: 0, trims: [] };
  if (total < productUnits) return { openingUnits: productUnits - total, trims: [] };
  // Older stock really left first, so trim by plain expiry date (expired included), undated last
  const ordered = batches.filter(x => x.units > 0).sort((x, y) =>
    (x.expiryDate === '' ? 1 : 0) - (y.expiryDate === '' ? 1 : 0) ||
    (x.expiryDate < y.expiryDate ? -1 : x.expiryDate > y.expiryDate ? 1 : 0) ||
    x.id - y.id
  );
  const trims: Allocation[] = [];
  let extra = total - productUnits;
  for (const batch of ordered) {
    if (extra <= 0) break;
    const take = Math.min(extra, batch.units);
    trims.push({ batchId: batch.id, units: take });
    extra -= take;
  }
  return { openingUnits: 0, trims };
}
