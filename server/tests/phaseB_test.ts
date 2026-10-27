/**
 * PharmaCare Pro - Phase B Test Suite (docs/NEXT_PHASES.md: visible bugs and small gaps)
 * Covers the server side of Phase B: credit returns in the khata ledger, Sales History customer/medicine filters and
 * paging, date ranges on the product-wise and company-wise reports, the Dashboard's local "today" and active shifts,
 * the Admin's read-only audit log (without the Developer's own rows) and the real version from /api/status.
 * The screens (printing, CSV, statement window, POS shortcuts, About) are checked in the app.
 * Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import http from 'http';
import { app } from '../api';
import { authHeaders, ensureTestAdmin, ensureTestDeveloper, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { db } from '../database/db';
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

async function runPhaseBTests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase B Test Suite (visible bugs and gaps)      ')));
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
  const developer = await ensureTestDeveloper();
  const devHeaders = authHeaders(developer);
  const cashier = await prisma.user.create({
    data: { username: `phaseb_cashier_${suffix}`, password: await hashPassword('phase-b-pass'), fullName: 'Phase B Cashier', role: 'cashier', status: 'active' }
  });
  const cashierHeaders = authHeaders(cashier);
  const products = await prisma.product.findMany({ where: { status: 'active', schedule: 'none', stockBoxes: { gt: 20 } }, orderBy: { id: 'asc' }, take: 2 });
  const [medA, medB] = products;
  const customer = await prisma.customer.create({ data: { name: `Phase B Khata ${suffix}`, phone: `0300${String(Date.now()).slice(-7)}`, creditLimit: 0, currentBalance: 0 } });
  const setSaleDate = (id: number, when: Date) => db.prepare('UPDATE sales SET sale_date = ? WHERE id = ?').run(when.getTime(), id);

  try {
    assert((await post('/shifts/start', adminHeaders, { opening_cash: 0 })).status === 200, 'Admin shift');
    assert((await post('/shifts/start', cashierHeaders, { opening_cash: 0 })).status === 200, 'Cashier shift');

    await test('Khata ledger lists returns of credit bills', async () => {
      const sale = await post('/sales', adminHeaders, { payment_type: 'Credit', customer_id: customer.id, items: [{ product_id: medA.id, quantity: 2 }] });
      assert(sale.status === 200, `Credit sale ${sale.status} ${JSON.stringify(sale.body)}`);
      const ret = await post('/sales/return', adminHeaders, { sale_id: sale.body.sale.id, return_items: [{ product_id: medA.id, quantity: 1 }] });
      assert(ret.status === 200, `Return ${ret.status} ${JSON.stringify(ret.body)}`);
      const ledger = await request(`/customers/${customer.id}/ledger`, adminHeaders);
      assert(ledger.status === 200 && Array.isArray(ledger.body.returns) && ledger.body.returns.length === 1, `Returns ${JSON.stringify(ledger.body.returns)}`);
      const r = ledger.body.returns[0];
      assert(r.invoice_no === sale.body.sale.invoice_no && r.refund_amount > 0, `Return row ${JSON.stringify(r)}`);
      // The statement builder ends on the saved balance
      const balance = Number(ledger.body.customer.current_balance);
      assert(Math.abs(balance - (sale.body.sale.net_total - r.refund_amount)) < 0.01, `Balance ${balance}`);
    });

    await test('Sales History: customer and medicine filters, paging, own-only kept', async () => {
      const byCustomer = await request(`/sales?customer=${encodeURIComponent(customer.name)}`, adminHeaders);
      assert(byCustomer.body.length >= 1 && byCustomer.body.every((s: any) => s.customer_name === customer.name), 'Customer by name');
      const byPhone = await request(`/sales?customer=${customer.phone}`, adminHeaders);
      assert(byPhone.body.length >= 1, 'Customer by phone');

      const onlyB = await post('/sales', adminHeaders, { payment_type: 'Cash', items: [{ product_id: medB.id, quantity: 1 }] });
      assert(onlyB.status === 200, 'Sale with medicine B');
      const byMedicine = await request(`/sales?medicine=${encodeURIComponent(medB.name)}`, adminHeaders);
      assert(byMedicine.body.some((s: any) => s.id === onlyB.body.sale.id), 'Bill with medicine B found');
      const byCode = await request(`/sales?medicine=${encodeURIComponent(medB.pCode)}`, adminHeaders);
      assert(byCode.body.some((s: any) => s.id === onlyB.body.sale.id), 'Found by P-Code');
      const withA = await request(`/sales?medicine=${encodeURIComponent(medA.name)}`, adminHeaders);
      assert(!withA.body.some((s: any) => s.id === onlyB.body.sale.id), 'Bill without medicine A left out');

      for (let i = 0; i < 3; i++) assert((await post('/sales', adminHeaders, { payment_type: 'Cash', items: [{ product_id: medB.id, quantity: 1 }] })).status === 200, 'Extra sale');
      const page1 = await request('/sales?limit=2', adminHeaders);
      const page2 = await request('/sales?limit=2&offset=2', adminHeaders);
      assert(page1.body.length === 2 && page2.body.length === 2, `Page sizes ${page1.body.length}, ${page2.body.length}`);
      assert(!page2.body.some((s: any) => page1.body.some((p: any) => p.id === s.id)), 'Pages do not overlap');
      assert(page1.body[1].id > page2.body[0].id, 'Newest first across pages');

      assert((await post('/sales', cashierHeaders, { payment_type: 'Cash', items: [{ product_id: medB.id, quantity: 1 }] })).status === 200, 'Cashier sale');
      const cashierMedicine = await request(`/sales?medicine=${encodeURIComponent(medB.name)}`, cashierHeaders);
      // The default cashier role has View All Staff Invoices off: only their own bills, even with a filter
      assert(cashierMedicine.body.length >= 1 && cashierMedicine.body.every((s: any) => s.user_id === cashier.id), 'Cashier still sees only own bills');
    });

    await test('Product-wise and company-wise sales follow the date range (local days)', async () => {
      const sale = await post('/sales', adminHeaders, { payment_type: 'Cash', items: [{ product_id: medA.id, quantity: 3 }] });
      setSaleDate(sale.body.sale.id, new Date(2025, 5, 10, 1, 15));
      const day = '2025-06-10';
      const products = await request(`/reports/sales/product-wise?date_from=${day}&date_to=${day}`, adminHeaders);
      assert(products.status === 200 && products.body.length === 1 && products.body[0].product_id === medA.id && Number(products.body[0].total_quantity_sold) === 3, `Product-wise ${JSON.stringify(products.body)}`);
      const companies = await request(`/reports/sales/company-wise?date_from=${day}&date_to=${day}`, adminHeaders);
      assert(companies.status === 200 && companies.body.length === 1 && Number(companies.body[0].invoice_count) === 1, `Company-wise ${JSON.stringify(companies.body)}`);
      const none = await request('/reports/sales/product-wise?date_from=2025-06-11&date_to=2025-06-11', adminHeaders);
      assert(none.body.length === 0, 'Nothing on the next day');
      const all = await request('/reports/sales/product-wise', adminHeaders);
      assert(all.body.length >= 2, 'No range = all sales');
    });

    await test('Dashboard: today in local time, active shifts for managers only', async () => {
      const early = await post('/sales', adminHeaders, { payment_type: 'Cash', items: [{ product_id: medA.id, quantity: 1 }] });
      const now = new Date();
      const atOne = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30);
      setSaleDate(early.body.sale.id, atOne);
      const before = await request('/dashboard/stats', adminHeaders);
      assert(before.status === 200, `Stats ${before.status}`);
      assert(before.body.todaySales.total_invoices >= 1, `Today count ${before.body.todaySales.total_invoices}`);
      // The 00:30 sale is today; move it to yesterday 23:30 and the count drops by one
      setSaleDate(early.body.sale.id, new Date(atOne.getTime() - 60 * 60 * 1000));
      const after = await request('/dashboard/stats', adminHeaders);
      assert(after.body.todaySales.total_invoices === before.body.todaySales.total_invoices - 1, `Count ${before.body.todaySales.total_invoices} -> ${after.body.todaySales.total_invoices}`);

      const shifts = before.body.activeShifts;
      assert(Array.isArray(shifts) && shifts.some((s: any) => s.user_name === 'Phase B Cashier'), `Active shifts ${JSON.stringify(shifts)}`);
      assert(!('expected_cash' in shifts[0]) && !('opening_cash' in shifts[0]), 'No cash figures in the card');
      await prisma.role.update({ where: { name: 'cashier' }, data: { permissions: JSON.stringify({ ...JSON.parse((await prisma.role.findUniqueOrThrow({ where: { name: 'cashier' } })).permissions), dashboard: true }) } });
      const cashierStats = await request('/dashboard/stats', cashierHeaders);
      assert(cashierStats.status === 200 && cashierStats.body.activeShifts === null, `Cashier sees no shifts: ${JSON.stringify(cashierStats.body.activeShifts)}`);
    });

    await test('Admin audit log: read only, without the Developer account, permission needed', async () => {
      assert((await request('/developer/cloud', cashierHeaders)).status === 403, 'Make a cashier DENIED row');
      await prisma.auditLog.create({ data: { action: 'PHASEB_DEV_ROW', module: 'DEVELOPER_SETTINGS', status: 'SUCCESS', userId: developer.id, userName: developer.username } });
      const adminView = await request('/audit-logs?limit=200', adminHeaders);
      assert(adminView.status === 200 && adminView.body.total > 0, `Admin view ${adminView.status}`);
      assert(!adminView.body.logs.some((l: any) => l.user_id === developer.id), 'No Developer rows for the Admin');
      assert(adminView.body.logs.some((l: any) => l.status === 'DENIED' && l.user_id === cashier.id), 'Staff denials listed');
      const devView = await request('/developer/audit-logs?action=PHASEB_DEV_ROW', devHeaders);
      assert(devView.status === 200 && devView.body.logs.length === 1, 'The Developer still sees everything');
      assert((await request('/audit-logs', cashierHeaders)).status === 403, 'Cashier refused');
      const filtered = await request('/audit-logs?status=DENIED', adminHeaders);
      assert(filtered.body.logs.every((l: any) => l.status === 'DENIED'), 'Status filter works');
    });

    await test('Status reports the running version', async () => {
      const status = await request('/status', {});
      assert(status.status === 200 && status.body.version === (process.env.PHARMACARE_APP_VERSION || '0.0.0-dev'), `Version ${JSON.stringify(status.body)}`);
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nPhase B: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runPhaseBTests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
