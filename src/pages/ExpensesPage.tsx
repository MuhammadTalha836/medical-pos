import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, Lock, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { api } from '../services/apiService';
import { useAuthStore } from '../store/useAuthStore';
import { Expense, ExpenseInput, ExpenseList, SystemSettings } from '../types';
import { moneyFormatter } from '../utils/format';
import { localDateString } from '../../shared/dates';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_MAX,
  EXPENSE_PAYMENT_LABELS,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_TEXT_MAX,
  type ExpensePaymentMethod
} from '../../shared/expenses';

interface ExpensesPageProps {
  settings?: SystemSettings | null;
}

interface FormState {
  category: string;
  amount: string;
  payment_method: ExpensePaymentMethod;
  expense_date: string;
  reference: string;
  notes: string;
}

const emptyForm = (): FormState => ({
  category: '',
  amount: '',
  payment_method: 'cash',
  expense_date: localDateString(),
  reference: '',
  notes: ''
});

const firstOfMonth = () => `${localDateString().slice(0, 8)}01`;

/** Shop expenses: record what the store spends; cash paid during a shift comes out of that shift's drawer */
export const ExpensesPage: React.FC<ExpensesPageProps> = ({ settings }) => {
  const { hasPermission } = useAuthStore();
  const canAdd = hasPermission('can_add_expense');
  const money = moneyFormatter(settings);

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(localDateString);
  const [category, setCategory] = useState('');
  const [list, setList] = useState<ExpenseList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setList(await api.getExpenses({ date_from: dateFrom, date_to: dateTo, ...(category ? { category } : {}) }));
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || 'Expenses could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const categories = list?.categories ?? DEFAULT_EXPENSE_CATEGORIES;
  const byCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of list?.expenses ?? []) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(prev => ({ ...prev, [key]: value }));

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (expense: Expense) => {
    setEditingId(expense.id);
    setForm({
      category: expense.category,
      amount: String(expense.amount),
      payment_method: expense.payment_method,
      expense_date: expense.expense_date,
      reference: expense.reference ?? '',
      notes: expense.notes ?? ''
    });
    setFormError(null);
    setFeedback(null);
  };

  const showFeedback = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(current => (current === message ? null : current)), 4000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.category.trim()) return setFormError('Choose or type a category.');
    if (!Number.isFinite(amount) || amount <= 0) return setFormError('Enter the amount spent.');
    const data: ExpenseInput = {
      category: form.category.trim(),
      amount,
      payment_method: form.payment_method,
      expense_date: form.expense_date,
      reference: form.reference.trim() || undefined,
      notes: form.notes.trim() || undefined
    };
    try {
      setSaving(true);
      setFormError(null);
      if (editingId) {
        await api.updateExpense(editingId, data);
        showFeedback('Expense updated.');
      } else {
        const result = await api.createExpense(data);
        showFeedback(result.shift_id ? `Expense saved. ${money(amount)} was taken out of your shift's cash.` : 'Expense saved.');
      }
      resetForm();
      await load();
    } catch (err: any) {
      setFormError(err.message || 'The expense could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (expense: Expense) => {
    if (!window.confirm(`Delete the ${expense.category} expense of ${money(expense.amount)} on ${expense.expense_date}?`)) return;
    try {
      await api.deleteExpense(expense.id);
      if (editingId === expense.id) resetForm();
      showFeedback('Expense deleted.');
      await load();
    } catch (err: any) {
      setLoadError(err.message || 'The expense could not be deleted.');
    }
  };

  const today = localDateString();
  const showUser = list?.sees_all ?? false;
  const columns = showUser ? 7 : 6;

  return (
    <div className="page-container">
      <div className="pb-2 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Shop Expenses</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Rent, bills, wages and other spending. Cash paid during your shift comes out of your shift's cash.
        </p>
      </div>

      {feedback && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium" role="status">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      <div className={`grid gap-5 ${canAdd ? 'lg:grid-cols-[22rem_1fr]' : ''}`}>
        {canAdd && (
          <form onSubmit={handleSubmit} className="card-premium p-4 space-y-3 self-start" noValidate>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{editingId ? 'Edit expense' : 'Add expense'}</h2>

            <div>
              <label htmlFor="expense-category" className="field-label">Category</label>
              <input
                id="expense-category"
                list="expense-categories"
                value={form.category}
                maxLength={EXPENSE_CATEGORY_MAX}
                onChange={e => setField('category', e.target.value)}
                placeholder="e.g. Electricity"
                className="field-input"
                autoComplete="off"
              />
              <datalist id="expense-categories">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="expense-amount" className="field-label">Amount</label>
                <input
                  id="expense-amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={e => setField('amount', e.target.value)}
                  className="field-input font-mono"
                />
              </div>
              <div>
                <label htmlFor="expense-method" className="field-label">Paid by</label>
                <select
                  id="expense-method"
                  value={form.payment_method}
                  onChange={e => setField('payment_method', e.target.value as ExpensePaymentMethod)}
                  className="field-select"
                >
                  {EXPENSE_PAYMENT_METHODS.map(m => <option key={m} value={m}>{EXPENSE_PAYMENT_LABELS[m]}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="expense-date" className="field-label">Date</label>
              <input
                id="expense-date"
                type="date"
                max={today}
                value={form.expense_date}
                onChange={e => setField('expense_date', e.target.value)}
                className="field-input font-mono"
              />
              {form.payment_method === 'cash' && form.expense_date === today && (
                <p className="field-hint">Cash today is taken out of your open shift's cash, if you have one.</p>
              )}
            </div>

            <div>
              <label htmlFor="expense-reference" className="field-label">Bill or receipt no. (optional)</label>
              <input
                id="expense-reference"
                value={form.reference}
                maxLength={60}
                onChange={e => setField('reference', e.target.value)}
                className="field-input"
              />
            </div>

            <div>
              <label htmlFor="expense-notes" className="field-label">Notes (optional)</label>
              <textarea
                id="expense-notes"
                rows={2}
                value={form.notes}
                maxLength={EXPENSE_TEXT_MAX}
                onChange={e => setField('notes', e.target.value)}
                className="field-textarea"
              />
            </div>

            {formError && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                <span>{formError}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="btn-primary flex-1">
                {editingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                <span>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add expense'}</span>
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} className="btn-secondary">
                  <X className="w-4 h-4" />
                  <span>Cancel</span>
                </button>
              )}
            </div>
          </form>
        )}

        <div className="space-y-4 min-w-0">
          <div className="card-premium p-3.5 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-600 dark:text-slate-400 font-semibold flex items-center gap-1">
              <Calendar className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>Dates:</span>
            </span>
            <input type="date" aria-label="From date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} className="field-input field-sm font-mono" />
            <span className="text-slate-400">to</span>
            <input type="date" aria-label="To date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} className="field-input field-sm font-mono" />
            <select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} className="field-select field-sm">
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" onClick={load} className="btn-primary btn-sm">Apply Filter</button>
            <span className="ml-auto text-sm font-bold text-slate-900 dark:text-white">
              Total: <span className="font-mono">{money(list?.total ?? 0)}</span>
            </span>
          </div>

          {loadError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300" role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">{loadError}</span>
              <button type="button" onClick={load} className="btn-secondary btn-sm">Try again</button>
            </div>
          )}

          {byCategory.length > 1 && (
            <div className="flex flex-wrap gap-2" aria-label="Spending by category">
              {byCategory.map(([name, amount]) => (
                <span key={name} className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{name}</span>{' '}
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">{money(amount)}</span>
                </span>
              ))}
            </div>
          )}

          <div className="card-premium overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-3">Paid by</th>
                    <th className="py-2.5 px-3">Details</th>
                    {showUser && <th className="py-2.5 px-3">Recorded by</th>}
                    <th className="py-2.5 px-3 text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {loading ? (
                    <tr><td colSpan={columns} className="py-12 text-center text-slate-500 dark:text-slate-400">Loading expenses…</td></tr>
                  ) : !list || list.expenses.length === 0 ? (
                    <tr>
                      <td colSpan={columns} className="py-12 text-center text-slate-500 dark:text-slate-400">
                        No expenses in these dates.{canAdd ? ' Add one with the form.' : ''}
                      </td>
                    </tr>
                  ) : (
                    list.expenses.map(expense => (
                      <tr key={expense.id} className={`align-top ${editingId === expense.id ? 'bg-teal-50 dark:bg-teal-950/30' : ''}`}>
                        <td className="py-2.5 px-3 font-mono whitespace-nowrap">{expense.expense_date}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{expense.category}</td>
                        <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">{money(expense.amount)}</td>
                        <td className="py-2.5 px-3">
                          {EXPENSE_PAYMENT_LABELS[expense.payment_method] ?? expense.payment_method}
                          {expense.shift_no && <div className="text-2xs text-slate-500 dark:text-slate-400 font-mono">Shift {expense.shift_no}</div>}
                        </td>
                        <td className="py-2.5 px-3 max-w-64">
                          {expense.reference && <div className="font-mono">{expense.reference}</div>}
                          {expense.notes && <div className="text-slate-500 dark:text-slate-400">{expense.notes}</div>}
                          {!expense.reference && !expense.notes && <span className="text-slate-400">-</span>}
                        </td>
                        {showUser && <td className="py-2.5 px-3">{expense.user_name || '-'}</td>}
                        <td className="py-2.5 px-3">
                          {expense.locked_reason ? (
                            <span className="flex justify-end text-slate-400" title={expense.locked_reason}>
                              <Lock className="w-4 h-4" aria-label={expense.locked_reason} />
                            </span>
                          ) : canAdd ? (
                            <div className="flex justify-end gap-1.5">
                              <button type="button" onClick={() => startEdit(expense)} className="btn-secondary btn-sm" aria-label={`Edit ${expense.category} expense`}>
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => handleDelete(expense)} className="btn-danger btn-sm" aria-label={`Delete ${expense.category} expense`}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {list?.expenses.some(e => e.locked_reason) && (
            <p className="field-hint flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>Locked rows belong to a closed day or a closed shift. Hover the lock to see which.</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
