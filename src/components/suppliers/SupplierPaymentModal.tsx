import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { api } from '../../services/apiService';
import { SupplierPaymentMethod, SupplierSummary } from '../../types';
import { localDateString } from '../../../shared/dates';

interface SupplierPaymentModalProps {
  supplier: SupplierSummary | null;
  money: (value: number) => string;
  currency: string;
  onClose: () => void;
  onPaid: (message: string) => void;
}

const METHODS: { key: SupplierPaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'bank', label: 'Bank' },
  { key: 'cheque', label: 'Cheque' },
  { key: 'online', label: 'Online' }
];

/** Records a payment to a supplier; the server refuses more than what is owed */
export const SupplierPaymentModal: React.FC<SupplierPaymentModalProps> = ({ supplier, money, currency, onClose, onPaid }) => {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SupplierPaymentMethod>('cash');
  const [date, setDate] = useState(localDateString());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form every time it opens
  useEffect(() => {
    if (!supplier) return;
    setAmount('');
    setMethod('cash');
    setDate(localDateString());
    setReference('');
    setNotes('');
    setError(null);
  }, [supplier]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplier || saving) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter the amount paid.');
      return;
    }
    if (value > supplier.balance + 0.005) {
      setError(`You owe ${supplier.name} only ${money(supplier.balance)}.`);
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const res = await api.paySupplier(supplier.id, {
        amount: value,
        payment_method: method,
        payment_date: date,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined
      });
      onPaid(`Paid ${money(value)} to ${supplier.name}. Still owed: ${money(res.balance)}.`);
    } catch (err: any) {
      setError(err.message || 'The payment could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const needsReference = method === 'cheque' || method === 'bank' || method === 'online';

  return (
    <Modal
      isOpen={supplier !== null}
      onClose={() => { if (!saving) onClose(); }}
      title={`Pay Supplier: ${supplier?.name ?? ''}`}
      maxWidth="max-w-md"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <span className="text-sm text-amber-800 dark:text-amber-300">You owe</span>
          <div className="text-2xl font-extrabold font-mono text-amber-700 dark:text-amber-400">{money(supplier?.balance ?? 0)}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Amount paid ({currency})</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={supplier?.balance}
              required
              autoFocus
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="field-input w-full font-mono font-bold"
            />
          </label>
          <label className="block">
            <span className="field-label">Date</span>
            <input type="date" required value={date} max={localDateString()} onChange={e => setDate(e.target.value)} className="field-input w-full" />
          </label>
        </div>
        <button
          type="button"
          onClick={() => setAmount(String(supplier?.balance ?? ''))}
          className="btn-secondary btn-sm"
        >
          Pay full balance
        </button>

        <div>
          <span className="field-label">Paid by</span>
          <div className="grid grid-cols-4 gap-2">
            {METHODS.map(m => (
              <button
                type="button"
                key={m.key}
                onClick={() => setMethod(m.key)}
                aria-pressed={method === m.key}
                className={`h-10 text-sm font-semibold rounded-lg border transition-colors ${
                  method === m.key
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-slate-100 dark:bg-surface-inset-dark border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {needsReference && (
          <label className="block">
            <span className="field-label">{method === 'cheque' ? 'Cheque number' : 'Transaction / reference number'}</span>
            <input type="text" maxLength={60} value={reference} onChange={e => setReference(e.target.value)} className="field-input w-full font-mono" />
          </label>
        )}

        <label className="block">
          <span className="field-label">Notes</span>
          <input type="text" maxLength={200} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Paid to salesman Asif" className="field-input w-full" />
        </label>

        <p className="field-hint">The payment settles this supplier's oldest unpaid bills first. It is not taken from a shift's cash drawer.</p>
        {error && <p className="text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save Payment'}</button>
        </div>
      </form>
    </Modal>
  );
};
