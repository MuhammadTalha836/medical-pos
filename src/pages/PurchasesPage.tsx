import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { PurchaseInvoice, Company, Product, SystemSettings } from '../types';
import { Modal } from '../components/common/Modal';
import {
  Truck,
  Plus,
  Trash2,
  Eye,
  CheckCircle2,
  Printer
} from 'lucide-react';
import { moneyFormatter } from '../utils/format';

interface PurchasesPageProps {
  settings?: SystemSettings | null;
}

export const PurchasesPage: React.FC<PurchasesPageProps> = ({ settings }) => {
  const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  // New Purchase Modal
  const [isNewPurchaseModalOpen, setIsNewPurchaseModalOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentStatus, setPaymentStatus] = useState<'Paid' | 'Pending' | 'Partial'>('Paid');

  // Items in current draft purchase
  const [draftItems, setDraftItems] = useState<Array<{
    product_id: number;
    product_name: string;
    batch_no: string;
    expiry_date: string;
    quantity_boxes: number;
    bonus_boxes: number;
    box_cost_price: number;
    box_retail_price: number;
    discount_pct: number;
    total_cost: number;
  }>>([]);

  // Line item input state
  const [lineProductId, setLineProductId] = useState('');
  const [lineBatchNo, setLineBatchNo] = useState('');
  const [lineExpiry, setLineExpiry] = useState('');
  const [lineBoxes, setLineBoxes] = useState(10);
  const [lineBonus, setLineBonus] = useState(0);
  const [lineCost, setLineCost] = useState(100);
  const [lineRetail, setLineRetail] = useState(120);

  // View Modal
  const [viewInvoice, setViewInvoice] = useState<any | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const money = moneyFormatter(settings);

  const loadData = async () => {
    try {
      setLoading(true);
      const [purList, compList, prodList] = await Promise.all([
        api.getPurchases(),
        api.getCompanies(),
        api.getProducts()
      ]);
      setPurchases(purList);
      setCompanies(compList);
      setProducts(prodList);
    } catch (err) {
      console.error('Failed to load purchases:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectCompanyInModal = (companyId: string) => {
    setSelectedCompanyId(companyId);
    // Auto-select first product belonging to company if available
    const compProds = products.filter(p => String(p.company_id) === companyId);
    if (compProds.length > 0) {
      setLineProductId(String(compProds[0].id));
      setLineCost(compProds[0].box_trade_price);
      setLineRetail(compProds[0].box_retail_price);
    }
  };

  const handleSelectProductInModal = (productId: string) => {
    setLineProductId(productId);
    const prod = products.find(p => String(p.id) === productId);
    if (prod) {
      setLineCost(prod.box_trade_price);
      setLineRetail(prod.box_retail_price);
    }
  };

  const handleAddLineItem = () => {
    if (!lineProductId) {
      alert('Please select a product.');
      return;
    }
    const prod = products.find(p => String(p.id) === lineProductId);
    if (!prod) return;

    const total = lineBoxes * lineCost;

    setDraftItems(prev => [
      ...prev,
      {
        product_id: prod.id,
        product_name: prod.name,
        batch_no: lineBatchNo || `B-${Date.now().toString().slice(-4)}`,
        expiry_date: lineExpiry || '2027-12-31',
        quantity_boxes: lineBoxes,
        bonus_boxes: lineBonus,
        box_cost_price: lineCost,
        box_retail_price: lineRetail,
        discount_pct: 0,
        total_cost: total
      }
    ]);

    // Reset line fields
    setLineBatchNo('');
    setLineBoxes(10);
    setLineBonus(0);
  };

  const handleRemoveDraftItem = (index: number) => {
    setDraftItems(prev => prev.filter((_, idx) => idx !== index));
  };

  const totalGrossDraft = draftItems.reduce((sum, item) => sum + (item.quantity_boxes * item.box_cost_price), 0);
  const totalNetDraft = draftItems.reduce((sum, item) => sum + item.total_cost, 0);
  const totalDiscountDraft = totalGrossDraft - totalNetDraft;

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draftItems.length === 0) {
      alert('Please add at least one line item to the purchase invoice.');
      return;
    }

    try {
      const payload = {
        company_id: Number(selectedCompanyId),
        supplier_invoice_no: supplierInvoiceNo || null,
        purchase_date: purchaseDate,
        payment_status: paymentStatus,
        total_gross: totalGrossDraft,
        discount_amount: totalDiscountDraft,
        tax_amount: 0,
        net_total: totalNetDraft,
        items: draftItems
      };

      const res = await api.createPurchase(payload);
      if (res.success) {
        setIsNewPurchaseModalOpen(false);
        setDraftItems([]);
        setSupplierInvoiceNo('');
        setFeedback(`Purchase ${res.invoiceNo} saved! Stock and trade prices updated.`);
        loadData();
        setTimeout(() => setFeedback(null), 6000);
      }
    } catch (err: any) {
      alert('Failed to save purchase: ' + err.message);
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Purchase Invoices & Stock Inward</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Record incoming medicine deliveries, track batch expiries, and auto-update stock</p>
        </div>

        <button
          onClick={() => {
            if (companies.length > 0) {
              handleSelectCompanyInModal(String(companies[0].id));
            }
            setIsNewPurchaseModalOpen(true);
          }}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          <span>New Purchase Inward</span>
        </button>
      </div>

      {feedback && (
        <div className="flex items-center space-x-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Purchases Invoices Table */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold text-xs border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Purchase Inv #</th>
                <th className="py-3 px-4">Supplier Bill #</th>
                <th className="py-3 px-4">Manufacturer / Company</th>
                <th className="py-3 px-4">Purchase Date</th>
                <th className="py-3 px-4 text-right">Gross Cost</th>
                <th className="py-3 px-4 text-right">Discount</th>
                <th className="py-3 px-4 text-right">Net Payable</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <span>Loading Purchases...</span>
                  </td>
                </tr>
              ) : purchases.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 dark:text-slate-500">
                    <Truck className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-700 mb-2 stroke-[1.5]" />
                    <div>No purchase deliveries recorded yet. Click "New Purchase Inward" to add one.</div>
                  </td>
                </tr>
              ) : (
                purchases.map((pur, idx) => (
                  <tr
                    key={pur.id}
                    className={`transition-colors ${
                      idx % 2 === 0
                        ? 'bg-transparent'
                        : 'bg-slate-50/70 dark:bg-[#162032]/40'
                    } hover:bg-teal-500/5 dark:hover:bg-teal-500/10`}
                  >
                    <td className="py-3 px-4 font-mono font-bold text-teal-600 dark:text-teal-400">
                      {pur.invoice_no}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                      {pur.supplier_invoice_no || '-'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">{pur.company_name}</div>
                      {pur.company_code && <div className="text-2xs text-teal-600 dark:text-teal-400 font-mono">[{pur.company_code}]</div>}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-mono">
                      {pur.purchase_date}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-500 dark:text-slate-400">
                      {money(pur.total_gross)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                      -{money(pur.discount_amount)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white text-sm">
                      {money(pur.net_total)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={pur.payment_status === 'Paid' ? 'badge-success' : 'badge-warning'}>
                        {pur.payment_status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => setViewInvoice(pur)}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors inline-flex items-center space-x-1"
                      >
                        <Eye className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                        <span>Voucher</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Purchase Modal */}
      <Modal
        isOpen={isNewPurchaseModalOpen}
        onClose={() => setIsNewPurchaseModalOpen(false)}
        title="Supplier Purchase Inward - Stock Entry"
        maxWidth="max-w-4xl"
      >
        <form onSubmit={handleSavePurchase} className="space-y-4">
          {/* Supplier & Header details */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-surface-inset-dark p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Supplier / Company</label>
              <select
                required
                value={selectedCompanyId}
                onChange={(e) => handleSelectCompanyInModal(e.target.value)}
                className="field-select field-sm w-full"
              >
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Supplier Bill #</label>
              <input
                type="text"
                value={supplierInvoiceNo}
                onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                placeholder="e.g. DC-98421"
                className="field-input field-sm w-full font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Purchase Date</label>
              <input
                type="date"
                required
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="field-input field-sm w-full font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Payment Status</label>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as any)}
                className="field-select field-sm w-full"
              >
                <option value="Paid">Paid</option>
                <option value="Pending">Pending / Credit</option>
                <option value="Partial">Partial Payment</option>
              </select>
            </div>
          </div>

          {/* Add Line Item Box */}
          <div className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-3">
            <span className="text-xs font-bold text-teal-700 dark:text-teal-400 block">Add Medicine Line Item</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="col-span-2">
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">Medicine</label>
                <select
                  value={lineProductId}
                  onChange={(e) => handleSelectProductInModal(e.target.value)}
                  className="field-select field-sm w-full"
                >
                  <option value="">Select Medicine</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.c_code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">Batch #</label>
                <input
                  type="text"
                  value={lineBatchNo}
                  onChange={(e) => setLineBatchNo(e.target.value.toUpperCase())}
                  placeholder="e.g. B-998"
                  className="field-input field-sm w-full font-mono"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">Expiry Date</label>
                <input
                  type="date"
                  value={lineExpiry}
                  onChange={(e) => setLineExpiry(e.target.value)}
                  className="field-input field-sm w-full font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-end">
              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">Box Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={lineBoxes}
                  onChange={(e) => setLineBoxes(parseInt(e.target.value) || 1)}
                  className="field-input field-sm w-full font-mono"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">Bonus Boxes (Free)</label>
                <input
                  type="number"
                  min="0"
                  value={lineBonus}
                  onChange={(e) => setLineBonus(parseInt(e.target.value) || 0)}
                  className="field-input field-sm w-full font-mono"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">Box Cost (T-Price)</label>
                <input
                  type="number"
                  step="0.01"
                  value={lineCost}
                  onChange={(e) => setLineCost(parseFloat(e.target.value) || 0)}
                  className="field-input field-sm w-full font-mono"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-0.5">Box Retail (MRP)</label>
                <input
                  type="number"
                  step="0.01"
                  value={lineRetail}
                  onChange={(e) => setLineRetail(parseFloat(e.target.value) || 0)}
                  className="field-input field-sm w-full font-mono font-bold"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={handleAddLineItem}
                  className="btn-primary btn-sm w-full"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Line</span>
                </button>
              </div>
            </div>
          </div>

          {/* Draft Items Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2 px-3">Item</th>
                  <th className="py-2 px-3">Batch & Expiry</th>
                  <th className="py-2 px-3 text-center">Boxes (+Bonus)</th>
                  <th className="py-2 px-3 text-right">Cost / Box</th>
                  <th className="py-2 px-3 text-right">Retail / Box</th>
                  <th className="py-2 px-3 text-right">Total Cost</th>
                  <th className="py-2 px-2 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {draftItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 dark:text-slate-500">
                      No items added yet. Fill in details above and click "Add Line".
                    </td>
                  </tr>
                ) : (
                  draftItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-[#162032]/50">
                      <td className="py-2 px-3 font-medium text-slate-900 dark:text-white">{item.product_name}</td>
                      <td className="py-2 px-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {item.batch_no} (Exp: {item.expiry_date})
                      </td>
                      <td className="py-2 px-3 text-center font-mono">
                        <span className="font-bold text-slate-900 dark:text-white">{item.quantity_boxes}</span>
                        {item.bonus_boxes > 0 && <span className="text-emerald-600 dark:text-emerald-400 text-2xs ml-1">(+{item.bonus_boxes})</span>}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">{money(item.box_cost_price)}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-teal-600 dark:text-teal-400">{money(item.box_retail_price)}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">{money(item.total_cost)}</td>
                      <td className="py-2 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveDraftItem(idx)}
                          className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Totals Summary */}
          <div className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl flex items-center justify-between text-xs">
            <div className="space-x-4 text-slate-600 dark:text-slate-400">
              <span>Lines: <strong className="text-slate-900 dark:text-white">{draftItems.length}</strong></span>
              <span>Total Boxes: <strong className="text-slate-900 dark:text-white">{draftItems.reduce((s, i) => s + i.quantity_boxes + i.bonus_boxes, 0)}</strong></span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Total Purchase Cost:</span>
              <span className="text-xl font-extrabold font-mono text-teal-600 dark:text-teal-400">
                {money(totalNetDraft)}
              </span>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setIsNewPurchaseModalOpen(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={draftItems.length === 0}
              className="btn-primary"
            >
              Post Purchase & Update Stock
            </button>
          </div>
        </form>
      </Modal>

      {/* View Purchase Voucher Modal */}
      <Modal
        isOpen={!!viewInvoice}
        onClose={() => setViewInvoice(null)}
        title={`Purchase Inward Voucher - ${viewInvoice?.invoice_no}`}
        maxWidth="max-w-md"
      >
        {viewInvoice && (
          <div className="space-y-4 text-xs">
            <div className="bg-slate-50 dark:bg-surface-inset-dark p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex justify-between font-bold text-slate-900 dark:text-white">
                <span>{viewInvoice.company_name}</span>
                <span className="text-teal-600 dark:text-teal-400">{viewInvoice.invoice_no}</span>
              </div>
              <div className="flex justify-between text-slate-500 dark:text-slate-400 text-xs">
                <span>Date: {viewInvoice.purchase_date}</span>
                <span>Supplier Bill: {viewInvoice.supplier_invoice_no || '-'}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-sm">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Total Net Amount:</span>
                <span className="font-extrabold font-mono text-teal-600 dark:text-teal-400">{money(viewInvoice.net_total)}</span>
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setViewInvoice(null)}
                className="btn-secondary"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="btn-print"
              >
                <Printer className="w-4 h-4" />
                <span>Print Voucher</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
