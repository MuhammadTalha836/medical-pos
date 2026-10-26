import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Award, Download, Printer, RefreshCw, Search } from 'lucide-react';
import { api } from '../../services/apiService';
import { LoyaltyMembers, LoyaltyPlan, SystemSettings } from '../../types';
import { printDocument } from '../../utils/printDocument';

interface LoyaltyMembersTabProps {
  settings?: SystemSettings | null;
  money: (value: number) => string;
  onOpen: (customer: { id: number; name: string }) => void;
  /** Bumped when points change elsewhere, so the list reloads */
  refreshKey: number;
}

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

/** Customers → Loyalty: every member with plan and points, the points owed in total, and each member's history */
export const LoyaltyMembersTab: React.FC<LoyaltyMembersTabProps> = ({ settings, money, onOpen, refreshKey }) => {
  const [plans, setPlans] = useState<LoyaltyPlan[]>([]);
  const [planId, setPlanId] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<LoyaltyMembers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.getLoyaltyPlans().then(setPlans).catch(() => setPlans([])); }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getLoyaltyMembers({ plan_id: planId ? Number(planId) : undefined, q: query.trim() || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Members could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 200);
    return () => clearTimeout(timer);
  }, [planId, query, refreshKey]);

  const rows = data?.members ?? [];
  const planName = plans.find(p => String(p.id) === planId)?.name;

  const exportCsv = () => {
    const header = ['Customer', 'Phone', 'Plan', 'Points', 'Value', 'Last activity'];
    const lines = rows.map(r => [r.name, r.phone || '', r.plan_name || '', r.points, r.points_value, r.last_activity ? new Date(r.last_activity).toLocaleDateString() : '']
      .map(csvCell).join(','));
    const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loyalty-members.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="card-premium p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or phone" aria-label="Search members" className="field-input w-full pl-9" />
        </div>
        <select value={planId} onChange={e => setPlanId(e.target.value)} aria-label="Plan" className="field-select">
          <option value="">All plans</option>
          {plans.map(p => <option key={p.id} value={p.id}>{p.name}{p.status === 'archived' ? ' (archived)' : ''}</option>)}
        </select>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary btn-sm" aria-label="Reload">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button type="button" onClick={exportCsv} disabled={rows.length === 0} className="btn-secondary btn-sm">
          <Download className="w-4 h-4" />
          <span>Export CSV</span>
        </button>
        <button type="button" onClick={() => printDocument(printRef.current, 'Loyalty members')} disabled={rows.length === 0} className="btn-print btn-sm">
          <Printer className="w-4 h-4" />
          <span>Print</span>
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card-premium p-3">
            <div className="text-2xs text-slate-500 dark:text-slate-400">Members</div>
            <div className="font-mono font-bold text-slate-900 dark:text-white">{data.totals.members}</div>
          </div>
          <div className="card-premium p-3">
            <div className="text-2xs text-slate-500 dark:text-slate-400">Points held by customers</div>
            <div className="font-mono font-bold text-slate-900 dark:text-white">{data.totals.points}</div>
          </div>
          <div className="card-premium p-3">
            <div className="text-2xs text-slate-500 dark:text-slate-400">Worth (if all are used)</div>
            <div className="font-mono font-bold text-amber-600 dark:text-amber-400">{money(data.totals.value)}</div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="btn-secondary btn-sm">Try again</button>
        </div>
      )}

      <div className="card-premium overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 text-xs border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-3 font-semibold">Customer</th>
                <th className="py-3 px-3 font-semibold">Plan</th>
                <th className="py-3 px-3 font-semibold text-right">Points</th>
                <th className="py-3 px-3 font-semibold text-right">Worth</th>
                <th className="py-3 px-3 font-semibold">Last activity</th>
                <th className="py-3 px-3 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {loading && rows.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-500 dark:text-slate-400">Loading members…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-500 dark:text-slate-400">No members match. Saved customers join the default plan on their own.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-teal-500/5">
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-slate-900 dark:text-white">{r.name}</div>
                    <div className="text-2xs text-slate-500 dark:text-slate-400">{r.phone || 'No phone'}</div>
                  </td>
                  <td className="py-2.5 px-3">{r.plan_name ?? '-'}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold">{r.points}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{money(r.points_value)}</td>
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{r.last_activity ? new Date(r.last_activity).toLocaleDateString() : '-'}</td>
                  <td className="py-2.5 px-3 text-center">
                    <button type="button" onClick={() => onOpen({ id: r.id, name: r.name })} className="btn-secondary btn-sm">
                      <Award className="w-4 h-4" />
                      <span>Points & plan</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div ref={printRef} className="hidden">
        <h1>{settings?.store_name || 'Loyalty members'}</h1>
        <p>Loyalty members{planName ? `, ${planName}` : ''}, {new Date().toLocaleDateString()}</p>
        <table>
          <thead><tr><th>Customer</th><th>Phone</th><th>Plan</th><th className="num">Points</th><th className="num">Worth</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}><td>{r.name}</td><td>{r.phone || ''}</td><td>{r.plan_name || ''}</td><td className="num">{r.points}</td><td className="num">{money(r.points_value)}</td></tr>
            ))}
            {data && <tr><td colSpan={3}><strong>Total</strong></td><td className="num"><strong>{data.totals.points}</strong></td><td className="num"><strong>{money(data.totals.value)}</strong></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
