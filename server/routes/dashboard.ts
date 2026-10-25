import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { hasRolePermission, requirePermission, sendError } from '../http/context';
import { localDateString } from '../../shared/dates';

// Health check and dashboard KPIs
const router = Router();

router.get('/api/status', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() });
});

router.get('/api/dashboard/stats', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'dashboard', 'You do not have access to the dashboard.');
    if (!actor) return;
    const canSeeRevenue = await hasRolePermission(actor.role, 'can_view_financial_kpis');
    const today = new Date().toISOString().split('T')[0];
    const startOfToday = new Date(today + 'T00:00:00.000Z');
    const endOfToday = new Date(today + 'T23:59:59.999Z');

    const todaySalesAgg = await prisma.sale.aggregate({
      where: {
        saleDate: {
          gte: startOfToday,
          lte: endOfToday
        },
        status: { in: ['completed', 'partially_returned'] }
      },
      _count: { id: true },
      _sum: {
        netTotal: true,
        totalGross: true
      }
    });

    const totalRevenue = todaySalesAgg._sum.netTotal || 0;
    const totalGross = todaySalesAgg._sum.totalGross || 0;
    // Revenue figures only for roles allowed to see them; the page hides the card for everyone else
    const todaySales = {
      total_invoices: todaySalesAgg._count.id || 0,
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

    res.json({
      todaySales,
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
