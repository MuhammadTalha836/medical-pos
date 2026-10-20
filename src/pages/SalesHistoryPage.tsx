import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { SaleInvoice, SystemSettings } from '../types';
import { Modal } from '../components/common/Modal';
import { ThermalReceipt } from '../components/pos/ThermalReceipt';
import { useAuthStore } from '../store/useAuthStore';
import { useShiftStore } from '../store/useShiftStore';
import {
  Search,
  Receipt,
  RotateCcw,
  Eye,
  Calendar,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';

interface SalesHistoryPageProps {
  settings?: SystemSettings | null;
}

export const SalesHistoryPage: React.FC<SalesHistoryPageProps> = ({ settings }) => {
  const { hasPermission } = useAuthStore();
  const { activeShift, fetchShiftSummary } = useShiftStore();
  const [sales, setSales] = useState<SaleInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInvoice, setSearchInvoice] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Modals
  const [selectedInvoice, setSelectedInvoice] = useState<SaleInvoice | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [returnInvoice, setReturnInvoice] = useState<SaleInvoice | null>(null);
  const [returnItems, setReturnItems] = useState<{ [productId: number]: { qty: number; maxQty: number; price: number; name: string } }>({});
  const [returnReason, setReturnReason] = useState('');
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const currency = settings?.currency_symbol || 'Rs.';

  const loadSales = async () => {
    try {
      setLoading(true);
      const data = await api.getSales({
        invoice_no: searchInvoice.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined
      });
      setSales(data);
    } catch (err) {
      console.error('Failed to load sales history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSales();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadSales();
  };

  const handleOpenReceipt = async (saleId: number) => {
    try {
      const inv = await api.getSaleById(saleId);
      setSelectedInvoice(inv);
      setIsReceiptModalOpen(true);
    } catch (err) {
      console.error('Failed to fetch invoice:', err);
    }
  };

  const handleOpenReturnModal = async (saleId: number) => {
    try {
      const inv = await api.getSaleById(saleId);
      setReturnInvoice(inv);

      // Initialize return map
      const map: { [id: number]: { qty: number; maxQty: number; price: number; name: string } } = {};
      inv.items?.forEach((item) => {
        map[item.product_id] = {
          qty: 0,
          maxQty: item.quantity,
          price: item.net_amount / item.quantity,
          name: item.product_name
        };
      });
      setReturnItems(map);
      setReturnReason('Customer returned medicine in original packaging');
      setIsReturnModalOpen(true);
    } catch (err) {
      console.error('Failed to fetch invoice for return:', err);
    }
  };

  const handleExecuteReturn = async () => {
    if (!returnInvoice) return;

    const itemsToReturn: any[] = [];
    let refundSum = 0;

    Object.entries(returnItems).forEach(([productId, data]) => {
      if (data.qty > 0) {
        const itemRefund = data.qty * data.price;
        refundSum += itemRefund;
        itemsToReturn.push({
          product_id: Number(productId),
          quantity: data.qty,
          unit_refund_price: data.price,
          total_refund: itemRefund
        });
      }
    });

    if (itemsToReturn.length === 0) {
      alert('Please select at least 1 unit to return.');
      return;
    }

    try {
      setIsSubmittingReturn(true);
      const res = await api.createSaleReturn({
        sale_id: returnInvoice.id,
        original_invoice_no: returnInvoice.invoice_no,
        customer_name: returnInvoice.customer_name,
        return_items: itemsToReturn,
        reason: returnReason,
        shift_id: activeShift?.id || null
      });

      if (res.success) {
        if (activeShift) {
          fetchShiftSummary(activeShift.id);
        }
        setIsReturnModalOpen(false);
        setSuccessMessage(`Return voucher ${res.returnNo} generated. Refund amount: ${currency} ${refundSum.toFixed(2)}. Stock restored.`);
        loadSales();
        setTimeout(() => setSuccessMessage(null), 6000);
      }
    } catch (err: any) {
      alert('Return failed: ' + err.message);
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-slate-50 dark:bg-[#0a0e17] text-slate-800 dark:text-slate-100 transition-colors duration-200">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Sales Invoice History & Returns</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Search past counter sales, reprint thermal receipts, and process returns</p>
        </div>
      </div>

      {successMessage && (
        <div className="flex items-center space-x-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <form onSubmit={handleSearch} className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-3 shadow-sm">
        <div className="flex-1 min-w-[220px] relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchInvoice}
            onChange={(e) => setSearchInvoice(e.target.value)}
            placeholder="Search by Invoice # (e.g. INV-2026...)"
            className="w-full bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-600 dark:text-slate-400 flex items-center space-x-1">
            <Calendar className="w-3.5 h-3.5" />
            <span>From:</span>
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 font-mono"
          />
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-600 dark:text-slate-400">To:</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 font-mono"
          />
        </div>

        <button
          type="submit"
          className="btn-save px-4 py-2 text-xs"
        >
          Filter Invoices
        </button>

        {(searchInvoice || dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => {
              setSearchInvoice('');
              setDateFrom('');
              setDateTo('');
              api.getSales().then(setSales);
            }}
            className="btn-cancel px-3 py-2 text-xs"
          >
            Reset
          </button>
        )}
      </form>

      {/* Invoices Table */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-[#0d131f] text-slate-700 dark:text-slate-300 uppercase font-semibold text-[11px] tracking-wider border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4 text-center">Payment</th>
                <th className="py-3 px-4 text-right">Gross</th>
                <th className="py-3 px-4 text-right">Discount</th>
                <th className="py-3 px-4 text-right">Net Total</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <span>Loading Invoices...</span>
                  </td>
                </tr>
              ) : sales.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 dark:text-slate-500">
                    <Receipt className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-700 mb-2 stroke-[1.5]" />
                    <div>No sales invoices found matching filter criteria.</div>
                  </td>
                </tr>
              ) : (
                sales.map((sale, idx) => (
                  <tr
                    key={sale.id}
                    className={`transition-colors ${
                      idx % 2 === 0
                        ? 'bg-transparent'
                        : 'bg-slate-50/70 dark:bg-[#162032]/40'
                    } hover:bg-teal-500/5 dark:hover:bg-teal-500/10`}
                  >
                    <td className="py-3 px-4 font-mono font-bold text-teal-600 dark:text-teal-400">
                      {sale.invoice_no}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {new Date(sale.sale_date).toLocaleDateString()} {new Date(sale.sale_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 px-4 text-slate-900 dark:text-white font-medium">
                      <div>{sale.customer_name}</div>
                      {sale.customer_phone && <div className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">{sale.customer_phone}</div>}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                        sale.payment_type === 'Online'
                          ? 'bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                          : sale.payment_type === 'Card'
                          ? 'bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                          : sale.payment_type === 'Credit'
                          ? 'badge-warning'
                          : 'badge-success'
                      }`}>
                        {sale.payment_type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-400">
                      {currency} {sale.total_gross.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                      -{currency} {(sale.total_item_discount + sale.bill_discount_amt).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white text-sm">
                      {currency} {sale.net_total.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={sale.status === 'completed' ? 'badge-success' : 'badge-warning'}>
                        {sale.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <button
                          onClick={() => handleOpenReceipt(sale.id)}
                          className="btn-print px-2.5 py-1 text-xs flex items-center space-x-1"
                          title="View / Print Receipt"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Receipt</span>
                        </button>

                        {sale.status !== 'returned' && hasPermission('can_return_sale') && (
                          <button
                            onClick={() => handleOpenReturnModal(sale.id)}
                            className="px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-semibold border border-amber-300 dark:border-amber-700/60 transition-colors flex items-center space-x-1"
                            title="Return Items"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Return</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Thermal Receipt Preview Modal */}
      <Modal
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        title="Thermal Receipt View / Reprint"
        maxWidth="max-w-md"
      >
        {selectedInvoice && (
          <ThermalReceipt
            invoice={selectedInvoice}
            settings={settings}
            onClose={() => setIsReceiptModalOpen(false)}
          />
        )}
      </Modal>

      {/* Sale Return Modal */}
      <Modal
        isOpen={isReturnModalOpen}
        onClose={() => setIsReturnModalOpen(false)}
        title={`Process Sale Return - Invoice ${returnInvoice?.invoice_no}`}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              Specify the returned quantity for each medicine item below. Returned inventory will be automatically restored to the available stock in SQLite.
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-[#0d131f] text-slate-700 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Product Name</th>
                  <th className="py-2.5 px-3 text-center">Billed Qty</th>
                  <th className="py-2.5 px-3 text-right">Unit Rate</th>
                  <th className="py-2.5 px-3 text-center">Return Qty</th>
                  <th className="py-2.5 px-3 text-right">Refund Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {Object.entries(returnItems).map(([prodIdStr, data]) => {
                  const prodId = Number(prodIdStr);
                  const refund = data.qty * data.price;
                  return (
                    <tr key={prodId} className="hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors">
                      <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">{data.name}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-slate-500 dark:text-slate-400">{data.maxQty}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">{currency} {data.price.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="number"
                          min="0"
                          max={data.maxQty}
                          value={data.qty}
                          onChange={(e) => {
                            const val = Math.min(data.maxQty, Math.max(0, parseFloat(e.target.value) || 0));
                            setReturnItems(prev => ({
                              ...prev,
                              [prodId]: { ...prev[prodId], qty: val }
                            }));
                          }}
                          className="w-16 text-center bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-lg py-1 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-teal-500"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                        {currency} {refund.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Reason for Return</label>
            <input
              type="text"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={() => setIsReturnModalOpen(false)}
              className="btn-cancel px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              onClick={handleExecuteReturn}
              disabled={isSubmittingReturn}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-md transition-colors"
            >
              {isSubmittingReturn ? 'Processing...' : 'Confirm Return & Refund'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
