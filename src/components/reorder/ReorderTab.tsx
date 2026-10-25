import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCopy, PackagePlus, Printer, RefreshCw, Search } from 'lucide-react';
import { api } from '../../services/apiService';
import { ReorderItem, SystemSettings } from '../../types';
import { printDocument } from '../../utils/printDocument';
import { copyText } from '../../utils/copyText';
import { WhatsAppButton } from '../common/WhatsAppButton';

export interface ReorderPurchaseLine {
  product_id: number;
  product_name: string;
  boxes: number;
  box_cost_price: number;
  box_retail_price: number;
}

interface ReorderTabProps {
  settings?: SystemSettings | null;
  money: (value: number) => string;
  canCreatePurchase: boolean;
  canSaveDefault: boolean;
  onCreatePurchase: (companyId: number, lines: ReorderPurchaseLine[]) => void;
  onSavedDefault?: () => void;
}

const COVER_CHOICES = [7, 15, 30];

const stockText = (item: ReorderItem) =>
  item.stock_loose > 0 ? `${item.stock_boxes} box + ${item.stock_loose} ${item.unit_type}` : `${item.stock_boxes} box`;

/** The short list: what to order from each supplier, with editable quantities */
export const ReorderTab: React.FC<ReorderTabProps> = ({ settings, money, canCreatePurchase, canSaveDefault, onCreatePurchase, onSavedDefault }) => {
  const savedCover = Number(settings?.reorder_cover_days) || 7;
  const [coverDays, setCoverDays] = useState(savedCover);
  const [items, setItems] = useState<ReorderItem[]>([]);
  const [orderBoxes, setOrderBoxes] = useState<Record<number, number>>({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const printRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = async () => {
    try {
      setLoading(true);
      const list = await api.getReorderList(coverDays);
      setItems(list.items);
      setOrderBoxes(Object.fromEntries(list.items.map(i => [i.product_id, i.suggested_boxes])));
      setError(null);
    } catch (err: any) {
      setError(err.message || 'The reorder list could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [coverDays]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, { companyId: number | null; name: string; phone: string | null; rows: ReorderItem[] }>();
    for (const item of items) {
      if (q && !item.name.toLowerCase().includes(q) && !(item.generic_name ?? '').toLowerCase().includes(q)) continue;
      const key = String(item.company_id ?? 'none');
      const group = map.get(key) ?? { companyId: item.company_id, name: item.company_name, phone: item.company_phone, rows: [] };
      group.rows.push(item);
      map.set(key, group);
    }
    return [...map.entries()];
  }, [items, query]);

  const boxesFor = (item: ReorderItem) => orderBoxes[item.product_id] ?? 0;
  const orderedRows = (rows: ReorderItem[]) => rows.filter(r => boxesFor(r) > 0);
  const groupTotal = (rows: ReorderItem[]) => orderedRows(rows).reduce((sum, r) => sum + boxesFor(r) * r.box_trade_price, 0);

  const saveDefault = async () => {
    try {
      await api.saveSettings({ reorder_cover_days: String(coverDays) });
      setNotice(`Reorder lists now cover ${coverDays} days by default.`);
      onSavedDefault?.();
    } catch (err: any) {
      setError(err.message || 'The default could not be saved.');
    }
  };

  const orderText = (name: string, rows: ReorderItem[]) => {
    const lines = orderedRows(rows).map(r => `- ${r.name}: ${boxesFor(r)} box${boxesFor(r) === 1 ? '' : 'es'}`);
    const header = settings?.store_name ? `Order for ${name} from ${settings.store_name}` : `Order for ${name}`;
    return [header, '', ...lines].join('\n');
  };

  const copyGroup = async (name: string, rows: ReorderItem[]) => {
    if (await copyText(orderText(name, rows))) {
      setNotice(`Order list for ${name} copied. Paste it into WhatsApp or a message.`);
      setError(null);
    } else {
      setError('The list could not be copied. Use Print order list instead.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="card-premium p-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <span>Order enough for</span>
          <select value={coverDays} onChange={e => setCoverDays(Number(e.target.value))} className="field-select field-sm w-28" aria-label="Days the order should cover">
            {[...new Set([...COVER_CHOICES, savedCover])].sort((a, b) => a - b).map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
        {canSaveDefault && coverDays !== savedCover && (
          <button type="button" onClick={saveDefault} className="btn-secondary btn-sm">Save as default</button>
        )}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search medicine or formula" aria-label="Search the reorder list" className="field-input w-full pl-9" />
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn-secondary">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      <p className="field-hint">
        Listed: medicines at or below their minimum stock, and medicines that will run out within {coverDays} days at the last 30 days' sales speed.
      </p>

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
          <button type="button" onClick={load} className="btn-secondary btn-sm">Try again</button>
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">Working out the reorder list…</p>
      ) : groups.length === 0 ? (
        <div className="card-premium py-12 text-center text-sm text-slate-500 dark:text-slate-400">
          {items.length === 0 ? 'Nothing needs ordering: every medicine is above its minimum and will last the period.' : 'No medicine on the list matches this search.'}
        </div>
      ) : groups.map(([key, group]) => (
        <section key={key} className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-50 dark:bg-surface-inset-dark border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">{group.name}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {orderedRows(group.rows).length} of {group.rows.length} medicines, about {money(groupTotal(group.rows))}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => printDocument(printRefs.current[key], `Order ${group.name}`)} disabled={orderedRows(group.rows).length === 0} className="btn-print btn-sm">
                <Printer className="w-4 h-4" />
                <span>Print order list</span>
              </button>
              <button type="button" onClick={() => copyGroup(group.name, group.rows)} disabled={orderedRows(group.rows).length === 0} className="btn-secondary btn-sm">
                <ClipboardCopy className="w-4 h-4" />
                <span>Copy as text</span>
              </button>
              {orderedRows(group.rows).length > 0 && (
                <WhatsAppButton phone={group.phone} message={() => orderText(group.name, group.rows)} label="Send on WhatsApp" />
              )}
              {canCreatePurchase && group.companyId !== null && (
                <button
                  type="button"
                  disabled={orderedRows(group.rows).length === 0}
                  onClick={() => onCreatePurchase(group.companyId!, orderedRows(group.rows).map(r => ({
                    product_id: r.product_id,
                    product_name: r.name,
                    boxes: boxesFor(r),
                    box_cost_price: r.box_trade_price,
                    box_retail_price: r.box_retail_price
                  })))}
                  className="btn-primary btn-sm"
                >
                  <PackagePlus className="w-4 h-4" />
                  <span>Create purchase</span>
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2 px-4">Medicine</th>
                  <th className="py-2 px-3">In stock</th>
                  <th className="py-2 px-3 text-center">Minimum</th>
                  <th className="py-2 px-3 text-center">Sold in 30 days</th>
                  <th className="py-2 px-3">Why</th>
                  <th className="py-2 px-3 text-center">Order boxes</th>
                  <th className="py-2 px-4 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {group.rows.map(r => (
                  <tr key={r.product_id} className={boxesFor(r) === 0 ? 'opacity-60' : ''}>
                    <td className="py-2 px-4">
                      <div className="font-medium text-slate-900 dark:text-white">{r.name}</div>
                      {r.generic_name && <div className="text-2xs text-slate-500 dark:text-slate-400">{r.generic_name}</div>}
                    </td>
                    <td className="py-2 px-3 font-mono">{stockText(r)}</td>
                    <td className="py-2 px-3 text-center font-mono">{r.min_stock_alert || '-'}</td>
                    <td className="py-2 px-3 text-center font-mono">{r.sold_30d_units ? `${r.sold_30d_units} ${r.unit_type}` : '-'}</td>
                    <td className="py-2 px-3">
                      {r.reason === 'below_minimum'
                        ? <span className="badge-danger">Below minimum</span>
                        : <span className="badge-warning">Runs out in {r.days_left} days</span>}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={boxesFor(r)}
                        onChange={e => setOrderBoxes(prev => ({ ...prev, [r.product_id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                        aria-label={`Boxes of ${r.name} to order`}
                        className="field-input field-sm w-20 text-center font-mono"
                      />
                    </td>
                    <td className="py-2 px-4 text-right font-mono">{money(boxesFor(r) * r.box_trade_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* What the printed order sheet contains */}
          <div ref={el => { printRefs.current[key] = el; }} className="hidden">
            <h1>{settings?.store_name || 'Purchase order'}</h1>
            <p>Order for {group.name}, {new Date().toLocaleDateString()}</p>
            <table>
              <thead><tr><th>Medicine</th><th className="num">Boxes</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {orderedRows(group.rows).map(r => (
                  <tr key={r.product_id}>
                    <td>{r.name}</td>
                    <td className="num">{boxesFor(r)}</td>
                    <td className="num">{money(r.box_trade_price)}</td>
                    <td className="num">{money(boxesFor(r) * r.box_trade_price)}</td>
                  </tr>
                ))}
                <tr><td colSpan={3}><strong>Estimated total</strong></td><td className="num"><strong>{money(groupTotal(group.rows))}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
};
