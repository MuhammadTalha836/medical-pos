import { Router, type Request, type Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { requirePermission, sendError } from '../http/context';
import { localDateSql } from '../http/sqlDates';
import { localDateString } from '../../shared/dates';

// Stock, profit/loss and sales reports
const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const isDateParam = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

// Available Stock with valuation
router.get('/api/reports/stock/available', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'reports', 'You do not have access to reports.'))) return;
    const stock = await prisma.$queryRaw<any[]>`
      SELECT 
        p.id, p.c_code, p.p_code, p.name, p.generic_name, p.unit_type, p.packing,
        p.location_rack, p.stock_boxes, p.stock_loose, p.box_trade_price, p.box_retail_price,
        p.unit_trade_price, p.unit_retail_price,
        ((p.stock_boxes * p.box_trade_price) + (p.stock_loose * p.unit_trade_price)) as total_cost_value,
        ((p.stock_boxes * p.box_retail_price) + (p.stock_loose * p.unit_retail_price)) as total_retail_value,
        c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.status = 'active'
      ORDER BY p.name ASC
    `;
    res.json(stock);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Expired & Near-Expiry Products
router.get('/api/reports/stock/expired', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'reports', 'You do not have access to reports.'))) return;
    const days = Math.min(365, Math.max(0, Math.floor(Number(req.query.days ?? 0)) || 0));
    const today = localDateString();
    const targetStr = localDateString(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

    const expired = await prisma.$queryRaw<any[]>`
      SELECT 
        b.id as batch_id, b.batch_no, b.expiry_date, b.quantity_boxes, b.quantity_loose,
        p.id as product_id, p.c_code, p.p_code, p.name as product_name, p.unit_type, p.location_rack,
        p.packing, p.box_trade_price,
        ((b.quantity_boxes * p.box_trade_price) + (b.quantity_loose * p.box_trade_price / MAX(p.packing, 1))) as loss_valuation,
        c.name as company_name
      FROM product_batches b
      JOIN products p ON b.product_id = p.id
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE b.expiry_date != '' AND b.expiry_date <= ${targetStr} AND (b.quantity_boxes > 0 OR b.quantity_loose > 0)
      ORDER BY b.expiry_date ASC
    `;

    // Batches follow every sale (FEFO), so these are the quantities really on the shelf
    res.json(expired.map(row => ({ ...row, expired: row.expiry_date <= today })));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Finished / Zero stock
router.get('/api/reports/stock/finished', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'reports', 'You do not have access to reports.'))) return;
    const finished = await prisma.$queryRaw<any[]>`
      SELECT p.id, p.c_code, p.p_code, p.name, p.unit_type, p.location_rack, p.box_retail_price, c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.stock_boxes = 0 AND p.stock_loose = 0 AND p.status = 'active'
      ORDER BY p.name ASC
    `;
    res.json(finished);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Sales & Profit/Loss Summary
router.get('/api/reports/financial/pnl-summary', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'reports', 'You do not have access to reports.'))) return;
    if (!(await requirePermission(req, res, 'can_view_financial_kpis', 'You do not have permission to view profit and revenue reports.'))) return;
    const { date_from, date_to } = req.query;
    const conditions: Prisma.Sql[] = [Prisma.sql`s.status IN ('completed', 'partially_returned')`];

    if (date_from) {
      conditions.push(Prisma.sql`${localDateSql('s.sale_date')} >= ${String(date_from)}`);
    }
    if (date_to) {
      conditions.push(Prisma.sql`${localDateSql('s.sale_date')} <= ${String(date_to)}`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const pnlRaw = await prisma.$queryRaw<any[]>`
      SELECT 
        COUNT(DISTINCT s.id) as total_invoices,
        COALESCE(SUM(si.net_amount), 0) as total_revenue,
        COALESCE(SUM(si.quantity * si.unit_cost), 0) as total_cost_of_goods,
        -- The bill discount once per invoice (the join above repeats it on every line)
        COALESCE(SUM(si.net_amount) - SUM(si.quantity * si.unit_cost), 0)
          - (SELECT COALESCE(SUM(s.bill_discount_amt), 0) FROM sales s WHERE ${whereClause}) as gross_profit
      FROM sales s
      JOIN sale_items si ON s.id = si.sale_id
      WHERE ${whereClause}
    `;

    res.json(pnlRaw[0] || { total_invoices: 0, total_revenue: 0, total_cost_of_goods: 0, gross_profit: 0 });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Invoice-wise P&L
router.get('/api/reports/financial/invoice-pnl', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'reports', 'You do not have access to reports.'))) return;
    if (!(await requirePermission(req, res, 'can_view_financial_kpis', 'You do not have permission to view profit and revenue reports.'))) return;
    const { date_from, date_to } = req.query;
    const conditions: Prisma.Sql[] = [Prisma.sql`s.status IN ('completed', 'partially_returned')`];

    if (date_from) {
      conditions.push(Prisma.sql`${localDateSql('s.sale_date')} >= ${String(date_from)}`);
    }
    if (date_to) {
      conditions.push(Prisma.sql`${localDateSql('s.sale_date')} <= ${String(date_to)}`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const list = await prisma.$queryRaw<any[]>`
      SELECT 
        s.id, s.invoice_no, s.sale_date, s.customer_name, s.payment_type,
        s.net_total as sale_amount,
        SUM(si.quantity * si.unit_cost) as total_cost,
        (s.net_total - SUM(si.quantity * si.unit_cost)) as net_profit,
        ROUND(((s.net_total - SUM(si.quantity * si.unit_cost)) / NULLIF(s.net_total, 0)) * 100, 2) as profit_margin_pct
      FROM sales s
      JOIN sale_items si ON s.id = si.sale_id
      WHERE ${whereClause}
      GROUP BY s.id
      ORDER BY s.id DESC
      LIMIT 100
    `;

    res.json(list);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

/** Counted sales, optionally within ?date_from=&date_to= (the shop's local days) */
function saleDateRange(req: Request): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`s.status IN ('completed', 'partially_returned')`];
  if (isDateParam(req.query.date_from)) conditions.push(Prisma.sql`${localDateSql('s.sale_date')} >= ${String(req.query.date_from)}`);
  if (isDateParam(req.query.date_to)) conditions.push(Prisma.sql`${localDateSql('s.sale_date')} <= ${String(req.query.date_to)}`);
  return Prisma.join(conditions, ' AND ');
}

// Product-wise sales
router.get('/api/reports/sales/product-wise', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'reports', 'You do not have access to reports.'))) return;
    const list = await prisma.$queryRaw<any[]>`
      SELECT 
        si.product_id, si.c_code, si.p_code, si.product_name, si.unit_type,
        SUM(si.quantity) as total_quantity_sold,
        SUM(si.net_amount) as total_sales_amount,
        SUM(si.quantity * si.unit_cost) as total_cost_amount,
        (SUM(si.net_amount) - SUM(si.quantity * si.unit_cost)) as gross_profit
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE ${saleDateRange(req)}
      GROUP BY si.product_id
      ORDER BY total_sales_amount DESC
      LIMIT 50
    `;
    res.json(list);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Company-wise sales
router.get('/api/reports/sales/company-wise', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'reports', 'You do not have access to reports.'))) return;
    const list = await prisma.$queryRaw<any[]>`
      SELECT 
        si.c_code as company_code,
        c.name as company_name,
        COUNT(DISTINCT s.id) as invoice_count,
        SUM(si.quantity) as total_units_sold,
        SUM(si.net_amount) as total_revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN companies c ON si.c_code = c.code
      WHERE ${saleDateRange(req)}
      GROUP BY si.c_code
      ORDER BY total_revenue DESC
    `;
    res.json(list);
  } catch (error: unknown) {
    sendError(res, error);
  }
});


// Controlled-medicine register: every controlled sale line with its prescription, newest first
router.get('/api/reports/controlled-register', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'reports', 'You do not have access to reports.'))) return;
    const { date_from, date_to } = req.query;
    // Local calendar days, like the rest of the app (date_to includes the whole day)
    const createdAt: Prisma.DateTimeFilter = {};
    if (isDateParam(date_from)) createdAt.gte = new Date(`${date_from}T00:00:00`);
    if (isDateParam(date_to)) createdAt.lt = new Date(new Date(`${date_to}T00:00:00`).getTime() + DAY_MS);

    const records = await prisma.prescriptionRecord.findMany({
      where: Object.keys(createdAt).length ? { createdAt } : {},
      include: { sale: { select: { invoiceNo: true, saleDate: true, status: true, customerName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    // Returned quantity per register line: a sale's returns matched by medicine + unit, oldest line first
    const saleIds = [...new Set(records.map(r => r.saleId))];
    const returned = saleIds.length
      ? await prisma.saleReturnItem.findMany({ where: { saleReturn: { saleId: { in: saleIds } } }, include: { saleReturn: { select: { saleId: true } } } })
      : [];
    const left = new Map<string, number>();
    for (const r of returned) {
      const key = `${r.saleReturn.saleId}:${r.productId}:${r.isLoose ? 1 : 0}`;
      left.set(key, (left.get(key) ?? 0) + r.quantity);
    }
    const returnedQty = new Map<number, number>();
    for (const r of [...records].sort((a, b) => a.saleItemId - b.saleItemId)) {
      const key = `${r.saleId}:${r.productId}:${r.isLoose ? 1 : 0}`;
      const taken = Math.min(r.quantity, left.get(key) ?? 0);
      left.set(key, (left.get(key) ?? 0) - taken);
      returnedQty.set(r.id, taken);
    }

    res.json(records.map(r => ({
      id: r.id,
      sale_id: r.saleId,
      invoice_no: r.sale.invoiceNo,
      sale_date: r.sale.saleDate,
      sale_status: r.sale.status,
      product_id: r.productId,
      product_name: r.productName,
      quantity: r.quantity,
      is_loose: r.isLoose === 1,
      // A voided invoice put every unit back (the row stays in the register, marked by its status)
      returned_qty: r.sale.status === 'cancelled' ? r.quantity : returnedQty.get(r.id) ?? 0,
      patient_name: r.patientName,
      patient_phone: r.patientPhone,
      patient_cnic: r.patientCnic,
      doctor_name: r.doctorName,
      doctor_reg_no: r.doctorRegNo,
      prescription_no: r.prescriptionNo,
      notes: r.notes,
      user_name: r.userName,
      created_at: r.createdAt
    })));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
