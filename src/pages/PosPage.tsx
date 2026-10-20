import React, { useState, useEffect, useRef } from 'react';
import { usePosStore } from '../store/usePosStore';
import { useAuthStore } from '../store/useAuthStore';
import { api } from '../services/apiService';
import { Product, SaleInvoice, SystemSettings } from '../types';
import { Modal } from '../components/common/Modal';
import { ThermalReceipt } from '../components/pos/ThermalReceipt';
import { useShiftStore } from '../store/useShiftStore';
import {
  Search,
  Trash2,
  Plus,
  Minus,
  CheckCircle2,
  Printer,
  RotateCcw,
  AlertTriangle,
  User,
  ShoppingBag,
  CreditCard,
  Banknote,
  Percent,
  Smartphone,
  Lock,
  PlayCircle,
  ShieldAlert
} from 'lucide-react';

interface PosPageProps {
  settings?: SystemSettings | null;
}

/**
 * Calculates 4 smart ascending cash tender denomination tags.
 * Tag 1: Exact actual total (e.g. 96)
 * Tag 2: Next rounded note/multiple (e.g. 100)
 * Tag 3: Next higher standard note (e.g. 500)
 * Tag 4: Next higher standard note (e.g. 1000)
 */
export function getDynamicCashTags(netTotal: number): number[] {
  if (netTotal <= 0) return [0, 100, 500, 1000];

  const exact = Number(netTotal.toFixed(2));
  const ceilVal = Math.ceil(netTotal);
  const standardNotes = [10, 20, 50, 100, 500, 1000, 5000];
  const candidates = new Set<number>();

  // 1. Next multiple rounds
  if (ceilVal < 100) {
    candidates.add(Math.ceil(ceilVal / 10) * 10);
    candidates.add(Math.ceil(ceilVal / 50) * 50);
    candidates.add(Math.ceil(ceilVal / 100) * 100);
  } else if (ceilVal < 1000) {
    candidates.add(Math.ceil(ceilVal / 50) * 50);
    candidates.add(Math.ceil(ceilVal / 100) * 100);
    candidates.add(Math.ceil(ceilVal / 500) * 500);
  } else if (ceilVal < 5000) {
    candidates.add(Math.ceil(ceilVal / 100) * 100);
    candidates.add(Math.ceil(ceilVal / 500) * 500);
    candidates.add(Math.ceil(ceilVal / 1000) * 1000);
  } else {
    candidates.add(Math.ceil(ceilVal / 1000) * 1000);
    candidates.add(Math.ceil(ceilVal / 5000) * 5000);
    candidates.add((Math.ceil(ceilVal / 5000) + 1) * 5000);
  }

  // 2. Add standard currency notes strictly greater than exact
  for (const note of standardNotes) {
    if (note > exact) candidates.add(note);
  }

  // 3. Filter strictly greater than exact, sort ascending, take first 3
  const higherTags = Array.from(candidates)
    .filter(amt => amt > exact)
    .sort((a, b) => a - b)
    .slice(0, 3);

  // If fewer than 3, generate natural logical increments
  while (higherTags.length < 3) {
    const last = higherTags[higherTags.length - 1] || exact;
    higherTags.push(last + (last >= 1000 ? 1000 : 500));
  }

  return [exact, ...higherTags];
}

export const PosPage: React.FC<PosPageProps> = ({ settings }) => {
  const { user } = useAuthStore();
  const {
    cart,
    customerName,
    customerPhone,
    billDiscountPct,
    billDiscountAmt,
    cashTendered,
    paymentType,
    notes,
    addItem,
    updateQuantity,
    updateDiscountPct,
    updateUnitPrice,
    toggleLooseUnit,
    removeItem,
    clearCart,
    setCustomer,
    setBillDiscountPct,
    setBillDiscountAmt,
    setCashTendered,
    setPaymentType,
    setNotes,
    getTotals
  } = usePosStore();

  const {
    activeShift,
    activeSummary,
    fetchShiftSummary,
    setStartModalOpen,
    setClosingModalOpen
  } = useShiftStore();

  const [elapsedMinutes, setElapsedMinutes] = useState<number>(0);

  useEffect(() => {
    if (!activeShift?.start_time) {
      setElapsedMinutes(0);
      return;
    }
    const update = () => {
      const diffMs = Math.max(0, Date.now() - new Date(activeShift.start_time).getTime());
      setElapsedMinutes(Math.floor(diffMs / 60000));
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [activeShift?.start_time]);

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const elapsedRemMinutes = elapsedMinutes % 60;
  const elapsedFormatted = elapsedHours > 0 ? `${elapsedHours}h ${elapsedRemMinutes}m` : `${elapsedRemMinutes}m`;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [selectedResultIdx, setSelectedResultIdx] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingSale, setLoadingSale] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<SaleInvoice | null>(null);

  const maxBillDiscount = settings?.max_bill_discount_pct ? parseFloat(settings.max_bill_discount_pct) : 14;
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const tenderedInputRef = useRef<HTMLInputElement>(null);
  const discountInputRef = useRef<HTMLInputElement>(null);

  const totals = getTotals();
  const currency = settings?.currency_symbol || 'Rs.';

  // Initial focus
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        clearCart();
        searchInputRef.current?.focus();
      } else if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        discountInputRef.current?.focus();
      } else if (e.key === 'F6') {
        e.preventDefault();
        tenderedInputRef.current?.focus();
      } else if (e.key === 'F9' || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault();
        if (cart.length > 0 && !loadingSale) {
          if (!activeShift) {
            setErrorMessage('No active cashier shift. Please start a shift before finalizing sales.');
            setStartModalOpen(true);
            return;
          }
          handleCompleteSale(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, loadingSale, totals, customerName, paymentType, activeShift]);

  // Product search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearching(true);
        const results = await api.searchProducts(searchQuery.trim());
        setSearchResults(results);
        setSelectedResultIdx(0);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectProduct = (product: Product, isLoose = false) => {
    addItem(product, isLoose, 1);
    setSearchQuery('');
    setSearchResults([]);
    searchInputRef.current?.focus();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedResultIdx((prev) => (prev + 1) % searchResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedResultIdx((prev) => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const product = searchResults[selectedResultIdx];
      if (product) {
        handleSelectProduct(product, false);
      }
    }
  };

  const handleCompleteSale = async (shouldPrint = true) => {
    if (!activeShift) {
      setErrorMessage('Cashier shift is not active. Please start a shift first.');
      setStartModalOpen(true);
      return;
    }

    if (cart.length === 0) {
      setErrorMessage('Please add at least one product to the invoice.');
      return;
    }

    try {
      setLoadingSale(true);
      setErrorMessage(null);

      const salePayload = {
        shift_id: activeShift.id,
        customer_name: customerName || 'Counter Customer',
        customer_phone: customerPhone || null,
        user_id: user?.id || null,
        user_name: user?.full_name || 'Cashier',
        items: cart.map(item => ({
          product_id: item.product.id,
          is_loose: item.is_loose,
          quantity: item.quantity,
          unit_price: item.unit_price,
          gross_amount: item.gross_amount,
          discount_pct: item.discount_pct,
          discount_amount: item.discount_amount,
          net_amount: item.net_amount,
          batch_id: item.batch_id
        })),
        total_gross: totals.grossTotal,
        total_item_discount: totals.itemDiscounts,
        bill_discount_pct: billDiscountPct,
        bill_discount_amt: totals.billDiscountAmt,
        net_total: totals.netTotal,
        cash_tendered: cashTendered > 0 ? cashTendered : totals.netTotal,
        change_due: totals.changeDue,
        payment_type: paymentType,
        notes: notes || null
      };

      const result = await api.createSale(salePayload);

      if (result.success) {
        // Construct printable invoice object
        const invoiceObj: SaleInvoice = {
          id: result.saleId,
          invoice_no: result.invoiceNo,
          customer_name: customerName || 'Counter Customer',
          customer_phone: customerPhone || null,
          user_name: user?.full_name || 'Cashier',
          sale_date: new Date().toISOString(),
          total_gross: totals.grossTotal,
          total_item_discount: totals.itemDiscounts,
          bill_discount_pct: billDiscountPct,
          bill_discount_amt: totals.billDiscountAmt,
          net_total: totals.netTotal,
          cash_tendered: cashTendered > 0 ? cashTendered : totals.netTotal,
          change_due: totals.changeDue,
          payment_type: paymentType,
          status: 'completed',
          items: cart.map(i => ({
            product_id: i.product.id,
            c_code: i.product.c_code,
            p_code: i.product.p_code,
            product_name: i.product.name,
            unit_type: i.product.unit_type,
            location_rack: i.product.location_rack,
            is_loose: i.is_loose ? 1 : 0,
            quantity: i.quantity,
            unit_price: i.unit_price,
            unit_cost: i.is_loose ? i.product.unit_trade_price : i.product.box_trade_price,
            gross_amount: i.gross_amount,
            discount_pct: i.discount_pct,
            discount_amount: i.discount_amount,
            net_amount: i.net_amount
          }))
        };

        clearCart();
        setCreatedInvoice(invoiceObj);
        if (activeShift) {
          fetchShiftSummary(activeShift.id);
        }

        if (shouldPrint) {
          setIsReceiptModalOpen(true);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to process sale');
    } finally {
      setLoadingSale(false);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-100/60 dark:bg-[#0b0f19] text-slate-800 dark:text-slate-100 transition-colors duration-200 relative">
      {/* Shift Inactive Lock Overlay */}
      {!activeShift && (
        <div className="absolute inset-0 z-40 bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111827] border border-amber-300/60 dark:border-amber-700/60 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 mx-auto flex items-center justify-center shadow-inner">
              <Lock className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                Cashier Shift Inactive / Locked
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Invoicing and counter sales are strictly locked until a cashier shift is opened. Declare your opening cash float to begin your working session.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setStartModalOpen(true)}
                className="w-full btn-save py-2.5 text-xs font-bold flex items-center justify-center space-x-2 shadow-lg shadow-teal-500/20"
              >
                <PlayCircle className="w-4 h-4" />
                <span>Start Cashier Shift Now</span>
              </button>
            </div>
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-400 flex items-center justify-center space-x-1">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
              <span>Anti-Bypass Protection Active • All operations audited</span>
            </div>
          </div>
        </div>
      )}

      {/* LEFT: Cart and Search Panel */}
      <div className="flex-1 flex flex-col p-4 border-r border-slate-200 dark:border-slate-800 space-y-3 overflow-hidden">
        {/* Active Shift Header Ribbon */}
        {activeShift && (
          <div className="bg-white dark:bg-[#111827] border border-teal-500/30 dark:border-teal-500/20 rounded-xl px-3.5 py-2 flex items-center justify-between text-xs shadow-sm flex-shrink-0">
            <div className="flex items-center space-x-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-slate-900 dark:text-white font-mono">{activeShift.shift_no}</span>
                  <span className="text-[10px] text-teal-700 dark:text-teal-300 font-mono bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.5 rounded border border-teal-200 dark:border-teal-800">
                    On Duty: {elapsedFormatted}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  Cashier: <strong className="text-slate-700 dark:text-slate-300">{activeShift.user_name}</strong> • Float: <strong className="font-mono">{currency} {activeShift.opening_cash.toFixed(2)}</strong>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {activeSummary && (
                <div className="text-right text-[11px] hidden sm:block">
                  <div className="text-slate-500 dark:text-slate-400">Drawer Cash:</div>
                  <div className="font-mono font-bold text-teal-600 dark:text-teal-400">
                    {currency} {activeSummary.expected_cash.toFixed(2)}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setClosingModalOpen(true)}
                className="btn-cancel px-2.5 py-1 text-xs font-semibold flex items-center space-x-1"
                title="Reconcile Cash Drawer & Close Shift"
              >
                <Lock className="w-3 h-3 text-amber-500" />
                <span>Close Shift</span>
              </button>
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="relative">
          <div className="flex items-center bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 shadow-sm focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 transition-all">
            <Search className="w-5 h-5 text-teal-600 dark:text-teal-400 mr-3 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search by Barcode, P-Code (e.g. PAN-500), C-Code (GSK), or Medicine Name... [F2]"
              className="w-full bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none text-sm font-medium"
            />
            {isSearching && (
              <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
            )}
          </div>

          {/* Search Dropdown Results */}
          {searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-12 z-30 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {searchResults.map((prod, idx) => {
                const isSelected = idx === selectedResultIdx;
                const isOut = prod.stock_boxes === 0 && prod.stock_loose === 0;
                return (
                  <div
                    key={prod.id}
                    onClick={() => handleSelectProduct(prod, false)}
                    className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-teal-50 dark:bg-teal-950/70 text-teal-900 dark:text-teal-200'
                        : 'hover:bg-slate-50 dark:hover:bg-[#162032] text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">{prod.name}</span>
                        <span className="px-1.5 py-0.5 text-[10px] bg-slate-100 dark:bg-[#0d131f] text-teal-700 dark:text-teal-300 font-mono rounded font-semibold border border-slate-200 dark:border-slate-700">{prod.c_code}</span>
                        <span className="px-1.5 py-0.5 text-[10px] bg-slate-100 dark:bg-[#0d131f] text-slate-600 dark:text-slate-400 font-mono rounded border border-slate-200 dark:border-slate-700">{prod.p_code}</span>
                        {prod.location_rack && (
                          <span className="px-1.5 py-0.5 text-[10px] badge-warning">Loc: {prod.location_rack}</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center space-x-3 mt-1">
                        <span>{prod.generic_name || prod.unit_type}</span>
                        <span>•</span>
                        <span>Pack: {prod.packing} {prod.unit_type}</span>
                        <span>•</span>
                        <span className={isOut ? 'text-rose-600 dark:text-rose-400 font-bold' : prod.stock_boxes <= prod.min_stock_alert ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-emerald-600 dark:text-emerald-400 font-semibold'}>
                          Stock: {prod.stock_boxes} Bx, {prod.stock_loose} Loose
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        <div className="text-sm font-bold text-teal-600 dark:text-teal-400">{currency} {prod.box_retail_price.toFixed(2)} / Box</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{currency} {prod.unit_retail_price.toFixed(2)} / Unit</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectProduct(prod, true);
                        }}
                        title="Add as loose unit"
                        className="px-2.5 py-1 text-xs bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 rounded-lg border border-amber-200 dark:border-amber-800 font-semibold transition-colors"
                      >
                        + Loose
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Error banner if any */}
        {errorMessage && (
          <div className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
            <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Cart Items Table */}
        <div className="flex-1 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm">
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-[#0d131f] border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 uppercase font-semibold text-[11px] tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3 w-8">#</th>
                  <th className="py-2.5 px-3">Product Name</th>
                  <th className="py-2.5 px-3 w-24">C / P Code</th>
                  <th className="py-2.5 px-3 w-28 text-center">Unit Sale Type</th>
                  <th className="py-2.5 px-3 w-28 text-center">Qty</th>
                  <th className="py-2.5 px-3 w-24 text-right">Rate</th>
                  <th className="py-2.5 px-3 w-20 text-center">Disc %</th>
                  <th className="py-2.5 px-3 w-24 text-right">Net</th>
                  <th className="py-2.5 px-2 w-10 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {cart.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-20 text-center text-slate-400 dark:text-slate-500">
                      <ShoppingBag className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-700 mb-2 stroke-[1.5]" />
                      <div className="font-semibold text-slate-600 dark:text-slate-400">Cart is empty</div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">Scan a barcode or search products using [F2]</div>
                    </td>
                  </tr>
                ) : (
                  cart.map((item, idx) => {
                    const availableBoxes = item.product.stock_boxes;
                    const availableLoose = item.product.stock_loose;
                    const isOverStock = item.is_loose
                      ? item.quantity > ((availableBoxes * item.product.packing) + availableLoose)
                      : item.quantity > availableBoxes;

                    return (
                      <tr
                        key={idx}
                        className={`transition-colors ${
                          idx % 2 === 0
                            ? 'bg-transparent'
                            : 'bg-slate-50/70 dark:bg-[#0d131f]/40'
                        } hover:bg-teal-50/50 dark:hover:bg-teal-950/20`}
                      >
                        <td className="py-2.5 px-3 text-slate-400 dark:text-slate-500 font-mono">{idx + 1}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
                            <span>{item.product.name}</span>
                            {isOverStock && (
                              <span title="Quantity exceeds stock on hand" className="text-amber-500">
                                <AlertTriangle className="w-3.5 h-3.5 inline" />
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center space-x-2 mt-0.5">
                            <span>{item.product.unit_type}</span>
                            {item.product.location_rack && (
                              <span className="text-amber-600 dark:text-amber-400 font-mono font-semibold">[{item.product.location_rack}]</span>
                            )}
                          </div>
                        </td>

                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                          <div className="font-semibold text-teal-700 dark:text-teal-400">{item.product.c_code}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-500">{item.product.p_code}</div>
                        </td>

                        {/* Box vs Loose Unit Toggle */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => toggleLooseUnit(idx)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-all ${
                              item.is_loose
                                ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                                : 'bg-teal-50 dark:bg-teal-950/70 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300'
                            }`}
                          >
                            {item.is_loose ? 'Loose Unit' : 'Full Box/Pack'}
                          </button>
                        </td>

                        {/* Qty increment/decrement */}
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center space-x-1">
                            <button
                              onClick={() => updateQuantity(idx, item.quantity - 1)}
                              className="p-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateQuantity(idx, parseFloat(e.target.value) || 1)}
                              className="w-12 text-center bg-white dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded py-0.5 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-teal-500"
                            />
                            <button
                              onClick={() => updateQuantity(idx, item.quantity + 1)}
                              className="p-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        {/* Editable Rate */}
                        <td className="py-2.5 px-3 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(e) => updateUnitPrice(idx, parseFloat(e.target.value) || 0)}
                            className="w-16 text-right bg-white dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded py-0.5 px-1 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-teal-500"
                          />
                        </td>

                        {/* Item Discount % */}
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={item.discount_pct}
                            onChange={(e) => updateDiscountPct(idx, parseFloat(e.target.value) || 0)}
                            className="w-12 text-center bg-white dark:bg-[#0d131f] border border-slate-300 dark:border-slate-700 rounded py-0.5 px-1 text-teal-700 dark:text-teal-300 font-mono text-xs focus:outline-none focus:border-teal-500 font-semibold"
                          />
                        </td>

                        {/* Net line amount */}
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                          {currency} {item.net_amount.toFixed(2)}
                        </td>

                        {/* Remove item */}
                        <td className="py-2.5 px-2 text-center">
                          <button
                            onClick={() => removeItem(idx)}
                            className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Cart Table Footer Info */}
          <div className="p-3 bg-slate-50 dark:bg-[#0d131f] border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center space-x-3">
              <span>Lines: <strong className="text-slate-900 dark:text-white font-bold">{cart.length}</strong></span>
              <span>•</span>
              <span>Total Qty: <strong className="text-slate-900 dark:text-white font-bold">{totals.totalItemsCount}</strong></span>
            </div>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="flex items-center space-x-1 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear Cart [F1]</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: Bill Summary & Payment Settlement Panel */}
      <div className="w-96 p-4 flex flex-col justify-between bg-white dark:bg-[#111827] border-l border-slate-200 dark:border-slate-800 overflow-y-auto space-y-4 shadow-sm">
        {/* Customer Information */}
        <div className="bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span className="flex items-center space-x-1.5">
              <User className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span>Customer Details</span>
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Counter Sale</span>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomer(null, e.target.value, customerPhone)}
              placeholder="Customer Name (e.g. Counter Customer)"
              className="w-full bg-white dark:bg-[#162032] border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
            <input
              type="text"
              value={customerPhone}
              onChange={(e) => setCustomer(null, customerName, e.target.value)}
              placeholder="Contact Number (Optional)"
              className="w-full bg-white dark:bg-[#162032] border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </div>
        </div>

        {/* Bill Calculations breakdown */}
        <div className="bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
            <span>Gross Total:</span>
            <span className="font-mono text-slate-900 dark:text-slate-200 font-semibold">{currency} {totals.grossTotal.toFixed(2)}</span>
          </div>

          <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
            <span>Item Discounts:</span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">-{currency} {totals.itemDiscounts.toFixed(2)}</span>
          </div>

          {/* Overall Bill Discount */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs text-slate-700 dark:text-slate-300 flex items-center space-x-1 font-medium">
              <Percent className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span>Bill Disc [F4]:</span>
            </span>
            <div className="flex items-center space-x-1.5">
              <input
                ref={discountInputRef}
                type="number"
                min="0"
                max={maxBillDiscount}
                value={billDiscountPct || ''}
                onChange={(e) => {
                  let val = parseFloat(e.target.value) || 0;
                  if (val > maxBillDiscount) {
                    val = maxBillDiscount;
                  }
                  if (val < 0) val = 0;
                  setBillDiscountPct(val, maxBillDiscount);
                }}
                placeholder="%"
                className="w-14 text-center bg-white dark:bg-[#162032] border border-slate-300 dark:border-slate-700 rounded-lg py-1 px-1 text-teal-700 dark:text-teal-300 font-mono text-xs font-bold focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">%</span>
              <span className="text-[10px] text-teal-700 dark:text-teal-300 font-bold bg-teal-50 dark:bg-teal-950/70 border border-teal-200 dark:border-teal-800 px-1.5 py-0.5 rounded">
                Max {maxBillDiscount}%
              </span>
            </div>
          </div>

          {totals.billDiscountAmt > 0 && (
            <div className="flex justify-between items-center text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <span>Bill Discount Amt:</span>
              <span className="font-mono font-bold">-{currency} {totals.billDiscountAmt.toFixed(2)}</span>
            </div>
          )}

          {/* NET PAYABLE */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col space-y-1">
            <span className="text-xs uppercase font-extrabold tracking-wider text-slate-500 dark:text-slate-400">Net Payable Amount</span>
            <div className="bg-gradient-to-r from-teal-50 to-emerald-50 dark:from-teal-950/40 dark:to-emerald-950/30 p-3 rounded-xl border border-teal-200 dark:border-teal-800/60 flex items-baseline justify-between">
              <span className="text-xs font-bold text-teal-700 dark:text-teal-300">TOTAL</span>
              <div className="text-3xl font-extrabold font-mono text-teal-700 dark:text-teal-400 tracking-tight">
                {currency} {totals.netTotal.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* Payment Type Selection */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Payment Method</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {(['Cash', 'Card', 'Online', 'Credit'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setPaymentType(type)}
                className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 border transition-all ${
                  paymentType === type
                    ? 'bg-teal-600 text-white border-teal-500 shadow-md shadow-teal-500/20'
                    : 'bg-white dark:bg-[#0d131f] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#162032]'
                }`}
              >
                {type === 'Cash' && <Banknote className="w-3.5 h-3.5" />}
                {type === 'Card' && <CreditCard className="w-3.5 h-3.5" />}
                {type === 'Online' && <Smartphone className="w-3.5 h-3.5" />}
                {type === 'Credit' && <User className="w-3.5 h-3.5" />}
                <span>{type}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Cash Tendered & Change calculator */}
        <div className="bg-slate-50 dark:bg-[#0d131f] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-700 dark:text-slate-300 font-semibold">Cash Received [F6]:</span>
            <input
              ref={tenderedInputRef}
              type="number"
              value={cashTendered || ''}
              onChange={(e) => setCashTendered(parseFloat(e.target.value) || 0)}
              placeholder={totals.netTotal.toString()}
              className="w-28 text-right bg-white dark:bg-[#162032] border border-slate-300 dark:border-slate-700 rounded-lg py-1 px-2 text-slate-900 dark:text-white font-mono text-sm font-bold focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </div>

          {/* Quick denomination chips */}
          <div className="flex space-x-1.5 pt-1">
            {getDynamicCashTags(totals.netTotal).map((amt, idx) => {
              const isExact = idx === 0;
              const isSelected = cashTendered === amt;

              return (
                <button
                  key={idx}
                  onClick={() => setCashTendered(amt)}
                  title={isExact ? 'Exact Net Total' : `Tender ${currency} ${amt}`}
                  className={`flex-1 py-1 px-1 text-[10px] font-mono font-semibold rounded border transition-all truncate ${
                    isSelected
                      ? 'bg-teal-600 text-white border-teal-500 shadow-sm'
                      : isExact
                      ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/40'
                      : 'bg-white dark:bg-[#162032] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {isExact ? `${amt}` : amt}
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Change Due:</span>
            <span className="font-mono text-base font-bold text-amber-600 dark:text-amber-400">
              {currency} {totals.changeDue.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-2">
          <button
            onClick={() => handleCompleteSale(true)}
            disabled={cart.length === 0 || loadingSale}
            className="w-full py-3.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg shadow-teal-500/20 active:scale-[0.99] transition-all flex items-center justify-center space-x-2"
          >
            <Printer className="w-4 h-4" />
            <span>{loadingSale ? 'Processing Sale...' : 'Save & Print Invoice [F9]'}</span>
          </button>

          <button
            onClick={() => handleCompleteSale(false)}
            disabled={cart.length === 0 || loadingSale}
            className="w-full py-2 bg-slate-100 dark:bg-[#162032] hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-xl border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center space-x-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>Save Without Print</span>
          </button>
        </div>
      </div>

      {/* Printable Thermal Receipt Modal */}
      <Modal
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        title="Sale Completed - Thermal Receipt"
        maxWidth="max-w-md"
      >
        {createdInvoice && (
          <ThermalReceipt
            invoice={createdInvoice}
            settings={settings}
            onClose={() => setIsReceiptModalOpen(false)}
          />
        )}
      </Modal>
    </div>
  );
};
