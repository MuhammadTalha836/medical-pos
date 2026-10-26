/**
 * PharmaCare Pro - M4 Test Suite (docs/FEATURE_ROADMAP.md)
 * Covers batches and FEFO: earliest expiry sold first, splits, loose units, returns back to their batch,
 * expired stock never sold, opening batches, trims, batch edits, the expired report and the start-up reconcile.
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

async function runM4Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M4 Test Suite (Batches, FEFO, expiry)       ')));
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
  await prisma.cashierShift.updateMany({ where: { userId: dev.id, status: 'open' }, data: { status: 'closed' } });
  await prisma.cashierShift.create({
    data: { shiftNo: `SH-M4-${suffix}`, userId: dev.id, userName: dev.fullName, startTime: new Date(), openingCash: 0, status: 'open' }
  });
  const supplier = await prisma.company.create({ data: { code: `M4${suffix}`.toUpperCase(), name: `M4 Distributor ${suffix}` } });
  const product = await prisma.product.create({
    data: { companyId: supplier.id, cCode: supplier.code, pCode: `M4-${suffix}`, name: `M4 Tablet ${suffix}`, packing: 10, boxTradePrice: 100, boxRetailPrice: 150, unitRetailPrice: 15 }
  });
  const viewerRole = await prisma.role.create({ data: { name: `m4_view_${suffix}`, displayName: 'M4 Viewer', permissions: JSON.stringify({ masters: true }) } });
  const viewer = await prisma.user.create({ data: { username: `m4_view_${suffix}`, password: 'x', fullName: 'M4 Viewer', role: viewerRole.name, status: 'active' } });

  const day = (offset: number) => {
    const d = new Date(Date.now() + offset * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const buy = (boxes: number, batch: string, expiry: string, productId = product.id) => post('/purchases', devHeaders, {
    company_id: supplier.id,
    items: [{ product_id: productId, quantity_boxes: boxes, box_cost_price: 100, box_retail_price: 150, batch_no: batch, expiry_date: expiry }]
  });
  const batchUnits = async (productId = product.id) => {
    const rows = await prisma.productBatch.findMany({ where: { productId } });
    const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    return {
      byBatch: Object.fromEntries(rows.map(r => [r.batchNo, r.quantityBoxes * p.packing + r.quantityLoose])),
      sum: rows.reduce((s, r) => s + r.quantityBoxes * p.packing + r.quantityLoose, 0),
      stock: p.stockBoxes * p.packing + p.stockLoose
    };
  };
  const invariant = async (productId = product.id) => {
    const b = await batchUnits(productId);
    assert(b.sum === b.stock, `Batches ${b.sum} must equal stock ${b.stock}`);
    return b;
  };
  let saleId = 0;

  try {
    await test('A sale takes the earliest expiry first and splits across batches', async () => {
      assert((await buy(2, 'LATE', day(400))).status === 200, 'Late batch bought');
      assert((await buy(2, 'EARLY', day(200))).status === 200, 'Early batch bought');
      const sale = await post('/sales', devHeaders, { items: [{ product_id: product.id, quantity: 3 }], payment_type: 'Cash' });
      assert(sale.status === 200, `Sale: ${sale.status} ${JSON.stringify(sale.body)}`);
      saleId = sale.body.saleId;
      const b = await invariant();
      assert(b.byBatch.EARLY === 0 && b.byBatch.LATE === 10, `EARLY 0 / LATE 10 units, got ${JSON.stringify(b.byBatch)}`);
      const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId }, include: { batchAllocations: true } });
      assert(item.batchAllocations.length === 2 && item.batchAllocations.reduce((s, a) => s + a.units, 0) === 30, 'Two allocations, 30 units');
    });

    await test('Loose units come out of a batch too', async () => {
      const sale = await post('/sales', devHeaders, { items: [{ product_id: product.id, is_loose: 1, quantity: 4 }], payment_type: 'Cash' });
      assert(sale.status === 200, `Loose sale: ${sale.status} ${JSON.stringify(sale.body)}`);
      const b = await invariant();
      assert(b.byBatch.LATE === 6, `LATE 6 units, got ${b.byBatch.LATE}`);
    });

    await test('A return goes back into the batches it came from', async () => {
      const ret = await post('/sales/return', devHeaders, { sale_id: saleId, return_items: [{ product_id: product.id, quantity: 1 }] });
      assert(ret.status === 200, `Return: ${ret.status} ${JSON.stringify(ret.body)}`);
      const b = await invariant();
      // The last batch used (LATE) gets the box back first
      assert(b.byBatch.LATE === 16 && b.byBatch.EARLY === 0, `LATE 16 / EARLY 0, got ${JSON.stringify(b.byBatch)}`);
    });

    await test('Expired stock is never sold', async () => {
      const old = await prisma.product.create({
        data: { companyId: supplier.id, cCode: supplier.code, pCode: `M4X-${suffix}`, name: `M4 Old ${suffix}`, packing: 10, boxTradePrice: 100, boxRetailPrice: 150 }
      });
      await buy(3, 'GONE', day(-5), old.id);
      await buy(1, 'GOOD', day(100), old.id);
      const tooMany = await post('/sales', devHeaders, { items: [{ product_id: old.id, quantity: 2 }], payment_type: 'Cash' });
      assert(tooMany.status === 400 && /expired/.test(tooMany.body.error), `Expected the expired message, got ${tooMany.status} ${tooMany.body.error}`);
      assert((await batchUnits(old.id)).stock === 40, 'Nothing taken by the refused sale');
      const ok = await post('/sales', devHeaders, { items: [{ product_id: old.id, quantity: 1 }], payment_type: 'Cash' });
      assert(ok.status === 200, `Valid stock sells: ${ok.status} ${JSON.stringify(ok.body)}`);
      const b = await invariant(old.id);
      assert(b.byBatch.GONE === 30 && b.byBatch.GOOD === 0, `Expired batch untouched, got ${JSON.stringify(b.byBatch)}`);
    });

    await test('Opening stock gets an opening batch; lowering stock trims the earliest expiry', async () => {
      const created = await post('/products', devHeaders, {
        company_id: supplier.id, c_code: supplier.code, p_code: `M4O-${suffix}`, name: `M4 Opening ${suffix}`, packing: 10,
        box_trade_price: 50, box_retail_price: 70, stock_boxes: 5, stock_loose: 0, min_stock_alert: 1
      });
      assert(created.status === 200, `Create: ${created.status} ${JSON.stringify(created.body)}`);
      const id = created.body.id;
      let b = await invariant(id);
      assert(b.byBatch.OPENING === 50, `Opening batch 50 units, got ${JSON.stringify(b.byBatch)}`);
      await buy(2, 'NEW', day(300), id);
      // Since M9 stock is lowered with Adjust stock, not the medicine form
      const adjust = await request(`/products/${id}/adjust`, devHeaders, { method: 'POST', body: JSON.stringify({ reason: 'correction', direction: 'out', boxes: 4 }) });
      assert(adjust.status === 200, `Adjust: ${adjust.status} ${JSON.stringify(adjust.body)}`);
      b = await invariant(id);
      // 70 units down to 30: the dated batch goes first (expiry order), the opening batch last
      assert(b.byBatch.NEW === 0 && b.byBatch.OPENING === 30, `Trimmed, got ${JSON.stringify(b.byBatch)}`);
    });

    await test('Batch list, expiry edit and permissions', async () => {
      const list = await request(`/products/${product.id}/batches`, authHeaders(viewer));
      assert(list.status === 200 && list.body[0].batch_no === 'EARLY', `FEFO order, got ${JSON.stringify(list.body.map((x: any) => x.batch_no))}`);
      const early = list.body.find((x: any) => x.batch_no === 'EARLY');
      const denied = await request(`/products/${product.id}/batches/${early.id}`, authHeaders(viewer), { method: 'PUT', body: JSON.stringify({ batch_no: 'X' }) });
      assert(denied.status === 403, `Edit without permission: expected 403, got ${denied.status}`);
      const late = list.body.find((x: any) => x.batch_no === 'LATE');
      const edit = await request(`/products/${product.id}/batches/${late.id}`, devHeaders, { method: 'PUT', body: JSON.stringify({ batch_no: 'LATE-1', expiry_date: day(-1) }) });
      assert(edit.status === 200, `Edit: ${edit.status} ${JSON.stringify(edit.body)}`);
      const after = await request(`/products/${product.id}/batches`, devHeaders);
      assert(after.body.find((x: any) => x.id === late.id)?.status === 'expired', 'Now shown as expired');
    });

    await test('The expired report and the Dashboard count what is left', async () => {
      const report = await request('/reports/stock/expired?days=0', devHeaders);
      const row = report.body.find((r: any) => r.product_id === product.id);
      assert(row && row.batch_no === 'LATE-1' && row.quantity_boxes === 1 && row.quantity_loose === 6 && row.expired, `Report row ${JSON.stringify(row)}`);
      const stats = await request('/dashboard/stats', devHeaders);
      assert(stats.body.expiredCount >= 2 && stats.body.nearExpiry && typeof stats.body.nearExpiry.d90 === 'number', `Stats ${JSON.stringify({ e: stats.body.expiredCount, n: stats.body.nearExpiry })}`);
    });

    await test('Start-up reconcile fixes batches that hold more than the stock', async () => {
      const legacy = await prisma.product.create({
        data: { companyId: supplier.id, cCode: supplier.code, pCode: `M4L-${suffix}`, name: `M4 Legacy ${suffix}`, packing: 1, stockBoxes: 4 }
      });
      await prisma.productBatch.create({ data: { productId: legacy.id, batchNo: 'OLD', expiryDate: day(50), quantityBoxes: 10 } });
      const { reconcileAllProductBatches } = await import('../stock/batchStock');
      assert((await reconcileAllProductBatches()) >= 1, 'At least one product fixed');
      const b = await invariant(legacy.id);
      assert(b.byBatch.OLD === 4, `Trimmed to 4, got ${JSON.stringify(b.byBatch)}`);
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM4: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM4Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
