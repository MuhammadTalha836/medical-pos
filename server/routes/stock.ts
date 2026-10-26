import { Router, type Request, type Response } from 'express';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { logSecurityAudit } from '../security/audit';
import { parseBody, stockAdjustSchema, stockCountItemSchema, stockCountSchema } from '../validation/schemas';
import { hasRolePermission, requirePermission, sendError, type Actor } from '../http/context';
import { toUnits } from '../stock/batchMath';
import { adjustProductStock, StockAdjustError } from '../stock/adjustStock';
import { adjustmentTotals, adjustmentValue, applyCountLine, countDelta, unitCost } from '../stock/adjustMath';
import { isAdjustReason, unitsText, type AdjustReason } from '../../shared/stockAdjust';
import { localDateString } from '../../shared/dates';

// Physical stock counts and stock adjustments (M9). Counting changes nothing until a manager applies the count;
// every change is a stock_adjustments row (server/stock/adjustStock.ts).
const router = Router();

const COUNT_DENIED = 'You do not have permission to count stock.';
const ADJUST_DENIED = 'You do not have permission to adjust stock.';
const NOT_OPEN = 'This stock count is already applied or cancelled.';
const actorName = (actor: Actor) => actor.fullName || actor.username;
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const statusOf = (error: unknown) => (error instanceof StockAdjustError ? error.status : 400);

/** Viewing counts needs the Medicines module and either stock permission */
async function requireStockView(req: Request, res: Response): Promise<Actor | null> {
  const actor = await requirePermission(req, res, 'masters', 'You do not have access to medicines.');
  if (!actor) return null;
  if (await hasRolePermission(actor.role, 'can_count_stock') || await hasRolePermission(actor.role, 'can_adjust_stock')) return actor;
  res.status(403).json({ error: COUNT_DENIED });
  return null;
}

async function openCount(db: typeof prisma | Prisma.TransactionClient, id: number) {
  const count = await db.stockCount.findUnique({ where: { id } });
  if (!count) throw new StockAdjustError('Stock count not found', 404);
  if (count.status !== 'open') throw new StockAdjustError(NOT_OPEN, 409);
  return count;
}

async function nextCountNo(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = `SC-${localDateString().replace(/-/g, '')}-`;
  const last = await tx.stockCount.findFirst({ where: { countNo: { startsWith: prefix } }, orderBy: { countNo: 'desc' } });
  const n = last ? Number(last.countNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(2, '0')}`;
}

function countPayload(c: { id: number; countNo: string; title: string | null; notes: string | null; companyId: number | null; status: string; userName: string | null; appliedAt: Date | null; appliedBy: string | null; createdAt: Date }) {
  return {
    id: c.id,
    count_no: c.countNo,
    title: c.title,
    notes: c.notes,
    company_id: c.companyId,
    status: c.status,
    user_name: c.userName,
    applied_at: c.appliedAt,
    applied_by: c.appliedBy,
    created_at: c.createdAt
  };
}

router.get('/api/stock/counts', async (req: Request, res: Response) => {
  try {
    if (!(await requireStockView(req, res))) return;
    const counts = await prisma.stockCount.findMany({ orderBy: { id: 'desc' }, take: 100, include: { items: { select: { systemUnits: true, countedUnits: true } } } });
    res.json(counts.map(c => {
      const counted = c.items.filter(i => i.countedUnits !== null);
      return {
        ...countPayload(c),
        items_count: c.items.length,
        counted_count: counted.length,
        differences_count: counted.filter(i => countDelta(i.systemUnits, i.countedUnits as number) !== 0).length
      };
    }));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.get('/api/stock/counts/:id', async (req: Request, res: Response) => {
  try {
    if (!(await requireStockView(req, res))) return;
    const count = await prisma.stockCount.findUnique({ where: { id: Number(req.params.id) || 0 }, include: { items: { orderBy: { productName: 'asc' } } } });
    if (!count) return res.status(404).json({ error: 'Stock count not found' });
    const products = await prisma.product.findMany({ where: { id: { in: count.items.map(i => i.productId) } } });
    const byId = new Map(products.map(p => [p.id, p]));
    const items = count.items.map(i => {
      const p = byId.get(i.productId);
      const packing = Math.max(1, p?.packing || 1);
      const delta = i.countedUnits === null ? null : countDelta(i.systemUnits, i.countedUnits);
      const cost = p ? unitCost(p.boxTradePrice, packing) : 0;
      return {
        id: i.id,
        product_id: i.productId,
        product_name: p?.name ?? i.productName,
        p_code: p?.pCode ?? null,
        barcode: p?.barcode ?? null,
        location_rack: p?.locationRack ?? null,
        unit_type: p?.unitType ?? 'units',
        packing,
        unit_cost: cost,
        missing: !p,
        current_units: p ? toUnits(p.stockBoxes, p.stockLoose, packing) : 0,
        system_units: i.systemUnits,
        counted_units: i.countedUnits,
        difference_units: delta,
        difference_value: delta === null ? 0 : adjustmentValue(delta, cost),
        counted_at: i.countedAt,
        user_name: i.userName
      };
    });
    const totals = adjustmentTotals(items.filter(i => i.difference_units).map(i => ({ deltaUnits: i.difference_units as number, unitCost: i.unit_cost })));
    res.json({ ...countPayload(count), items, totals: { loss_value: totals.lossValue, gain_value: totals.gainValue, net_value: totals.netValue, differences_count: totals.count } });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/stock/counts', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_count_stock', COUNT_DENIED);
    if (!actor) return;
    const body = parseBody(stockCountSchema, req.body, res);
    if (!body) return;
    const companyId = body.company_id ?? null;
    if (companyId && !(await prisma.company.findUnique({ where: { id: companyId } }))) {
      return res.status(400).json({ error: 'Company not found' });
    }
    const count = await prisma.$transaction(async (tx) => {
      const created = await tx.stockCount.create({
        data: {
          countNo: await nextCountNo(tx),
          title: body.title || null,
          notes: body.notes || null,
          companyId,
          userId: actor.id,
          userName: actorName(actor)
        }
      });
      // A company count starts with that company's active medicines listed, still to count
      if (companyId) {
        const products = await tx.product.findMany({ where: { companyId, status: 'active' }, select: { id: true, name: true, packing: true, stockBoxes: true, stockLoose: true } });
        if (products.length) {
          await tx.stockCountItem.createMany({
            data: products.map(p => ({ countId: created.id, productId: p.id, productName: p.name, systemUnits: toUnits(p.stockBoxes, p.stockLoose, p.packing) }))
          });
        }
      }
      return created;
    });
    res.json({ success: true, count: countPayload(count) });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

// Adds a medicine to the count, or saves what was counted. The system stock is taken at this moment.
router.put('/api/stock/counts/:id/items', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_count_stock', COUNT_DENIED);
    if (!actor) return;
    const body = parseBody(stockCountItemSchema, req.body, res);
    if (!body) return;
    const countId = Number(req.params.id) || 0;
    const item = await prisma.$transaction(async (tx) => {
      await openCount(tx, countId);
      const product = body.product_id
        ? await tx.product.findUnique({ where: { id: body.product_id } })
        : await tx.product.findFirst({ where: { OR: [{ barcode: body.barcode }, { pCode: body.barcode }] } });
      if (!product) throw new StockAdjustError(body.product_id ? 'Medicine not found' : `No medicine has the barcode "${body.barcode}".`, 404);
      const packing = Math.max(1, product.packing || 1);
      const systemUnits = toUnits(product.stockBoxes, product.stockLoose, packing);
      const isCounting = body.counted_boxes !== undefined || body.counted_loose !== undefined;
      const counted = isCounting ? toUnits(body.counted_boxes ?? 0, body.counted_loose ?? 0, packing) : null;
      const data = isCounting
        ? { productName: product.name, systemUnits, countedUnits: counted, countedAt: new Date(), userName: actorName(actor) }
        : { productName: product.name };
      return tx.stockCountItem.upsert({
        where: { countId_productId: { countId, productId: product.id } },
        create: { countId, productId: product.id, productName: product.name, systemUnits, countedUnits: counted, countedAt: isCounting ? new Date() : null, userName: isCounting ? actorName(actor) : null },
        update: data
      });
    });
    res.json({ success: true, item: { id: item.id, product_id: item.productId, system_units: item.systemUnits, counted_units: item.countedUnits } });
  } catch (error: unknown) {
    sendError(res, error, statusOf(error));
  }
});

router.delete('/api/stock/counts/:id/items/:productId', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_count_stock', COUNT_DENIED))) return;
    const countId = Number(req.params.id) || 0;
    await openCount(prisma, countId);
    await prisma.stockCountItem.deleteMany({ where: { countId, productId: Number(req.params.productId) || 0 } });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, statusOf(error));
  }
});

// Applies every counted line in one go: stock becomes what was counted (sales made since counting stay sold)
router.post('/api/stock/counts/:id/apply', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_adjust_stock', ADJUST_DENIED);
    if (!actor) return;
    const countId = Number(req.params.id) || 0;
    const result = await prisma.$transaction(async (tx) => {
      const count = await openCount(tx, countId);
      const marked = await tx.stockCount.updateMany({
        where: { id: countId, status: 'open' },
        data: { status: 'applied', appliedAt: new Date(), appliedBy: actorName(actor) }
      });
      if (marked.count !== 1) throw new StockAdjustError(NOT_OPEN, 409);
      const items = await tx.stockCountItem.findMany({ where: { countId, countedUnits: { not: null } } });
      const adjustments = [];
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) continue;
        const current = toUnits(product.stockBoxes, product.stockLoose, product.packing);
        const delta = applyCountLine(current, item.systemUnits, item.countedUnits as number) - current;
        if (delta === 0) continue;
        adjustments.push(await adjustProductStock(tx, product.id, delta, { reason: 'count', countId, notes: count.countNo, actor }));
      }
      return { count, adjustments, counted: items.length };
    });
    const totals = adjustmentTotals(result.adjustments);
    await logSecurityAudit({
      action: 'STOCK_COUNT_APPLIED',
      module: 'Inventory',
      details: `Stock count ${result.count.countNo} applied: ${result.counted} counted, ${result.adjustments.length} changed (loss ${totals.lossValue}, gain ${totals.gainValue})`,
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true, counted: result.counted, changed: result.adjustments.length, loss_value: totals.lossValue, gain_value: totals.gainValue });
  } catch (error: unknown) {
    sendError(res, error, statusOf(error));
  }
});

router.post('/api/stock/counts/:id/cancel', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_adjust_stock', ADJUST_DENIED);
    if (!actor) return;
    const countId = Number(req.params.id) || 0;
    const count = await openCount(prisma, countId);
    const marked = await prisma.stockCount.updateMany({ where: { id: countId, status: 'open' }, data: { status: 'cancelled' } });
    if (marked.count !== 1) return res.status(409).json({ error: NOT_OPEN });
    await logSecurityAudit({ action: 'STOCK_COUNT_CANCELLED', module: 'Inventory', details: `Stock count ${count.countNo} cancelled`, userId: actor.id, userName: actor.username });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, statusOf(error));
  }
});

// One adjustment on one medicine, with a reason (and optionally a batch)
router.post('/api/products/:id/adjust', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_adjust_stock', ADJUST_DENIED);
    if (!actor) return;
    const body = parseBody(stockAdjustSchema, req.body, res);
    if (!body) return;
    const productId = Number(req.params.id) || 0;
    const row = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new StockAdjustError('Medicine not found', 404);
      const units = toUnits(body.boxes, body.loose, product.packing);
      const delta = body.direction === 'out' ? -units : units;
      return adjustProductStock(tx, productId, delta, { reason: body.reason as AdjustReason, batchId: body.batch_id ?? null, notes: body.notes ?? null, actor });
    });
    const product = await prisma.product.findUnique({ where: { id: productId } });
    await logSecurityAudit({
      action: 'STOCK_ADJUSTED',
      module: 'Inventory',
      details: `${row.productName}: ${unitsText(row.deltaUnits, product?.packing ?? 1, product?.unitType)} (${row.reason}), stock ${row.stockBefore} -> ${row.stockAfter} units`,
      userId: actor.id,
      userName: actor.username
    });
    res.json({
      success: true,
      adjustment: { id: row.id, delta_units: row.deltaUnits, stock_before: row.stockBefore, stock_after: row.stockAfter },
      stock_boxes: product?.stockBoxes ?? 0,
      stock_loose: product?.stockLoose ?? 0
    });
  } catch (error: unknown) {
    sendError(res, error, statusOf(error));
  }
});

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d;
};

// Adjustment history with loss and gain at cost
router.get('/api/stock/adjustments', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'masters', 'You do not have access to medicines.');
    if (!actor) return;
    if (!(await hasRolePermission(actor.role, 'can_adjust_stock'))) return res.status(403).json({ error: ADJUST_DENIED });
    const { from, to, product_id, reason } = req.query;
    if ((from !== undefined && !isDate(from)) || (to !== undefined && !isDate(to))) return res.status(400).json({ error: 'Choose valid dates' });
    if (isDate(from) && isDate(to) && from > to) return res.status(400).json({ error: 'The start date is after the end date.' });
    if (reason !== undefined && reason !== '' && !isAdjustReason(reason)) return res.status(400).json({ error: 'Unknown reason' });

    const where: Prisma.StockAdjustmentWhereInput = {};
    if (isDate(from) || isDate(to)) {
      where.createdAt = {
        ...(isDate(from) ? { gte: new Date(`${from}T00:00:00`) } : {}),
        ...(isDate(to) ? { lt: nextDay(to) } : {})
      };
    }
    if (product_id) where.productId = Number(product_id) || 0;
    if (isAdjustReason(reason)) where.reason = reason;

    const rows = await prisma.stockAdjustment.findMany({ where, orderBy: { id: 'desc' }, take: 2000 });
    const products = await prisma.product.findMany({ where: { id: { in: [...new Set(rows.map(r => r.productId))] } }, select: { id: true, packing: true, unitType: true } });
    const byId = new Map(products.map(p => [p.id, p]));
    const batchIds = [...new Set(rows.map(r => r.batchId).filter((id): id is number => id !== null))];
    const batches = new Map((await prisma.productBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, batchNo: true } })).map(b => [b.id, b.batchNo]));
    const totals = adjustmentTotals(rows);
    res.json({
      adjustments: rows.map(r => ({
        id: r.id,
        product_id: r.productId,
        product_name: r.productName,
        packing: byId.get(r.productId)?.packing ?? 1,
        unit_type: byId.get(r.productId)?.unitType ?? 'units',
        delta_units: r.deltaUnits,
        stock_before: r.stockBefore,
        stock_after: r.stockAfter,
        reason: r.reason,
        notes: r.notes,
        batch_no: r.batchId ? batches.get(r.batchId) ?? null : null,
        unit_cost: r.unitCost,
        value: adjustmentValue(r.deltaUnits, r.unitCost),
        count_id: r.countId,
        user_name: r.userName,
        created_at: r.createdAt
      })),
      totals: {
        count: totals.count,
        loss_units: totals.lossUnits,
        gain_units: totals.gainUnits,
        loss_value: totals.lossValue,
        gain_value: totals.gainValue,
        net_value: totals.netValue
      }
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
