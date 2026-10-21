import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/apiService';
import { CashierShift, SystemSettings } from '../types';
import { useAuthStore } from '../store/useAuthStore';
import { useShiftStore } from '../store/useShiftStore';
import { Modal } from '../components/common/Modal';
import { ShiftThermalReceipt } from '../components/pos/ShiftThermalReceipt';
import {
  Timer,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Printer,
  Edit3,
  Unlock,
  ShieldAlert,
  Download,
  RefreshCw,
  Clock,
  Users,
  TrendingDown,
  DollarSign,
  Calendar,
  ChevronDown,
  X,
  Receipt,
  RotateCcw,
  CreditCard
} from 'lucide-react';

interface ShiftsAdminPageProps {
  settings?: SystemSettings | null;
}

export const ShiftsAdminPage: React.FC<ShiftsAdminPageProps> = ({ settings }) => {
  const { user, hasPermission } = useAuthStore();
  const { setStartModalOpen, setClosingModalOpen } = useShiftStore();

  const [shifts, setShifts] = useState<CashierShift[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [cashierFilter, setCashierFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Inspect modal
  const [inspectShiftId, setInspectShiftId] = useState<number | null>(null);
  const [inspectData, setInspectData] = useState<any | null>(null);
  const [loadingInspect, setLoadingInspect] = useState(false);
  const [inspectTab, setInspectTab] = useState<'sales' | 'returns' | 'payments'>('sales');

  // Print modal
  const [printShift, setPrintShift] = useState<CashierShift | null>(null);

  // Admin: Reopen modal
  const [reopenShift, setReopenShift] = useState<CashierShift | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [submittingReopen, setSubmittingReopen] = useState(false);

  // Admin: Correct cash modal
  const [correctShift, setCorrectShift] = useState<CashierShift | null>(null);
  const [correctedCash, setCorrectedCash] = useState<number>(0);
  const [correctReason, setCorrectReason] = useState('');
  const [submittingCorrect, setSubmittingCorrect] = useState(false);

  // Admin: Force-close modal
  const [forceCloseShift, setForceCloseShift] = useState<CashierShift | null>(null);
  const [forceCloseCash, setForceCloseCash] = useState<number>(0);
  const [forceCloseReason, setForceCloseReason] = useState('');
  const [forceCloseNotes, setForceCloseNotes] = useState('');
  const [submittingForceClose, setSubmittingForceClose] = useState(false);

  const currency = settings?.currency_symbol || 'Rs.';

  const showNotification = (text: string, type: 'success' | 'error') => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 6000);
  };

  const loadShifts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getShifts({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined
      });
      setShifts(data);
    } catch (err: any) {
      showNotification('Failed to load shifts: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  const handleInspect = async (shiftId: number) => {
    try {
      setInspectShiftId(shiftId);
      setInspectTab('sales');
      setLoadingInspect(true);
      const res = await api.getShiftDetails(shiftId);
      setInspectData(res);
    } catch (err: any) {
      showNotification('Failed to load shift details: ' + err.message, 'error');
      setInspectShiftId(null);
    } finally {
      setLoadingInspect(false);
    }
  };

  const handleAdminReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenShift || !user) return;
    if (!reopenReason.trim()) { alert('Administrative reason is required.'); return; }
    try {
      setSubmittingReopen(true);
      await api.reopenShiftByAdmin(reopenShift.id, {
        admin_id: user.id,
        admin_name: user.full_name || user.username,
        reason: reopenReason.trim()
      });
      showNotification(`Shift ${reopenShift.shift_no} reopened by Admin. Action audited.`, 'success');
      setReopenShift(null);
      setReopenReason('');
      loadShifts();
    } catch (err: any) {
      alert('Failed to reopen shift: ' + err.message);
    } finally {
      setSubmittingReopen(false);
    }
  };

  const handleAdminCorrect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctShift || !user) return;
    if (!correctReason.trim()) { alert('Audit justification is required.'); return; }
    try {
      setSubmittingCorrect(true);
      await api.correctShiftByAdmin(correctShift.id, {
        admin_id: user.id,
        admin_name: user.full_name || user.username,
        corrected_closing_cash: correctedCash,
        reason: correctReason.trim()
      });
      showNotification(`Cash count for ${correctShift.shift_no} corrected. Discrepancy recalculated.`, 'success');
      setCorrectShift(null);
      setCorrectReason('');
      loadShifts();
    } catch (err: any) {
      alert('Failed to correct cash: ' + err.message);
    } finally {
      setSubmittingCorrect(false);
    }
  };

  const handleAdminForceClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forceCloseShift || !user) return;
    if (!forceCloseReason.trim()) { alert('Administrative reason is required to force-close a shift.'); return; }
    try {
      setSubmittingForceClose(true);
      await api.adminForceCloseShift(forceCloseShift.id, {
        admin_id: user.id,
        admin_name: user.full_name || user.username,
        actual_cash: forceCloseCash,
        reason: forceCloseReason.trim(),
        notes: forceCloseNotes.trim() || undefined
      });
      showNotification(`Shift ${forceCloseShift.shift_no} has been force-closed by admin.`, 'success');
      setForceCloseShift(null);
      setForceCloseReason('');
      setForceCloseNotes('');
      loadShifts();
    } catch (err: any) {
      alert('Failed to force-close shift: ' + err.message);
    } finally {
      setSubmittingForceClose(false);
    }
  };

  const handleExportCSV = () => {
    const headers = [
      'Shift #', 'Cashier Name', 'Cashier ID', 'Start Time', 'Close Time',
      'Duration (min)', 'Opening Cash', 'Total Sales', 'Cash Sales', 'Card Sales',
      'Credit Sales', 'Returns', 'Expected Cash', 'Actual Cash', 'Variance', 'Status'
    ];
    const rows = filteredShifts.map(s => [
      s.shift_no,
      s.user_name,
      s.user_id,
      s.start_time ? new Date(s.start_time).toLocaleString() : '',
      s.end_time ? new Date(s.end_time).toLocaleString() : 'Active',
      s.duration_minutes ?? '',
      s.opening_cash.toFixed(2),
      (s.total_sales_amount || 0).toFixed(2),
      (s.total_cash_sales || 0).toFixed(2),
      (s.total_card_sales || 0).toFixed(2),
      (s.total_credit_sales || 0).toFixed(2),
      (s.total_returns_amount || 0).toFixed(2),
      (s.expected_cash || 0).toFixed(2),
      s.closing_cash !== null && s.closing_cash !== undefined ? s.closing_cash.toFixed(2) : '',
      s.cash_difference !== null && s.cash_difference !== undefined ? s.cash_difference.toFixed(2) : '',
      s.status.toUpperCase()
    ]);
    const csvContent = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shift-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cashiersList = React.useMemo(() => {
    const map = new Map<number, { id: number; name: string }>();
    shifts.forEach(s => {
      if (s.user_id && !map.has(s.user_id)) {
        map.set(s.user_id, { id: s.user_id, name: s.user_name || `User #${s.user_id}` });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [shifts]);

  const filteredShifts = shifts.filter(s => {
    if (cashierFilter !== 'all' && s.user_id !== Number(cashierFilter)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.shift_no?.toLowerCase().includes(q) ||
      s.user_name?.toLowerCase().includes(q) ||
      String(s.user_id).includes(q)
    );
  });

  // KPI calculations
  const activeShifts = shifts.filter(s => s.status === 'open');
  const closedShifts = shifts.filter(s => s.status === 'closed');
  const flaggedShifts = closedShifts.filter(s => s.cash_difference !== null && Math.abs(s.cash_difference || 0) > 0.01);
  const totalVariance = flaggedShifts.reduce((sum, s) => sum + Math.abs(s.cash_difference || 0), 0);

  const formatDuration = (minutes?: number | null) => {
    if (!minutes) return '\u2014';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const getVarianceBadge = (diff: number | null | undefined, status: string) => {
    if (status === 'open') return <span className="text-[10px] text-slate-400 italic">Pending</span>;
    if (diff === null || diff === undefined) return <span className="text-[10px] text-slate-400">\u2014</span>;
    if (Math.abs(diff) < 0.01) return <span className="badge-success font-mono text-[10px] font-bold">BALANCED</span>;
    if (diff > 0) return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
        +{diff.toFixed(2)} EXCESS
      </span>
    );
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
        {diff.toFixed(2)} SHORT
      </span>
    );
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
    setStatusFilter('all');
    setCashierFilter('all');
  };
  const hasFilters = !!(dateFrom || dateTo || searchQuery || statusFilter !== 'all' || cashierFilter !== 'all');

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-slate-50 dark:bg-[#0a0e17] text-slate-800 dark:text-slate-100 transition-colors duration-200">

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
              <Timer className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Cashier Shift Management
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 pl-11">
            Monitor working hours, review cash reconciliation, and investigate discrepancies across all cashiers
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={loadShifts}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#162032] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={handleExportCSV}
            disabled={filteredShifts.length === 0}
            className="flex items-center space-x-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div className={`flex items-center space-x-2 px-4 py-3 rounded-xl text-xs font-medium border ${
          notification.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300'
            : 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800/80 text-rose-800 dark:text-rose-300'
        }`}>
          {notification.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-600 dark:text-rose-400" />}
          <span>{notification.text}</span>
        </div>
      )}

      {/* KPI Summary Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Clock, color: 'emerald', value: activeShifts.length, label: 'Active Shifts Now' },
          { icon: Users, color: 'teal', value: closedShifts.length, label: 'Closed Shifts (Filtered)' },
          { icon: TrendingDown, color: 'amber', value: flaggedShifts.length, label: 'Variances Flagged' },
          { icon: DollarSign, color: totalVariance > 0 ? 'rose' : 'slate', value: `${currency} ${totalVariance.toFixed(0)}`, label: 'Total Cash Discrepancy' }
        ].map((kpi, i) => {
          const Icon = kpi.icon;
          const colorMap: Record<string, string> = {
            emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
            teal: 'bg-teal-500/10 border-teal-500/20 text-teal-600 dark:text-teal-400',
            amber: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
            rose: 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400',
            slate: 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
          };
          return (
            <div key={i} className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center space-x-3">
              <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${colorMap[kpi.color]}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <div className={`text-2xl font-extrabold tabular-nums ${kpi.color === 'rose' && totalVariance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                  {kpi.value}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{kpi.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
            <Filter className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>Filters</span>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
            <input
              id="shift-search"
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Shift # or cashier..."
              className="pl-8 pr-3 py-1.5 w-48 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <div className="relative">
            <select
              id="shift-cashier-filter"
              value={cashierFilter}
              onChange={e => setCashierFilter(e.target.value)}
              className="appearance-none pl-3 pr-7 py-1.5 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="all">All Cashiers</option>
              {cashiersList.map(c => (
                <option key={c.id} value={String(c.id)}>{c.name} (ID #{c.id})</option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 absolute right-2 top-2.5 text-slate-400 pointer-events-none" />
          </div>
          <div className="relative">
            <select
              id="shift-status-filter"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="appearance-none pl-3 pr-7 py-1.5 bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="all">All Statuses</option>
              <option value="open">Active Only</option>
              <option value="closed">Closed Only</option>
            </select>
            <ChevronDown className="w-3 h-3 absolute right-2 top-2.5 text-slate-400 pointer-events-none" />
          </div>
          <div className="flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Calendar className="w-3.5 h-3.5" />
            <span>From:</span>
            <input id="shift-date-from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-700 rounded-xl px-2 py-1 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500" />
            <span>To:</span>
            <input id="shift-date-to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-700 rounded-xl px-2 py-1 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500" />
          </div>
          {hasFilters && (
            <button onClick={clearFilters}
              className="flex items-center space-x-1 px-2.5 py-1.5 bg-slate-100 dark:bg-[#162032] border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
              <X className="w-3 h-3" /><span>Clear</span>
            </button>
          )}
          <span className="ml-auto text-[11px] text-slate-400 font-mono">
            {filteredShifts.length} of {shifts.length} shift{shifts.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Shifts Table */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[1100px]">
            <thead className="bg-slate-100 dark:bg-[#0d131f] text-slate-600 dark:text-slate-400 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-3">Shift #</th>
                <th className="py-3 px-3">Cashier</th>
                <th className="py-3 px-3">Start Time</th>
                <th className="py-3 px-3">Close Time</th>
                <th className="py-3 px-3">Duration</th>
                <th className="py-3 px-3 text-right">Opening</th>
                <th className="py-3 px-3 text-right">Total Sales</th>
                <th className="py-3 px-3 text-right">Cash Sales</th>
                <th className="py-3 px-3 text-right">Card</th>
                <th className="py-3 px-3 text-right">Credit</th>
                <th className="py-3 px-3 text-right">Expected</th>
                <th className="py-3 px-3 text-right">Actual</th>
                <th className="py-3 px-3 text-center">Variance</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={15} className="py-16 text-center text-slate-500 dark:text-slate-400">
                    <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <span className="text-xs">Loading shifts...</span>
                  </td>
                </tr>
              ) : filteredShifts.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-16 text-center text-slate-400 dark:text-slate-500">
                    <Timer className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-700 stroke-[1.5]" />
                    <div className="font-semibold text-sm text-slate-600 dark:text-slate-400 mb-1">No shifts found</div>
                    <div className="text-xs">Try adjusting your filters or date range.</div>
                  </td>
                </tr>
              ) : (
                filteredShifts.map((shift, idx) => (
                  <tr key={shift.id}
                    className={`hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-[#0d131f]/40'}`}
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">{shift.shift_no}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{shift.user_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">ID #{shift.user_id}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 font-mono text-[11px] whitespace-nowrap">
                      {new Date(shift.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                      {shift.end_time ? (
                        <span className="text-slate-500 dark:text-slate-400">
                          {new Date(shift.end_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : (
                        <span className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 font-bold">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>Active Now</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-teal-700 dark:text-teal-300 font-semibold whitespace-nowrap">
                      {shift.status === 'open' ? 'In Progress' : formatDuration(shift.duration_minutes)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {currency} {shift.opening_cash.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {currency} {(shift.total_sales_amount || 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">
                      {currency} {(shift.total_cash_sales || 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-blue-700 dark:text-blue-400 whitespace-nowrap">
                      {currency} {(shift.total_card_sales || 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-700 dark:text-amber-400 whitespace-nowrap">
                      {currency} {(shift.total_credit_sales || 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-teal-700 dark:text-teal-300 font-bold whitespace-nowrap">
                      {currency} {(shift.expected_cash || 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      {shift.closing_cash !== null && shift.closing_cash !== undefined
                        ? `${currency} ${shift.closing_cash.toFixed(2)}` : '\u2014'}
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {getVarianceBadge(shift.cash_difference, shift.status)}
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <span className={shift.status === 'open' ? 'badge-success' : 'badge-warning'}>
                        {shift.status === 'open' ? 'ACTIVE' : 'CLOSED'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center space-x-1">
                        <button id={`btn-inspect-shift-${shift.id}`} onClick={() => handleInspect(shift.id)}
                          className="p-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/60 dark:hover:bg-teal-900/60 text-teal-700 dark:text-teal-300 transition-colors"
                          title="View Shift Transactions">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button id={`btn-print-shift-${shift.id}`} onClick={() => setPrintShift(shift)}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                          title="Print Reconciliation Slip">
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        {hasPermission('can_manage_shifts') && shift.status === 'closed' && (
                          <button id={`btn-correct-shift-${shift.id}`}
                            onClick={() => { setCorrectShift(shift); setCorrectedCash(shift.closing_cash || 0); setCorrectReason(''); }}
                            className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 transition-colors"
                            title="Admin: Correct Drawer Cash Count">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {hasPermission('can_manage_shifts') && shift.status === 'closed' && (
                          <button id={`btn-reopen-shift-${shift.id}`}
                            onClick={() => { setReopenShift(shift); setReopenReason(''); }}
                            className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 transition-colors"
                            title="Admin: Emergency Reopen Shift">
                            <Unlock className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {hasPermission('can_manage_shifts') && shift.status === 'open' && (
                          <button id={`btn-force-close-shift-${shift.id}`}
                            onClick={() => { setForceCloseShift(shift); setForceCloseCash(0); setForceCloseReason(''); setForceCloseNotes(''); }}
                            className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 transition-colors"
                            title="Admin: Force-Close Active Shift">
                            <ShieldAlert className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filteredShifts.length > 0 && (
          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-[#0d131f]/40 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Showing <span className="font-bold text-slate-700 dark:text-slate-300">{filteredShifts.length}</span> shifts{hasFilters && <> (filtered)</>}</span>
            <span className="font-mono">Total Sales: <span className="font-bold text-teal-700 dark:text-teal-300">
              {currency} {filteredShifts.reduce((sum, s) => sum + (s.total_sales_amount || 0), 0).toFixed(2)}
            </span></span>
          </div>
        )}
      </div>

      {/* Inspect: Shift Detail Modal */}
      <Modal isOpen={!!inspectShiftId} onClose={() => { setInspectShiftId(null); setInspectData(null); }}
        title={`Shift Detail: ${inspectData?.shift?.shift_no || 'Loading...'}`} maxWidth="max-w-4xl">
        {loadingInspect ? (
          <div className="py-16 text-center text-slate-500">
            <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <span className="text-xs">Loading transaction details...</span>
          </div>
        ) : inspectData ? (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-[#0d131f] p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              {[
                { label: 'Cashier', value: inspectData.shift?.user_name, mono: false },
                { label: 'Opening Float', value: `${currency} ${(inspectData.shift?.opening_cash || 0).toFixed(2)}`, mono: true },
                { label: 'Total Sales', value: `${currency} ${(inspectData.shift?.total_sales_amount || 0).toFixed(2)}`, mono: true },
                { label: 'Cash Sales', value: `${currency} ${(inspectData.shift?.total_cash_sales || 0).toFixed(2)}`, mono: true },
                { label: 'Card Sales', value: `${currency} ${(inspectData.shift?.total_card_sales || 0).toFixed(2)}`, mono: true },
                { label: 'Credit Sales', value: `${currency} ${(inspectData.shift?.total_credit_sales || 0).toFixed(2)}`, mono: true },
                { label: 'Expected Cash', value: `${currency} ${(inspectData.shift?.expected_cash || 0).toFixed(2)}`, mono: true },
                {
                  label: 'Actual / Variance',
                  value: inspectData.shift?.closing_cash !== null && inspectData.shift?.closing_cash !== undefined
                    ? `${currency} ${inspectData.shift.closing_cash.toFixed(2)} (${(inspectData.shift.cash_difference || 0) >= 0 ? '+' : ''}${(inspectData.shift.cash_difference || 0).toFixed(2)})`
                    : 'Active',
                  mono: true
                }
              ].map((kpi, i) => (
                <div key={i}>
                  <span className="text-[10px] text-slate-400 block mb-0.5">{kpi.label}</span>
                  <span className={`font-bold text-slate-900 dark:text-white ${kpi.mono ? 'font-mono' : ''}`}>{kpi.value}</span>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex items-center space-x-1 p-1 bg-slate-100 dark:bg-[#0d131f] rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold w-fit">
              {([
                { id: 'sales' as const, label: 'Sales', Icon: Receipt, count: inspectData.sales?.length },
                { id: 'returns' as const, label: 'Returns', Icon: RotateCcw, count: inspectData.returns?.length },
                { id: 'payments' as const, label: 'Khata Payments', Icon: CreditCard, count: inspectData.payments?.length }
              ]).map(tab => (
                <button key={tab.id} onClick={() => setInspectTab(tab.id)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg transition-all ${inspectTab === tab.id
                    ? 'bg-white dark:bg-[#1a2436] text-teal-700 dark:text-teal-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}>
                  <tab.Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  <span className="px-1 py-0.5 rounded text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono">{tab.count || 0}</span>
                </button>
              ))}
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
              {inspectTab === 'sales' && (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-[#0d131f] text-slate-600 dark:text-slate-400 text-[10px] uppercase sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Invoice #</th><th className="py-2 px-3">Customer</th>
                      <th className="py-2 px-3">Time</th><th className="py-2 px-3">Payment</th>
                      <th className="py-2 px-3 text-right">Net Total</th><th className="py-2 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {!inspectData.sales?.length ? (
                      <tr><td colSpan={6} className="py-6 text-center text-slate-400 text-[11px]">No sales recorded in this shift.</td></tr>
                    ) : inspectData.sales.map((sale: any) => (
                      <tr key={sale.id} className="hover:bg-slate-50 dark:hover:bg-[#162032]">
                        <td className="py-1.5 px-3 font-mono font-bold text-slate-900 dark:text-white">{sale.invoice_no}</td>
                        <td className="py-1.5 px-3 text-slate-700 dark:text-slate-300">{sale.customer_name}</td>
                        <td className="py-1.5 px-3 text-slate-500 font-mono text-[11px]">{new Date(sale.sale_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="py-1.5 px-3"><span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono uppercase">{sale.payment_type}</span></td>
                        <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">{currency} {Number(sale.net_total).toFixed(2)}</td>
                        <td className="py-1.5 px-3 text-center"><span className={sale.status === 'completed' ? 'badge-success' : sale.status === 'returned' ? 'badge-danger' : 'badge-warning'}>{sale.status?.toUpperCase()}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {inspectTab === 'returns' && (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-[#0d131f] text-slate-600 dark:text-slate-400 text-[10px] uppercase sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Return #</th><th className="py-2 px-3">Orig. Invoice</th>
                      <th className="py-2 px-3">Customer</th><th className="py-2 px-3">Reason</th>
                      <th className="py-2 px-3 text-right">Refund</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {!inspectData.returns?.length ? (
                      <tr><td colSpan={5} className="py-6 text-center text-slate-400 text-[11px]">No returns processed in this shift.</td></tr>
                    ) : inspectData.returns.map((ret: any) => (
                      <tr key={ret.id} className="hover:bg-slate-50 dark:hover:bg-[#162032]">
                        <td className="py-1.5 px-3 font-mono font-bold text-slate-900 dark:text-white">{ret.return_no}</td>
                        <td className="py-1.5 px-3 font-mono text-slate-500">{ret.original_invoice_no}</td>
                        <td className="py-1.5 px-3 text-slate-700 dark:text-slate-300">{ret.customer_name}</td>
                        <td className="py-1.5 px-3 text-slate-500 italic">{ret.reason || '\u2014'}</td>
                        <td className="py-1.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">-{currency} {Number(ret.refund_amount).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {inspectTab === 'payments' && (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-[#0d131f] text-slate-600 dark:text-slate-400 text-[10px] uppercase sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Method</th><th className="py-2 px-3">Notes</th>
                      <th className="py-2 px-3">Time</th><th className="py-2 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {!inspectData.payments?.length ? (
                      <tr><td colSpan={4} className="py-6 text-center text-slate-400 text-[11px]">No khata payments collected in this shift.</td></tr>
                    ) : inspectData.payments.map((p: any) => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-[#162032]">
                        <td className="py-1.5 px-3 font-mono font-bold text-slate-900 dark:text-white uppercase">{p.payment_method}</td>
                        <td className="py-1.5 px-3 text-slate-500 italic">{p.notes || 'Khata Recovery'}</td>
                        <td className="py-1.5 px-3 text-slate-500 font-mono text-[11px]">{new Date(p.payment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="py-1.5 px-3 text-right font-mono font-bold text-teal-600 dark:text-teal-400">+{currency} {Number(p.amount).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
              <button onClick={() => { setInspectShiftId(null); setInspectData(null); }} className="btn-cancel px-4 py-2">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Print Thermal Slip Modal */}
      <Modal isOpen={!!printShift} onClose={() => setPrintShift(null)} title={`Slip: ${printShift?.shift_no || ''}`} maxWidth="max-w-md">
        {printShift && <ShiftThermalReceipt shift={printShift} settings={settings} onClose={() => setPrintShift(null)} />}
      </Modal>

      {/* Admin: Correct Cash Count Modal */}
      <Modal isOpen={!!correctShift} onClose={() => setCorrectShift(null)}
        title={`Correct Cash Count: ${correctShift?.shift_no || ''}`} maxWidth="max-w-md">
        <form onSubmit={handleAdminCorrect} className="space-y-4 text-xs">
          <div className="bg-slate-50 dark:bg-[#0d131f] p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">System Expected Cash:</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">{currency} {(correctShift?.expected_cash || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Originally Recorded:</span>
              <span className="font-mono text-slate-700 dark:text-slate-300">{currency} {(correctShift?.closing_cash || 0).toFixed(2)}</span>
            </div>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Corrected Cash Count ({currency}) *</label>
            <input type="number" min="0" step="any" required value={correctedCash}
              onChange={e => setCorrectedCash(parseFloat(e.target.value) || 0)} className="w-full pos-input font-mono font-bold" />
            <div className="mt-1 text-[11px] text-slate-400">
              New variance: <span className={`font-mono font-bold ${(correctedCash - (correctShift?.expected_cash || 0)) === 0 ? 'text-emerald-600' : (correctedCash - (correctShift?.expected_cash || 0)) > 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                {(correctedCash - (correctShift?.expected_cash || 0)) >= 0 ? '+' : ''}{currency} {(correctedCash - (correctShift?.expected_cash || 0)).toFixed(2)}
              </span>
            </div>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Audit Justification *</label>
            <input type="text" required value={correctReason} onChange={e => setCorrectReason(e.target.value)}
              placeholder="e.g. Recounted by manager; 500 bill found under drawer" className="w-full pos-input" />
          </div>
          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={() => setCorrectShift(null)} disabled={submittingCorrect} className="btn-cancel">Cancel</button>
            <button type="submit" disabled={submittingCorrect} className="btn-save flex items-center space-x-1.5">
              <Edit3 className="w-3.5 h-3.5" /><span>{submittingCorrect ? 'Saving...' : 'Apply Correction'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Admin: Reopen Closed Shift Modal */}
      <Modal isOpen={!!reopenShift} onClose={() => setReopenShift(null)}
        title={`Admin Reopen: ${reopenShift?.shift_no || ''}`} maxWidth="max-w-md">
        <form onSubmit={handleAdminReopen} className="space-y-4 text-xs">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-900/60 rounded-xl text-indigo-800 dark:text-indigo-300 space-y-1">
            <div className="flex items-center space-x-1.5 font-bold"><Unlock className="w-4 h-4 flex-shrink-0" /><span>Administrative Reopen Override</span></div>
            <p className="text-[11px] leading-relaxed">Reopening unlocks the cash register for that cashier. Permanently logged to audit trail.</p>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Mandatory Reason *</label>
            <textarea required rows={3} value={reopenReason} onChange={e => setReopenReason(e.target.value)}
              placeholder="State why this shift is being reopened..." className="w-full pos-input" />
          </div>
          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={() => setReopenShift(null)} disabled={submittingReopen} className="btn-cancel">Cancel</button>
            <button type="submit" disabled={submittingReopen} className="btn-save flex items-center space-x-1.5">
              <Unlock className="w-3.5 h-3.5" /><span>{submittingReopen ? 'Reopening...' : 'Confirm Reopen'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Admin: Force-Close Active Shift Modal */}
      <Modal isOpen={!!forceCloseShift} onClose={() => setForceCloseShift(null)}
        title={`Force-Close Shift: ${forceCloseShift?.shift_no || ''}`} maxWidth="max-w-md">
        <form onSubmit={handleAdminForceClose} className="space-y-4 text-xs">
          <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 rounded-xl text-rose-800 dark:text-rose-300 space-y-1">
            <div className="flex items-center space-x-1.5 font-bold"><ShieldAlert className="w-4 h-4 flex-shrink-0" /><span>Admin Force-Close Override</span></div>
            <p className="text-[11px] leading-relaxed">
              Immediately closes and locks the active shift for <strong>{forceCloseShift?.user_name}</strong>. Use only when cashier is unavailable. Permanently audited.
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-[#0d131f] p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="flex justify-between"><span className="text-slate-500">Cashier:</span><span className="font-bold text-slate-900 dark:text-white">{forceCloseShift?.user_name}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Shift Started:</span><span className="font-mono text-slate-700 dark:text-slate-300">{forceCloseShift?.start_time ? new Date(forceCloseShift.start_time).toLocaleString() : '\u2014'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Sales Count:</span><span className="font-mono text-slate-700 dark:text-slate-300">{forceCloseShift?.total_sales_count || 0} invoices</span></div>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Physical Cash Count ({currency}) *</label>
            <input type="number" min="0" step="any" required value={forceCloseCash}
              onChange={e => setForceCloseCash(parseFloat(e.target.value) || 0)}
              className="w-full pos-input font-mono font-bold" placeholder="Enter actual cash in drawer" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Admin Reason *</label>
            <textarea required rows={2} value={forceCloseReason} onChange={e => setForceCloseReason(e.target.value)}
              placeholder="e.g. Cashier left without closing; manager force-closing at end of day..." className="w-full pos-input" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Additional Notes (optional)</label>
            <input type="text" value={forceCloseNotes} onChange={e => setForceCloseNotes(e.target.value)}
              placeholder="Any additional context..." className="w-full pos-input" />
          </div>
          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={() => setForceCloseShift(null)} disabled={submittingForceClose} className="btn-cancel">Cancel</button>
            <button type="submit" disabled={submittingForceClose} className="btn-delete flex items-center space-x-1.5">
              <ShieldAlert className="w-3.5 h-3.5" /><span>{submittingForceClose ? 'Force-Closing...' : 'Confirm Force-Close'}</span>
            </button>
          </div>
        </form>
      </Modal>

    </div>
  );
};
