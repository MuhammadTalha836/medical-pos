import React, { useEffect, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../services/apiService';
import { Product, ProductBatchRow } from '../../types';

interface BatchListModalProps {
  product: Product | null;
  canEdit: boolean;
  onClose: () => void;
}

const STATUS: Record<ProductBatchRow['status'], { label: string; badge: string }> = {
  expired: { label: 'Expired', badge: 'badge-danger' },
  near: { label: 'Expires within 90 days', badge: 'badge-warning' },
  ok: { label: 'Good', badge: 'badge-success' },
  no_expiry: { label: 'No expiry date', badge: 'badge-info' }
};

/** A medicine's batches in the order they are sold (first expiry first), with batch number / expiry correction */
export const BatchListModal: React.FC<BatchListModalProps> = ({ product, canEdit, onClose }) => {
  const [batches, setBatches] = useState<ProductBatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async (productId: number) => {
    try {
      setError(null);
      setBatches(await api.getProductBatches(productId));
    } catch (err: any) {
      setError(err.message || 'Batches could not be loaded.');
    }
  };

  useEffect(() => {
    if (!product) return;
    setBatches(null);
    setEditingId(null);
    load(product.id);
  }, [product]);

  const startEdit = (row: ProductBatchRow) => {
    setEditingId(row.id);
    setBatchNo(row.batch_no);
    setExpiry(row.expiry_date);
  };

  const save = async () => {
    if (!product || editingId === null || saving) return;
    try {
      setSaving(true);
      setError(null);
      await api.updateProductBatch(product.id, editingId, { batch_no: batchNo.trim(), expiry_date: expiry || null });
      setEditingId(null);
      await load(product.id);
    } catch (err: any) {
      setError(err.message || 'The batch could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const quantity = (row: ProductBatchRow) =>
    row.quantity_loose > 0 ? `${row.quantity_boxes} box + ${row.quantity_loose} ${product?.unit_type ?? ''}` : `${row.quantity_boxes} box`;

  return (
    <Modal isOpen={product !== null} onClose={onClose} title={`Batches: ${product?.name ?? ''}`} maxWidth="max-w-3xl">
      <div className="space-y-3">
        <p className="field-hint">
          Sales take the batch at the top first (earliest expiry). Expired batches are never sold; send them back from Purchases → Returns to Supplier.
        </p>
        {error && <p className="text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">{error}</p>}
        {!batches ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading batches…</p>
        ) : batches.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No batches yet. Stock added by a purchase or opening stock appears here.</p>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold">
                <tr>
                  <th className="py-2 px-3">Batch</th>
                  <th className="py-2 px-3">Expiry</th>
                  <th className="py-2 px-3">In stock</th>
                  <th className="py-2 px-3">Status</th>
                  {canEdit && <th className="py-2 px-3 text-center">Edit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {batches.map(row => (
                  <tr key={row.id} className={row.units === 0 ? 'opacity-60' : ''}>
                    {editingId === row.id ? (
                      <>
                        <td className="py-2 px-3">
                          <input value={batchNo} onChange={e => setBatchNo(e.target.value)} maxLength={60} aria-label="Batch number" className="field-input field-sm w-32 font-mono" />
                        </td>
                        <td className="py-2 px-3">
                          <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} aria-label="Expiry date" className="field-input field-sm w-40" />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 px-3 font-mono font-semibold text-slate-900 dark:text-white">{row.batch_no}</td>
                        <td className="py-2 px-3 font-mono">{row.expiry_date || '-'}</td>
                      </>
                    )}
                    <td className="py-2 px-3 font-mono">{quantity(row)}</td>
                    <td className="py-2 px-3"><span className={STATUS[row.status].badge}>{STATUS[row.status].label}</span></td>
                    {canEdit && (
                      <td className="py-2 px-3">
                        <div className="flex justify-center gap-1">
                          {editingId === row.id ? (
                            <>
                              <button type="button" onClick={save} disabled={saving || !batchNo.trim()} className="btn-primary btn-sm" aria-label="Save batch">
                                <Check className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => setEditingId(null)} disabled={saving} className="btn-secondary btn-sm" aria-label="Cancel">
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <button type="button" onClick={() => startEdit(row)} className="btn-secondary btn-sm" aria-label={`Edit batch ${row.batch_no}`}>
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
};
