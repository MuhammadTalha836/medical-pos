/**
 * PharmaCare Pro - M3 Test Suite (docs/FEATURE_ROADMAP.md)
 * Covers the reorder (short) list: below-minimum and running-out medicines, sales speed from real sales and
 * returns, cover days, filters and permissions.
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

async function runM3Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M3 Test Suite (Reorder list)                ')));
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
    data: { shiftNo: `SH-M3-${suffix}`, userId: dev.id, userName: dev.fullName, startTime: new Date(), openingCash: 0, status: 'open' }
  });
  const supplierA = await prisma.company.create({ data: { code: `M3A${suffix}`.toUpperCase(), name: `M3 Alpha ${suffix}` } });
  const supplierB = await prisma.company.create({ data: { code: `M3B${suffix}`.toUpperCase(), name: `M3 Beta ${suffix}` } });
  const make = (companyId: number, code: string, data: Record<string, unknown>) => prisma.product.create({
    data: { companyId, cCode: 'M3', pCode: `M3-${code}-${suffix}`, name: `M3 ${code} ${suffix}`, packing: 10, boxTradePrice: 50, boxRetailPrice: 80, unitRetailPrice: 8, minStockAlert: 0, ...data }
  });
  const low = await make(supplierA.id, 'LOW', { stockBoxes: 3, minStockAlert: 10 });
  const fast = await make(supplierA.id, 'FAST', { stockBoxes: 10 });
  const inactive = await make(supplierA.id, 'OFF', { stockBoxes: 0, minStockAlert: 10, status: 'inactive' });
  const plenty = await make(supplierA.id, 'FULL', { stockBoxes: 100, minStockAlert: 10 });
  const other = await make(supplierB.id, 'OTHER', { stockBoxes: 0, minStockAlert: 5 });
  const viewerRole = await prisma.role.create({ data: { name: `m3_pos_${suffix}`, displayName: 'M3 POS', permissions: JSON.stringify({ pos: true }) } });
  const viewer = await prisma.user.create({ data: { username: `m3_pos_${suffix}`, password: 'x', fullName: 'M3 POS', role: viewerRole.name, status: 'active' } });

  const list = async (query = '') => {
    const res = await request(`/reorder${query}`, devHeaders);
    assert(res.status === 200, `Reorder list: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const find = (body: any, id: number) => body.items.find((i: any) => i.product_id === id);
  let fastSaleId = 0;

  try {
    await test('A medicine at or below its minimum is listed with boxes up to twice the minimum', async () => {
      const row = find(await list('?cover_days=7'), low.id);
      assert(row && row.reason === 'below_minimum' && row.suggested_boxes === 17, `Row ${JSON.stringify(row)}`);
      assert(row.estimated_cost === 850 && row.company_name === supplierA.name, 'Cost 17 x 50 under its supplier');
    });

    await test('A medicine selling fast is listed by days left', async () => {
      const sale = await post('/sales', devHeaders, { items: [{ product_id: fast.id, quantity: 9 }], payment_type: 'Cash' });
      assert(sale.status === 200, `Sale: ${sale.status} ${JSON.stringify(sale.body)}`);
      fastSaleId = sale.body.saleId;
      const row = find(await list('?cover_days=7'), fast.id);
      // 90 units in 30 days = 3/day; 10 units left = 3.3 days; need 21 - 10 = 11 units = 2 boxes
      assert(row && row.reason === 'running_out' && row.suggested_boxes === 2 && row.days_left === 3.3, `Row ${JSON.stringify(row)}`);
    });

    await test('More cover days means a bigger order', async () => {
      const row = find(await list('?cover_days=30'), fast.id);
      assert(row?.suggested_boxes === 8, `30 days: (90 - 10) / 10 = 8, got ${row?.suggested_boxes}`);
    });

    await test('Returned goods lower the sales speed', async () => {
      const ret = await post('/sales/return', devHeaders, { sale_id: fastSaleId, return_items: [{ product_id: fast.id, quantity: 5 }] });
      assert(ret.status === 200, `Return: ${ret.status} ${JSON.stringify(ret.body)}`);
      // 40 units in 30 days, 60 units on the shelf: 45 days left, not needed
      assert(!find(await list('?cover_days=7'), fast.id), 'No longer on the list');
    });

    await test('Inactive and well-stocked medicines are left out', async () => {
      const body = await list();
      assert(!find(body, inactive.id) && !find(body, plenty.id), 'Neither is listed');
    });

    await test('The supplier filter keeps one supplier', async () => {
      const all = await list();
      assert(find(all, other.id), 'Other supplier listed without a filter');
      const onlyA = await list(`?company_id=${supplierA.id}`);
      assert(!find(onlyA, other.id) && find(onlyA, low.id), 'Filtered to supplier A');
    });

    await test('Cover days default to the store setting', async () => {
      await prisma.systemSetting.upsert({ where: { key: 'reorder_cover_days' }, update: { value: '15' }, create: { key: 'reorder_cover_days', value: '15' } });
      assert((await list()).cover_days === 15, 'Setting used');
      assert((await list('?cover_days=999')).cover_days === 60, 'Capped at 60');
    });

    await test('The list needs purchases access', async () => {
      const res = await request('/reorder', authHeaders(viewer));
      assert(res.status === 403, `Expected 403, got ${res.status}`);
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM3: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM3Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
