/**
 * PharmaCare Pro - Phase 6 Test Suite
 * Covers: khata customers (search, unique phone, permissions), credit sales linked to a saved customer,
 * credit limits, customer invoice history, and credit returns lowering the khata balance.
 * Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import http from 'http';
import { app } from '../api';
import { authHeaders, ensureTestDeveloper, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';

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

async function runPhase6Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase 6 Test Suite                           ')));
  console.log(colors.bold(colors.cyan('  (Khata Customers, Credit Sales, Credit Limits, Returns)       ')));
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

  // Fixtures: developer (all permissions) with an open shift, a stocked product, and a role without customer rights
  const suffix = Date.now().toString(36);
  const dev = await ensureTestDeveloper();
  const devHeaders = authHeaders(dev);
  await prisma.cashierShift.updateMany({ where: { userId: dev.id, status: 'open' }, data: { status: 'closed' } });
  const shift = await prisma.cashierShift.create({
    data: { shiftNo: `SH-P6-${suffix}`, userId: dev.id, userName: dev.fullName, startTime: new Date(), openingCash: 1000, status: 'open' }
  });
  const product = await prisma.product.create({
    data: { cCode: 'P6', pCode: `P6-${suffix}`, name: `Phase6 Syrup ${suffix}`, packing: 1, boxRetailPrice: 100, unitRetailPrice: 100, boxTradePrice: 80, unitTradePrice: 80, stockBoxes: 100 }
  });
  const lookupRole = await prisma.role.create({
    data: { name: `p6_lookup_${suffix}`, displayName: 'P6 Lookup', permissions: JSON.stringify({ pos: true }) }
  });
  const lookupUser = await prisma.user.create({
    data: { username: `p6_lookup_${suffix}`, password: 'x', fullName: 'P6 Lookup', role: lookupRole.name, status: 'active' }
  });
  const lookupHeaders = authHeaders(lookupUser);

  const sale = (body: Record<string, unknown>) => request('/sales', devHeaders, {
    method: 'POST',
    body: JSON.stringify({
      shift_id: shift.id,
      items: [{ product_id: product.id, is_loose: 0, quantity: 1, unit_price: 100 }],
      net_total: 100,
      ...body
    })
  });

  const phone = `0333-${String(Date.now()).slice(-7)}`;
  let customerId = 0;

  try {
    await test('Customers: a new customer needs a name and a valid phone', async () => {
      const noPhone = await request('/customers', devHeaders, { method: 'POST', body: JSON.stringify({ name: 'Zubair Ahmed' }) });
      assert(noPhone.status === 400, `Missing phone: expected 400, got ${noPhone.status}`);
      const badPhone = await request('/customers', devHeaders, { method: 'POST', body: JSON.stringify({ name: 'Zubair Ahmed', phone: '123' }) });
      assert(badPhone.status === 400, `Short phone: expected 400, got ${badPhone.status}`);

      const created = await request('/customers', devHeaders, { method: 'POST', body: JSON.stringify({ name: 'Zubair Ahmed', phone, credit_limit: 250 }) });
      assert(created.status === 200 && created.body.customer?.id, `Create: expected 200, got ${created.status} ${JSON.stringify(created.body)}`);
      customerId = created.body.customer.id;
    });

    await test('Customers: the same phone (any format) cannot be saved twice', async () => {
      const dup = await request('/customers', devHeaders, { method: 'POST', body: JSON.stringify({ name: 'Someone Else', phone: phone.replace('-', ' ') }) });
      assert(dup.status === 409, `Duplicate phone: expected 409, got ${dup.status}`);
      assert(dup.body.customer?.id === customerId, 'The 409 answer names the existing customer');
    });

    await test('Customers: search finds a customer by name and by phone', async () => {
      const byName = await request('/customers/search?q=zubair', devHeaders);
      assert(byName.status === 200 && byName.body.some((c: any) => c.id === customerId), 'Found by name (case-insensitive)');
      const byPhone = await request(`/customers/search?q=${encodeURIComponent(phone.replace('-', ''))}`, devHeaders);
      assert(byPhone.body[0]?.id === customerId, 'Exact phone match ranks first');
      const lookup = await request('/customers/search?q=zubair', lookupHeaders);
      assert(lookup.status === 200, 'A role with POS access can search');
    });

    await test('Customers: adding needs the "Register Khata Account" permission', async () => {
      const denied = await request('/customers', lookupHeaders, { method: 'POST', body: JSON.stringify({ name: 'No Rights', phone: '0300-7654321' }) });
      assert(denied.status === 403, `Expected 403, got ${denied.status}`);
    });

    await test('Credit sale: needs a saved customer', async () => {
      const typedOnly = await sale({ payment_type: 'Credit', customer_name: 'Typed Name' });
      assert(typedOnly.status === 400, `Credit without customer: expected 400, got ${typedOnly.status}`);
      const unknown = await sale({ payment_type: 'Credit', customer_id: 99999999 });
      assert(unknown.status === 400, `Unknown customer: expected 400, got ${unknown.status}`);
    });

    let creditSaleId = 0;
    await test('Credit sale: raises the khata balance and uses the saved name', async () => {
      const res = await sale({ payment_type: 'Credit', customer_id: customerId, customer_name: 'typed differently' });
      assert(res.status === 200 && res.body.success, `Credit sale: expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
      creditSaleId = res.body.saleId;
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      assert(customer?.currentBalance === 100, `Balance 100, got ${customer?.currentBalance}`);
      const stored = await prisma.sale.findUnique({ where: { id: creditSaleId } });
      assert(stored?.customerName === 'Zubair Ahmed' && stored.customerPhone === phone, 'Sale keeps the saved name and phone');
    });

    await test('Credit sale: blocked when it would cross the credit limit', async () => {
      await sale({ payment_type: 'Credit', customer_id: customerId }); // balance 200 of 250
      const over = await sale({ payment_type: 'Credit', customer_id: customerId });
      assert(over.status === 400 && /Credit limit/.test(over.body.error), `Over limit: expected 400, got ${over.status} ${JSON.stringify(over.body)}`);
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      assert(customer?.currentBalance === 200, `Balance unchanged at 200, got ${customer?.currentBalance}`);
    });

    await test('Cash sale with a customer: shows in their invoices, balance unchanged', async () => {
      const cash = await sale({ payment_type: 'Cash', customer_id: customerId });
      assert(cash.status === 200, `Cash sale: expected 200, got ${cash.status}`);
      const ledger = await request(`/customers/${customerId}/ledger`, devHeaders);
      assert(ledger.status === 200, 'Ledger loads');
      assert(ledger.body.sales.length === 3, `3 invoices linked, got ${ledger.body.sales.length}`);
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      assert(customer?.currentBalance === 200, 'Cash sale does not change the khata balance');
    });

    await test('Return of a credit sale lowers the khata balance', async () => {
      const ret = await request('/sales/return', devHeaders, {
        method: 'POST',
        body: JSON.stringify({
          sale_id: creditSaleId,
          shift_id: shift.id,
          return_items: [{ product_id: product.id, is_loose: 0, quantity: 1, unit_refund_price: 100 }]
        })
      });
      assert(ret.status === 200 && ret.body.success, `Return: expected 200, got ${ret.status} ${JSON.stringify(ret.body)}`);
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      assert(customer?.currentBalance === 100, `Balance 100 after the return, got ${customer?.currentBalance}`);
    });
    await test('Customer list and invoices carry totals and item counts', async () => {
      const list = await request('/customers', devHeaders);
      const row = list.body.find((c: any) => c.id === customerId);
      assert(row && Number(row.total_purchases) === 200, `total_purchases 200 (returned sale excluded), got ${row?.total_purchases}`);
      const ledger = await request(`/customers/${customerId}/ledger`, devHeaders);
      assert(ledger.body.sales.every((s: any) => s.items_count === 1), 'Each invoice reports its item count');
    });

    await test('Delete: refused for a customer with history, allowed for a new one', async () => {
      const refused = await request(`/customers/${customerId}`, devHeaders, { method: 'DELETE' });
      assert(refused.status === 409 && /cannot be deleted/.test(refused.body.error), `Expected 409, got ${refused.status}`);

      const fresh = await request('/customers', devHeaders, { method: 'POST', body: JSON.stringify({ name: 'Temp Customer', phone: `0344-${String(Date.now()).slice(-7)}` }) });
      const denied = await request(`/customers/${fresh.body.customer.id}`, lookupHeaders, { method: 'DELETE' });
      assert(denied.status === 403, `Without permission: expected 403, got ${denied.status}`);
      const deleted = await request(`/customers/${fresh.body.customer.id}`, devHeaders, { method: 'DELETE' });
      assert(deleted.status === 200, `Expected 200, got ${deleted.status}`);
      assert(!(await prisma.customer.findUnique({ where: { id: fresh.body.customer.id } })), 'Customer removed');
      const missing = await request(`/customers/${fresh.body.customer.id}`, devHeaders, { method: 'DELETE' });
      assert(missing.status === 404, 'Deleting again gives 404');
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nPhase 6: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runPhase6Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
