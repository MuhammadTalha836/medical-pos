import React, { useEffect, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../services/apiService';
import { SupplierLedger, SystemSettings } from '../../types';
import { printDocument } from '../../utils/printDocument';

interface SupplierStatementModalProps {
  supplierId: number | null;
  settings?: SystemSettings | null;
  money: (value: number) => string;
  onClose: () => void;
}

const STATUS_BADGE: Record<string, string> = { Paid: 'badge-success', Partial: 'badge-warning', Pending: 'badge-danger' };

/** A supplier's statement: unpaid bills and every purchase, payment and return with the running balance */
export const SupplierStatementModal: React.FC<SupplierStatementModalProps> = ({ supplierId, settings, money, onClose }) => {
  const [ledger, setLedger] = useState<SupplierLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (supplierId === null) return;
    let cancelled = false;
    setLedger(null);
    setError(null);
    api.getSupplierLedger(supplierId)
      .then(data => { if (!cancelled) setLedger(data); })
      .catch(err => { if (!cancelled) setError(err.message || 'The statement could not be loaded.'); });
    return () => { cancelled = true; };
  }, [supplierId]);

  const unpaid = ledger?.dues.filter(d => d.due > 0.005) ?? [];

  return (
    <Modal isOpen={supplierId !== null} onClose={onClose} title={`Supplier Statement${ledger ? `: ${ledger.supplier.name}` : ''}`} maxWidth="max-w-4xl">
      {error ? (
        <p className="py-8 text-center text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">{error}</p>
      ) : !ledger ? (
        <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading statement…</div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" onClick={() => printDocument(printRef.current, `Statement ${ledger.supplier.name}`)} className="btn-print">
              <Printer className="w-4 h-4" />
              <span>Print Statement</span>
            </button>
          </div>

          <div ref={printRef} className="space-y-4 text-sm text-slate-800 dark:text-slate-200">
            <div>
              <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">{settings?.store_name || 'Supplier statement'}</h1>
              <p className="text-slate-500 dark:text-slate-400 muted">
                Statement for {ledger.supplier.name} ({ledger.supplier.code}){ledger.supplier.phone ? `, ${ledger.supplier.phone}` : ''}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total bought', value: ledger.totals.purchased },
                { label: 'Total paid', value: ledger.totals.paid },
                { label: 'Returns credit', value: ledger.totals.returned },
                ledger.totals.balance < -0.005
                  ? { label: 'They owe you', value: -ledger.totals.balance }
                  : { label: 'Balance owed', value: ledger.totals.balance }
              ].map(card => (
                <div key={card.label} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-surface-inset-dark">
                  <div className="text-2xs text-slate-500 dark:text-slate-400">{card.label}</div>
                  <div className="text-base font-extrabold font-mono text-slate-900 dark:text-white num">{money(card.value)}</div>
                </div>
              ))}
            </div>

            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Unpaid bills</h2>
              {unpaid.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400 muted">Nothing is owed to this supplier.</p>
              ) : (
                <table className="w-full text-left text-xs mt-2">
                  <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Purchase #</th>
                      <th className="py-2 px-3">Supplier bill #</th>
                      <th className="py-2 px-3 text-right num">Bill</th>
                      <th className="py-2 px-3 text-right num">Paid</th>
                      <th className="py-2 px-3 text-right num">Due</th>
                      <th className="py-2 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {unpaid.map(d => (
                      <tr key={d.id}>
                        <td className="py-2 px-3 font-mono">{d.date}</td>
                        <td className="py-2 px-3 font-mono">{d.invoice_no}</td>
                        <td className="py-2 px-3 font-mono">{d.supplier_invoice_no || '-'}</td>
                        <td className="py-2 px-3 text-right font-mono num">{money(d.net_total)}</td>
                        <td className="py-2 px-3 text-right font-mono num">{money(d.settled)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold num">{money(d.due)}</td>
                        <td className="py-2 px-3 text-center"><span className={STATUS_BADGE[d.status]}>{d.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">All entries</h2>
              {ledger.entries.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400 muted">No purchases or payments yet.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-left text-xs mt-2">
                    <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 sticky top-0">
                      <tr>
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Reference</th>
                        <th className="py-2 px-3">Details</th>
                        <th className="py-2 px-3 text-right num">Bought</th>
                        <th className="py-2 px-3 text-right num">Paid / credit</th>
                        <th className="py-2 px-3 text-right num">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {ledger.entries.map((e, i) => (
                        <tr key={`${e.reference}-${e.kind}-${i}`}>
                          <td className="py-2 px-3 font-mono whitespace-nowrap">{e.date}</td>
                          <td className="py-2 px-3 font-mono">{e.reference}</td>
                          <td className="py-2 px-3 capitalize">{e.details}</td>
                          <td className="py-2 px-3 text-right font-mono num">{e.debit ? money(e.debit) : ''}</td>
                          <td className="py-2 px-3 text-right font-mono text-emerald-700 dark:text-emerald-400 num">{e.credit ? money(e.credit) : ''}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold num">{money(e.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
