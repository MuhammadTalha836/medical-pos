import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/apiService';
import { PurchaseInvoice, Company, Product, SystemSettings } from '../types';
import { Modal } from '../components/common/Modal';
import {
  Truck,
  Plus,
  Trash2,
  Eye,
  CheckCircle2,
  Printer,
  ClipboardList,
  Wallet,
  PackageX
} from 'lucide-react';
import { currencySymbol, moneyFormatter } from '../utils/format';
import { useAuthStore } from '../store/useAuthStore';
import { printDocument } from '../utils/printDocument';
import { SuppliersTab } from '../components/suppliers/SuppliersTab';
import { PurchaseReturnsTab } from '../components/purchaseReturns/PurchaseReturnsTab';

type PurchasesTabKey = 'purchases' | 'suppliers' | 'returns';
type PaymentChoice = 'full' | 'credit' | 'part';

const PAYMENT_BADGE: Record<string, string> = { Paid: 'badge-success', Partial: 'badge-warning', Pending: 'badge-danger' };

interface PurchasesPageProps {
  settings?: SystemSettings | null;
}

export const PurchasesPage: React.FC<PurchasesPageProps> = ({ settings }) => {
  const { hasPermission } = useAuthStore();
  const [tab, setTab] = useState<PurchasesTabKey>('purchases');
  const [suppliersRefreshKey, setSuppliersRefreshKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  // New Purchase Modal
  const [isNewPurchaseModalOpen, setIsNewPurchaseModalOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>('full');
  const [paidNow, setPaidNow] = useState('');

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
  const [viewInvoice, setViewInvoice] = useState<PurchaseInvoice | null>(null);
  const voucherRef = useRef<HTMLDivElement>(null);

  // The list row shows at once; the lines load from the purchase details
  const openVoucher = async (purchase: PurchaseInvoice) => {
    setViewInvoice({ ...purchase, items: undefined });
    try {
      const details = await api.getPurchaseById(purchase.id);
      setViewInvoice(current => (current?.id === purchase.id ? details : current));
    } catch (err: any) {
      setViewInvoice(null);
      alert('The purchase could not be opened: ' + err.message);
    }
  };
  const [feedback, setFeedback] = useState<string | null>(null);

  const money = moneyFormatter(settings);
  const currency = currencySymbol(settings);

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
    if (saving) return;
    if (draftItems.length === 0) {
      alert('Please add at least one line item to the purchase invoice.');
      return;
    }
    const partAmount = Number(paidNow);
    if (paymentChoice === 'part' && (!Number.isFinite(partAmount) || partAmount <= 0 || partAmount >= totalNetDraft)) {
      alert(`For a part payment, enter an amount between 0 and ${money(totalNetDraft)}.`);
      return;
    }

    try {
      setSaving(true);
      const payload = {
        company_id: Number(selectedCompanyId),
        supplier_invoice_no: supplierInvoiceNo || null,
        purchase_date: purchaseDate,
        // Paid in full or on credit; a part payment sends the amount (the server works out the status)
        payment_status: paymentChoice === 'full' ? 'Paid' : paymentChoice === 'credit' ? 'Pending' : 'Partial',
        ...(paymentChoice === 'part' ? { paid_amount: partAmount } : {}),
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
        setPaymentChoice('full');
        setPaidNow('');
        const owed = res.netTotal - res.paidAmount;
        setFeedback(`Purchase ${res.invoiceNo} saved. Stock and trade prices updated.${owed > 0.005 ? ` ${money(owed)} added to what you owe this supplier.` : ''}`);
        loadData();
        setSuppliersRefreshKey(k => k + 1);
        setTimeout(() => setFeedback(null), 6000);
      }
    } catch (err: any) {
      alert('Failed to save purchase: ' + err.message);
    } finally {
      setSaving(false);
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

        {hasPermission('can_add_purchase') && (
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
        )}
      </div>

      {feedback && (
        <div className="flex items-center space-x-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800" role="tablist">
        {([
          { key: 'purchases', label: 'Purchases', icon: ClipboardList },
          { key: 'suppliers', label: 'Suppliers (payables)', icon: Wallet },
          { key: 'returns', label: 'Returns to Supplier', icon: PackageX }
        ] as const).map(t => (
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

      {tab === 'suppliers' && (
        <SuppliersTab
          settings={settings}
          money={money}
          currency={currency}
          canPay={hasPermission('can_pay_supplier')}
          refreshKey={suppliersRefreshKey}
        />
      )}

      {tab === 'returns' && (
        <PurchaseReturnsTab
          settings={settings}
          companies={companies}
          products={products}
          purchases={purchases}
          money={money}
          canReturn={hasPermission('can_return_purchase')}
          onChanged={() => {
            loadData();
            setSuppliersRefreshKey(k => k + 1);
          }}
        />
      )}

      {/* Purchases Invoices Table */}
      {tab === 'purchases' && (
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
                      <span className={PAYMENT_BADGE[pur.payment_status] ?? 'badge-warning'}>
                        {pur.payment_status}
                      </span>
                      {(pur.amount_due ?? 0) > 0.005 && (
                        <div className="text-2xs font-mono text-amber-600 dark:text-amber-400 mt-0.5">Due {money(pur.amount_due ?? 0)}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => openVoucher(pur)}
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
      )}

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
              <label htmlFor="purchase-payment" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Payment</label>
              <select
                id="purchase-payment"
                value={paymentChoice}
                onChange={(e) => setPaymentChoice(e.target.value as PaymentChoice)}
                className="field-select field-sm w-full"
              >
                <option value="full">Paid in full</option>
                <option value="credit">On credit (pay later)</option>
                <option value="part">Part paid now</option>
              </select>
              {paymentChoice === 'part' && (
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={paidNow}
                  onChange={(e) => setPaidNow(e.target.value)}
                  placeholder={`Paid now (${currency})`}
                  aria-label="Amount paid now"
                  className="field-input field-sm w-full font-mono mt-1.5"
                />
              )}
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
              disabled={draftItems.length === 0 || saving}
              className="btn-primary"
            >
              {saving ? 'Saving…' : 'Post Purchase & Update Stock'}
            </button>
          </div>
        </form>
      </Modal>

      {/* View Purchase Voucher Modal */}
      <Modal
        isOpen={!!viewInvoice}
        onClose={() => setViewInvoice(null)}
        title={`Purchase Voucher - ${viewInvoice?.invoice_no ?? ''}`}
        maxWidth="max-w-3xl"
      >
        {viewInvoice && (
          <div className="space-y-4 text-xs">
            <div ref={voucherRef} className="space-y-3 text-slate-800 dark:text-slate-200">
              <div className="bg-slate-50 dark:bg-surface-inset-dark p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                <h1 className="text-base font-extrabold text-slate-900 dark:text-white">{settings?.store_name || 'Purchase voucher'}</h1>
                <p><strong>{viewInvoice.company_name}</strong>, purchase {viewInvoice.invoice_no}</p>
                <p className="muted text-slate-500 dark:text-slate-400">Date {viewInvoice.purchase_date}, supplier bill {viewInvoice.supplier_invoice_no || '-'}</p>
                <p>
                  Status <strong>{viewInvoice.payment_status}</strong>
                  {(viewInvoice.amount_due ?? 0) > 0.005 && <>, due <strong>{money(viewInvoice.amount_due ?? 0)}</strong></>}
                </p>
              </div>

              {!viewInvoice.items ? (
                <p className="py-4 text-center text-slate-500 dark:text-slate-400">Loading lines…</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300">
                    <tr>
                      <th className="py-2 px-3">Medicine</th>
                      <th className="py-2 px-3">Batch / expiry</th>
                      <th className="py-2 px-3 text-right num">Boxes</th>
                      <th className="py-2 px-3 text-right num">Cost</th>
                      <th className="py-2 px-3 text-right num">Disc %</th>
                      <th className="py-2 px-3 text-right num">Total</th>
                      <th className="py-2 px-3 text-right num">Returned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {viewInvoice.items.map(item => (
                      <tr key={item.id}>
                        <td className="py-2 px-3">{item.product_name}</td>
                        <td className="py-2 px-3 font-mono">{item.batch_no}{item.expiry_date ? `, ${item.expiry_date}` : ''}</td>
                        <td className="py-2 px-3 text-right font-mono num">{item.quantity_boxes}{item.bonus_boxes > 0 ? ` + ${item.bonus_boxes}` : ''}</td>
                        <td className="py-2 px-3 text-right font-mono num">{money(item.box_cost_price)}</td>
                        <td className="py-2 px-3 text-right font-mono num">{item.discount_pct || 0}</td>
                        <td className="py-2 px-3 text-right font-mono num">{money(item.total_cost)}</td>
                        <td className="py-2 px-3 text-right font-mono num">{item.returned_boxes || '-'}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={5} className="py-2 px-3 text-right font-bold">Net total</td>
                      <td className="py-2 px-3 text-right font-mono font-bold num">{money(viewInvoice.net_total)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setViewInvoice(null)} className="btn-secondary">Close</button>
              <button
                onClick={() => printDocument(voucherRef.current, `Purchase ${viewInvoice.invoice_no}`)}
                disabled={!viewInvoice.items}
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
