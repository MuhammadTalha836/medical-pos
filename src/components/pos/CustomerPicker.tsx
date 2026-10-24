import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Phone, Search, User, UserPlus, X } from 'lucide-react';
import { api, ApiError } from '../../services/apiService';
import { Customer } from '../../types';
import { COUNTER_CUSTOMER, isCounterCustomer, isValidPhone, normalizePhone } from '../../../shared/customers';

interface CustomerPickerProps {
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  /** Updates the active invoice: id is set only for a saved (khata) customer */
  onChange: (id: number | null, name: string, phone: string) => void;
  /** Focused by F4 */
  nameInputRef: React.RefObject<HTMLInputElement>;
  canAddCustomer: boolean;
  /** Amount this invoice adds to the khata (net total on a Credit sale, otherwise 0) */
  creditAmount: number;
  money: (value: number) => string;
}

// Customer field at the POS: type a name or phone to find a saved customer, or save a new one
export const CustomerPicker: React.FC<CustomerPickerProps> = ({
  customerId,
  customerName,
  customerPhone,
  onChange,
  nameInputRef,
  canAddCustomer,
  creditAmount,
  money
}) => {
  const [results, setResults] = useState<Customer[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [phoneOwner, setPhoneOwner] = useState<Customer | null>(null);
  const searchSeq = useRef(0);

  const typedName = customerName.trim();
  const phoneDigits = normalizePhone(customerPhone);

  // Details (balance, limit) of the linked customer, e.g. after switching invoice tabs
  useEffect(() => {
    if (!customerId) {
      setSelected(null);
      return;
    }
    if (selected?.id === customerId) return;
    let cancelled = false;
    api.searchCustomers(customerPhone || customerName)
      .then(list => { if (!cancelled) setSelected(list.find(c => c.id === customerId) ?? null); })
      .catch(() => { /* details are informational; the server checks the sale */ });
    return () => { cancelled = true; };
  }, [customerId]); // only when the linked customer changes

  // Look up matches while an unlinked name or phone is typed
  useEffect(() => {
    if (customerId || (isCounterCustomer(typedName) && phoneDigits.length < 3)) {
      setResults([]);
      setPhoneOwner(null);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const queries = [!isCounterCustomer(typedName) && typedName.length >= 2 ? typedName : '', phoneDigits.length >= 3 ? phoneDigits : '']
          .filter(Boolean);
        const lists = await Promise.all(queries.map(q => api.searchCustomers(q)));
        if (seq !== searchSeq.current) return;
        const merged = new Map<number, Customer>();
        for (const c of lists.flat()) merged.set(c.id, c);
        const list = [...merged.values()].slice(0, 8);
        setResults(list);
        setHighlight(0);
        setPhoneOwner(phoneDigits ? list.find(c => normalizePhone(c.phone) === phoneDigits) ?? null : null);
      } catch {
        if (seq === searchSeq.current) setResults([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [typedName, phoneDigits, customerId]);

  const select = (c: Customer) => {
    setSelected(c);
    setOpen(false);
    setMessage(null);
    setPhoneOwner(null);
    onChange(c.id, c.name, c.phone || '');
  };

  const clearToCounter = () => {
    setSelected(null);
    setMessage(null);
    onChange(null, COUNTER_CUSTOMER, '');
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
  };

  const saveCustomer = async () => {
    setMessage(null);
    try {
      setSaving(true);
      const res = await api.createCustomer({ name: typedName, phone: customerPhone.trim() });
      select(res.customer);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data?.customer) {
        setPhoneOwner(err.data.customer);
      } else {
        setMessage(err instanceof Error ? err.message : 'Could not save the customer');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(i => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(i => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(results[highlight]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    }
  };

  // A saved customer with exactly this name and phone means "use it", not "save a copy"
  const exactMatch = results.find(c => c.name.trim().toLowerCase() === typedName.toLowerCase() && (!phoneDigits || normalizePhone(c.phone) === phoneDigits));
  const isNewName = !customerId && !isCounterCustomer(typedName) && typedName.length >= 2 && !exactMatch;
  const phoneOk = isValidPhone(customerPhone);

  const balance = selected?.current_balance ?? 0;
  const limit = selected?.credit_limit ?? 0;
  const balanceAfter = balance + creditAmount;
  const overLimit = limit > 0 && creditAmount > 0 && balanceAfter > limit + 0.005;

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={nameInputRef}
            type="text"
            value={customerName}
            onChange={e => {
              setOpen(true);
              setMessage(null);
              // Editing the name unlinks the saved customer; the cashier picks or saves again
              onChange(null, e.target.value, customerId ? '' : customerPhone);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={handleNameKeyDown}
            placeholder="Customer name or phone [F4]"
            aria-label="Customer name"
            className="field-input field-sm w-full pl-9"
          />
        </div>

        {open && results.length > 0 && !customerId && (
          <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {results.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => select(c)}
                className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 ${i === highlight ? 'bg-teal-50 dark:bg-teal-950/60' : 'hover:bg-slate-50 dark:hover:bg-[#162032]'}`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate">{c.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{c.phone || 'No phone'}</span>
                </span>
                <span className={`text-xs font-mono font-semibold shrink-0 ${c.current_balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
                  {money(c.current_balance)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {customerId ? (
        // Linked customer
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              Saved customer
            </span>
            <button type="button" onClick={clearToCounter} className="flex items-center gap-1 text-slate-500 hover:text-rose-500" title="Back to Counter Customer">
              <X className="w-4 h-4" />
              <span>Remove</span>
            </button>
          </div>
          <div className="flex items-center gap-1 text-slate-600 dark:text-slate-300 whitespace-nowrap">
            <Phone className="w-4 h-4 shrink-0" />{customerPhone || 'No phone'}
          </div>
          {selected && (
            <div className="text-slate-600 dark:text-slate-300">
              Khata balance: <strong className="font-mono">{money(balance)}</strong>
              {limit > 0 && <span className="text-slate-500"> (limit {money(limit)})</span>}
            </div>
          )}
          {selected && creditAmount > 0 && (
            <div className={`font-semibold ${overLimit ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200'}`}>
              {overLimit
                ? `Over the credit limit: available ${money(Math.max(0, limit - balance))}`
                : <>Balance after this sale: <span className="font-mono">{money(balanceAfter)}</span></>}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="relative">
            <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              inputMode="tel"
              value={customerPhone}
              onChange={e => { setMessage(null); onChange(null, customerName, e.target.value); }}
              placeholder={isNewName ? 'Phone number (required to save)' : 'Contact number (optional)'}
              aria-label="Customer phone"
              className="field-input field-sm w-full pl-9"
            />
          </div>

          {phoneOwner ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs flex items-center justify-between gap-2">
              <span className="text-amber-700 dark:text-amber-400">This phone belongs to <strong>{phoneOwner.name}</strong></span>
              <button type="button" onClick={() => select(phoneOwner)} className="btn-secondary btn-sm shrink-0">Use this customer</button>
            </div>
          ) : exactMatch ? (
            <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-xs flex items-center justify-between gap-2">
              <span className="text-teal-700 dark:text-teal-300">Already saved: <strong>{exactMatch.name}</strong> {exactMatch.phone && `(${exactMatch.phone})`}</span>
              <button type="button" onClick={() => select(exactMatch)} className="btn-secondary btn-sm shrink-0">Select</button>
            </div>
          ) : isNewName ? (
            canAddCustomer ? (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <User className="w-4 h-4" />
                  New customer{!phoneOk && ' · add a phone to save'}
                </span>
                <button type="button" onClick={() => void saveCustomer()} disabled={!phoneOk || saving} className="btn-primary btn-sm shrink-0">
                  <UserPlus className="w-4 h-4" />
                  <span>{saving ? 'Saving…' : 'Save Customer'}</span>
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Not a saved customer. Ask an admin to add this customer for khata sales.</p>
            )
          ) : null}

          {message && (
            <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {message}
            </p>
          )}
        </>
      )}
    </div>
  );
};
