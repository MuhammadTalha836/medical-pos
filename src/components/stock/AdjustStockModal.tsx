import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../services/apiService';
import { Product, ProductBatchRow } from '../../types';
import { ADJUST_REASON_DIRECTION, ADJUST_REASON_LABELS, MANUAL_ADJUST_REASONS, STOCK_NOTES_MAX, unitsText, type AdjustReason } from '../../../shared/stockAdjust';

interface AdjustStockModalProps {
  product: Product | null;
  onClose: () => void;
  /** Called after a saved adjustment with the medicine's new stock */
  onSaved: (message: string) => void;
}

/** One stock change with a reason: damaged, expired, lost, found or a correction, optionally on one batch */
export const AdjustStockModal: React.FC<AdjustStockModalProps> = ({ product, onClose, onSaved }) => {
  const [reason, setReason] = useState<AdjustReason>('damaged');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [boxes, setBoxes] = useState(0);
  const [loose, setLoose] = useState(0);
  const [batchId, setBatchId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [batches, setBatches] = useState<ProductBatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!product) return;
    setReason('damaged');
    setDirection('out');
    setBoxes(0);
    setLoose(0);
    setBatchId('');
    setNotes('');
    setError(null);
    api.getProductBatches(product.id).then(setBatches).catch(() => setBatches([]));
  }, [product]);

  if (!product) return null;

  const packing = Math.max(1, product.packing || 1);
  const current = product.stock_boxes * packing + product.stock_loose;
  const units = Math.max(0, boxes) * packing + Math.max(0, loose);
  const delta = direction === 'out' ? -units : units;
  const after = current + delta;
  const fixedDirection = ADJUST_REASON_DIRECTION[reason];

  const pickReason = (value: AdjustReason) => {
    setReason(value);
    const dir = ADJUST_REASON_DIRECTION[value];
    if (dir === 'in' || dir === 'out') setDirection(dir);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (units === 0) return setError('Enter how much stock to add or take off.');
    if (after < 0) return setError('Stock cannot go below zero.');
    setSaving(true);
    setError(null);
    try {
      await api.adjustStock(product.id, { reason, direction, boxes, loose, batch_id: batchId || null, notes: notes.trim() || undefined });
      onSaved(`Stock of "${product.name}" is now ${unitsText(after, packing, product.unit_type)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The adjustment could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!product} onClose={onClose} title={`Adjust stock: ${product.name}`} maxWidth="max-w-lg">
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          In stock now: <span className="font-mono font-semibold text-slate-900 dark:text-white">{unitsText(current, packing, product.unit_type)}</span>
        </p>

        <div>
          <label className="field-label" htmlFor="adjust-reason">Reason</label>
          <select id="adjust-reason" value={reason} onChange={e => pickReason(e.target.value as AdjustReason)} className="field-select w-full">
            {MANUAL_ADJUST_REASONS.map(r => <option key={r} value={r}>{ADJUST_REASON_LABELS[r]}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="field-label" htmlFor="adjust-direction">Change</label>
            <select
              id="adjust-direction"
              value={direction}
              onChange={e => setDirection(e.target.value as 'in' | 'out')}
              disabled={fixedDirection !== 'both'}
              className="field-select w-full"
            >
              <option value="out">Take off</option>
              <option value="in">Add</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="adjust-boxes">Boxes</label>
            <input id="adjust-boxes" type="number" min="0" value={boxes} onChange={e => setBoxes(Math.max(0, parseInt(e.target.value) || 0))} className="field-input w-full font-mono" />
          </div>
          <div>
            <label className="field-label" htmlFor="adjust-loose">Loose {product.unit_type}</label>
            <input
              id="adjust-loose"
              type="number"
              min="0"
              value={loose}
              onChange={e => setLoose(Math.max(0, parseInt(e.target.value) || 0))}
              disabled={packing === 1}
              className="field-input w-full font-mono"
            />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="adjust-batch">Batch</label>
          <select id="adjust-batch" value={batchId} onChange={e => setBatchId(e.target.value ? Number(e.target.value) : '')} className="field-select w-full">
            <option value="">{direction === 'out' ? 'Earliest expiry first' : 'Opening stock batch'}</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>
                {b.batch_no}{b.expiry_date ? `, expires ${b.expiry_date}` : ''} ({unitsText(b.units, packing, product.unit_type)})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="adjust-notes">Notes</label>
          <input id="adjust-notes" value={notes} maxLength={STOCK_NOTES_MAX} onChange={e => setNotes(e.target.value)} placeholder="What happened (optional)" className="field-input w-full" />
        </div>

        <div className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 px-3 py-2 text-sm">
          <span className="text-slate-600 dark:text-slate-400">Stock after</span>
          <span className={`font-mono font-semibold ${after < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
            {after < 0 ? 'Below zero' : unitsText(after, packing, product.unit_type)}
          </span>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving || units === 0 || after < 0} className="btn-primary">
            {saving ? 'Saving…' : 'Save adjustment'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
