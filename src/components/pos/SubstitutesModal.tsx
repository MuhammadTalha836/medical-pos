import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { ScheduleBadge } from '../common/ScheduleBadge';
import { api } from '../../services/apiService';
import { Product, SubstitutesResult } from '../../types';

interface SubstitutesModalProps {
  /** The medicine the customer asked for; null keeps the modal closed */
  product: Pick<Product, 'id' | 'name'> | null;
  money: (value: number) => string;
  onAdd: (product: Product, isLoose: boolean) => void;
  onClose: () => void;
}

const canSellLoose = (p: Product) => p.allow_open_sale !== false && p.allow_open_sale !== 0;
const isOut = (p: Product) => p.stock_boxes <= 0 && p.stock_loose <= 0;

/** Medicines with the same generic formula, in stock first. ↑/↓ choose, Enter adds a box, Esc closes. */
export const SubstitutesModal: React.FC<SubstitutesModalProps> = ({ product, money, onAdd, onClose }) => {
  const [result, setResult] = useState<SubstitutesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    setResult(null);
    setError(null);
    setSelected(0);
    api.getSubstitutes(product.id)
      .then(data => { if (!cancelled) setResult(data); })
      .catch(err => { if (!cancelled) setError(err.message || 'Substitutes could not be loaded.'); });
    return () => { cancelled = true; };
  }, [product?.id]);

  const list = result?.substitutes ?? [];

  useEffect(() => {
    if (!product) return;
    const onKey = (e: KeyboardEvent) => {
      if (list.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected(i => (i + 1) % list.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected(i => (i - 1 + list.length) % list.length);
      } else if (e.key === 'Enter' && !e.repeat) {
        e.preventDefault();
        if (list[selected] && !isOut(list[selected])) onAdd(list[selected], false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [product, list, selected, onAdd]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <Modal isOpen={product !== null} onClose={onClose} title={`Substitutes for ${product?.name ?? ''}`} maxWidth="max-w-2xl">
      {error ? (
        <p className="py-8 text-center text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">{error}</p>
      ) : !result ? (
        <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Finding medicines with the same formula…</p>
      ) : !result.product.generic_name?.trim() ? (
        <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No formula is saved for this medicine. Add it under Medicines → Generic Formula to see substitutes.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Formula: <span className="font-semibold text-slate-900 dark:text-white">{result.product.generic_name}</span>
          </p>
          {list.length === 0 || list.every(isOut) ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {list.length === 0 ? 'No other medicine has this formula.' : 'Other medicines with this formula are also out of stock.'}
            </p>
          ) : null}
          {list.length > 0 && (
            <div ref={listRef} className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
              {list.map((p, idx) => {
                const out = isOut(p);
                return (
                  <div
                    key={p.id}
                    data-index={idx}
                    onMouseEnter={() => setSelected(idx)}
                    className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                      idx === selected ? 'bg-teal-50 dark:bg-teal-950/60' : ''
                    } ${out ? 'opacity-60' : ''}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">{p.name}</span>
                        <ScheduleBadge schedule={p.schedule} />
                        {p.location_rack && <span className="px-1.5 py-0.5 text-2xs badge-warning">Loc: {p.location_rack}</span>}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {p.company_name || p.c_code} · {p.unit_type}, pack of {p.packing} ·{' '}
                        <span className={out ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-emerald-600 dark:text-emerald-400 font-semibold'}>
                          {out ? 'Out of stock' : `Stock: ${p.stock_boxes} Bx, ${p.stock_loose} Loose`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className="text-xs font-bold text-teal-700 dark:text-teal-400 font-mono">{money(p.box_retail_price)}<span className="text-2xs font-normal text-slate-400">/Bx</span></div>
                        <div className="text-2xs text-slate-500 dark:text-slate-400 font-mono">{money(p.unit_retail_price)}<span className="text-2xs font-normal text-slate-400">/Unit</span></div>
                      </div>
                      <button type="button" disabled={out} onClick={() => onAdd(p, false)} className="btn-primary btn-sm">+ Box</button>
                      {canSellLoose(p) && (
                        <button type="button" disabled={out} onClick={() => onAdd(p, true)} className="btn-secondary btn-sm">+ Loose</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="field-hint">↑/↓ choose, Enter adds a box, Esc closes.</p>
        </div>
      )}
    </Modal>
  );
};
