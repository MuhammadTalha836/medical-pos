import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../services/apiService';
import { CustomerLedger, SystemSettings } from '../../types';
import { printDocument } from '../../utils/printDocument';
import { downloadCsv } from '../../utils/csv';
import { customerStatement } from '../../../shared/customers';

interface CustomerStatementModalProps {
  customerId: number | null;
  settings?: SystemSettings | null;
  money: (value: number) => string;
  onClose: () => void;
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString();

/** A customer's khata statement: credit bills, returns and payments with the running balance, to print or export */
export const CustomerStatementModal: React.FC<CustomerStatementModalProps> = ({ customerId, settings, money, onClose }) => {
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (customerId === null) return;
    let cancelled = false;
    setLedger(null);
    setError(null);
    api.getCustomerLedger(customerId)
      .then(data => { if (!cancelled) setLedger(data); })
      .catch(err => { if (!cancelled) setError(err.message || 'The statement could not be loaded.'); });
    return () => { cancelled = true; };
  }, [customerId]);

  const statement = useMemo(
    () => (ledger ? customerStatement(ledger.sales, ledger.returns ?? [], ledger.payments, Number(ledger.customer.current_balance || 0)) : null),
    [ledger]
  );

  const exportCsv = () => {
    if (!ledger || !statement) return;
    downloadCsv(
      `khata_statement_${ledger.customer.name.replace(/\W+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`,
      ['Date', 'Reference', 'Details', 'Owed', 'Paid / credit', 'Balance'],
      statement.entries.map(e => [dateText(e.date), e.reference, e.details, e.debit ? e.debit.toFixed(2) : '', e.credit ? e.credit.toFixed(2) : '', e.balance.toFixed(2)])
    );
  };

  return (
    <Modal isOpen={customerId !== null} onClose={onClose} title={`Khata Statement${ledger ? `: ${ledger.customer.name}` : ''}`} maxWidth="max-w-4xl">
      {error ? (
        <p className="py-8 text-center text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">{error}</p>
      ) : !ledger || !statement ? (
        <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading statement…</div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <button type="button" onClick={exportCsv} disabled={statement.entries.length === 0} className="btn-secondary">
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
            <button type="button" onClick={() => printDocument(printRef.current, `Khata statement ${ledger.customer.name}`)} className="btn-print">
              <Printer className="w-4 h-4" />
              <span>Print Statement</span>
            </button>
          </div>

          <div ref={printRef} className="space-y-4 text-sm text-slate-800 dark:text-slate-200">
            <div>
              <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">{settings?.store_name || 'Khata statement'}</h1>
              <p className="text-slate-500 dark:text-slate-400 muted">
                Khata statement for {ledger.customer.name}{ledger.customer.phone ? `, ${ledger.customer.phone}` : ''}.
                {' '}Credit limit: {Number(ledger.customer.credit_limit) > 0 ? money(Number(ledger.customer.credit_limit)) : 'no limit'}.
                {' '}Printed {new Date().toLocaleString()}.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Credit bills', value: statement.totals.billed },
                { label: 'Paid', value: statement.totals.paid },
                { label: 'Returns', value: statement.totals.returned },
                { label: 'Balance owed', value: statement.totals.balance }
              ].map(card => (
                <div key={card.label} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-surface-inset-dark">
                  <div className="text-2xs text-slate-500 dark:text-slate-400">{card.label}</div>
                  <div className="text-base font-extrabold font-mono text-slate-900 dark:text-white num">{money(card.value)}</div>
                </div>
              ))}
            </div>

            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">All entries</h2>
              {statement.entries.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400 muted">No credit bills or payments yet.</p>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-xs mt-2">
                    <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 sticky top-0">
                      <tr>
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Reference</th>
                        <th className="py-2 px-3">Details</th>
                        <th className="py-2 px-3 text-right num">Owed</th>
                        <th className="py-2 px-3 text-right num">Paid / credit</th>
                        <th className="py-2 px-3 text-right num">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {statement.entries.map((e, i) => (
                        <tr key={`${e.kind}-${e.reference}-${i}`}>
                          <td className="py-2 px-3 font-mono whitespace-nowrap">{dateText(e.date)}</td>
                          <td className="py-2 px-3 font-mono">{e.reference}</td>
                          <td className="py-2 px-3">{e.details}</td>
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
