import React, { useState } from 'react';
import { ChevronDown, ChevronRight, MapPin, Pencil, Phone, Search, Trash2, Users } from 'lucide-react';
import { Customer } from '../../types';
import { CustomerInvoiceList, LedgerState, isLoadedLedger } from './CustomerInvoiceList';

interface CustomersTabProps {
  customers: Customer[];
  loading: boolean;
  money: (value: number) => string;
  ledgers: Record<number, LedgerState>;
  loadLedger: (customerId: number) => void;
  onOpenInvoice: (saleId: number) => void;
  onEdit?: (customer: Customer) => void;
  onDelete?: (customer: Customer) => void;
}

// All customers; the arrow on a row shows that customer's invoices underneath
export const CustomersTab: React.FC<CustomersTabProps> = ({ customers, loading, money, ledgers, loadLedger, onOpenInvoice, onEdit, onDelete }) => {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const filtered = customers.filter(c =>
    !q ||
    c.name.toLowerCase().includes(q) ||
    (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits)) ||
    (c.address || '').toLowerCase().includes(q)
  );

  const toggle = (id: number) => {
    if (!expanded.has(id)) loadLedger(id);
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const columnCount = 8;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, phone or address"
          className="field-input w-full pl-10"
        />
      </div>

      <div className="table-container overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 text-xs border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-2 w-10" />
              <th className="py-3 px-3 font-semibold">Customer</th>
              <th className="py-3 px-3 font-semibold">Phone</th>
              <th className="py-3 px-3 font-semibold">Address</th>
              <th className="py-3 px-3 font-semibold text-center">Invoices</th>
              <th className="py-3 px-3 font-semibold text-right">Total bought</th>
              <th className="py-3 px-3 font-semibold text-right">Khata balance</th>
              <th className="py-3 px-3 font-semibold text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {loading && customers.length === 0 ? (
              <tr><td colSpan={columnCount} className="py-12 text-center text-slate-400">Loading customers…</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  <Users className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-700 mb-2 stroke-[1.5]" />
                  {customers.length === 0 ? 'No customers yet. Add one here or save one from the POS.' : 'No customer matches your search.'}
                </td>
              </tr>
            ) : (
              filtered.map(cust => {
                const isOpen = expanded.has(cust.id);
                const ledger = ledgers[cust.id];
                const balance = Number(cust.current_balance || 0);
                return (
                  <React.Fragment key={cust.id}>
                    <tr className={`hover:bg-teal-500/5 ${isOpen ? 'bg-teal-500/5' : ''}`}>
                      <td className="py-3 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggle(cust.id)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} invoices of ${cust.name}`}
                          className="p-1 rounded-md text-slate-500 hover:text-teal-600 hover:bg-teal-500/10"
                        >
                          {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <button type="button" onClick={() => toggle(cust.id)} className="text-left">
                          <span className="block font-bold text-slate-900 dark:text-white">{cust.name}</span>
                          <span className="block text-2xs text-slate-400">Account #{cust.id}</span>
                        </button>
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {cust.phone ? <span className="inline-flex items-center gap-1"><Phone className="w-4 h-4 text-slate-400" />{cust.phone}</span> : <span className="text-slate-400">-</span>}
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                        {cust.address
                          ? <span className="inline-flex items-center gap-1 max-w-52" title={cust.address}><MapPin className="w-4 h-4 text-slate-400 shrink-0" /><span className="truncate">{cust.address}</span></span>
                          : <span className="text-slate-400">-</span>}
                      </td>
                      <td className="py-3 px-3 text-center font-semibold">{Number(cust.invoices_count || 0)}</td>
                      <td className="py-3 px-3 text-right font-mono whitespace-nowrap">{money(Number(cust.total_purchases || 0))}</td>
                      <td className={`py-3 px-3 text-right font-mono font-bold whitespace-nowrap ${balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {money(balance)}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {onEdit && (
                            <button type="button" onClick={() => onEdit(cust)} className="btn-secondary btn-sm" title="Edit customer">
                              <Pencil className="w-4 h-4" />
                              <span>Edit</span>
                            </button>
                          )}
                          {onDelete && (
                            <button type="button" onClick={() => onDelete(cust)} className="btn-danger btn-sm" title="Delete customer">
                              <Trash2 className="w-4 h-4" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50 dark:bg-surface-inset-dark/60">
                        <td />
                        <td colSpan={columnCount - 1} className="py-2 pr-4">
                          {ledger === 'loading' || ledger === undefined ? (
                            <p className="py-4 text-sm text-slate-500">Loading invoices…</p>
                          ) : isLoadedLedger(ledger) ? (
                            <CustomerInvoiceList
                              invoices={ledger.sales}
                              money={money}
                              onOpen={onOpenInvoice}
                              emptyText="No invoices yet. Select this customer at the POS to link their sales."
                            />
                          ) : (
                            <p className="py-4 text-sm text-rose-600 dark:text-rose-400">{ledger.error}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
