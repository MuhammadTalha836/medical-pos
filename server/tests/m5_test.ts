/**
 * PharmaCare Pro - M5 Test Suite (docs/FEATURE_ROADMAP.md)
 * Covers medicine schedules and the controlled-medicine register: controlled sales need a prescription,
 * one register row per controlled line, Rx-only sells freely, the register's date filter, returns and access.
 * Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import http from 'http';
import { app } from '../api';
import { authHeaders, ensureTestDeveloper, useFullTestLicense } from './testAuth';
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

async function runM5Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M5 Test Suite (Controlled register)         ')));
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
    data: { shiftNo: `SH-M5-${suffix}`, userId: dev.id, userName: dev.fullName, startTime: new Date(), openingCash: 0, status: 'open' }
  });
  const supplier = await prisma.company.create({ data: { code: `M5${suffix}`.toUpperCase(), name: `M5 Distributor ${suffix}` } });
  const noReportsRole = await prisma.role.create({ data: { name: `m5_pos_${suffix}`, displayName: 'M5 Counter', permissions: JSON.stringify({ pos: true, sales: true }) } });
  const counter = await prisma.user.create({ data: { username: `m5_pos_${suffix}`, password: 'x', fullName: 'M5 Counter', role: noReportsRole.name, status: 'active' } });

  const newProduct = (code: string, schedule?: unknown) => post('/products', devHeaders, {
    company_id: supplier.id, c_code: supplier.code, p_code: `M5-${code}-${suffix}`, name: `M5 ${code} ${suffix}`,
    unit_type: 'Tablets', packing: 10, box_trade_price: 100, box_retail_price: 150, unit_retail_price: 15,
    stock_boxes: 5, ...(schedule === undefined ? {} : { schedule })
  });
  const stockOf = async (id: number) => {
    const p = await prisma.product.findUniqueOrThrow({ where: { id } });
    return p.stockBoxes * p.packing + p.stockLoose;
  };
  const rx = { patient_name: 'Ali Raza', patient_phone: '0300-1234567', patient_cnic: '35202-1234567-1', doctor_name: 'Dr Khan', doctor_reg_no: 'PMDC-123', prescription_no: 'RX-77' };

  let controlledId = 0;
  let rxOnlyId = 0;
  let plainId = 0;
  let saleId = 0;

  try {
    await test('Medicines save their schedule; an unknown schedule is refused', async () => {
      const c = await newProduct('CTRL', 'controlled');
      assert(c.status === 200, `Create controlled: ${c.status} ${JSON.stringify(c.body)}`);
      controlledId = c.body.id;
      const r = await newProduct('RX', 'rx');
      rxOnlyId = r.body.id;
      const n = await newProduct('PLAIN');
      plainId = n.body.id;
      assert((await prisma.product.findUniqueOrThrow({ where: { id: plainId } })).schedule === 'none', 'Default is none');
      const bad = await newProduct('BAD', 'narcotic');
      assert(bad.status === 400, `Unknown schedule refused, got ${bad.status}`);

      const search = await request(`/products/search?q=${encodeURIComponent(`M5 CTRL ${suffix}`)}`, devHeaders);
      assert(search.body[0]?.schedule === 'controlled', `Search returns schedule: ${JSON.stringify(search.body[0])}`);

      // An edit without the field keeps the schedule
      const current = (await request(`/products/${rxOnlyId}`, devHeaders)).body;
      const { schedule: _omit, ...withoutSchedule } = current;
      assert((await put(`/products/${rxOnlyId}`, devHeaders, withoutSchedule)).status === 200, 'Edit saved');
      assert((await prisma.product.findUniqueOrThrow({ where: { id: rxOnlyId } })).schedule === 'rx', 'Edit without schedule keeps rx');
    });

    await test('A controlled sale without a prescription is refused and stock stays', async () => {
      const before = await stockOf(controlledId);
      const sale = await post('/sales', devHeaders, { items: [{ product_id: controlledId, quantity: 1 }], payment_type: 'Cash' });
      assert(sale.status === 400 && /controlled medicine/.test(sale.body.error) && /prescription number/.test(sale.body.error), `Refused: ${sale.status} ${JSON.stringify(sale.body)}`);
      assert((await stockOf(controlledId)) === before, 'Stock unchanged');
    });

    await test('A prescription missing the doctor is refused; a bad CNIC is refused', async () => {
      const noDoctor = await post('/sales', devHeaders, { items: [{ product_id: controlledId, quantity: 1 }], payment_type: 'Cash', prescription: { ...rx, doctor_name: ' ' } });
      assert(noDoctor.status === 400 && /doctor name/.test(noDoctor.body.error), `No doctor: ${JSON.stringify(noDoctor.body)}`);
      const badCnic = await post('/sales', devHeaders, { items: [{ product_id: controlledId, quantity: 1 }], payment_type: 'Cash', prescription: { ...rx, patient_cnic: '123' } });
      assert(badCnic.status === 400 && /CNIC/.test(badCnic.body.error), `Bad CNIC: ${JSON.stringify(badCnic.body)}`);
    });

    await test('With a full prescription the sale saves one register row per controlled line', async () => {
      const sale = await post('/sales', devHeaders, {
        items: [{ product_id: controlledId, quantity: 2 }, { product_id: plainId, quantity: 1 }, { product_id: controlledId, quantity: 3, is_loose: true }],
        payment_type: 'Cash',
        prescription: rx
      });
      assert(sale.status === 200, `Sale: ${sale.status} ${JSON.stringify(sale.body)}`);
      saleId = sale.body.saleId;
      const rows = await prisma.prescriptionRecord.findMany({ where: { saleId }, orderBy: { id: 'asc' } });
      assert(rows.length === 2, `Two register rows, got ${rows.length}`);
      assert(rows.every(r => r.productId === controlledId && r.patientName === 'Ali Raza' && r.doctorName === 'Dr Khan' && r.prescriptionNo === 'RX-77'), 'Details stored');
      assert(rows[0].quantity === 2 && rows[0].isLoose === 0 && rows[1].quantity === 3 && rows[1].isLoose === 1, 'Quantities and units stored');
    });

    await test('An Rx-only medicine sells without a prescription', async () => {
      const sale = await post('/sales', devHeaders, { items: [{ product_id: rxOnlyId, quantity: 1 }], payment_type: 'Cash' });
      assert(sale.status === 200, `Sale: ${sale.status} ${JSON.stringify(sale.body)}`);
      assert((await prisma.prescriptionRecord.count({ where: { saleId: sale.body.saleId } })) === 0, 'No register row');
    });

    await test('The register lists the rows, filters by date and shows returns', async () => {
      const ret = await post('/sales/return', devHeaders, { sale_id: saleId, return_items: [{ product_id: controlledId, quantity: 1 }] });
      assert(ret.status === 200, `Return: ${ret.status} ${JSON.stringify(ret.body)}`);

      const today = localDateString();
      const list = await request(`/reports/controlled-register?date_from=${today}&date_to=${today}`, devHeaders);
      assert(list.status === 200, `Register: ${list.status}`);
      const mine = list.body.filter((r: any) => r.sale_id === saleId);
      assert(mine.length === 2, `Two rows today, got ${mine.length}`);
      const boxes = mine.find((r: any) => !r.is_loose);
      const loose = mine.find((r: any) => r.is_loose);
      assert(boxes.returned_qty === 1 && loose.returned_qty === 0, `Returned qty ${JSON.stringify(mine.map((r: any) => r.returned_qty))}`);
      assert(boxes.invoice_no && boxes.patient_cnic === '35202-1234567-1' && boxes.doctor_reg_no === 'PMDC-123', 'Row details');

      const old = await request('/reports/controlled-register?date_from=2000-01-01&date_to=2000-01-31', devHeaders);
      assert(old.status === 200 && old.body.length === 0, `Old range empty, got ${old.body.length}`);
    });

    await test('The register needs the reports permission', async () => {
      const res = await request('/reports/controlled-register', authHeaders(counter));
      assert(res.status === 403, `Expected 403, got ${res.status}`);
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM5: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM5Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
