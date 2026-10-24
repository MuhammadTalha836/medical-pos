import { Router, type Request, type Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { parseBody, createSaleSchema } from '../validation/schemas';
import { sessionIdentity, sendError } from '../http/context';
import { formatSale } from '../http/formatters';
import { DEVELOPER_PROFILE_SETTING_KEYS, composeInvoiceFooter } from '../../shared/developerProfile';

// Counter sales (POS), sales history and returns
const router = Router();

router.post('/api/sales', async (req: Request, res: Response) => {
  try {
    const {
      customer_id,
      customer_name,
      customer_phone,
      items,
      total_gross,
      total_item_discount,
      bill_discount_pct,
      bill_discount_amt,
      net_total,
      cash_tendered,
      change_due,
      payment_type,
      notes,
      shift_id
    } = req.body;
    // Identity always comes from the login session, never from the request body
    const { user_id, user_name } = await sessionIdentity(req);

    if (!parseBody(createSaleSchema, req.body, res)) return;

    // Strict Shift Lock: Verify active open shift
    let activeShiftId = shift_id ? Number(shift_id) : null;
    if (!activeShiftId && user_id) {
      const activeShift = await prisma.cashierShift.findFirst({
        where: { userId: Number(user_id), status: 'open' },
        orderBy: { id: 'desc' }
      });
      if (activeShift) {
        activeShiftId = activeShift.id;
      }
    }

    if (!activeShiftId) {
      return res.status(403).json({ error: 'No active open cashier shift found. You must start a shift before invoicing.' });
    }

    const verifiedShift = await prisma.cashierShift.findUnique({ where: { id: activeShiftId } });
    if (!verifiedShift || verifiedShift.status !== 'open') {
      return res.status(403).json({ error: 'This shift is closed and locked. Sales cannot be added to a closed shift.' });
    }

    // Compute item gross, discount, and net amounts defensively
    let computedGross = 0;
    let computedItemDiscount = 0;
    const computedItems = items.map((item: any) => {
      const qty = parseFloat(item.quantity) || 1;
      const price = parseFloat(item.unit_price) || 0;
      const grossAmt = item.gross_amount !== undefined && !isNaN(parseFloat(item.gross_amount))
        ? parseFloat(item.gross_amount)
        : (qty * price);
      const discPct = parseFloat(item.discount_pct) || 0;
      const discAmt = item.discount_amount !== undefined && !isNaN(parseFloat(item.discount_amount))
        ? parseFloat(item.discount_amount)
        : (grossAmt * (discPct / 100));
      const netAmt = item.net_amount !== undefined && !isNaN(parseFloat(item.net_amount))
        ? parseFloat(item.net_amount)
        : (grossAmt - discAmt);

      computedGross += grossAmt;
      computedItemDiscount += discAmt;
      return {
        ...item,
        quantity: qty,
        unit_price: price,
        gross_amount: grossAmt,
        discount_pct: discPct,
        discount_amount: discAmt,
        net_amount: netAmt
      };
    });

    const finalTotalGross = parseFloat(total_gross) || computedGross;
    const finalItemDiscount = parseFloat(total_item_discount) || computedItemDiscount;
    const billDiscPct = parseFloat(bill_discount_pct) || 0;
    const billDiscAmt = parseFloat(bill_discount_amt) || ((finalTotalGross - finalItemDiscount) * (billDiscPct / 100));
    const finalNetTotal = parseFloat(net_total) || Math.max(0, finalTotalGross - finalItemDiscount - billDiscAmt);
    const tendered = parseFloat(cash_tendered) || parseFloat(req.body.tendered_amount) || finalNetTotal;
    const finalChangeDue = parseFloat(change_due) || Math.max(0, tendered - finalNetTotal);

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const executeSaleTransaction = async () => {
      return await prisma.$transaction(async (tx) => {
        // Query latest invoice sequence today inside transaction
        const latestSale = await tx.sale.findFirst({
          where: { invoiceNo: { startsWith: `INV-${today}-` } },
          orderBy: { id: 'desc' },
          select: { invoiceNo: true }
        });

        let nextSeq = 1;
        if (latestSale?.invoiceNo) {
          const parts = latestSale.invoiceNo.split('-');
          const lastNum = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(lastNum)) {
            nextSeq = lastNum + 1;
          }
        }
        const invoiceNo = `INV-${today}-${String(nextSeq).padStart(4, '0')}`;

        // Snapshot the protected store identity & developer footer so reprints match the original receipt
        const identityRows = await tx.systemSetting.findMany({
          where: { key: { in: ['store_name', 'store_address', 'developer_invoice_footer', ...DEVELOPER_PROFILE_SETTING_KEYS] } }
        });
        const identity: Record<string, string> = {};
        for (const row of identityRows) identity[row.key] = row.value;
        const storeNameSnapshot = identity.store_name ?? null;
        const storeAddressSnapshot = identity.store_address ?? null;
        const invoiceFooterSnapshot = composeInvoiceFooter(identity);

        // 1. Insert Sale Master
        const sale = await tx.sale.create({
          data: {
            invoiceNo,
            customerId: customer_id ? Number(customer_id) : null,
            customerName: customer_name || 'Counter Customer',
            customerPhone: customer_phone || null,
            userId: user_id ? Number(user_id) : null,
            userName: user_name || 'Cashier',
            shiftId: activeShiftId,
            totalGross: finalTotalGross,
            totalItemDiscount: finalItemDiscount,
            billDiscountPct: billDiscPct,
            billDiscountAmt: billDiscAmt,
            netTotal: finalNetTotal,
            cashTendered: tendered,
            changeDue: finalChangeDue,
            paymentType: payment_type || 'Cash',
            notes: notes || null,
            storeNameSnapshot,
            storeAddressSnapshot,
            invoiceFooterSnapshot
          }
        });

      // 2. Validate Open-Sale Rules & Deduct Stock
      for (const item of computedItems) {
        const prod = await tx.product.findUnique({ where: { id: Number(item.product_id) } });
        if (!prod) throw new Error(`Product ID ${item.product_id} not found.`);

        const isLoose = item.is_loose ? 1 : 0;
        const packing = prod.packing || 1;

        // Open-Sale Validation: Prohibit selling loose units if allowOpenSale is 0
        if (isLoose && (!prod.allowOpenSale || prod.allowOpenSale === 0)) {
          throw new Error(`Open packaging sale is prohibited for "${prod.name}". This medicine cannot be sold as an individual unit. Please sell it in its original packaging.`);
        }

        // Minimum Sale Quantity Validation
        const minQty = prod.minSaleQty || 1;
        if (item.quantity < minQty) {
          const unitLabel = isLoose ? prod.unitType : 'Pack(s)';
          throw new Error(`Minimum sale quantity for "${prod.name}" is ${minQty} ${unitLabel}. (Requested: ${item.quantity})`);
        }

        const unitCost = isLoose ? prod.unitTradePrice : prod.boxTradePrice;

        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: prod.id,
            cCode: prod.cCode,
            pCode: prod.pCode,
            productName: prod.name,
            unitType: prod.unitType,
            locationRack: prod.locationRack,
            isLoose,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            unitCost,
            grossAmount: item.gross_amount,
            discountPct: item.discount_pct,
            discountAmount: item.discount_amount,
            netAmount: item.net_amount,
            batchId: item.batch_id ? Number(item.batch_id) : null
          }
        });

        // Decrement inventory logically:
        let totalCurrentUnits = (prod.stockBoxes * packing) + prod.stockLoose;
        const unitsToDeduct = isLoose ? item.quantity : (item.quantity * packing);
        totalCurrentUnits = Math.max(0, totalCurrentUnits - unitsToDeduct);

        const newBoxes = Math.floor(totalCurrentUnits / packing);
        const newLoose = totalCurrentUnits % packing;

        await tx.product.update({
          where: { id: prod.id },
          data: {
            stockBoxes: newBoxes,
            stockLoose: newLoose
          }
        });
      }

      // 3. Update customer Khata balance if credit sale
      if (payment_type === 'Credit' && customer_id) {
        await tx.customer.update({
          where: { id: Number(customer_id) },
          data: {
            currentBalance: { increment: finalNetTotal }
          }
        });
      }

        return {
          saleId: sale.id,
          invoiceNo,
          netTotal: sale.netTotal,
          changeDue: sale.changeDue,
          store_name_snapshot: storeNameSnapshot,
          store_address_snapshot: storeAddressSnapshot,
          invoice_footer_snapshot: invoiceFooterSnapshot
        };
      });
    };

    let result: any = null;
    let attempts = 0;
    while (attempts < 5) {
      try {
        attempts++;
        result = await executeSaleTransaction();
        break;
      } catch (err: any) {
        if ((err.code === 'P2002' || err.message?.includes('Unique constraint') || err.message?.includes('SQLITE_BUSY')) && attempts < 5) {
          await new Promise((r) => setTimeout(r, 25 * attempts));
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

router.get('/api/sales', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to, invoice_no, customer_id } = req.query;
    const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

    if (invoice_no) {
      const search = `%${String(invoice_no).trim()}%`;
      conditions.push(Prisma.sql`invoice_no LIKE ${search}`);
    }
    if (date_from) {
      conditions.push(Prisma.sql`DATE(sale_date) >= ${String(date_from)}`);
    }
    if (date_to) {
      conditions.push(Prisma.sql`DATE(sale_date) <= ${String(date_to)}`);
    }
    if (customer_id) {
      conditions.push(Prisma.sql`customer_id = ${Number(customer_id)}`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const sales = await prisma.$queryRaw<any[]>`
      SELECT * FROM sales
      WHERE ${whereClause}
      ORDER BY id DESC
      LIMIT 100
    `;
    res.json(sales);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.get('/api/sales/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const sale = await prisma.sale.findUnique({
      where: { id: idNum },
      include: {
        items: true
      }
    });

    if (!sale) return res.status(404).json({ error: 'Sale invoice not found' });
    res.json(formatSale(sale));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/sales/return', async (req: Request, res: Response) => {
  try {
    const { sale_id, original_invoice_no, customer_name, return_items, reason, shift_id } = req.body;
    // Identity always comes from the login session, never from the request body
    const { user_id, user_name } = await sessionIdentity(req);
    if (!return_items || return_items.length === 0) {
      return res.status(400).json({ error: 'No return items specified' });
    }

    // Strict Shift Lock: Verify active open shift for returns
    let activeShiftId = shift_id ? Number(shift_id) : null;
    if (!activeShiftId && user_id) {
      const activeShift = await prisma.cashierShift.findFirst({
        where: { userId: Number(user_id), status: 'open' },
        orderBy: { id: 'desc' }
      });
      if (activeShift) {
        activeShiftId = activeShift.id;
      }
    }

    if (!activeShiftId) {
      return res.status(403).json({ error: 'No active open cashier shift found. You must start a shift before processing returns.' });
    }

    const verifiedShift = await prisma.cashierShift.findUnique({ where: { id: activeShiftId } });
    if (!verifiedShift || verifiedShift.status !== 'open') {
      return res.status(403).json({ error: 'This shift is closed and locked. Returns cannot be processed under a closed shift.' });
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await prisma.saleReturn.count({
      where: { returnNo: { startsWith: `SR-${today}-` } }
    });
    const returnNo = `SR-${today}-${String(countToday + 1).padStart(4, '0')}`;

    let totalRefund = 0;
    for (const item of return_items) {
      totalRefund += Number(item.total_refund || (item.quantity * item.unit_refund_price));
    }

    const result = await prisma.$transaction(async (tx) => {
      const saleReturn = await tx.saleReturn.create({
        data: {
          returnNo,
          saleId: sale_id ? Number(sale_id) : null,
          originalInvoiceNo: original_invoice_no || null,
          customerName: customer_name || 'Customer',
          refundAmount: totalRefund,
          reason: reason || null,
          userId: user_id ? Number(user_id) : null,
          userName: user_name || 'Cashier',
          shiftId: activeShiftId
        }
      });

      for (const item of return_items) {
        const prod = await tx.product.findUnique({ where: { id: Number(item.product_id) } });
        if (prod) {
          const isLoose = item.is_loose ? 1 : 0;
          if (isLoose && (!prod.allowOpenSale || prod.allowOpenSale === 0)) {
            throw new Error(`This medicine cannot be returned as a loose unit because open packaging sales are prohibited for "${prod.name}".`);
          }
          const packing = prod.packing || 1;
          const itemRefund = item.total_refund || (item.quantity * item.unit_refund_price);

          await tx.saleReturnItem.create({
            data: {
              saleReturnId: saleReturn.id,
              productId: prod.id,
              productName: prod.name,
              isLoose,
              quantity: parseFloat(item.quantity),
              unitRefundPrice: parseFloat(item.unit_refund_price),
              totalRefund: itemRefund
            }
          });

          let totalUnits = (prod.stockBoxes * packing) + prod.stockLoose;
          const unitsToAdd = isLoose ? item.quantity : (item.quantity * packing);
          totalUnits += unitsToAdd;

          const newBoxes = Math.floor(totalUnits / packing);
          const newLoose = totalUnits % packing;

          await tx.product.update({
            where: { id: prod.id },
            data: {
              stockBoxes: newBoxes,
              stockLoose: newLoose
            }
          });
        }
      }

      if (sale_id) {
        await tx.sale.update({
          where: { id: Number(sale_id) },
          data: { status: 'returned' }
        });
      }

      return { returnId: saleReturn.id, returnNo, totalRefund };
    });

    res.json({ success: true, ...result });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
