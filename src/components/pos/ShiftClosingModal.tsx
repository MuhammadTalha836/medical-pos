import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useShiftStore } from '../../store/useShiftStore';
import { useAuthStore } from '../../store/useAuthStore';
import { CashierShift, SystemSettings } from '../../types';
import { ShiftThermalReceipt } from './ShiftThermalReceipt';
import {
  Clock,
  Lock,
  Coins,
  LogOut,
  AlertTriangle,
  Printer,
  Plus
} from 'lucide-react';
import { formatDuration, formatMoney } from '../../utils/format';

interface ShiftClosingModalProps {
  isOpen: boolean;
  onClose: () => void;
  currency?: string;
  settings?: SystemSettings | null;
  onShiftClosed?: () => void;
  onStartNewShiftRequest?: () => void;
}

export const ShiftClosingModal: React.FC<ShiftClosingModalProps> = ({
  isOpen,
  onClose,
  currency = 'Rs.',
  settings,
  onShiftClosed,
  onStartNewShiftRequest
}) => {
  const money = (amount: number | null | undefined) => formatMoney(amount, currency);
  const { user, logout } = useAuthStore();
  const { activeShift, activeSummary, fetchShiftSummary, closeShift, loading } = useShiftStore();

  const [actualCash, setActualCash] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [closedShiftResult, setClosedShiftResult] = useState<CashierShift | null>(null);
  const [showPrintSlip, setShowPrintSlip] = useState<boolean>(false);

  // Runs once per opening: keyed on the shift id, because each summary load replaces the activeShift object
  const activeShiftId = activeShift?.id;
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setNotes('');
    setClosedShiftResult(null);
    setShowPrintSlip(false);
    if (activeShiftId) {
      fetchShiftSummary(activeShiftId).then((summary) => {
        if (summary) {
          setActualCash(summary.expected_cash || summary.opening_cash);
        }
      });
    }
  }, [isOpen, activeShiftId]);

  if (!isOpen) return null;

  const expectedCash = activeSummary?.expected_cash ?? (activeShift?.opening_cash || 0);
  const variance = actualCash - expectedCash;

  const handleExecuteClose = async () => {
    if (!activeShift) return;

    if (actualCash < 0) {
      setError('Actual cash count cannot be negative.');
      return;
    }

    try {
      setError(null);
      const res = await closeShift(
        activeShift.id,
        actualCash,
        notes,
        user?.id,
        user?.full_name || user?.username
      );

      if (res.success) {
        setClosedShiftResult(res.shift);
        if (onShiftClosed) onShiftClosed();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to close shift.');
    }
  };

  const handlePrintThermal = () => {
    setShowPrintSlip(true);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        closedShiftResult
          ? `Shift ${closedShiftResult.shift_no} Closed & Locked`
          : `Shift Reconciliation & Register Closing: ${activeShift?.shift_no || 'Active Shift'}`
      }
      maxWidth={showPrintSlip ? 'max-w-md' : 'max-w-2xl'}
    >
      {showPrintSlip && closedShiftResult ? (
        <ShiftThermalReceipt
          shift={closedShiftResult}
          settings={settings}
          onClose={() => setShowPrintSlip(false)}
        />
      ) : closedShiftResult ? (
        /* Post-Close Completion Card */
        <div className="space-y-4 text-xs">
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Shift Successfully Reconciled & Locked
              </h3>
              <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
                Total Duration: <strong className="text-teal-600 dark:text-teal-400">{formatDuration(closedShiftResult.duration_minutes || 0)}</strong> • Variance: <strong className={closedShiftResult.cash_difference === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{money((closedShiftResult.cash_difference || 0))}</strong>
              </p>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-surface-inset-dark p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-slate-600 dark:text-slate-400">
            <div className="flex justify-between">
              <span>Shift Identifier:</span>
              <span className="font-bold font-mono text-slate-900 dark:text-white">{closedShiftResult.shift_no}</span>
            </div>
            <div className="flex justify-between">
              <span>Staff Member:</span>
              <span className="font-semibold text-slate-900 dark:text-white">{closedShiftResult.user_name}</span>
            </div>
            <div className="flex justify-between">
              <span>Opening Float:</span>
              <span className="font-mono text-slate-900 dark:text-white">{money(closedShiftResult.opening_cash)}</span>
            </div>
            <div className="flex justify-between">
              <span>Actual Cash Deposited:</span>
              <span className="font-bold font-mono text-teal-600 dark:text-teal-400 text-sm">
                {money((closedShiftResult.closing_cash || 0))}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={handlePrintThermal}
              className="btn-print"
            >
              <Printer className="w-4 h-4" />
              <span>Print Shift Slip</span>
            </button>

            <button
              onClick={() => {
                onClose();
                if (onStartNewShiftRequest) onStartNewShiftRequest();
              }}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              <span>Start New Shift</span>
            </button>

            <button
              onClick={() => {
                onClose();
                logout();
              }}
              className="btn-secondary"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out User</span>
            </button>
          </div>
        </div>
      ) : (
        /* Active Shift Reconciliation Form */
        <div className="space-y-4 text-xs">
          {error && (
            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/50 rounded-xl flex items-center space-x-2 text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Shift Time & Working Hours Header Card */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-teal-500/10 dark:bg-[#111827] border border-teal-500/20 dark:border-slate-800 p-3.5 rounded-xl">
            <div>
              <span className="text-2xs text-slate-500 dark:text-slate-400 block">Started At</span>
              <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                {activeShift?.start_time ? new Date(activeShift.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
              </div>
              <div className="text-2xs text-slate-400">
                {activeShift?.start_time ? new Date(activeShift.start_time).toLocaleDateString() : ''}
              </div>
            </div>

            <div>
              <span className="text-2xs text-slate-500 dark:text-slate-400 block">Closing Time</span>
              <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-2xs text-slate-400">Current Session End</div>
            </div>

            <div className="sm:border-l sm:border-slate-200 dark:sm:border-slate-800 sm:pl-3">
              <span className="text-2xs text-slate-500 dark:text-slate-400 block">Total Working Duration</span>
              <div className="font-bold text-teal-600 dark:text-teal-400 text-sm mt-0.5 flex items-center space-x-1 font-mono">
                <Clock className="w-4 h-4" />
                <span>{activeSummary?.duration_formatted || 'Calculating...'}</span>
              </div>
              <div className="text-2xs text-slate-400">Hours on duty</div>
            </div>
          </div>

          {/* Drawer Reconciliation Breakdown Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: System Drawer Calculations */}
            <div className="bg-slate-50 dark:bg-surface-inset-dark p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
              <span className="text-2xs font-bold text-slate-500 dark:text-slate-400 block border-b border-slate-200 dark:border-slate-800 pb-1">
                System Drawer Accounting
              </span>

              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-600 dark:text-slate-400">Opening Cash Float:</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white">
                  {money((activeSummary?.opening_cash || activeShift?.opening_cash || 0))}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs text-emerald-600 dark:text-emerald-400">
                <span>(+) Cash Sales ({activeSummary?.invoices_count || 0} bills):</span>
                <span className="font-mono font-semibold">
                  +{money((activeSummary?.total_sales_cash || 0))}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs text-teal-600 dark:text-teal-400">
                <span>(+) Khata Cash Recoveries:</span>
                <span className="font-mono font-semibold">
                  +{money((activeSummary?.total_customer_payments_cash || 0))}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs text-rose-600 dark:text-rose-400">
                <span>(-) Cash Returns ({activeSummary?.returns_count || 0} refunds):</span>
                <span className="font-mono font-semibold">
                  -{money((activeSummary?.total_returns_cash || 0))}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center">
                <span className="font-bold text-slate-900 dark:text-white">Expected Cash in Drawer:</span>
                <span className="font-mono font-bold text-sm text-teal-600 dark:text-teal-400">
                  {money(expectedCash)}
                </span>
              </div>

              <div className="pt-2 border-t border-dashed border-slate-200 dark:border-slate-800 text-2xs text-slate-400 flex justify-between">
                <span>Card / Digital Sales (Non-cash):</span>
                <span className="font-mono">{money((activeSummary?.total_sales_card || 0))}</span>
              </div>
            </div>

            {/* Right: Cashier Count & Discrepancy Verification */}
            <div className="space-y-3 bg-white dark:bg-[#111827] p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
              <div>
                <label className="block text-xs font-bold text-slate-900 dark:text-white mb-1">
                  Actual Physical Cash Count ({currency}) *
                </label>
                <div className="relative">
                  <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={actualCash}
                    onChange={(e) => setActualCash(parseFloat(e.target.value) || 0)}
                    className="field-input w-full pl-9 font-mono font-bold"
                    autoFocus
                  />
                </div>
                <p className="text-2xs text-slate-500 dark:text-slate-400 mt-1">
                  Count physical bills and coins currently inside the drawer.
                </p>

                {/* Variance Real-Time Indicator */}
                <div className="mt-3 p-2.5 rounded-xl border flex items-center justify-between text-xs font-semibold">
                  <span>Reconciliation Difference:</span>
                  <span
                    className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${
                      variance === 0
                        ? 'badge-success'
                        : variance > 0
                        ? 'badge-info'
                        : 'badge-danger'
                    }`}
                  >
                    {variance === 0
                      ? 'Balanced (0.00)'
                      : variance > 0
                      ? `Surplus: +${money(variance)}`
                      : `Deficit: -${money(Math.abs(variance))}`}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Closing Notes & Discrepancy Remarks
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Shift 1 closed normally. All cash handed over."
                  className="field-input w-full"
                />
              </div>
            </div>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start space-x-2 text-amber-800 dark:text-amber-300 text-xs">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Shift Locking Policy:</strong> Once closed, this shift will be locked permanently. You will not be able to invoice under this shift again. If you continue working, a new shift must be started.
            </span>
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExecuteClose}
              disabled={loading}
              className="btn-primary"
            >
              <Lock className="w-4 h-4" />
              <span>{loading ? 'Reconciling & Locking...' : 'Lock & Close Cashier Shift'}</span>
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
