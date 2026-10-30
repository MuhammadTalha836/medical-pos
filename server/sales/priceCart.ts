import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { DEFAULT_SETTINGS } from '../../shared/settingsDefaults';
import { missingPrescriptionFields, normalizeSchedule } from '../../shared/schedule';
import { priceSaleLine, totalSale, type PricedLine, type PricingRules, type SaleTotals } from './saleMath';

type Db = typeof prisma | Prisma.TransactionClient;
type ProductRecord = Prisma.ProductGetPayload<object>;

export interface CartLine {
  prod: ProductRecord;
  isLoose: boolean;
  quantity: number;
  priced: PricedLine;
  controlled: boolean;
  batchId: number | null;
}

/**
 * Prices a cart from the medicine records with the sale rules (open-sale and minimum quantity checks, rates,
 * line and bill discounts). Reads only, so the sale (inside its transaction) and the quotation share it.
 * `prescription` is checked for controlled medicines unless it is undefined (a quotation needs none).
 */
export async function priceCart(
  db: Db,
  items: any[],
  billDiscountPct: unknown,
  rules: PricingRules,
  prescription?: Parameters<typeof missingPrescriptionFields>[0]
): Promise<{ lines: CartLine[]; totals: SaleTotals }> {
  const lines: CartLine[] = [];
  for (const item of items) {
    const prod = await db.product.findUnique({ where: { id: Number(item.product_id) } });
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

    // Controlled medicines need the prescription details for the register (drug-law record)
    const controlled = normalizeSchedule(prod.schedule) === 'controlled';
    if (controlled && prescription !== undefined) {
      const missing = missingPrescriptionFields(prescription);
      if (missing.length > 0) {
        throw new Error(`"${prod.name}" is a controlled medicine. Enter the ${missing.join(', ')} from the prescription.`);
      }
    }

    const priced = priceSaleLine(prod, isLoose, quantity, { unitPrice: item.unit_price, discountPct: item.discount_pct }, rules);
    lines.push({ prod, isLoose, quantity, priced, controlled, batchId: item.batch_id ? Number(item.batch_id) : null });
  }
  return { lines, totals: totalSale(lines.map(l => l.priced), billDiscountPct, rules) };
}

/** The bill discount ceiling and the round-off step from settings */
export async function pricingSettings(db: Db = prisma): Promise<{ maxBillDiscountPct: number; roundOffTo: number }> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: ['max_bill_discount_pct', 'round_off_to'] } } });
  const value = (key: string) => rows.find(r => r.key === key)?.value ?? DEFAULT_SETTINGS[key];
  const maxBillDiscountPct = Number(value('max_bill_discount_pct'));
  const roundOffTo = Number(value('round_off_to'));
  return {
    maxBillDiscountPct: Number.isFinite(maxBillDiscountPct) ? maxBillDiscountPct : 0,
    roundOffTo: Number.isFinite(roundOffTo) ? roundOffTo : 0
  };
}
