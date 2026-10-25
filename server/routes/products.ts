import { Router, type Request, type Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { requirePermission, sendError } from '../http/context';
import { parseBody, batchEditSchema } from '../validation/schemas';
import { logSecurityAudit } from '../security/audit';
import { syncProductBatches } from '../stock/batchStock';
import { fefoOrder, isExpired, toUnits } from '../stock/batchMath';
import { localDateString } from '../../shared/dates';

const NEAR_EXPIRY_DAYS = 90;

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
             p.allow_open_sale, p.min_sale_qty,
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
             p.allow_open_sale, p.min_sale_qty,
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

router.get('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const products: any[] = await prisma.$queryRaw`
      SELECT p.id, p.company_id, p.c_code, p.p_code, p.barcode, p.name, p.generic_name,
             p.unit_type, p.packing, p.box_trade_price, p.box_retail_price,
             p.unit_trade_price, p.unit_retail_price, p.default_discount_pct,
             p.location_rack, p.stock_boxes, p.stock_loose, p.min_stock_alert,
             p.allow_open_sale, p.min_sale_qty,
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
    if (!(await requirePermission(req, res, 'can_add_product', 'You do not have permission to add medicines.'))) return;
    const {
      company_id, c_code, p_code, barcode, name, generic_name, unit_type,
      packing, box_trade_price, box_retail_price, unit_trade_price, unit_retail_price,
      default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert,
      allow_open_sale, min_sale_qty
    } = req.body;

    const newProd = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
      data: {
        companyId: company_id ? Number(company_id) : null,
        cCode: c_code,
        pCode: p_code,
        barcode: barcode || null,
        name,
        genericName: generic_name || null,
        unitType: unit_type || 'Tablets',
        packing: Number(packing) || 1,
        boxTradePrice: parseFloat(box_trade_price) || 0,
        boxRetailPrice: parseFloat(box_retail_price) || 0,
        unitTradePrice: parseFloat(unit_trade_price) || 0,
        unitRetailPrice: parseFloat(unit_retail_price) || 0,
        defaultDiscountPct: parseFloat(default_discount_pct) || 0,
        locationRack: location_rack || null,
        stockBoxes: parseInt(stock_boxes) || 0,
        stockLoose: parseInt(stock_loose) || 0,
        minStockAlert: parseInt(min_stock_alert) || 10,
        allowOpenSale: allow_open_sale !== undefined ? (allow_open_sale ? 1 : 0) : 1,
        minSaleQty: parseInt(min_sale_qty) || 1,
        status: 'active'
      }
      });
      // Opening stock becomes the medicine's opening batch
      await syncProductBatches(tx, created.id);
      return created;
    });

    res.json({ success: true, id: newProd.id });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.put('/api/products/:id', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_edit_product', 'You do not have permission to edit medicines.'))) return;
    const idNum = Number(req.params.id);
    const {
      company_id, c_code, p_code, barcode, name, generic_name, unit_type,
      packing, box_trade_price, box_retail_price, unit_trade_price, unit_retail_price,
      default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert, status,
      allow_open_sale, min_sale_qty
    } = req.body;

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
      where: { id: idNum },
      data: {
        companyId: company_id ? Number(company_id) : null,
        cCode: c_code,
        pCode: p_code,
        barcode: barcode || null,
        name,
        genericName: generic_name || null,
        unitType: unit_type,
        packing: Number(packing) || 1,
        boxTradePrice: parseFloat(box_trade_price) || 0,
        boxRetailPrice: parseFloat(box_retail_price) || 0,
        unitTradePrice: parseFloat(unit_trade_price) || 0,
        unitRetailPrice: parseFloat(unit_retail_price) || 0,
        defaultDiscountPct: parseFloat(default_discount_pct) || 0,
        locationRack: location_rack || null,
        stockBoxes: parseInt(stock_boxes) || 0,
        stockLoose: parseInt(stock_loose) || 0,
        minStockAlert: parseInt(min_stock_alert) || 10,
        allowOpenSale: allow_open_sale !== undefined ? (allow_open_sale ? 1 : 0) : 1,
        minSaleQty: parseInt(min_sale_qty) || 1,
        status: status || 'active'
      }
      });
      // Stock edited here keeps its batches in step (added stock: opening batch; lowered: earliest expiry first)
      await syncProductBatches(tx, idNum);
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
    if (!(await requirePermission(req, res, 'can_delete_product', 'You do not have permission to delete medicines.'))) return;
    const idNum = Number(req.params.id);
    await prisma.product.delete({ where: { id: idNum } });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
