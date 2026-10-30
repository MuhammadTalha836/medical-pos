import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { api } from '../../services/apiService';
import { CashMovement } from '../../types';

interface CashMovementModalProps {
  isOpen: boolean;
  shiftId: number;
  money: (value: number) => string;
  onClose: () => void;
  onSaved: () => void;
}

/** Cash pay-in / pay-out during a shift (C4): changes the cash expected in the drawer, never the day's profit */
export const CashMovementModal: React.FC<CashMovementModalProps> = ({ isOpen, shiftId, money, onClose, onSaved }) => {
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CashMovement[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setAmount('');
    setReason('');
    setError(null);
    api.getCashMovements(shiftId).then(setHistory).catch(() => setHistory([]));
  }, [isOpen, shiftId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    try {
      setSaving(true);
      setError(null);
      await api.addCashMovement(shiftId, { direction, amount: Number(amount), reason: reason.trim() });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'The cash movement could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cash In / Out" maxWidth="max-w-md">
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(['in', 'out'] as const).map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={direction === d ? 'btn-primary' : 'btn-secondary'}
            >
              {d === 'in' ? 'Cash in (pay-in)' : 'Cash out (pay-out)'}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="cash-move-amount" className="field-label">Amount</label>
          <input
            id="cash-move-amount"
            type="number"
            min="0"
            step="0.01"
            autoFocus
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="field-input w-full font-mono"
            required
          />
        </div>
        <div>
          <label htmlFor="cash-move-reason" className="field-label">Reason</label>
          <input
            id="cash-move-reason"
            type="text"
            maxLength={200}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={direction === 'in' ? 'e.g. Change brought from the bank' : 'e.g. Cash sent to the owner'}
            className="field-input w-full"
            required
          />
          <span className="field-hint">The drawer's expected cash goes {direction === 'in' ? 'up' : 'down'} by this amount. It is not an expense.</span>
        </div>
        {error && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400" role="alert">{error}</p>}

        {history.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">This shift</div>
            <ul className="space-y-1 max-h-32 overflow-y-auto text-xs text-slate-600 dark:text-slate-400">
              {history.map(m => (
                <li key={m.id} className="flex justify-between gap-2">
                  <span className="truncate">{m.direction === 'in' ? 'In' : 'Out'}: {m.reason}</span>
                  <span className={`font-mono font-semibold ${m.direction === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {m.direction === 'in' ? '+' : '-'}{money(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : direction === 'in' ? 'Save Cash In' : 'Save Cash Out'}</button>
        </div>
      </form>
    </Modal>
  );
};
