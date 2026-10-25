import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../services/apiService';
import { Company, Product, PurchaseInvoice } from '../../types';

/** One line of the return form. max = boxes that may go back; rate = credit per box (the server decides the final figure) */
export interface ReturnDraftLine {
  key: string;
  product_id: number;
  product_name: string;
  purchase_item_id: number | null;
  batch_no: string;
  max: number;
  rate: number;
  qty: number;
}

export interface ReturnPrefill {
  companyId: number;
  lines: ReturnDraftLine[];
  isExpiryClaim: boolean;
}

interface PurchaseReturnModalProps {
  isOpen: boolean;
  prefill: ReturnPrefill | null;
  companies: Company[];
  products: Product[];
  purchases: PurchaseInvoice[];
  money: (value: number) => string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const lineKey = () => Math.random().toString(36).slice(2);

/** Sends goods back to a supplier: pick the supplier, then lines from one of its purchases or any of its medicines */
export const PurchaseReturnModal: React.FC<PurchaseReturnModalProps> = ({ isOpen, prefill, companies, products, purchases, money, onClose, onSaved }) => {
  const [companyId, setCompanyId] = useState('');
  const [purchaseId, setPurchaseId] = useState('');
  const [lines, setLines] = useState<ReturnDraftLine[]>([]);
  const [pickProductId, setPickProductId] = useState('');
  const [reason, setReason] = useState('');
  const [isExpiryClaim, setIsExpiryClaim] = useState(false);
  const [loadingPurchase, setLoadingPurchase] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form each time it opens (pre-filled from the expiry list when given)
  useEffect(() => {
    if (!isOpen) return;
    setCompanyId(prefill ? String(prefill.companyId) : '');
    setPurchaseId('');
    setLines(prefill?.lines ?? []);
    setPickProductId('');
    setReason(prefill?.isExpiryClaim ? 'Expired / near-expiry stock' : '');
    setIsExpiryClaim(prefill?.isExpiryClaim ?? false);
    setError(null);
  }, [isOpen, prefill]);

  const supplierPurchases = useMemo(() => purchases.filter(p => String(p.company_id) === companyId), [purchases, companyId]);
  const supplierProducts = useMemo(
    () => products.filter(p => String(p.company_id) === companyId && p.status !== 'inactive' && p.stock_boxes > 0),
    [products, companyId]
  );
  const stockOf = (productId: number) => products.find(p => p.id === productId)?.stock_boxes ?? 0;

  const changeSupplier = (value: string) => {
    setCompanyId(value);
    setPurchaseId('');
    setLines([]);
    setPickProductId('');
  };

  const choosePurchase = async (value: string) => {
    setPurchaseId(value);
    setLines(prev => prev.filter(l => l.purchase_item_id === null));
    if (!value) return;
    try {
      setLoadingPurchase(true);
      setError(null);
      const purchase = await api.getPurchaseById(Number(value));
      const fromPurchase = (purchase.items ?? [])
        .map(item => ({
          key: lineKey(),
          product_id: item.product_id,
          product_name: item.product_name,
          purchase_item_id: item.id ?? null,
          batch_no: item.batch_no && item.batch_no !== 'NA' ? item.batch_no : '',
          max: Math.min(item.returnable_boxes ?? 0, stockOf(item.product_id)),
          rate: Math.round(item.box_cost_price * (1 - (item.discount_pct || 0) / 100) * 100) / 100,
          qty: 0
        }))
        .filter(line => line.max > 0);
      if (fromPurchase.length === 0) setError('Nothing from this purchase can be returned: it was all returned or sold.');
      setLines(prev => [...prev.filter(l => l.purchase_item_id === null), ...fromPurchase]);
    } catch (err: any) {
      setError(err.message || 'The purchase could not be loaded.');
    } finally {
      setLoadingPurchase(false);
    }
  };

  const addMedicine = () => {
    const product = supplierProducts.find(p => String(p.id) === pickProductId);
    if (!product) return;
    setLines(prev => [...prev, {
      key: lineKey(),
      product_id: product.id,
      product_name: product.name,
      purchase_item_id: null,
      batch_no: '',
      max: product.stock_boxes,
      rate: product.box_trade_price,
      qty: 1
    }]);
    setPickProductId('');
  };

  const updateLine = (key: string, change: Partial<ReturnDraftLine>) =>
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...change } : l)));

  const chosen = lines.filter(l => l.qty > 0);
  const totalCredit = chosen.reduce((sum, l) => sum + l.qty * l.rate, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!companyId) {
      setError('Choose the supplier.');
      return;
    }
    if (chosen.length === 0) {
      setError('Enter the boxes being returned for at least one medicine.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const res = await api.createPurchaseReturn({
        company_id: Number(companyId),
        purchase_id: purchaseId ? Number(purchaseId) : null,
        reason: reason.trim() || undefined,
        is_expiry_claim: isExpiryClaim,
        items: chosen.map(l => ({
          product_id: l.product_id,
          quantity_boxes: l.qty,
          purchase_item_id: l.purchase_item_id,
          batch_no: l.batch_no.trim() || null
        }))
      });
      onSaved(`${isExpiryClaim ? 'Expiry claim' : 'Return'} ${res.returnNo} saved. Stock lowered and ${money(res.totalCredit)} credited against this supplier.`);
    } catch (err: any) {
      setError(err.message || 'The return could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => { if (!saving) onClose(); }} title={isExpiryClaim ? 'Expiry Claim to Supplier' : 'Return Goods to Supplier'} maxWidth="max-w-4xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-surface-inset-dark p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
          <label className="block">
            <span className="field-label">Supplier</span>
            <select required value={companyId} onChange={e => changeSupplier(e.target.value)} className="field-select w-full" disabled={!!prefill}>
              <option value="">Choose a supplier</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="field-label">From purchase (optional)</span>
            <select value={purchaseId} onChange={e => choosePurchase(e.target.value)} className="field-select w-full" disabled={!companyId || loadingPurchase}>
              <option value="">{supplierPurchases.length ? 'Not linked to a purchase' : 'No purchases from this supplier'}</option>
              {supplierPurchases.map(p => (
                <option key={p.id} value={p.id}>{p.invoice_no} ({p.purchase_date}){p.supplier_invoice_no ? `, bill ${p.supplier_invoice_no}` : ''}</option>
              ))}
            </select>
          </label>
        </div>

        {companyId && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block flex-1 min-w-[240px]">
              <span className="field-label">Add a medicine from stock</span>
              <select value={pickProductId} onChange={e => setPickProductId(e.target.value)} className="field-select w-full">
                <option value="">{supplierProducts.length ? 'Choose a medicine' : 'No medicines of this supplier in stock'}</option>
                {supplierProducts.map(p => <option key={p.id} value={p.id}>{p.name} ({p.stock_boxes} boxes)</option>)}
              </select>
            </label>
            <button type="button" onClick={addMedicine} disabled={!pickProductId} className="btn-secondary">
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          </div>
        )}

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold">
              <tr>
                <th className="py-2 px-3">Medicine</th>
                <th className="py-2 px-3">Batch</th>
                <th className="py-2 px-3 text-center">Can return</th>
                <th className="py-2 px-3 text-center">Boxes</th>
                <th className="py-2 px-3 text-right">Rate</th>
                <th className="py-2 px-3 text-right">Credit</th>
                <th className="py-2 px-2" aria-label="Remove" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {lines.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                  {loadingPurchase ? 'Loading purchase…' : 'Choose a purchase or add a medicine to return.'}
                </td></tr>
              ) : lines.map(line => (
                <tr key={line.key}>
                  <td className="py-2 px-3 font-medium text-slate-900 dark:text-white">
                    {line.product_name}
                    {line.purchase_item_id === null && <div className="text-2xs text-slate-500 dark:text-slate-400">Credited at trade price</div>}
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={line.batch_no}
                      onChange={e => updateLine(line.key, { batch_no: e.target.value })}
                      placeholder="Batch"
                      aria-label={`Batch of ${line.product_name}`}
                      className="field-input field-sm w-28 font-mono"
                    />
                  </td>
                  <td className="py-2 px-3 text-center font-mono">{line.max}</td>
                  <td className="py-2 px-3 text-center">
                    <input
                      type="number"
                      min={0}
                      max={line.max}
                      step={1}
                      value={line.qty}
                      onChange={e => updateLine(line.key, { qty: Math.min(line.max, Math.max(0, Math.floor(Number(e.target.value) || 0))) })}
                      aria-label={`Boxes of ${line.product_name}`}
                      className="field-input field-sm w-20 text-center font-mono"
                    />
                  </td>
                  <td className="py-2 px-3 text-right font-mono">{money(line.rate)}</td>
                  <td className="py-2 px-3 text-right font-mono font-bold">{money(line.qty * line.rate)}</td>
                  <td className="py-2 px-2 text-center">
                    <button type="button" onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))} className="p-1 text-slate-400 hover:text-rose-500" aria-label={`Remove ${line.product_name}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="field-label">Reason</span>
            <input type="text" maxLength={300} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Damaged packing, expired" className="field-input w-full" />
          </label>
          <label className="flex items-center gap-2 h-10 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={isExpiryClaim} onChange={e => setIsExpiryClaim(e.target.checked)} className="w-4 h-4 accent-teal-600" />
            <span>Expiry claim</span>
          </label>
        </div>

        <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800">
          <span className="text-sm text-slate-600 dark:text-slate-400">{chosen.reduce((s, l) => s + l.qty, 0)} box(es) going back</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Credit from supplier: <span className="text-xl font-extrabold font-mono text-teal-600 dark:text-teal-400">{money(totalCredit)}</span>
          </span>
        </div>

        {error && <p className="text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || chosen.length === 0} className="btn-primary">
            {saving ? 'Saving…' : isExpiryClaim ? 'Save Expiry Claim' : 'Save Return'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
