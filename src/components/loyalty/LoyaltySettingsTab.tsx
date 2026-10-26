import React, { useEffect, useState } from 'react';
import { AlertTriangle, Archive, Award, CheckCircle2, Edit2, Plus, RotateCcw, Star, Trash2 } from 'lucide-react';
import { api } from '../../services/apiService';
import { LoyaltyPlan, LoyaltyPlanInput, LoyaltyTemplate, SystemSettings } from '../../types';
import { Modal } from '../common/Modal';
import { planExample, planRulesError, LOYALTY_PLAN_NAME_MAX } from '../../../shared/loyalty';
import { planRulesOf } from '../../utils/loyalty';

interface LoyaltySettingsTabProps {
  settings?: SystemSettings | null;
  money: (value: number) => string;
  onRefreshSettings?: () => void;
}

const BLANK_PLAN: LoyaltyPlanInput = {
  name: '',
  points_per_100: 1,
  point_value: 1,
  min_bill_to_earn: 100,
  discount_pct: 0,
  min_redeem_points: 50,
  max_redeem_pct: 20,
  expiry_months: 12,
  earn_on_credit: false,
  upgrade_spend: 0,
  is_default: false
};

const inputOf = (p: LoyaltyPlan | LoyaltyTemplate, isDefault = false): LoyaltyPlanInput => ({
  name: p.name,
  points_per_100: p.points_per_100,
  point_value: p.point_value,
  min_bill_to_earn: p.min_bill_to_earn,
  discount_pct: p.discount_pct,
  min_redeem_points: p.min_redeem_points,
  max_redeem_pct: p.max_redeem_pct,
  expiry_months: p.expiry_months,
  earn_on_credit: p.earn_on_credit,
  upgrade_spend: p.upgrade_spend,
  is_default: 'is_default' in p ? p.is_default : isDefault
});

/** Settings → Loyalty: the on/off switch, member plans, and ready-made templates to start from */
export const LoyaltySettingsTab: React.FC<LoyaltySettingsTabProps> = ({ settings, money, onRefreshSettings }) => {
  const [plans, setPlans] = useState<LoyaltyPlan[]>([]);
  const [templates, setTemplates] = useState<LoyaltyTemplate[]>([]);
  const [enabled, setEnabled] = useState(settings?.loyalty_enabled === 'true');
  const [editing, setEditing] = useState<{ id: number | null; form: LoyaltyPlanInput } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => setEnabled(settings?.loyalty_enabled === 'true'), [settings?.loyalty_enabled]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, t] = await Promise.all([api.getLoyaltyPlans(), api.getLoyaltyTemplates()]);
      setPlans(p);
      setTemplates(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Loyalty plans could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  };

  const activePlans = plans.filter(p => p.status === 'active');

  const toggle = async (on: boolean) => {
    if (on && activePlans.length === 0) return setError('Add at least one plan before switching loyalty points on.');
    setBusy(true);
    setError(null);
    try {
      await api.saveSettings({ loyalty_enabled: on ? 'true' : 'false' });
      setEnabled(on);
      onRefreshSettings?.();
      flash(on ? 'Loyalty points are on. Saved customers now earn and use points at the counter.' : 'Loyalty points are off. Points already earned are kept.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The setting could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const savePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const problem = planRulesError(planRulesOf(editing.form));
    if (problem) return setFormError(problem);
    setBusy(true);
    setFormError(null);
    try {
      if (editing.id) await api.updateLoyaltyPlan(editing.id, editing.form);
      else await api.createLoyaltyPlan(editing.form);
      flash(`Plan "${editing.form.name.trim()}" saved.`);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'The plan could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const addTemplate = async (t: LoyaltyTemplate) => {
    setBusy(true);
    setError(null);
    try {
      await api.createLoyaltyPlan(inputOf(t, activePlans.length === 0));
      flash(`Plan "${t.name}" added. Change any rule with Edit.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plan could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      flash(message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof LoyaltyPlanInput>(key: K, value: LoyaltyPlanInput[K]) =>
    setEditing(prev => (prev ? { ...prev, form: { ...prev.form, [key]: value } } : prev));
  const num = (value: string) => (value === '' ? 0 : Number(value));

  const usedNames = new Set(plans.map(p => p.name.trim().toLowerCase()));

  return (
    <div className="space-y-5">
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

      {/* On / off */}
      <section className="card-premium p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-500" />
            Loyalty points
            <span className={enabled ? 'badge-success' : 'badge-warning'}>{enabled ? 'On' : 'Off'}</span>
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Saved customers earn points on every paid bill and use them for money off later. Each customer follows one plan below;
            a customer without a plan follows the default plan. Turning this off stops earning and using points; nothing is deleted.
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={enabled} disabled={busy} onChange={e => toggle(e.target.checked)} className="sr-only peer" aria-label="Loyalty points on" />
          <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
        </label>
      </section>

      {/* Plans */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Plans</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">The default plan is given to every new customer. Customers move up on their own when a plan has a buying target.</p>
          </div>
          <button type="button" onClick={() => { setFormError(null); setEditing({ id: null, form: { ...BLANK_PLAN, is_default: activePlans.length === 0 } }); }} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" />
            <span>New plan</span>
          </button>
        </div>

        {loading ? (
          <p className="card-premium py-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading plans…</p>
        ) : plans.length === 0 ? (
          <p className="card-premium py-10 text-center text-sm text-slate-500 dark:text-slate-400">No plans yet. Start from a template below, or make a new plan.</p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {plans.map(plan => (
              <article key={plan.id} className={`card-premium p-4 space-y-3 ${plan.status === 'archived' ? 'opacity-70' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      {plan.name}
                      {plan.is_default && <span className="badge-info">Default</span>}
                      {plan.status === 'archived' && <span className="badge-warning">Archived</span>}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{plan.members ?? 0} customer(s) on this plan</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => { setFormError(null); setEditing({ id: plan.id, form: inputOf(plan) }); }} className="btn-secondary btn-sm" aria-label={`Edit ${plan.name}`}>
                      <Edit2 className="w-4 h-4" />
                      <span>Edit</span>
                    </button>
                    {plan.status === 'active' && !plan.is_default && (
                      <button type="button" disabled={busy} onClick={() => run(() => api.updateLoyaltyPlan(plan.id, { ...inputOf(plan), is_default: true }), `"${plan.name}" is now the default plan.`)} className="btn-secondary btn-sm">
                        <Star className="w-4 h-4" />
                        <span>Make default</span>
                      </button>
                    )}
                    {plan.status === 'active' && !plan.is_default && (
                      <button type="button" disabled={busy} onClick={() => run(() => api.archiveLoyaltyPlan(plan.id), `"${plan.name}" archived. Its members keep it; no one new joins.`)} className="btn-secondary btn-sm" aria-label={`Archive ${plan.name}`}>
                        <Archive className="w-4 h-4" />
                      </button>
                    )}
                    {plan.status === 'archived' && (
                      <button type="button" disabled={busy} onClick={() => run(() => api.archiveLoyaltyPlan(plan.id, true), `"${plan.name}" is active again.`)} className="btn-secondary btn-sm">
                        <RotateCcw className="w-4 h-4" />
                        <span>Restore</span>
                      </button>
                    )}
                    {!plan.is_default && (plan.members ?? 0) === 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => window.confirm(`Delete the plan "${plan.name}"?`) && run(() => api.deleteLoyaltyPlan(plan.id), `"${plan.name}" deleted.`)}
                        className="btn-danger btn-sm"
                        aria-label={`Delete ${plan.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                  <div><dt className="text-slate-500 dark:text-slate-400">Earns</dt><dd className="font-semibold text-slate-900 dark:text-white">{plan.points_per_100} pt per {money(100)}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">1 point is worth</dt><dd className="font-semibold text-slate-900 dark:text-white">{money(plan.point_value)}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Member discount</dt><dd className="font-semibold text-slate-900 dark:text-white">{plan.discount_pct ? `${plan.discount_pct}%` : 'None'}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Smallest bill</dt><dd className="font-semibold text-slate-900 dark:text-white">{plan.min_bill_to_earn ? money(plan.min_bill_to_earn) : 'Any'}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Use points</dt><dd className="font-semibold text-slate-900 dark:text-white">From {plan.min_redeem_points}, up to {plan.max_redeem_pct}% of a bill</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Expiry</dt><dd className="font-semibold text-slate-900 dark:text-white">{plan.expiry_months ? `${plan.expiry_months} months` : 'Never'}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Udhaar sales</dt><dd className="font-semibold text-slate-900 dark:text-white">{plan.earn_on_credit ? 'Earn points' : 'No points'}</dd></div>
                  <div className="col-span-2"><dt className="text-slate-500 dark:text-slate-400">Automatic move up</dt><dd className="font-semibold text-slate-900 dark:text-white">{plan.upgrade_spend ? `After ${money(plan.upgrade_spend)} of buying in 12 months` : 'Off (given by hand)'}</dd></div>
                </dl>
                <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-surface-inset-dark rounded-lg px-3 py-2">{planExample(planRulesOf(plan), money)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Templates */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Start from a template</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Ready-made plans used by many pharmacies. Add one, then change any rule with Edit.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {templates.map(t => {
            const added = usedNames.has(t.name.toLowerCase());
            return (
              <article key={t.key} className="card-premium p-4 flex flex-col gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t.name}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 flex-1">{t.description}</p>
                <button type="button" disabled={busy || added} onClick={() => addTemplate(t)} className={added ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}>
                  {added ? 'Added' : 'Add this plan'}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {/* Plan form */}
      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit plan: ${editing.form.name}` : 'New loyalty plan'} maxWidth="max-w-2xl">
        {editing && (
          <form onSubmit={savePlan} className="space-y-4">
            <div>
              <label className="field-label" htmlFor="plan-name">Plan name</label>
              <input id="plan-name" value={editing.form.name} maxLength={LOYALTY_PLAN_NAME_MAX} onChange={e => set('name', e.target.value)} placeholder="e.g. Gold, Chronic Care" className="field-input w-full" autoFocus />
            </div>

            <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <legend className="text-sm font-bold text-slate-900 dark:text-white mb-2">Earning</legend>
              <div>
                <label className="field-label" htmlFor="plan-rate">Points per {money(100)} paid</label>
                <input id="plan-rate" type="number" min="0" max="100" step="0.1" value={editing.form.points_per_100} onChange={e => set('points_per_100', num(e.target.value))} className="field-input w-full font-mono" />
              </div>
              <div>
                <label className="field-label" htmlFor="plan-min-bill">Smallest bill that earns</label>
                <input id="plan-min-bill" type="number" min="0" step="1" value={editing.form.min_bill_to_earn} onChange={e => set('min_bill_to_earn', num(e.target.value))} className="field-input w-full font-mono" />
              </div>
              <div>
                <label className="field-label" htmlFor="plan-expiry">Points expire after (months)</label>
                <input id="plan-expiry" type="number" min="0" max="120" step="1" value={editing.form.expiry_months} onChange={e => set('expiry_months', Math.round(num(e.target.value)))} className="field-input w-full font-mono" />
                <p className="field-hint">0 = never expire</p>
              </div>
              <label className="sm:col-span-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={editing.form.earn_on_credit} onChange={e => set('earn_on_credit', e.target.checked)} />
                Udhaar (credit) sales also earn points
              </label>
            </fieldset>

            <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <legend className="text-sm font-bold text-slate-900 dark:text-white mb-2">Using points</legend>
              <div>
                <label className="field-label" htmlFor="plan-value">1 point is worth</label>
                <input id="plan-value" type="number" min="0.01" max="1000" step="0.01" value={editing.form.point_value} onChange={e => set('point_value', num(e.target.value))} className="field-input w-full font-mono" />
              </div>
              <div>
                <label className="field-label" htmlFor="plan-min-redeem">Fewest points to use</label>
                <input id="plan-min-redeem" type="number" min="0" step="1" value={editing.form.min_redeem_points} onChange={e => set('min_redeem_points', Math.round(num(e.target.value)))} className="field-input w-full font-mono" />
              </div>
              <div>
                <label className="field-label" htmlFor="plan-max-redeem">Points can pay up to (% of bill)</label>
                <input id="plan-max-redeem" type="number" min="0" max="100" step="1" value={editing.form.max_redeem_pct} onChange={e => set('max_redeem_pct', num(e.target.value))} className="field-input w-full font-mono" />
              </div>
            </fieldset>

            <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <legend className="text-sm font-bold text-slate-900 dark:text-white mb-2">Member benefits</legend>
              <div>
                <label className="field-label" htmlFor="plan-discount">Member discount on every bill (%)</label>
                <input id="plan-discount" type="number" min="0" max="100" step="0.5" value={editing.form.discount_pct} onChange={e => set('discount_pct', num(e.target.value))} className="field-input w-full font-mono" />
                <p className="field-hint">Given on its own at the counter. With any bill discount it stays within the store maximum ({settings?.max_bill_discount_pct || '14'}%).</p>
              </div>
              <div>
                <label className="field-label" htmlFor="plan-upgrade">Move customers up to this plan after buying</label>
                <input id="plan-upgrade" type="number" min="0" step="100" value={editing.form.upgrade_spend} onChange={e => set('upgrade_spend', num(e.target.value))} className="field-input w-full font-mono" />
                <p className="field-hint">Total of the last 12 months. 0 = only given by hand. Customers never move down on their own.</p>
              </div>
              <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={editing.form.is_default} onChange={e => set('is_default', e.target.checked)} />
                Default plan for new customers
              </label>
            </fieldset>

            {editing.form.name.trim() && !planRulesError(planRulesOf(editing.form)) && (
              <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-surface-inset-dark rounded-lg px-3 py-2">{planExample(planRulesOf(editing.form), money)}</p>
            )}

            {formError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save plan'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
