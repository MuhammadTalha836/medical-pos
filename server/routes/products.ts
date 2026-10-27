import { Router, type Request, type Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { requirePermission, sendError } from '../http/context';
import { parseBody, batchEditSchema, productSchema } from '../validation/schemas';
import { round2 } from '../sales/saleMath';
import { z } from 'zod';
import { logSecurityAudit } from '../security/audit';
import { syncProductBatches } from '../stock/batchStock';
import { adjustProductStock } from '../stock/adjustStock';
import { fefoOrder, isExpired, toUnits } from '../stock/batchMath';
import { localDateString } from '../../shared/dates';
import { isMedicineSchedule, MEDICINE_SCHEDULES } from '../../shared/schedule';
import { genericKey, rankSubstitutes } from '../../shared/generic';

const NEAR_EXPIRY_DAYS = 90;
const SCHEDULE_ERROR = `Schedule must be one of: ${MEDICINE_SCHEDULES.join(', ')}.`;

/** The schedule from a request body: undefined when not sent, null when invalid */
type ProductBody = z.infer<typeof productSchema>;

const isOn = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true';

/** Another medicine that already has this barcode (blank barcodes are never compared) */
async function barcodeOwner(barcode: string | undefined, exceptId?: number) {
  if (!barcode) return null;
  return prisma.product.findFirst({ where: { barcode, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true, name: true } });
}

/**
 * Loose-sale price: when a medicine may be sold loose without a unit price, it is the box price shared over the
 * packing (what the form shows). Returns the price to store, or an error message.
 */
function looseUnitPrice(body: ProductBody, allowOpenSale: boolean, packing: number): { price: number } | { error: string } {
  const unit = body.unit_retail_price ?? 0;
  if (!allowOpenSale || unit > 0) return { price: unit };
  const derived = round2((body.box_retail_price ?? 0) / Math.max(1, packing));
  return derived > 0 ? { price: derived } : { error: 'Enter a unit price for loose sales, or turn off loose sale for this medicine.' };
}

function readSchedule(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const v = String(value).trim().toLowerCase();
  return isMedicineSchedule(v) ? v : null;
}

// Products master
const router = Router();

router.get('/api/products', async (req: Request, res: Response) => {
  try {
    const { q, company_id, low_stock } = req.query;
    const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

    if (q) {
      const search = `%${String(q).trim()}%`;
      conditions.push(Prisma.sql`(p.name LIKE ${search} OR p.p_code LIKE ${search} OR p.c_code LIKE ${search} OR p.barcode LIKE ${search} OR p.generic_name LIKE ${search})`);
    }

    if (company_id) {
      conditions.push(Prisma.sql`p.company_id = ${Number(company_id)}`);
    }

    if (low_stock === 'true') {
      conditions.push(Prisma.sql`p.stock_boxes <= p.min_stock_alert`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const products = await prisma.$queryRaw<any[]>`
      SELECT p.id, p.company_id, p.c_code, p.p_code, p.barcode, p.name, p.generic_name,
             p.unit_type, p.packing, p.box_trade_price, p.box_retail_price,
             p.unit_trade_price, p.unit_retail_price, p.default_discount_pct,
             p.location_rack, p.stock_boxes, p.stock_loose, p.min_stock_alert,
             p.allow_open_sale, p.min_sale_qty, p.schedule,
             p.status, p.created_at, p.updated_at, c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE ${whereClause}
      ORDER BY p.name ASC
    `;
    res.json(products);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Generic formulas already in use (most used first), as suggestions for the Medicines form
router.get('/api/products/generics', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const rows = await prisma.$queryRaw<{ generic_name: string; uses: number }[]>`
      SELECT TRIM(generic_name) AS generic_name, COUNT(*) AS uses
      FROM products
      WHERE generic_name IS NOT NULL AND TRIM(generic_name) != ''
        ${q ? Prisma.sql`AND generic_name LIKE ${`%${q}%`}` : Prisma.empty}
      GROUP BY LOWER(TRIM(generic_name))
      ORDER BY uses DESC, generic_name ASC
      LIMIT 50
    `;
    res.json(rows.map(r => ({ generic_name: r.generic_name, uses: Number(r.uses) })));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.get('/api/products/search', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const searchTerm = String(q).trim();
    const searchWildcard = `%${searchTerm}%`;

    const products = await prisma.$queryRaw<any[]>`
      SELECT p.id, p.company_id, p.c_code, p.p_code, p.barcode, p.name, p.generic_name,
             p.unit_type, p.packing, p.box_trade_price, p.box_retail_price,
             p.unit_trade_price, p.unit_retail_price, p.default_discount_pct,
             p.location_rack, p.stock_boxes, p.stock_loose, p.min_stock_alert,
             p.allow_open_sale, p.min_sale_qty, p.schedule,
             p.status, p.created_at, p.updated_at, c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.status = 'active' AND (
        p.barcode = ${searchTerm} OR
        p.p_code LIKE ${searchWildcard} OR
        p.c_code LIKE ${searchWildcard} OR
        p.name LIKE ${searchWildcard} OR
        p.generic_name LIKE ${searchWildcard}
      )
      ORDER BY (p.barcode = ${searchTerm}) DESC, p.name ASC
      LIMIT 25
    `;

    res.json(products);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Other medicines with the same generic formula (in stock first), for an out-of-stock brand at the counter
router.get('/api/products/:id/substitutes', async (req: Request, res: Response) => {
  try {
    const target = await prisma.product.findUnique({
      where: { id: Number(req.params.id) || 0 },
      select: { id: true, name: true, genericName: true, unitType: true, packing: true, stockBoxes: true, stockLoose: true }
    });
    if (!target) return res.status(404).json({ error: 'Medicine not found' });
    const product = { id: target.id, name: target.name, generic_name: target.genericName };
    if (!genericKey(target.genericName)) return res.json({ product, substitutes: [] });

    const candidates = await prisma.$queryRaw<any[]>`
      SELECT p.id, p.company_id, p.c_code, p.p_code, p.barcode, p.name, p.generic_name,
             p.unit_type, p.packing, p.box_trade_price, p.box_retail_price,
             p.unit_trade_price, p.unit_retail_price, p.default_discount_pct,
             p.location_rack, p.stock_boxes, p.stock_loose, p.min_stock_alert,
             p.allow_open_sale, p.min_sale_qty, p.schedule,
             p.status, p.created_at, p.updated_at, c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.status = 'active' AND p.generic_name IS NOT NULL AND TRIM(p.generic_name) != ''
    `;
    const substitutes = rankSubstitutes(
      { id: target.id, name: target.name, generic_name: target.genericName, unit_type: target.unitType, packing: target.packing, stock_boxes: target.stockBoxes, stock_loose: target.stockLoose },
      candidates
    );
    res.json({ product, substitutes });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.get('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const products: any[] = await prisma.$queryRaw`
      SELECT p.id, p.company_id, p.c_code, p.p_code, p.barcode, p.name, p.generic_name,
             p.unit_type, p.packing, p.box_trade_price, p.box_retail_price,
             p.unit_trade_price, p.unit_retail_price, p.default_discount_pct,
             p.location_rack, p.stock_boxes, p.stock_loose, p.min_stock_alert,
             p.allow_open_sale, p.min_sale_qty, p.schedule,
             p.status, p.created_at, p.updated_at, c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.id = ${id}
      LIMIT 1
    `;
    if (!products || products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(products[0]);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/products', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_add_product', 'You do not have permission to add medicines.');
    if (!actor) return;
    const body = parseBody(productSchema, req.body, res);
    if (!body) return;
    const schedule = readSchedule(req.body.schedule);
    if (schedule === null) return res.status(400).json({ error: SCHEDULE_ERROR });
    if (!body.p_code) return res.status(400).json({ error: 'P-Code is required' });
    const pCode = body.p_code;
    const barcode = body.barcode || undefined;
    const owner = await barcodeOwner(barcode);
    if (owner) return res.status(409).json({ error: `This barcode already belongs to "${owner.name}".` });
    const packing = body.packing ?? 1;
    const allowOpenSale = body.allow_open_sale === undefined || body.allow_open_sale === null ? true : isOn(body.allow_open_sale);
    const unitPrice = looseUnitPrice(body, allowOpenSale, packing);
    if ('error' in unitPrice) return res.status(400).json({ error: unitPrice.error });

    const newProd = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
      data: {
        companyId: body.company_id ?? null,
        cCode: body.c_code || 'GEN',
        pCode,
        barcode: barcode ?? null,
        name: body.name,
        genericName: body.generic_name || null,
        unitType: body.unit_type || 'Tablets',
        packing,
        boxTradePrice: body.box_trade_price ?? 0,
        boxRetailPrice: body.box_retail_price ?? 0,
        unitTradePrice: body.unit_trade_price ?? 0,
        unitRetailPrice: unitPrice.price,
        defaultDiscountPct: body.default_discount_pct ?? 0,
        locationRack: body.location_rack || null,
        minStockAlert: body.min_stock_alert ?? 10,
        allowOpenSale: allowOpenSale ? 1 : 0,
        minSaleQty: body.min_sale_qty ?? 1,
        schedule: schedule ?? 'none',
        status: 'active'
      }
      });
      // Opening stock becomes the medicine's opening batch, recorded as an adjustment
      const openingUnits = toUnits(body.stock_boxes ?? 0, body.stock_loose ?? 0, created.packing);
      if (openingUnits > 0) await adjustProductStock(tx, created.id, openingUnits, { reason: 'opening', actor });
      return created;
    });

    await logSecurityAudit({
      action: 'PRODUCT_CREATED',
      module: 'Medicines',
      details: `"${newProd.name}" added (box retail ${newProd.boxRetailPrice}, unit retail ${newProd.unitRetailPrice}, loose sale ${allowOpenSale ? 'on' : 'off'})`,
      userId: actor.id,
      userName: actor.fullName || actor.username
    });
    res.json({ success: true, id: newProd.id });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.put('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_edit_product', 'You do not have permission to edit medicines.');
    if (!actor) return;
    const idNum = Number(req.params.id);
    const body = parseBody(productSchema, req.body, res);
    if (!body) return;
    const schedule = readSchedule(req.body.schedule);
    if (schedule === null) return res.status(400).json({ error: SCHEDULE_ERROR });
    const before = await prisma.product.findUnique({ where: { id: idNum } });
    if (!before) return res.status(404).json({ error: 'Product not found' });
    const barcode = body.barcode || undefined;
    const owner = await barcodeOwner(barcode, idNum);
    if (owner) return res.status(409).json({ error: `This barcode already belongs to "${owner.name}".` });
    const packing = body.packing ?? 1;
    // Left out = unchanged (it used to switch loose sale back on)
    const allowOpenSale = body.allow_open_sale === undefined || body.allow_open_sale === null ? before.allowOpenSale === 1 : isOn(body.allow_open_sale);
    const unitPrice = looseUnitPrice(body, allowOpenSale, packing);
    if ('error' in unitPrice) return res.status(400).json({ error: unitPrice.error });

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
      where: { id: idNum },
      data: {
        companyId: body.company_id ?? null,
        cCode: body.c_code,
        pCode: body.p_code,
        barcode: barcode ?? null,
        name: body.name,
        genericName: body.generic_name || null,
        unitType: body.unit_type,
        packing,
        boxTradePrice: body.box_trade_price ?? 0,
        boxRetailPrice: body.box_retail_price ?? 0,
        unitTradePrice: body.unit_trade_price ?? 0,
        unitRetailPrice: unitPrice.price,
        defaultDiscountPct: body.default_discount_pct ?? 0,
        locationRack: body.location_rack || null,
        minStockAlert: body.min_stock_alert ?? 10,
        allowOpenSale: allowOpenSale ? 1 : 0,
        minSaleQty: body.min_sale_qty ?? 1,
        ...(schedule ? { schedule } : {}),
        status: body.status || 'active'
      }
      });
      // Stock is not edited here (Adjust stock / Stock count, M9); a changed packing still keeps the batches in step
      await syncProductBatches(tx, idNum);
    });

    // Prices, loose sale and the schedule are what matter at the counter
    const changes = [
      ['box retail', before.boxRetailPrice, body.box_retail_price ?? 0],
      ['box trade', before.boxTradePrice, body.box_trade_price ?? 0],
      ['unit retail', before.unitRetailPrice, unitPrice.price],
      ['discount %', before.defaultDiscountPct, body.default_discount_pct ?? 0],
      ['loose sale', before.allowOpenSale === 1 ? 'on' : 'off', allowOpenSale ? 'on' : 'off'],
      ['schedule', before.schedule, schedule ?? before.schedule]
    ].filter(([, a, b]) => a !== b).map(([label, a, b]) => `${label} ${a} → ${b}`);
    await logSecurityAudit({
      action: 'PRODUCT_UPDATED',
      module: 'Medicines',
      details: `"${body.name}" edited${changes.length ? `: ${changes.join(', ')}` : ''}`,
      userId: actor.id,
      userName: actor.fullName || actor.username
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

// A medicine's batches with what is left of each and its expiry state
router.get('/api/products/:id/batches', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'masters', 'You do not have access to medicines.'))) return;
    const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) || 0 } });
    if (!product) return res.status(404).json({ error: 'Medicine not found' });
    await prisma.$transaction(tx => syncProductBatches(tx, product.id));
    const batches = await prisma.productBatch.findMany({ where: { productId: product.id }, orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }] });
    const today = localDateString();
    const soon = localDateString(new Date(Date.now() + NEAR_EXPIRY_DAYS * 24 * 60 * 60 * 1000));
    res.json(fefoOrder(batches.map(b => ({ ...b, units: toUnits(b.quantityBoxes, b.quantityLoose, product.packing) })), today).map(b => ({
      id: b.id,
      batch_no: b.batchNo,
      expiry_date: b.expiryDate,
      quantity_boxes: b.quantityBoxes,
      quantity_loose: b.quantityLoose,
      units: b.units,
      purchase_cost: b.purchaseCost,
      status: !b.expiryDate ? 'no_expiry' : isExpired(b.expiryDate, today) ? 'expired' : b.expiryDate <= soon ? 'near' : 'ok',
      created_at: b.createdAt
    })));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Correct a batch number or expiry date (quantities only change through sales, purchases and returns)
router.put('/api/products/:id/batches/:batchId', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_edit_product', 'You do not have permission to edit medicines.');
    if (!actor) return;
    const body = parseBody(batchEditSchema, req.body, res);
    if (!body) return;
    const batch = await prisma.productBatch.findFirst({ where: { id: Number(req.params.batchId) || 0, productId: Number(req.params.id) || 0 }, include: { product: { select: { name: true } } } });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const updated = await prisma.productBatch.update({
      where: { id: batch.id },
      data: { batchNo: body.batch_no, expiryDate: body.expiry_date ?? '' }
    });
    await logSecurityAudit({
      action: 'BATCH_EDIT',
      module: 'Inventory',
      status: 'SUCCESS',
      details: `${batch.product.name}: batch ${batch.batchNo} (expiry ${batch.expiryDate || 'none'}) -> ${updated.batchNo} (expiry ${updated.expiryDate || 'none'})`,
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.delete('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_delete_product', 'You do not have permission to delete medicines.');
    if (!actor) return;
    const idNum = Number(req.params.id);
    const deleted = await prisma.product.delete({ where: { id: idNum } });
    await logSecurityAudit({
      action: 'PRODUCT_DELETED',
      module: 'Medicines',
      details: `"${deleted.name}" deleted`,
      userId: actor.id,
      userName: actor.fullName || actor.username
    });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
