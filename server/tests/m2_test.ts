/**
 * PharmaCare Pro - M2 Test Suite (docs/FEATURE_ROADMAP.md)
 * Covers returns to suppliers and expiry claims: stock, batch and supplier balance go down, credit at the
 * purchase cost (or trade price), over-return / stock / supplier checks, the expiry claim list and permissions.
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

async function runM2Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M2 Test Suite (Returns to supplier)         ')));
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
  const supplier = await prisma.company.create({ data: { code: `M2A${suffix}`.toUpperCase(), name: `M2 Distributor ${suffix}` } });
  const other = await prisma.company.create({ data: { code: `M2B${suffix}`.toUpperCase(), name: `M2 Other ${suffix}` } });
  const product = await prisma.product.create({
    data: { companyId: supplier.id, cCode: supplier.code, pCode: `M2-${suffix}`, name: `M2 Syrup ${suffix}`, packing: 1, boxTradePrice: 80, boxRetailPrice: 120 }
  });
  const foreign = await prisma.product.create({
    data: { companyId: other.id, cCode: other.code, pCode: `M2F-${suffix}`, name: `M2 Foreign ${suffix}`, packing: 1, boxTradePrice: 50, boxRetailPrice: 70, stockBoxes: 5 }
  });
  const viewerRole = await prisma.role.create({ data: { name: `m2_viewer_${suffix}`, displayName: 'M2 Viewer', permissions: JSON.stringify({ purchases: true }) } });
  const viewer = await prisma.user.create({ data: { username: `m2_viewer_${suffix}`, password: 'x', fullName: 'M2 Viewer', role: viewerRole.name, status: 'active' } });

  const yesterday = new Date(Date.now() - 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const expired = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

  const giveBack = (body: Record<string, unknown>, headers = devHeaders) => post('/purchase-returns', headers, { company_id: supplier.id, ...body });
  const balance = async () => (await request(`/suppliers/${supplier.id}/ledger`, devHeaders)).body.totals.balance;
  const stock = async () => (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stockBoxes;

  let purchaseId = 0;
  let lineId = 0;

  try {
    await test('Setup: a credit purchase of 5 + 1 bonus boxes at 100 less 10%', async () => {
      const res = await post('/purchases', devHeaders, {
        company_id: supplier.id, payment_status: 'Pending',
        items: [{ product_id: product.id, quantity_boxes: 5, bonus_boxes: 1, box_cost_price: 100, box_retail_price: 120, discount_pct: 10, batch_no: 'EXP1', expiry_date: expired }]
      });
      assert(res.status === 200, `Purchase: ${res.status} ${JSON.stringify(res.body)}`);
      purchaseId = res.body.purchaseId;
      const details = await request(`/purchases/${purchaseId}`, devHeaders);
      lineId = details.body.items[0].id;
      assert(details.body.items[0].returnable_boxes === 6, `6 boxes returnable, got ${details.body.items[0].returnable_boxes}`);
      assert((await balance()) === 450 && (await stock()) === 6, 'Owed 450, 6 boxes in stock');
    });

    await test('A return from the purchase lowers stock, the batch and the supplier balance (client amounts ignored)', async () => {
      const res = await giveBack({ purchase_id: purchaseId, total_credit: 1, items: [{ product_id: product.id, purchase_item_id: lineId, quantity_boxes: 2, rate: 1 }] });
      assert(res.status === 200 && res.body.totalCredit === 180, `Credit 2 x 90 = 180, got ${res.status} ${JSON.stringify(res.body)}`);
      assert((await stock()) === 4, 'Stock 4');
      const batch = await prisma.productBatch.findFirstOrThrow({ where: { productId: product.id, batchNo: 'EXP1' } });
      assert(batch.quantityBoxes === 4, `Batch 4, got ${batch.quantityBoxes}`);
      assert((await balance()) === 270, `Owed 270, got ${await balance()}`);
      const details = await request(`/purchases/${purchaseId}`, devHeaders);
      assert(details.body.items[0].returned_boxes === 2, 'Purchase line shows 2 returned');
    });

    await test('More than is left on the purchase line is refused', async () => {
      const res = await giveBack({ items: [{ product_id: product.id, purchase_item_id: lineId, quantity_boxes: 5 }] });
      assert(res.status === 400 && /Only 4/.test(res.body.error), `Expected 400 "Only 4", got ${res.status} ${res.body.error}`);
    });

    await test('More than the stock is refused', async () => {
      const res = await giveBack({ items: [{ product_id: product.id, quantity_boxes: 10 }] });
      assert(res.status === 400 && /in stock/.test(res.body.error), `Expected 400, got ${res.status} ${res.body.error}`);
    });

    await test("Another supplier's medicine is refused", async () => {
      const res = await giveBack({ items: [{ product_id: foreign.id, quantity_boxes: 1 }] });
      assert(res.status === 400 && /not supplied/.test(res.body.error), `Expected 400, got ${res.status} ${res.body.error}`);
    });

    await test('Stock not linked to a purchase is credited at the trade price', async () => {
      const res = await giveBack({ reason: 'Damaged', items: [{ product_id: product.id, quantity_boxes: 1 }] });
      assert(res.status === 200 && res.body.totalCredit === 100, `Trade price 100 (updated by the purchase), got ${JSON.stringify(res.body)}`);
      assert((await stock()) === 3, 'Stock 3');
    });

    await test('Expiry claims list the expired batch (capped by stock) and it goes after the claim', async () => {
      const list = await request(`/purchase-returns/expiry-candidates?days=30&company_id=${supplier.id}`, devHeaders);
      const row = list.body.find((r: any) => r.product_id === product.id);
      assert(row && row.expired && row.boxes === 3 && row.purchase_item_id === lineId && row.rate === 90, `Candidate ${JSON.stringify(row)}`);
      const claim = await giveBack({ is_expiry_claim: true, items: [{ product_id: product.id, purchase_item_id: row.purchase_item_id, batch_no: row.batch_no, quantity_boxes: row.boxes }] });
      assert(claim.status === 200 && claim.body.totalCredit === 270, `Claim: ${claim.status} ${JSON.stringify(claim.body)}`);
      const after = await request(`/purchase-returns/expiry-candidates?days=30&company_id=${supplier.id}`, devHeaders);
      assert(!after.body.some((r: any) => r.product_id === product.id), 'Nothing left to claim');
      const listed = await request('/purchase-returns', devHeaders);
      assert(listed.body.some((r: any) => r.id === claim.body.id && r.is_expiry_claim), 'The claim is listed as an expiry claim');
      const statement = await request(`/suppliers/${supplier.id}/ledger`, devHeaders);
      assert(statement.body.entries.some((e: any) => e.details === 'Expiry claim'), 'Statement shows the expiry claim');
    });

    await test('Credits above what is owed leave the supplier owing the store; payments are then refused', async () => {
      assert((await balance()) === -100, `Balance -100, got ${await balance()}`);
      const pay = await post(`/suppliers/${supplier.id}/payments`, devHeaders, { amount: 10 });
      assert(pay.status === 400, `Payment: expected 400, got ${pay.status}`);
    });

    await test('Returns need the permission; viewing needs purchases access', async () => {
      await prisma.product.update({ where: { id: product.id }, data: { stockBoxes: 5 } });
      const denied = await giveBack({ items: [{ product_id: product.id, quantity_boxes: 1 }] }, authHeaders(viewer));
      assert(denied.status === 403, `Expected 403, got ${denied.status}`);
      const view = await request('/purchase-returns', authHeaders(viewer));
      assert(view.status === 200, `Viewer can list returns, got ${view.status}`);
      const one = await request(`/purchase-returns/${view.body[0].id}`, authHeaders(viewer));
      assert(one.status === 200 && one.body.items.length > 0, 'Return details with items');
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM2: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM2Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
