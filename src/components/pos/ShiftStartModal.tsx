import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useShiftStore } from '../../store/useShiftStore';
import { useAuthStore } from '../../store/useAuthStore';
import { Coins, Clock, AlertCircle } from 'lucide-react';

interface ShiftStartModalProps {
  isOpen: boolean;
  onClose?: () => void;
  currency?: string;
  onShiftStarted?: () => void;
}

export const ShiftStartModal: React.FC<ShiftStartModalProps> = ({
  isOpen,
  onClose,
  currency = 'Rs.',
  onShiftStarted
}) => {
  const { user } = useAuthStore();
  const { startShift, loading } = useShiftStore();

  const [openingCash, setOpeningCash] = useState<number>(5000);
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError('You must be signed in to open a shift.');
      return;
    }

    if (openingCash < 0) {
      setError('Opening cash float cannot be negative.');
      return;
    }

    try {
      setError(null);
      await startShift(user.id, user.full_name || user.username, openingCash, notes);
      if (onShiftStarted) onShiftStarted();
      if (onClose) onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to start shift.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose || (() => {})}
      title="Open Cashier Shift & Set Drawer Float"
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="p-3 bg-teal-500/10 border border-teal-500/20 rounded-xl flex items-start space-x-2.5">
          <Clock className="w-4 h-4 text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-bold text-slate-900 dark:text-white text-xs">
              Start Work Session for @{user?.username}
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
              Recording your start time unlocks POS counter sales. Please count physical cash in your drawer before opening.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/50 rounded-xl flex items-center space-x-2 text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3 bg-slate-50 dark:bg-[#0d131f] p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
              Opening Cash Drawer Float ({currency}) *
            </label>
            <div className="relative">
              <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="number"
                min="0"
                step="any"
                required
                value={openingCash}
                onChange={(e) => setOpeningCash(parseFloat(e.target.value) || 0)}
                placeholder="5000"
                className="w-full pl-9 pos-input font-mono font-bold text-base"
                autoFocus
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Physical cash already present in the cash drawer for change (Float).
            </p>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
              Shift Opening Remarks (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Morning counter shift, drawer verified"
              className="w-full pos-input"
            />
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-cancel"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={loading}
            className="btn-save flex items-center space-x-1.5"
          >
            <span>{loading ? 'Starting Shift...' : 'Start Shift & Open Register'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
