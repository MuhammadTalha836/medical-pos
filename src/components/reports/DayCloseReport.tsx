import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Lock, LockOpen, Printer } from 'lucide-react';
import { api } from '../../services/apiService';
import { useAuthStore } from '../../store/useAuthStore';
import {
  DayCloseFigures,
  DayCloseRange,
  DayCloseRangeDay,
  DayCloseReport as DayCloseData,
  DayClosing,
  SystemSettings
} from '../../types';
import { moneyFormatter } from '../../utils/format';
import { printDocument } from '../../utils/printDocument';
import { localDateString } from '../../../shared/dates';

interface DayCloseReportProps {
  settings?: SystemSettings | null;
  /** Reloads the shared settings after the automatic-close switch is saved */
  onRefreshSettings?: () => void;
}

type Period = 'day' | 'month' | 'range';

const showDateTime = (value: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : `${localDateString(d)} ${d.toTimeString().slice(0, 5)}`;
};

const shiftDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/** First and last day of a YYYY-MM month, the last capped at today */
function monthRange(month: string, today: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = localDateString(new Date(y, m, 0));
  return { from: `${month}-01`, to: last > today ? today : last };
}

function statusLabel(closing: DayCloseRangeDay['closing']): string {
  if (!closing) return 'Open';
  if (!closing.is_closed) return 'Reopened';
  return closing.auto_closed ? 'Closed automatically' : `Closed by ${closing.user_name || 'staff'}`;
}

/** One label / amount line; `strong` for totals */
const Line: React.FC<{ label: string; value: string; strong?: boolean; tone?: 'minus' | 'plus' }> = ({ label, value, strong, tone }) => (
  <div className={`flex justify-between gap-4 py-1.5 ${strong ? 'border-t border-slate-200 dark:border-slate-800 font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
    <span>{label}</span>
    <span className={`font-mono whitespace-nowrap ${tone === 'minus' ? 'text-rose-600 dark:text-rose-400' : tone === 'plus' ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{value}</span>
  </div>
);

/** Sales, profit, expenses and cash for a day or a whole period */
const FigureSections: React.FC<{ f: DayCloseFigures; money: (n: number) => string; periodWord: string }> = ({ f, money, periodWord }) => (
  <>
    <div className="grid gap-4 md:grid-cols-2">
      <section>
        <h2 className="text-xs font-bold text-slate-900 dark:text-white mb-1">Sales</h2>
        <Line label={`Cash (${f.invoices_count} ${f.invoices_count === 1 ? 'invoice' : 'invoices'} in all)`} value={money(f.sales_cash)} />
        <Line label="Card and online" value={money(f.sales_card)} />
        <Line label="Credit (khata)" value={money(f.sales_credit)} />
        <Line label="Total sales" value={money(f.sales_total)} strong />
        <Line label={`Returns (${f.returns_count})`} value={`-${money(f.returns_total)}`} tone="minus" />
        <Line label="Net sales" value={money(f.net_sales)} strong />
      </section>

      <section>
        <h2 className="text-xs font-bold text-slate-900 dark:text-white mb-1">Profit</h2>
        <Line label="Net sales" value={money(f.net_sales)} />
        <Line label="Cost of medicines sold" value={`-${money(f.cost_of_goods)}`} tone="minus" />
        <Line label="Gross profit" value={money(f.gross_profit)} strong />
        <Line label="Shop expenses" value={`-${money(f.expenses_total)}`} tone="minus" />
        <div className={`flex justify-between gap-4 mt-1 px-3 py-2.5 rounded-lg text-sm font-extrabold ${f.net_profit >= 0
          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
          : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300'}`}
        >
          <span>{f.net_profit >= 0 ? 'Net profit' : 'Net loss'}</span>
          <span className="font-mono">{money(f.net_profit)}</span>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-bold text-slate-900 dark:text-white mb-1">Expenses by category</h2>
        {f.expenses_by_category.length === 0 ? (
          <p className="py-1.5 text-slate-500 dark:text-slate-400">No expenses in this {periodWord}.</p>
        ) : (
          <>
            {f.expenses_by_category.map(c => (
              <Line key={c.category} label={c.count > 1 ? `${c.category} (${c.count})` : c.category} value={money(c.amount)} />
            ))}
            <Line label="Total expenses" value={money(f.expenses_total)} strong />
            {f.expenses_cash > 0 && <Line label="Paid in cash" value={money(f.expenses_cash)} />}
          </>
        )}
      </section>

      <section>
        <h2 className="text-xs font-bold text-slate-900 dark:text-white mb-1">
          Cash ({f.shifts.count} {f.shifts.count === 1 ? 'shift' : 'shifts'}{f.shifts.open_count ? `, ${f.shifts.open_count} open` : ''})
        </h2>
        <Line label="Opening cash" value={money(f.shifts.opening_cash)} />
        <Line label="Expected in the drawers" value={money(f.shifts.expected_cash)} />
        <Line label="Counted (closed shifts)" value={money(f.shifts.counted_cash)} />
        <Line
          label="Short / over"
          value={money(f.shifts.difference)}
          tone={f.shifts.difference < 0 ? 'minus' : f.shifts.difference > 0 ? 'plus' : undefined}
          strong
        />
        <Line label="Khata cash received" value={money(f.customer_payments_cash)} />
        <Line label="Paid to suppliers" value={money(f.supplier_paid)} />
      </section>
    </div>
    <p className="text-2xs text-slate-500 dark:text-slate-400 muted">
      Returns count on the day the refund was given. Payments to suppliers are shown for the cash count only; they are not part of the profit.
    </p>
  </>
);

/** Day close (cash book): one day with Close / Reopen, or a month / date range with a day-by-day table */
export const DayCloseReport: React.FC<DayCloseReportProps> = ({ settings, onRefreshSettings }) => {
  const money = moneyFormatter(settings);
  const { hasPermission } = useAuthStore();
  const today = localDateString();

  const [period, setPeriod] = useState<Period>('day');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);

  const [data, setData] = useState<DayCloseData | null>(null);
  const [range, setRange] = useState<DayCloseRange | null>(null);
  const [history, setHistory] = useState<DayClosing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoClose, setAutoClose] = useState(settings?.auto_day_close !== 'false');
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAutoClose(settings?.auto_day_close !== 'false');
  }, [settings?.auto_day_close]);

  const loadDay = async (day = date) => {
    try {
      setLoading(true);
      const [report, closed] = await Promise.all([api.getDayClose(day), api.getDayCloseHistory()]);
      setData(report);
      setHistory(closed);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'The day close could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const loadRange = async (start: string, end: string) => {
    try {
      setLoading(true);
      setRange(await api.getDayCloseRange(start, end));
      setError(null);
    } catch (err: any) {
      setError(err.message || 'The report could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDay();
  }, []);

  const pickDay = (day: string) => {
    setPeriod('day');
    setDate(day);
    setClosing(false);
    loadDay(day);
  };

  const pickPeriod = (next: Period) => {
    setPeriod(next);
    setClosing(false);
    if (next === 'day') loadDay();
    else if (next === 'month') {
      const r = monthRange(month, today);
      loadRange(r.from, r.to);
    } else loadRange(from, to);
  };

  const pickMonth = (value: string) => {
    if (!value) return;
    setMonth(value);
    const r = monthRange(value, today);
    loadRange(r.from, r.to);
  };

  const quickRange = (start: string, end: string) => {
    setFrom(start);
    setTo(end);
    loadRange(start, end);
  };

  const now = new Date();
  const quickRanges = [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: localDateString(shiftDays(now, -1)), to: localDateString(shiftDays(now, -1)) },
    { label: 'Last 7 days', from: localDateString(shiftDays(now, -6)), to: today },
    { label: 'This month', from: `${today.slice(0, 8)}01`, to: today },
    {
      label: 'Last month',
      from: localDateString(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: localDateString(new Date(now.getFullYear(), now.getMonth(), 0))
    }
  ];

  const handleClose = async () => {
    try {
      setBusy(true);
      await api.closeDay(date, notes.trim() || undefined);
      setClosing(false);
      setNotes('');
      await loadDay();
    } catch (err: any) {
      setError(err.message || 'The day could not be closed.');
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    const autoNote = autoClose && date < today ? ' If you do not close it again, it closes on its own after the next midnight.' : '';
    if (!window.confirm(`Reopen ${date}? Its expenses can then be changed again.${autoNote}`)) return;
    try {
      setBusy(true);
      await api.reopenDay(date);
      await loadDay();
    } catch (err: any) {
      setError(err.message || 'The day could not be reopened.');
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoClose = async (on: boolean) => {
    try {
      setAutoClose(on);
      await api.saveSettings({ auto_day_close: on ? 'true' : 'false' });
      onRefreshSettings?.();
    } catch (err: any) {
      setAutoClose(!on);
      setError(err.message || 'The setting could not be saved.');
    }
  };

  const exportCsv = () => {
    if (!range) return;
    const headers = ['Day', 'Invoices', 'Sales', 'Returns', 'Net sales', 'Cost of medicines', 'Gross profit', 'Expenses', 'Net profit', 'Status'];
    const rows = range.days.map(d => [
      d.date, d.invoices_count, d.sales_total.toFixed(2), d.returns_total.toFixed(2), d.net_sales.toFixed(2),
      d.cost_of_goods.toFixed(2), d.gross_profit.toFixed(2), d.expenses_total.toFixed(2), d.net_profit.toFixed(2), statusLabel(d.closing)
    ]);
    const t = range.totals;
    rows.push(['Total', t.invoices_count, t.sales_total.toFixed(2), t.returns_total.toFixed(2), t.net_sales.toFixed(2),
      t.cost_of_goods.toFixed(2), t.gross_profit.toFixed(2), t.expenses_total.toFixed(2), t.net_profit.toFixed(2), '']);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = `day_close_${range.from}_to_${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const f = data?.figures;
  const saved = data?.closing;
  const isClosed = saved?.is_closed ?? false;
  // Sales or returns made after the close change the live figures; the saved ones stay until a reopen
  const changedSinceClose = isClosed && f && saved && Math.abs(f.net_profit - saved.net_profit) >= 0.01;
  const closedBy = (c: DayClosing) => (c.auto_closed ? 'Closed automatically' : `Closed by ${c.user_name || 'staff'}`);

  const openShifts = period === 'day' ? data?.open_shifts ?? [] : range?.open_shifts ?? [];
  const printTitle = period === 'day' ? `Day close ${date}` : `Day close ${range?.from ?? ''} to ${range?.to ?? ''}`;

  return (
    <div className="space-y-4">
      <div className="card-premium p-3.5 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden" role="tablist" aria-label="Period">
          {([['day', 'Day'], ['month', 'Month'], ['range', 'Date range']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={period === key}
              onClick={() => pickPeriod(key)}
              className={`px-3 py-1.5 font-semibold transition-colors ${period === key
                ? 'bg-teal-700 text-white dark:bg-teal-600'
                : 'bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#162032]'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {period === 'day' && (
          <input
            type="date"
            aria-label="Day"
            value={date}
            max={today}
            onChange={e => e.target.value && pickDay(e.target.value)}
            className="field-input field-sm font-mono"
          />
        )}
        {period === 'month' && (
          <input
            type="month"
            aria-label="Month"
            value={month}
            max={today.slice(0, 7)}
            onChange={e => pickMonth(e.target.value)}
            className="field-input field-sm font-mono"
          />
        )}
        {period === 'range' && (
          <>
            <input type="date" aria-label="From date" value={from} max={to || today} onChange={e => setFrom(e.target.value)} className="field-input field-sm font-mono" />
            <span className="text-slate-400">to</span>
            <input type="date" aria-label="To date" value={to} min={from || undefined} max={today} onChange={e => setTo(e.target.value)} className="field-input field-sm font-mono" />
            <button type="button" onClick={() => loadRange(from, to)} disabled={!from || !to} className="btn-primary btn-sm">Show</button>
          </>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          {period === 'day' && data?.can_close && !loading && (isClosed ? (
            <button type="button" onClick={handleReopen} disabled={busy} className="btn-secondary btn-sm">
              <LockOpen className="w-4 h-4" />
              <span>Reopen day</span>
            </button>
          ) : (
            <button type="button" onClick={() => setClosing(true)} disabled={busy || closing} className="btn-primary btn-sm">
              <Lock className="w-4 h-4" />
              <span>Close day</span>
            </button>
          ))}
          {period !== 'day' && (
            <button type="button" onClick={exportCsv} disabled={!range || range.days.length === 0} className="btn-secondary btn-sm">
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => printDocument(printRef.current, printTitle)}
            disabled={period === 'day' ? !f : !range}
            className="btn-print btn-sm"
          >
            <Printer className="w-4 h-4" />
            <span>Print</span>
          </button>
        </div>

        {period === 'range' && (
          <div className="basis-full flex flex-wrap gap-1.5">
            {quickRanges.map(q => (
              <button
                key={q.label}
                type="button"
                onClick={() => quickRange(q.from, q.to)}
                className={`btn-secondary btn-sm ${from === q.from && to === q.to ? 'ring-2 ring-teal-500/60' : ''}`}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => pickPeriod(period)} className="btn-secondary btn-sm">Try again</button>
        </div>
      )}

      {period === 'day' && closing && f && (
        <div className="card-premium p-4 space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Close <strong className="font-mono">{date}</strong> with a net profit of <strong className="font-mono">{money(f.net_profit)}</strong>?
            Expenses for this day cannot be added, changed or deleted until it is reopened.
          </p>
          <div>
            <label htmlFor="day-close-notes" className="field-label">Notes (optional)</label>
            <textarea id="day-close-notes" rows={2} maxLength={300} value={notes} onChange={e => setNotes(e.target.value)} className="field-textarea" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleClose} disabled={busy} className="btn-primary">
              <Lock className="w-4 h-4" />
              <span>{busy ? 'Closing…' : 'Close day'}</span>
            </button>
            <button type="button" onClick={() => setClosing(false)} disabled={busy} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {openShifts.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300" role="status">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span>
            {openShifts.length === 1 ? 'A shift is' : `${openShifts.length} shifts are`} still open:{' '}
            {openShifts.map(s => `${s.shift_no} (${s.user_name})`).join(', ')}. Their figures are live and may still change.
          </span>
        </div>
      )}

      {period === 'day' && saved && (
        <div className={`flex items-start gap-2 px-4 py-3 rounded-xl text-xs font-medium border ${isClosed
          ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300'
          : 'bg-slate-100 dark:bg-surface-inset-dark border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'}`}
        >
          {isClosed ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" /> : <LockOpen className="w-4 h-4 shrink-0 mt-px" />}
          <span>
            {isClosed
              ? `${closedBy(saved)} at ${showDateTime(saved.closing_time)} with a net profit of ${money(saved.net_profit)}.`
              : 'This day was closed and then reopened. Close it again to save the figures.'}
            {saved.notes ? ` Notes: ${saved.notes}` : ''}
            {changedSinceClose ? ' The figures changed after the close; reopen and close again to save the new ones.' : ''}
          </span>
        </div>
      )}

      <div ref={printRef} className="card-premium p-4 space-y-4 text-xs">
        {period === 'day' ? (
          <>
            <div>
              <h1 className="text-sm font-bold text-slate-900 dark:text-white">
                {settings?.store_name ? `${settings.store_name}: day close` : 'Day close'} {date}
              </h1>
              <p className="text-2xs text-slate-500 dark:text-slate-400 muted">
                {isClosed && saved ? `${closedBy(saved)} at ${showDateTime(saved.closing_time)}` : 'Not closed yet'}
                {settings?.store_address ? `. ${settings.store_address}` : ''}
              </p>
            </div>
            {loading && !f ? (
              <p className="py-10 text-center text-slate-500 dark:text-slate-400">Loading the day…</p>
            ) : f ? <FigureSections f={f} money={money} periodWord="day" /> : null}
          </>
        ) : (
          <>
            <div>
              <h1 className="text-sm font-bold text-slate-900 dark:text-white">
                {settings?.store_name ? `${settings.store_name}: day close` : 'Day close'}{range ? ` ${range.from} to ${range.to}` : ''}
              </h1>
              <p className="text-2xs text-slate-500 dark:text-slate-400 muted">
                {range ? `${range.days.length} ${range.days.length === 1 ? 'day' : 'days'} with sales or expenses` : ''}
                {settings?.store_address ? `. ${settings.store_address}` : ''}
              </p>
            </div>
            {loading && !range ? (
              <p className="py-10 text-center text-slate-500 dark:text-slate-400">Loading the report…</p>
            ) : range ? (
              <>
                <FigureSections f={range.totals} money={money} periodWord="period" />
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold border-y border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Day</th>
                        <th className="py-2.5 px-3 text-right">Invoices</th>
                        <th className="py-2.5 px-3 text-right">Net sales</th>
                        <th className="py-2.5 px-3 text-right">Cost</th>
                        <th className="py-2.5 px-3 text-right">Expenses</th>
                        <th className="py-2.5 px-3 text-right">Net profit</th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                      {range.days.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                            No sales, returns or expenses in these dates. Choose another month or date range.
                          </td>
                        </tr>
                      ) : range.days.map(d => (
                        <tr key={d.date} className="hover:bg-slate-50 dark:hover:bg-[#162032]">
                          <td className="py-2 px-3 font-mono">
                            <button type="button" onClick={() => pickDay(d.date)} className="text-teal-700 dark:text-teal-400 hover:underline">{d.date}</button>
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{d.invoices_count}</td>
                          <td className="py-2 px-3 text-right font-mono">{money(d.net_sales)}</td>
                          <td className="py-2 px-3 text-right font-mono">{money(d.cost_of_goods)}</td>
                          <td className="py-2 px-3 text-right font-mono">{money(d.expenses_total)}</td>
                          <td className={`py-2 px-3 text-right font-mono font-bold ${d.net_profit < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{money(d.net_profit)}</td>
                          <td className="py-2 px-3">{statusLabel(d.closing)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {range.days.length > 0 && (
                      <tfoot className="border-t-2 border-slate-300 dark:border-slate-700 font-bold text-slate-900 dark:text-white">
                        <tr>
                          <td className="py-2 px-3">Total</td>
                          <td className="py-2 px-3 text-right font-mono">{range.totals.invoices_count}</td>
                          <td className="py-2 px-3 text-right font-mono">{money(range.totals.net_sales)}</td>
                          <td className="py-2 px-3 text-right font-mono">{money(range.totals.cost_of_goods)}</td>
                          <td className="py-2 px-3 text-right font-mono">{money(range.totals.expenses_total)}</td>
                          <td className="py-2 px-3 text-right font-mono">{money(range.totals.net_profit)}</td>
                          <td className="py-2 px-3" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>

      {period === 'day' && (
        <>
          {hasPermission('settings') && (
            <label className="card-premium p-3.5 flex items-start gap-3 text-xs cursor-pointer">
              <input type="checkbox" checked={autoClose} onChange={e => toggleAutoClose(e.target.checked)} className="mt-0.5 w-4 h-4 accent-teal-600" />
              <span>
                <span className="block font-semibold text-slate-900 dark:text-white">Close each day automatically at midnight</span>
                <span className="text-slate-500 dark:text-slate-400">
                  Every day with sales or expenses is closed on its own after 12:00 midnight. If the computer was off, it is closed the next time the app starts.
                </span>
              </span>
            </label>
          )}

          <div className="card-premium overflow-hidden">
            <h2 className="px-4 pt-3 text-xs font-bold text-slate-900 dark:text-white">Recent day closes</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs mt-2">
                <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold border-y border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Day</th>
                    <th className="py-2.5 px-3 text-right">Invoices</th>
                    <th className="py-2.5 px-3 text-right">Expenses</th>
                    <th className="py-2.5 px-3 text-right">Net profit</th>
                    <th className="py-2.5 px-3">Closed by</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {history.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">No day has been closed yet.</td></tr>
                  ) : history.map(h => (
                    <tr key={h.date} className={`hover:bg-slate-50 dark:hover:bg-[#162032] ${h.date === date ? 'bg-teal-50 dark:bg-teal-950/30' : ''}`}>
                      <td className="py-2 px-3 font-mono">
                        <button type="button" onClick={() => pickDay(h.date)} className="text-teal-700 dark:text-teal-400 hover:underline">{h.date}</button>
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{h.invoices_count}</td>
                      <td className="py-2 px-3 text-right font-mono">{money(h.expenses_total)}</td>
                      <td className={`py-2 px-3 text-right font-mono font-bold ${h.net_profit < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{money(h.net_profit)}</td>
                      <td className="py-2 px-3">{h.auto_closed ? 'Automatic' : h.user_name || '-'}</td>
                      <td className="py-2 px-3">{h.is_closed ? 'Closed' : 'Reopened'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
