import type { Prisma } from '../generated/prisma/client';
import type { Actor } from '../http/context';
import { fromUnits, toUnits } from './batchMath';
import { syncProductBatches } from './batchStock';
import { adjustmentError, unitCost } from './adjustMath';
import { unitsText, type AdjustReason } from '../../shared/stockAdjust';

// Every stock change outside sales, purchases and returns goes through here (M9): the product total and its
// batches change together, and a stock_adjustments row records who, how much and why. Callers pass their transaction.

/** A refusal with its own status code (our message reaches the screen through sendError) */
export class StockAdjustError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface AdjustOptions {
  reason: AdjustReason;
  /** Take from / add to this batch; otherwise decreases trim by earliest expiry and increases go to the opening batch */
  batchId?: number | null;
  notes?: string | null;
  countId?: number | null;
  actor: Actor | null;
}

export async function adjustProductStock(tx: Prisma.TransactionClient, productId: number, delta: number, options: AdjustOptions) {
  // Batches first match the stock, so a chosen batch's change keeps the totals equal
  await syncProductBatches(tx, productId);
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw new StockAdjustError('Medicine not found', 404);
  const packing = Math.max(1, product.packing || 1);
  const before = toUnits(product.stockBoxes, product.stockLoose, packing);

  const error = adjustmentError(options.reason, delta, before);
  if (error) throw new StockAdjustError(`${product.name}: ${error}`, 400);

  if (options.batchId) {
    const batch = await tx.productBatch.findFirst({ where: { id: options.batchId, productId } });
    if (!batch) throw new StockAdjustError('That batch does not belong to this medicine.', 400);
    const batchUnits = toUnits(batch.quantityBoxes, batch.quantityLoose, packing) + delta;
    if (batchUnits < 0) {
      throw new StockAdjustError(`Batch ${batch.batchNo} has only ${unitsText(batchUnits - delta, packing, product.unitType)}.`, 400);
    }
    const split = fromUnits(batchUnits, packing);
    await tx.productBatch.update({ where: { id: batch.id }, data: { quantityBoxes: split.boxes, quantityLoose: split.loose } });
  }

  const after = before + delta;
  const stock = fromUnits(after, packing);
  await tx.product.update({ where: { id: productId }, data: { stockBoxes: stock.boxes, stockLoose: stock.loose } });
  // Without a batch: a decrease trims by earliest expiry, an increase goes to the opening batch
  await syncProductBatches(tx, productId);

  return tx.stockAdjustment.create({
    data: {
      productId,
      productName: product.name,
      deltaUnits: delta,
      stockBefore: before,
      stockAfter: after,
      reason: options.reason,
      notes: options.notes?.trim() || null,
      batchId: options.batchId ?? null,
      unitCost: unitCost(product.boxTradePrice, packing),
      countId: options.countId ?? null,
      userId: options.actor?.id ?? null,
      userName: options.actor ? options.actor.fullName || options.actor.username : 'System'
    }
  });
}
