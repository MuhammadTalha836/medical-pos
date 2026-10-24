import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { sessionIdentity, requirePermission, sendError } from '../http/context';

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
    res.json(purchases);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/purchases', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_add_purchase', 'You do not have permission to record purchases.'))) return;
    const {
      supplier_invoice_no,
      company_id,
      purchase_date,
      items,
      total_gross,
      discount_amount,
      tax_amount,
      net_total,
      payment_status,
      notes
    } = req.body;
    // Identity always comes from the login session, never from the request body
    const { user_id } = await sessionIdentity(req);

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Purchase must have items' });
    }

    const company = await prisma.company.findUnique({ where: { id: Number(company_id) } });
    if (!company) return res.status(400).json({ error: 'Company not found' });

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await prisma.purchase.count({
      where: { invoiceNo: { startsWith: `PUR-${today}-` } }
    });
    const invoiceNo = `PUR-${today}-${String(countToday + 1).padStart(4, '0')}`;

    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          invoiceNo,
          supplierInvoiceNo: supplier_invoice_no || null,
          companyId: company.id,
          companyName: company.name,
          purchaseDate: purchase_date || new Date().toISOString().split('T')[0],
          totalGross: parseFloat(total_gross) || 0,
          discountAmount: parseFloat(discount_amount) || 0,
          taxAmount: parseFloat(tax_amount) || 0,
          netTotal: parseFloat(net_total) || 0,
          paymentStatus: payment_status || 'Paid',
          notes: notes || null,
          userId: user_id ? Number(user_id) : null
        }
      });

      for (const item of items) {
        const prod = await tx.product.findUnique({ where: { id: Number(item.product_id) } });
        if (prod) {
          const qtyBoxes = Number(item.quantity_boxes ?? item.boxes ?? 0);
          const bonusBoxes = Number(item.bonus_boxes || 0);
          const totalBoxes = qtyBoxes + bonusBoxes;
          const packing = prod.packing || 1;
          const boxCost = Number(item.box_cost_price ?? item.box_trade_price ?? prod.boxTradePrice ?? 0);
          const boxRetail = Number(item.box_retail_price ?? prod.boxRetailPrice ?? 0);
          const unitCost = packing > 0 ? (boxCost / packing) : boxCost;
          const unitRetail = packing > 0 ? (boxRetail / packing) : boxRetail;
          const discPct = parseFloat(item.discount_pct) || 0;
          const totalCost = item.total_cost !== undefined ? parseFloat(item.total_cost) : (qtyBoxes * boxCost * (1 - discPct / 100));

          await tx.purchaseItem.create({
            data: {
              purchaseId: purchase.id,
              productId: prod.id,
              productName: prod.name,
              batchNo: item.batch_no || 'NA',
              expiryDate: item.expiry_date || '',
              quantityBoxes: qtyBoxes,
              bonusBoxes: bonusBoxes,
              boxCostPrice: boxCost,
              boxRetailPrice: boxRetail,
              discountPct: discPct,
              totalCost: totalCost
            }
          });

          await tx.product.update({
            where: { id: prod.id },
            data: {
              stockBoxes: { increment: totalBoxes },
              boxTradePrice: boxCost,
              boxRetailPrice: boxRetail,
              unitTradePrice: unitCost,
              unitRetailPrice: unitRetail
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
      }

      return { purchaseId: purchase.id, invoiceNo };
    });

    res.json({ success: true, ...result });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
