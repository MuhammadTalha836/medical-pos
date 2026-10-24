import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Product, SaleInvoice } from '../types';

// The store persists open invoices to localStorage; give it an in-memory one (tests run in Node)
const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); }
};

let store: typeof import('./usePosStore');
beforeAll(async () => {
  store = await import('./usePosStore');
});

const product = (id: number) => ({
  id, name: `Med ${id}`, packing: 10, unit_type: 'Tab', box_retail_price: 100, unit_retail_price: 10,
  stock_boxes: 50, stock_loose: 0, min_sale_qty: 1, allow_open_sale: true, default_discount_pct: 0
}) as unknown as Product;

const pos = () => store.usePosStore.getState();

beforeEach(() => {
  memory.clear();
  pos().resetInvoices(1);
});

describe('POS invoice tabs', () => {
  it('starts with one empty invoice', () => {
    expect(pos().invoices).toHaveLength(1);
    expect(pos().cart).toEqual([]);
  });

  it('keeps each invoice\'s cart and customer separate', () => {
    pos().addItem(product(1));
    pos().setCustomer(null, 'Ali');
    const first = pos().activeId;

    expect(pos().newInvoice()).toBe(true);
    expect(pos().cart).toEqual([]);
    expect(pos().customerName).toBe('Counter Customer');
    pos().addItem(product(2), false, 3);

    pos().switchInvoice(first);
    expect(pos().cart.map(i => i.product.id)).toEqual([1]);
    expect(pos().customerName).toBe('Ali');

    const tabs = pos().getInvoiceTabs();
    expect(tabs[1].draft.cart[0].quantity).toBe(3);
    expect(tabs.map(t => t.label)).toEqual(['Invoice 1', 'Invoice 2']);
  });

  it('switches with wrap-around', () => {
    pos().newInvoice();
    pos().newInvoice();
    const ids = pos().invoices.map(t => t.id);
    expect(pos().activeId).toBe(ids[2]);
    pos().switchInvoiceBy(1);
    expect(pos().activeId).toBe(ids[0]);
    pos().switchInvoiceBy(-1);
    expect(pos().activeId).toBe(ids[2]);
  });

  it('allows at most MAX_OPEN_INVOICES tabs', () => {
    for (let i = 1; i < store.MAX_OPEN_INVOICES; i++) expect(pos().newInvoice()).toBe(true);
    expect(pos().newInvoice()).toBe(false);
    expect(pos().invoices).toHaveLength(store.MAX_OPEN_INVOICES);
  });

  it('closing the active tab activates its neighbour; closing the last one leaves an empty tab', () => {
    pos().addItem(product(1));
    const first = pos().activeId;
    pos().newInvoice();
    pos().closeInvoice(pos().activeId);
    expect(pos().activeId).toBe(first);
    expect(pos().cart).toHaveLength(1);

    pos().closeInvoice(first);
    expect(pos().invoices).toHaveLength(1);
    expect(pos().cart).toEqual([]);
    expect(pos().invoices[0].label).toBe('Invoice 3');
  });

  it('a completed sale closes only its own tab and is kept for reprint', () => {
    pos().addItem(product(1));
    const first = pos().activeId;
    pos().newInvoice();
    pos().addItem(product(2));
    pos().completeActiveInvoice({ invoice_no: 'INV-1' } as SaleInvoice);

    expect(pos().invoices.map(t => t.id)).toEqual([first]);
    expect(pos().cart.map(i => i.product.id)).toEqual([1]);
    expect(pos().lastCompletedSale?.invoice_no).toBe('INV-1');
  });

  it('another user starts from an empty invoice', () => {
    pos().addItem(product(1));
    pos().claimInvoices(1);
    expect(pos().cart).toHaveLength(1);
    pos().claimInvoices(2);
    expect(pos().cart).toEqual([]);
    expect(pos().ownerId).toBe(2);
  });

  it('restores saved invoices and ignores broken storage', async () => {
    pos().addItem(product(1));
    pos().newInvoice();
    pos().addItem(product(2));
    const saved = memory.get(store.POS_INVOICES_STORAGE_KEY)!;
    expect(JSON.parse(saved).state.invoices).toHaveLength(2);

    pos().resetInvoices(1);
    memory.set(store.POS_INVOICES_STORAGE_KEY, saved);
    await store.usePosStore.persist.rehydrate();
    expect(pos().invoices).toHaveLength(2);
    expect(pos().cart.map(i => i.product.id)).toEqual([2]);

    pos().resetInvoices(1);
    memory.set(store.POS_INVOICES_STORAGE_KEY, '{"state":{"invoices":[{"id":5}]},"version":1}');
    await store.usePosStore.persist.rehydrate();
    expect(pos().invoices).toHaveLength(1);
    expect(pos().cart).toEqual([]);

    memory.set(store.POS_INVOICES_STORAGE_KEY, 'not json');
    await store.usePosStore.persist.rehydrate();
    expect(pos().invoices).toHaveLength(1);
  });
});
