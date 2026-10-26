/**
 * PharmaCare Pro - M8 Test Suite (docs/FEATURE_ROADMAP.md)
 * Covers shop expenses and the day close: cash expenses lower the shift's expected cash, a closed shift keeps
 * its expenses fixed, validation and permissions, cashiers see only their own expenses, the day-close figures
 * and the closed-day lock. The pure maths is in server/dayClose/dayCloseMath.spec.ts and shiftTotals.spec.ts.
 * Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import http from 'http';
import { app } from '../api';
import { authHeaders, ensureTestAdmin, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { localDateString } from '../../shared/dates';
import { runAutoDayClose } from '../dayClose/autoClose';

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

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

async function runM8Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M8 Test Suite (expenses and day close)      ')));
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
    data: { username: `m8_cashier_${suffix}`, password: 'x', fullName: 'M8 Cashier', role: 'cashier', status: 'active' }
  });
  const cashierHeaders = authHeaders(cashier);
  const viewerRole = await prisma.role.create({ data: { name: `m8_viewer_${suffix}`, displayName: 'M8 Viewer', permissions: JSON.stringify({ pos: true, expenses: true }) } });
  const viewer = await prisma.user.create({ data: { username: `m8_viewer_${suffix}`, password: 'x', fullName: 'M8 Viewer', role: viewerRole.name, status: 'active' } });

  await prisma.cashierShift.updateMany({ where: { userId: { in: [admin.id, cashier.id] }, status: 'open' }, data: { status: 'closed' } });
  const shift = await prisma.cashierShift.create({
    data: { shiftNo: `SH-M8-${suffix}`, userId: cashier.id, userName: cashier.fullName, startTime: new Date(), openingCash: 1000, status: 'open' }
  });
  const expectedCash = async () => (await request(`/shifts/${shift.id}/summary`, cashierHeaders)).body.summary.expected_cash as number;

  let cashExpenseId = 0;

  try {
    await test('A cash expense lowers the open shift\'s expected cash; a bank expense does not', async () => {
      const before = await expectedCash();
      const cash = await post('/expenses', cashierHeaders, { category: 'Tea & Refreshments', amount: 150, payment_method: 'cash' });
      assert(cash.status === 200, `Cash expense ${cash.status} ${JSON.stringify(cash.body)}`);
      assert(cash.body.shift_id === shift.id, `Linked to the shift, got ${cash.body.shift_id}`);
      cashExpenseId = cash.body.id;
      assert(near(await expectedCash(), before - 150), `Expected cash ${before} → ${await expectedCash()}`);

      const bank = await post('/expenses', cashierHeaders, { category: 'Electricity', amount: 900, payment_method: 'bank' });
      assert(bank.status === 200 && bank.body.shift_id === null, `Bank expense not linked: ${JSON.stringify(bank.body)}`);
      assert(near(await expectedCash(), before - 150), 'Bank expense leaves the drawer alone');

      const summary = (await request(`/shifts/${shift.id}/summary`, cashierHeaders)).body.summary;
      assert(near(summary.total_expenses_cash, 150), `Summary cash expenses ${summary.total_expenses_cash}`);
    });

    await test('Validation and permission: amount, future date, missing permission', async () => {
      assert((await post('/expenses', cashierHeaders, { category: 'Rent', amount: 0 })).status === 400, 'Zero amount refused');
      assert((await post('/expenses', cashierHeaders, { category: 'Rent', amount: -5 })).status === 400, 'Negative amount refused');
      assert((await post('/expenses', cashierHeaders, { category: '', amount: 5 })).status === 400, 'Blank category refused');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const future = await post('/expenses', cashierHeaders, { category: 'Rent', amount: 5, expense_date: localDateString(tomorrow) });
      assert(future.status === 400, `Future date refused, got ${future.status}`);
      assert((await post('/expenses', authHeaders(viewer), { category: 'Rent', amount: 5 })).status === 403, 'No can_add_expense → 403');
      assert((await request('/expenses', authHeaders(viewer))).status === 200, 'Viewing needs only the module');
    });

    await test('A cashier sees only their own expenses; the Admin sees everyone\'s', async () => {
      const own = await post('/expenses', adminHeaders, { category: 'Repairs', amount: 40, payment_method: 'online' });
      assert(own.status === 200, `Admin expense ${own.status}`);
      const mine = await request('/expenses', cashierHeaders);
      assert(mine.status === 200 && mine.body.sees_all === false, `Cashier list ${mine.status}`);
      assert(mine.body.expenses.every((e: any) => e.user_id === cashier.id), 'Only the cashier\'s rows');
      const all = await request('/expenses', adminHeaders);
      assert(all.body.sees_all === true && all.body.expenses.some((e: any) => e.user_id === cashier.id) && all.body.expenses.some((e: any) => e.id === own.body.id), 'Admin sees all');
      assert((await del(`/expenses/${own.body.id}`, cashierHeaders)).status === 403, 'Cashier cannot delete the Admin\'s expense');
    });

    await test('A closed shift keeps its cash expenses fixed', async () => {
      const close = await post(`/shifts/${shift.id}/close`, cashierHeaders, { actual_cash: 850 });
      assert(close.status === 200, `Shift close ${close.status} ${JSON.stringify(close.body)}`);
      const saved = await prisma.cashierShift.findUniqueOrThrow({ where: { id: shift.id } });
      assert(near(saved.totalExpensesCash, 150), `Saved cash expenses ${saved.totalExpensesCash}`);
      assert(near(saved.expectedCash ?? 0, 850) && near(saved.cashDifference ?? 1, 0), `Expected ${saved.expectedCash}, difference ${saved.cashDifference}`);

      const edit = await put(`/expenses/${cashExpenseId}`, cashierHeaders, { category: 'Tea & Refreshments', amount: 10, payment_method: 'cash' });
      assert(edit.status === 409, `Edit after close refused, got ${edit.status}`);
      assert((await del(`/expenses/${cashExpenseId}`, adminHeaders)).status === 409, 'Delete after close refused');
      const listed = (await request('/expenses', cashierHeaders)).body.expenses.find((e: any) => e.id === cashExpenseId);
      assert(listed?.locked_reason, 'The list says why it is locked');
    });

    await test('Day close adds up sales, returns, cost of goods and expenses', async () => {
      const before = (await request(`/day-close?date=${today}`, adminHeaders)).body.figures;

      await prisma.cashierShift.create({
        data: { shiftNo: `SH-M8A-${suffix}`, userId: admin.id, userName: admin.fullName, startTime: new Date(), openingCash: 0, status: 'open' }
      });
      const company = await prisma.company.create({ data: { code: `M8${suffix}`.toUpperCase(), name: `M8 Pharma ${suffix}` } });
      const product = await post('/products', adminHeaders, {
        company_id: company.id, c_code: company.code, p_code: `M8-${suffix}`, name: `M8 Med ${suffix}`,
        unit_type: 'Tablets', packing: 10, box_trade_price: 100, box_retail_price: 150, unit_retail_price: 15, stock_boxes: 5
      });
      assert(product.status === 200, `Product ${product.status} ${JSON.stringify(product.body)}`);
      const sale = await post('/sales', adminHeaders, { items: [{ product_id: product.body.id, quantity: 2 }], payment_type: 'Cash' });
      assert(sale.status === 200, `Sale ${sale.status} ${JSON.stringify(sale.body)}`);
      const saleId = sale.body.sale?.id ?? sale.body.id;
      const unitCost = (await prisma.saleItem.findFirstOrThrow({ where: { saleId } })).unitCost;
      const ret = await post('/sales/return', adminHeaders, { sale_id: saleId, return_items: [{ product_id: product.body.id, quantity: 1 }] });
      assert(ret.status === 200, `Return ${ret.status} ${JSON.stringify(ret.body)}`);
      const exp = await post('/expenses', adminHeaders, { category: 'Transport', amount: 25, payment_method: 'cash' });
      assert(exp.status === 200, `Expense ${exp.status}`);

      const res = await request(`/day-close?date=${today}`, adminHeaders);
      assert(res.status === 200, `Day close ${res.status}`);
      const after = res.body.figures;
      assert(near(after.sales_total - before.sales_total, 300), `Sales +300, got ${after.sales_total - before.sales_total}`);
      assert(near(after.sales_cash - before.sales_cash, 300), 'Cash sales +300');
      assert(near(after.returns_total - before.returns_total, 150), `Returns +150, got ${after.returns_total - before.returns_total}`);
      assert(near(after.cost_of_goods - before.cost_of_goods, unitCost), `Cost +${unitCost}, got ${after.cost_of_goods - before.cost_of_goods}`);
      assert(near(after.expenses_total - before.expenses_total, 25), 'Expenses +25');
      assert(near(after.net_profit - before.net_profit, 300 - 150 - unitCost - 25), `Net profit change ${after.net_profit - before.net_profit}`);
      assert(near(after.net_profit, after.gross_profit - after.expenses_total), 'Net = gross − expenses');
      assert(res.body.open_shifts.length >= 1 && res.body.closing === null, 'Open shift warning, not closed yet');
    });

    await test('Closing the day locks its expenses until it is reopened', async () => {
      assert((await post('/day-close', cashierHeaders, { date: today })).status === 403, 'Cashier cannot close the day');
      assert((await request(`/day-close?date=${today}`, cashierHeaders)).status === 403, 'Cashier cannot see the profit');

      const live = (await request(`/day-close?date=${today}`, adminHeaders)).body.figures;
      const close = await post('/day-close', adminHeaders, { date: today, notes: 'All good' });
      assert(close.status === 200, `Close ${close.status} ${JSON.stringify(close.body)}`);
      const row = await prisma.dailyClosing.findUniqueOrThrow({ where: { closingDate: today } });
      assert(row.isClosed === 1 && near(row.netProfit, live.net_profit) && near(row.expensesTotal, live.expenses_total), `Saved row ${JSON.stringify(row)}`);
      assert(row.openShiftsAtClose >= 1, 'Open shifts noted');
      assert((await post('/day-close', adminHeaders, { date: today })).status === 409, 'Closing twice refused');

      const add = await post('/expenses', adminHeaders, { category: 'Rent', amount: 5, payment_method: 'bank' });
      assert(add.status === 409, `Add on a closed day refused, got ${add.status}`);
      const someExpense = await prisma.expense.findFirstOrThrow({ where: { expenseDate: today, paymentMethod: 'bank' } });
      assert((await put(`/expenses/${someExpense.id}`, adminHeaders, { category: 'Rent', amount: 1, payment_method: 'bank' })).status === 409, 'Edit refused');
      assert((await del(`/expenses/${someExpense.id}`, adminHeaders)).status === 409, 'Delete refused');

      assert((await post(`/day-close/${today}/reopen`, cashierHeaders, {})).status === 403, 'Cashier cannot reopen');
      assert((await post(`/day-close/${today}/reopen`, adminHeaders, {})).status === 200, 'Admin reopens');
      assert((await post(`/day-close/${today}/reopen`, adminHeaders, {})).status === 409, 'Reopening an open day refused');
      assert((await post('/expenses', adminHeaders, { category: 'Rent', amount: 5, payment_method: 'bank' })).status === 200, 'Adding works again');

      const history = await request('/day-close/history', adminHeaders);
      assert(history.status === 200 && history.body.some((h: any) => h.date === today && h.is_closed === false), 'History lists the day');
      const audit = await prisma.auditLog.count({ where: { action: { in: ['DAY_CLOSED', 'DAY_REOPENED'] } } });
      assert(audit >= 2, 'Close and reopen are audit-logged');
    });

    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = localDateString(yesterdayDate);

    await test('After midnight, finished days close on their own; today and switched-off runs are left alone', async () => {
      await prisma.expense.create({
        data: { category: 'Electricity', amount: 700, paymentMethod: 'bank', expenseDate: yesterday, userId: admin.id, userName: admin.fullName }
      });
      await prisma.systemSetting.upsert({ where: { key: 'auto_day_close' }, update: { value: 'false' }, create: { key: 'auto_day_close', value: 'false' } });
      assert((await runAutoDayClose(new Date())).length === 0, 'Switched off: nothing closes');

      await prisma.systemSetting.update({ where: { key: 'auto_day_close' }, data: { value: 'true' } });
      const closed = await runAutoDayClose(new Date());
      assert(closed.includes(yesterday) && !closed.includes(today), `Closed ${closed.join(', ')}`);
      const row = await prisma.dailyClosing.findUniqueOrThrow({ where: { closingDate: yesterday } });
      assert(row.isClosed === 1 && row.autoClosed === 1 && row.userName === 'Automatic' && row.userId === null, `Row ${JSON.stringify(row)}`);
      assert(near(row.expensesTotal, 700), `Expenses saved ${row.expensesTotal}`);
      const todayRow = await prisma.dailyClosing.findUnique({ where: { closingDate: today } });
      assert(todayRow?.isClosed !== 1, 'Today stays open');
      assert((await post('/expenses', adminHeaders, { category: 'Rent', amount: 5, expense_date: yesterday })).status === 409, 'Yesterday is locked');

      assert((await runAutoDayClose(new Date())).length === 0, 'A second run changes nothing');
      const audit = await prisma.auditLog.count({ where: { action: 'DAY_AUTO_CLOSED' } });
      assert(audit >= 1, 'Audit-logged');

      assert((await post(`/day-close/${yesterday}/reopen`, adminHeaders, {})).status === 200, 'Admin reopens yesterday');
      assert((await runAutoDayClose(new Date())).includes(yesterday), 'A reopened day closes again on the next run');
      const day = (await request(`/day-close?date=${yesterday}`, adminHeaders)).body;
      assert(day.closing?.auto_closed === true, 'The report says it closed automatically');
    });

    await test('Range report: totals equal the sum of the days, with each day\'s close status', async () => {
      const res = await request(`/day-close/range?from=${yesterday}&to=${today}`, adminHeaders);
      assert(res.status === 200, `Range ${res.status} ${JSON.stringify(res.body)}`);
      const { totals, days } = res.body;
      const dates = days.map((d: any) => d.date);
      assert(dates[0] === today && dates.includes(yesterday), `Days newest first: ${dates.join(', ')}`);
      const sum = (key: string) => days.reduce((s: number, d: any) => s + d[key], 0);
      assert(near(totals.net_profit, sum('net_profit')), `Net profit ${totals.net_profit} vs ${sum('net_profit')}`);
      assert(near(totals.expenses_total, sum('expenses_total')), 'Expenses add up');
      assert(near(totals.net_sales, sum('net_sales')), 'Net sales add up');
      const y = days.find((d: any) => d.date === yesterday);
      assert(y.closing?.is_closed === true && y.closing?.auto_closed === true, `Yesterday status ${JSON.stringify(y.closing)}`);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      assert((await request(`/day-close/range?from=${today}&to=${yesterday}`, adminHeaders)).status === 400, 'From after To refused');
      assert((await request(`/day-close/range?from=${today}&to=${localDateString(tomorrow)}`, adminHeaders)).status === 400, 'Future To refused');
      assert((await request(`/day-close/range?from=2020-01-01&to=${today}`, adminHeaders)).status === 400, 'Over 366 days refused');
      assert((await request(`/day-close/range?from=${yesterday}&to=${today}`, cashierHeaders)).status === 403, 'Cashier refused');
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM8: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM8Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
