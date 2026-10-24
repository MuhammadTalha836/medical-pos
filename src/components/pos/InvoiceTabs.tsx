import React from 'react';
import { Plus, X } from 'lucide-react';
import { usePosStore, MAX_OPEN_INVOICES } from '../../store/usePosStore';

interface InvoiceTabsProps {
  onNew: () => void;
  onSwitch: (id: string) => void;
  /** Asks before closing a tab that still has items */
  onClose: (id: string) => void;
}

// Open invoices as tabs, so a paused customer's order waits while the next customer is served
export const InvoiceTabs: React.FC<InvoiceTabsProps> = ({ onNew, onSwitch, onClose }) => {
  const invoices = usePosStore(s => s.invoices);
  const activeId = usePosStore(s => s.activeId);
  const activeCart = usePosStore(s => s.cart);
  const activeCustomer = usePosStore(s => s.customerName);

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="flex items-center gap-1.5 overflow-x-auto min-w-0" role="tablist" aria-label="Open invoices">
        {invoices.map((tab, index) => {
          const isActive = tab.id === activeId;
          const cart = isActive ? activeCart : tab.draft.cart;
          const customer = (isActive ? activeCustomer : tab.draft.customerName).trim();
          const showCustomer = customer && customer !== 'Counter Customer';
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              title={index < 9 ? `Ctrl+${index + 1}` : undefined}
              onClick={() => onSwitch(tab.id)}
              className={`group flex items-center gap-2 h-10 pl-3 pr-1.5 rounded-lg border text-sm cursor-pointer shrink-0 transition-colors ${
                isActive
                  ? 'bg-teal-700 border-teal-700 text-white dark:bg-teal-600 dark:border-teal-600'
                  : 'bg-white dark:bg-[#111827] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-teal-500'
              }`}
            >
              <span className="font-semibold whitespace-nowrap">{tab.label}</span>
              {showCustomer && <span className={`max-w-28 truncate ${isActive ? 'text-teal-50' : 'text-slate-500 dark:text-slate-400'}`}>{customer}</span>}
              <span className={`min-w-6 px-1.5 rounded-md text-xs font-bold text-center ${
                isActive ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}>
                {cart.length}
              </span>
              <button
                type="button"
                aria-label={`Close ${tab.label}`}
                title="Close invoice (Ctrl+W)"
                onClick={e => { e.stopPropagation(); onClose(tab.id); }}
                className={`p-1 rounded-md ${isActive ? 'hover:bg-white/20' : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40'}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onNew}
        disabled={invoices.length >= MAX_OPEN_INVOICES}
        title={invoices.length >= MAX_OPEN_INVOICES ? `Up to ${MAX_OPEN_INVOICES} invoices can be open` : 'New invoice (F2 or Ctrl+T)'}
        className="btn-secondary btn-sm shrink-0"
      >
        <Plus className="w-4 h-4" />
        <span>New</span>
        <kbd className="px-1.5 text-2xs font-mono font-bold bg-slate-100 dark:bg-slate-800 rounded-sm border border-slate-300 dark:border-slate-700">F2</kbd>
      </button>
    </div>
  );
};
