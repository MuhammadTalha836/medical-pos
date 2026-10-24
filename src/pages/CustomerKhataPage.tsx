import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { Customer, SystemSettings } from '../types';
import { Modal } from '../components/common/Modal';
import { useAuthStore } from '../store/useAuthStore';
import { useShiftStore } from '../store/useShiftStore';
import {
  CreditCard,
  Search,
  Plus,
  DollarSign,
  UserCheck,
  CheckCircle2,
  FileText,
  Phone,
  MapPin,
} from 'lucide-react';
import { currencySymbol, moneyFormatter } from '../utils/format';

interface CustomerKhataPageProps {
  settings?: SystemSettings | null;
}

export const CustomerKhataPage: React.FC<CustomerKhataPageProps> = ({ settings }) => {
  const { hasPermission } = useAuthStore();
  const { activeShift, fetchShiftSummary } = useShiftStore();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    address: '',
    credit_limit: 10000
  });

  // Payment Modal
  const [selectedCustomerForPayment, setSelectedCustomerForPayment] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Card' | 'Online'>('Cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Ledger History Modal
  const [selectedCustomerForLedger, setSelectedCustomerForLedger] = useState<Customer | null>(null);
  const [ledgerData, setLedgerData] = useState<{ customer: Customer; sales: any[]; payments?: any[] } | null>(null);
  const [ledgerTab, setLedgerTab] = useState<'sales' | 'payments'>('sales');
  const [loadingLedger, setLoadingLedger] = useState(false);

  const [notification, setNotification] = useState<string | null>(null);
  const currency = currencySymbol(settings);
  const money = moneyFormatter(settings);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const data = await api.getCustomers();
      setCustomers(data);
    } catch (err) {
      console.error('Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.phone && c.phone.includes(searchQuery)) ||
    (c.address && c.address.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalOutstanding = customers.reduce((sum, c) => sum + (c.current_balance || 0), 0);
  const customersWithCredit = customers.filter(c => (c.current_balance || 0) > 0).length;

  const handleOpenAddCustomer = () => {
    setEditingCustomer(null);
    setCustomerForm({ name: '', phone: '', address: '', credit_limit: 10000 });
    setIsAddCustomerModalOpen(true);
  };

  const handleOpenEditCustomer = (c: Customer) => {
    setEditingCustomer(c);
    setCustomerForm({
      name: c.name,
      phone: c.phone || '',
      address: c.address || '',
      credit_limit: c.credit_limit || 0
    });
    setIsAddCustomerModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCustomer) {
        await api.updateCustomer(editingCustomer.id, customerForm);
        setNotification(`Customer "${customerForm.name}" updated successfully.`);
      } else {
        await api.createCustomer(customerForm);
        setNotification(`Customer "${customerForm.name}" registered successfully.`);
      }
      setIsAddCustomerModalOpen(false);
      loadCustomers();
      setTimeout(() => setNotification(null), 4000);
    } catch (err: any) {
      alert('Failed to save customer: ' + err.message);
    }
  };

  const handleOpenPaymentModal = (c: Customer) => {
    setSelectedCustomerForPayment(c);
    setPaymentAmount(c.current_balance);
    setPaymentMethod('Cash');
    setPaymentNotes('');
  };

  const handleExecutePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerForPayment) return;

    if (paymentAmount <= 0) {
      alert('Please enter a valid payment amount');
      return;
    }

    try {
      setIsSubmittingPayment(true);
      const res = await api.recordCustomerPayment(selectedCustomerForPayment.id, {
        amount: paymentAmount,
        payment_method: paymentMethod,
        notes: paymentNotes,
        shift_id: activeShift?.id || null
      });

      if (res.success) {
        if (activeShift) {
          fetchShiftSummary(activeShift.id);
        }
        setNotification(`Payment of ${money(paymentAmount)} recorded for ${selectedCustomerForPayment.name}. New Balance: ${money(res.new_balance)}.`);
        setSelectedCustomerForPayment(null);
        loadCustomers();
        setTimeout(() => setNotification(null), 5000);
      }
    } catch (err: any) {
      alert('Payment processing error: ' + err.message);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handleOpenLedger = async (c: Customer) => {
    setSelectedCustomerForLedger(c);
    try {
      setLoadingLedger(true);
      const data = await api.getCustomerLedger(c.id);
      setLedgerData(data);
    } catch (err) {
      console.error('Failed to load ledger:', err);
    } finally {
      setLoadingLedger(false);
    }
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Customer Credit & Udhar Khata Ledger
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage customer credit accounts, track outstanding balances, record cash recoveries, and view transaction history
          </p>
        </div>

        {hasPermission('can_add_customer') && (
          <button
            onClick={handleOpenAddCustomer}
            className="btn-save flex items-center space-x-2 text-xs font-bold px-4 py-2 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Customer Account</span>
          </button>
        )}
      </div>

      {notification && (
        <div className="flex items-center space-x-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Outstanding Udhar</span>
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/80 text-amber-700 dark:text-amber-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold font-mono text-amber-600 dark:text-amber-400 tracking-tight">
              {money(totalOutstanding)}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Receivable across {customersWithCredit} customer account(s)
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Registered Accounts</span>
            <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/80 text-teal-700 dark:text-teal-400">
              <UserCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold font-mono text-slate-900 dark:text-white tracking-tight">
              {customers.length}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Active accounts with credit limits
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Credit Accounts with Balances</span>
            <div className="p-2 rounded-xl bg-slate-100 dark:bg-[#162032] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold font-mono text-teal-600 dark:text-teal-400 tracking-tight">
              {customersWithCredit} / {customers.length}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Accounts requiring balance recovery
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-xs flex items-center space-x-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by customer name, phone number, or clinic address..."
            className="w-full bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:border-teal-500 transition-colors"
          />
        </div>
      </div>

      {/* Customer Accounts Table */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 uppercase font-semibold text-[11px] tracking-wider border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Customer Name</th>
                <th className="py-3 px-4">Contact Info</th>
                <th className="py-3 px-4">Clinic / Address</th>
                <th className="py-3 px-4 text-right">Credit Limit</th>
                <th className="py-3 px-4 text-right">Outstanding Balance</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <span>Loading Khata Accounts...</span>
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <CreditCard className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-700 mb-2 stroke-[1.5]" />
                    <div>No customer accounts match your search. Click "Add New Customer Account" to create one.</div>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((cust, idx) => {
                  const hasBalance = cust.current_balance > 0;
                  const isOverLimit = cust.credit_limit > 0 && cust.current_balance > cust.credit_limit;

                  return (
                    <tr
                      key={cust.id}
                      className={`transition-colors ${
                        idx % 2 === 0
                          ? 'bg-transparent'
                          : 'bg-slate-50/70 dark:bg-[#162032]/40'
                      } hover:bg-teal-500/5 dark:hover:bg-teal-500/10`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-white text-sm">{cust.name}</div>
                        <div className="text-[10px] text-slate-400">Account #{cust.id}</div>
                      </td>

                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {cust.phone ? (
                          <div className="flex items-center space-x-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{cust.phone}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {cust.address ? (
                          <div className="flex items-center space-x-1 truncate max-w-[200px]" title={cust.address}>
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{cust.address}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-400">
                        {money(Number(cust.credit_limit))}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <span className={`font-mono font-bold text-sm ${
                          hasBalance
                            ? isOverLimit
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}>
                          {money(Number(cust.current_balance))}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-center">
                        <span className={
                          isOverLimit
                            ? 'badge-danger'
                            : hasBalance
                            ? 'badge-warning'
                            : 'badge-success'
                        }>
                          {isOverLimit ? 'LIMIT EXCEEDED' : hasBalance ? 'PENDING UDHAR' : 'CLEAR'}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          {hasBalance && hasPermission('can_receive_payment') && (
                            <button
                              onClick={() => handleOpenPaymentModal(cust)}
                              className="btn-save px-2.5 py-1 text-[11px] font-semibold flex items-center space-x-1"
                            >
                              <DollarSign className="w-3 h-3" />
                              <span>Receive Cash</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleOpenLedger(cust)}
                            className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-[#162032] hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-semibold border border-slate-200 dark:border-slate-700 transition-colors flex items-center space-x-1"
                          >
                            <FileText className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                            <span>Ledger</span>
                          </button>

                          {hasPermission('can_edit_customer') && (
                            <button
                              onClick={() => handleOpenEditCustomer(cust)}
                              className="btn-edit px-2 py-1 text-[11px]"
                              title="Edit Account Details"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Receive Payment Modal */}
      <Modal
        isOpen={!!selectedCustomerForPayment}
        onClose={() => setSelectedCustomerForPayment(null)}
        title={`Receive Khata Payment - ${selectedCustomerForPayment?.name}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleExecutePayment} className="space-y-4 text-xs">
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl space-y-1">
            <span className="text-amber-800 dark:text-amber-300 font-semibold block">Outstanding Credit Balance</span>
            <div className="text-2xl font-extrabold font-mono text-amber-700 dark:text-amber-400">
              {money(Number(selectedCustomerForPayment?.current_balance || 0))}
            </div>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Amount Received ({currency})</label>
            <input
              type="number"
              step="0.01"
              required
              min="1"
              max={selectedCustomerForPayment?.current_balance}
              value={paymentAmount || ''}
              onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Payment Method</label>
            <div className="grid grid-cols-3 gap-2">
              {(['Cash', 'Card', 'Online'] as const).map(method => (
                <button
                  type="button"
                  key={method}
                  onClick={() => setPaymentMethod(method)}
                  className={`py-2 text-xs font-semibold rounded-lg border transition-all ${
                    paymentMethod === method
                      ? 'bg-teal-600 text-white border-teal-500 shadow-xs'
                      : 'bg-slate-100 dark:bg-surface-inset-dark border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Payment Reference / Notes</label>
            <input
              type="text"
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="e.g. Cleared installment via Cash"
              className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setSelectedCustomerForPayment(null)}
              className="btn-cancel px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmittingPayment}
              className="btn-save px-5 py-2 text-xs"
            >
              {isSubmittingPayment ? 'Processing...' : 'Confirm Payment & Update Balance'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Customer Ledger History Modal */}
      <Modal
        isOpen={!!selectedCustomerForLedger}
        onClose={() => {
          setSelectedCustomerForLedger(null);
          setLedgerData(null);
        }}
        title={`Khata Account Ledger: ${selectedCustomerForLedger?.name}`}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 rounded-xl flex justify-between items-center">
            <div>
              <div className="font-bold text-slate-900 dark:text-white text-sm">{selectedCustomerForLedger?.name}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{selectedCustomerForLedger?.phone || 'No phone'} • {selectedCustomerForLedger?.address || 'No address'}</div>
            </div>
            <div className="text-right">
              <span className="text-slate-400 text-[10px] block">Current Balance</span>
              <span className="font-mono text-base font-bold text-amber-600 dark:text-amber-400">
                {money(Number(selectedCustomerForLedger?.current_balance || 0))}
              </span>
            </div>
          </div>

          {/* Ledger Navigation Tabs */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 space-x-4">
            <button
              onClick={() => setLedgerTab('sales')}
              className={`pb-2 text-xs font-bold transition-colors border-b-2 flex items-center space-x-1.5 ${
                ledgerTab === 'sales'
                  ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Credit Invoices ({ledgerData?.sales?.length || 0})</span>
            </button>
            <button
              onClick={() => setLedgerTab('payments')}
              className={`pb-2 text-xs font-bold transition-colors border-b-2 flex items-center space-x-1.5 ${
                ledgerTab === 'payments'
                  ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Payment Recoveries ({ledgerData?.payments?.length || 0})</span>
            </button>
          </div>

          {ledgerTab === 'sales' ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase">
                  <tr>
                    <th className="py-2 px-3">Invoice #</th>
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3 text-center">Type</th>
                    <th className="py-2 px-3 text-right">Invoice Total</th>
                    <th className="py-2 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {loadingLedger ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">Loading ledger...</td>
                    </tr>
                  ) : ledgerData?.sales.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">No invoices linked to this customer.</td>
                    </tr>
                  ) : (
                    ledgerData?.sales.map(sale => (
                      <tr key={sale.id} className="hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono font-bold text-teal-600 dark:text-teal-400">{sale.invoice_no}</td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{new Date(sale.sale_date).toLocaleDateString()}</td>
                        <td className="py-2 px-3 text-center">
                          <span className="px-1.5 py-0.5 rounded-sm text-[10px] bg-slate-100 dark:bg-[#162032] text-slate-700 dark:text-slate-300">
                            {sale.payment_type}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                          {money(Number(sale.net_total))}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={sale.status === 'completed' ? 'badge-success' : 'badge-warning'}>
                            {sale.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase">
                  <tr>
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3 text-right">Amount Paid</th>
                    <th className="py-2 px-3 text-center">Method</th>
                    <th className="py-2 px-3 text-right">Prev Balance</th>
                    <th className="py-2 px-3 text-right">New Balance</th>
                    <th className="py-2 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {loadingLedger ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">Loading recoveries...</td>
                    </tr>
                  ) : !ledgerData?.payments || ledgerData.payments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">No payment recoveries recorded yet.</td>
                    </tr>
                  ) : (
                    ledgerData.payments.map((p: any) => (
                      <tr key={p.id} className="hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors">
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                          {p.payment_date?.split(' ')[0] || p.payment_date}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {money(Number(p.amount))}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className="px-1.5 py-0.5 rounded-sm text-[10px] uppercase bg-slate-100 dark:bg-[#162032] text-slate-700 dark:text-slate-300 font-semibold">
                            {p.payment_method}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-500 dark:text-slate-400">
                          {money(Number(p.previous_balance))}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                          {money(Number(p.new_balance))}
                        </td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300 truncate max-w-[150px]" title={p.notes}>
                          {p.notes || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={() => {
                setSelectedCustomerForLedger(null);
                setLedgerData(null);
              }}
              className="btn-cancel px-4 py-2"
            >
              Close Ledger
            </button>
          </div>
        </div>
      </Modal>

      {/* Add / Edit Customer Modal */}
      <Modal
        isOpen={isAddCustomerModalOpen}
        onClose={() => setIsAddCustomerModalOpen(false)}
        title={editingCustomer ? `Edit Customer: ${editingCustomer.name}` : 'Register New Customer Account'}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleSaveCustomer} className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Customer / Clinic Full Name</label>
            <input
              type="text"
              required
              value={customerForm.name}
              onChange={(e) => setCustomerForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Dr. Rashid Clinic"
              className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-bold focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Phone Number</label>
            <input
              type="text"
              value={customerForm.phone}
              onChange={(e) => setCustomerForm(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="+92 300 ..."
              className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Clinic / Residential Address</label>
            <input
              type="text"
              value={customerForm.address}
              onChange={(e) => setCustomerForm(prev => ({ ...prev, address: e.target.value }))}
              placeholder="Plot #, Street, City"
              className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Allowed Credit Limit ({currency})</label>
            <input
              type="number"
              min="0"
              value={customerForm.credit_limit}
              onChange={(e) => setCustomerForm(prev => ({ ...prev, credit_limit: parseFloat(e.target.value) || 0 }))}
              className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddCustomerModalOpen(false)}
              className="btn-cancel px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-save px-5 py-2 text-xs"
            >
              {editingCustomer ? 'Update Account' : 'Register Customer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
