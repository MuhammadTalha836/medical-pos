import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, Printer, RefreshCw } from 'lucide-react';
import { api } from '../../services/apiService';
import { StockAdjustmentList, SystemSettings } from '../../types';
import { printDocument } from '../../utils/printDocument';
import { localDateString } from '../../../shared/dates';
import { ADJUST_REASONS, ADJUST_REASON_LABELS, isAdjustReason, unitsText } from '../../../shared/stockAdjust';

interface AdjustmentsTabProps {
  settings?: SystemSettings | null;
  money: (value: number) => string;
}

const monthStart = () => `${localDateString().slice(0, 8)}01`;
const reasonLabel = (reason: string) => (isAdjustReason(reason) ? ADJUST_REASON_LABELS[reason] : reason);
const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

/** Every stock change outside sales and purchases, with the loss or gain at cost */
export const AdjustmentsTab: React.FC<AdjustmentsTabProps> = ({ settings, money }) => {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(localDateString());
  const [reason, setReason] = useState('');
  const [data, setData] = useState<StockAdjustmentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getStockAdjustments({ from: from || undefined, to: to || undefined, reason: reason || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustments could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [from, to, reason]);

  const rows = data?.adjustments ?? [];

  const exportCsv = () => {
    const header = ['Date', 'Medicine', 'Reason', 'Batch', 'Change (units)', 'Before', 'After', 'Value at cost', 'By', 'Notes'];
    const lines = rows.map(r => [
      new Date(r.created_at).toLocaleString(), r.product_name, reasonLabel(r.reason), r.batch_no || '',
      r.delta_units, r.stock_before, r.stock_after, r.value, r.user_name || '', r.notes || ''
    ].map(csvCell).join(','));
    const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-adjustments-${from || 'all'}-to-${to || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="card-premium p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="adj-from">From</label>
          <input id="adj-from" type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className="field-input field-sm" />
        </div>
        <div>
          <label className="field-label" htmlFor="adj-to">To</label>
          <input id="adj-to" type="date" value={to} min={from || undefined} max={localDateString()} onChange={e => setTo(e.target.value)} className="field-input field-sm" />
        </div>
        <div>
          <label className="field-label" htmlFor="adj-reason">Reason</label>
          <select id="adj-reason" value={reason} onChange={e => setReason(e.target.value)} className="field-select field-sm">
            <option value="">All reasons</option>
            {ADJUST_REASONS.map(r => <option key={r} value={r}>{ADJUST_REASON_LABELS[r]}</option>)}
          </select>
        </div>
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm" aria-label="Reload">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={exportCsv} disabled={rows.length === 0} className="btn-secondary btn-sm">
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
          <button type="button" onClick={() => printDocument(printRef.current, 'Stock adjustments')} disabled={rows.length === 0} className="btn-print btn-sm">
            <Printer className="w-4 h-4" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card-premium p-3">
            <div className="text-2xs text-slate-500 dark:text-slate-400">Adjustments</div>
            <div className="font-mono font-bold text-slate-900 dark:text-white">{data.totals.count}</div>
          </div>
          <div className="card-premium p-3">
            <div className="text-2xs text-slate-500 dark:text-slate-400">Stock lost at cost</div>
            <div className="font-mono font-bold text-rose-600 dark:text-rose-400">{money(data.totals.loss_value)}</div>
          </div>
          <div className="card-premium p-3">
            <div className="text-2xs text-slate-500 dark:text-slate-400">Stock added at cost</div>
            <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{money(data.totals.gain_value)}</div>
          </div>
          <div className="card-premium p-3">
            <div className="text-2xs text-slate-500 dark:text-slate-400">Net</div>
            <div className={`font-mono font-bold ${data.totals.net_value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{money(data.totals.net_value)}</div>
          </div>
        </div>
      )}
      <p className="field-hint">Opening stock and stock found are counted as added. Shop profit in Day Close is not changed by these.</p>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={load} className="btn-secondary btn-sm">Try again</button>
        </div>
      )}

      <div className="card-premium overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Medicine</th>
                <th className="py-2 px-3">Reason</th>
                <th className="py-2 px-3 text-right">Change</th>
                <th className="py-2 px-3">Stock</th>
                <th className="py-2 px-3 text-right">Value</th>
                <th className="py-2 px-3">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {loading && rows.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading adjustments…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">No stock adjustments in this period.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id}>
                  <td className="py-2 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="py-2 px-3">
                    <div className="font-medium text-slate-900 dark:text-white">{r.product_name}</div>
                    {(r.batch_no || r.notes) && (
                      <div className="text-2xs text-slate-500 dark:text-slate-400">{[r.batch_no ? `Batch ${r.batch_no}` : '', r.notes || ''].filter(Boolean).join(', ')}</div>
                    )}
                  </td>
                  <td className="py-2 px-3">{reasonLabel(r.reason)}</td>
                  <td className={`py-2 px-3 text-right font-mono font-semibold ${r.delta_units < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {r.delta_units > 0 ? '+' : ''}{unitsText(r.delta_units, r.packing, r.unit_type)}
                  </td>
                  <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {unitsText(r.stock_before, r.packing, r.unit_type)} to {unitsText(r.stock_after, r.packing, r.unit_type)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono">{money(r.value)}</td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{r.user_name || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Printed report */}
      <div ref={printRef} className="hidden">
        <h1>{settings?.store_name || 'Stock adjustments'}</h1>
        <p>Stock adjustments{from ? ` from ${from}` : ''}{to ? ` to ${to}` : ''}{reason ? `, ${reasonLabel(reason)}` : ''}</p>
        <table>
          <thead><tr><th>Date</th><th>Medicine</th><th>Reason</th><th className="num">Change</th><th className="num">Value</th><th>By</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.product_name}{r.batch_no ? ` (${r.batch_no})` : ''}</td>
                <td>{reasonLabel(r.reason)}</td>
                <td className="num">{unitsText(r.delta_units, r.packing, r.unit_type)}</td>
                <td className="num">{money(r.value)}</td>
                <td>{r.user_name || ''}</td>
              </tr>
            ))}
            {data && (
              <>
                <tr><td colSpan={4}><strong>Stock lost at cost</strong></td><td className="num"><strong>{money(data.totals.loss_value)}</strong></td><td /></tr>
                <tr><td colSpan={4}><strong>Stock added at cost</strong></td><td className="num"><strong>{money(data.totals.gain_value)}</strong></td><td /></tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
