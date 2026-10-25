import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { sessionIdentity, requirePermission, sendError } from '../http/context';
import { parseBody, createPurchaseSchema } from '../validation/schemas';
import { round2, statusFor } from '../suppliers/ledgerMath';
import { loadSupplierLedger } from '../suppliers/loadLedger';
import { localDateKey, localDateString } from '../../shared/dates';

// Supplier purchases (stock inward)
const router = Router();

router.get('/api/purchases', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'purchases', 'You do not have access to purchases.'))) return;
    const purchases = await prisma.$queryRaw<any[]>`
      SELECT p.*, c.name as company_name, c.code as company_code
      FROM purchases p
      LEFT JOIN companies c ON p.company_id = c.id
      ORDER BY p.id DESC LIMIT 100
    `;
    // Status and amount due come from the supplier ledger, so later payments and returns are counted
    const dues = new Map<number, { status: string; due: number }>();
    for (const companyId of new Set(purchases.map(p => Number(p.company_id)))) {
      for (const d of (await loadSupplierLedger(companyId)).dues) dues.set(d.id, { status: d.status, due: d.due });
    }
    res.json(purchases.map(p => {
      const due = dues.get(Number(p.id));
      return due ? { ...p, payment_status: due.status, amount_due: due.due } : p;
    }));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// One purchase with its lines; each line says how many boxes can still go back to the supplier
router.get('/api/purchases/:id', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'purchases', 'You do not have access to purchases.'))) return;
    const purchase = await prisma.purchase.findUnique({
      where: { id: Number(req.params.id) || 0 },
      include: { items: { include: { returnItems: { select: { quantityBoxes: true } } }, orderBy: { id: 'asc' } }, company: { select: { code: true } } }
    });
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    const due = (await loadSupplierLedger(purchase.companyId)).dues.find(d => d.id === purchase.id);
    res.json({
      id: purchase.id,
      invoice_no: purchase.invoiceNo,
      supplier_invoice_no: purchase.supplierInvoiceNo,
      company_id: purchase.companyId,
      company_name: purchase.companyName,
      company_code: purchase.company.code,
      purchase_date: purchase.purchaseDate,
      total_gross: purchase.totalGross,
      discount_amount: purchase.discountAmount,
      tax_amount: purchase.taxAmount,
      net_total: purchase.netTotal,
      paid_amount: purchase.paidAmount,
      payment_status: due?.status ?? purchase.paymentStatus,
      amount_due: due?.due ?? 0,
      notes: purchase.notes,
      created_at: purchase.createdAt,
      items: purchase.items.map(item => {
        const returned = item.returnItems.reduce((sum, r) => sum + r.quantityBoxes, 0);
        return {
          id: item.id,
          purchase_id: item.purchaseId,
          product_id: item.productId,
          product_name: item.productName,
          batch_no: item.batchNo,
          expiry_date: item.expiryDate,
          quantity_boxes: item.quantityBoxes,
          bonus_boxes: item.bonusBoxes,
          box_cost_price: item.boxCostPrice,
          box_retail_price: item.boxRetailPrice,
          discount_pct: item.discountPct,
          total_cost: item.totalCost,
          returned_boxes: returned,
          returnable_boxes: Math.max(0, item.quantityBoxes + item.bonusBoxes - returned)
        };
      })
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/purchases', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_add_purchase', 'You do not have permission to record purchases.'))) return;
    const body = parseBody(createPurchaseSchema, req.body, res);
    if (!body) return;
    const { supplier_invoice_no, notes } = req.body;
    // Identity always comes from the login session, never from the request body
    const { user_id } = await sessionIdentity(req);

    const company = await prisma.company.findUnique({ where: { id: body.company_id } });
    if (!company) return res.status(400).json({ error: 'Company not found' });

    const today = localDateKey();

    const executePurchase = () => prisma.$transaction(async (tx) => {
      // Every line is costed here; the client's totals are ignored
      const lines = [];
      for (const item of body.items as any[]) {
        const prod = await tx.product.findUnique({ where: { id: Number(item.product_id) } });
        if (!prod) throw new Error(`Medicine #${item.product_id} was not found. Remove it from the purchase and add it again.`);
        const qtyBoxes = Number(item.quantity_boxes);
        const discPct = Number(item.discount_pct ?? 0);
        const boxCost = round2(Number(item.box_cost_price));
        lines.push({
          prod,
          item,
          qtyBoxes,
          bonusBoxes: Number(item.bonus_boxes ?? 0),
          boxCost,
          boxRetail: round2(Number(item.box_retail_price)),
          discPct,
          totalCost: round2(qtyBoxes * boxCost * (1 - discPct / 100))
        });
      }

      const totalGross = round2(lines.reduce((sum, l) => sum + l.totalCost, 0));
      const discountAmount = round2(body.discount_amount ?? 0);
      const taxAmount = round2(body.tax_amount ?? 0);
      if (discountAmount > totalGross + taxAmount) throw new Error('The discount cannot be more than the purchase total.');
      const netTotal = round2(totalGross - discountAmount + taxAmount);

      // Paid now: an amount when given, otherwise the old status choice (Paid = all, Pending = nothing)
      const paidAmount = body.paid_amount !== undefined ? round2(body.paid_amount) : body.payment_status === 'Paid' || !body.payment_status ? netTotal : 0;
      if (paidAmount > netTotal + 0.005) throw new Error(`Paid now (${paidAmount.toFixed(2)}) cannot be more than the purchase total (${netTotal.toFixed(2)}).`);

      const latest = await tx.purchase.findFirst({ where: { invoiceNo: { startsWith: `PUR-${today}-` } }, orderBy: { id: 'desc' }, select: { invoiceNo: true } });
      const nextSeq = (Number(latest?.invoiceNo.split('-').pop()) || 0) + 1;
      const invoiceNo = `PUR-${today}-${String(nextSeq).padStart(4, '0')}`;

      const purchase = await tx.purchase.create({
        data: {
          invoiceNo,
          supplierInvoiceNo: supplier_invoice_no || null,
          companyId: company.id,
          companyName: company.name,
          purchaseDate: body.purchase_date ?? localDateString(),
          totalGross,
          discountAmount,
          taxAmount,
          netTotal,
          paymentStatus: statusFor(netTotal, paidAmount),
          paidAmount,
          notes: notes || null,
          userId: user_id ? Number(user_id) : null
        }
      });

      for (const { prod, item, qtyBoxes, bonusBoxes, boxCost, boxRetail, discPct, totalCost } of lines) {
        const totalBoxes = qtyBoxes + bonusBoxes;
        const packing = prod.packing || 1;

        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            productId: prod.id,
            productName: prod.name,
            batchNo: item.batch_no || 'NA',
            expiryDate: item.expiry_date || '',
            quantityBoxes: qtyBoxes,
            bonusBoxes,
            boxCostPrice: boxCost,
            boxRetailPrice: boxRetail,
            discountPct: discPct,
            totalCost
          }
        });

        await tx.product.update({
          where: { id: prod.id },
          data: {
            stockBoxes: { increment: totalBoxes },
            boxTradePrice: boxCost,
            boxRetailPrice: boxRetail,
            unitTradePrice: round2(boxCost / packing),
            unitRetailPrice: round2(boxRetail / packing)
          }
        });

        await tx.productBatch.create({
          data: {
            productId: prod.id,
            batchNo: item.batch_no || 'B-NEW',
            expiryDate: item.expiry_date || '',
            purchaseCost: boxCost,
            retailPrice: boxRetail,
            quantityBoxes: totalBoxes
          }
        });
      }

      return { purchaseId: purchase.id, invoiceNo, netTotal, paidAmount };
    });

    let result: Awaited<ReturnType<typeof executePurchase>> | null = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        result = await executePurchase();
        break;
      } catch (err: any) {
        if ((err.code === 'P2002' || err.message?.includes('SQLITE_BUSY')) && attempt < 5) {
          await new Promise((r) => setTimeout(r, 25 * attempt));
          continue;
        }
        throw err;
      }
    }

    res.json({ success: true, ...result });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
