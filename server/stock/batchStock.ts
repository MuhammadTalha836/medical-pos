import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { localDateString } from '../../shared/dates';
import { OPENING_BATCH_NO, allocate, fromUnits, reconcile, toUnits, type Allocation } from './batchMath';

// Batch-level stock changes (FEFO). Callers pass their transaction, so the product total and its batches
// always change together. Rules live in batchMath.ts.

type Db = typeof prisma | Prisma.TransactionClient;

export interface StockProduct {
  id: number;
  name: string;
  packing: number;
  unitType: string;
}

/** "3 box(es) + 4 Tablets" for messages */
export function describeUnits(units: number, product: Pick<StockProduct, 'packing' | 'unitType'>): string {
  const { boxes, loose } = fromUnits(units, product.packing);
  return loose > 0 ? `${boxes} box(es) + ${loose} ${product.unitType}` : `${boxes} box(es)`;
}

async function batchesOf(db: Db, productId: number, packing: number) {
  const rows = await db.productBatch.findMany({ where: { productId }, orderBy: { id: 'asc' } });
  return rows.map(r => ({ id: r.id, expiryDate: r.expiryDate || '', units: toUnits(r.quantityBoxes, r.quantityLoose, packing) }));
}

async function setBatchUnits(db: Db, batchId: number, units: number, packing: number) {
  const { boxes, loose } = fromUnits(units, packing);
  await db.productBatch.update({ where: { id: batchId }, data: { quantityBoxes: boxes, quantityLoose: loose } });
}

async function changeBatches(db: Db, packing: number, changes: Allocation[], sign: 1 | -1) {
  for (const change of changes) {
    const batch = await db.productBatch.findUnique({ where: { id: change.batchId } });
    if (!batch) continue;
    const units = toUnits(batch.quantityBoxes, batch.quantityLoose, packing) + sign * change.units;
    await setBatchUnits(db, batch.id, Math.max(0, units), packing);
  }
}

/**
 * Takes units from a product's batches, first expiry first. Sales never take expired stock
 * (includeExpired: false) and get a clear message when only expired stock is left.
 */
export async function takeUnits(db: Db, product: StockProduct, units: number, includeExpired: boolean): Promise<Allocation[]> {
  // Self-healing: stock that reached the product without a batch is covered first
  await syncProductBatches(db, product.id);
  const batches = await batchesOf(db, product.id, product.packing);
  const result = allocate(batches, units, localDateString(), includeExpired);
  if (!result.ok) {
    if (result.expiredUnits > 0) {
      throw new Error(`Only ${describeUnits(result.available, product)} of "${product.name}" can be sold: ${describeUnits(result.expiredUnits, product)} are expired. Send expired stock back from Purchases → Returns to Supplier.`);
    }
    throw new Error(`Not enough stock for "${product.name}": ${describeUnits(result.available, product)} available.`);
  }
  await changeBatches(db, product.packing, result.allocations, -1);
  return result.allocations;
}

/**
 * Takes units for stock leaving the store for good (returns to a supplier): the named batch first, then the
 * rest first-expiry-first, expired included.
 */
export async function takeUnitsFromBatch(db: Db, product: StockProduct, units: number, batchNo: string | null): Promise<Allocation[]> {
  await syncProductBatches(db, product.id);
  const named: Allocation[] = [];
  let left = units;
  if (batchNo) {
    const batches = await db.productBatch.findMany({ where: { productId: product.id, batchNo }, orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }] });
    for (const batch of batches) {
      if (left <= 0) break;
      const take = Math.min(left, toUnits(batch.quantityBoxes, batch.quantityLoose, product.packing));
      if (take > 0) named.push({ batchId: batch.id, units: take });
      left -= take;
    }
    await changeBatches(db, product.packing, named, -1);
  }
  return left > 0 ? [...named, ...(await takeUnits(db, product, left, true))] : named;
}

/** Puts units back into the batches they came from */
export async function returnUnits(db: Db, packing: number, allocations: Allocation[]): Promise<void> {
  await changeBatches(db, packing, allocations, 1);
}

/**
 * Makes a product's batches add up to its stock: stock without a batch goes to the opening batch,
 * and batches holding more than the stock are trimmed by earliest expiry.
 */
export async function syncProductBatches(db: Db, productId: number): Promise<void> {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return;
  const packing = Math.max(1, product.packing || 1);
  const batches = await batchesOf(db, product.id, packing);
  const { openingUnits, trims } = reconcile(batches, toUnits(product.stockBoxes, product.stockLoose, packing));
  if (trims.length > 0) await changeBatches(db, packing, trims, -1);
  if (openingUnits > 0) {
    const opening = await db.productBatch.findFirst({ where: { productId: product.id, batchNo: OPENING_BATCH_NO, expiryDate: '' }, orderBy: { id: 'asc' } });
    if (opening) {
      await setBatchUnits(db, opening.id, toUnits(opening.quantityBoxes, opening.quantityLoose, packing) + openingUnits, packing);
    } else {
      const { boxes, loose } = fromUnits(openingUnits, packing);
      await db.productBatch.create({
        data: {
          productId: product.id,
          batchNo: OPENING_BATCH_NO,
          expiryDate: '',
          purchaseCost: product.boxTradePrice,
          retailPrice: product.boxRetailPrice,
          quantityBoxes: boxes,
          quantityLoose: loose
        }
      });
    }
  }
}

/** Startup fix: brings every product's batches in line with its stock (safe to run on every start) */
export async function reconcileAllProductBatches(): Promise<number> {
  const products = await prisma.product.findMany({ select: { id: true, packing: true, stockBoxes: true, stockLoose: true } });
  const totals = await prisma.productBatch.groupBy({ by: ['productId'], _sum: { quantityBoxes: true, quantityLoose: true } });
  const byProduct = new Map(totals.map(t => [t.productId, t]));
  let fixed = 0;
  for (const p of products) {
    const sum = byProduct.get(p.id);
    const batchUnits = toUnits(sum?._sum.quantityBoxes ?? 0, sum?._sum.quantityLoose ?? 0, p.packing);
    if (batchUnits === toUnits(p.stockBoxes, p.stockLoose, p.packing)) continue;
    await prisma.$transaction(tx => syncProductBatches(tx, p.id));
    fixed++;
  }
  return fixed;
}
