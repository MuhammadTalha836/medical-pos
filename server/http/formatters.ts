import { prisma } from '../database/prisma';
import { parsePermissions } from '../../shared/permissions';

// Helper formatters to map Prisma models to client-expected snake_case contracts
interface SaleItemEntity {
  id?: number;
  saleId: number;
  productId: number;
  cCode: string;
  pCode: string;
  productName: string;
  unitType: string;
  locationRack: string | null;
  isLoose: number;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  grossAmount: number;
  discountPct: number;
  discountAmount: number;
  netAmount: number;
  batchId: number | null;
}

interface SaleEntity {
  id: number;
  invoiceNo: string;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  userId: number | null;
  userName: string | null;
  saleDate: Date;
  totalGross: number;
  totalItemDiscount: number;
  billDiscountPct: number;
  billDiscountAmt: number;
  netTotal: number;
  cashTendered: number;
  changeDue: number;
  paymentType: string;
  status: string;
  notes: string | null;
  storeNameSnapshot?: string | null;
  storeAddressSnapshot?: string | null;
  invoiceFooterSnapshot?: string | null;
  memberDiscountPct?: number;
  memberDiscountAmt?: number;
  pointsRedeemed?: number;
  pointsRedeemedValue?: number;
  pointsEarned?: number;
  loyaltyPlanName?: string | null;
  pointsBalance?: number | null;
  terminalName?: string | null;
  roundOff?: number;
  paidCash?: number;
  paidCard?: number;
  paidCredit?: number;
  voidReason?: string | null;
  voidedBy?: string | null;
  voidedAt?: Date | null;
  createdAt: Date;
  items?: SaleItemEntity[];
}

function formatSaleItem(item: SaleItemEntity) {
  return {
    id: item.id,
    sale_id: item.saleId,
    product_id: item.productId,
    c_code: item.cCode,
    p_code: item.pCode,
    product_name: item.productName,
    unit_type: item.unitType,
    location_rack: item.locationRack,
    is_loose: item.isLoose,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    unit_cost: item.unitCost,
    gross_amount: item.grossAmount,
    discount_pct: item.discountPct,
    discount_amount: item.discountAmount,
    net_amount: item.netAmount,
    batch_id: item.batchId
  };
}

export function formatSale(sale: SaleEntity) {
  return {
    id: sale.id,
    invoice_no: sale.invoiceNo,
    customer_id: sale.customerId,
    customer_name: sale.customerName,
    customer_phone: sale.customerPhone,
    user_id: sale.userId,
    user_name: sale.userName,
    sale_date: sale.saleDate,
    total_gross: sale.totalGross,
    total_item_discount: sale.totalItemDiscount,
    bill_discount_pct: sale.billDiscountPct,
    bill_discount_amt: sale.billDiscountAmt,
    net_total: sale.netTotal,
    cash_tendered: sale.cashTendered,
    change_due: sale.changeDue,
    payment_type: sale.paymentType,
    status: sale.status,
    notes: sale.notes,
    store_name_snapshot: sale.storeNameSnapshot ?? null,
    store_address_snapshot: sale.storeAddressSnapshot ?? null,
    invoice_footer_snapshot: sale.invoiceFooterSnapshot ?? null,
    member_discount_pct: sale.memberDiscountPct ?? 0,
    member_discount_amt: sale.memberDiscountAmt ?? 0,
    points_redeemed: sale.pointsRedeemed ?? 0,
    points_redeemed_value: sale.pointsRedeemedValue ?? 0,
    points_earned: sale.pointsEarned ?? 0,
    loyalty_plan_name: sale.loyaltyPlanName ?? null,
    points_balance: sale.pointsBalance ?? null,
    terminal_name: sale.terminalName ?? null,
    round_off: sale.roundOff ?? 0,
    paid_cash: sale.paidCash ?? 0,
    paid_card: sale.paidCard ?? 0,
    paid_credit: sale.paidCredit ?? 0,
    void_reason: sale.voidReason ?? null,
    voided_by: sale.voidedBy ?? null,
    voided_at: sale.voidedAt ?? null,
    created_at: sale.createdAt,
    items: sale.items ? sale.items.map(formatSaleItem) : undefined
  };
}

// Formats a user for login responses (never includes password or TOTP fields)
export async function sessionUserPayload(user: { id: number; username: string; email: string | null; fullName: string; role: string; status: string }) {
  const roleRow = await prisma.role.findUnique({ where: { name: user.role } });
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.fullName,
    role: user.role,
    status: user.status,
    role_display: roleRow ? roleRow.displayName : user.role,
    permissions: roleRow?.permissions ? parsePermissions(roleRow.permissions) : null
  };
}
