import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Search, Truck, Wallet } from 'lucide-react';
import { api } from '../../services/apiService';
import { SupplierSummary, SystemSettings } from '../../types';
import { SupplierPaymentModal } from './SupplierPaymentModal';
import { SupplierStatementModal } from './SupplierStatementModal';

interface SuppliersTabProps {
  settings?: SystemSettings | null;
  money: (value: number) => string;
  currency: string;
  canPay: boolean;
  /** Bumped by the page after a purchase is saved, so balances reload */
  refreshKey: number;
}

/** What the store owes each supplier (distributor), with payments and statements */
export const SuppliersTab: React.FC<SuppliersTabProps> = ({ settings, money, currency, canPay, refreshKey }) => {
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyOwed, setOnlyOwed] = useState(false);
  const [payFor, setPayFor] = useState<SupplierSummary | null>(null);
  const [statementFor, setStatementFor] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setSuppliers(await api.getSuppliers());
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Suppliers could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return suppliers.filter(s =>
      (!onlyOwed || s.balance > 0.005) &&
      (!q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || (s.phone ?? '').includes(q))
    );
  }, [suppliers, query, onlyOwed]);

  const totalOwed = suppliers.reduce((sum, s) => sum + Math.max(0, s.balance), 0);
  const owedCount = suppliers.filter(s => s.balance > 0.005).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card-premium p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400"><Wallet className="w-5 h-5" /></div>
          <div>
            <div className="text-xl font-extrabold font-mono text-slate-900 dark:text-white">{money(totalOwed)}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Total owed to suppliers</div>
          </div>
        </div>
        <div className="card-premium p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400"><Truck className="w-5 h-5" /></div>
          <div>
            <div className="text-xl font-extrabold text-slate-900 dark:text-white">{owedCount}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Suppliers with a balance</div>
          </div>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="card-premium p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search supplier name, code or phone"
            aria-label="Search suppliers"
            className="field-input w-full pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
          <input type="checkbox" checked={onlyOwed} onChange={e => setOnlyOwed(e.target.checked)} className="w-4 h-4 accent-teal-600" />
          <span>Only suppliers I owe</span>
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={load} className="btn-secondary btn-sm">Try again</button>
        </div>
      )}

      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-4">Supplier</th>
              <th className="py-3 px-4">Phone</th>
              <th className="py-3 px-4 text-right">Bought</th>
              <th className="py-3 px-4 text-right">Paid</th>
              <th className="py-3 px-4 text-right">Balance owed</th>
              <th className="py-3 px-4 text-center">Unpaid bills</th>
              <th className="py-3 px-4">Last purchase</th>
              <th className="py-3 px-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
            {loading ? (
              <tr><td colSpan={8} className="py-12 text-center text-slate-500 dark:text-slate-400">Loading suppliers…</td></tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  {suppliers.length === 0
                    ? 'No suppliers yet. Add companies under Medicines → Companies, then record purchases.'
                    : 'No supplier matches this search.'}
                </td>
              </tr>
            ) : (
              visible.map(s => (
                <tr key={s.id} className="hover:bg-teal-500/5 dark:hover:bg-teal-500/10">
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-900 dark:text-white">{s.name}</div>
                    <div className="text-2xs font-mono text-teal-600 dark:text-teal-400">{s.code}{s.contact_person ? `, ${s.contact_person}` : ''}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">{s.phone || '-'}</td>
                  <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-300">{money(s.total_purchased)}</td>
                  <td className="py-3 px-4 text-right font-mono text-emerald-600 dark:text-emerald-400">{money(s.total_paid + s.total_returned)}</td>
                  <td className={`py-3 px-4 text-right font-mono font-bold text-sm ${s.balance > 0.005 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    {money(s.balance)}
                  </td>
                  <td className="py-3 px-4 text-center font-mono">{s.unpaid_bills || '-'}</td>
                  <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">{s.last_purchase_date || '-'}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-1.5">
                      {canPay && s.balance > 0.005 && (
                        <button type="button" onClick={() => { setNotice(null); setPayFor(s); }} className="btn-primary btn-sm">
                          <Wallet className="w-4 h-4" />
                          <span>Pay</span>
                        </button>
                      )}
                      <button type="button" onClick={() => setStatementFor(s.id)} className="btn-secondary btn-sm">
                        <FileText className="w-4 h-4" />
                        <span>Statement</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SupplierPaymentModal
        supplier={payFor}
        money={money}
        currency={currency}
        onClose={() => setPayFor(null)}
        onPaid={message => {
          setPayFor(null);
          setNotice(message);
          load();
        }}
      />
      <SupplierStatementModal supplierId={statementFor} settings={settings} money={money} onClose={() => setStatementFor(null)} />
    </div>
  );
};
