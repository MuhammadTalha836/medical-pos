import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Edit2, KeyRound, Monitor, RefreshCw, ShieldCheck, Trash2, Wifi, WifiOff } from 'lucide-react';
import { api, ApiError } from '../../services/apiService';
import { LanStatus, LanTerminal } from '../../types';
import { Modal } from '../common/Modal';

const when = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Never');

interface CountersTabProps {
  /** The server says several computers are off for this pharmacy: the tab goes away */
  onLanOff: () => void;
}

/** Settings → Counters (main computer only): pair counter computers, see who is online, remove a lost one */
export const CountersTab: React.FC<CountersTabProps> = ({ onLanOff }) => {
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [autoStart, setAutoStart] = useState(false);
  const [renaming, setRenaming] = useState<{ terminal: LanTerminal; name: string } | null>(null);
  const [removing, setRemoving] = useState<LanTerminal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setStatus(await api.getLanStatus());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LAN_OFF') return onLanOff();
      setError(err instanceof Error ? err.message : 'The counters could not be loaded.');
    }
  };

  useEffect(() => {
    void load();
    void window.electronAPI?.lanGetAutoStart().then(setAutoStart).catch(() => undefined);
    // Keeps "online" fresh while the tab is open
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!code) return;
    const tick = () => {
      const left = Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setCode(null);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [code]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4000);
  };

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      flash(message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const makeCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.makePairingCode();
      setCode({ code: res.code, expiresAt: new Date(res.expires_at).getTime() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The code could not be made.');
    } finally {
      setBusy(false);
    }
  };

  const allowFirewall = async () => {
    setBusy(true);
    setError(null);
    const res = await window.electronAPI?.lanAllowFirewall().catch(() => null);
    setBusy(false);
    if (res?.success) flash('Counters can now reach this computer through Windows Firewall.');
    else setError(res?.error || 'Windows Firewall could not be changed.');
  };

  const toggleAutoStart = async (on: boolean) => {
    const result = await window.electronAPI?.lanSetAutoStart(on).catch(() => null);
    if (typeof result === 'boolean') setAutoStart(result);
  };

  const counters = status?.terminals.filter(t => !t.is_server) ?? [];
  const active = counters.filter(t => !t.revoked);
  const removed = counters.filter(t => t.revoked);

  return (
    <div className="space-y-5">
      {notice && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="btn-secondary btn-sm">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* This computer */}
        <section className="card-premium p-5 space-y-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Monitor className="w-5 h-5 text-teal-500" />
            This is the main computer
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Counters connect to this computer and sell from its data. Keep it switched on while the shop is open.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-500 dark:text-slate-400">Address</dt>
            <dd className="font-mono font-semibold text-slate-900 dark:text-white">
              {status ? (status.addresses.length ? status.addresses.join(', ') : 'Not connected to a network') : '…'}
            </dd>
            <dt className="text-slate-500 dark:text-slate-400">Port</dt>
            <dd className="font-mono font-semibold text-slate-900 dark:text-white">{status?.port ?? '…'}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Security code</dt>
            <dd className="font-mono font-semibold text-slate-900 dark:text-white">{status?.fingerprint_short || '…'}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Version</dt>
            <dd className="font-mono text-slate-900 dark:text-white">{status?.version ?? '…'}</dd>
          </dl>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" onClick={allowFirewall} disabled={busy} className="btn-secondary btn-sm">
              <ShieldCheck className="w-4 h-4" />
              <span>Allow through firewall</span>
            </button>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={autoStart} onChange={e => toggleAutoStart(e.target.checked)} className="w-4 h-4 accent-teal-600" />
              Start with Windows
            </label>
          </div>
        </section>

        {/* Pairing */}
        <section className="card-premium p-5 space-y-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-500" />
            Add a counter
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            On the new counter choose "This computer is a counter", enter this computer's address and port, then the code below.
            The code works once, for 5 minutes.
          </p>
          {code ? (
            <div className="space-y-2">
              <p className="text-4xl font-mono font-bold tracking-[0.3em] text-teal-700 dark:text-teal-300" aria-live="polite">{code.code}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}. The counter must show the security code {status?.fingerprint_short}.
              </p>
              <button type="button" onClick={makeCode} disabled={busy} className="btn-secondary btn-sm">
                <RefreshCw className="w-4 h-4" />
                <span>Make a new code</span>
              </button>
            </div>
          ) : (
            <button type="button" onClick={makeCode} disabled={busy} className="btn-primary">
              <KeyRound className="w-4 h-4" />
              <span>Make pairing code</span>
            </button>
          )}
        </section>
      </div>

      {/* Counters */}
      <section className="card-premium overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Counters ({active.length})</h2>
          <button type="button" onClick={() => void load()} className="btn-secondary btn-sm" aria-label="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {active.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">No counters yet. Make a pairing code to add the first one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-semibold">Name</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Last seen</th>
                  <th className="px-4 py-2 font-semibold">Address</th>
                  <th className="px-4 py-2 font-semibold">Version</th>
                  <th className="px-4 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {active.map(t => (
                  <tr key={t.id}>
                    <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">{t.name}</td>
                    <td className="px-4 py-2.5">
                      {t.online ? (
                        <span className="badge-success inline-flex items-center gap-1"><Wifi className="w-3.5 h-3.5" />Online</span>
                      ) : (
                        <span className="badge-warning inline-flex items-center gap-1"><WifiOff className="w-3.5 h-3.5" />Offline</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{when(t.last_seen_at)}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400">{t.last_ip?.replace(/^::ffff:/, '') || '—'}</td>
                    <td className={`px-4 py-2.5 font-mono ${t.app_version && status && t.app_version !== status.version ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-600 dark:text-slate-400'}`}>
                      {t.app_version || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => setRenaming({ terminal: t, name: t.name })} className="btn-secondary btn-sm" aria-label={`Rename ${t.name}`}>
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => setRemoving(t)} className="btn-danger btn-sm">
                          <Trash2 className="w-4 h-4" />
                          <span>Remove access</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {removed.length > 0 && (
          <p className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
            Removed: {removed.map(t => t.name).join(', ')}. Their old bills keep the counter name.
          </p>
        )}
      </section>

      <Modal isOpen={!!renaming} onClose={() => setRenaming(null)} title="Rename counter" maxWidth="max-w-md">
        {renaming && (
          <form
            className="space-y-4"
            onSubmit={e => {
              e.preventDefault();
              void run(() => api.renameTerminal(renaming.terminal.id, renaming.name), 'Counter renamed.').then(() => setRenaming(null));
            }}
          >
            <div>
              <label className="field-label" htmlFor="counter-name">Name</label>
              <input id="counter-name" className="field-input" maxLength={40} value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} autoFocus />
              <p className="field-hint">New bills and shifts show this name. Old ones keep the name they had.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={busy || !renaming.name.trim()} className="btn-primary">Save name</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={!!removing} onClose={() => setRemoving(null)} title="Remove counter access" maxWidth="max-w-md">
        {removing && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              "{removing.name}" stops working at once and everyone signed in there is signed out. Use this for a lost, sold or replaced computer.
              To use it again, pair it with a new code.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRemoving(null)} className="btn-secondary">Cancel</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => api.revokeTerminal(removing.id), `"${removing.name}" removed.`).then(() => setRemoving(null))}
                className="btn-danger"
              >
                Remove access
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
