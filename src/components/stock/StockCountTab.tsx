import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Plus, Printer, RefreshCw, ScanLine, Trash2, XCircle } from 'lucide-react';
import { api } from '../../services/apiService';
import { Company, Product, StockCount, StockCountDetail, StockCountLine, SystemSettings } from '../../types';
import { printDocument } from '../../utils/printDocument';
import { unitsText } from '../../../shared/stockAdjust';

interface StockCountTabProps {
  settings?: SystemSettings | null;
  companies: Company[];
  money: (value: number) => string;
  canCount: boolean;
  canApply: boolean;
  /** Stock changed (a count was applied): the medicine list reloads */
  onApplied: () => void;
}

type LineFilter = 'all' | 'differences' | 'not_counted';
type Draft = { boxes: string; loose: string };

const STATUS_BADGE: Record<StockCount['status'], { label: string; className: string }> = {
  open: { label: 'Open', className: 'badge-info' },
  applied: { label: 'Applied', className: 'badge-success' },
  cancelled: { label: 'Cancelled', className: 'badge-warning' }
};

const lineUnits = (line: StockCountLine, draft?: Draft) =>
  draft ? (parseInt(draft.boxes) || 0) * line.packing + (parseInt(draft.loose) || 0) : line.counted_units;

const differenceClass = (units: number | null) =>
  units === null || units === 0 ? 'text-slate-500 dark:text-slate-400' : units < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400';

/** Shelf count: scan or search medicines, enter what is on the shelf, then a manager applies the differences */
export const StockCountTab: React.FC<StockCountTabProps> = ({ settings, companies, money, canCount, canApply, onApplied }) => {
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<StockCountDetail | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [scan, setScan] = useState('');
  const [matches, setMatches] = useState<Product[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [filter, setFilter] = useState<LineFilter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const boxRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const printRef = useRef<HTMLDivElement>(null);
  const focusProduct = useRef<number | null>(null);

  const loadCounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.getStockCounts();
      setCounts(rows);
      setSelectedId(prev => prev ?? rows.find(c => c.status === 'open')?.id ?? rows[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stock counts could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: number) => {
    try {
      const data = await api.getStockCount(id);
      setDetail(data);
      setDrafts({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The stock count could not be loaded.');
    }
  };

  useEffect(() => { loadCounts(); }, []);
  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId]);

  // After a medicine is added, its Boxes box takes the focus
  useEffect(() => {
    const id = focusProduct.current;
    if (id && boxRefs.current[id]) {
      boxRefs.current[id]?.focus();
      boxRefs.current[id]?.select();
      focusProduct.current = null;
    }
  }, [detail]);

  const isOpen = detail?.status === 'open';
  const editable = isOpen && canCount;

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  };

  const createCount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createStockCount({ title: newTitle.trim() || undefined, company_id: newCompany ? Number(newCompany) : null });
      setNewTitle('');
      setNewCompany('');
      setSelectedId(res.count.id);
      await loadCounts();
      setTimeout(() => scanRef.current?.focus(), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The count could not be started.');
    } finally {
      setBusy(false);
    }
  };

  const addProduct = async (data: { product_id?: number; barcode?: string }) => {
    if (!detail) return false;
    await api.saveStockCountItem(detail.id, data);
    const fresh = await api.getStockCount(detail.id);
    const added = data.product_id ?? fresh.items.find(i => i.barcode === data.barcode || i.p_code === data.barcode)?.product_id ?? null;
    focusProduct.current = added;
    setDetail(fresh);
    setScan('');
    setMatches([]);
    return true;
  };

  // Enter on the scan box: an exact barcode or code adds the medicine; anything else searches by name
  const onScan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = scan.trim();
    if (!text || !detail) return;
    setError(null);
    try {
      await addProduct({ barcode: text });
    } catch {
      try {
        const found = await api.getProducts({ q: text });
        if (found.length === 1) await addProduct({ product_id: found[0].id });
        else if (found.length === 0) setError(`No medicine matches "${text}".`);
        else setMatches(found.slice(0, 8));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed.');
      }
    }
  };

  const saveLine = async (line: StockCountLine) => {
    const draft = drafts[line.product_id];
    if (!detail || !draft) return;
    const boxes = Math.max(0, parseInt(draft.boxes) || 0);
    const loose = Math.max(0, parseInt(draft.loose) || 0);
    setError(null);
    try {
      await api.saveStockCountItem(detail.id, { product_id: line.product_id, counted_boxes: boxes, counted_loose: loose });
      await loadDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The count could not be saved.');
    }
  };

  const onLineKey = (e: React.KeyboardEvent<HTMLInputElement>, line: StockCountLine) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    saveLine(line).then(() => scanRef.current?.focus());
  };

  const removeLine = async (line: StockCountLine) => {
    if (!detail) return;
    try {
      await api.removeStockCountItem(detail.id, line.product_id);
      await loadDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The line could not be removed.');
    }
  };

  const unsaved = Object.keys(drafts).length;

  const applyCount = async () => {
    if (!detail) return;
    if (unsaved > 0) return setError('Some counts are typed but not saved. Press Enter on each line first.');
    const counted = detail.items.filter(i => i.counted_units !== null).length;
    const message = `Apply ${detail.count_no}?\n\n${counted} medicine(s) counted, ${detail.totals.differences_count} with a difference.\n`
      + `Shortage at cost: ${money(detail.totals.loss_value)}\nExtra at cost: ${money(detail.totals.gain_value)}\n\n`
      + 'Stock will be set to the counted quantities. Medicines not counted are left as they are.';
    if (!window.confirm(message)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.applyStockCount(detail.id);
      flash(`${detail.count_no} applied: ${res.changed} medicine(s) changed.`);
      await Promise.all([loadCounts(), loadDetail(detail.id)]);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The count could not be applied.');
    } finally {
      setBusy(false);
    }
  };

  const cancelCount = async () => {
    if (!detail || !window.confirm(`Cancel ${detail.count_no}? Nothing in it will change the stock.`)) return;
    setBusy(true);
    try {
      await api.cancelStockCount(detail.id);
      await Promise.all([loadCounts(), loadDetail(detail.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The count could not be cancelled.');
    } finally {
      setBusy(false);
    }
  };

  const lines = useMemo(() => {
    const items = detail?.items ?? [];
    if (filter === 'differences') return items.filter(i => i.difference_units);
    if (filter === 'not_counted') return items.filter(i => i.counted_units === null);
    return items;
  }, [detail, filter]);

  const countedCount = detail?.items.filter(i => i.counted_units !== null).length ?? 0;
  const companyName = (id: number | null) => companies.find(c => c.id === id)?.name;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Counts list and new count */}
        <aside className="space-y-3">
          {canCount && (
            <form onSubmit={createCount} className="card-premium p-3 space-y-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">New count</h2>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} maxLength={60} placeholder="Name, e.g. Rack A" aria-label="Count name" className="field-input field-sm w-full" />
              <select value={newCompany} onChange={e => setNewCompany(e.target.value)} aria-label="List a company's medicines" className="field-select field-sm w-full">
                <option value="">Start empty (scan as you go)</option>
                {companies.map(c => <option key={c.id} value={c.id}>List all of {c.name}</option>)}
              </select>
              <button type="submit" disabled={busy} className="btn-primary btn-sm w-full">
                <Plus className="w-4 h-4" />
                <span>Start count</span>
              </button>
            </form>
          )}

          <div className="card-premium overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Counts</h2>
              <button type="button" onClick={loadCounts} className="btn-secondary btn-sm" aria-label="Reload counts">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {counts.length === 0 && !loading ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">No stock counts yet.</p>
            ) : (
              <ul className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
                {counts.map(c => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-3 py-2 transition-colors ${selectedId === c.id ? 'bg-teal-50 dark:bg-teal-950/30' : 'hover:bg-slate-50 dark:hover:bg-surface-inset-dark'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">{c.count_no}</span>
                        <span className={STATUS_BADGE[c.status].className}>{STATUS_BADGE[c.status].label}</span>
                      </div>
                      <div className="text-2xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {c.title || companyName(c.company_id) || 'Untitled'}, {c.counted_count ?? 0}/{c.items_count ?? 0} counted
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* The selected count */}
        <section className="space-y-3 min-w-0">
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

          {!detail ? (
            <div className="card-premium py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {loading ? 'Loading stock counts…' : canCount ? 'Start a count to check the shelves against the system stock.' : 'No stock count selected.'}
            </div>
          ) : (
            <>
              <div className="card-premium p-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white font-mono">{detail.count_no}</h2>
                    <span className={STATUS_BADGE[detail.status].className}>{STATUS_BADGE[detail.status].label}</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {detail.title || companyName(detail.company_id) || 'Untitled'}, started by {detail.user_name || 'unknown'}
                    {detail.applied_by ? `, applied by ${detail.applied_by}` : ''}. {countedCount} of {detail.items.length} counted.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => printDocument(printRef.current, `Stock count ${detail.count_no}`)} disabled={detail.items.length === 0} className="btn-print btn-sm">
                    <Printer className="w-4 h-4" />
                    <span>Print count sheet</span>
                  </button>
                  {isOpen && canApply && (
                    <>
                      <button type="button" onClick={cancelCount} disabled={busy} className="btn-secondary btn-sm">
                        <XCircle className="w-4 h-4" />
                        <span>Cancel count</span>
                      </button>
                      <button type="button" onClick={applyCount} disabled={busy || countedCount === 0} className="btn-primary btn-sm">
                        <ClipboardCheck className="w-4 h-4" />
                        <span>Apply to stock</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="card-premium p-3">
                  <div className="text-2xs text-slate-500 dark:text-slate-400">Shortage at cost</div>
                  <div className="font-mono font-bold text-rose-600 dark:text-rose-400">{money(detail.totals.loss_value)}</div>
                </div>
                <div className="card-premium p-3">
                  <div className="text-2xs text-slate-500 dark:text-slate-400">Extra at cost</div>
                  <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{money(detail.totals.gain_value)}</div>
                </div>
                <div className="card-premium p-3">
                  <div className="text-2xs text-slate-500 dark:text-slate-400">Medicines with a difference</div>
                  <div className="font-mono font-bold text-slate-900 dark:text-white">{detail.totals.differences_count}</div>
                </div>
              </div>

              {editable && (
                <div className="card-premium p-3 space-y-2">
                  <div className="relative">
                    <ScanLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      ref={scanRef}
                      value={scan}
                      onChange={e => { setScan(e.target.value); setMatches([]); }}
                      onKeyDown={onScan}
                      placeholder="Scan a barcode or type a medicine name, then press Enter"
                      aria-label="Scan or search a medicine to count"
                      className="field-input w-full pl-9"
                      autoFocus
                    />
                  </div>
                  {matches.length > 0 && (
                    <ul className="border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-800/60">
                      {matches.map(p => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => addProduct({ product_id: p.id }).catch(err => setError(err instanceof Error ? err.message : 'Could not add it.'))}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-surface-inset-dark"
                          >
                            <span className="font-medium text-slate-900 dark:text-white">{p.name}</span>
                            <span className="text-2xs text-slate-500 dark:text-slate-400 ml-2">{p.p_code}{p.location_rack ? `, ${p.location_rack}` : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="field-hint">Enter the boxes and loose units on the shelf and press Enter to save each line. The stock does not change until the count is applied.</p>
                </div>
              )}

              <div className="card-premium overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800">
                  {([['all', 'All'], ['differences', 'Differences only'], ['not_counted', 'Not counted']] as const).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setFilter(key)} className={filter === key ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>
                      {label}
                    </button>
                  ))}
                  {unsaved > 0 && <span className="badge-warning ml-auto">{unsaved} line(s) not saved</span>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2 px-3">Medicine</th>
                        <th className="py-2 px-3">System</th>
                        <th className="py-2 px-3">Counted (boxes + loose)</th>
                        <th className="py-2 px-3 text-right">Difference</th>
                        <th className="py-2 px-3 text-right">Value</th>
                        {editable && <th className="py-2 px-3" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {lines.length === 0 ? (
                        <tr>
                          <td colSpan={editable ? 6 : 5} className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                            {detail.items.length === 0 ? 'Nothing in this count yet. Scan or search a medicine above.' : 'No lines match this filter.'}
                          </td>
                        </tr>
                      ) : lines.map(line => {
                        const draft = drafts[line.product_id];
                        const counted = lineUnits(line, draft);
                        const diff = counted === null ? null : counted - line.system_units;
                        return (
                          <tr key={line.id} className={line.missing ? 'opacity-60' : ''}>
                            <td className="py-2 px-3">
                              <div className="font-medium text-slate-900 dark:text-white">{line.product_name}</div>
                              <div className="text-2xs text-slate-500 dark:text-slate-400">
                                {line.missing ? 'Medicine deleted, will be skipped' : [line.p_code, line.location_rack].filter(Boolean).join(', ')}
                              </div>
                            </td>
                            <td className="py-2 px-3 font-mono">{unitsText(line.system_units, line.packing, line.unit_type)}</td>
                            <td className="py-2 px-3">
                              {editable && !line.missing ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    ref={el => { boxRefs.current[line.product_id] = el; }}
                                    type="number"
                                    min="0"
                                    value={draft?.boxes ?? (line.counted_units === null ? '' : String(Math.floor(line.counted_units / line.packing)))}
                                    onChange={e => setDrafts(prev => ({ ...prev, [line.product_id]: { boxes: e.target.value, loose: prev[line.product_id]?.loose ?? (line.counted_units === null ? '' : String(line.counted_units % line.packing)) } }))}
                                    onKeyDown={e => onLineKey(e, line)}
                                    aria-label={`Boxes of ${line.product_name}`}
                                    placeholder="Boxes"
                                    className="field-input field-sm w-20 font-mono"
                                  />
                                  {line.packing > 1 && (
                                    <input
                                      type="number"
                                      min="0"
                                      value={draft?.loose ?? (line.counted_units === null ? '' : String(line.counted_units % line.packing))}
                                      onChange={e => setDrafts(prev => ({ ...prev, [line.product_id]: { loose: e.target.value, boxes: prev[line.product_id]?.boxes ?? (line.counted_units === null ? '' : String(Math.floor(line.counted_units / line.packing))) } }))}
                                      onKeyDown={e => onLineKey(e, line)}
                                      aria-label={`Loose ${line.unit_type} of ${line.product_name}`}
                                      placeholder="Loose"
                                      className="field-input field-sm w-20 font-mono"
                                    />
                                  )}
                                  {draft && (
                                    <button type="button" onClick={() => saveLine(line)} className="btn-primary btn-sm">Save</button>
                                  )}
                                </div>
                              ) : (
                                <span className="font-mono">{line.counted_units === null ? 'Not counted' : unitsText(line.counted_units, line.packing, line.unit_type)}</span>
                              )}
                            </td>
                            <td className={`py-2 px-3 text-right font-mono font-semibold ${differenceClass(diff)}`}>
                              {diff === null ? '-' : diff === 0 ? 'OK' : `${diff > 0 ? '+' : ''}${unitsText(diff, line.packing, line.unit_type)}`}
                            </td>
                            <td className={`py-2 px-3 text-right font-mono ${differenceClass(diff)}`}>
                              {diff ? money(diff * line.unit_cost) : '-'}
                            </td>
                            {editable && (
                              <td className="py-2 px-3 text-right">
                                <button type="button" onClick={() => removeLine(line)} className="btn-secondary btn-sm" aria-label={`Remove ${line.product_name} from the count`}>
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Printed count sheet: the counted column is left blank to fill in on the shelf */}
              <div ref={printRef} className="hidden">
                <h1>{settings?.store_name || 'Stock count'}</h1>
                <p>Stock count {detail.count_no}{detail.title ? `, ${detail.title}` : ''}, {new Date().toLocaleDateString()}</p>
                <table>
                  <thead><tr><th>Medicine</th><th>Code</th><th>Rack</th><th>Packing</th><th>Counted boxes</th><th>Counted loose</th></tr></thead>
                  <tbody>
                    {detail.items.map(line => (
                      <tr key={line.id}>
                        <td>{line.product_name}</td>
                        <td>{line.p_code || ''}</td>
                        <td>{line.location_rack || ''}</td>
                        <td>{line.packing}</td>
                        <td>{line.counted_units === null ? '' : Math.floor(line.counted_units / line.packing)}</td>
                        <td>{line.counted_units === null ? '' : line.counted_units % line.packing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>Counted by: ____________________ Checked by: ____________________</p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};
