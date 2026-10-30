/**
 * PharmaCare Pro - Phase C Test Suite (docs/NEXT_PHASES.md: new features C1-C8)
 * Covers the server side of Phase C: quotations (nothing saved), bill round-off, the Admin's medicine unit list,
 * the shortage mark, the second-shift policy, voiding an invoice, split payment with the khata-first refund,
 * cash pay-in / pay-out, and the backup secondary folder (failover and its own retention).
 * The screens (quotation slip, POS split panel, void dialog, settings) are checked in the app.
 * Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { app } from '../api';
import { authHeaders, ensureTestAdmin, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { db } from '../database/db';
import { createBackup, pruneBackupsByRetentionLimit } from '../database/backup';
import { hashPassword } from '../security/passwords';
import { DEFAULT_CASHIER_PERMISSIONS } from '../../shared/permissions';
import { localDateString } from '../../shared/dates';

const colors = {
  green: (t: string) => `\x1b[32m${t}\x1b[0m`,
  red: (t: string) => `\x1b[31m${t}\x1b[0m`,
  cyan: (t: string) => `\x1b[36m${t}\x1b[0m`,
  bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
};

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

let server: http.Server;
let baseUrl = '';

async function request(p: string, headers: Record<string, string>, options?: RequestInit) {
  const res = await fetch(`${baseUrl}${p}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...headers, ...options?.headers },
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const post = (p: string, headers: Record<string, string>, body: unknown) =>
  request(p, headers, { method: 'POST', body: JSON.stringify(body) });

const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

async function runPhaseCTests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase C Test Suite (new features C1-C8)        ')));
  console.log(colors.bold(colors.cyan('================================================================\n')));

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://localhost:${addr.port}/api`;
      resolve();
    });
  });
  await useFullTestLicense();

  let passed = 0;
  let failed = 0;
  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`${colors.green('✔ PASS:')} ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`${colors.red('✖ FAIL:')} ${name}`);
      console.error(`   ${colors.red(err.message)}`);
      failed++;
    }
  }

  const suffix = Date.now().toString(36);
  const admin = await ensureTestAdmin();
  const adminHeaders = authHeaders(admin);
  const makeUser = async (name: string, role: string) => prisma.user.create({
    data: { username: `phasec_${name}_${suffix}`, password: await hashPassword('phase-c-pass'), fullName: `Phase C ${name}`, role, status: 'active' }
  });
  const cashier = await makeUser('cashier', 'cashier');
  const cashierHeaders = authHeaders(cashier);
  // A counter role without the discount permission
  await prisma.role.create({
    data: { name: `phasec_nodisc_${suffix}`, displayName: 'No discount', permissions: JSON.stringify({ ...DEFAULT_CASHIER_PERMISSIONS, can_discount: false }) }
  });
  const plain = await makeUser('plain', `phasec_nodisc_${suffix}`);
  const plainHeaders = authHeaders(plain);

  // Medicines with no expired stock (expired batches are never sold)
  const products = await prisma.product.findMany({
    where: { status: 'active', schedule: 'none', stockBoxes: { gt: 15 }, batches: { every: { OR: [{ expiryDate: '' }, { expiryDate: { gt: localDateString() } }] } } },
    orderBy: { id: 'asc' },
    take: 3
  });
  if (products.length < 3) throw new Error(`Need 3 sellable sample medicines, found ${products.length}`);
  const [medA, medB, medC] = products;
  const newCustomer = (label: string, creditLimit = 0) => prisma.customer.create({
    data: { name: `Phase C ${label} ${suffix}`, phone: `0301${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-7)}`, creditLimit, currentBalance: 0 }
  });
  const stockUnits = async (id: number) => {
    const p = await prisma.product.findUniqueOrThrow({ where: { id } });
    return p.stockBoxes * (p.packing || 1) + p.stockLoose;
  };
  const batchUnits = async (id: number) => {
    const p = await prisma.product.findUniqueOrThrow({ where: { id } });
    const batches = await prisma.productBatch.findMany({ where: { productId: id } });
    return batches.reduce((t, b) => t + b.quantityBoxes * (p.packing || 1) + b.quantityLoose, 0);
  };
  const summary = async (headers: Record<string, string>) => (await request('/shifts/active', headers)).body.summary;

  try {
    assert((await post('/shifts/start', adminHeaders, { opening_cash: 1000 })).status === 200, 'Admin shift');
    assert((await post('/shifts/start', cashierHeaders, { opening_cash: 0 })).status === 200, 'Cashier shift');

    // ------------------------------------------------------------- C8
    await test('C8 Quotation: priced like a sale, nothing saved, no shift needed', async () => {
      const customer = await newCustomer('Quote');
      const items = [{ product_id: medA.id, quantity: 2 }, { product_id: medB.id, quantity: 1 }];
      const stockBefore = await stockUnits(medA.id);
      const salesBefore = await prisma.sale.count();
      const shiftBefore = await summary(adminHeaders);

      const quote = await post('/sales/quote', adminHeaders, { items, customer_id: customer.id, payment_type: 'Credit' });
      assert(quote.status === 200, `Quote ${quote.status} ${JSON.stringify(quote.body)}`);
      const q = quote.body.quote;
      assert(/^QT-\d{8}-\d{6}$/.test(q.invoice_no), `Quote number ${q.invoice_no}`);
      assert(q.items.length === 2 && q.customer_name === customer.name && q.valid_days === 1, `Quote body ${JSON.stringify(q)}`);
      assert(await stockUnits(medA.id) === stockBefore, 'Stock unchanged');
      assert(await prisma.sale.count() === salesBefore, 'No sale saved');
      assert((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).currentBalance === 0, 'Khata unchanged');
      const shiftAfter = await summary(adminHeaders);
      assert(shiftAfter.invoices_count === shiftBefore.invoices_count && shiftAfter.expected_cash === shiftBefore.expected_cash, 'Shift unchanged');

      // The real sale costs the same
      const sale = await post('/sales', adminHeaders, { items, payment_type: 'Cash' });
      assert(sale.status === 200 && near(sale.body.sale.net_total, q.net_total), `Sale ${sale.body.sale?.net_total} vs quote ${q.net_total}`);

      // A user with no shift may quote; a changed rate still needs the discount permission
      const noShift = await post('/sales/quote', plainHeaders, { items: [{ product_id: medA.id, quantity: 1 }] });
      assert(noShift.status === 200, `No-shift quote ${noShift.status}`);
      const cheaper = await post('/sales/quote', plainHeaders, { items: [{ product_id: medA.id, quantity: 1, unit_price: medA.boxRetailPrice - 1 }] });
      assert(cheaper.status === 400 && /rate/i.test(cheaper.body.error), `Rate change refused: ${cheaper.status} ${cheaper.body.error}`);
      const huge = await post('/sales/quote', adminHeaders, { items: [{ product_id: medC.id, quantity: medC.stockBoxes + 50 }] });
      assert(huge.status === 200 && huge.body.quote.items[0].low_stock === true, 'More than in stock is quoted and marked low');
      assert((await post('/sales/quote', {}, { items })).status === 401, 'Login needed');
    });

    // ------------------------------------------------------------- C1
    await test('C1 Round-off: stored on the bill, and the credit limit uses the rounded total', async () => {
      assert((await post('/settings', adminHeaders, { round_off_to: '7' })).status === 400, 'Only 0, 1, 5, 10');
      assert((await post('/settings', adminHeaders, { round_off_to: '10' })).status === 200, 'Round to 10');
      let qty = 0, quote: any = null;
      for (let n = 1; n <= 20 && !quote; n++) {
        const q = (await post('/sales/quote', adminHeaders, { items: [{ product_id: medB.id, quantity: n }] })).body.quote;
        if (q.round_off > 0) { qty = n; quote = q; }
      }
      assert(!!quote, 'Found a bill that rounds up');
      assert(quote.net_total % 10 === 0, `Quote rounded ${quote.net_total}`);
      const sale = await post('/sales', adminHeaders, { items: [{ product_id: medB.id, quantity: qty }], payment_type: 'Cash' });
      assert(sale.status === 200 && near(sale.body.sale.round_off, quote.round_off) && sale.body.sale.net_total === quote.net_total, `Sale ${JSON.stringify(sale.body.sale)}`);

      // Limit between the unrounded and the rounded total: refused
      const tight = await newCustomer('Round', quote.net_total - quote.round_off / 2);
      const credit = await post('/sales', adminHeaders, { items: [{ product_id: medB.id, quantity: qty }], payment_type: 'Credit', customer_id: tight.id });
      assert(credit.status === 400 && /Credit limit/.test(credit.body.error), `Credit limit uses the rounded total: ${credit.status} ${credit.body.error}`);
      assert((await post('/settings', adminHeaders, { round_off_to: '0' })).status === 200, 'Round-off off again');
    });

    // ------------------------------------------------------------- C2
    await test('C2 Unit types: the Admin list is checked, medicines keep any unit', async () => {
      assert((await post('/settings', adminHeaders, { medicine_unit_types: JSON.stringify(['ml', 'ML']) })).status === 400, 'Repeats refused');
      assert((await post('/settings', adminHeaders, { medicine_unit_types: '[]' })).status === 400, 'Empty list refused');
      assert((await post('/settings', adminHeaders, { medicine_unit_types: JSON.stringify([' ml ', 'Litre', 'Tablets']) })).status === 200, 'List saved');
      const settings = await request('/settings', adminHeaders);
      assert(JSON.parse(settings.body.medicine_unit_types).join('|') === 'ml|Litre|Tablets', `Saved trimmed: ${settings.body.medicine_unit_types}`);
      const vial = await post('/products', adminHeaders, { name: `Phase C Vial ${suffix}`, p_code: `PC-V-${suffix}`, unit_type: 'Vial', packing: 1, box_retail_price: 50, allow_open_sale: false });
      assert(vial.status === 200, `Unlisted unit still saved: ${vial.status} ${JSON.stringify(vial.body)}`);
      assert((await prisma.product.findUniqueOrThrow({ where: { id: vial.body.id } })).unitType === 'Vial', 'Unit kept');
    });

    // ------------------------------------------------------------- C3
    await test('C3 Shortage: always on the reorder list, cleared when stock is purchased', async () => {
      const created = await post('/products', adminHeaders, {
        name: `Phase C Short ${suffix}`, p_code: `PC-S-${suffix}`, company_id: medA.companyId, packing: 10, box_retail_price: 100,
        box_trade_price: 80, stock_boxes: 50, min_stock_alert: 0, allow_open_sale: false, shortage_flag: true, shortage_note: 'Company out of stock'
      });
      assert(created.status === 200, `Product ${created.status} ${JSON.stringify(created.body)}`);
      const search = await request(`/products/search?q=${encodeURIComponent(`Phase C Short ${suffix}`)}`, cashierHeaders);
      const found = (Array.isArray(search.body) ? search.body : search.body.products ?? []).find((p: any) => p.id === created.body.id);
      assert(found && Number(found.shortage_flag) === 1 && found.shortage_note === 'Company out of stock', `POS search carries the mark: ${JSON.stringify(found)}`);
      const list = await request('/reorder', adminHeaders);
      const row = list.body.items.find((i: any) => i.product_id === created.body.id);
      assert(row && row.reason === 'shortage' && row.shortage === true && row.shortage_note === 'Company out of stock', `Reorder row ${JSON.stringify(row)}`);

      const purchase = await post('/purchases', adminHeaders, {
        company_id: medA.companyId, items: [{ product_id: created.body.id, quantity_boxes: 5, box_cost_price: 80, box_retail_price: 100, batch_no: 'PC1', expiry_date: '2029-01-31' }]
      });
      assert(purchase.status === 200, `Purchase ${purchase.status} ${JSON.stringify(purchase.body)}`);
      const after = await prisma.product.findUniqueOrThrow({ where: { id: created.body.id } });
      assert(after.shortageFlag === 0 && after.shortageNote === '', 'Mark cleared');
      assert(!(await request('/reorder', adminHeaders)).body.items.some((i: any) => i.product_id === created.body.id), 'Off the reorder list');
    });

    // ------------------------------------------------------------- C6
    await test('C6 Second shift: allowed by default, refused when the store turns it off', async () => {
      const worker = await makeUser('shifter', 'cashier');
      const headers = authHeaders(worker);
      const first = await post('/shifts/start', headers, { opening_cash: 0 });
      assert(first.status === 200, 'First shift');
      assert((await post(`/shifts/${first.body.shift.id}/close`, headers, { actual_cash: 0 })).status === 200, 'Closed');
      const second = await post('/shifts/start', headers, { opening_cash: 0 });
      assert(second.status === 200, 'Second shift allowed by default');
      assert((await post(`/shifts/${second.body.shift.id}/close`, headers, { actual_cash: 0 })).status === 200, 'Closed again');

      assert((await post('/settings', cashierHeaders, { allow_second_shift_same_day: 'false' })).status === 403, 'Cashier cannot change it');
      assert((await post('/settings', adminHeaders, { allow_second_shift_same_day: 'maybe' })).status === 400, 'true/false only');
      assert((await post('/settings', adminHeaders, { allow_second_shift_same_day: 'false' })).status === 200, 'Turned off');
      const third = await post('/shifts/start', headers, { opening_cash: 0 });
      assert(third.status === 409 && /already had a shift today/.test(third.body.error), `Refused: ${third.status} ${third.body.error}`);
      const fresh = await makeUser('fresh', 'cashier');
      const freshStart = await post('/shifts/start', authHeaders(fresh), { opening_cash: 0 });
      assert(freshStart.status === 200, 'A first shift is still fine');
      await post(`/shifts/${freshStart.body.shift.id}/close`, authHeaders(fresh), { actual_cash: 0 });
      assert((await post('/settings', adminHeaders, { allow_second_shift_same_day: 'true' })).status === 200, 'Back on');
    });

    // ------------------------------------------------------------- C7
    await test('C7 Void: stock, batches, khata and loyalty come back; the shift stops counting it', async () => {
      // Loyalty on, with a default plan that rewards every bill
      await prisma.systemSetting.upsert({ where: { key: 'loyalty_feature_allowed' }, update: { value: 'true' }, create: { key: 'loyalty_feature_allowed', value: 'true' } });
      assert((await post('/settings', adminHeaders, { loyalty_enabled: 'true' })).status === 200, 'Loyalty on');
      const plan = await post('/loyalty/plans', adminHeaders, { name: `PhaseC ${suffix}`, points_per_100: 5, point_value: 1, min_bill_to_earn: 0, is_default: true });
      assert(plan.status === 200, `Plan ${plan.status} ${JSON.stringify(plan.body)}`);

      const customer = await newCustomer('Void');
      const stockBefore = await stockUnits(medA.id);
      const shiftBefore = await summary(adminHeaders);
      const sale = await post('/sales', adminHeaders, { items: [{ product_id: medA.id, quantity: 3 }], payment_type: 'Credit', customer_id: customer.id });
      assert(sale.status === 200, `Sale ${sale.status} ${JSON.stringify(sale.body)}`);
      const afterSale = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      assert(afterSale.currentBalance > 0, 'Khata went up');

      assert((await post(`/sales/${sale.body.sale.id}/void`, cashierHeaders, { reason: 'Wrong bill' })).status === 403, 'Cashier cannot void');
      assert((await post(`/sales/${sale.body.sale.id}/void`, adminHeaders, { reason: 'x' })).status === 400, 'Reason needed');
      const voided = await post(`/sales/${sale.body.sale.id}/void`, adminHeaders, { reason: 'Rung up twice' });
      assert(voided.status === 200 && voided.body.sale.status === 'cancelled' && voided.body.sale.void_reason === 'Rung up twice', `Void ${JSON.stringify(voided.body)}`);
      assert(await stockUnits(medA.id) === stockBefore, 'Stock back');
      assert(await batchUnits(medA.id) === await stockUnits(medA.id), 'Batches = stock');
      const afterVoid = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      assert(afterVoid.currentBalance === 0, `Khata back to 0 (${afterVoid.currentBalance})`);
      assert(afterVoid.loyaltyPoints === 0, `Points taken back (${afterVoid.loyaltyPoints})`);
      const shiftAfter = await summary(adminHeaders);
      assert(shiftAfter.invoices_count === shiftBefore.invoices_count && near(shiftAfter.total_sales_credit, shiftBefore.total_sales_credit), 'Shift does not count it');
      assert((await post(`/sales/${sale.body.sale.id}/void`, adminHeaders, { reason: 'Again please' })).status === 409, 'Already void');
      assert(!(await request(`/customers/${customer.id}/ledger`, adminHeaders)).body.sales.some((s: any) => s.status !== 'cancelled'), 'Ledger shows only the voided bill');
      assert((await prisma.auditLog.count({ where: { action: 'SALE_VOIDED', details: { contains: sale.body.sale.invoice_no } } })) === 1, 'Audited');

      // A bill with a return, and a bill whose shift is closed, cannot be voided
      const returned = await post('/sales', adminHeaders, { items: [{ product_id: medA.id, quantity: 2 }], payment_type: 'Cash' });
      assert((await post('/sales/return', adminHeaders, { sale_id: returned.body.sale.id, return_items: [{ product_id: medA.id, quantity: 1 }] })).status === 200, 'Return');
      assert((await post(`/sales/${returned.body.sale.id}/void`, adminHeaders, { reason: 'Too late now' })).status === 409, 'Returned bill refused');
      const closer = await makeUser('closer', 'cashier');
      const closerHeaders = authHeaders(closer);
      const closerShift = await post('/shifts/start', closerHeaders, { opening_cash: 0 });
      const closerSale = await post('/sales', closerHeaders, { items: [{ product_id: medB.id, quantity: 1 }], payment_type: 'Cash' });
      assert(closerSale.status === 200, 'Closer sale');
      assert((await post(`/shifts/${closerShift.body.shift.id}/close`, closerHeaders, { actual_cash: closerSale.body.sale.net_total })).status === 200, 'Closer shift closed');
      const late = await post(`/sales/${closerSale.body.sale.id}/void`, adminHeaders, { reason: 'Shift is closed' });
      assert(late.status === 409 && /shift/.test(late.body.error), `Closed shift refused: ${late.status} ${late.body.error}`);
    });

    // ------------------------------------------------------------- C4 split
    await test('C4 Split payment: parts stored, shift buckets, khata, and a khata-first refund', async () => {
      const customer = await newCustomer('Split');
      const quote = (await post('/sales/quote', adminHeaders, { items: [{ product_id: medC.id, quantity: 4 }] })).body.quote;
      const net = quote.net_total;
      const credit = Math.round(net * 0.3 * 100) / 100;
      const card = Math.round(net * 0.2 * 100) / 100;
      const cash = Math.round((net - credit - card) * 100) / 100;

      const bad = await post('/sales', adminHeaders, { items: [{ product_id: medC.id, quantity: 4 }], payment_type: 'Split', split: { cash, card, credit: credit - 1 }, customer_id: customer.id });
      assert(bad.status === 400 && /add up/.test(bad.body.error), `Parts must add up: ${bad.body.error}`);
      const noCustomer = await post('/sales', adminHeaders, { items: [{ product_id: medC.id, quantity: 4 }], payment_type: 'Split', split: { cash, card, credit } });
      assert(noCustomer.status === 400 && /khata customer/.test(noCustomer.body.error), 'Credit part needs a customer');

      const before = await summary(adminHeaders);
      const sale = await post('/sales', adminHeaders, {
        items: [{ product_id: medC.id, quantity: 4 }], payment_type: 'Split', split: { cash, card, credit }, customer_id: customer.id, cash_tendered: Math.ceil(cash) + 100
      });
      assert(sale.status === 200, `Split sale ${sale.status} ${JSON.stringify(sale.body)}`);
      const s = sale.body.sale;
      assert(s.payment_type === 'Split' && near(s.paid_cash, cash) && near(s.paid_card, card) && near(s.paid_credit, credit), `Parts ${JSON.stringify(s)}`);
      assert(near(s.change_due, Math.ceil(cash) + 100 - cash), `Change on the cash part ${s.change_due}`);
      const after = await summary(adminHeaders);
      assert(near(after.total_sales_cash - before.total_sales_cash, cash), 'Cash bucket');
      assert(near(after.total_sales_card - before.total_sales_card, card), 'Card bucket');
      assert(near(after.total_sales_credit - before.total_sales_credit, credit), 'Credit bucket');
      assert(near(after.expected_cash - before.expected_cash, cash), 'Drawer gets only the cash part');
      assert(near((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).currentBalance, credit), 'Khata gets the credit part');

      // Return 3 of 4: the refund first clears the khata part, the rest is cash out of the drawer
      const ret = await post('/sales/return', adminHeaders, { sale_id: s.id, return_items: [{ product_id: medC.id, quantity: 3 }] });
      assert(ret.status === 200, `Return ${ret.status} ${JSON.stringify(ret.body)}`);
      assert(near(ret.body.refundCredit, Math.min(credit, ret.body.totalRefund)) && near(ret.body.refundCash, ret.body.totalRefund - ret.body.refundCredit), `Refund split ${JSON.stringify(ret.body)}`);
      assert(near((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).currentBalance, credit - ret.body.refundCredit), 'Khata lowered first');
      const afterReturn = await summary(adminHeaders);
      assert(near(after.expected_cash - afterReturn.expected_cash, ret.body.refundCash), 'Drawer pays the rest');
      const ledger = (await request(`/customers/${customer.id}/ledger`, adminHeaders)).body;
      assert(ledger.sales[0].paid_credit > 0 && ledger.returns.length === 1 && near(ledger.returns[0].refund_amount, ret.body.refundCredit), 'Ledger shows the credit parts');
    });

    // ------------------------------------------------------------- C4 cash in/out
    await test('C4 Cash pay-in / pay-out: moves the expected cash, Admin only, open shift only', async () => {
      const active = (await request('/shifts/active', adminHeaders)).body;
      const shiftId = active.activeShift.id;
      const before = active.summary.expected_cash;
      const cashIn = await post(`/shifts/${shiftId}/cash-movements`, adminHeaders, { direction: 'in', amount: 500, reason: 'Change from the bank' });
      assert(cashIn.status === 200, `In ${cashIn.status} ${JSON.stringify(cashIn.body)}`);
      const cashOut = await post(`/shifts/${shiftId}/cash-movements`, adminHeaders, { direction: 'out', amount: 200, reason: 'Sent to the owner' });
      assert(cashOut.status === 200, 'Out');
      const after = await summary(adminHeaders);
      assert(near(after.expected_cash, before + 300) && after.total_cash_in === 500 && after.total_cash_out === 200, `Expected ${before} -> ${after.expected_cash}`);
      assert((await post(`/shifts/${shiftId}/cash-movements`, adminHeaders, { direction: 'out', amount: after.expected_cash + 1, reason: 'Too much' })).status === 400, 'Cannot take out more than the drawer');
      assert((await post(`/shifts/${shiftId}/cash-movements`, adminHeaders, { direction: 'sideways', amount: 5, reason: 'Nope' })).status === 400, 'Direction checked');
      const cashierShift = (await request('/shifts/active', cashierHeaders)).body.activeShift.id;
      assert((await post(`/shifts/${cashierShift}/cash-movements`, cashierHeaders, { direction: 'in', amount: 50, reason: 'Float' })).status === 403, 'Cashier refused by default');
      const list = await request(`/shifts/${shiftId}/cash-movements`, adminHeaders);
      assert(list.status === 200 && list.body.length === 2 && list.body[0].reason === 'Sent to the owner', 'Listed newest first');
      const details = await request(`/shifts/${shiftId}`, adminHeaders);
      assert(details.body.cash_movements.length === 2 && details.body.shift.total_cash_in === 500, 'Shift details include them');

      // Closing saves the figures; a closed shift takes no more movements
      const close = await post(`/shifts/${shiftId}/close`, adminHeaders, { actual_cash: after.expected_cash });
      assert(close.status === 200, `Close ${close.status} ${JSON.stringify(close.body)}`);
      const saved = await prisma.cashierShift.findUniqueOrThrow({ where: { id: shiftId } });
      assert(saved.totalCashIn === 500 && saved.totalCashOut === 200 && near(saved.cashDifference ?? 1, 0), 'Saved on close');
      assert((await post(`/shifts/${shiftId}/cash-movements`, adminHeaders, { direction: 'in', amount: 5, reason: 'After close' })).status === 400, 'Closed shift refused');
    });

    // ------------------------------------------------------------- C5
    await test('C5 Backup: a failing backup folder falls back to the secondary folder, which keeps its own copies', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phasec-backup-'));
      const blocker = path.join(root, 'not-a-folder');
      fs.writeFileSync(blocker, 'x');
      const primary = path.join(root, 'primary');
      const secondary = path.join(root, 'secondary');
      const dbFiles = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.db')) : []);

      const failover = await createBackup('manual', blocker, secondary);
      assert(failover.success && path.dirname(failover.filepath) === secondary, `Saved in the secondary folder: ${failover.filepath}`);
      const row = db.prepare('SELECT status, error_message FROM backup_history WHERE id = ?').get(failover.historyId) as any;
      assert(row.status === 'success' && /secondary folder/.test(row.error_message), `Recorded with a warning: ${JSON.stringify(row)}`);
      const status = await request('/backups/status', adminHeaders);
      assert(/secondary folder/.test(status.body.last_warning ?? ''), `Dashboard warning: ${status.body.last_warning}`);

      db.prepare("UPDATE system_settings SET value = '2' WHERE key = 'backup_retention_limit'").run();
      for (let i = 0; i < 3; i++) await createBackup('manual', primary, secondary);
      assert(dbFiles(primary).length === 2, `Primary keeps 2 (${dbFiles(primary).length})`);
      assert(dbFiles(secondary).length === 2, `Secondary keeps its own 2 (${dbFiles(secondary).length})`);
      pruneBackupsByRetentionLimit(1, primary);
      assert(dbFiles(primary).length === 1 && dbFiles(secondary).length === 2, 'Pruning the primary leaves the secondary copies');
      fs.rmSync(root, { recursive: true, force: true });
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nPhase C: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runPhaseCTests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
