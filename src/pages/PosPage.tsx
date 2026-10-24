import React, { useState, useEffect, useRef } from 'react';
import { usePosStore } from '../store/usePosStore';
import { useAuthStore } from '../store/useAuthStore';
import { api } from '../services/apiService';
import { Product, SaleInvoice, SystemSettings } from '../types';
import { Modal } from '../components/common/Modal';
import { UnifiedInvoice } from '../components/pos/UnifiedInvoice';
import { InvoiceTabs } from '../components/pos/InvoiceTabs';
import { CustomerPicker } from '../components/pos/CustomerPicker';
import { MAX_OPEN_INVOICES } from '../store/usePosStore';
import { loadPrintPrefs, printReceiptIn } from '../utils/printReceipt';
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
  ShieldAlert,
  Keyboard,
} from 'lucide-react';
import { currencySymbol, moneyFormatter } from '../utils/format';
import { useShiftElapsed } from '../hooks/useShiftElapsed';

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
function getDynamicCashTags(netTotal: number): number[] {
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
  const { user, hasPermission } = useAuthStore();
  const {
    cart,
    customerId,
    customerName,
    customerPhone,
    billDiscountPct,
    cashTendered,
    paymentType,
    notes,
    addItem,
    updateQuantity,
    updateDiscountPct,
    updateUnitPrice,
    toggleLooseUnit,
    removeItem,
    setCustomer,
    setBillDiscountPct,
    setCashTendered,
    setPaymentType,
    getTotals,
    activeId,
    lastCompletedSale,
    newInvoice,
    closeInvoice,
    switchInvoice,
    switchInvoiceBy,
    completeActiveInvoice,
    claimInvoices,
    getInvoiceTabs
  } = usePosStore();

  const {
    activeShift,
    activeSummary,
    fetchShiftSummary,
    setStartModalOpen,
    setClosingModalOpen
  } = useShiftStore();

  const elapsedFormatted = useShiftElapsed(activeShift?.start_time);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [selectedResultIdx, setSelectedResultIdx] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingSale, setLoadingSale] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<SaleInvoice | null>(null);

  const maxBillDiscount = settings?.max_bill_discount_pct ? parseFloat(settings.max_bill_discount_pct) : 14;
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Tab waiting for "close invoice with items?" confirmation
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const tenderedInputRef = useRef<HTMLInputElement>(null);
  const discountInputRef = useRef<HTMLInputElement>(null);
  const customerNameInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef<boolean>(false);
  const receiptContainerRef = useRef<HTMLDivElement>(null);

  const canDiscount = hasPermission('can_discount');
  const totals = getTotals();
  const currency = currencySymbol(settings);
  const money = moneyFormatter(settings);

  // Initial focus
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Open invoices saved on this computer belong to the user who opened them
  useEffect(() => {
    claimInvoices(user?.id ?? null);
  }, [user?.id, claimInvoices]);

  // After opening, closing or switching an invoice tab: clean search and focus it for the next scan
  const resetWorkspace = () => {
    setSearchQuery('');
    setSearchResults([]);
    setErrorMessage(null);
    setIsReceiptModalOpen(false);
    setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 50);
  };

  const handleNewInvoice = () => {
    if (!newInvoice()) {
      setErrorMessage(`Up to ${MAX_OPEN_INVOICES} invoices can be open at once. Save or close one first.`);
      return;
    }
    resetWorkspace();
  };

  const handleSwitchInvoice = (id: string) => {
    if (id === activeId) return;
    switchInvoice(id);
    resetWorkspace();
  };

  const handleSwitchInvoiceBy = (delta: number) => {
    switchInvoiceBy(delta);
    resetWorkspace();
  };

  // A tab with items asks first; an empty one closes at once
  const requestCloseInvoice = (id: string) => {
    const tab = getInvoiceTabs().find(t => t.id === id);
    if (!tab) return;
    if (tab.draft.cart.length > 0) {
      setPendingCloseId(id);
      return;
    }
    closeInvoice(id);
    resetWorkspace();
  };

  const confirmCloseInvoice = () => {
    if (pendingCloseId) closeInvoice(pendingCloseId);
    setPendingCloseId(null);
    resetWorkspace();
  };

  const pendingCloseTab = pendingCloseId ? getInvoiceTabs().find(t => t.id === pendingCloseId) : undefined;

  // Prints the receipt shown in the receipt modal (after it has rendered)
  const printShownReceipt = (delayMs = 0) => {
    setTimeout(() => { void printReceiptIn(receiptContainerRef.current); }, delayMs);
  };

  // Keyboard shortcuts engine: attached once, always runs the latest handler
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  keyHandlerRef.current = (e: KeyboardEvent) => {
      const anyModalOpen = isReceiptModalOpen || isShortcutsModalOpen || pendingCloseId !== null;
      const ctrl = e.ctrlKey || e.metaKey;
      // The close-invoice question takes Enter/Esc itself; no other shortcut runs behind it
      if (pendingCloseId !== null && e.key !== 'Escape') return;

      // Invoice tabs: Ctrl+T new, Ctrl+W close, Ctrl+←/→ or Ctrl+(Shift+)Tab switch, Ctrl+1…9 jump
      if (ctrl && !e.altKey) {
        const key = e.key.toLowerCase();
        const digit = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
        const isTabKey = key === 't' || key === 'w' || key === 'tab' || e.key === 'ArrowRight' || e.key === 'ArrowLeft' || (digit > 0 && !e.shiftKey);
        if (isTabKey) {
          e.preventDefault();
          if (e.repeat || anyModalOpen || isSubmittingRef.current) return;
          if (key === 't') handleNewInvoice();
          else if (key === 'w') requestCloseInvoice(activeId);
          else if (key === 'tab') handleSwitchInvoiceBy(e.shiftKey ? -1 : 1);
          else if (e.key === 'ArrowRight') handleSwitchInvoiceBy(1);
          else if (e.key === 'ArrowLeft') handleSwitchInvoiceBy(-1);
          else {
            const tab = getInvoiceTabs()[digit - 1];
            if (tab) handleSwitchInvoice(tab.id);
          }
          return;
        }
      }

      // 1. F2: Open a new invoice tab (the current one stays open)
      if (e.key === 'F2') {
        e.preventDefault();
        if (e.repeat || anyModalOpen || isSubmittingRef.current) return;
        handleNewInvoice();
      }
      // 2. F3: Focus the product search field
      else if (e.key === 'F3') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      // 3. F4: Focus the customer selection field
      else if (e.key === 'F4') {
        e.preventDefault();
        customerNameInputRef.current?.focus();
        customerNameInputRef.current?.select();
      }
      // 4. F6: Apply a discount, subject to permissions
      else if (e.key === 'F6') {
        e.preventDefault();
        if (!hasPermission('can_discount')) {
          setErrorMessage('Permission Denied: You do not have authorization to apply bill discounts. Please contact an administrator.');
          return;
        }
        discountInputRef.current?.focus();
        discountInputRef.current?.select();
      }
      // 5. F8: Open the payment section (Focus cash tendered)
      else if (e.key === 'F8') {
        e.preventDefault();
        tenderedInputRef.current?.focus();
        tenderedInputRef.current?.select();
      }
      // 6. F9: Save or finalize the invoice, subject to validation
      else if (e.key === 'F9' || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault();
        if (e.repeat) return; // Prevent repeated submission when key is held down
        if (isSubmittingRef.current || loadingSale) return;
        handleCompleteSale(false);
      }
      // 7. F10: Print the invoice / direct receipt print
      else if (e.key === 'F10') {
        e.preventDefault();
        if (e.repeat) return;
        if (isReceiptModalOpen) {
          printShownReceipt();
        } else if (cart.length > 0) {
          if (isSubmittingRef.current || loadingSale) return;
          handleCompleteSale(true);
        } else if (lastCompletedSale || createdInvoice) {
          setCreatedInvoice(lastCompletedSale || createdInvoice);
          setIsReceiptModalOpen(true);
          printShownReceipt(300);
        }
      }
      // 8. Esc: Close a dialog or cancel current action where safe
      else if (e.key === 'Escape') {
        if (pendingCloseId) {
          e.preventDefault();
          setPendingCloseId(null);
        } else if (isReceiptModalOpen) {
          e.preventDefault();
          setIsReceiptModalOpen(false);
          searchInputRef.current?.focus();
        } else if (isShortcutsModalOpen) {
          e.preventDefault();
          setIsShortcutsModalOpen(false);
        } else if (searchResults.length > 0) {
          e.preventDefault();
          setSearchResults([]);
          setSearchQuery('');
          searchInputRef.current?.focus();
        }
      }
  };

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
    const canOpen = product.allow_open_sale !== false && product.allow_open_sale !== 0;
    if (isLoose && !canOpen) {
      setErrorMessage(`Open packaging sale is prohibited for "${product.name}". This medicine can only be sold in complete packs.`);
      addItem(product, false, 1);
    } else {
      setErrorMessage(null);
      addItem(product, isLoose, 1);
    }
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
    if (isSubmittingRef.current || loadingSale) {
      return;
    }

    if (!activeShift) {
      setErrorMessage('Cannot finalize invoice: No active cashier shift found. Please start a shift first.');
      setStartModalOpen(true);
      return;
    }

    if (cart.length === 0) {
      setErrorMessage('Cannot finalize invoice: Cart is empty. Please search and add medicines first [F3].');
      searchInputRef.current?.focus();
      return;
    }

    // Validate Open-Sale Rules & Minimum Quantities before completing sale
    for (const item of cart) {
      const canOpen = item.product.allow_open_sale !== false && item.product.allow_open_sale !== 0;
      if (item.is_loose && !canOpen) {
        setErrorMessage(`Validation Error: "${item.product.name}" cannot be sold as loose units. Please switch to full packaging or remove it.`);
        return;
      }
      const minQty = item.product.min_sale_qty || 1;
      if (item.quantity < minQty) {
        setErrorMessage(`Validation Error: Minimum sale quantity for "${item.product.name}" is ${minQty} ${item.is_loose ? item.product.unit_type : 'Pack(s)'}.`);
        return;
      }
    }

    if (paymentType === 'Credit' && !customerId) {
      setErrorMessage('Select or save the customer for a credit (khata) sale [F4].');
      customerNameInputRef.current?.focus();
      return;
    }

    try {
      isSubmittingRef.current = true;
      setLoadingSale(true);
      setErrorMessage(null);

      const salePayload = {
        shift_id: activeShift.id,
        customer_id: customerId,
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
          })),
          store_name_snapshot: result.store_name_snapshot ?? null,
          store_address_snapshot: result.store_address_snapshot ?? null,
          invoice_footer_snapshot: result.invoice_footer_snapshot ?? null
        };

        // The sold invoice's tab closes; other open invoices stay as they were
        completeActiveInvoice(invoiceObj);
        setCreatedInvoice(invoiceObj);
        setSearchQuery('');
        setSearchResults([]);
        if (activeShift) {
          fetchShiftSummary(activeShift.id);
        }

        if (shouldPrint) {
          setIsReceiptModalOpen(true);
          // Print without dialog: the receipt goes to the printer as soon as it is shown
          if (loadPrintPrefs().silent) printShownReceipt(300);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to process sale');
    } finally {
      isSubmittingRef.current = false;
      setLoadingSale(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-100/60 dark:bg-[#0b0f19] text-slate-800 dark:text-slate-100 transition-colors duration-200 relative">
      {/* Shift Inactive Lock Overlay */}
      {!activeShift && (
        <div className="absolute inset-0 z-40 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111827] border border-amber-300/60 dark:border-amber-700/60 rounded-xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-14 h-14 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 mx-auto flex items-center justify-center shadow-inner">
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
                className="w-full btn-primary"
              >
                <PlayCircle className="w-4 h-4" />
                <span>Start Cashier Shift Now</span>
              </button>
            </div>
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-2xs text-slate-400 flex items-center justify-center space-x-1">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              <span>Anti-Bypass Protection Active • All operations audited</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace (Left Cart & Right Payment) */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Cart and Search Panel */}
        <div className="flex-1 flex flex-col p-4 border-r border-slate-200 dark:border-slate-800 space-y-3 overflow-hidden">
        {/* Active Shift Header Ribbon */}
        {activeShift && (
          <div className="bg-white dark:bg-[#111827] border border-teal-500/30 dark:border-teal-500/20 rounded-xl px-3.5 py-2 flex items-center justify-between text-xs shadow-xs shrink-0">
            <div className="flex items-center space-x-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-slate-900 dark:text-white font-mono">{activeShift.shift_no}</span>
                  <span className="text-2xs text-teal-700 dark:text-teal-300 font-mono bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.5 rounded-sm border border-teal-200 dark:border-teal-800">
                    On Duty: {elapsedFormatted}
                  </span>
                </div>
                <div className="text-2xs text-slate-500 dark:text-slate-400">
                  Cashier: <strong className="text-slate-700 dark:text-slate-300">{activeShift.user_name}</strong> • Float: <strong className="font-mono">{money(activeShift.opening_cash)}</strong>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {activeSummary && (
                <div className="text-right text-xs hidden sm:block">
                  <div className="text-slate-500 dark:text-slate-400">Drawer Cash:</div>
                  <div className="font-mono font-bold text-teal-600 dark:text-teal-400">
                    {money(activeSummary.expected_cash)}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setClosingModalOpen(true)}
                className="btn-secondary btn-sm"
                title="Reconcile Cash Drawer & Close Shift"
              >
                <Lock className="w-4 h-4 text-amber-500" />
                <span>Close Shift</span>
              </button>
            </div>
          </div>
        )}

        {/* Open invoices */}
        <InvoiceTabs onNew={handleNewInvoice} onSwitch={handleSwitchInvoice} onClose={requestCloseInvoice} />

        {/* Search Bar */}
        <div className="relative">
          <div className="flex items-center bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 shadow-xs focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 transition-all">
            <Search className="w-5 h-5 text-teal-600 dark:text-teal-400 mr-3 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search by Barcode, P-Code (e.g. PAN-500), C-Code (GSK), or Medicine Name... [F3]"
              className="w-full bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden text-sm font-medium"
            />
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-sm border border-slate-300 dark:border-slate-700 mr-2 select-none shadow-2xs">F3</kbd>
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
                        <span className="px-1.5 py-0.5 text-2xs bg-slate-100 dark:bg-surface-inset-dark text-teal-700 dark:text-teal-300 font-mono rounded-sm font-semibold border border-slate-200 dark:border-slate-700">{prod.c_code}</span>
                        <span className="px-1.5 py-0.5 text-2xs bg-slate-100 dark:bg-surface-inset-dark text-slate-600 dark:text-slate-400 font-mono rounded-sm border border-slate-200 dark:border-slate-700">{prod.p_code}</span>
                        {prod.location_rack && (
                          <span className="px-1.5 py-0.5 text-2xs badge-warning">Loc: {prod.location_rack}</span>
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

                    <div className="flex items-center space-x-2">
                      <div className="text-right pr-1">
                        <div className="text-xs font-bold text-teal-700 dark:text-teal-400 font-mono">{money(prod.box_retail_price)}<span className="text-2xs font-normal text-slate-400">/Bx</span></div>
                        <div className="text-2xs text-slate-500 dark:text-slate-400 font-mono">{money(prod.unit_retail_price)}<span className="text-2xs font-normal text-slate-400">/Unit</span></div>
                      </div>
                      {(() => {
                        const canOpen = prod.allow_open_sale !== false && prod.allow_open_sale !== 0;
                        return (
                          <div className="flex items-center space-x-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectProduct(prod, false);
                              }}
                              title="Add Full Box/Strip to cart"
                              className="px-2.5 py-1 text-xs bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold transition-all shadow-2xs cursor-pointer"
                            >
                              + Box
                            </button>
                            {canOpen ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectProduct(prod, true);
                                }}
                                title="Add Loose Unit to cart"
                                className="px-2.5 py-1 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold transition-all shadow-2xs cursor-pointer"
                              >
                                + Loose
                              </button>
                            ) : (
                              <span
                                title="Open packaging sale prohibited. Must be sold in full packaging."
                                className="px-2 py-1 text-2xs font-semibold bg-slate-100 dark:bg-[#162032] text-slate-500 dark:text-slate-400 rounded-lg border border-slate-200 dark:border-slate-750 select-none"
                              >
                                Full Pack Only
                              </span>
                            )}
                          </div>
                        );
                      })()}
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
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Cart Items Table */}
        <div className="flex-1 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-xs">
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-surface-inset-dark border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-semibold text-xs sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3 w-8">#</th>
                  <th className="py-2.5 px-3">Product Name</th>
                  <th className="py-2.5 px-3 w-24">C / P Code</th>
                  <th className="py-2.5 px-3 w-32 text-center">Unit Sale Mode</th>
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
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">Scan a barcode or search medicines using [F3]</div>
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
                            : 'bg-slate-50/70 dark:bg-surface-inset-dark/40'
                        } hover:bg-teal-50/50 dark:hover:bg-teal-950/20`}
                      >
                        <td className="py-2.5 px-3 text-slate-400 dark:text-slate-500 font-mono">{idx + 1}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
                            <span>{item.product.name}</span>
                            {isOverStock && (
                              <span title="Quantity exceeds stock on hand" className="text-amber-500">
                                <AlertTriangle className="w-4 h-4 inline" />
                              </span>
                            )}
                          </div>
                          <div className="text-2xs text-slate-500 dark:text-slate-400 flex items-center space-x-2 mt-0.5">
                            <span>{item.product.unit_type}</span>
                            {item.product.location_rack && (
                              <span className="text-amber-600 dark:text-amber-400 font-mono font-semibold">[{item.product.location_rack}]</span>
                            )}
                          </div>
                        </td>

                        <td className="py-2.5 px-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                          <div className="font-semibold text-teal-700 dark:text-teal-400">{item.product.c_code}</div>
                          <div className="text-2xs text-slate-500 dark:text-slate-500">{item.product.p_code}</div>
                        </td>

                        {/* Dual Unit Sale Segmented Toggle */}
                        <td className="py-2.5 px-3 text-center">
                          {(() => {
                            const canOpen = item.product.allow_open_sale !== false && item.product.allow_open_sale !== 0;
                            return (
                              <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800">
                                <button
                                  type="button"
                                  onClick={() => item.is_loose && toggleLooseUnit(idx)}
                                  className={`px-2 py-0.5 text-2xs font-bold rounded transition-all cursor-pointer ${
                                    !item.is_loose
                                      ? 'bg-teal-600 text-white shadow-2xs'
                                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                  }`}
                                >
                                  Box
                                </button>
                                <button
                                  type="button"
                                  disabled={!canOpen}
                                  onClick={() => {
                                    if (!canOpen) {
                                      setErrorMessage(`Open packaging sale is prohibited for "${item.product.name}". Must be sold in full complete packaging.`);
                                      return;
                                    }
                                    if (!item.is_loose) toggleLooseUnit(idx);
                                  }}
                                  title={canOpen ? "Switch to loose unit sale" : "Open sale prohibited for this medicine"}
                                  className={`px-2 py-0.5 text-2xs font-bold rounded transition-all ${
                                    !canOpen
                                      ? 'opacity-30 cursor-not-allowed text-slate-400 line-through'
                                      : item.is_loose
                                      ? 'bg-amber-600 text-white shadow-2xs cursor-pointer'
                                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer'
                                  }`}
                                >
                                  Loose
                                </button>
                              </div>
                            );
                          })()}
                        </td>

                        {/* Qty increment/decrement */}
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center space-x-1">
                            <button
                              onClick={() => updateQuantity(idx, item.quantity - 1)}
                              className="p-1 rounded-sm bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateQuantity(idx, parseFloat(e.target.value) || 1)}
                              className="field-input field-sm w-12 text-center font-mono"
                            />
                            <button
                              onClick={() => updateQuantity(idx, item.quantity + 1)}
                              className="p-1 rounded-sm bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                            >
                              <Plus className="w-4 h-4" />
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
                            className="field-input field-sm w-16 text-right font-mono"
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
                            className="field-input field-sm w-12 text-center font-mono font-semibold"
                          />
                        </td>

                        {/* Net line amount */}
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                          {money(item.net_amount)}
                        </td>

                        {/* Remove item */}
                        <td className="py-2.5 px-2 text-center">
                          <button
                            onClick={() => removeItem(idx)}
                            className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-sm transition-colors"
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
          <div className="p-3 bg-slate-50 dark:bg-surface-inset-dark border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center space-x-3">
              <span>Lines: <strong className="text-slate-900 dark:text-white font-bold">{cart.length}</strong></span>
              <span>•</span>
              <span>Total Qty: <strong className="text-slate-900 dark:text-white font-bold">{totals.totalItemsCount}</strong></span>
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => requestCloseInvoice(activeId)}
                className="flex items-center space-x-1.5 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium transition-colors"
                title="Discard this invoice and close its tab [Ctrl+W]"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Discard Invoice</span>
                <kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 rounded-sm border border-rose-200 dark:border-rose-800">Ctrl+W</kbd>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: Bill Summary & Payment Settlement Panel */}
      <div className="w-80 xl:w-96 p-4 flex flex-col justify-between bg-white dark:bg-[#111827] border-l border-slate-200 dark:border-slate-800 overflow-y-auto space-y-4 shadow-xs shrink-0">
        {/* Customer Information */}
        <div className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span className="flex items-center space-x-1.5">
              <User className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>Customer Details</span>
              <kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-sm border border-slate-300 dark:border-slate-700">F4</kbd>
            </span>
            <span className="text-2xs text-slate-500 dark:text-slate-400">{customerId ? 'Khata customer' : 'Counter sale'}</span>
          </div>

          <CustomerPicker
            customerId={customerId}
            customerName={customerName}
            customerPhone={customerPhone}
            onChange={setCustomer}
            nameInputRef={customerNameInputRef}
            canAddCustomer={hasPermission('can_add_customer')}
            creditAmount={paymentType === 'Credit' ? totals.netTotal : 0}
            money={money}
          />
        </div>

        {/* Bill Calculations breakdown */}
        <div className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
            <span>Gross Total:</span>
            <span className="font-mono text-slate-900 dark:text-slate-200 font-semibold">{money(totals.grossTotal)}</span>
          </div>

          <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
            <span>Item Discounts:</span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">-{money(totals.itemDiscounts)}</span>
          </div>

          {/* Overall Bill Discount */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs text-slate-700 dark:text-slate-300 flex items-center space-x-1.5 font-medium">
              <Percent className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span>Bill Disc:</span>
              <kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-sm border border-slate-300 dark:border-slate-700">F6</kbd>
              {!canDiscount && (
                <span title="Discount permission required">
                  <Lock className="w-4 h-4 text-amber-500" />
                </span>
              )}
            </span>
            <div className="flex items-center space-x-1.5">
              <input
                ref={discountInputRef}
                type="number"
                min="0"
                max={maxBillDiscount}
                disabled={!canDiscount}
                value={billDiscountPct || ''}
                onChange={(e) => {
                  if (!canDiscount) return;
                  let val = parseFloat(e.target.value) || 0;
                  if (val > maxBillDiscount) {
                    val = maxBillDiscount;
                  }
                  if (val < 0) val = 0;
                  setBillDiscountPct(val, maxBillDiscount);
                }}
                placeholder="%"
                title={!canDiscount ? "Discount permission required" : "Enter bill discount %"}
                className={`w-14 text-center rounded-lg py-1 px-1 font-mono text-xs font-bold focus:outline-hidden focus:ring-1 ${
                  !canDiscount
                    ? 'bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-white dark:bg-[#162032] border border-slate-300 dark:border-slate-700 text-teal-700 dark:text-teal-300 focus:border-teal-500 focus:ring-teal-500'
                }`}
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">%</span>
              <span className="text-2xs text-teal-700 dark:text-teal-300 font-bold bg-teal-50 dark:bg-teal-950/70 border border-teal-200 dark:border-teal-800 px-1.5 py-0.5 rounded-sm">
                Max {maxBillDiscount}%
              </span>
            </div>
          </div>

          {totals.billDiscountAmt > 0 && (
            <div className="flex justify-between items-center text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <span>Bill Discount Amt:</span>
              <span className="font-mono font-bold">-{money(totals.billDiscountAmt)}</span>
            </div>
          )}

          {/* NET PAYABLE */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col space-y-1">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Net Payable Amount</span>
            <div className="bg-teal-50 dark:bg-teal-950/40 p-3 rounded-xl border border-teal-200 dark:border-teal-800/60 flex items-baseline justify-between">
              <span className="text-xs font-bold text-teal-700 dark:text-teal-300">TOTAL</span>
              <div className="text-3xl font-extrabold font-mono text-teal-700 dark:text-teal-400 tracking-tight">
                {money(totals.netTotal)}
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
                    ? 'bg-teal-600 text-white border-teal-500 shadow-md'
                    : 'bg-white dark:bg-surface-inset-dark border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#162032]'
                }`}
              >
                {type === 'Cash' && <Banknote className="w-4 h-4" />}
                {type === 'Card' && <CreditCard className="w-4 h-4" />}
                {type === 'Online' && <Smartphone className="w-4 h-4" />}
                {type === 'Credit' && <User className="w-4 h-4" />}
                <span>{type}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Cash Tendered & Change calculator */}
        <div className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-700 dark:text-slate-300 font-semibold flex items-center space-x-1.5">
              <span>Cash Received:</span>
              <kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-sm border border-slate-300 dark:border-slate-700">F8</kbd>
            </span>
            <input
              ref={tenderedInputRef}
              type="number"
              value={cashTendered || ''}
              onChange={(e) => setCashTendered(parseFloat(e.target.value) || 0)}
              placeholder={totals.netTotal.toString()}
              className="field-input field-sm w-28 text-right font-mono font-bold"
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
                  className={`flex-1 py-1 px-1 text-2xs font-mono font-semibold rounded border transition-all truncate ${
                    isSelected
                      ? 'bg-teal-600 text-white border-teal-500 shadow-xs'
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
              {money(totals.changeDue)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-2">
          <button
            onClick={() => handleCompleteSale(true)}
            disabled={cart.length === 0 || loadingSale}
            className="w-full py-3.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg active:scale-[0.99] transition-all flex items-center justify-center space-x-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{loadingSale ? 'Processing Sale...' : 'Save & Print Invoice'}</span>
            <kbd className="ml-1 px-1.5 py-0.5 text-2xs font-mono font-bold bg-teal-800/60 text-white rounded-sm border border-teal-400/30">F10</kbd>
          </button>

          <button
            onClick={() => handleCompleteSale(false)}
            disabled={cart.length === 0 || loadingSale}
            className="w-full py-2 bg-slate-100 dark:bg-[#162032] hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-xl border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span>Save Without Print</span>
            <kbd className="ml-1 px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-sm border border-slate-300 dark:border-slate-700">F9</kbd>
          </button>
        </div>
      </div>
    </div>

      {/* Persistent Keyboard Shortcuts Bottom Ribbon */}
      <div className="bg-slate-900 text-slate-300 dark:bg-[#070b12] border-t border-slate-800 px-4 py-2 flex items-center justify-between gap-3 text-xs select-none shadow-lg shrink-0 z-20">
        <div className="flex items-center space-x-3 overflow-x-auto min-w-0 py-0.5">
          <span className="flex items-center space-x-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-800 text-teal-400 rounded-sm border border-slate-700 shadow-2xs">F2</kbd><span className="text-xs font-medium text-slate-300">New Invoice</span></span>
          <span className="flex items-center space-x-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-800 text-teal-400 rounded-sm border border-slate-700 shadow-2xs">Ctrl+←/→</kbd><span className="text-xs font-medium text-slate-300">Switch</span></span>
          <span className="flex items-center space-x-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-800 text-teal-400 rounded-sm border border-slate-700 shadow-2xs">F3</kbd><span className="text-xs font-medium text-slate-300">Search</span></span>
          <span className="flex items-center space-x-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-800 text-teal-400 rounded-sm border border-slate-700 shadow-2xs">F4</kbd><span className="text-xs font-medium text-slate-300">Customer</span></span>
          <span className="flex items-center space-x-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-800 text-teal-400 rounded-sm border border-slate-700 shadow-2xs">F6</kbd><span className="text-xs font-medium text-slate-300">Discount</span></span>
          <span className="flex items-center space-x-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-800 text-teal-400 rounded-sm border border-slate-700 shadow-2xs">F8</kbd><span className="text-xs font-medium text-slate-300">Payment</span></span>
          <span className="flex items-center space-x-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-800 text-emerald-400 rounded-sm border border-slate-700 shadow-2xs">F9</kbd><span className="text-xs font-medium text-slate-300">Save</span></span>
          <span className="flex items-center space-x-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-800 text-amber-400 rounded-sm border border-slate-700 shadow-2xs">F10</kbd><span className="text-xs font-medium text-slate-300">Print</span></span>
          <span className="flex items-center space-x-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 text-2xs font-mono font-bold bg-slate-800 text-rose-400 rounded-sm border border-slate-700 shadow-2xs">Esc</kbd><span className="text-xs font-medium text-slate-300">Close</span></span>
        </div>

        <button
          type="button"
          onClick={() => setIsShortcutsModalOpen(true)}
          className="shrink-0 whitespace-nowrap text-teal-400 hover:text-teal-300 font-medium text-xs flex items-center space-x-1 transition-colors px-2 py-0.5 rounded-sm hover:bg-slate-800 cursor-pointer"
        >
          <Keyboard className="w-4 h-4" />
          <span>All Shortcuts</span>
        </button>
      </div>

      {/* Close an invoice that still has items */}
      <Modal
        isOpen={pendingCloseId !== null}
        onClose={() => setPendingCloseId(null)}
        title="Close this invoice?"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {pendingCloseTab?.label} has {pendingCloseTab?.draft.cart.length} item(s) that are not saved. Closing it removes them.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPendingCloseId(null)} className="btn-secondary">Keep Invoice</button>
            <button type="button" onClick={confirmCloseInvoice} className="btn-danger" autoFocus>Close Invoice</button>
          </div>
        </div>
      </Modal>

      {/* Printable Thermal Receipt Modal */}
      <Modal
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        title="Sale Completed - Thermal Receipt"
        maxWidth="max-w-md"
      >
        <div ref={receiptContainerRef}>
          {createdInvoice && (
            <UnifiedInvoice
              invoice={createdInvoice}
              settings={settings}
              onClose={() => setIsReceiptModalOpen(false)}
            />
          )}
        </div>
      </Modal>

      {/* Keyboard Shortcuts Reference Modal */}
      <Modal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
        title="POS Keyboard Shortcuts Reference"
        maxWidth="max-w-xl"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Speed up your pharmacy checkout operations with these dedicated hotkeys. All shortcuts are active across the sales screen.
          </p>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-xs">
            <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-surface-inset-dark font-semibold text-slate-700 dark:text-slate-300">
              <span className="w-20">Shortcut</span>
              <span className="w-40">Action</span>
              <span className="flex-1 text-slate-500">Details</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-teal-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700">F2</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">New Invoice</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Opens a new invoice tab. The current invoice stays open in its own tab. Ctrl+T does the same.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-teal-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700 whitespace-nowrap">Ctrl+→</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Next Invoice</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Switches to the invoice tab on the right. Ctrl+Tab does the same.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-teal-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700 whitespace-nowrap">Ctrl+←</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Previous Invoice</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Switches to the invoice tab on the left. Ctrl+Shift+Tab does the same.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-teal-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700 whitespace-nowrap">Ctrl+1…9</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Go to Invoice</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Jumps straight to invoice tab 1 to 9.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-teal-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700 whitespace-nowrap">Ctrl+W</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Close Invoice</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Closes the current invoice tab. Asks first if it has items.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-teal-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700">F3</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Focus Product Search</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Focuses search box and selects all text for instant barcode re-scan.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-teal-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700">F4</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Focus Customer Field</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Directly jumps to customer name input for credit or counter tagging.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-teal-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700">F6</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Apply Bill Discount</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Focuses discount % input. Restricted to authorized cashiers/admins.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-teal-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700">F8</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Payment & Tender</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Jumps focus to cash received field to enter tendered cash.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-emerald-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700">F9</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Save Invoice</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Finalizes and saves invoice with anti-duplicate debounce protection.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-amber-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700">F10</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Print Receipt</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Saves & prints thermal receipt, or reprints receipt if already saved.</span>
            </div>

            <div className="flex items-center justify-between p-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <span className="w-20"><kbd className="bg-slate-800 text-rose-400 font-bold px-2 py-0.5 rounded-sm font-mono text-xs border border-slate-700">Esc</kbd></span>
              <span className="w-40 font-bold text-slate-800 dark:text-white">Cancel / Close</span>
              <span className="flex-1 text-slate-500 dark:text-slate-400 text-xs">Closes active dialog or clears search dropdown without clearing cart.</span>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setIsShortcutsModalOpen(false)}
              className="btn-secondary"
            >
              Close Guide
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
