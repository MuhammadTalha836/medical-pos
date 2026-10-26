import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../services/apiService';
import { CustomerLoyalty, LoyaltyHistoryRow, LoyaltyPlan } from '../../types';
import { LOYALTY_NOTES_MAX } from '../../../shared/loyalty';

interface CustomerLoyaltyModalProps {
  customer: { id: number; name: string } | null;
  money: (value: number) => string;
  /** Can change the plan and adjust points (can_manage_loyalty) */
  canManage: boolean;
  onClose: () => void;
  /** Points or plan changed */
  onChanged?: () => void;
}

const TYPE_LABELS: Record<LoyaltyHistoryRow['type'], string> = {
  earn: 'Earned',
  redeem: 'Used on a bill',
  earn_reversed: 'Taken back (return)',
  redeem_refunded: 'Given back (return)',
  adjust: 'Changed by hand',
  expire: 'Expired',
  plan_change: 'Plan changed'
};

/** One customer's points: balance, plan, history, and (for managers) plan change and manual points */
export const CustomerLoyaltyModal: React.FC<CustomerLoyaltyModalProps> = ({ customer, money, canManage, onClose, onChanged }) => {
  const [data, setData] = useState<CustomerLoyalty | null>(null);
  const [plans, setPlans] = useState<LoyaltyPlan[]>([]);
  const [planChoice, setPlanChoice] = useState('');
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (id: number) => {
    setError(null);
    try {
      const info = await api.getCustomerLoyalty(id);
      setData(info);
      setPlanChoice(info.plan_assigned && info.plan ? String(info.plan.id) : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Points could not be loaded.');
    }
  };

  useEffect(() => {
    if (!customer) return;
    setData(null);
    setNotice(null);
    setPoints('');
    setReason('');
    void load(customer.id);
    if (canManage) api.getLoyaltyPlans().then(setPlans).catch(() => setPlans([]));
  }, [customer, canManage]);

  if (!customer) return null;

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  };

  const savePlan = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setCustomerPlan(customer.id, planChoice ? Number(planChoice) : null);
      flash('Plan saved.');
      await load(customer.id);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plan could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const adjust = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(points) || 0;
    if (amount <= 0) return setError('Enter the points to add or take off.');
    if (reason.trim().length < 3) return setError('Write why the points are changed.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.adjustLoyaltyPoints(customer.id, direction === 'add' ? amount : -amount, reason.trim());
      flash(`Points saved. Balance: ${res.points}.`);
      setPoints('');
      setReason('');
      await load(customer.id);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The points could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={!!customer} onClose={onClose} title={`Loyalty points: ${customer.name}`} maxWidth="max-w-3xl">
      <div className="space-y-4">
        {notice && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!data ? (
          !error && <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading points…</p>
        ) : (
          <>
            {!data.active && (
              <p className="text-xs text-amber-700 dark:text-amber-400">Loyalty points are switched off: no points are earned or used until they are switched on again.</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="card-premium p-3">
                <div className="text-2xs text-slate-500 dark:text-slate-400">Points</div>
                <div className="font-mono font-bold text-lg text-slate-900 dark:text-white">{data.points}</div>
                <div className="text-2xs text-slate-500 dark:text-slate-400">worth {money(data.points_value)}</div>
              </div>
              <div className="card-premium p-3">
                <div className="text-2xs text-slate-500 dark:text-slate-400">Plan</div>
                <div className="font-bold text-slate-900 dark:text-white">{data.plan?.name ?? 'None'}</div>
                <div className="text-2xs text-slate-500 dark:text-slate-400">{data.plan_assigned ? 'Given to this customer' : 'Default plan'}</div>
              </div>
              <div className="card-premium p-3">
                <div className="text-2xs text-slate-500 dark:text-slate-400">Bought in 12 months</div>
                <div className="font-mono font-bold text-slate-900 dark:text-white">{money(data.spend_12m)}</div>
              </div>
              <div className="card-premium p-3">
                <div className="text-2xs text-slate-500 dark:text-slate-400">Expiring in 30 days</div>
                <div className={`font-mono font-bold ${data.expiring_30d > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>{data.expiring_30d} points</div>
              </div>
            </div>

            {canManage && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="card-premium p-3 space-y-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Plan</h3>
                  <div className="flex gap-2">
                    <select value={planChoice} onChange={e => setPlanChoice(e.target.value)} aria-label="Plan for this customer" className="field-select field-sm flex-1">
                      <option value="">Default plan</option>
                      {plans.filter(p => p.status === 'active' || String(p.id) === planChoice).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button type="button" onClick={savePlan} disabled={busy} className="btn-primary btn-sm">Save plan</button>
                  </div>
                  <p className="field-hint">A plan with a buying target can still move this customer up later.</p>
                </div>
                <form onSubmit={adjust} className="card-premium p-3 space-y-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Change points by hand</h3>
                  <div className="flex gap-2">
                    <select value={direction} onChange={e => setDirection(e.target.value as 'add' | 'remove')} aria-label="Add or take off" className="field-select field-sm">
                      <option value="add">Add</option>
                      <option value="remove">Take off</option>
                    </select>
                    <input type="number" min="1" value={points} onChange={e => setPoints(e.target.value)} placeholder="Points" aria-label="Points" className="field-input field-sm w-24 font-mono" />
                  </div>
                  <input value={reason} maxLength={LOYALTY_NOTES_MAX} onChange={e => setReason(e.target.value)} placeholder="Reason, e.g. Eid gift or correction" aria-label="Reason" className="field-input field-sm w-full" />
                  <button type="submit" disabled={busy} className="btn-primary btn-sm">Save points</button>
                </form>
              </div>
            )}

            <div className="card-premium overflow-hidden">
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-[#162032]">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">What</th>
                      <th className="py-2 px-3 text-right">Points</th>
                      <th className="py-2 px-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {data.history.length === 0 ? (
                      <tr><td colSpan={4} className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No points yet. Points are earned on paid bills.</td></tr>
                    ) : data.history.map(h => (
                      <tr key={h.id}>
                        <td className="py-2 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">{new Date(h.created_at).toLocaleString()}</td>
                        <td className="py-2 px-3">{TYPE_LABELS[h.type] ?? h.type}</td>
                        <td className={`py-2 px-3 text-right font-mono font-semibold ${h.points < 0 ? 'text-rose-600 dark:text-rose-400' : h.points > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                          {h.points > 0 ? '+' : ''}{h.type === 'plan_change' ? '' : h.points}
                        </td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                          {[h.invoice_no, h.notes, h.expires_at && h.remaining > 0 ? `${h.remaining} left, expires ${h.expires_at}` : null, h.user_name && h.user_name !== 'System' ? `by ${h.user_name}` : null].filter(Boolean).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
