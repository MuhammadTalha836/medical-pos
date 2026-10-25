import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CreditCard, Plus, Users } from 'lucide-react';
import { api } from '../services/apiService';
import { Customer, SystemSettings } from '../types';
import { Modal } from '../components/common/Modal';
import { useAuthStore } from '../store/useAuthStore';
import { currencySymbol, moneyFormatter } from '../utils/format';
import { CustomersTab } from '../components/customers/CustomersTab';
import { KhataTab } from '../components/customers/KhataTab';
import { CustomerFormModal } from '../components/customers/CustomerFormModal';
import { InvoiceModal } from '../components/customers/InvoiceModal';
import { LedgerState, isLoadedLedger } from '../components/customers/CustomerInvoiceList';

interface CustomersPageProps {
  settings?: SystemSettings | null;
}

type CustomersTabKey = 'customers' | 'khata';

// Customers and their khata (udhaar): one list, with each customer's invoices and payments
export const CustomersPage: React.FC<CustomersPageProps> = ({ settings }) => {
  const { hasPermission } = useAuthStore();
  const [tab, setTab] = useState<CustomersTabKey>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();

  // Each customer's invoices and payments, loaded when a row is expanded
  const [ledgers, setLedgers] = useState<Record<number, LedgerState>>({});
  const ledgersRef = useRef(ledgers);
  ledgersRef.current = ledgers;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [openSaleId, setOpenSaleId] = useState<number | null>(null);

  const money = moneyFormatter(settings);
  const currency = currencySymbol(settings);

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setCustomers(await api.getCustomers());
    } catch (err) {
      console.error('Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadCustomers(); }, [loadCustomers]);

  const loadLedger = useCallback((customerId: number, force = false) => {
    // Loaded once per visit; a failed load is retried, and `force` refreshes while keeping the old rows on screen
    const current = ledgersRef.current[customerId];
    const failed = typeof current === 'object' && 'error' in current;
    if (!force && current !== undefined && !failed) return;
    setLedgers(prev => ({ ...prev, [customerId]: force && isLoadedLedger(prev[customerId]) ? prev[customerId] : 'loading' }));
    api.getCustomerLedger(customerId)
      .then(data => setLedgers(prev => ({ ...prev, [customerId]: data })))
      .catch(err => setLedgers(prev => ({ ...prev, [customerId]: { error: err.message || 'Could not load the invoices' } })));
  }, []);

  const showNotice = (message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  };

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setFormOpen(true);
  };

  const askDelete = (customer: Customer) => {
    setDeleteError(null);
    setDeleting(customer);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      setDeleteBusy(true);
      setDeleteError(null);
      await api.deleteCustomer(deleting.id);
      showNotice(`Customer "${deleting.name}" deleted.`);
      setDeleting(null);
      void loadCustomers();
    } catch (err: any) {
      // e.g. "<name> has 3 invoice(s). Customers with history cannot be deleted."
      setDeleteError(err.message || 'The customer could not be deleted');
    } finally {
      setDeleteBusy(false);
    }
  };

  const tabs: { key: CustomersTabKey; label: string; icon: React.ElementType }[] = [
    { key: 'customers', label: 'Customers', icon: Users },
    { key: 'khata', label: 'Khata (Udhaar)', icon: CreditCard }
  ];

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Customers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Your customer list, what each customer bought, and their khata (udhaar).
          </p>
        </div>
        {hasPermission('can_add_customer') && (
          <button type="button" onClick={openAdd} className="btn-primary self-start sm:self-auto">
            <Plus className="w-4 h-4" />
            <span>Add Customer</span>
          </button>
        )}
      </div>

      {notice && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800" role="tablist">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
              tab === t.key
                ? 'border-teal-500 text-teal-700 dark:text-teal-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'customers' ? (
        <CustomersTab
          customers={customers}
          loading={loading}
          money={money}
          ledgers={ledgers}
          loadLedger={loadLedger}
          onOpenInvoice={setOpenSaleId}
          onEdit={hasPermission('can_edit_customer') ? openEdit : undefined}
          onDelete={hasPermission('can_delete_customer') ? askDelete : undefined}
        />
      ) : (
        <KhataTab
          customers={customers}
          settings={settings}
          loading={loading}
          money={money}
          currency={currency}
          ledgers={ledgers}
          loadLedger={loadLedger}
          onOpenInvoice={setOpenSaleId}
          canReceivePayment={hasPermission('can_receive_payment')}
          onPaymentRecorded={message => {
            showNotice(message);
            void loadCustomers();
          }}
        />
      )}

      <CustomerFormModal
        isOpen={formOpen}
        customer={editing}
        currency={currency}
        onClose={() => setFormOpen(false)}
        onSaved={message => {
          setFormOpen(false);
          showNotice(message);
          void loadCustomers();
        }}
      />

      <Modal isOpen={deleting !== null} onClose={() => setDeleting(null)} title="Delete customer?" maxWidth="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Delete <strong>{deleting?.name}</strong> ({deleting?.phone || 'no phone'})? This cannot be undone.
            Customers who have invoices, payments or udhaar cannot be deleted.
          </p>
          {deleteError && <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">{deleteError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleting(null)} className="btn-secondary">Keep Customer</button>
            <button type="button" onClick={() => void confirmDelete()} disabled={deleteBusy} className="btn-danger">
              {deleteBusy ? 'Deleting…' : 'Delete Customer'}
            </button>
          </div>
        </div>
      </Modal>

      <InvoiceModal saleId={openSaleId} settings={settings} onClose={() => setOpenSaleId(null)} />
    </div>
  );
};
