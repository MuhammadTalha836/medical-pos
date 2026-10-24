import React, { useCallback, useState } from 'react';
import { AlertTriangle, CloudUpload, Unplug } from 'lucide-react';
import { api } from '../../services/apiService';
import { CloudBackupStatus } from '../../types';
import { GoogleDriveConnect } from './GoogleDriveConnect';

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  const d = new Date(value);
  return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// Developer view of online backups: the Google Drive account, last upload, waiting uploads and errors
export const CloudBackupCard: React.FC = () => {
  const [status, setStatus] = useState<CloudBackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [version, setVersion] = useState(0);

  const getStatus = useCallback(async () => {
    const next = await api.getCloudBackupStatus();
    setStatus(next);
    return next;
  }, []);
  const startConnect = useCallback(() => api.connectCloudBackup(), []);

  const run = async (action: () => Promise<string>) => {
    try {
      setBusy(true);
      setMessage(null);
      setMessage({ type: 'success', text: await action() });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'The action failed' });
    } finally {
      setBusy(false);
      setVersion(v => v + 1);
    }
  };

  const uploadNow = () => run(async () => {
    const res = await api.uploadCloudBackupNow();
    return res.status === 'uploaded'
      ? `Uploaded ${res.filename} to Google Drive.${res.pruned ? ` ${res.pruned} old online backup(s) removed.` : ''}`
      : res.reason;
  });

  const disconnect = () => {
    if (!confirm('Disconnect Google Drive? Online backups stop until it is connected again. Backups already in Drive are kept.')) return;
    void run(async () => (await api.disconnectCloudBackup()).message);
  };

  return (
    <div className="space-y-3">
      {/* Remounted after Upload now / Disconnect so it reads the status again */}
      <GoogleDriveConnect
        key={version}
        getStatus={getStatus}
        startConnect={startConnect}
        connectedActions={
          <button type="button" onClick={disconnect} disabled={busy} className="btn-secondary btn-sm">
            <Unplug className="w-4 h-4" />
            <span>Disconnect</span>
          </button>
        }
      />

      {status?.connected && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="block text-2xs font-semibold text-slate-500 dark:text-slate-400">Last online backup</span>
            <span className="font-semibold text-slate-900 dark:text-white">{formatDateTime(status.last_upload_at)}</span>
          </div>
          <div>
            <span className="block text-2xs font-semibold text-slate-500 dark:text-slate-400">Waiting to upload</span>
            <span className="font-semibold text-slate-900 dark:text-white">
              {status.pending_count === 0 ? 'Nothing' : `${status.pending_count} backup(s)`}
              {status.next_retry_at ? `, retry at ${formatDateTime(status.next_retry_at)}` : ''}
            </span>
          </div>
          <div className="flex sm:justify-end items-start">
            <button type="button" onClick={() => void uploadNow()} disabled={busy || status.pending_count === 0} className="btn-secondary btn-sm">
              <CloudUpload className="w-4 h-4" />
              <span>Upload now</span>
            </button>
          </div>
        </div>
      )}

      {status?.connected && status.last_error && (
        <p className="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span>Last upload attempt failed: {status.last_error}. The backup is safe on this computer and is uploaded automatically when possible.</span>
        </p>
      )}

      {message && (
        <p className={`text-xs font-semibold ${message.type === 'success' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
};
