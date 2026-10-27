/**
 * PharmaCare Pro - Phase A Test Suite (docs/NEXT_PHASES.md: security and correctness on the server)
 * Covers: read permissions for sales, shifts, customers and stock counts; one open shift per user under a race;
 * PERMISSION_DENIED audit rows (throttled); restore refusing newer backups and upgrading older ones through the
 * online backup; local-day date filters for every stored date format; the P&L bill discount counted once;
 * product and company input checks and product audit rows.
 * Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import Database from 'better-sqlite3';
import { app } from '../api';
import { authHeaders, ensureTestAdmin, ensureTestDeveloper, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { db } from '../database/db';
import { createBackup } from '../database/backup';
import { hashPassword } from '../security/passwords';
import { DEFAULT_BLANK_PERMISSIONS } from '../../shared/permissions';

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

async function runPhaseATests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase A Test Suite (security and correctness)  ')));
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

  // A counter-only role: sells, but cannot see other staff's bills, return, use khata or close shifts
  await prisma.role.create({
    data: { name: `phasea_counter_${suffix}`, displayName: 'Phase A Counter', permissions: JSON.stringify(DEFAULT_BLANK_PERMISSIONS) }
  });
  const makeUser = async (name: string, role: string) => prisma.user.create({
    data: { username: `phasea_${name}_${suffix}`, password: await hashPassword('phase-a-pass'), fullName: `Phase A ${name}`, role, status: 'active' }
  });
  const cashierA = await makeUser('cashier_a', 'cashier');
  const cashierB = await makeUser('cashier_b', 'cashier');
  const limited = await makeUser('limited', `phasea_counter_${suffix}`);
  const headersA = authHeaders(cashierA);
  const headersB = authHeaders(cashierB);
  const headersLimited = authHeaders(limited);

  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'active', schedule: 'none', stockBoxes: { gt: 20 } },
    orderBy: { id: 'asc' }
  });
  const sell = (headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
    post('/sales', headers, { payment_type: 'Cash', items: [{ product_id: product.id, quantity: 1 }], ...extra });

  let saleA = { id: 0, invoice_no: '' };
  let shiftA = 0;

  try {
    await test('Sales: own invoices only, a full invoice number for returns, detail needs a reason', async () => {
      const shift = await post('/shifts/start', headersA, { opening_cash: 0 });
      assert(shift.status === 200, `Shift A ${shift.status} ${JSON.stringify(shift.body)}`);
      shiftA = shift.body.shift.id;
      const sale = await sell(headersA);
      assert(sale.status === 200, `Sale A ${sale.status} ${JSON.stringify(sale.body)}`);
      saleA = sale.body.sale;
      assert((await post('/shifts/start', headersLimited, { opening_cash: 0 })).status === 200, 'Limited shift');
      const own = await sell(headersLimited);
      assert(own.status === 200, `Limited sale ${own.status}`);

      const listLimited = await request('/sales', headersLimited);
      assert(listLimited.status === 200 && listLimited.body.every((s: any) => s.user_id === limited.id), 'Limited user lists only their own');
      const searchOther = await request(`/sales?invoice_no=${encodeURIComponent(saleA.invoice_no)}`, headersLimited);
      assert(searchOther.body.length === 0, 'Without returns, another cashier\'s full number is not found');
      assert((await request(`/sales/${saleA.id}`, headersLimited)).status === 403, 'Detail of another cashier\'s bill refused');
      assert((await request(`/sales/${own.body.sale.id}`, headersLimited)).status === 200, 'Own detail allowed');

      // A normal cashier can return, so a complete invoice number finds the other bill; a partial one does not
      const partial = await request(`/sales?invoice_no=${encodeURIComponent(saleA.invoice_no.slice(0, -2))}`, headersB);
      assert(partial.body.every((s: any) => s.user_id === cashierB.id), 'Partial number shows only own bills');
      const full = await request(`/sales?invoice_no=${encodeURIComponent(saleA.invoice_no)}`, headersB);
      assert(full.body.length === 1 && full.body[0].id === saleA.id, `Full number finds the bill: ${JSON.stringify(full.body)}`);
      assert((await request(`/sales/${saleA.id}`, headersB)).status === 200, 'Returns permission opens the bill');

      const listAdmin = await request('/sales', adminHeaders);
      assert(listAdmin.body.some((s: any) => s.id === saleA.id) && listAdmin.body.some((s: any) => s.user_id === limited.id), 'Admin sees everyone');
    });

    await test('Shifts: own only, active is always the signed-in user, closing needs the permission', async () => {
      const listB = await request('/shifts', headersB);
      assert(listB.status === 200 && listB.body.every((s: any) => s.user_id === cashierB.id), 'Cashier B lists only own shifts');
      const askOther = await request(`/shifts?user_id=${cashierA.id}`, headersB);
      assert(askOther.body.every((s: any) => s.user_id === cashierB.id), 'user_id in the query is ignored');
      assert((await request(`/shifts/${shiftA}`, headersB)).status === 403, 'Detail of another shift refused');
      assert((await request(`/shifts/${shiftA}/summary`, headersB)).status === 403, 'Summary of another shift refused');
      assert((await request(`/shifts/${shiftA}`, headersA)).status === 200, 'Own detail allowed');
      const activeB = await request(`/shifts/active?user_id=${cashierA.id}`, headersB);
      assert(activeB.status === 200 && activeB.body.activeShift === null, 'Active ignores the user_id query');
      const activeA = await request('/shifts/active', headersA);
      assert(activeA.body.activeShift?.id === shiftA, 'Own active shift without a query');
      const all = await request('/shifts', adminHeaders);
      assert(all.body.some((s: any) => s.user_id === cashierA.id) && all.body.some((s: any) => s.user_id === limited.id), 'Admin sees all shifts');

      const limitedShift = await prisma.cashierShift.findFirstOrThrow({ where: { userId: limited.id, status: 'open' } });
      const close = await post(`/shifts/${limitedShift.id}/close`, headersLimited, { actual_cash: 0 });
      assert(close.status === 403, `Closing without can_shift_close ${close.status}`);
      assert((await post(`/shifts/${limitedShift.id}/close`, adminHeaders, { actual_cash: 0 })).status === 200, 'A manager closes it');
    });

    await test('Customers: list and ledger need the khata module; the POS search stays open', async () => {
      assert((await request('/customers', headersLimited)).status === 403, 'List refused');
      const customer = await prisma.customer.findFirstOrThrow();
      assert((await request(`/customers/${customer.id}/ledger`, headersLimited)).status === 403, 'Ledger refused');
      assert((await request('/customers/search?q=a', headersLimited)).status === 200, 'Search allowed');
      assert((await request('/customers', headersA)).status === 200, 'Cashier with khata allowed');
      assert((await request('/stock/counts', headersLimited)).status === 403, 'Stock counts refused');
    });

    await test('One open shift per user even when two starts arrive together', async () => {
      const results = await Promise.all([post('/shifts/start', headersB, { opening_cash: 0 }), post('/shifts/start', headersB, { opening_cash: 0 })]);
      const ok = results.filter(r => r.status === 200).length;
      assert(ok === 1 && results.some(r => r.status === 400), `Statuses ${results.map(r => r.status).join(', ')}`);
      const open = await prisma.cashierShift.count({ where: { userId: cashierB.id, status: 'open' } });
      assert(open === 1, `Open shifts ${open}`);
      const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_shifts_one_open'").get();
      assert(!!index, 'The database index exists');
    });

    await test('A refusal is written to the audit log once per 10 minutes', async () => {
      const before = await prisma.auditLog.count({ where: { action: 'PERMISSION_DENIED', userId: limited.id, details: { contains: 'can_add_product' } } });
      for (let i = 0; i < 3; i++) {
        assert((await post('/products', headersLimited, { name: 'X', p_code: `PX-${i}` })).status === 403, 'Refused');
      }
      const rows = await prisma.auditLog.findMany({ where: { action: 'PERMISSION_DENIED', userId: limited.id, details: { contains: 'can_add_product' } } });
      assert(rows.length - before === 1, `Rows added ${rows.length - before}`);
      assert(rows[rows.length - 1].status === 'DENIED' && rows[rows.length - 1].details!.includes('POST /api/products'), `Row ${JSON.stringify(rows[rows.length - 1])}`);
      assert((await request('/developer/cloud', adminHeaders)).status === 403, 'Developer route refused');
      assert(await prisma.auditLog.count({ where: { action: 'PERMISSION_DENIED', userId: admin.id } }) >= 1, 'Developer refusal logged');
    });

    await test('Dates: every stored format lands on its local day', async () => {
      const day = '2026-01-15';
      const atOne = new Date(2026, 0, 15, 1, 0, 0);
      const s1 = await sell(headersA);
      const s2 = await sell(headersA);
      const s3 = await sell(headersA);
      // Prisma 6 integer milliseconds, Prisma 7 ISO text, raw-SQL UTC text: all at early morning local time
      db.prepare('UPDATE sales SET sale_date = ? WHERE id = ?').run(atOne.getTime(), s1.body.sale.id);
      db.prepare('UPDATE sales SET sale_date = ? WHERE id = ?').run(new Date(2026, 0, 15, 1, 30).toISOString().replace('Z', '+00:00'), s2.body.sale.id);
      db.prepare('UPDATE sales SET sale_date = ? WHERE id = ?').run(new Date(2026, 0, 15, 2, 0).toISOString().slice(0, 19).replace('T', ' '), s3.body.sale.id);
      const list = await request(`/sales?date_from=${day}&date_to=${day}`, adminHeaders);
      const ids = list.body.map((s: any) => s.id);
      assert([s1, s2, s3].every(s => ids.includes(s.body.sale.id)) && ids.length === 3, `Found ${JSON.stringify(ids)}`);
      const dayBefore = await request('/sales?date_from=2026-01-14&date_to=2026-01-14', adminHeaders);
      assert(dayBefore.body.length === 0, 'Nothing on the day before');
      const pnl = await request(`/reports/financial/invoice-pnl?date_from=${day}&date_to=${day}`, adminHeaders);
      assert(pnl.body.length === 3, `Invoice P&L rows ${pnl.body.length}`);
    });

    await test('P&L summary subtracts a bill discount once, not once per line', async () => {
      const second = await prisma.product.findFirstOrThrow({ where: { status: 'active', schedule: 'none', stockBoxes: { gt: 20 }, id: { not: product.id } }, orderBy: { id: 'asc' } });
      const third = await prisma.product.findFirstOrThrow({ where: { status: 'active', schedule: 'none', stockBoxes: { gt: 20 }, id: { notIn: [product.id, second.id] } }, orderBy: { id: 'asc' } });
      if (!(await prisma.cashierShift.findFirst({ where: { userId: admin.id, status: 'open' } }))) {
        assert((await post('/shifts/start', adminHeaders, { opening_cash: 0 })).status === 200, 'Admin shift');
      }
      const sale = await post('/sales', adminHeaders, {
        payment_type: 'Cash',
        bill_discount_pct: 5,
        items: [product, second, third].map(p => ({ product_id: p.id, quantity: 1 }))
      });
      assert(sale.status === 200 && sale.body.sale.bill_discount_amt > 0, `Discounted sale ${sale.status} ${JSON.stringify(sale.body)}`);
      db.prepare('UPDATE sales SET sale_date = ? WHERE id = ?').run(new Date(2026, 1, 20, 12, 0).getTime(), sale.body.sale.id);
      const items = await prisma.saleItem.findMany({ where: { saleId: sale.body.sale.id } });
      const expected = items.reduce((t, i) => t + i.netAmount - i.quantity * i.unitCost, 0) - sale.body.sale.bill_discount_amt;
      const summary = await request('/reports/financial/pnl-summary?date_from=2026-02-20&date_to=2026-02-20', adminHeaders);
      assert(Math.abs(summary.body.gross_profit - expected) < 0.01, `Gross profit ${summary.body.gross_profit}, expected ${expected}`);
    });

    await test('Medicines and companies: checked input, unique barcode, loose price, audit', async () => {
      assert((await post('/products', adminHeaders, { name: '', p_code: 'PA-0' })).status === 400, 'Name required');
      assert((await post('/products', adminHeaders, { name: 'Bad', p_code: 'PA-1', box_retail_price: 'abc' })).status === 400, 'Price must be a number');
      assert((await post('/products', adminHeaders, { name: 'Bad', p_code: 'PA-2', packing: 0 })).status === 400, 'Packing at least 1');
      const noPrice = await post('/products', adminHeaders, { name: 'No price', p_code: `PA-3-${suffix}`, allow_open_sale: 1, packing: 10 });
      assert(noPrice.status === 400 && /unit price/i.test(noPrice.body.error), `Loose sale without a price ${noPrice.status}`);

      const created = await post('/products', adminHeaders, {
        name: `Phase A Tab ${suffix}`, p_code: `PA-4-${suffix}`, barcode: `PA${suffix}`, packing: 10, box_retail_price: 250, allow_open_sale: 1
      });
      assert(created.status === 200, `Create ${created.status} ${JSON.stringify(created.body)}`);
      const saved = await prisma.product.findUniqueOrThrow({ where: { id: created.body.id } });
      assert(saved.unitRetailPrice === 25, `Unit price from the box price: ${saved.unitRetailPrice}`);
      const dup = await post('/products', adminHeaders, { name: 'Copy', p_code: `PA-5-${suffix}`, barcode: `PA${suffix}`, box_retail_price: 10 });
      assert(dup.status === 409, `Duplicate barcode ${dup.status}`);

      // Loose sale off, then an edit that leaves the field out keeps it off
      assert((await put(`/products/${saved.id}`, adminHeaders, { name: saved.name, p_code: saved.pCode, packing: 10, box_retail_price: 250, allow_open_sale: 0 })).status === 200, 'Turn loose sale off');
      const edit = await put(`/products/${saved.id}`, adminHeaders, { name: saved.name, p_code: saved.pCode, packing: 10, box_retail_price: 300 });
      assert(edit.status === 200, `Edit ${edit.status} ${JSON.stringify(edit.body)}`);
      const after = await prisma.product.findUniqueOrThrow({ where: { id: saved.id } });
      assert(after.allowOpenSale === 0 && after.boxRetailPrice === 300, `After edit: open ${after.allowOpenSale}, price ${after.boxRetailPrice}`);
      const updatedLog = await prisma.auditLog.findFirst({ where: { action: 'PRODUCT_UPDATED' }, orderBy: { id: 'desc' } });
      assert(!!updatedLog?.details?.includes('box retail 250 → 300'), `Update audit: ${updatedLog?.details}`);
      assert((await del(`/products/${saved.id}`, adminHeaders)).status === 200, 'Delete');
      assert(!!(await prisma.auditLog.findFirst({ where: { action: 'PRODUCT_CREATED' } })) && !!(await prisma.auditLog.findFirst({ where: { action: 'PRODUCT_DELETED' } })), 'Create and delete audited');

      assert((await post('/companies', adminHeaders, { code: '', name: 'X' })).status === 400, 'Company code required');
      assert((await post('/companies', adminHeaders, { code: `pa${suffix}`.slice(0, 12), name: 'Phase A Pharma' })).status === 200, 'Company created');
    });

    await test('Restore: newer backups refused, older ones upgraded, live connections read the restored data', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacare-phasea-'));
      const backup = await createBackup('manual', dir);
      assert(backup.success, 'Backup made');
      const marker = await prisma.company.create({ data: { code: `MK${suffix}`.slice(0, 12), name: 'Made after the backup', status: 'active' } });

      // Newer version: refused before anything is touched
      const newer = path.join(dir, 'newer.db');
      fs.copyFileSync(backup.filepath, newer);
      const n = new Database(newer);
      n.prepare("UPDATE system_settings SET value = '99.0.0' WHERE key = 'app_version'").run();
      n.close();
      const refused = await post('/utilities/restore', devHeaders, { backupFilePath: newer });
      assert(refused.status === 400 && /newer version/.test(refused.body.error), `Newer refused ${refused.status} ${JSON.stringify(refused.body)}`);
      assert(!!(await prisma.company.findUnique({ where: { id: marker.id } })), 'Nothing changed');

      // Older backup without a recent column: restored, then upgraded
      const older = path.join(dir, 'older.db');
      fs.copyFileSync(backup.filepath, older);
      const o = new Database(older);
      o.exec('ALTER TABLE sales DROP COLUMN terminal_name');
      o.prepare("DELETE FROM system_settings WHERE key = 'app_version'").run();
      o.close();
      const restored = await post('/utilities/restore', authHeaders(developer), { backupFilePath: older });
      assert(restored.status === 200, `Restore ${restored.status} ${JSON.stringify(restored.body)}`);
      assert(!(await prisma.company.findUnique({ where: { id: marker.id } })), 'Prisma reads the restored data');
      const raw = db.prepare('SELECT COUNT(*) AS c FROM companies WHERE id = ?').get(marker.id) as { c: number };
      assert(raw.c === 0, 'Raw SQL reads the restored data');
      const columns = (db.prepare('PRAGMA table_info(sales)').all() as Array<{ name: string }>).map(c => c.name);
      assert(columns.includes('terminal_name'), 'Missing column added back');
      const stamp = db.prepare("SELECT value FROM system_settings WHERE key = 'app_version'").get() as { value: string } | undefined;
      assert(!!stamp?.value, 'Version stamped again');
      assert((await request('/products', authHeaders(admin))).status === 200, 'The app keeps working');
      fs.rmSync(dir, { recursive: true, force: true });
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nPhase A: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runPhaseATests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
