/**
 * PharmaCare Pro - Phase 8 Test Suite
 * Covers the server as the money and security control: sales priced on the server (tampered totals, rates and
 * discounts), oversell and cash shortfall, the session's own shift, returns per unit type with the bill discount,
 * partial returns, shift cash with credit refunds, khata payments, role escalation, permission checks on
 * inventory/reports, shift close ownership and the staff login lockout.
 * Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import http from 'http';
import { app } from '../api';
import { authHeaders, ensureTestDeveloper, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { hashPassword } from '../security/passwords';

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

async function runPhase8Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase 8 Test Suite                           ')));
  console.log(colors.bold(colors.cyan('  (Server-side pricing, returns, shift cash, roles, lockout)    ')));
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
  const openShift = (userId: number, userName: string, openingCash = 1000) =>
    prisma.cashierShift.create({
      data: { shiftNo: `SH-P8-${userId}-${suffix}`, userId, userName, startTime: new Date(), openingCash, status: 'open' }
    });
  const makeRole = (name: string, permissions: Record<string, boolean>) =>
    prisma.role.create({ data: { name: `p8_${name}_${suffix}`, displayName: `P8 ${name}`, permissions: JSON.stringify(permissions) } });
  const makeUser = async (name: string, role: string, password = 'x') =>
    prisma.user.create({
      data: { username: `p8_${name}_${suffix}`, password: await hashPassword(password), fullName: `P8 ${name}`, role, status: 'active' }
    });
  const makeProduct = (code: string, stockBoxes: number, extra: Record<string, unknown> = {}) =>
    prisma.product.create({
      data: {
        cCode: 'P8', pCode: `P8-${code}-${suffix}`, name: `Phase8 ${code} ${suffix}`, packing: 10,
        boxRetailPrice: 120, unitRetailPrice: 12, boxTradePrice: 100, unitTradePrice: 10, stockBoxes, ...extra
      }
    });
  const unitsOf = async (id: number) => {
    const p = await prisma.product.findUniqueOrThrow({ where: { id } });
    return p.stockBoxes * p.packing + p.stockLoose;
  };

  // Fixtures: the developer (every permission) with an open shift; a counter role without discount or return rights
  const dev = await ensureTestDeveloper();
  const devHeaders = authHeaders(dev);
  await prisma.cashierShift.updateMany({ where: { status: 'open' }, data: { status: 'closed' } });
  const devShift = await openShift(dev.id, dev.fullName);

  const counterRole = await makeRole('counter', { pos: true, sales: true, khata: true });
  const counter = await makeUser('counter', counterRole.name);
  const counterHeaders = authHeaders(counter);
  await openShift(counter.id, counter.fullName);
  const noShiftUser = await makeUser('noshift', counterRole.name);

  const product = await makeProduct('A', 50);

  try {
    await test('Sales: the server prices the sale and ignores the client totals', async () => {
      const res = await post('/sales', devHeaders, {
        items: [{ product_id: product.id, is_loose: 0, quantity: 2, unit_price: 120, net_amount: 1, gross_amount: 1 }],
        total_gross: 1, net_total: 1, payment_type: 'Cash'
      });
      assert(res.status === 200, `Expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
      const sale = await prisma.sale.findUniqueOrThrow({ where: { id: res.body.saleId } });
      assert(sale.netTotal === 240 && sale.totalGross === 240, `Stored 240, got net ${sale.netTotal} gross ${sale.totalGross}`);
      assert(res.body.sale?.net_total === 240 && res.body.sale.items.length === 1, 'The response carries the stored sale for the receipt');
    });

    await test('Sales: without discount permission the rate and discounts cannot change', async () => {
      const lowRate = await post('/sales', counterHeaders, { items: [{ product_id: product.id, quantity: 1, unit_price: 1 }], payment_type: 'Cash' });
      assert(lowRate.status === 400 && /rate/.test(lowRate.body.error), `Changed rate: expected 400, got ${lowRate.status} ${lowRate.body.error}`);
      const lineDisc = await post('/sales', counterHeaders, { items: [{ product_id: product.id, quantity: 1, discount_pct: 50 }], payment_type: 'Cash' });
      assert(lineDisc.status === 400, `Line discount: expected 400, got ${lineDisc.status}`);
      const billDisc = await post('/sales', counterHeaders, { items: [{ product_id: product.id, quantity: 1 }], bill_discount_pct: 5, payment_type: 'Cash' });
      assert(billDisc.status === 400, `Bill discount: expected 400, got ${billDisc.status}`);
      const plain = await post('/sales', counterHeaders, { items: [{ product_id: product.id, quantity: 1, unit_price: 120 }], payment_type: 'Cash' });
      assert(plain.status === 200, `List price sale: expected 200, got ${plain.status} ${JSON.stringify(plain.body)}`);
    });

    await test('Sales: the bill discount cannot pass the store maximum', async () => {
      const res = await post('/sales', devHeaders, { items: [{ product_id: product.id, quantity: 1 }], bill_discount_pct: 50, payment_type: 'Cash' });
      assert(res.status === 400 && /more than/.test(res.body.error), `Expected 400, got ${res.status} ${res.body.error}`);
    });

    await test('Sales: overselling is refused and stock stays as it was', async () => {
      const scarce = await makeProduct('B', 2);
      const res = await post('/sales', devHeaders, { items: [{ product_id: scarce.id, quantity: 3 }], payment_type: 'Cash' });
      assert(res.status === 400 && /Not enough stock/.test(res.body.error), `Expected 400, got ${res.status} ${res.body.error}`);
      assert((await unitsOf(scarce.id)) === 20, 'Stock unchanged');
      const twoLines = await post('/sales', devHeaders, {
        items: [{ product_id: scarce.id, quantity: 2 }, { product_id: scarce.id, is_loose: 1, quantity: 1 }], payment_type: 'Cash'
      });
      assert(twoLines.status === 400, `Two lines over the stock: expected 400, got ${twoLines.status}`);
    });

    await test('Sales: cash below the total is refused; blank cash means exact', async () => {
      const short = await post('/sales', devHeaders, { items: [{ product_id: product.id, quantity: 1 }], payment_type: 'Cash', cash_tendered: 50 });
      assert(short.status === 400 && /less than/.test(short.body.error), `Expected 400, got ${short.status}`);
      const exact = await post('/sales', devHeaders, { items: [{ product_id: product.id, quantity: 1 }], payment_type: 'Cash' });
      assert(exact.status === 200 && exact.body.sale.cash_tendered === 120 && exact.body.sale.change_due === 0, 'Exact cash recorded');
      const change = await post('/sales', devHeaders, { items: [{ product_id: product.id, quantity: 1 }], payment_type: 'Cash', cash_tendered: 200 });
      assert(change.body.sale?.change_due === 80, `Change 80, got ${change.body.sale?.change_due}`);
    });

    await test('Sales: fractional quantities are refused', async () => {
      const res = await post('/sales', devHeaders, { items: [{ product_id: product.id, quantity: 1.5 }], payment_type: 'Cash' });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test('Sales: a shift id from the client is ignored (the session user needs their own shift)', async () => {
      const res = await post('/sales', authHeaders(noShiftUser), {
        shift_id: devShift.id, items: [{ product_id: product.id, quantity: 1 }], payment_type: 'Cash'
      });
      assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    let mixedSaleId = 0;
    await test('Returns: loose units go back as loose, refund includes the bill discount, partial status', async () => {
      const sale = await post('/sales', devHeaders, {
        items: [{ product_id: product.id, quantity: 2 }, { product_id: product.id, is_loose: 1, quantity: 10 }],
        bill_discount_pct: 10, payment_type: 'Cash'
      });
      assert(sale.status === 200, `Sale: ${sale.status} ${JSON.stringify(sale.body)}`);
      mixedSaleId = sale.body.saleId;
      const before = await unitsOf(product.id);
      const ret = await post('/sales/return', devHeaders, { sale_id: mixedSaleId, return_items: [{ product_id: product.id, is_loose: 1, quantity: 5 }] });
      assert(ret.status === 200, `Return: ${ret.status} ${JSON.stringify(ret.body)}`);
      assert((await unitsOf(product.id)) - before === 5, 'Exactly 5 loose units back in stock');
      assert(ret.body.totalRefund === 54, `Refund 5 x 12 less 10% = 54, got ${ret.body.totalRefund}`);
      const stored = await prisma.sale.findUniqueOrThrow({ where: { id: mixedSaleId } });
      assert(stored.status === 'partially_returned', `Status partially_returned, got ${stored.status}`);
    });

    await test('Returns: no more than was sold, and a full return closes the invoice', async () => {
      const tooMany = await post('/sales/return', devHeaders, { sale_id: mixedSaleId, return_items: [{ product_id: product.id, is_loose: 1, quantity: 6 }] });
      assert(tooMany.status === 400 && /Only 5/.test(tooMany.body.error), `Expected 400 "Only 5", got ${tooMany.status} ${tooMany.body.error}`);
      const details = await request(`/sales/${mixedSaleId}`, devHeaders);
      const loose = details.body.items.find((i: any) => i.is_loose);
      assert(loose?.returned_qty === 5, `Invoice shows 5 returned, got ${loose?.returned_qty}`);
      const rest = await post('/sales/return', devHeaders, {
        sale_id: mixedSaleId,
        return_items: [{ product_id: product.id, is_loose: 0, quantity: 2 }, { product_id: product.id, is_loose: 1, quantity: 5 }]
      });
      assert(rest.status === 200, `Rest: ${rest.status} ${JSON.stringify(rest.body)}`);
      const sale = await prisma.sale.findUniqueOrThrow({ where: { id: mixedSaleId } });
      const refunds = await prisma.saleReturn.aggregate({ where: { saleId: mixedSaleId }, _sum: { refundAmount: true } });
      assert(sale.status === 'returned', `Status returned, got ${sale.status}`);
      assert(Math.abs((refunds._sum.refundAmount ?? 0) - sale.netTotal) < 0.001, `Refunds add up to what was paid (${sale.netTotal}), got ${refunds._sum.refundAmount}`);
      const again = await post('/sales/return', devHeaders, { sale_id: mixedSaleId, return_items: [{ product_id: product.id, quantity: 1 }] });
      assert(again.status === 400, `Returning a closed invoice: expected 400, got ${again.status}`);
    });

    await test('Returns: need the return permission and an item from the invoice', async () => {
      const sale = await post('/sales', devHeaders, { items: [{ product_id: product.id, quantity: 1 }], payment_type: 'Cash' });
      const denied = await post('/sales/return', counterHeaders, { sale_id: sale.body.saleId, return_items: [{ product_id: product.id, quantity: 1 }] });
      assert(denied.status === 403, `Without can_return_sale: expected 403, got ${denied.status}`);
      const other = await makeProduct('C', 5);
      const notOnInvoice = await post('/sales/return', devHeaders, { sale_id: sale.body.saleId, return_items: [{ product_id: other.id, quantity: 1 }] });
      assert(notOnInvoice.status === 400, `Item not on the invoice: expected 400, got ${notOnInvoice.status}`);
    });

    await test('Shift cash: a credit return does not lower the expected cash; online counts as digital', async () => {
      const cashier = await makeUser('drawer', 'cashier');
      const headers = authHeaders(cashier);
      const shift = await openShift(cashier.id, cashier.fullName, 500);
      const customer = await prisma.customer.create({ data: { name: `P8 Khata ${suffix}`, phone: `0300${String(Date.now()).slice(-7)}` } });
      const credit = await post('/sales', headers, { items: [{ product_id: product.id, quantity: 1 }], payment_type: 'Credit', customer_id: customer.id });
      assert(credit.status === 200, `Credit sale: ${credit.status} ${JSON.stringify(credit.body)}`);
      const ret = await post('/sales/return', headers, { sale_id: credit.body.saleId, return_items: [{ product_id: product.id, quantity: 1 }] });
      assert(ret.status === 200, `Credit return: ${ret.status} ${JSON.stringify(ret.body)}`);
      await post('/sales', headers, { items: [{ product_id: product.id, quantity: 1 }], payment_type: 'Online' });
      const summary = await request(`/shifts/${shift.id}/summary`, headers);
      assert(summary.body.summary.expected_cash === 500, `Expected cash stays 500, got ${summary.body.summary.expected_cash}`);
      assert(summary.body.summary.total_sales_card === 120, `Online sale in the digital bucket, got ${summary.body.summary.total_sales_card}`);
    });

    await test('Shifts: only the owner (or a shift manager) closes a shift; the count is required', async () => {
      const owner = await makeUser('owner', 'cashier');
      const shift = await openShift(owner.id, owner.fullName);
      const byOther = await post(`/shifts/${shift.id}/close`, counterHeaders, { actual_cash: 1000 });
      assert(byOther.status === 403, `Another user: expected 403, got ${byOther.status}`);
      const noCount = await post(`/shifts/${shift.id}/close`, authHeaders(owner), {});
      assert(noCount.status === 400, `No count: expected 400, got ${noCount.status}`);
      const ok = await post(`/shifts/${shift.id}/close`, authHeaders(owner), { actual_cash: 1000 });
      assert(ok.status === 200 && ok.body.shift.status === 'closed', `Owner close: ${ok.status} ${JSON.stringify(ok.body)}`);
      const twice = await post(`/shifts/${shift.id}/close`, authHeaders(owner), { actual_cash: 1000 });
      assert(twice.status === 400, `Second close: expected 400, got ${twice.status}`);
    });

    await test('Shifts: a closed shift is not reopened while the user has another open one', async () => {
      const user = await makeUser('reopen', 'cashier');
      const old = await prisma.cashierShift.create({
        data: { shiftNo: `SH-P8-OLD-${suffix}`, userId: user.id, userName: user.fullName, startTime: new Date(), openingCash: 0, status: 'closed' }
      });
      await prisma.cashierShift.create({
        data: { shiftNo: `SH-P8-NEW-${suffix}`, userId: user.id, userName: user.fullName, startTime: new Date(), openingCash: 0, status: 'open' }
      });
      const res = await post(`/shifts/${old.id}/admin/reopen`, devHeaders, { reason: 'test' });
      assert(res.status === 400 && /already has an open shift/.test(res.body.error), `Expected 400, got ${res.status} ${res.body.error}`);
    });

    await test('Khata: a payment above the balance is refused; payments need the permission', async () => {
      const customer = await prisma.customer.create({ data: { name: `P8 Pay ${suffix}`, phone: `0301${String(Date.now()).slice(-7)}`, currentBalance: 300 } });
      const over = await post(`/customers/${customer.id}/payment`, devHeaders, { amount: 500, payment_method: 'cash' });
      assert(over.status === 400, `Overpayment: expected 400, got ${over.status}`);
      const denied = await post(`/customers/${customer.id}/payment`, counterHeaders, { amount: 100 });
      assert(denied.status === 403, `Without can_receive_payment: expected 403, got ${denied.status}`);
      const ok = await post(`/customers/${customer.id}/payment`, devHeaders, { amount: 100, payment_method: 'cash' });
      assert(ok.status === 200 && ok.body.new_balance === 200, `Payment: ${ok.status} ${JSON.stringify(ok.body)}`);
      const missing = await post('/customers/999999/payment', devHeaders, { amount: 1 });
      assert(missing.status === 404, `Unknown customer: expected 404, got ${missing.status}`);
    });

    await test('Roles: nobody grants a permission they do not have, or changes their own role', async () => {
      const managerRole = await makeRole('manager', { settings: true, can_manage_roles: true, can_manage_users: true });
      const manager = await makeUser('manager', managerRole.name);
      const headers = authHeaders(manager);
      const escalate = await post('/roles', headers, { name: `p8_super_${suffix}`, display_name: 'Super', permissions: { can_restore: true } });
      assert(escalate.status >= 400, `Granting can_restore: expected an error, got ${escalate.status}`);
      assert(!(await prisma.role.findUnique({ where: { name: `p8_super_${suffix}` } })), 'Role was not created');
      const allowed = await post('/roles', headers, { name: `p8_small_${suffix}`, display_name: 'Small', permissions: { settings: true } });
      assert(allowed.status === 200, `Granting own permission: expected 200, got ${allowed.status} ${JSON.stringify(allowed.body)}`);
      const self = await request(`/users/${manager.id}`, headers, { method: 'PUT', body: JSON.stringify({ role: 'cashier' }) });
      assert(self.status === 403, `Own role change: expected 403, got ${self.status}`);
      const ghost = await post('/users', headers, { username: `p8_ghost_${suffix}`, password: 'secret12', full_name: 'Ghost', role: 'no_such_role' });
      assert(ghost.status === 400, `Unknown role: expected 400, got ${ghost.status}`);
    });

    await test('Permissions: inventory, purchases and reports check the role on the server', async () => {
      const product = await post('/products', counterHeaders, { name: 'X', p_code: `X-${suffix}`, c_code: 'P8' });
      assert(product.status === 403, `Add medicine: expected 403, got ${product.status}`);
      const company = await post('/companies', counterHeaders, { name: 'X', code: `X${suffix}` });
      assert(company.status === 403, `Add company: expected 403, got ${company.status}`);
      const purchases = await request('/purchases', counterHeaders);
      assert(purchases.status === 403, `Purchases: expected 403, got ${purchases.status}`);
      const pnl = await request('/reports/financial/pnl-summary', counterHeaders);
      assert(pnl.status === 403, `P&L: expected 403, got ${pnl.status}`);
      const optimize = await post('/utilities/optimize', counterHeaders, {});
      assert(optimize.status === 403, `Optimize: expected 403, got ${optimize.status}`);
    });

    await test('Login: five wrong passwords lock a staff account', async () => {
      const user = await makeUser('lock', 'cashier', 'secret12');
      for (let i = 0; i < 4; i++) {
        const wrong = await post('/auth/login', {}, { username: user.username, password: 'nope' });
        assert(wrong.status === 401, `Wrong password ${i + 1}: expected 401, got ${wrong.status}`);
      }
      const fifth = await post('/auth/login', {}, { username: user.username, password: 'nope' });
      assert(fifth.status === 429, `Fifth wrong password: expected 429, got ${fifth.status}`);
      const right = await post('/auth/login', {}, { username: user.username, password: 'secret12' });
      assert(right.status === 429, `Correct password while locked: expected 429, got ${right.status}`);
      const reset = await request(`/users/${user.id}`, devHeaders, { method: 'PUT', body: JSON.stringify({ password: 'newpass12' }) });
      assert(reset.status === 200, `Reset: ${reset.status} ${JSON.stringify(reset.body)}`);
      const after = await post('/auth/login', {}, { username: user.username, password: 'newpass12' });
      assert(after.status === 200, `After a reset the account works: expected 200, got ${after.status} ${JSON.stringify(after.body)}`);
    });

    await test('Passwords: one minimum length for new accounts', async () => {
      const short = await post('/users', devHeaders, { username: `p8_short_${suffix}`, password: '123', full_name: 'Short', role: 'cashier' });
      assert(short.status === 400 && /at least 6/.test(short.body.error), `Expected 400, got ${short.status} ${short.body.error}`);
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nPhase 8: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runPhase8Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
