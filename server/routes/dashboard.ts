import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { hasAnyPermission, hasRolePermission, requirePermission, sendError } from '../http/context';
import { appVersion } from '../lan/lanGate';
import { localDateSql } from '../http/sqlDates';
import { localDateString } from '../../shared/dates';

// Health check and dashboard KPIs
const router = Router();

router.get('/api/status', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: appVersion(), time: new Date().toISOString() });
});

router.get('/api/dashboard/stats', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'dashboard', 'You do not have access to the dashboard.');
    if (!actor) return;
    const canSeeRevenue = await hasRolePermission(actor.role, 'can_view_financial_kpis');
    // Today in the shop's own calendar, whatever format a sale's date was stored in (localDateSql); UTC
    // boundaries used to put sales made after midnight on the day before
    const today = localDateString();
    const todayRaw = await prisma.$queryRaw<Array<{ invoices: bigint | number; net: number | null; gross: number | null }>>`
      SELECT COUNT(*) AS invoices, SUM(net_total) AS net, SUM(total_gross) AS gross
      FROM sales
      WHERE status IN ('completed', 'partially_returned') AND ${localDateSql('sale_date')} = ${today}
    `;

    const totalRevenue = Number(todayRaw[0]?.net || 0);
    const totalGross = Number(todayRaw[0]?.gross || 0);
    // Revenue figures only for roles allowed to see them; the page hides the card for everyone else
    const todaySales = {
      total_invoices: Number(todayRaw[0]?.invoices || 0),
      total_revenue: canSeeRevenue ? totalRevenue : null,
      total_discount: canSeeRevenue ? totalGross - totalRevenue : null
    };

    const totalProducts = await prisma.product.count({ where: { status: 'active' } });

    const lowStockRaw = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*) as count FROM products WHERE stock_boxes <= min_stock_alert AND status = 'active'
    `;
    const lowStockCount = Number(lowStockRaw[0]?.count || 0);

    const outOfStockCount = await prisma.product.count({
      where: { stockBoxes: 0, stockLoose: 0, status: 'active' }
    });

    // Batches with stock left (sales take the earliest expiry first, so these are real quantities)
    const localToday = localDateString();
    const dayAhead = (days: number) => localDateString(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
    const batchesUntil = (until: string, after?: string) => prisma.productBatch.count({
      where: {
        expiryDate: after ? { gt: after, lte: until } : { not: '', lte: until },
        OR: [{ quantityBoxes: { gt: 0 } }, { quantityLoose: { gt: 0 } }]
      }
    });
    const [expiredCount, d30, d60, d90] = await Promise.all([
      batchesUntil(localToday),
      batchesUntil(dayAhead(30), localToday),
      batchesUntil(dayAhead(60), localToday),
      batchesUntil(dayAhead(90), localToday)
    ]);

    const recentSales = await prisma.sale.findMany({
      select: {
        id: true,
        invoiceNo: true,
        customerName: true,
        netTotal: true,
        paymentType: true,
        saleDate: true,
        status: true
      },
      orderBy: { id: 'desc' },
      take: 6
    });

    const lowStockItems = await prisma.$queryRaw<Array<{
      id: number;
      c_code: string;
      p_code: string;
      name: string;
      unit_type: string;
      stock_boxes: number;
      stock_loose: number;
      min_stock_alert: number;
      location_rack: string | null;
    }>>`
      SELECT p.id, p.c_code, p.p_code, p.name, p.unit_type, p.stock_boxes, p.stock_loose, p.min_stock_alert, p.location_rack
      FROM products p
      WHERE (p.stock_boxes <= p.min_stock_alert) AND p.status = 'active'
      ORDER BY p.stock_boxes ASC
      LIMIT 8
    `;

    // Who is selling right now, for shift managers only (the card has no cash figures)
    const activeShifts = await hasAnyPermission(actor.role, ['shifts', 'can_manage_shifts'])
      ? (await prisma.cashierShift.findMany({ where: { status: 'open' }, orderBy: { startTime: 'asc' } })).map(s => ({
          id: s.id,
          shift_no: s.shiftNo,
          user_name: s.userName,
          terminal_name: s.terminalName,
          start_time: s.startTime
        }))
      : null;

    res.json({
      todaySales,
      activeShifts,
      totalProducts,
      lowStockCount,
      outOfStockCount,
      expiredCount,
      nearExpiry: { d30, d60, d90 },
      recentSales: recentSales.map(s => ({
        id: s.id,
        invoice_no: s.invoiceNo,
        customer_name: s.customerName,
        net_total: s.netTotal,
        payment_type: s.paymentType,
        sale_date: s.saleDate,
        status: s.status
      })),
      lowStockItems
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
