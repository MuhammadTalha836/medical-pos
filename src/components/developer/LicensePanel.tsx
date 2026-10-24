import React, { useEffect, useState } from 'react';
import { api } from '../../services/apiService';
import { LicenseStatus } from '../../types';
import { BadgeCheck, CalendarClock, CalendarPlus, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

interface LicensePanelProps {
  onChanged?: () => void;
}

// Developer-only: view the Demo/Full license and extend it, restart it, or switch to Full
export const LicensePanel: React.FC<LicensePanelProps> = ({ onChanged }) => {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api.getLicenseStatus().then(setStatus).catch(err => setMessage({ ok: false, text: err.message }));

  useEffect(() => {
    load();
  }, []);

  const apply = async (data: Parameters<typeof api.updateLicense>[0], confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    if (data.action !== 'full' && (!Number.isInteger(data.demoDays) || data.demoDays < 1 || data.demoDays > 365)) {
      setMessage({ ok: false, text: 'Days must be a whole number from 1 to 365.' });
      return;
    }
    try {
      setBusy(true);
      setMessage(null);
      const res = await api.updateLicense(data);
      setStatus(res);
      setMessage({ ok: true, text: res.mode === 'full' ? 'License switched to Full.' : `Demo now ends ${new Date(res.expiresAt!).toLocaleString()}.` });
      onChanged?.();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || 'License update failed' });
    } finally {
      setBusy(false);
    }
  };

  const problem =
    status?.reason === 'tampered' ? 'The stored license failed its signature check (the database was edited). Set the license again.'
      : status?.reason === 'missing' ? 'No valid license is stored. Set Demo or Full below.'
        : null;

  return (
    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6 shadow-xs">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <CalendarClock className="w-5 h-5 text-purple-500" />
            <span>Demo / Full License</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            When a demo ends, Admin and Cashier cannot sign in. Data is kept. Only the Developer can extend it or activate Full.
          </p>
        </div>
        <button type="button" onClick={load} className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {status && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800">
            <span className="text-2xs font-bold text-slate-400">Mode</span>
            <div className="text-lg font-black text-slate-900 dark:text-white flex items-center space-x-2">
              {status.mode === 'full' ? <BadgeCheck className="w-5 h-5 text-emerald-500" /> : <CalendarClock className="w-5 h-5 text-amber-500" />}
              <span>{status.mode === 'full' ? 'Full' : 'Demo'}</span>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800">
            <span className="text-2xs font-bold text-slate-400">Days left</span>
            <div className={`text-lg font-black ${status.expired ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
              {status.mode === 'full' ? 'Unlimited' : status.expired ? 'Ended' : status.daysLeft}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800">
            <span className="text-2xs font-bold text-slate-400">Ends</span>
            <div className="text-sm font-bold text-slate-900 dark:text-white">
              {status.expiresAt ? new Date(status.expiresAt).toLocaleString() : '—'}
            </div>
          </div>
        </div>
      )}

      {problem && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center space-x-2 text-xs font-semibold text-rose-600 dark:text-rose-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{problem}</span>
        </div>
      )}
      {message && (
        <div className={`p-3 rounded-xl flex items-center space-x-2 text-xs font-semibold ${message.ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
          {message.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="w-40">
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Days</label>
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Math.floor(Number(e.target.value)))}
            className="field-input w-full"
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => apply({ action: 'extend', demoDays: days }, `Extend the demo by ${days} day(s)?`)}
          className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl disabled:opacity-50"
        >
          <CalendarPlus className="w-4 h-4" />
          <span>Extend demo</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => apply({ action: 'demo', demoDays: days }, `Start a new demo of ${days} day(s) from today? This replaces the current license.`)}
          className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold rounded-xl disabled:opacity-50"
        >
          <CalendarClock className="w-4 h-4" />
          <span>New demo from today</span>
        </button>
        <button
          type="button"
          disabled={busy || status?.mode === 'full'}
          onClick={() => apply({ action: 'full' }, 'Activate the Full version for this pharmacy? The demo time limit will be removed.')}
          className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-50"
        >
          <BadgeCheck className="w-4 h-4" />
          <span>Activate Full</span>
        </button>
      </div>
    </div>
  );
};
