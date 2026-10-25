import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { requirePermission, sendError } from '../http/context';
import { SALES_WINDOW_DAYS, clampCoverDays, suggestReorder } from '../reorder/reorderMath';
import { DEFAULT_SETTINGS } from '../../shared/settingsDefaults';

// Reorder (short) list: medicines below their minimum or selling out, with the boxes to order from each supplier
const router = Router();

const COUNTED_SALE_STATUSES = ['completed', 'partially_returned'];

router.get('/api/reorder', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'purchases', 'You do not have access to purchases.'))) return;
    const saved = await prisma.systemSetting.findUnique({ where: { key: 'reorder_cover_days' } });
    const coverDays = clampCoverDays(req.query.cover_days, clampCoverDays(saved?.value, Number(DEFAULT_SETTINGS.reorder_cover_days)));
    const companyId = Number(req.query.company_id) || null;
    const since = new Date(Date.now() - SALES_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [products, soldLines, returnedLines] = await Promise.all([
      prisma.product.findMany({
        where: { status: 'active', ...(companyId ? { companyId } : {}) },
        include: { company: { select: { name: true, phone: true } } }
      }),
      prisma.saleItem.findMany({
        where: { sale: { saleDate: { gte: since }, status: { in: COUNTED_SALE_STATUSES } } },
        select: { productId: true, isLoose: true, quantity: true }
      }),
      // A fully returned invoice is already left out above; take off what came back from part-returned ones
      prisma.saleReturnItem.findMany({
        where: { saleReturn: { sale: { saleDate: { gte: since }, status: 'partially_returned' } } },
        select: { productId: true, isLoose: true, quantity: true }
      })
    ]);

    const packingOf = new Map(products.map(p => [p.id, Math.max(1, p.packing || 1)]));
    const soldUnits = new Map<number, number>();
    const add = (productId: number, isLoose: number, quantity: number, sign: number) => {
      const packing = packingOf.get(productId);
      if (!packing) return;
      soldUnits.set(productId, (soldUnits.get(productId) ?? 0) + sign * (isLoose ? quantity : quantity * packing));
    };
    for (const line of soldLines) add(line.productId, line.isLoose, line.quantity, 1);
    for (const line of returnedLines) add(line.productId, line.isLoose, line.quantity, -1);

    const items = [];
    for (const p of products) {
      const sold = Math.max(0, soldUnits.get(p.id) ?? 0);
      const suggestion = suggestReorder(p, sold, coverDays);
      if (!suggestion) continue;
      items.push({
        product_id: p.id,
        name: p.name,
        generic_name: p.genericName,
        company_id: p.companyId,
        company_name: p.company?.name ?? 'No supplier',
        company_phone: p.company?.phone ?? null,
        packing: Math.max(1, p.packing || 1),
        unit_type: p.unitType,
        stock_boxes: p.stockBoxes,
        stock_loose: p.stockLoose,
        min_stock_alert: p.minStockAlert,
        sold_30d_units: sold,
        avg_daily_units: suggestion.avgDailyUnits,
        days_left: suggestion.daysLeft,
        reason: suggestion.reason,
        suggested_boxes: suggestion.suggestedBoxes,
        box_trade_price: p.boxTradePrice,
        box_retail_price: p.boxRetailPrice,
        estimated_cost: Math.round(suggestion.suggestedBoxes * p.boxTradePrice * 100) / 100
      });
    }
    // By supplier, then the medicine that runs out first
    items.sort((a, b) =>
      a.company_name.localeCompare(b.company_name) ||
      (a.days_left ?? Infinity) - (b.days_left ?? Infinity) ||
      a.name.localeCompare(b.name)
    );

    res.json({ cover_days: coverDays, generated_at: new Date().toISOString(), items });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
