import { Router, type Request, type Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { parseBody, createSaleSchema, saleReturnSchema } from '../validation/schemas';
import { getActingUser, hasRolePermission, requirePermission, sessionIdentity, sendError } from '../http/context';
import { formatSale } from '../http/formatters';
import { DEVELOPER_PROFILE_SETTING_KEYS, composeInvoiceFooter } from '../../shared/developerProfile';
import { DEFAULT_SETTINGS } from '../../shared/settingsDefaults';
import { priceReturn, priceSaleLine, settleCash, totalSale } from '../sales/saleMath';
import { localDateKey } from '../../shared/dates';
import { returnUnits, syncProductBatches, takeUnits } from '../stock/batchStock';

// Counter sales (POS), sales history and returns
const router = Router();

const PAYMENT_TYPES = ['Cash', 'Card', 'Credit', 'Online'];

/** The signed-in user's open shift (a shift id sent by the client is never trusted) */
async function openShiftIdFor(userId: number | null): Promise<number | null> {
  if (!userId) return null;
  const shift = await prisma.cashierShift.findFirst({
    where: { userId: Number(userId), status: 'open' },
    orderBy: { id: 'desc' },
    select: { id: true }
  });
  return shift?.id ?? null;
}

const describeStock = (boxes: number, loose: number, unitType: string) =>
  loose > 0 ? `${boxes} box(es) + ${loose} ${unitType}` : `${boxes} box(es)`;

router.post('/api/sales', async (req: Request, res: Response) => {
  try {
    const { customer_id, customer_name, customer_phone, items, bill_discount_pct, cash_tendered, payment_type, notes } = req.body;
    // Identity always comes from the login session, never from the request body
    const actor = await getActingUser(req);
    const { user_id, user_name } = await sessionIdentity(req);

    if (!parseBody(createSaleSchema, req.body, res)) return;
    const paymentType = PAYMENT_TYPES.includes(payment_type) ? payment_type : 'Cash';

    // Strict shift lock: the sale always goes to the signed-in user's own open shift
    const activeShiftId = await openShiftIdFor(user_id);
    if (!activeShiftId) {
      return res.status(403).json({ error: 'No active open cashier shift found. You must start a shift before invoicing.' });
    }

    // A sale may be linked to a saved (khata) customer; a credit sale must be
    const hasCustomerId = customer_id !== undefined && customer_id !== null && customer_id !== '';
    const linkedCustomer = hasCustomerId
      ? await prisma.customer.findUnique({ where: { id: Number(customer_id) || 0 } })
      : null;
    if (hasCustomerId && !linkedCustomer) {
      return res.status(400).json({ error: 'The selected customer was not found. Search for the customer again.' });
    }
    if (paymentType === 'Credit' && !linkedCustomer) {
      return res.status(400).json({ error: 'Select or save a khata customer for credit sales.' });
    }

    const maxSetting = await prisma.systemSetting.findUnique({ where: { key: 'max_bill_discount_pct' } });
    const maxBillDiscountPct = Number(maxSetting?.value ?? DEFAULT_SETTINGS.max_bill_discount_pct);
    const rules = {
      canDiscount: !!actor && (await hasRolePermission(actor.role, 'can_discount')),
      maxBillDiscountPct: Number.isFinite(maxBillDiscountPct) ? maxBillDiscountPct : 0
    };

    const today = localDateKey();

    const executeSaleTransaction = async () => {
      return await prisma.$transaction(async (tx) => {
        // Re-checked inside the transaction: a shift closed meanwhile takes no more sales
        const shift = await tx.cashierShift.findUnique({ where: { id: activeShiftId } });
        if (!shift || shift.status !== 'open') {
          throw new Error('This shift is closed and locked. Sales cannot be added to a closed shift.');
        }

        // Every line is priced here from the medicine record; the client's amounts are only a request
        const pricedItems = [];
        for (const item of items as any[]) {
          const prod = await tx.product.findUnique({ where: { id: Number(item.product_id) } });
          if (!prod) throw new Error(`Product ID ${item.product_id} not found.`);
          const isLoose = item.is_loose === true || item.is_loose === 1 || item.is_loose === '1';
          const quantity = Number(item.quantity);

          // Open-Sale Validation: Prohibit selling loose units if allowOpenSale is 0
          if (isLoose && !prod.allowOpenSale) {
            throw new Error(`Open packaging sale is prohibited for "${prod.name}". This medicine cannot be sold as an individual unit. Please sell it in its original packaging.`);
          }

          // Minimum Sale Quantity Validation
          const minQty = prod.minSaleQty || 1;
          if (quantity < minQty) {
            const unitLabel = isLoose ? prod.unitType : 'Pack(s)';
            throw new Error(`Minimum sale quantity for "${prod.name}" is ${minQty} ${unitLabel}. (Requested: ${quantity})`);
          }

          const priced = priceSaleLine(prod, isLoose, quantity, { unitPrice: item.unit_price, discountPct: item.discount_pct }, rules);
          pricedItems.push({ prod, isLoose, quantity, priced, batchId: item.batch_id ? Number(item.batch_id) : null });
        }

        const totals = totalSale(pricedItems.map(i => i.priced), bill_discount_pct, rules);
        const cash = settleCash(paymentType, totals.netTotal, cash_tendered);

        // Credit limit (0 = no limit), checked against the balance at the moment of the sale
        if (paymentType === 'Credit' && linkedCustomer) {
          const current = await tx.customer.findUnique({ where: { id: linkedCustomer.id } });
          const limit = current?.creditLimit ?? 0;
          const balance = current?.currentBalance ?? 0;
          if (limit > 0 && balance + totals.netTotal > limit + 0.005) {
            const available = Math.max(0, limit - balance);
            throw new Error(`Credit limit reached for ${linkedCustomer.name}: limit ${limit.toFixed(2)}, balance ${balance.toFixed(2)}, available ${available.toFixed(2)}.`);
          }
        }

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

        // 1. Insert Sale Master
        const sale = await tx.sale.create({
          data: {
            invoiceNo,
            // A linked customer's saved name and phone are used, so their history stays consistent
            customerId: linkedCustomer?.id ?? null,
            customerName: linkedCustomer?.name ?? (customer_name || 'Counter Customer'),
            customerPhone: linkedCustomer ? linkedCustomer.phone : (customer_phone || null),
            userId: user_id ? Number(user_id) : null,
            userName: user_name || 'Cashier',
            shiftId: activeShiftId,
            ...totals,
            ...cash,
            paymentType,
            notes: notes || null,
            storeNameSnapshot: identity.store_name ?? null,
            storeAddressSnapshot: identity.store_address ?? null,
            invoiceFooterSnapshot: composeInvoiceFooter(identity)
          }
        });

        // 2. Save the lines and deduct stock (boxes + loose units, never below what is on the shelf)
        for (const { prod: listed, isLoose, quantity, priced, batchId } of pricedItems) {
          // Re-read: an earlier line of the same medicine may already have taken stock
          const prod = (await tx.product.findUnique({ where: { id: listed.id } }))!;
          const packing = prod.packing || 1;
          const available = (prod.stockBoxes * packing) + prod.stockLoose;
          const unitsToDeduct = isLoose ? quantity : quantity * packing;
          if (unitsToDeduct > available) {
            throw new Error(`Not enough stock for "${prod.name}": ${describeStock(prod.stockBoxes, prod.stockLoose, prod.unitType)} available.`);
          }
          // First expiry, first out; expired batches are never sold
          const allocations = await takeUnits(tx, { id: prod.id, name: prod.name, packing, unitType: prod.unitType }, unitsToDeduct, false);

          const saleItem = await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: prod.id,
              cCode: prod.cCode,
              pCode: prod.pCode,
              productName: prod.name,
              unitType: prod.unitType,
              locationRack: prod.locationRack,
              isLoose: isLoose ? 1 : 0,
              quantity,
              unitPrice: priced.unitPrice,
              unitCost: isLoose ? prod.unitTradePrice : prod.boxTradePrice,
              grossAmount: priced.grossAmount,
              discountPct: priced.discountPct,
              discountAmount: priced.discountAmount,
              netAmount: priced.netAmount,
              batchId: allocations[0]?.batchId ?? batchId
            }
          });
          await tx.saleItemBatch.createMany({
            data: allocations.map(a => ({ saleItemId: saleItem.id, batchId: a.batchId, units: a.units }))
          });

          const remaining = available - unitsToDeduct;
          await tx.product.update({
            where: { id: prod.id },
            data: { stockBoxes: Math.floor(remaining / packing), stockLoose: remaining % packing }
          });
        }

        // 3. Update customer Khata balance if credit sale
        if (paymentType === 'Credit' && linkedCustomer) {
          await tx.customer.update({
            where: { id: linkedCustomer.id },
            data: { currentBalance: { increment: totals.netTotal } }
          });
        }

        const saved = await tx.sale.findUnique({ where: { id: sale.id }, include: { items: true } });
        return {
          saleId: sale.id,
          invoiceNo,
          netTotal: sale.netTotal,
          changeDue: sale.changeDue,
          store_name_snapshot: sale.storeNameSnapshot,
          store_address_snapshot: sale.storeAddressSnapshot,
          invoice_footer_snapshot: sale.invoiceFooterSnapshot,
          // The sale exactly as stored, so the receipt shows the server's prices and totals
          sale: formatSale(saved!)
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

    // How much of each line has already come back, so the return form only offers what is left
    const returned = await prisma.saleReturnItem.findMany({ where: { saleReturn: { saleId: sale.id } } });
    const left = new Map<string, number>();
    for (const r of returned) {
      const key = `${r.productId}:${r.isLoose ? 1 : 0}`;
      left.set(key, (left.get(key) ?? 0) + r.quantity);
    }
    const formatted = formatSale(sale);
    res.json({
      ...formatted,
      items: formatted.items?.map(item => {
        const key = `${item.product_id}:${item.is_loose ? 1 : 0}`;
        const taken = Math.min(item.quantity, left.get(key) ?? 0);
        left.set(key, (left.get(key) ?? 0) - taken);
        return { ...item, returned_qty: taken };
      })
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/sales/return', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_return_sale', 'You do not have permission to process sale returns.'))) return;
    const body = parseBody(saleReturnSchema, req.body, res);
    if (!body) return;
    // Identity always comes from the login session, never from the request body
    const { user_id, user_name } = await sessionIdentity(req);

    const activeShiftId = await openShiftIdFor(user_id);
    if (!activeShiftId) {
      return res.status(403).json({ error: 'No active open cashier shift found. You must start a shift before processing returns.' });
    }

    const today = localDateKey();
    const requested = body.return_items.map(item => ({
      productId: Number(item.product_id),
      isLoose: item.is_loose === true || item.is_loose === 1 || item.is_loose === '1',
      quantity: Number(item.quantity)
    }));

    const executeReturn = () => prisma.$transaction(async (tx) => {
      const shift = await tx.cashierShift.findUnique({ where: { id: activeShiftId } });
      if (!shift || shift.status !== 'open') {
        throw new Error('This shift is closed and locked. Returns cannot be processed under a closed shift.');
      }

      const original = await tx.sale.findUnique({ where: { id: Number(body.sale_id) }, include: { items: true } });
      if (!original) throw new Error('The original invoice was not found.');
      if (original.status === 'returned' || original.status === 'cancelled') {
        throw new Error(`Invoice ${original.invoiceNo} has already been fully returned.`);
      }

      // A medicine that may not be sold loose can never come back loose
      for (const line of requested.filter(r => r.isLoose)) {
        const prod = await tx.product.findUnique({ where: { id: line.productId }, select: { name: true, allowOpenSale: true } });
        if (prod && !prod.allowOpenSale) {
          throw new Error(`This medicine cannot be returned as a loose unit because open packaging sales are prohibited for "${prod.name}".`);
        }
      }

      const earlierReturns = await tx.saleReturnItem.findMany({ where: { saleReturn: { saleId: original.id } } });
      const priced = priceReturn(
        original.items.map(i => ({ productId: i.productId, productName: i.productName, isLoose: !!i.isLoose, quantity: i.quantity, netAmount: i.netAmount })),
        original.netTotal,
        earlierReturns.map(r => ({ productId: r.productId, isLoose: !!r.isLoose, quantity: r.quantity })),
        requested
      );

      const countToday = await tx.saleReturn.count({ where: { returnNo: { startsWith: `SR-${today}-` } } });
      const returnNo = `SR-${today}-${String(countToday + 1).padStart(4, '0')}`;

      const saleReturn = await tx.saleReturn.create({
        data: {
          returnNo,
          saleId: original.id,
          originalInvoiceNo: original.invoiceNo,
          customerName: original.customerName || 'Customer',
          refundAmount: priced.totalRefund,
          reason: body.reason?.trim() || null,
          userId: user_id ? Number(user_id) : null,
          userName: user_name || 'Cashier',
          shiftId: activeShiftId
        }
      });

      for (const line of priced.lines) {
        const prod = await tx.product.findUnique({ where: { id: line.productId } });
        if (!prod) throw new Error(`"${line.productName}" no longer exists, so it cannot be put back into stock.`);

        await tx.saleReturnItem.create({
          data: {
            saleReturnId: saleReturn.id,
            productId: prod.id,
            productName: prod.name,
            isLoose: line.isLoose ? 1 : 0,
            quantity: line.quantity,
            unitRefundPrice: line.unitRefundPrice,
            totalRefund: line.totalRefund
          }
        });

        // Stock goes back in the unit it was sold in
        const packing = prod.packing || 1;
        const unitsBack = line.isLoose ? line.quantity : line.quantity * packing;
        const totalUnits = (prod.stockBoxes * packing) + prod.stockLoose + unitsBack;
        await tx.product.update({
          where: { id: prod.id },
          data: { stockBoxes: Math.floor(totalUnits / packing), stockLoose: totalUnits % packing }
        });

        // ...and into the batches it was taken from, most recently taken first
        const lineIds = original.items.filter(i => i.productId === prod.id && !!i.isLoose === line.isLoose).map(i => i.id);
        const taken = await tx.saleItemBatch.findMany({ where: { saleItemId: { in: lineIds } }, orderBy: { id: 'desc' } });
        let left = unitsBack;
        for (const alloc of taken) {
          if (left <= 0) break;
          const back = Math.min(left, alloc.units - alloc.returnedUnits);
          if (back <= 0) continue;
          await tx.saleItemBatch.update({ where: { id: alloc.id }, data: { returnedUnits: { increment: back } } });
          await returnUnits(tx, packing, [{ batchId: alloc.batchId, units: back }]);
          left -= back;
        }
        // Sales made before batches were tracked: the units go to the opening batch
        await syncProductBatches(tx, prod.id);
      }

      await tx.sale.update({
        where: { id: original.id },
        data: { status: priced.fullyReturned ? 'returned' : 'partially_returned' }
      });

      // Returning goods from a credit sale lowers what the customer owes
      if (original.paymentType === 'Credit' && original.customerId) {
        const customer = await tx.customer.findUnique({ where: { id: original.customerId } });
        if (customer) {
          const newBalance = Math.max(0, customer.currentBalance - priced.totalRefund);
          await tx.customer.update({ where: { id: customer.id }, data: { currentBalance: newBalance } });
          await tx.auditLog.create({
            data: {
              action: 'KHATA_RETURN_ADJUSTMENT',
              module: 'Khata',
              details: `Return ${returnNo} on credit invoice ${original.invoiceNo}: ${customer.name} balance ${customer.currentBalance.toFixed(2)} -> ${newBalance.toFixed(2)}`,
              userName: user_name || 'Cashier'
            }
          });
        }
      }

      return { returnId: saleReturn.id, returnNo, totalRefund: priced.totalRefund, saleStatus: priced.fullyReturned ? 'returned' : 'partially_returned' };
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

    res.json({ success: true, ...result });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
