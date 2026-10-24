import React, { useState, useEffect } from 'react';
import { api } from '../../services/apiService';
import { CashierShift, SystemSettings } from '../../types';
import { useAuthStore } from '../../store/useAuthStore';
import { useShiftStore } from '../../store/useShiftStore';
import { Modal } from '../common/Modal';
import { ShiftThermalReceipt } from '../pos/ShiftThermalReceipt';
import {
  Clock,
  Printer,
  Calendar,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Edit3,
  Lock,
  Unlock,
  Eye,
  Coins,
  FileText,
  User,
  ShieldCheck,
  Plus
} from 'lucide-react';

interface ShiftHistoryHubProps {
  settings?: SystemSettings | null;
}

export const ShiftHistoryHub: React.FC<ShiftHistoryHubProps> = ({ settings }) => {
  const { user, hasPermission } = useAuthStore();
  const { activeShift, setStartModalOpen, setClosingModalOpen } = useShiftStore();

  const [shifts, setShifts] = useState<CashierShift[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchUser, setSearchUser] = useState<string>('');
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modal states
  const [selectedShiftForPrint, setSelectedShiftForPrint] = useState<CashierShift | null>(null);
  const [inspectShiftId, setInspectShiftId] = useState<number | null>(null);
  const [inspectData, setInspectData] = useState<any | null>(null);
  const [loadingInspect, setLoadingInspect] = useState<boolean>(false);

  // Admin override modals
  const [reopenModalShift, setReopenModalShift] = useState<CashierShift | null>(null);
  const [reopenReason, setReopenReason] = useState<string>('');
  const [isSubmittingReopen, setIsSubmittingReopen] = useState<boolean>(false);

  const [correctModalShift, setCorrectModalShift] = useState<CashierShift | null>(null);
  const [correctedCash, setCorrectedCash] = useState<number>(0);
  const [correctReason, setCorrectReason] = useState<string>('');
  const [isSubmittingCorrect, setIsSubmittingCorrect] = useState<boolean>(false);

  const currency = settings?.currency_symbol || 'Rs.';

  const loadShifts = async () => {
    try {
      setLoading(true);
      const data = await api.getShifts({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        // Non-managers see only their own shifts; admins/managers see all
        user_id: hasPermission('can_manage_shifts') ? undefined : user?.id
      });
      setShifts(data);
    } catch (err: any) {
      console.error('Failed to load shifts:', err);
      setNotification({ type: 'error', text: 'Failed to load shifts: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShifts();
  }, [statusFilter, dateFrom, dateTo]);

  const handleInspectShift = async (shiftId: number) => {
    try {
      setInspectShiftId(shiftId);
      setLoadingInspect(true);
      const res = await api.getShiftDetails(shiftId);
      setInspectData(res.shift);
    } catch (err: any) {
      alert('Failed to load shift details: ' + err.message);
    } finally {
      setLoadingInspect(false);
    }
  };

  const handleExecuteAdminReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenModalShift || !user) return;
    if (!reopenReason.trim()) {
      alert('A valid administrative reason is required to reopen a closed shift.');
      return;
    }

    try {
      setIsSubmittingReopen(true);
      await api.reopenShiftByAdmin(reopenModalShift.id, {
        admin_id: user.id,
        admin_name: user.full_name || user.username,
        reason: reopenReason.trim()
      });

      setNotification({
        type: 'success',
        text: `Shift ${reopenModalShift.shift_no} has been reopened by Admin. Audited.`
      });
      setReopenModalShift(null);
      setReopenReason('');
      loadShifts();
      setTimeout(() => setNotification(null), 6000);
    } catch (err: any) {
      alert('Failed to reopen shift: ' + err.message);
    } finally {
      setIsSubmittingReopen(false);
    }
  };

  const handleExecuteAdminCorrect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctModalShift || !user) return;
    if (correctedCash < 0) {
      alert('Corrected cash count cannot be negative.');
      return;
    }
    if (!correctReason.trim()) {
      alert('A valid administrative justification is required to modify shift drawer reconciliation.');
      return;
    }

    try {
      setIsSubmittingCorrect(true);
      await api.correctShiftByAdmin(correctModalShift.id, {
        admin_id: user.id,
        admin_name: user.full_name || user.username,
        corrected_closing_cash: correctedCash,
        reason: correctReason.trim()
      });

      setNotification({
        type: 'success',
        text: `Cash drawer count for ${correctModalShift.shift_no} adjusted to ${currency} ${correctedCash.toFixed(2)}. Discrepancy logged.`
      });
      setCorrectModalShift(null);
      setCorrectReason('');
      loadShifts();
      setTimeout(() => setNotification(null), 6000);
    } catch (err: any) {
      alert('Failed to adjust cash count: ' + err.message);
    } finally {
      setIsSubmittingCorrect(false);
    }
  };

  const filteredShifts = shifts.filter(s => {
    if (!searchUser) return true;
    const q = searchUser.toLowerCase();
    return s.user_name?.toLowerCase().includes(q) || s.shift_no?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`flex items-center space-x-2 px-4 py-3 rounded-xl text-xs font-medium border ${
            notification.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800/80 text-rose-800 dark:text-rose-300'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          )}
          <span>{notification.text}</span>
        </div>
      )}

      {/* Active Shift Card & Action Banner */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              activeShift
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
            }`}>
              {activeShift ? <Clock className="w-6 h-6 animate-pulse" /> : <Lock className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {activeShift ? `Active Shift: ${activeShift.shift_no}` : 'No Active Cashier Shift'}
                </h3>
                <span className={activeShift ? 'badge-success' : 'badge-warning'}>
                  {activeShift ? 'OPEN & INVOICING' : 'REGISTER LOCKED'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {activeShift
                  ? `Cashier: ${activeShift.user_name} • Started: ${new Date(activeShift.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Opening Float: ${currency} ${activeShift.opening_cash.toFixed(2)}`
                  : 'Start a new cashier shift to record hours and authorize POS sales and billing.'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {activeShift ? (
              <button
                onClick={() => setClosingModalOpen(true)}
                className="btn-cancel px-4 py-2 text-xs font-semibold flex items-center space-x-1.5 shadow-xs"
              >
                <Lock className="w-3.5 h-3.5 text-amber-500" />
                <span>Reconcile Drawer & Close Shift</span>
              </button>
            ) : (
              <button
                onClick={() => setStartModalOpen(true)}
                className="btn-save px-4 py-2 text-xs font-semibold flex items-center space-x-1.5 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Start New Cashier Shift</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Shifts Register Filters & Search */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Shift Records & Cashier History ({filteredShifts.length})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                placeholder="Search shift # or cashier..."
                className="pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            >
              <option value="all">All Statuses</option>
              <option value="open">Active / Open Only</option>
              <option value="closed">Closed Only</option>
            </select>

            <div className="flex items-center space-x-1 text-xs text-slate-500 dark:text-slate-400">
              <span>From:</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-700 rounded-xl px-2 py-1 text-xs text-slate-900 dark:text-white font-mono"
              />
              <span>To:</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-700 rounded-xl px-2 py-1 text-xs text-slate-900 dark:text-white font-mono"
              />
            </div>

            {(dateFrom || dateTo || searchUser || statusFilter !== 'all') && (
              <button
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                  setSearchUser('');
                  setStatusFilter('all');
                }}
                className="btn-cancel px-2.5 py-1.5 text-xs"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Shift Records Table */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Shift #</th>
                <th className="py-2.5 px-3">Cashier</th>
                <th className="py-2.5 px-3">Start Time</th>
                <th className="py-2.5 px-3">Closing Time</th>
                <th className="py-2.5 px-3">Duration</th>
                <th className="py-2.5 px-3 text-right">Float</th>
                <th className="py-2.5 px-3 text-right">Cash Sales</th>
                <th className="py-2.5 px-3 text-right">Expected</th>
                <th className="py-2.5 px-3 text-right">Actual Count</th>
                <th className="py-2.5 px-3 text-center">Variance</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <span>Loading Shifts Register...</span>
                  </td>
                </tr>
              ) : filteredShifts.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400 dark:text-slate-500">
                    <Clock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-700 mb-2 stroke-[1.5]" />
                    <div>No cashier shifts found matching the filter criteria.</div>
                  </td>
                </tr>
              ) : (
                filteredShifts.map((shift, idx) => {
                  const durationHours = Math.floor((shift.duration_minutes || 0) / 60);
                  const durationMins = (shift.duration_minutes || 0) % 60;
                  const diff = shift.cash_difference || 0;

                  return (
                    <tr
                      key={shift.id}
                      className={`hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors ${
                        idx % 2 === 0 ? 'bg-transparent' : 'bg-slate-50/50 dark:bg-surface-inset-dark/40'
                      }`}
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-white">
                        {shift.shift_no}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                        {shift.user_name}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                        {new Date(shift.start_time).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                        {shift.end_time ? (
                          new Date(shift.end_time).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">Active Now</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-teal-700 dark:text-teal-300 font-semibold">
                        {shift.end_time ? `${durationHours}h ${durationMins}m` : 'In Progress'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                        {currency} {shift.opening_cash.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                        +{currency} {(shift.total_cash_sales || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-teal-600 dark:text-teal-400 font-bold">
                        {currency} {(shift.expected_cash || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {shift.closing_cash !== null && shift.closing_cash !== undefined
                          ? `${currency} ${shift.closing_cash.toFixed(2)}`
                          : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {shift.status === 'open' ? (
                          <span className="text-[10px] text-slate-400 italic">Pending</span>
                        ) : (
                          <span
                            className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded ${
                              diff === 0
                                ? 'badge-success'
                                : diff > 0
                                ? 'badge-info'
                                : 'badge-danger'
                            }`}
                          >
                            {diff === 0 ? '0.00' : diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={shift.status === 'open' ? 'badge-success' : 'badge-warning'}>
                          {shift.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          {/* Print Slip Button */}
                          <button
                            onClick={() => setSelectedShiftForPrint(shift)}
                            className="p-1 rounded-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                            title="Print Thermal Shift Slip"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>

                          {/* Inspect Shift Details */}
                          <button
                            onClick={() => handleInspectShift(shift.id)}
                            className="p-1 rounded-sm bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/60 dark:hover:bg-teal-900/60 text-teal-700 dark:text-teal-300 transition-colors"
                            title="View Shift Invoices & Breakdowns"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Admin Action: Correct Cash Count */}
                          {hasPermission('can_manage_shifts') && shift.status === 'closed' && (
                            <button
                              onClick={() => {
                                setCorrectModalShift(shift);
                                setCorrectedCash(shift.closing_cash || 0);
                                setCorrectReason('');
                              }}
                              className="p-1 rounded-sm bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 transition-colors"
                              title="Admin: Correct Drawer Cash Count"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Admin Action: Emergency Reopen Shift */}
                          {hasPermission('can_manage_shifts') && shift.status === 'closed' && (
                            <button
                              onClick={() => {
                                setReopenModalShift(shift);
                                setReopenReason('');
                              }}
                              className="p-1 rounded-sm bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 transition-colors"
                              title="Admin: Emergency Reopen Shift"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Print Thermal Slip Modal */}
      <Modal
        isOpen={!!selectedShiftForPrint}
        onClose={() => setSelectedShiftForPrint(null)}
        title={`Reconciliation Slip: ${selectedShiftForPrint?.shift_no || ''}`}
        maxWidth="max-w-md"
      >
        {selectedShiftForPrint && (
          <ShiftThermalReceipt
            shift={selectedShiftForPrint}
            settings={settings}
            onClose={() => setSelectedShiftForPrint(null)}
          />
        )}
      </Modal>

      {/* Inspect Shift Details Modal */}
      <Modal
        isOpen={!!inspectShiftId}
        onClose={() => {
          setInspectShiftId(null);
          setInspectData(null);
        }}
        title={`Shift Audit Inspection: ${inspectData?.shift_no || 'Details'}`}
        maxWidth="max-w-3xl"
      >
        {loadingInspect ? (
          <div className="py-12 text-center text-slate-500">
            <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            <span>Loading Shift Transaction Details...</span>
          </div>
        ) : inspectData ? (
          <div className="space-y-4 text-xs">
            {/* Shift Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-surface-inset-dark p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
              <div>
                <span className="text-[10px] text-slate-400 block">Cashier</span>
                <span className="font-bold text-slate-900 dark:text-white">{inspectData.user_name}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Opening Float</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {currency} {inspectData.opening_cash.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Actual Deposited</span>
                <span className="font-mono font-bold text-teal-600 dark:text-teal-400">
                  {inspectData.closing_cash !== null ? `${currency} ${inspectData.closing_cash.toFixed(2)}` : 'In Progress'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Discrepancy</span>
                <span className={`font-mono font-bold ${
                  (inspectData.cash_difference || 0) === 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}>
                  {inspectData.cash_difference !== null ? `${currency} ${(inspectData.cash_difference || 0).toFixed(2)}` : '-'}
                </span>
              </div>
            </div>

            {/* Invoices List */}
            <div className="space-y-2">
              <span className="font-bold text-slate-800 dark:text-slate-200 uppercase text-[10px] tracking-wider block">
                Sales Invoices Under This Shift ({inspectData.sales?.length || 0})
              </span>
              <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-600 dark:text-slate-400 text-[10px] uppercase">
                    <tr>
                      <th className="py-2 px-3">Invoice #</th>
                      <th className="py-2 px-3">Customer</th>
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-3">Payment</th>
                      <th className="py-2 px-3 text-right">Net Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                    {inspectData.sales?.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-slate-400">
                          No sales bills recorded in this shift session.
                        </td>
                      </tr>
                    ) : (
                      inspectData.sales?.map((sale: any) => (
                        <tr key={sale.id} className="hover:bg-slate-50 dark:hover:bg-[#162032]">
                          <td className="py-1.5 px-3 font-mono font-bold text-slate-900 dark:text-white">{sale.invoiceNo}</td>
                          <td className="py-1.5 px-3 text-slate-700 dark:text-slate-300">{sale.customerName}</td>
                          <td className="py-1.5 px-3 text-slate-500 font-mono text-[11px]">
                            {new Date(sale.saleDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-1.5 px-3">
                            <span className="px-1.5 py-0.5 rounded-sm text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono uppercase">
                              {sale.paymentType}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {currency} {Number(sale.netTotal).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Khata Recoveries & Returns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Returns */}
              <div className="space-y-1.5">
                <span className="font-bold text-slate-800 dark:text-slate-200 uppercase text-[10px] tracking-wider block">
                  Refunds / Returns ({inspectData.saleReturns?.length || 0})
                </span>
                <div className="max-h-32 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl p-2 space-y-1.5 text-[11px]">
                  {inspectData.saleReturns?.length === 0 ? (
                    <div className="text-slate-400 py-2 text-center text-[10px]">No refunds during this shift.</div>
                  ) : (
                    inspectData.saleReturns?.map((ret: any) => (
                      <div key={ret.id} className="flex justify-between items-center bg-slate-50 dark:bg-surface-inset-dark p-1.5 rounded-lg">
                        <div>
                          <span className="font-bold font-mono text-slate-900 dark:text-white">{ret.returnNo}</span>
                          <span className="text-slate-400 block text-[9px]">Inv: {ret.originalInvoiceNo}</span>
                        </div>
                        <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                          -{currency} {Number(ret.refundAmount).toFixed(2)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Khata Recoveries */}
              <div className="space-y-1.5">
                <span className="font-bold text-slate-800 dark:text-slate-200 uppercase text-[10px] tracking-wider block">
                  Khata Cash Recoveries ({inspectData.customerPayments?.length || 0})
                </span>
                <div className="max-h-32 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl p-2 space-y-1.5 text-[11px]">
                  {inspectData.customerPayments?.length === 0 ? (
                    <div className="text-slate-400 py-2 text-center text-[10px]">No khata recoveries during this shift.</div>
                  ) : (
                    inspectData.customerPayments?.map((p: any) => (
                      <div key={p.id} className="flex justify-between items-center bg-slate-50 dark:bg-surface-inset-dark p-1.5 rounded-lg">
                        <div>
                          <span className="font-bold text-slate-900 dark:text-white font-mono">{p.paymentMethod}</span>
                          <span className="text-slate-400 block text-[9px]">{p.notes || 'Khata Recovery'}</span>
                        </div>
                        <span className="font-mono font-bold text-teal-600 dark:text-teal-400">
                          +{currency} {Number(p.amount).toFixed(2)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => {
                  setInspectShiftId(null);
                  setInspectData(null);
                }}
                className="btn-cancel px-4 py-2"
              >
                Close Inspector
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Admin Reopen Confirmation Modal */}
      <Modal
        isOpen={!!reopenModalShift}
        onClose={() => setReopenModalShift(null)}
        title={`Admin Reopen Shift: ${reopenModalShift?.shift_no || ''}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleExecuteAdminReopen} className="space-y-4 text-xs">
          <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 rounded-xl text-rose-800 dark:text-rose-300 space-y-1">
            <div className="flex items-center space-x-1.5 font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Administrative Shift Reopen Override</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Reopening a closed shift unlocks the cash register for that shift. This action bypasses standard locking rules and will be permanently logged to the system audit trails.
            </p>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
              Mandatory Administrative Reason *
            </label>
            <textarea
              required
              rows={3}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="State why this shift is being reopened (e.g. Inadvertent closure before last customer sale)..."
              className="w-full pos-input"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setReopenModalShift(null)}
              disabled={isSubmittingReopen}
              className="btn-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmittingReopen}
              className="btn-delete flex items-center space-x-1"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>{isSubmittingReopen ? 'Reopening...' : 'Confirm Reopen Shift'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Admin Cash Count Correction Modal */}
      <Modal
        isOpen={!!correctModalShift}
        onClose={() => setCorrectModalShift(null)}
        title={`Adjust Closing Cash Count: ${correctModalShift?.shift_no || ''}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleExecuteAdminCorrect} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-400">
            Modify the cashier's recorded physical drawer cash count. The discrepancy variance will be automatically recalculated and audited.
          </p>

          <div className="bg-slate-50 dark:bg-surface-inset-dark p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Expected System Cash:</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">
                {currency} {(correctModalShift?.expected_cash || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Originally Recorded Count:</span>
              <span className="font-mono text-slate-900 dark:text-white">
                {currency} {(correctModalShift?.closing_cash || 0).toFixed(2)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
              Corrected Physical Cash Count ({currency}) *
            </label>
            <input
              type="number"
              min="0"
              step="any"
              required
              value={correctedCash}
              onChange={(e) => setCorrectedCash(parseFloat(e.target.value) || 0)}
              className="w-full pos-input font-mono font-bold"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
              Audit Justification *
            </label>
            <input
              type="text"
              required
              value={correctReason}
              onChange={(e) => setCorrectReason(e.target.value)}
              placeholder="e.g. Recounted by manager; 500 bill was found under drawer"
              className="w-full pos-input"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setCorrectModalShift(null)}
              disabled={isSubmittingCorrect}
              className="btn-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmittingCorrect}
              className="btn-save flex items-center space-x-1"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{isSubmittingCorrect ? 'Saving...' : 'Apply Cash Adjustment'}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
