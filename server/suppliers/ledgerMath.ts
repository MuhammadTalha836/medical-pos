// Supplier (distributor) payables. Pure: the balance is always worked out from the purchases, payments and
// purchase-return credits, never stored, so it cannot drift. No database imports (unit-tested).

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export interface LedgerPurchase {
  id: number;
  invoiceNo: string;
  supplierInvoiceNo: string | null;
  date: string;
  netTotal: number;
  /** Money handed over with the purchase itself */
  paidAtPurchase: number;
}

export interface LedgerPayment {
  id: number;
  date: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
}

export interface LedgerCredit {
  id: number;
  returnNo: string;
  date: string;
  amount: number;
  isExpiryClaim?: boolean;
}

export type PurchaseStatus = 'Paid' | 'Partial' | 'Pending';

export interface PurchaseDue {
  id: number;
  invoiceNo: string;
  supplierInvoiceNo: string | null;
  date: string;
  netTotal: number;
  settled: number;
  due: number;
  status: PurchaseStatus;
}

export interface LedgerEntry {
  date: string;
  kind: 'purchase' | 'paid_with_purchase' | 'payment' | 'return';
  reference: string;
  details: string;
  /** What the store owes goes up (purchase) */
  debit: number;
  /** What the store owes goes down (payment, return credit) */
  credit: number;
  balance: number;
}

export interface SupplierLedger {
  totals: { purchased: number; paid: number; returned: number; balance: number };
  dues: PurchaseDue[];
  entries: LedgerEntry[];
}

/** Paid at purchase: rows marked Paid count as fully paid (older rows never stored the amount). */
export function paidAtPurchase(status: string, netTotal: number, paidAmount: number): number {
  if (status === 'Paid') return round2(netTotal);
  return round2(Math.min(netTotal, Math.max(0, paidAmount || 0)));
}

/** Status of a purchase from what has been settled against it */
export function statusFor(netTotal: number, settled: number): PurchaseStatus {
  if (settled >= netTotal - 0.005) return 'Paid';
  return settled > 0.005 ? 'Partial' : 'Pending';
}

const byDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export function buildSupplierLedger(purchases: LedgerPurchase[], payments: LedgerPayment[], credits: LedgerCredit[]): SupplierLedger {
  const sortedPurchases = [...purchases].sort((a, b) => byDate(a, b) || a.id - b.id);

  // Payments and return credits settle the oldest unpaid purchase first
  let pool = round2(payments.reduce((s, p) => s + p.amount, 0) + credits.reduce((s, c) => s + c.amount, 0));
  const dues: PurchaseDue[] = sortedPurchases.map(p => {
    const open = round2(p.netTotal - p.paidAtPurchase);
    const applied = round2(Math.min(open, pool));
    pool = round2(pool - applied);
    const settled = round2(p.paidAtPurchase + applied);
    return {
      id: p.id,
      invoiceNo: p.invoiceNo,
      supplierInvoiceNo: p.supplierInvoiceNo,
      date: p.date,
      netTotal: round2(p.netTotal),
      settled,
      due: round2(p.netTotal - settled),
      status: statusFor(p.netTotal, settled)
    };
  });

  type Row = Omit<LedgerEntry, 'balance'> & { order: number };
  const rows: Row[] = [];
  for (const p of sortedPurchases) {
    rows.push({ date: p.date, order: 0, kind: 'purchase', reference: p.invoiceNo, details: p.supplierInvoiceNo ? `Supplier bill ${p.supplierInvoiceNo}` : 'Purchase', debit: round2(p.netTotal), credit: 0 });
    if (p.paidAtPurchase > 0) {
      rows.push({ date: p.date, order: 1, kind: 'paid_with_purchase', reference: p.invoiceNo, details: 'Paid with the purchase', debit: 0, credit: p.paidAtPurchase });
    }
  }
  for (const pay of payments) {
    const how = pay.reference ? `${pay.method} (${pay.reference})` : pay.method;
    rows.push({ date: pay.date, order: 2, kind: 'payment', reference: `PAY-${pay.id}`, details: pay.notes ? `${how}: ${pay.notes}` : how, debit: 0, credit: round2(pay.amount) });
  }
  for (const c of credits) {
    rows.push({ date: c.date, order: 3, kind: 'return', reference: c.returnNo, details: c.isExpiryClaim ? 'Expiry claim' : 'Goods returned', debit: 0, credit: round2(c.amount) });
  }
  rows.sort((a, b) => byDate(a, b) || a.order - b.order);

  let balance = 0;
  const entries = rows.map(({ order: _order, ...row }) => {
    balance = round2(balance + row.debit - row.credit);
    return { ...row, balance };
  });

  const purchased = round2(sortedPurchases.reduce((s, p) => s + p.netTotal, 0));
  const paid = round2(sortedPurchases.reduce((s, p) => s + p.paidAtPurchase, 0) + payments.reduce((s, p) => s + p.amount, 0));
  const returned = round2(credits.reduce((s, c) => s + c.amount, 0));
  return { totals: { purchased, paid, returned, balance: round2(purchased - paid - returned) }, dues, entries };
}
