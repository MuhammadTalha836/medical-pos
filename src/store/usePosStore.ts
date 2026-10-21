import { create } from 'zustand';
import { Product, CartItem } from '../types';

interface PosState {
  cart: CartItem[];
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  billDiscountPct: number;
  billDiscountAmt: number;
  cashTendered: number;
  paymentType: 'Cash' | 'Card' | 'Credit' | 'Online';
  notes: string;

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
  setPaymentType: (type: 'Cash' | 'Card' | 'Credit' | 'Online') => void;
  setNotes: (notes: string) => void;

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

export const usePosStore = create<PosState>((set, get) => ({
  cart: [],
  customerId: null,
  customerName: 'Counter Customer',
  customerPhone: '',
  billDiscountPct: 0,
  billDiscountAmt: 0,
  cashTendered: 0,
  paymentType: 'Cash',
  notes: '',

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
      notes: ''
    });
  },

  setCustomer: (id: number | null, name: string, phone = '') => {
    set({ customerId: id, customerName: name, customerPhone: phone });
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
  setPaymentType: (type: 'Cash' | 'Card' | 'Credit' | 'Online') => set({ paymentType: type }),
  setNotes: (notes: string) => set({ notes }),

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
}));
