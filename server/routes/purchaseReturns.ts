import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { parseBody, createPurchaseReturnSchema } from '../validation/schemas';
import { requirePermission, sendError } from '../http/context';
import { logSecurityAudit } from '../security/audit';
import { lineCostRate, pricePurchaseReturn, type ReturnPurchaseLine } from '../purchaseReturns/returnMath';
import { round2 } from '../suppliers/ledgerMath';
import { localDateKey, localDateString } from '../../shared/dates';
import { takeUnitsFromBatch } from '../stock/batchStock';

// Returns to suppliers (damaged or expired goods) and expiry claims. A return lowers stock and is a credit
// against what the store owes that supplier (see server/suppliers/ledgerMath.ts).
const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Boxes already returned per purchase line */
async function returnedBoxesByLine(purchaseItemIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (purchaseItemIds.length === 0) return map;
  const rows = await prisma.purchaseReturnItem.groupBy({
    by: ['purchaseItemId'],
    where: { purchaseItemId: { in: purchaseItemIds } },
    _sum: { quantityBoxes: true }
  });
  for (const row of rows) if (row.purchaseItemId) map.set(row.purchaseItemId, row._sum.quantityBoxes ?? 0);
  return map;
}

router.get('/api/purchase-returns', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'purchases', 'You do not have access to purchases.'))) return;
    const returns = await prisma.purchaseReturn.findMany({
      orderBy: { id: 'desc' },
      take: 200,
      include: { _count: { select: { items: true } }, purchase: { select: { invoiceNo: true } } }
    });
    res.json(returns.map(r => ({
      id: r.id,
      return_no: r.returnNo,
      company_id: r.companyId,
      company_name: r.companyName,
      purchase_invoice_no: r.purchase?.invoiceNo ?? null,
      return_date: r.returnDate,
      total_credit: r.totalRefund,
      reason: r.reason,
      is_expiry_claim: r.isExpiryClaim === 1,
      items_count: r._count.items,
      user_name: r.userName
    })));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Expired and near-expiry stock that can be claimed back from its supplier
router.get('/api/purchase-returns/expiry-candidates', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'purchases', 'You do not have access to purchases.'))) return;
    const days = Math.min(365, Math.max(0, Math.floor(Number(req.query.days ?? 90)) || 0));
    const companyId = Number(req.query.company_id) || null;
    const today = localDateString();
    const until = localDateString(new Date(Date.now() + days * DAY_MS));

    const batches = await prisma.productBatch.findMany({
      where: {
        quantityBoxes: { gt: 0 },
        expiryDate: { gt: '', lte: until },
        product: { status: 'active', stockBoxes: { gt: 0 }, companyId: companyId ?? { not: null } }
      },
      include: { product: { include: { company: true } } },
      orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }]
    });

    // The purchase line each batch came from gives the credit rate and how much of it is still returnable
    const lines = await prisma.purchaseItem.findMany({
      where: { OR: batches.map(b => ({ productId: b.productId, batchNo: b.batchNo })) },
      include: { purchase: { select: { companyId: true } } },
      orderBy: { id: 'desc' }
    });
    const returned = await returnedBoxesByLine(lines.map(l => l.id));

    // Sales take batches first-expiry-first, so batches match the shelf; the stock cap is only a safety net
    const stockLeft = new Map<number, number>();
    const result = [];
    for (const b of batches) {
      const product = b.product;
      const line = lines.find(l => l.productId === b.productId && l.batchNo === b.batchNo && l.purchase.companyId === product.companyId);
      const lineLeft = line ? line.quantityBoxes + line.bonusBoxes - (returned.get(line.id) ?? 0) : Infinity;
      const stock = stockLeft.get(product.id) ?? product.stockBoxes;
      const boxes = Math.min(b.quantityBoxes, stock, lineLeft);
      if (boxes <= 0) continue;
      stockLeft.set(product.id, stock - boxes);
      const rate = line ? lineCostRate(line) : round2(product.boxTradePrice);
      result.push({
        batch_id: b.id,
        product_id: product.id,
        product_name: product.name,
        company_id: product.companyId,
        company_name: product.company?.name ?? '',
        batch_no: b.batchNo,
        expiry_date: b.expiryDate,
        expired: b.expiryDate <= today,
        days_left: Math.round((new Date(`${b.expiryDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / DAY_MS),
        boxes,
        purchase_item_id: line?.id ?? null,
        rate,
        credit: round2(rate * boxes)
      });
    }
    res.json(result);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.get('/api/purchase-returns/:id', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'purchases', 'You do not have access to purchases.'))) return;
    const ret = await prisma.purchaseReturn.findUnique({
      where: { id: Number(req.params.id) || 0 },
      include: { items: { include: { product: { select: { name: true, pCode: true } } } }, purchase: { select: { invoiceNo: true, supplierInvoiceNo: true } }, company: true }
    });
    if (!ret) return res.status(404).json({ error: 'Return not found' });
    res.json({
      id: ret.id,
      return_no: ret.returnNo,
      company_id: ret.companyId,
      company_name: ret.companyName,
      company_code: ret.company.code,
      company_phone: ret.company.phone,
      purchase_invoice_no: ret.purchase?.invoiceNo ?? null,
      supplier_invoice_no: ret.purchase?.supplierInvoiceNo ?? null,
      return_date: ret.returnDate,
      total_credit: ret.totalRefund,
      reason: ret.reason,
      is_expiry_claim: ret.isExpiryClaim === 1,
      user_name: ret.userName,
      items: ret.items.map(i => ({
        id: i.id,
        product_id: i.productId,
        product_name: i.productName ?? i.product.name,
        p_code: i.product.pCode,
        batch_no: i.batchNo,
        quantity_boxes: i.quantityBoxes,
        rate: i.boxCostPrice,
        credit: i.totalRefund
      }))
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/purchase-returns', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_return_purchase', 'You do not have permission to return goods to suppliers.');
    if (!actor) return;
    const body = parseBody(createPurchaseReturnSchema, req.body, res);
    if (!body) return;

    const company = await prisma.company.findUnique({ where: { id: body.company_id } });
    if (!company) return res.status(400).json({ error: 'Supplier not found' });
    const today = localDateKey();

    const executeReturn = () => prisma.$transaction(async (tx) => {
      const productIds = [...new Set(body.items.map(i => i.product_id))];
      const lineIds = [...new Set(body.items.map(i => i.purchase_item_id).filter((id): id is number => !!id))];
      const [products, purchaseItems, returnedRows] = await Promise.all([
        tx.product.findMany({ where: { id: { in: productIds } } }),
        tx.purchaseItem.findMany({ where: { id: { in: lineIds } }, include: { purchase: { select: { companyId: true } } } }),
        lineIds.length
          ? tx.purchaseReturnItem.groupBy({ by: ['purchaseItemId'], where: { purchaseItemId: { in: lineIds } }, _sum: { quantityBoxes: true } })
          : Promise.resolve([])
      ]);
      if (body.purchase_id && purchaseItems.some(l => l.purchaseId !== body.purchase_id)) {
        throw new Error('A returned line is not on the chosen purchase.');
      }
      const returned = new Map(returnedRows.map(r => [r.purchaseItemId, r._sum.quantityBoxes ?? 0]));
      const lines = new Map<number, ReturnPurchaseLine>(purchaseItems.map(l => [l.id, {
        id: l.id,
        purchaseCompanyId: l.purchase.companyId,
        productId: l.productId,
        quantityBoxes: l.quantityBoxes,
        bonusBoxes: l.bonusBoxes,
        boxCostPrice: l.boxCostPrice,
        discountPct: l.discountPct,
        batchNo: l.batchNo,
        returnedBoxes: returned.get(l.id) ?? 0
      }]));

      const priced = pricePurchaseReturn(
        company.id,
        body.items.map(i => ({ productId: i.product_id, quantityBoxes: i.quantity_boxes, purchaseItemId: i.purchase_item_id ?? null, batchNo: i.batch_no ?? null })),
        new Map(products.map(p => [p.id, { id: p.id, name: p.name, companyId: p.companyId, stockBoxes: p.stockBoxes, boxTradePrice: p.boxTradePrice }])),
        lines
      );

      const latest = await tx.purchaseReturn.findFirst({ where: { returnNo: { startsWith: `PRET-${today}-` } }, orderBy: { id: 'desc' }, select: { returnNo: true } });
      const returnNo = `PRET-${today}-${String((Number(latest?.returnNo.split('-').pop()) || 0) + 1).padStart(4, '0')}`;

      const created = await tx.purchaseReturn.create({
        data: {
          returnNo,
          purchaseId: body.purchase_id ?? null,
          companyId: company.id,
          companyName: company.name,
          returnDate: body.return_date ?? localDateString(),
          totalRefund: priced.totalCredit,
          reason: body.reason || null,
          isExpiryClaim: body.is_expiry_claim ? 1 : 0,
          userId: actor.id,
          userName: actor.fullName || actor.username
        }
      });

      for (const line of priced.lines) {
        await tx.purchaseReturnItem.create({
          data: {
            purchaseReturnId: created.id,
            productId: line.productId,
            productName: line.productName,
            purchaseItemId: line.purchaseItemId,
            batchNo: line.batchNo,
            quantityBoxes: line.quantityBoxes,
            boxCostPrice: line.rate,
            totalRefund: line.credit
          }
        });
        // The named batch goes down first (so the expiry list stops offering it), then the earliest expiry
        const product = products.find(p => p.id === line.productId)!;
        const packing = Math.max(1, product.packing || 1);
        await takeUnitsFromBatch(tx, { id: product.id, name: product.name, packing, unitType: product.unitType }, line.quantityBoxes * packing, line.batchNo);
        await tx.product.update({ where: { id: line.productId }, data: { stockBoxes: { decrement: line.quantityBoxes } } });
      }
      return { id: created.id, returnNo, totalCredit: priced.totalCredit, boxes: priced.lines.reduce((s, l) => s + l.quantityBoxes, 0) };
    });

    let result: Awaited<ReturnType<typeof executeReturn>> | null = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        result = await executeReturn();
        break;
      } catch (err: any) {
        if ((err.code === 'P2002' || err.message?.includes('SQLITE_BUSY')) && attempt < 5) {
          await new Promise((r) => setTimeout(r, 25 * attempt));
          continue;
        }
        throw err;
      }
    }

    await logSecurityAudit({
      action: body.is_expiry_claim ? 'EXPIRY_CLAIM' : 'PURCHASE_RETURN',
      module: 'Purchases',
      status: 'SUCCESS',
      details: `${result!.returnNo}: ${result!.boxes} box(es) returned to ${company.name}, credit ${result!.totalCredit.toFixed(2)}`,
      userId: actor.id,
      userName: actor.username
    });

    res.json({ success: true, id: result!.id, returnNo: result!.returnNo, totalCredit: result!.totalCredit });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
