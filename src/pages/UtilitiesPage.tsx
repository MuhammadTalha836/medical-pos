import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { useAuthStore } from '../store/useAuthStore';
import { SystemSettings } from '../types';
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Layers,
  Sparkles,
  Calendar
} from 'lucide-react';

interface UtilitiesPageProps {
  settings?: SystemSettings | null;
  onRefreshSettings?: () => void;
}

export const UtilitiesPage: React.FC<UtilitiesPageProps> = ({ settings }) => {
  const { user } = useAuthStore();
  const [backups, setBackups] = useState<any>({ records: [], diskFiles: [] });
  const [loading, setLoading] = useState(false);
  const [customBackupDir, setCustomBackupDir] = useState('./backups');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Stock Zero utility state
  const [stockZeroCompanyId, setStockZeroCompanyId] = useState('');
  const [stockZeroConfirmText, setStockZeroConfirmText] = useState('');
  const [companies, setCompanies] = useState<any[]>([]);

  // Shift closing state
  const [openingCash, setOpeningCash] = useState(5000);
  const [actualCash, setActualCash] = useState(5000);
  const [closingNotes, setClosingNotes] = useState('');
  const [closingStats, setClosingStats] = useState<any>(null);

  const currency = settings?.currency_symbol || 'Rs.';

  const loadData = async () => {
    try {
      setLoading(true);
      const [bkList, compList, stats] = await Promise.all([
        api.getBackupList(),
        api.getCompanies(),
        api.getDashboardStats()
      ]);
      setBackups(bkList);
      setCompanies(compList);
      setClosingStats(stats);
    } catch (err) {
      console.error('Failed to load utilities data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateBackup = async () => {
    try {
      setLoading(true);
      setMessage(null);
      const res = await api.createBackup(customBackupDir.trim() || undefined);
      if (res.success) {
        setMessage({
          type: 'success',
          text: `Backup created: ${res.filename} (${(res.sizeBytes / 1024).toFixed(1)} KB) saved locally.`
        });
        loadData();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Backup failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreBackup = async (filepath: string, filename: string) => {
    if (!confirm(`CAUTION: Restoring will overwrite the current database with "${filename}". An automatic safety snapshot will be taken first.\n\nDo you want to proceed?`)) {
      return;
    }

    try {
      setLoading(true);
      setMessage(null);
      const res = await api.restoreBackup(filepath);
      if (res.success) {
        setMessage({ type: 'success', text: res.message });
        loadData();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Restore failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleOptimizeDatabase = async () => {
    try {
      setLoading(true);
      setMessage(null);
      const res = await api.optimizeDatabase();
      if (res.success) {
        setMessage({
          type: 'success',
          text: `${res.message} File size: ${(res.sizeBefore / 1024).toFixed(1)} KB -> ${(res.sizeAfter / 1024).toFixed(1)} KB.`
        });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Optimization failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteStockZero = async () => {
    if (stockZeroConfirmText !== 'RESET-ZERO-CONFIRM') {
      alert('Please enter the exact confirmation code: RESET-ZERO-CONFIRM');
      return;
    }

    try {
      setLoading(true);
      setMessage(null);
      const res = await api.resetStockZero({
        company_id: stockZeroCompanyId ? Number(stockZeroCompanyId) : undefined,
        confirmation_code: stockZeroConfirmText,
        user_id: user?.id,
        user_name: user?.full_name
      });
      if (res.success) {
        setStockZeroConfirmText('');
        setMessage({ type: 'success', text: res.message });
        loadData();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Stock zero reset failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDailyClosing = async () => {
    const todaySales = closingStats?.todaySales?.total_revenue || 0;
    const expected = openingCash + todaySales;
    const diff = actualCash - expected;

    try {
      setLoading(true);
      setMessage(null);
      const res = await api.recordDailyClosing({
        closing_date: new Date().toISOString().split('T')[0],
        opening_cash: openingCash,
        total_sales_cash: todaySales,
        total_sales_card: 0,
        total_sales_credit: 0,
        total_returns: 0,
        total_purchases_paid: 0,
        expenses_total: 0,
        expected_cash: expected,
        actual_cash: actualCash,
        difference: diff,
        notes: closingNotes,
        user_id: user?.id,
        user_name: user?.full_name
      });

      if (res.success) {
        setMessage({
          type: 'success',
          text: `${res.message} ${res.backup ? `(Automated backup saved: ${res.backup.filename})` : ''}`
        });
        loadData();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Daily closing failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-slate-100/60 dark:bg-[#0b0f19] text-slate-800 dark:text-slate-100 transition-colors duration-200">
      {/* Header */}
      <div className="pb-2 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Database Backup & System Utilities</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage local SQLite persistence, automated daily backups, database optimization, and auditing</p>
      </div>

      {message && (
        <div className={`flex items-center space-x-2 px-4 py-3 rounded-xl text-xs font-medium border ${
          message.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
            : 'bg-rose-50 dark:bg-rose-950/80 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 flex-shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Grid: Backup & Restore + System Optimization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card 1: One-Click Local SQLite Backup */}
        <div className="lg:col-span-2 bg-white dark:bg-[#101726] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Database className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">One-Click Local SQLite Backup</h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Creates an atomic, zero-downtime copy of the SQLite database (<code className="font-mono text-teal-600 dark:text-teal-300 font-bold">pharmacy.db</code>) with full referential integrity and timestamped filename.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-[#090d16] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Local Backup Folder Destination</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={customBackupDir}
                  onChange={(e) => setCustomBackupDir(e.target.value)}
                  placeholder="./backups"
                  className="flex-1 bg-white dark:bg-[#0c1220] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
                <button
                  onClick={handleCreateBackup}
                  disabled={loading}
                  className="px-5 py-2 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-500 hover:to-emerald-400 text-white font-bold text-xs rounded-xl shadow-lg shadow-teal-500/20 transition-all flex items-center space-x-1.5"
                >
                  <Download className="w-4 h-4" />
                  <span>Create Backup Now</span>
                </button>
              </div>
            </div>

            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center space-x-2 pt-1 border-t border-slate-200 dark:border-slate-800">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>Active Database: <strong className="text-slate-800 dark:text-slate-300 font-mono">./data/pharmacy.db</strong> (WAL Mode Active)</span>
            </div>
          </div>

          {/* Backup History Table */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">Available Local Backups</span>
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-[#0c1220] text-slate-600 dark:text-slate-400 font-semibold text-[10px] uppercase border-b border-slate-200 dark:border-slate-800 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Filename</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3 text-right">Size</th>
                    <th className="py-2 px-3 text-center">Restore Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {backups.diskFiles?.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-400 dark:text-slate-500">
                        No backup files found yet. Click "Create Backup Now" above.
                      </td>
                    </tr>
                  ) : (
                    backups.diskFiles?.map((file: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-850/40 transition-colors">
                        <td className="py-2 px-3 font-mono text-slate-900 dark:text-white text-[11px] truncate max-w-[200px]" title={file.path}>
                          {file.filename}
                        </td>
                        <td className="py-2 px-3 text-slate-500 dark:text-slate-400 text-[10px]">
                          {file.filename.includes('auto') ? 'Auto-Daily' : file.filename.includes('pre_restore') ? 'Pre-Restore' : 'Manual'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-300 text-[11px]">
                          {(file.sizeBytes / 1024).toFixed(1)} KB
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={() => handleRestoreBackup(file.path, file.filename)}
                            disabled={loading}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-950/70 dark:hover:bg-amber-900 dark:text-amber-300 dark:border-amber-800 rounded text-[10px] font-semibold transition-colors inline-flex items-center space-x-1"
                          >
                            <Upload className="w-3 h-3" />
                            <span>Restore</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Card 2: System Optimization & DB VACUUM */}
        <div className="bg-white dark:bg-[#101726] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Database Optimization</h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Executes SQLite <code className="font-mono text-teal-600 dark:text-teal-300 font-bold">VACUUM</code>, rebuilds search indexes, updates query planner statistics, and frees unused disk pages.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-[#090d16] border border-slate-200 dark:border-slate-800 p-4 rounded-xl space-y-3">
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
              <div className="flex justify-between">
                <span>SQLite Engine:</span>
                <span className="font-mono text-teal-600 dark:text-teal-300 font-bold">better-sqlite3 v11</span>
              </div>
              <div className="flex justify-between">
                <span>Journal Mode:</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">WAL (Write-Ahead)</span>
              </div>
              <div className="flex justify-between">
                <span>Foreign Keys:</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">ENFORCED</span>
              </div>
            </div>

            <button
              onClick={handleOptimizeDatabase}
              disabled={loading}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-teal-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-teal-300 dark:border-slate-700 font-bold text-xs rounded-xl transition-colors flex items-center justify-center space-x-2 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Optimize & Defragment Database</span>
            </button>
          </div>

          <div className="text-[11px] text-slate-400 dark:text-slate-500">
            Recommended to run periodically or after extensive bulk invoice deletion.
          </div>
        </div>
      </div>

      {/* Row 2: Daily Shift Closing & Stock Zero Utility */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Shift Closing */}
        <div className="bg-white dark:bg-[#101726] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Calendar className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Daily / Shift Closing</h2>
            </div>
            <span className="text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
              {new Date().toISOString().split('T')[0]}
            </span>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Reconcile drawer cash at end of shift. Triggering close records financial closing and automatically takes an automated local backup.
          </p>

          <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-[#090d16] p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Today's Sales Revenue:</span>
              <div className="text-lg font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                {currency} {Number(closingStats?.todaySales?.total_revenue || 0).toFixed(2)}
              </div>
            </div>

            <div>
              <span className="text-slate-500 dark:text-slate-400">Expected Total in Drawer:</span>
              <div className="text-lg font-bold font-mono text-teal-600 dark:text-teal-400 mt-0.5">
                {currency} {(openingCash + (closingStats?.todaySales?.total_revenue || 0)).toFixed(2)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Opening Cash ({currency})</label>
              <input
                type="number"
                value={openingCash}
                onChange={(e) => setOpeningCash(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-50 dark:bg-[#090d16] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Actual Cash Count ({currency})</label>
              <input
                type="number"
                value={actualCash}
                onChange={(e) => setActualCash(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-50 dark:bg-[#090d16] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono font-bold focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Shift Notes / Discrepancy Comments</label>
            <input
              type="text"
              value={closingNotes}
              onChange={(e) => setClosingNotes(e.target.value)}
              placeholder="e.g. Shift 1 closed normally. All cash accounted."
              className="w-full bg-slate-50 dark:bg-[#090d16] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <button
            onClick={handleSaveDailyClosing}
            disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-teal-600 to-emerald-500 hover:from-teal-500 hover:to-emerald-400 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-1.5"
          >
            <span>Record Shift Closing & Execute Auto Backup</span>
          </button>
        </div>

        {/* Stock Zero Audit Utility */}
        <div className="bg-white dark:bg-[#101726] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-rose-500 dark:text-rose-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Stock Zero Audit Reset</h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Administrative tool to reset on-hand stock quantities to zero for a chosen company or the entire catalog during physical inventory audits. All resets are logged to audit trails.
            </p>
          </div>

          <div className="bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 p-4 rounded-xl space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Target Company / Catalog</label>
              <select
                value={stockZeroCompanyId}
                onChange={(e) => setStockZeroCompanyId(e.target.value)}
                className="w-full bg-white dark:bg-[#090d16] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-rose-500"
              >
                <option value="">ALL PRODUCTS (Entire Inventory)</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-rose-700 dark:text-rose-300 mb-1">
                Type Confirmation Code: <strong className="font-mono text-slate-900 dark:text-white select-all">RESET-ZERO-CONFIRM</strong>
              </label>
              <input
                type="text"
                value={stockZeroConfirmText}
                onChange={(e) => setStockZeroConfirmText(e.target.value)}
                placeholder="RESET-ZERO-CONFIRM"
                className="w-full bg-white dark:bg-[#090d16] border border-rose-300 dark:border-rose-800 rounded-xl px-3 py-2 text-xs text-rose-800 dark:text-rose-200 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <button
              onClick={handleExecuteStockZero}
              disabled={stockZeroConfirmText !== 'RESET-ZERO-CONFIRM' || loading}
              className="w-full py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center space-x-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Execute Stock Zero Reset</span>
            </button>
          </div>

          <div className="text-[11px] text-slate-400 dark:text-slate-500">
            Protected action. Cannot be undone unless restored from a previous local backup.
          </div>
        </div>
      </div>
    </div>
  );
};
