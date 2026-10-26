import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Product, CartItem, SaleInvoice, PrescriptionInput, LoyaltyPlan } from '../types';

export type PaymentType = 'Cash' | 'Card' | 'Credit' | 'Online';

/** Everything that belongs to one open (unsaved) invoice */
export interface InvoiceDraft {
  cart: CartItem[];
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  billDiscountPct: number;
  billDiscountAmt: number;
  cashTendered: number;
  paymentType: PaymentType;
  notes: string;
  /** Prescription details for controlled medicines on this invoice */
  prescription: PrescriptionInput | null;
  /** The saved customer's points and plan while loyalty is on (M10), for the preview */
  customerLoyalty: { points: number; plan: LoyaltyPlan } | null;
  /** Points the customer uses on this invoice */
  redeemPoints: number;
}

export interface InvoiceTab {
  id: string;
  label: string;
  /** For the active tab this copy is stale: the live values are the top-level draft fields */
  draft: InvoiceDraft;
}

export const MAX_OPEN_INVOICES = 10;
export const POS_INVOICES_STORAGE_KEY = 'pharmacare_pos_invoices_v1';

const emptyDraft = (): InvoiceDraft => ({
  cart: [],
  customerId: null,
  customerName: 'Counter Customer',
  customerPhone: '',
  billDiscountPct: 0,
  billDiscountAmt: 0,
  cashTendered: 0,
  paymentType: 'Cash',
  notes: '',
  prescription: null,
  customerLoyalty: null,
  redeemPoints: 0
});

const pickDraft = (state: InvoiceDraft): InvoiceDraft => ({
  cart: state.cart,
  customerId: state.customerId,
  customerName: state.customerName,
  customerPhone: state.customerPhone,
  billDiscountPct: state.billDiscountPct,
  billDiscountAmt: state.billDiscountAmt,
  cashTendered: state.cashTendered,
  paymentType: state.paymentType,
  notes: state.notes,
  prescription: state.prescription,
  customerLoyalty: state.customerLoyalty,
  redeemPoints: state.redeemPoints
});

let tabCounter = 0;
const newTabId = () => `inv-${Date.now().toString(36)}-${(tabCounter++).toString(36)}`;

interface PosState extends InvoiceDraft {
  // Open invoice tabs; the active tab's live values are the draft fields above
  invoices: InvoiceTab[];
  activeId: string;
  nextNumber: number;
  /** The user whose drafts these are; another user signing in starts from an empty tab */
  ownerId: number | null;
  /** Last saved sale, for F10 reprint (not persisted) */
  lastCompletedSale: SaleInvoice | null;

  // Invoice tabs
  /** Opens an empty invoice tab and activates it; false when MAX_OPEN_INVOICES are already open */
  newInvoice: () => boolean;
  closeInvoice: (id: string) => void;
  switchInvoice: (id: string) => void;
  /** Moves to the next (+1) or previous (-1) tab, wrapping around */
  switchInvoiceBy: (delta: number) => void;
  /** Closes the active tab after its sale is saved and remembers the sale for reprint */
  completeActiveInvoice: (sale: SaleInvoice) => void;
  /** Drops every open invoice (logout) */
  resetInvoices: (ownerId?: number | null) => void;
  /** Keeps the drafts only if they belong to this user */
  claimInvoices: (userId: number | null) => void;
  /** All tabs with up-to-date drafts (the active one taken from the live fields) */
  getInvoiceTabs: () => InvoiceTab[];

  // Actions
  addItem: (product: Product, isLoose?: boolean, quantity?: number) => void;
  updateQuantity: (index: number, quantity: number) => void;
  updateDiscountPct: (index: number, discountPct: number) => void;
  updateUnitPrice: (index: number, unitPrice: number) => void;
  toggleLooseUnit: (index: number) => void;
  removeItem: (index: number) => void;
  clearCart: () => void;
  setCustomer: (id: number | null, name: string, phone?: string) => void;
  setBillDiscountPct: (pct: number, maxLimit?: number) => void;
  setBillDiscountAmt: (amt: number) => void;
  setCashTendered: (amt: number) => void;
  setPaymentType: (type: PaymentType) => void;
  setNotes: (notes: string) => void;
  setPrescription: (prescription: PrescriptionInput | null) => void;
  setCustomerLoyalty: (loyalty: { points: number; plan: LoyaltyPlan } | null) => void;
  setRedeemPoints: (points: number) => void;

  // Computations
  getTotals: () => {
    grossTotal: number;
    itemDiscounts: number;
    subtotal: number;
    billDiscountAmt: number;
    netTotal: number;
    changeDue: number;
    totalItemsCount: number;
  };
}

const freshTabs = (ownerId: number | null) => {
  const id = newTabId();
  return {
    ...emptyDraft(),
    invoices: [{ id, label: 'Invoice 1', draft: emptyDraft() }],
    activeId: id,
    nextNumber: 2,
    ownerId
  };
};

// Copies the live draft fields into the active tab
const syncedTabs = (state: PosState): InvoiceTab[] =>
  state.invoices.map(tab => (tab.id === state.activeId ? { ...tab, draft: pickDraft(state) } : tab));

// Tabs from storage are user data: keep only well-formed ones
const isValidTab = (tab: any): tab is InvoiceTab =>
  tab && typeof tab.id === 'string' && typeof tab.label === 'string' &&
  tab.draft && Array.isArray(tab.draft.cart) && typeof tab.draft.customerName === 'string';

export const usePosStore = create<PosState>()(persist((set, get) => ({
  ...freshTabs(null),
  lastCompletedSale: null,

  newInvoice: () => {
    const state = get();
    if (state.invoices.length >= MAX_OPEN_INVOICES) return false;
    const id = newTabId();
    set({
      invoices: [...syncedTabs(state), { id, label: `Invoice ${state.nextNumber}`, draft: emptyDraft() }],
      activeId: id,
      nextNumber: state.nextNumber + 1,
      ...emptyDraft()
    });
    return true;
  },

  closeInvoice: (id: string) => {
    const state = get();
    const index = state.invoices.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const remaining = syncedTabs(state).filter(tab => tab.id !== id);
    if (remaining.length === 0) {
      // There is always one invoice open
      const fresh = freshTabs(state.ownerId);
      set({ ...fresh, invoices: [{ ...fresh.invoices[0], label: `Invoice ${state.nextNumber}` }], nextNumber: state.nextNumber + 1 });
      return;
    }
    if (id !== state.activeId) {
      set({ invoices: remaining });
      return;
    }
    const next = remaining[Math.min(index, remaining.length - 1)];
    set({ invoices: remaining, activeId: next.id, ...next.draft });
  },

  switchInvoice: (id: string) => {
    const state = get();
    if (id === state.activeId) return;
    const target = state.invoices.find(tab => tab.id === id);
    if (!target) return;
    set({ invoices: syncedTabs(state), activeId: id, ...target.draft });
  },

  switchInvoiceBy: (delta: number) => {
    const { invoices, activeId, switchInvoice } = get();
    if (invoices.length < 2) return;
    const index = invoices.findIndex(tab => tab.id === activeId);
    const next = (index + delta + invoices.length * Math.abs(delta)) % invoices.length;
    switchInvoice(invoices[next].id);
  },

  completeActiveInvoice: (sale: SaleInvoice) => {
    get().closeInvoice(get().activeId);
    set({ lastCompletedSale: sale });
  },

  resetInvoices: (ownerId = null) => set({ ...freshTabs(ownerId), lastCompletedSale: null }),

  claimInvoices: (userId: number | null) => {
    if (get().ownerId !== userId) get().resetInvoices(userId);
  },

  getInvoiceTabs: () => syncedTabs(get()),

  addItem: (product: Product, isLoose = false, quantity = 1) => {
    set(state => {
      const canOpen = product.allow_open_sale !== false && product.allow_open_sale !== 0;
      const finalIsLoose = canOpen ? isLoose : false;
      const minQty = product.min_sale_qty || 1;
      const safeQuantity = Math.max(minQty, quantity);

      const price = finalIsLoose ? product.unit_retail_price : product.box_retail_price;
      const discountPct = product.default_discount_pct || 0;

      // Check if already in cart with same unit type
      const existingIdx = state.cart.findIndex(
        item => item.product.id === product.id && item.is_loose === finalIsLoose
      );

      if (existingIdx >= 0) {
        const updatedCart = [...state.cart];
        const item = updatedCart[existingIdx];
        const newQty = item.quantity + safeQuantity;
        const gross = newQty * item.unit_price;
        const discAmt = (gross * item.discount_pct) / 100;

        updatedCart[existingIdx] = {
          ...item,
          quantity: newQty,
          gross_amount: gross,
          discount_amount: discAmt,
          net_amount: gross - discAmt
        };
        return { cart: updatedCart };
      }

      const gross = safeQuantity * price;
      const discAmt = (gross * discountPct) / 100;
      const newItem: CartItem = {
        product,
        is_loose: finalIsLoose,
        quantity: safeQuantity,
        unit_price: price,
        discount_pct: discountPct,
        discount_amount: discAmt,
        gross_amount: gross,
        net_amount: gross - discAmt
      };

      return { cart: [newItem, ...state.cart] };
    });
  },

  updateQuantity: (index: number, quantity: number) => {
    set(state => {
      if (index < 0 || index >= state.cart.length) return state;
      const updatedCart = [...state.cart];
      const item = updatedCart[index];
      const minQty = item.product.min_sale_qty || 1;
      const safeQty = Math.max(minQty, Math.max(0.01, quantity));
      const gross = safeQty * item.unit_price;
      const discAmt = (gross * item.discount_pct) / 100;

      updatedCart[index] = {
        ...item,
        quantity: safeQty,
        gross_amount: gross,
        discount_amount: discAmt,
        net_amount: gross - discAmt
      };
      return { cart: updatedCart };
    });
  },

  updateDiscountPct: (index: number, discountPct: number) => {
    set(state => {
      if (index < 0 || index >= state.cart.length) return state;
      const updatedCart = [...state.cart];
      const item = updatedCart[index];
      const safePct = Math.min(100, Math.max(0, discountPct));
      const discAmt = (item.gross_amount * safePct) / 100;

      updatedCart[index] = {
        ...item,
        discount_pct: safePct,
        discount_amount: discAmt,
        net_amount: item.gross_amount - discAmt
      };
      return { cart: updatedCart };
    });
  },

  updateUnitPrice: (index: number, unitPrice: number) => {
    set(state => {
      if (index < 0 || index >= state.cart.length) return state;
      const updatedCart = [...state.cart];
      const item = updatedCart[index];
      const safePrice = Math.max(0, unitPrice);
      const gross = item.quantity * safePrice;
      const discAmt = (gross * item.discount_pct) / 100;

      updatedCart[index] = {
        ...item,
        unit_price: safePrice,
        gross_amount: gross,
        discount_amount: discAmt,
        net_amount: gross - discAmt
      };
      return { cart: updatedCart };
    });
  },

  toggleLooseUnit: (index: number) => {
    set(state => {
      if (index < 0 || index >= state.cart.length) return state;
      const updatedCart = [...state.cart];
      const item = updatedCart[index];

      const canOpen = item.product.allow_open_sale !== false && item.product.allow_open_sale !== 0;
      // If currently box and open-sale is prohibited, prevent toggling to loose
      if (!item.is_loose && !canOpen) {
        return state;
      }

      const nextIsLoose = !item.is_loose;
      const newPrice = nextIsLoose ? item.product.unit_retail_price : item.product.box_retail_price;
      const gross = item.quantity * newPrice;
      const discAmt = (gross * item.discount_pct) / 100;

      updatedCart[index] = {
        ...item,
        is_loose: nextIsLoose,
        unit_price: newPrice,
        gross_amount: gross,
        discount_amount: discAmt,
        net_amount: gross - discAmt
      };
      return { cart: updatedCart };
    });
  },

  removeItem: (index: number) => {
    set(state => ({
      cart: state.cart.filter((_, i) => i !== index)
    }));
  },

  clearCart: () => {
    set({
      cart: [],
      customerId: null,
      customerName: 'Counter Customer',
      customerPhone: '',
      billDiscountPct: 0,
      billDiscountAmt: 0,
      cashTendered: 0,
      notes: '',
      customerLoyalty: null,
      redeemPoints: 0
    });
  },

  setCustomer: (id: number | null, name: string, phone = '') => {
    set(state => (state.customerId === id
      ? { customerName: name, customerPhone: phone }
      : { customerId: id, customerName: name, customerPhone: phone, customerLoyalty: null, redeemPoints: 0 }));
  },

  setBillDiscountPct: (pct: number, maxLimit?: number) => {
    set(state => {
      const ceiling = typeof maxLimit === 'number' && !isNaN(maxLimit) ? Math.min(100, Math.max(0, maxLimit)) : 100;
      const safePct = Math.min(ceiling, Math.max(0, pct));
      const subtotal = state.cart.reduce((sum, item) => sum + item.net_amount, 0);
      const amt = (subtotal * safePct) / 100;
      return { billDiscountPct: safePct, billDiscountAmt: amt };
    });
  },

  setBillDiscountAmt: (amt: number) => {
    set(state => {
      const subtotal = state.cart.reduce((sum, item) => sum + item.net_amount, 0);
      const safeAmt = Math.min(subtotal, Math.max(0, amt));
      const pct = subtotal > 0 ? (safeAmt / subtotal) * 100 : 0;
      return { billDiscountAmt: safeAmt, billDiscountPct: Number(pct.toFixed(2)) };
    });
  },

  setCashTendered: (amt: number) => set({ cashTendered: Math.max(0, amt) }),
  setPaymentType: (type: PaymentType) => set({ paymentType: type }),
  setNotes: (notes: string) => set({ notes }),
  setPrescription: (prescription: PrescriptionInput | null) => set({ prescription }),
  setCustomerLoyalty: (loyalty) => set({ customerLoyalty: loyalty }),
  setRedeemPoints: (points: number) => set({ redeemPoints: Math.max(0, Math.floor(points) || 0) }),

  getTotals: () => {
    const { cart, billDiscountAmt, cashTendered } = get();
    let grossTotal = 0;
    let itemDiscounts = 0;
    let subtotal = 0;
    let totalItemsCount = 0;

    for (const item of cart) {
      grossTotal += item.gross_amount;
      itemDiscounts += item.discount_amount;
      subtotal += item.net_amount;
      totalItemsCount += item.quantity;
    }

    const netTotal = Math.max(0, subtotal - billDiscountAmt);
    const changeDue = Math.max(0, cashTendered - netTotal);

    return {
      grossTotal: Number(grossTotal.toFixed(2)),
      itemDiscounts: Number(itemDiscounts.toFixed(2)),
      subtotal: Number(subtotal.toFixed(2)),
      billDiscountAmt: Number(billDiscountAmt.toFixed(2)),
      netTotal: Number(netTotal.toFixed(2)),
      changeDue: Number(changeDue.toFixed(2)),
      totalItemsCount
    };
  }
}), {
  name: POS_INVOICES_STORAGE_KEY,
  version: 1,
  // Open invoices survive an app restart on this computer; a missing or unreadable store starts empty
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({
    invoices: syncedTabs(state),
    activeId: state.activeId,
    nextNumber: state.nextNumber,
    ownerId: state.ownerId
  }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<PosState> | undefined;
    // Drafts saved by an older version lack newer fields: fill them with the empty defaults
    const invoices = Array.isArray(saved?.invoices)
      ? saved.invoices.filter(isValidTab).slice(0, MAX_OPEN_INVOICES).map(tab => ({ ...tab, draft: { ...emptyDraft(), ...tab.draft } }))
      : [];
    if (invoices.length === 0) return current;
    const active = invoices.find(tab => tab.id === saved?.activeId) ?? invoices[0];
    return {
      ...current,
      invoices,
      activeId: active.id,
      nextNumber: Number.isInteger(saved?.nextNumber) ? saved!.nextNumber! : invoices.length + 1,
      ownerId: typeof saved?.ownerId === 'number' ? saved.ownerId : null,
      ...active.draft
    };
  }
}));
