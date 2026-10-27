import React, { useEffect, useState } from 'react';
import { api } from '../../services/apiService';
import { LanInfo } from '../../types';
import { AlertTriangle, CheckCircle2, Monitor, Network, RefreshCw, Server } from 'lucide-react';

const DEFAULT_PORT = 4545;

// Developer-only: this computer's role in a multi-PC shop (one computer on its own, the main computer, or a counter)
export const NetworkPanel: React.FC = () => {
  const [info, setInfo] = useState<LanInfo | null>(null);
  const [mode, setMode] = useState<'standalone' | 'server'>('standalone');
  const [port, setPort] = useState(DEFAULT_PORT);
  const [busy, setBusy] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    window.electronAPI?.lanInfo()
      .then(i => {
        setInfo(i);
        // The saved choice, even when the app has not been restarted with it yet
        setMode(i.savedMode === 'server' ? 'server' : 'standalone');
        setPort(i.port || DEFAULT_PORT);
        setRestartNeeded(i.savedMode !== i.mode);
      })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setMessage({ ok: false, text: 'The port must be a whole number from 1024 to 65535.' });
      return;
    }
    try {
      setBusy(true);
      setMessage(null);
      await api.setLanMode(mode, port);
      setInfo(prev => (prev ? { ...prev, savedMode: mode, port } : prev));
      setRestartNeeded(mode !== info?.mode || port !== info?.port);
      setMessage({ ok: true, text: 'Saved. Restart the app to use the new setting.' });
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || 'The setting could not be saved.' });
    } finally {
      setBusy(false);
    }
  };

  const makeCounter = () => {
    if (!window.confirm('Make this computer a counter? It will sell from the main computer\'s data. Its own data stays on this computer untouched, but is not used while it is a counter.')) return;
    void window.electronAPI?.lanOpenCounterSetup();
  };

  if (!window.electronAPI) {
    return <p className="card-premium p-6 text-sm text-slate-500 dark:text-slate-400">Network settings are available in the desktop app only.</p>;
  }

  const changed = info && (mode !== (info.savedMode === 'server' ? 'server' : 'standalone') || port !== info.port);

  return (
    <div className="space-y-4">
      <section className="card-premium p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Network className="w-5 h-5 text-purple-500" />
            Network (LAN)
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-3xl">
            Turn this on only when the pharmacy runs on more than one computer. All data then stays on this main computer, and the
            other computers are counters that sell from it over the shop network. Until it is on, the Admin sees nothing about
            counters. Changing this never deletes data.
          </p>
        </div>

        <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <legend className="sr-only">Role of this computer</legend>
          <label className={`flex gap-3 p-4 rounded-xl border cursor-pointer ${mode === 'standalone' ? 'border-purple-500 bg-purple-500/5' : 'border-slate-200 dark:border-slate-700'}`}>
            <input type="radio" name="lan-mode" checked={mode === 'standalone'} onChange={() => setMode('standalone')} className="mt-1 accent-purple-600" />
            <span>
              <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><Monitor className="w-4 h-4" />One computer (off)</span>
              <span className="block text-sm text-slate-600 dark:text-slate-400">The pharmacy has one computer. Nothing is shared on the network and the Admin has no Counters tab.</span>
            </span>
          </label>
          <label className={`flex gap-3 p-4 rounded-xl border cursor-pointer ${mode === 'server' ? 'border-purple-500 bg-purple-500/5' : 'border-slate-200 dark:border-slate-700'}`}>
            <input type="radio" name="lan-mode" checked={mode === 'server'} onChange={() => setMode('server')} className="mt-1 accent-purple-600" />
            <span>
              <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><Server className="w-4 h-4" />Several computers: this is the main computer (on)</span>
              <span className="block text-sm text-slate-600 dark:text-slate-400">This computer keeps the data and counters connect to it. After the restart the Admin gets Settings → Counters (LAN) with this computer's address and pairing codes.</span>
            </span>
          </label>
        </fieldset>

        {mode === 'server' && (
          <div className="max-w-xs">
            <label className="field-label" htmlFor="lan-port">Port for counters</label>
            <input id="lan-port" type="number" min={1024} max={65535} className="field-input" value={port} onChange={e => setPort(Number(e.target.value))} />
            <p className="field-hint">Leave it at {DEFAULT_PORT} unless another program uses it.</p>
          </div>
        )}

        {message && (
          <div className={`p-3 rounded-xl flex items-center gap-2 text-sm font-semibold ${message.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-700 dark:text-rose-400'}`} role={message.ok ? 'status' : 'alert'}>
            {message.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        {restartNeeded && !message && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400" role="status">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>This setting is saved but not in use yet. Press Restart now.</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={busy || !changed} className="btn-primary">Save</button>
          {restartNeeded && (
            <button type="button" onClick={() => void window.electronAPI?.relaunch()} className="btn-secondary">
              <RefreshCw className="w-4 h-4" />
              <span>Restart now</span>
            </button>
          )}
        </div>
      </section>

      <section className="card-premium p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Make this computer a counter</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Connects to a main computer with a pairing code made there. Use this only on a counter, never on the main computer.
          </p>
        </div>
        <button type="button" onClick={makeCounter} className="btn-secondary">Make this a counter</button>
      </section>
    </div>
  );
};
