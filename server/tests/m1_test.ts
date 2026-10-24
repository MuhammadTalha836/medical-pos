/**
 * PharmaCare Pro - M1 Test Suite (docs/FEATURE_ROADMAP.md)
 * Covers the supplier ledger: purchases costed on the server with a paid-now amount, balances, payments
 * settling the oldest bill first, the statement, overpayment and permissions.
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

const post = (p: string, headers: Record<string, string>, body: unknown) =>
  request(p, headers, { method: 'POST', body: JSON.stringify(body) });

async function runM1Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M1 Test Suite (Supplier ledger)             ')));
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
  const dev = await ensureTestDeveloper();
  const devHeaders = authHeaders(dev);
  const supplier = await prisma.company.create({ data: { code: `M1${suffix}`.toUpperCase(), name: `M1 Distributor ${suffix}` } });
  const product = await prisma.product.create({
    data: { companyId: supplier.id, cCode: supplier.code, pCode: `M1-${suffix}`, name: `M1 Tablet ${suffix}`, packing: 10, boxTradePrice: 100, boxRetailPrice: 120 }
  });
  const viewerRole = await prisma.role.create({ data: { name: `m1_viewer_${suffix}`, displayName: 'M1 Viewer', permissions: JSON.stringify({ purchases: true }) } });
  const viewer = await prisma.user.create({ data: { username: `m1_viewer_${suffix}`, password: 'x', fullName: 'M1 Viewer', role: viewerRole.name, status: 'active' } });
  const viewerHeaders = authHeaders(viewer);

  const purchase = (extra: Record<string, unknown>, boxes = 10) => post('/purchases', devHeaders, {
    company_id: supplier.id,
    purchase_date: '2026-10-01',
    items: [{ product_id: product.id, quantity_boxes: boxes, box_cost_price: 100, box_retail_price: 120, batch_no: 'B1', expiry_date: '2028-01-31' }],
    ...extra
  });
  const ledger = async () => (await request(`/suppliers/${supplier.id}/ledger`, devHeaders)).body;

  try {
    await test('Purchases: the server works out the totals and the paid amount', async () => {
      const res = await purchase({ net_total: 1, total_gross: 1, paid_amount: 0 });
      assert(res.status === 200, `Expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
      assert(res.body.netTotal === 1000 && res.body.paidAmount === 0, `Net 1000 unpaid, got ${res.body.netTotal}/${res.body.paidAmount}`);
      const stored = await prisma.purchase.findUniqueOrThrow({ where: { id: res.body.purchaseId } });
      assert(stored.paymentStatus === 'Pending', `Pending, got ${stored.paymentStatus}`);
    });

    await test('Purchases: paid now above the total and bad lines are refused', async () => {
      const over = await purchase({ paid_amount: 5000 });
      assert(over.status === 400, `Overpaid: expected 400, got ${over.status}`);
      const zero = await post('/purchases', devHeaders, { company_id: supplier.id, items: [{ product_id: product.id, quantity_boxes: 0, box_cost_price: 1, box_retail_price: 1 }] });
      assert(zero.status === 400, `Zero boxes: expected 400, got ${zero.status}`);
      const missing = await post('/purchases', devHeaders, { company_id: supplier.id, items: [{ product_id: 99999999, quantity_boxes: 1, box_cost_price: 1, box_retail_price: 1 }] });
      assert(missing.status === 400, `Unknown medicine: expected 400, got ${missing.status}`);
    });

    await test('Ledger: a part-paid purchase adds only the unpaid part', async () => {
      const res = await purchase({ paid_amount: 200, purchase_date: '2026-10-05' }, 5);
      assert(res.status === 200, `Purchase: ${res.status} ${JSON.stringify(res.body)}`);
      const l = await ledger();
      assert(l.totals.purchased === 1500 && l.totals.paid === 200 && l.totals.balance === 1300, `Totals ${JSON.stringify(l.totals)}`);
      const list = await request('/suppliers', devHeaders);
      const row = list.body.find((r: any) => r.id === supplier.id);
      assert(row?.balance === 1300 && row.unpaid_bills === 2, `List row ${JSON.stringify(row)}`);
    });

    await test('Payments: settle the oldest bill first and show in the statement', async () => {
      const pay = await post(`/suppliers/${supplier.id}/payments`, devHeaders, { amount: 1100, payment_method: 'cheque', reference: 'CHQ-77', payment_date: '2026-10-10' });
      assert(pay.status === 200 && pay.body.balance === 200, `Payment: ${pay.status} ${JSON.stringify(pay.body)}`);
      const l = await ledger();
      assert(l.dues[0].status === 'Paid' && l.dues[1].status === 'Partial' && l.dues[1].due === 200, `Dues ${JSON.stringify(l.dues)}`);
      const last = l.entries[l.entries.length - 1];
      assert(last.kind === 'payment' && last.balance === 200 && /CHQ-77/.test(last.details), `Last entry ${JSON.stringify(last)}`);
      const purchases = await request('/purchases', devHeaders);
      const first = purchases.body.find((p: any) => p.id === l.dues[0].id);
      assert(first?.payment_status === 'Paid', `Purchase list shows Paid, got ${first?.payment_status}`);
    });

    await test('Payments: more than what is owed is refused', async () => {
      const over = await post(`/suppliers/${supplier.id}/payments`, devHeaders, { amount: 201 });
      assert(over.status === 400 && /more than what is owed/.test(over.body.error), `Expected 400, got ${over.status} ${over.body.error}`);
      const zero = await post(`/suppliers/${supplier.id}/payments`, devHeaders, { amount: 0 });
      assert(zero.status === 400, `Zero: expected 400, got ${zero.status}`);
    });

    await test('Payments: need the pay-suppliers permission; viewing needs purchases access', async () => {
      const denied = await post(`/suppliers/${supplier.id}/payments`, viewerHeaders, { amount: 10 });
      assert(denied.status === 403, `Without can_pay_supplier: expected 403, got ${denied.status}`);
      const view = await request(`/suppliers/${supplier.id}/ledger`, viewerHeaders);
      assert(view.status === 200, `Viewer can see the statement, got ${view.status}`);
      const missing = await request('/suppliers/99999999/ledger', devHeaders);
      assert(missing.status === 404, `Unknown supplier: expected 404, got ${missing.status}`);
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM1: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM1Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
