import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Cloud, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { CloudConnectProgress } from '../../types';

const POLL_MS = 2000;

export interface DriveConnectionState {
  connected: boolean;
  account_email: string | null;
  connect: CloudConnectProgress;
}

interface GoogleDriveConnectProps {
  getStatus: () => Promise<DriveConnectionState>;
  startConnect: () => Promise<{ authUrl: string }>;
  /** Called after the status changes (connected, failed, refreshed) */
  onStatus?: (state: DriveConnectionState) => void;
  /** Extra controls shown when connected (e.g. Disconnect) */
  connectedActions?: React.ReactNode;
}

// Connects the owner's Google Drive: opens Google's sign-in page in the browser and waits for the result
export const GoogleDriveConnect: React.FC<GoogleDriveConnectProps> = ({ getStatus, startConnect, onStatus, connectedActions }) => {
  const [state, setState] = useState<DriveConnectionState | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const refresh = useCallback(async () => {
    try {
      const next = await getStatus();
      setState(next);
      onStatusRef.current?.(next);
      if (next.connect.status === 'waiting') {
        timer.current = setTimeout(() => void refresh(), POLL_MS);
      } else {
        setAuthUrl(null);
        if (next.connect.status === 'failed') setError(next.connect.error);
      }
    } catch (err: any) {
      setError(err.message || 'Could not read the Google Drive status');
    }
  }, [getStatus]);

  useEffect(() => {
    void refresh();
    return () => clearTimeout(timer.current);
  }, [refresh]);

  const connect = async () => {
    try {
      setStarting(true);
      setError(null);
      clearTimeout(timer.current);
      const { authUrl: url } = await startConnect();
      setAuthUrl(url);
      const opened = await window.electronAPI?.openCloudSignIn?.(url);
      if (!opened) setError('The browser did not open. Copy the sign-in link below into a browser on this computer.');
      timer.current = setTimeout(() => void refresh(), POLL_MS);
    } catch (err: any) {
      setError(err.message || 'Could not start Google sign-in');
    } finally {
      setStarting(false);
    }
  };

  const waiting = state?.connect.status === 'waiting' && authUrl !== null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400">
            <Cloud className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">Google Drive</p>
            {state === null ? (
              <p className="text-xs text-slate-500">Checking…</p>
            ) : state.connected ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1 truncate">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="truncate">Connected: {state.account_email}</span>
              </p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Not connected. The store owner signs in with their Gmail once.</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state?.connected && connectedActions}
          <button type="button" onClick={() => void connect()} disabled={starting || waiting} className={state?.connected ? 'btn-secondary btn-sm' : 'btn-primary'}>
            {starting || waiting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            <span>{waiting ? 'Waiting for sign-in…' : state?.connected ? 'Change account' : 'Connect Google Drive'}</span>
          </button>
        </div>
      </div>

      {waiting && (
        <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2">
          <p>Google's sign-in page is open in the browser. Sign in with the store owner's Gmail and press <strong>Allow</strong>, then come back here.</p>
          <input readOnly value={authUrl ?? ''} onFocus={e => e.target.select()} className="field-input field-sm w-full font-mono" aria-label="Google sign-in link" />
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
          <XCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};
