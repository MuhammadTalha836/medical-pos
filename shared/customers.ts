/** Customer rules shared by the POS customer picker, the Khata page and the API. */

/** Name shown (and printed) when a sale is not linked to a saved customer */
export const COUNTER_CUSTOMER = 'Counter Customer';

export const CUSTOMER_NAME_MAX = 80;
export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

/** Digits only, so "0300-1234567", "0300 1234567" and "03001234567" are the same phone. */
export function normalizePhone(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

export function isValidPhone(phone: string | null | undefined): boolean {
  const digits = normalizePhone(phone);
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

/** True for the default walk-in name (any case/spacing), which never needs a saved customer */
export function isCounterCustomer(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim().toLowerCase();
  return trimmed === '' || trimmed === COUNTER_CUSTOMER.toLowerCase();
}

export interface StatementEntry {
  date: string;
  kind: 'bill' | 'payment' | 'return' | 'opening';
  reference: string;
  details: string;
  /** Added to what the customer owes */
  debit: number;
  /** Taken off what the customer owes */
  credit: number;
  balance: number;
}

export interface CustomerStatement {
  entries: StatementEntry[];
  totals: { billed: number; paid: number; returned: number; balance: number };
}

const toMs = (value: string | number | Date) => new Date(value).getTime() || 0;
const money2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * A khata statement: credit bills add to the balance, payments and returns of credit bills take it off, in date
 * order with a running balance. When those entries do not explain the saved balance (older data, a balance set by
 * hand), an "Opening / other changes" line comes first, so the statement always ends on the real balance.
 */
export function customerStatement(
  sales: Array<{ invoice_no: string; sale_date: string | Date; net_total: number; payment_type: string; paid_credit?: number; status?: string }>,
  returns: Array<{ return_no: string; invoice_no: string | null; created_at: string | Date; refund_amount: number }>,
  payments: Array<{ payment_date: string | Date; amount: number; payment_method: string; notes?: string | null }>,
  currentBalance: number
): CustomerStatement {
  const rows: Array<Omit<StatementEntry, 'balance'> & { at: number }> = [
    // Credit bills, and the credit part of split bills; a voided bill was taken off the khata again
    ...sales
      .filter(s => s.status !== 'cancelled' && (s.payment_type === 'Credit' || (s.payment_type === 'Split' && (s.paid_credit ?? 0) > 0)))
      .map(s => ({
        at: toMs(s.sale_date), date: new Date(s.sale_date).toISOString(), kind: 'bill' as const,
        reference: s.invoice_no,
        details: s.payment_type === 'Split' ? 'Credit part of a split bill' : 'Credit bill',
        debit: s.payment_type === 'Split' ? s.paid_credit ?? 0 : s.net_total,
        credit: 0
      })),
    ...returns.map(r => ({
      at: toMs(r.created_at), date: new Date(r.created_at).toISOString(), kind: 'return' as const,
      reference: r.return_no, details: r.invoice_no ? `Return on ${r.invoice_no}` : 'Return', debit: 0, credit: r.refund_amount
    })),
    ...payments.map(p => ({
      at: toMs(p.payment_date), date: new Date(p.payment_date).toISOString(), kind: 'payment' as const,
      reference: p.payment_method, details: p.notes ? `Payment: ${p.notes}` : 'Payment received', debit: 0, credit: p.amount
    }))
  ].sort((a, b) => a.at - b.at);

  const billed = money2(rows.reduce((t, r) => t + (r.kind === 'bill' ? r.debit : 0), 0));
  const returned = money2(rows.reduce((t, r) => t + (r.kind === 'return' ? r.credit : 0), 0));
  const paid = money2(rows.reduce((t, r) => t + (r.kind === 'payment' ? r.credit : 0), 0));
  const opening = money2(currentBalance - (billed - returned - paid));

  const entries: StatementEntry[] = [];
  let balance = 0;
  if (Math.abs(opening) >= 0.01) {
    balance = opening;
    entries.push({
      date: rows[0]?.date ?? new Date().toISOString(), kind: 'opening', reference: '-', details: 'Opening / other changes',
      debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, balance
    });
  }
  for (const { at: _at, ...row } of rows) {
    balance = money2(balance + row.debit - row.credit);
    entries.push({ ...row, balance });
  }
  return { entries, totals: { billed, paid, returned, balance: money2(currentBalance) } };
}
