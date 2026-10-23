import React, { useEffect, useState } from 'react';
import { api } from '../../services/apiService';
import { BackupStatus } from '../../types';
import { BACKUP_FREQUENCY_LABELS, describeBackupSchedule } from '../../utils/backup';
import { Database, ShieldCheck, AlertTriangle, Clock, PauseCircle } from 'lucide-react';

const REFRESH_MS = 60 * 1000;

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  const d = new Date(value);
  return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function getHealth(status: BackupStatus) {
  if (!status.enabled) {
    return { label: 'Off', icon: PauseCircle, cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700' };
  }
  if (status.last_status === 'failed') {
    return { label: 'Failed', icon: AlertTriangle, cls: 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800' };
  }
  if (!status.last_success_at || status.is_overdue) {
    return { label: status.last_success_at ? 'Overdue' : 'No backup yet', icon: Clock, cls: 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800' };
  }
  return { label: 'Healthy', icon: ShieldCheck, cls: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800' };
}

export const BackupHealthCard: React.FC = () => {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.getBackupStatus()
        .then(s => { if (!cancelled) { setStatus(s); setLoadError(null); } })
        .catch(err => { if (!cancelled) setLoadError(err.message); });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (!status) {
    return (
      <div className="card-premium p-4 text-xs text-slate-500 dark:text-slate-400 flex items-center space-x-2">
        <Database className="w-4 h-4" />
        <span>{loadError ? `Backup status unavailable: ${loadError}` : 'Loading backup status...'}</span>
      </div>
    );
  }

  const health = getHealth(status);
  const HealthIcon = health.icon;

  return (
    <div className="card-premium p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/80 border border-teal-200 dark:border-teal-800 text-teal-600 dark:text-teal-400">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">Backup Health</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {describeBackupSchedule(status.frequency, status.scheduled_time, status.weekly_day)}
            </p>
          </div>
        </div>
        <span className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full border text-[11px] font-bold ${health.cls}`}>
          <HealthIcon className="w-3.5 h-3.5" />
          <span>{health.label}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div>
          <span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">Last successful backup</span>
          <span className="font-semibold text-slate-900 dark:text-white">{formatDateTime(status.last_success_at)}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">Next scheduled run</span>
          <span className="font-semibold text-slate-900 dark:text-white">
            {status.enabled ? formatDateTime(status.next_run_at) : 'Automatic backups off'}
          </span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">Frequency</span>
          <span className="font-semibold text-slate-900 dark:text-white">{BACKUP_FREQUENCY_LABELS[status.frequency]}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">Verified backups kept</span>
          <span className="font-semibold font-mono text-slate-900 dark:text-white">
            {status.retained_count} / {status.retention_limit}
          </span>
        </div>
      </div>

      {status.last_status === 'failed' && status.last_error && (
        <div className="flex items-start space-x-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-[11px] text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="[overflow-wrap:anywhere]">
            Last backup attempt failed{status.last_attempt_at ? ` at ${formatDateTime(status.last_attempt_at)}` : ''}: {status.last_error}. The previous good backup is kept and a retry runs automatically.
          </span>
        </div>
      )}
    </div>
  );
};
