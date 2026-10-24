import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, CreditCard, DollarSign, Phone, Wallet } from 'lucide-react';
import { api } from '../../services/apiService';
import { Customer } from '../../types';
import { Modal } from '../common/Modal';
import { useShiftStore } from '../../store/useShiftStore';
import { CustomerInvoiceList, LedgerState, isLoadedLedger } from './CustomerInvoiceList';

interface KhataTabProps {
  customers: Customer[];
  loading: boolean;
  money: (value: number) => string;
  currency: string;
  ledgers: Record<number, LedgerState>;
  loadLedger: (customerId: number, force?: boolean) => void;
  onOpenInvoice: (saleId: number) => void;
  canReceivePayment: boolean;
  /** After a payment: reload balances and tell the user */
  onPaymentRecorded: (message: string) => void;
}

const isOverLimit = (c: Customer) => c.credit_limit > 0 && c.current_balance > c.credit_limit;

// Udhaar: who owes how much, receive payments, and each customer's credit invoices and payments
export const KhataTab: React.FC<KhataTabProps> = ({
  customers, loading, money, currency, ledgers, loadLedger, onOpenInvoice, canReceivePayment, onPaymentRecorded
}) => {
  const { activeShift, fetchShiftSummary } = useShiftStore();
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Receive payment
  const [payCustomer, setPayCustomer] = useState<Customer | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<'Cash' | 'Card' | 'Online'>('Cash');
  const [notes, setNotes] = useState('');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const withBalance = customers.filter(c => Number(c.current_balance) > 0);
  const rows = (showAll ? customers : withBalance).slice().sort((a, b) => Number(b.current_balance) - Number(a.current_balance));
  const totalOutstanding = withBalance.reduce((sum, c) => sum + Number(c.current_balance || 0), 0);
  const overLimitCount = customers.filter(isOverLimit).length;

  const toggle = (id: number) => {
    if (!expanded.has(id)) loadLedger(id);
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openPayment = (c: Customer) => {
    setPayCustomer(c);
    setAmount(Number(c.current_balance));
    setMethod('Cash');
    setNotes('');
    setPayError(null);
  };

  const receivePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payCustomer) return;
    if (amount <= 0) {
      setPayError('Enter the amount received.');
      return;
    }
    try {
      setPaying(true);
      setPayError(null);
      const res = await api.recordCustomerPayment(payCustomer.id, {
        amount,
        payment_method: method,
        notes,
        shift_id: activeShift?.id || null
      });
      if (activeShift) fetchShiftSummary(activeShift.id);
      loadLedger(payCustomer.id, true);
      onPaymentRecorded(`Payment of ${money(amount)} received from ${payCustomer.name}. New balance: ${money(res.new_balance)}.`);
      setPayCustomer(null);
    } catch (err: any) {
      setPayError(err.message || 'Payment could not be saved');
    } finally {
      setPaying(false);
    }
  };

  const columnCount = 7;

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-surface p-4">
          <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
            <span>Total udhaar to receive</span>
            <DollarSign className="w-5 h-5 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-extrabold font-mono text-amber-600 dark:text-amber-400">{money(totalOutstanding)}</div>
        </div>
        <div className="card-surface p-4">
          <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
            <span>Customers with udhaar</span>
            <Wallet className="w-5 h-5 text-teal-500" />
          </div>
          <div className="mt-2 text-2xl font-extrabold font-mono text-slate-900 dark:text-white">{withBalance.length} <span className="text-base text-slate-400">/ {customers.length}</span></div>
        </div>
        <div className="card-surface p-4">
          <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
            <span>Over credit limit</span>
            <AlertTriangle className="w-5 h-5 text-rose-500" />
          </div>
          <div className={`mt-2 text-2xl font-extrabold font-mono ${overLimitCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{overLimitCount}</div>
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
        <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="w-5 h-5 accent-teal-600" />
        Show customers with no udhaar too
      </label>

      <div className="table-container overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 text-xs border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-3 px-2 w-10" />
              <th className="py-3 px-3 font-semibold">Customer</th>
              <th className="py-3 px-3 font-semibold">Phone</th>
              <th className="py-3 px-3 font-semibold text-right">Credit limit</th>
              <th className="py-3 px-3 font-semibold text-right">Balance</th>
              <th className="py-3 px-3 font-semibold text-center">Status</th>
              <th className="py-3 px-3 font-semibold text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {loading && customers.length === 0 ? (
              <tr><td colSpan={columnCount} className="py-12 text-center text-slate-400">Loading khata…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  <CreditCard className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-700 mb-2 stroke-[1.5]" />
                  No udhaar outstanding. Credit sales for saved customers appear here.
                </td>
              </tr>
            ) : (
              rows.map(cust => {
                const isOpen = expanded.has(cust.id);
                const ledger = ledgers[cust.id];
                const balance = Number(cust.current_balance || 0);
                const over = isOverLimit(cust);
                return (
                  <React.Fragment key={cust.id}>
                    <tr className={`hover:bg-teal-500/5 ${isOpen ? 'bg-teal-500/5' : ''}`}>
                      <td className="py-3 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggle(cust.id)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} khata history of ${cust.name}`}
                          className="p-1 rounded-md text-slate-500 hover:text-teal-600 hover:bg-teal-500/10"
                        >
                          {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <button type="button" onClick={() => toggle(cust.id)} className="text-left font-bold text-slate-900 dark:text-white">{cust.name}</button>
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {cust.phone ? <span className="inline-flex items-center gap-1"><Phone className="w-4 h-4 text-slate-400" />{cust.phone}</span> : '-'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono whitespace-nowrap text-slate-600 dark:text-slate-400">{cust.credit_limit > 0 ? money(Number(cust.credit_limit)) : 'No limit'}</td>
                      <td className={`py-3 px-3 text-right font-mono font-bold whitespace-nowrap ${over ? 'text-rose-600 dark:text-rose-400' : balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {money(balance)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={over ? 'badge-danger' : balance > 0 ? 'badge-warning' : 'badge-success'}>
                          {over ? 'Over limit' : balance > 0 ? 'Pending' : 'Clear'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {balance > 0 && canReceivePayment && (
                          <button type="button" onClick={() => openPayment(cust)} className="btn-primary btn-sm">
                            <DollarSign className="w-4 h-4" />
                            <span>Receive Payment</span>
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50 dark:bg-surface-inset-dark/60">
                        <td />
                        <td colSpan={columnCount - 1} className="py-3 pr-4">
                          {ledger === 'loading' || ledger === undefined ? (
                            <p className="py-4 text-sm text-slate-500">Loading khata history…</p>
                          ) : !isLoadedLedger(ledger) ? (
                            <p className="py-4 text-sm text-rose-600 dark:text-rose-400">{ledger.error}</p>
                          ) : (
                            <div className="space-y-4">
                              <div>
                                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">Credit invoices</h4>
                                <CustomerInvoiceList
                                  invoices={ledger.sales.filter(s => s.payment_type === 'Credit')}
                                  money={money}
                                  onOpen={onOpenInvoice}
                                  emptyText="No credit invoices."
                                />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">Payments received</h4>
                                {ledger.payments.length === 0 ? (
                                  <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">No payments yet.</p>
                                ) : (
                                  <table className="w-full text-left text-sm">
                                    <thead className="text-xs text-slate-500 dark:text-slate-400">
                                      <tr>
                                        <th className="py-2 px-3 font-semibold">Date</th>
                                        <th className="py-2 px-3 font-semibold text-right">Amount</th>
                                        <th className="py-2 px-3 font-semibold text-center">Method</th>
                                        <th className="py-2 px-3 font-semibold text-right">Balance</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                      {ledger.payments.map(p => (
                                        <tr key={p.id} title={p.notes || undefined}>
                                          <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                                            {new Date(p.payment_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                                            {p.notes && <span className="block text-xs text-slate-400 truncate max-w-48">{p.notes}</span>}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">{money(Number(p.amount))}</td>
                                          <td className="py-2 px-3 text-center capitalize">{p.payment_method}</td>
                                          <td className="py-2 px-3 text-right font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                            {money(Number(p.previous_balance))} → {money(Number(p.new_balance))}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </div>
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

      {/* Receive payment */}
      <Modal
        isOpen={payCustomer !== null}
        onClose={() => setPayCustomer(null)}
        title={`Receive Payment: ${payCustomer?.name ?? ''}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={receivePayment} className="space-y-4">
          <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
            <span className="text-sm text-amber-800 dark:text-amber-300">Udhaar balance</span>
            <div className="text-2xl font-extrabold font-mono text-amber-700 dark:text-amber-400">{money(Number(payCustomer?.current_balance || 0))}</div>
          </div>

          <label className="block">
            <span className="field-label">Amount received ({currency})</span>
            <input
              type="number"
              step="0.01"
              min="1"
              required
              autoFocus
              max={payCustomer?.current_balance}
              value={amount || ''}
              onChange={e => setAmount(parseFloat(e.target.value) || 0)}
              className="field-input w-full font-mono font-bold"
            />
          </label>

          <div>
            <span className="field-label">Payment method</span>
            <div className="grid grid-cols-3 gap-2">
              {(['Cash', 'Card', 'Online'] as const).map(m => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`h-10 text-sm font-semibold rounded-lg border transition-colors ${
                    method === m
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-slate-100 dark:bg-surface-inset-dark border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="field-label">Notes</span>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Paid half in cash"
              className="field-input w-full"
            />
          </label>

          {!activeShift && <p className="field-hint">No shift is open, so this payment is not added to a shift's cash.</p>}
          {payError && <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">{payError}</p>}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={() => setPayCustomer(null)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={paying} className="btn-primary">
              {paying ? 'Saving…' : 'Receive Payment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
