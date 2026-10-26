/**
 * PharmaCare Pro - M9 Test Suite (docs/FEATURE_ROADMAP.md)
 * Covers physical stock counts and stock adjustments: counting changes nothing until Apply, Apply keeps sales made
 * after counting, batches always add up to the stock, single adjustments with a reason and a batch, permissions,
 * the medicine form no longer edits stock, opening stock and stock zero are recorded, and the adjustment history.
 * The pure maths is in server/stock/adjustMath.spec.ts. Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import http from 'http';
import { app } from '../api';
import { authHeaders, ensureTestAdmin, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
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
const put = (p: string, headers: Record<string, string>, body: unknown) =>
  request(p, headers, { method: 'PUT', body: JSON.stringify(body) });
const del = (p: string, headers: Record<string, string>) => request(p, headers, { method: 'DELETE' });

/** Product stock in units, and the sum of its batches in units */
async function stockOf(productId: number) {
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const batches = await prisma.productBatch.findMany({ where: { productId } });
  const units = p.stockBoxes * p.packing + p.stockLoose;
  const batchUnits = batches.reduce((s, b) => s + b.quantityBoxes * p.packing + b.quantityLoose, 0);
  return { units, batchUnits };
}

async function runM9Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M9 Test Suite (stock count and adjustment)   ')));
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
  const today = localDateString();
  const admin = await ensureTestAdmin();
  const adminHeaders = authHeaders(admin);
  const cashier = await prisma.user.create({
    data: { username: `m9_cashier_${suffix}`, password: 'x', fullName: 'M9 Cashier', role: 'cashier', status: 'active' }
  });
  const cashierHeaders = authHeaders(cashier);
  const viewerRole = await prisma.role.create({ data: { name: `m9_viewer_${suffix}`, displayName: 'M9 Viewer', permissions: JSON.stringify({ pos: true, masters: true }) } });
  const viewer = await prisma.user.create({
    data: { username: `m9_viewer_${suffix}`, password: 'x', fullName: 'M9 Viewer', role: viewerRole.name, status: 'active' }
  });
  const viewerHeaders = authHeaders(viewer);

  await prisma.cashierShift.create({
    data: { shiftNo: `SH-M9-${suffix}`, userId: admin.id, userName: admin.fullName, startTime: new Date(), openingCash: 0, status: 'open' }
  });
  const company = await prisma.company.create({ data: { code: `M9${suffix}`.toUpperCase(), name: `M9 Pharma ${suffix}` } });
  const newProduct = async (code: string, boxes: number, extra: Record<string, unknown> = {}) => {
    const res = await post('/products', adminHeaders, {
      company_id: company.id, c_code: company.code, p_code: `M9-${code}-${suffix}`, barcode: `BC${code}${suffix}`, name: `M9 ${code} ${suffix}`,
      unit_type: 'Tablets', packing: 10, box_trade_price: 200, box_retail_price: 300, unit_retail_price: 30, stock_boxes: boxes, ...extra
    });
    assert(res.status === 200, `Product ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.id as number;
  };

  try {
    const medA = await newProduct('A', 5); // 50 units
    const medB = await newProduct('B', 3); // 30 units
    const medC = await newProduct('C', 2); // 20 units, counted right

    await test('A new medicine with opening stock writes an opening adjustment', async () => {
      const row = await prisma.stockAdjustment.findFirst({ where: { productId: medA } });
      assert(row?.reason === 'opening' && row.deltaUnits === 50 && row.stockBefore === 0 && row.stockAfter === 50, `Opening row ${JSON.stringify(row)}`);
      assert(row?.unitCost === 20, `Unit cost ${row?.unitCost}`);
      const s = await stockOf(medA);
      assert(s.units === 50 && s.batchUnits === 50, `Stock ${JSON.stringify(s)}`);
    });

    await test('Editing a medicine does not change its stock', async () => {
      const p = await prisma.product.findUniqueOrThrow({ where: { id: medC } });
      const res = await put(`/products/${medC}`, adminHeaders, {
        company_id: company.id, c_code: p.cCode, p_code: p.pCode, barcode: p.barcode, name: p.name, unit_type: p.unitType,
        packing: p.packing, box_trade_price: 200, box_retail_price: 300, unit_retail_price: 30, stock_boxes: 99, stock_loose: 4, min_stock_alert: 2
      });
      assert(res.status === 200, `Edit ${res.status}`);
      const s = await stockOf(medC);
      assert(s.units === 20 && s.batchUnits === 20, `Stock after edit ${JSON.stringify(s)}`);
    });

    let countId = 0;
    await test('Counting does not change stock until Apply', async () => {
      const created = await post('/stock/counts', cashierHeaders, { title: 'Rack A', company_id: company.id });
      assert(created.status === 200, `Create ${created.status} ${JSON.stringify(created.body)}`);
      countId = created.body.count.id;
      assert(/^SC-\d{8}-\d{2}$/.test(created.body.count.count_no), `Count no ${created.body.count.count_no}`);

      const preloaded = await request(`/stock/counts/${countId}`, cashierHeaders);
      assert(preloaded.body.items.length === 3 && preloaded.body.items.every((i: any) => i.counted_units === null), 'Company medicines listed, not yet counted');

      // A: 4 boxes + 7 counted (47, 3 missing); B by barcode: 3 boxes + 5 (35, 5 extra); C: right
      assert((await put(`/stock/counts/${countId}/items`, cashierHeaders, { product_id: medA, counted_boxes: 4, counted_loose: 7 })).status === 200, 'Count A');
      assert((await put(`/stock/counts/${countId}/items`, cashierHeaders, { barcode: `BCB${suffix}`, counted_boxes: 3, counted_loose: 5 })).status === 200, 'Count B by barcode');
      assert((await put(`/stock/counts/${countId}/items`, cashierHeaders, { product_id: medC, counted_boxes: 2 })).status === 200, 'Count C');
      assert((await put(`/stock/counts/${countId}/items`, cashierHeaders, { barcode: 'NO-SUCH-CODE' })).status === 404, 'Unknown barcode 404');

      const detail = (await request(`/stock/counts/${countId}`, cashierHeaders)).body;
      const a = detail.items.find((i: any) => i.product_id === medA);
      assert(a.difference_units === -3 && a.difference_value === -60, `A difference ${a.difference_units} / ${a.difference_value}`);
      assert(detail.totals.loss_value === 60 && detail.totals.gain_value === 100, `Totals ${JSON.stringify(detail.totals)}`);
      assert((await stockOf(medA)).units === 50 && (await stockOf(medB)).units === 30, 'Stock unchanged before Apply');
    });

    await test('Apply sets the counted stock, keeps later sales and writes count rows', async () => {
      // 1 box of A sold after it was counted: 50 - 10 = 40, then -3 -> 37
      const sale = await post('/sales', adminHeaders, { items: [{ product_id: medA, quantity: 1 }], payment_type: 'Cash' });
      assert(sale.status === 200, `Sale ${sale.status} ${JSON.stringify(sale.body)}`);
      assert((await stockOf(medA)).units === 40, 'Sale took 10 units');

      assert((await post(`/stock/counts/${countId}/apply`, cashierHeaders, {})).status === 403, 'Cashier cannot apply');
      const applied = await post(`/stock/counts/${countId}/apply`, adminHeaders, {});
      assert(applied.status === 200, `Apply ${applied.status} ${JSON.stringify(applied.body)}`);
      assert(applied.body.counted === 3 && applied.body.changed === 2, `Applied ${JSON.stringify(applied.body)}`);

      const a = await stockOf(medA);
      const b = await stockOf(medB);
      const c = await stockOf(medC);
      assert(a.units === 37 && a.batchUnits === 37, `A ${JSON.stringify(a)}`);
      assert(b.units === 35 && b.batchUnits === 35, `B ${JSON.stringify(b)}`);
      assert(c.units === 20 && c.batchUnits === 20, `C ${JSON.stringify(c)}`);
      const rows = await prisma.stockAdjustment.findMany({ where: { countId } });
      assert(rows.length === 2 && rows.every(r => r.reason === 'count'), `Count rows ${rows.length}`);
      assert(rows.find(r => r.productId === medA)?.deltaUnits === -3, 'A row -3');
    });

    await test('An applied count is locked', async () => {
      assert((await post(`/stock/counts/${countId}/apply`, adminHeaders, {})).status === 409, 'Second apply 409');
      assert((await put(`/stock/counts/${countId}/items`, cashierHeaders, { product_id: medA, counted_boxes: 1 })).status === 409, 'Counting after apply 409');
      assert((await post(`/stock/counts/${countId}/cancel`, adminHeaders, {})).status === 409, 'Cancel after apply 409');
      const audit = await prisma.auditLog.findFirst({ where: { action: 'STOCK_COUNT_APPLIED' }, orderBy: { id: 'desc' } });
      assert(!!audit?.details?.includes('applied'), 'Audit row');

      const other = (await post('/stock/counts', cashierHeaders, {})).body.count.id;
      assert((await put(`/stock/counts/${other}/items`, cashierHeaders, { product_id: medA })).status === 200, 'Add line without a count');
      assert((await del(`/stock/counts/${other}/items/${medA}`, cashierHeaders)).status === 200, 'Remove line');
      assert((await post(`/stock/counts/${other}/cancel`, adminHeaders, {})).status === 200, 'Cancel');
      assert((await request('/stock/counts', cashierHeaders)).body.find((c: any) => c.id === other)?.status === 'cancelled', 'Listed as cancelled');
    });

    await test('Single adjustment: chosen batch, opening batch, and limits', async () => {
      const batch = await prisma.productBatch.create({
        data: { productId: medB, batchNo: `M9B-${suffix}`, expiryDate: '2030-01-31', quantityBoxes: 0, quantityLoose: 0 }
      });
      // Move 1 box worth into the named batch through a "found" adjustment, then damage 1 box from it
      const found = await post(`/products/${medB}/adjust`, adminHeaders, { reason: 'found', direction: 'in', boxes: 1, batch_id: batch.id, notes: 'Behind the shelf' });
      assert(found.status === 200 && found.body.adjustment.stock_after === 45, `Found ${found.status} ${JSON.stringify(found.body)}`);
      const damaged = await post(`/products/${medB}/adjust`, adminHeaders, { reason: 'damaged', direction: 'out', boxes: 1, batch_id: batch.id });
      assert(damaged.status === 200, `Damaged ${damaged.status} ${JSON.stringify(damaged.body)}`);
      const fresh = await prisma.productBatch.findUniqueOrThrow({ where: { id: batch.id } });
      assert(fresh.quantityBoxes === 0 && fresh.quantityLoose === 0, 'Named batch back to 0');
      const b = await stockOf(medB);
      assert(b.units === 35 && b.batchUnits === 35, `B ${JSON.stringify(b)}`);

      assert((await post(`/products/${medB}/adjust`, adminHeaders, { reason: 'damaged', direction: 'out', boxes: 1, batch_id: batch.id })).status === 400, 'Batch cannot go below 0');
      assert((await post(`/products/${medB}/adjust`, adminHeaders, { reason: 'lost', direction: 'out', boxes: 4 })).status === 400, 'Stock cannot go below 0');
      assert((await post(`/products/${medB}/adjust`, adminHeaders, { reason: 'found', direction: 'out', boxes: 1 })).status === 400, 'Found cannot lower stock');
      assert((await post(`/products/${medB}/adjust`, adminHeaders, { reason: 'correction', direction: 'in' })).status === 400, 'Zero refused');
      assert((await post(`/products/${medB}/adjust`, adminHeaders, { reason: 'count', direction: 'in', boxes: 1 })).status === 400, 'Count is not a manual reason');

      const lost = await post(`/products/${medB}/adjust`, adminHeaders, { reason: 'lost', direction: 'out', loose: 5 });
      assert(lost.status === 200 && lost.body.stock_boxes === 3 && lost.body.stock_loose === 0, `Lost ${JSON.stringify(lost.body)}`);
      assert((await stockOf(medB)).batchUnits === 30, 'Batches follow');
    });

    await test('Permissions', async () => {
      assert((await post(`/products/${medA}/adjust`, cashierHeaders, { reason: 'damaged', direction: 'out', boxes: 1 })).status === 403, 'Cashier cannot adjust');
      assert((await request('/stock/adjustments', cashierHeaders)).status === 403, 'Cashier cannot see the history');
      assert((await post('/stock/counts', viewerHeaders, {})).status === 403, 'No count permission: cannot start');
      assert((await request('/stock/counts', viewerHeaders)).status === 403, 'No count permission: cannot list');
      assert((await post('/stock/counts', {}, {})).status === 401, 'No session');
    });

    await test('Adjustment history: filters, totals at cost, stock zero rows', async () => {
      const all = (await request(`/stock/adjustments?from=${today}&to=${today}`, adminHeaders)).body;
      const mine = all.adjustments.filter((a: any) => [medA, medB, medC].includes(a.product_id));
      assert(mine.length >= 8, `Rows today ${mine.length}`);
      const damaged = (await request(`/stock/adjustments?reason=damaged&product_id=${medB}`, adminHeaders)).body;
      assert(damaged.adjustments.length === 1 && damaged.adjustments[0].value === -200 && damaged.adjustments[0].batch_no === `M9B-${suffix}`, `Damaged ${JSON.stringify(damaged.adjustments)}`);
      assert(damaged.totals.loss_value === 200 && damaged.totals.gain_value === 0, `Damaged totals ${JSON.stringify(damaged.totals)}`);
      assert((await request('/stock/adjustments?reason=nope', adminHeaders)).status === 400, 'Unknown reason 400');
      assert((await request(`/stock/adjustments?from=${today}&to=2000-01-01`, adminHeaders)).status === 400, 'From after To 400');

      const zero = await post('/utilities/stock-zero', adminHeaders, { company_id: company.id, confirmation_code: 'RESET-ZERO-CONFIRM' });
      assert(zero.status === 200, `Stock zero ${zero.status}`);
      const zeroRows = (await request(`/stock/adjustments?reason=stock_zero&from=${today}&to=${today}`, adminHeaders)).body.adjustments
        .filter((a: any) => [medA, medB, medC].includes(a.product_id));
      assert(zeroRows.length === 3, `Stock zero rows ${zeroRows.length}`);
      const zA = zeroRows.find((a: any) => a.product_id === medA);
      assert(zA.delta_units === -37 && zA.stock_after === 0 && zA.value === -740, `Stock zero A ${JSON.stringify(zA)}`);
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM9: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM9Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
