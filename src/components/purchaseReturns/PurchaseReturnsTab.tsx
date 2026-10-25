import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, PackageX, Plus, Printer } from 'lucide-react';
import { api } from '../../services/apiService';
import { Company, ExpiryCandidate, Product, PurchaseInvoice, PurchaseReturnDetails, PurchaseReturnSummary, SystemSettings } from '../../types';
import { Modal } from '../common/Modal';
import { printDocument } from '../../utils/printDocument';
import { PurchaseReturnModal, type ReturnPrefill } from './PurchaseReturnModal';

interface PurchaseReturnsTabProps {
  settings?: SystemSettings | null;
  companies: Company[];
  products: Product[];
  purchases: PurchaseInvoice[];
  money: (value: number) => string;
  canReturn: boolean;
  /** Called after a return is saved, so the page reloads stock and purchases */
  onChanged: () => void;
}

const EXPIRY_WINDOWS = [30, 60, 90, 180];

/** Goods sent back to suppliers, and expired / near-expiry stock that can still be claimed */
export const PurchaseReturnsTab: React.FC<PurchaseReturnsTabProps> = ({ settings, companies, products, purchases, money, canReturn, onChanged }) => {
  const [returns, setReturns] = useState<PurchaseReturnSummary[]>([]);
  const [candidates, setCandidates] = useState<ExpiryCandidate[]>([]);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [prefill, setPrefill] = useState<ReturnPrefill | null>(null);
  const [viewing, setViewing] = useState<PurchaseReturnDetails | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      setLoading(true);
      const [list, claimable] = await Promise.all([api.getPurchaseReturns(), api.getExpiryCandidates(days)]);
      setReturns(list);
      setCandidates(claimable);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Returns could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [days]);

  const bySupplier = useMemo(() => {
    const groups = new Map<number, { name: string; rows: ExpiryCandidate[] }>();
    for (const c of candidates) {
      const group = groups.get(c.company_id) ?? { name: c.company_name, rows: [] };
      group.rows.push(c);
      groups.set(c.company_id, group);
    }
    return [...groups.entries()];
  }, [candidates]);

  const openNew = () => {
    setPrefill(null);
    setNotice(null);
    setFormOpen(true);
  };

  const openClaim = (companyId: number, rows: ExpiryCandidate[]) => {
    setNotice(null);
    setPrefill({
      companyId,
      isExpiryClaim: true,
      lines: rows.map(r => ({
        key: `claim-${r.batch_id}`,
        product_id: r.product_id,
        product_name: r.product_name,
        purchase_item_id: r.purchase_item_id,
        batch_no: r.batch_no,
        max: r.boxes,
        rate: r.rate,
        qty: r.boxes
      }))
    });
    setFormOpen(true);
  };

  const view = async (id: number) => {
    try {
      setViewing(await api.getPurchaseReturn(id));
    } catch (err: any) {
      setError(err.message || 'The return could not be opened.');
    }
  };

  return (
    <div className="space-y-4">
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

      {/* Expiry claims */}
      <section className="card-premium p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Expiry claims</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Expired and soon-expiring stock you can send back to its supplier for credit.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <span>Expiring within</span>
            <select value={days} onChange={e => setDays(Number(e.target.value))} className="field-select field-sm w-28">
              {EXPIRY_WINDOWS.map(d => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">Checking expiry dates…</p>
        ) : bySupplier.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No stock expires within this window. Nothing to claim.</p>
        ) : (
          <div className="space-y-3">
            {bySupplier.map(([companyId, group]) => (
              <div key={companyId} className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-surface-inset-dark">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{group.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-300">{money(group.rows.reduce((s, r) => s + r.credit, 0))}</span>
                    {canReturn && (
                      <button type="button" onClick={() => openClaim(companyId, group.rows)} className="btn-primary btn-sm">
                        <PackageX className="w-4 h-4" />
                        <span>Create claim</span>
                      </button>
                    )}
                  </div>
                </div>
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {group.rows.map(r => (
                      <tr key={r.batch_id}>
                        <td className="py-2 px-3 font-medium text-slate-900 dark:text-white">{r.product_name}</td>
                        <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-300">{r.batch_no}</td>
                        <td className="py-2 px-3 font-mono">
                          <span className={r.expired ? 'badge-danger' : 'badge-warning'}>
                            {r.expired ? `Expired ${r.expiry_date}` : `${r.days_left} days left`}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center font-mono">{r.boxes} box(es)</td>
                        <td className="py-2 px-3 text-right font-mono">{money(r.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Returns list */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Returns to suppliers</h2>
          {canReturn && (
            <button type="button" onClick={openNew} className="btn-primary">
              <Plus className="w-4 h-4" />
              <span>New Return</span>
            </button>
          )}
        </div>
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Return #</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Supplier</th>
                <th className="py-3 px-4">Purchase</th>
                <th className="py-3 px-4 text-center">Items</th>
                <th className="py-3 px-4 text-right">Credit</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-slate-500 dark:text-slate-400">Loading returns…</td></tr>
              ) : returns.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-slate-500 dark:text-slate-400">No goods have been returned to suppliers yet.</td></tr>
              ) : returns.map(r => (
                <tr key={r.id} className="hover:bg-teal-500/5 dark:hover:bg-teal-500/10">
                  <td className="py-3 px-4 font-mono font-bold text-teal-600 dark:text-teal-400">{r.return_no}</td>
                  <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">{r.return_date}</td>
                  <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{r.company_name}</td>
                  <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">{r.purchase_invoice_no || '-'}</td>
                  <td className="py-3 px-4 text-center font-mono">{r.items_count}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{money(r.total_credit)}</td>
                  <td className="py-3 px-4"><span className={r.is_expiry_claim ? 'badge-warning' : 'badge-info'}>{r.is_expiry_claim ? 'Expiry claim' : 'Return'}</span></td>
                  <td className="py-3 px-4 text-center">
                    <button type="button" onClick={() => view(r.id)} className="btn-secondary btn-sm">
                      <Eye className="w-4 h-4" />
                      <span>View</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <PurchaseReturnModal
        isOpen={formOpen}
        prefill={prefill}
        companies={companies}
        products={products}
        purchases={purchases}
        money={money}
        onClose={() => setFormOpen(false)}
        onSaved={message => {
          setFormOpen(false);
          setNotice(message);
          load();
          onChanged();
        }}
      />

      <Modal isOpen={viewing !== null} onClose={() => setViewing(null)} title={`Return ${viewing?.return_no ?? ''}`} maxWidth="max-w-2xl">
        {viewing && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button type="button" onClick={() => printDocument(printRef.current, `Return ${viewing.return_no}`)} className="btn-print">
                <Printer className="w-4 h-4" />
                <span>Print Return Note</span>
              </button>
            </div>
            <div ref={printRef} className="space-y-3 text-sm text-slate-800 dark:text-slate-200">
              <div>
                <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">{settings?.store_name || 'Return note'}</h1>
                <p className="muted text-slate-500 dark:text-slate-400">{viewing.is_expiry_claim ? 'Expiry claim' : 'Goods returned'} {viewing.return_no}, {viewing.return_date}</p>
              </div>
              <p>
                <strong>To:</strong> {viewing.company_name} ({viewing.company_code}){viewing.company_phone ? `, ${viewing.company_phone}` : ''}
                {viewing.purchase_invoice_no && <><br /><strong>Against purchase:</strong> {viewing.purchase_invoice_no}{viewing.supplier_invoice_no ? ` (your bill ${viewing.supplier_invoice_no})` : ''}</>}
                {viewing.reason && <><br /><strong>Reason:</strong> {viewing.reason}</>}
              </p>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300">
                  <tr>
                    <th className="py-2 px-3">Medicine</th>
                    <th className="py-2 px-3">Batch</th>
                    <th className="py-2 px-3 text-right num">Boxes</th>
                    <th className="py-2 px-3 text-right num">Rate</th>
                    <th className="py-2 px-3 text-right num">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {viewing.items.map(i => (
                    <tr key={i.id}>
                      <td className="py-2 px-3">{i.product_name}</td>
                      <td className="py-2 px-3 font-mono">{i.batch_no || '-'}</td>
                      <td className="py-2 px-3 text-right font-mono num">{i.quantity_boxes}</td>
                      <td className="py-2 px-3 text-right font-mono num">{money(i.rate)}</td>
                      <td className="py-2 px-3 text-right font-mono num">{money(i.credit)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} className="py-2 px-3 text-right font-bold">Total credit</td>
                    <td className="py-2 px-3 text-right font-mono font-bold num">{money(viewing.total_credit)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="muted text-xs text-slate-500 dark:text-slate-400">Prepared by {viewing.user_name || 'staff'}. Received by: ____________________</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
