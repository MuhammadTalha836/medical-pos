import React from 'react';
import { ChevronRight } from 'lucide-react';
import { CustomerInvoiceRow, CustomerLedger } from '../../types';
import { saleStatus } from '../../utils/saleStatus';

/** A customer's ledger as loaded for an expanded row */
export type LedgerState = CustomerLedger | 'loading' | { error: string };

export const isLoadedLedger = (state: LedgerState | undefined): state is CustomerLedger =>
  typeof state === 'object' && state !== null && 'sales' in state;

const PAYMENT_BADGE: Record<string, string> = {
  Credit: 'badge-warning',
  Cash: 'badge-success',
  Card: 'badge-info',
  Online: 'badge-info'
};

interface CustomerInvoiceListProps {
  invoices: CustomerInvoiceRow[];
  money: (value: number) => string;
  onOpen: (saleId: number) => void;
  emptyText: string;
}

// The invoices under an expanded customer row; a click (or Enter) opens the full invoice
export const CustomerInvoiceList: React.FC<CustomerInvoiceListProps> = ({ invoices, money, onOpen, emptyText }) => {
  if (invoices.length === 0) {
    return <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-slate-500 dark:text-slate-400">
        <tr>
          <th className="py-2 px-3 font-semibold">Invoice</th>
          <th className="py-2 px-3 font-semibold">Date</th>
          <th className="py-2 px-3 font-semibold text-center">Items</th>
          <th className="py-2 px-3 font-semibold text-center">Payment</th>
          <th className="py-2 px-3 font-semibold text-right">Total</th>
          <th className="py-2 px-3 font-semibold text-center">Status</th>
          <th className="py-2 px-3 w-8" />
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
        {invoices.map(inv => (
          <tr
            key={inv.id}
            tabIndex={0}
            role="button"
            aria-label={`Open invoice ${inv.invoice_no}`}
            onClick={() => onOpen(inv.id)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(inv.id); } }}
            className="cursor-pointer hover:bg-teal-500/10 focus:bg-teal-500/10 focus:outline-hidden"
          >
            <td className="py-2 px-3 font-mono font-semibold whitespace-nowrap text-teal-700 dark:text-teal-400">{inv.invoice_no}</td>
            <td className="py-2 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
              {new Date(inv.sale_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </td>
            <td className="py-2 px-3 text-center">{inv.items_count}</td>
            <td className="py-2 px-3 text-center">
              <span className={PAYMENT_BADGE[inv.payment_type] ?? 'badge-info'}>{inv.payment_type}</span>
            </td>
            <td className="py-2 px-3 text-right font-mono font-semibold whitespace-nowrap text-slate-900 dark:text-white">{money(Number(inv.net_total))}</td>
            <td className="py-2 px-3 text-center">
              <span className={saleStatus(inv.status).badge}>{saleStatus(inv.status).label}</span>
            </td>
            <td className="py-2 px-3 text-slate-400"><ChevronRight className="w-4 h-4" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
