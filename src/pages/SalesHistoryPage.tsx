import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { SaleInvoice, SystemSettings } from '../types';
import { Modal } from '../components/common/Modal';
import { UnifiedInvoice } from '../components/pos/UnifiedInvoice';
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
import { moneyFormatter } from '../utils/format';
import { saleStatus } from '../utils/saleStatus';

interface SalesHistoryPageProps {
  settings?: SystemSettings | null;
}

/** One invoice line in the return form (box and loose lines of the same medicine stay separate) */
interface ReturnLine {
  productId: number;
  isLoose: boolean;
  name: string;
  unitLabel: string;
  sold: number;
  /** Still returnable: sold minus earlier returns */
  maxQty: number;
  /** Price actually paid per unit, bill discount included (the server works out the final refund) */
  price: number;
  qty: number;
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
  const [returnLines, setReturnLines] = useState<ReturnLine[]>([]);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const money = moneyFormatter(settings);

  const loadSales = async () => {
    try {
      setLoading(true);
      const data = await api.getSales({
        invoice_no: searchInvoice.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined
      });
      setSales(data);
      setPageError(null);
    } catch (err: any) {
      setPageError(`Could not load invoices: ${err.message}`);
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
    } catch (err: any) {
      setPageError(`Could not open the invoice: ${err.message}`);
    }
  };

  const handleOpenReturnModal = async (saleId: number) => {
    try {
      const inv = await api.getSaleById(saleId);
      setReturnInvoice(inv);

      // The bill discount is shared over the lines, so the refund matches what the customer paid
      const items = inv.items ?? [];
      const subtotal = items.reduce((sum, item) => sum + item.net_amount, 0);
      const paidShare = subtotal > 0 ? Math.min(1, inv.net_total / subtotal) : 0;
      setReturnLines(items.map(item => ({
        productId: item.product_id,
        isLoose: !!item.is_loose,
        name: item.product_name,
        unitLabel: item.is_loose ? item.unit_type : 'Box',
        sold: item.quantity,
        maxQty: Math.max(0, item.quantity - (item.returned_qty ?? 0)),
        price: item.quantity > 0 ? (item.net_amount * paidShare) / item.quantity : 0,
        qty: 0
      })));
      setReturnReason('Customer returned medicine in original packaging');
      setReturnError(null);
      setIsReturnModalOpen(true);
    } catch (err: any) {
      setPageError(`Could not open the invoice for return: ${err.message}`);
    }
  };

  const handleExecuteReturn = async () => {
    if (!returnInvoice) return;

    if (isSubmittingReturn) return;

    const itemsToReturn = returnLines
      .filter(line => line.qty > 0)
      .map(line => ({ product_id: line.productId, is_loose: line.isLoose, quantity: line.qty }));

    if (itemsToReturn.length === 0) {
      setReturnError('Enter the quantity being returned for at least one item.');
      return;
    }

    try {
      setIsSubmittingReturn(true);
      setReturnError(null);
      const res = await api.createSaleReturn({
        sale_id: returnInvoice.id,
        return_items: itemsToReturn,
        reason: returnReason
      });

      if (res.success) {
        if (activeShift) {
          fetchShiftSummary(activeShift.id);
        }
        setIsReturnModalOpen(false);
        setSuccessMessage(`Return voucher ${res.returnNo} saved. Refund: ${money(res.totalRefund)}. Stock restored.`);
        loadSales();
        setTimeout(() => setSuccessMessage(null), 6000);
      }
    } catch (err: any) {
      setReturnError(err.message);
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Sales Invoice History & Returns</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Search past counter sales, reprint thermal receipts, and process returns</p>
        </div>
      </div>

      {successMessage && (
        <div className="flex items-center space-x-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {pageError && (
        <div className="flex items-center space-x-2 px-4 py-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-medium" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{pageError}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <form onSubmit={handleSearch} className="card-premium p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px] relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchInvoice}
            onChange={(e) => setSearchInvoice(e.target.value)}
            placeholder="Search by Invoice # (e.g. INV-2026...)"
            className="field-input w-full pl-10 pr-4"
          />
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-600 dark:text-slate-400 flex items-center space-x-1">
            <Calendar className="w-4 h-4" />
            <span>From:</span>
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="field-input font-mono"
          />
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-600 dark:text-slate-400">To:</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="field-input font-mono"
          />
        </div>

        <button
          type="submit"
          className="btn-primary"
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
            className="btn-secondary"
          >
            Reset
          </button>
        )}
      </form>

      {/* Invoices Table */}
      <div className="table-container">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold text-xs border-b border-slate-200 dark:border-slate-800">
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
                      {sale.customer_phone && <div className="text-2xs text-slate-500 dark:text-slate-400 font-normal">{sale.customer_phone}</div>}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-2xs font-semibold border ${
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
                      {money(sale.total_gross)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                      -{money((sale.total_item_discount + sale.bill_discount_amt))}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white text-sm">
                      {money(sale.net_total)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={saleStatus(sale.status).badge}>{saleStatus(sale.status).label}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <button
                          onClick={() => handleOpenReceipt(sale.id)}
                          className="btn-print btn-sm"
                          title="View / Print Receipt"
                        >
                          <Eye className="w-4 h-4" />
                          <span>Receipt</span>
                        </button>

                        {(sale.status === 'completed' || sale.status === 'partially_returned') && hasPermission('can_return_sale') && (
                          <button
                            onClick={() => handleOpenReturnModal(sale.id)}
                            className="px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-semibold border border-amber-300 dark:border-amber-700/60 transition-colors flex items-center space-x-1"
                            title="Return Items"
                          >
                            <RotateCcw className="w-4 h-4" />
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
          <UnifiedInvoice
            invoice={selectedInvoice}
            settings={settings}
            onClose={() => setIsReceiptModalOpen(false)}
          />
        )}
      </Modal>

      {/* Sale Return Modal */}
      <Modal
        isOpen={isReturnModalOpen}
        onClose={() => { if (!isSubmittingReturn) setIsReturnModalOpen(false); }}
        title={`Process Sale Return - Invoice ${returnInvoice?.invoice_no}`}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              Enter the returned quantity for each item. Stock goes back in the unit it was sold in, and the refund is what the customer paid (bill discount included).
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Product Name</th>
                  <th className="py-2.5 px-3 text-center">Sold</th>
                  <th className="py-2.5 px-3 text-center">Can return</th>
                  <th className="py-2.5 px-3 text-right">Paid per unit</th>
                  <th className="py-2.5 px-3 text-center">Return Qty</th>
                  <th className="py-2.5 px-3 text-right">Refund Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {returnLines.map((line, index) => (
                  <tr key={`${line.productId}-${line.isLoose ? 1 : 0}-${index}`} className="hover:bg-teal-500/5 dark:hover:bg-teal-500/10 transition-colors">
                    <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">
                      {line.name}
                      <span className="ml-1.5 text-2xs text-slate-500 dark:text-slate-400">({line.unitLabel})</span>
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-500 dark:text-slate-400">{line.sold}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-700 dark:text-slate-300">{line.maxQty}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">{money(line.price)}</td>
                    <td className="py-2.5 px-3 text-center">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        max={line.maxQty}
                        value={line.qty}
                        disabled={line.maxQty === 0 || isSubmittingReturn}
                        onChange={(e) => {
                          const val = Math.min(line.maxQty, Math.max(0, Math.floor(Number(e.target.value) || 0)));
                          setReturnLines(prev => prev.map((l, i) => (i === index ? { ...l, qty: val } : l)));
                        }}
                        className="field-input field-sm w-16 text-center font-mono"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                      {money(line.qty * line.price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Reason for Return</label>
            <input
              type="text"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="field-input w-full"
            />
          </div>

          {returnError && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 rounded-xl p-3 text-xs text-rose-700 dark:text-rose-300 flex items-start space-x-2" role="alert">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{returnError}</span>
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={() => setIsReturnModalOpen(false)}
              disabled={isSubmittingReturn}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleExecuteReturn}
              disabled={isSubmittingReturn || returnLines.every(line => line.qty === 0)}
              className="btn-primary"
            >
              {isSubmittingReturn ? 'Processing...' : 'Confirm Return & Refund'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
