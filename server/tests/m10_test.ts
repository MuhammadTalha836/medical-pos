/**
 * PharmaCare Pro - M10 Test Suite (docs/FEATURE_ROADMAP.md)
 * Covers loyalty points and member plans: the Developer gate and the Admin switch, plans and templates, earning on
 * cash (and credit only when the plan allows), the member discount within the store maximum, redeeming with its
 * limits, returns taking points back and giving used points back, expiry, automatic upgrades, and manual changes.
 * The pure rules are in shared/loyalty.spec.ts. Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import http from 'http';
import { app } from '../api';
import { authHeaders, ensureTestAdmin, ensureTestDeveloper, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { localDateString } from '../../shared/dates';
import { expiryDate } from '../../shared/loyalty';

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

const pointsOf = async (customerId: number) => (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).loyaltyPoints;

async function runM10Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M10 Test Suite (loyalty points and plans)    ')));
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
  const developerHeaders = authHeaders(await ensureTestDeveloper());
  const cashier = await prisma.user.create({
    data: { username: `m10_cashier_${suffix}`, password: 'x', fullName: 'M10 Cashier', role: 'cashier', status: 'active' }
  });
  const cashierHeaders = authHeaders(cashier);
  for (const user of [admin, cashier]) {
    await prisma.cashierShift.create({
      data: { shiftNo: `SH-M10-${user.id}-${suffix}`, userId: user.id, userName: user.fullName, startTime: new Date(), openingCash: 0, status: 'open' }
    });
  }

  const company = await prisma.company.create({ data: { code: `M10${suffix}`.toUpperCase(), name: `M10 Pharma ${suffix}` } });
  const newProduct = async (code: string, boxRetail: number) => {
    const res = await post('/products', adminHeaders, {
      company_id: company.id, c_code: company.code, p_code: `M10-${code}-${suffix}`, name: `M10 ${code} ${suffix}`,
      unit_type: 'Tablets', packing: 10, box_trade_price: boxRetail * 0.7, box_retail_price: boxRetail, unit_retail_price: boxRetail / 10, stock_boxes: 200
    });
    assert(res.status === 200, `Product ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.id as number;
  };
  const med = await newProduct('MED', 1000);
  const cheap = await newProduct('CHEAP', 100);

  let phoneSeq = 1000000;
  const newCustomer = async (name: string) => {
    const res = await post('/customers', adminHeaders, { name: `${name} ${suffix}`, phone: `0300${String(phoneSeq++).padStart(7, '0')}` });
    assert(res.status === 200, `Customer ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.id as number;
  };
  const sell = (headers: Record<string, string>, body: Record<string, unknown>) =>
    post('/sales', headers, { payment_type: 'Cash', ...body });

  const custA = await newCustomer('Ali');
  let regularId = 0;
  let goldId = 0;

  try {
    await test('Gates: nothing works until the Developer allows it and the Admin switches it on', async () => {
      assert((await request('/loyalty/plans', adminHeaders)).status === 403, 'Plans hidden before the Developer allows it');
      assert((await post('/settings', adminHeaders, { loyalty_enabled: 'true' })).status === 400, 'Admin cannot switch it on yet');
      await post('/settings', adminHeaders, { loyalty_feature_allowed: 'true' });
      const stored = await prisma.systemSetting.findUnique({ where: { key: 'loyalty_feature_allowed' } });
      assert(stored?.value !== 'true', 'Admin cannot open the gate');

      const before = await sell(cashierHeaders, { customer_id: custA, items: [{ product_id: med, quantity: 1 }] });
      assert(before.status === 200 && before.body.sale.points_earned === 0, `No points while off ${JSON.stringify(before.body.sale?.points_earned)}`);
      assert((await sell(cashierHeaders, { customer_id: custA, redeem_points: 50, items: [{ product_id: med, quantity: 1 }] })).status === 400, 'No redeeming while off');

      assert((await put('/developer/settings', developerHeaders, { loyalty_feature_allowed: 'maybe' })).status === 400, 'Gate takes true/false only');
      assert((await put('/developer/settings', developerHeaders, { loyalty_feature_allowed: 'true' })).status === 200, 'Developer opens the gate');
      assert((await post('/settings', cashierHeaders, { loyalty_enabled: 'true' })).status === 403, 'Cashier has no settings permission');
      assert((await post('/settings', adminHeaders, { loyalty_enabled: 'true' })).status === 200, 'Admin switches it on');
    });

    await test('Plans: create, templates, one default, permissions', async () => {
      assert((await request('/loyalty/plans', cashierHeaders)).status === 403, 'Cashier cannot manage plans');
      const templates = await request('/loyalty/templates', adminHeaders);
      assert(templates.status === 200 && templates.body.length === 4, `Templates ${templates.body.length}`);

      const regular = await post('/loyalty/plans', adminHeaders, {
        name: 'Regular', points_per_100: 1, point_value: 1, min_bill_to_earn: 100, min_redeem_points: 50, max_redeem_pct: 20, expiry_months: 12
      });
      assert(regular.status === 200 && regular.body.plan.is_default === true, `Regular ${JSON.stringify(regular.body)}`);
      regularId = regular.body.plan.id;
      const gold = await post('/loyalty/plans', adminHeaders, {
        name: 'Gold', points_per_100: 2, point_value: 1, min_bill_to_earn: 100, discount_pct: 5, min_redeem_points: 50, max_redeem_pct: 30, expiry_months: 12, upgrade_spend: 1_000_000
      });
      assert(gold.status === 200 && gold.body.plan.is_default === false, 'Gold is not the default');
      goldId = gold.body.plan.id;
      assert((await post('/loyalty/plans', adminHeaders, { name: 'gold', points_per_100: 1, point_value: 1 })).status === 409, 'Duplicate name');
      assert((await post('/loyalty/plans', adminHeaders, { name: 'Bad', points_per_100: 1, point_value: 0 })).status === 400, 'Point value 0 refused');

      const temp = await post('/loyalty/plans', adminHeaders, { name: 'Temp', points_per_100: 1, point_value: 1, is_default: true });
      assert((await request('/loyalty/plans', adminHeaders)).body.filter((p: any) => p.is_default).length === 1, 'One default');
      assert((await post(`/loyalty/plans/${temp.body.plan.id}/archive`, adminHeaders, {})).status === 409, 'Default cannot be archived');
      await put(`/loyalty/plans/${regularId}`, adminHeaders, { ...regular.body.plan, is_default: true });
      assert((await request('/loyalty/plans', adminHeaders)).body.find((p: any) => p.is_default).id === regularId, 'Regular is default again');
      assert((await request(`/loyalty/plans/${temp.body.plan.id}`, adminHeaders, { method: 'DELETE' })).status === 200, 'Unused plan deleted');
    });

    await test('Earning: cash sales earn by the plan, credit only when the plan allows it', async () => {
      const sale = await sell(cashierHeaders, { customer_id: custA, items: [{ product_id: med, quantity: 1 }] });
      assert(sale.status === 200, `Sale ${sale.status} ${JSON.stringify(sale.body)}`);
      assert(sale.body.sale.points_earned === 10 && sale.body.sale.points_balance === 10 && sale.body.sale.loyalty_plan_name === 'Regular', `Earned ${JSON.stringify(sale.body.sale)}`);
      const row = await prisma.loyaltyTransaction.findFirst({ where: { saleId: sale.body.sale.id, type: 'earn' } });
      assert(row?.points === 10 && row.expiresAt === expiryDate(localDateString(), 12), `Earn row ${JSON.stringify(row)}`);

      const credit = await sell(cashierHeaders, { customer_id: custA, payment_type: 'Credit', items: [{ product_id: med, quantity: 1 }] });
      assert(credit.status === 200 && credit.body.sale.points_earned === 0, 'Credit sale earns nothing on Regular');
      const small = await sell(cashierHeaders, { customer_id: custA, items: [{ product_id: cheap, quantity: 1 }] });
      assert(small.status === 200 && small.body.sale.points_earned === 1, `Rs 100 bill earns 1 (${small.body.sale?.points_earned})`);
      const big = await sell(cashierHeaders, { customer_id: custA, items: [{ product_id: med, quantity: 5 }] });
      assert(big.body.sale.points_earned === 50, 'Rs 5000 earns 50');
      assert((await pointsOf(custA)) === 61, `Balance ${await pointsOf(custA)}`);

      const search = await request(`/customers/search?q=Ali ${suffix}`, cashierHeaders);
      const found = search.body.find((c: any) => c.id === custA);
      assert(found?.loyalty_points === 61 && found.loyalty_plan?.name === 'Regular' && found.points_value === 61, `Search ${JSON.stringify(found)}`);
    });

    const custB = await newCustomer('Bilal');
    await test('Member discount: automatic, but within the store maximum with the bill discount', async () => {
      assert((await put(`/customers/${custB}/plan`, cashierHeaders, { plan_id: goldId })).status === 403, 'Cashier cannot change plans');
      assert((await put(`/customers/${custB}/plan`, adminHeaders, { plan_id: goldId })).status === 200, 'Admin puts Bilal on Gold');

      const sale = await sell(cashierHeaders, { customer_id: custB, items: [{ product_id: med, quantity: 1 }], net_total: 1 });
      assert(sale.status === 200, `Sale ${sale.status} ${JSON.stringify(sale.body)}`);
      const s = sale.body.sale;
      assert(s.member_discount_pct === 5 && s.member_discount_amt === 50 && s.net_total === 950, `Member discount ${JSON.stringify(s)}`);
      assert(s.points_earned === 19, `Gold earns 2 per 100 on 950 (${s.points_earned})`);

      const capped = await sell(adminHeaders, { customer_id: custB, bill_discount_pct: 12, items: [{ product_id: med, quantity: 1 }] });
      const c = capped.body.sale;
      assert(c.bill_discount_amt === 120 && c.member_discount_pct === 2 && c.member_discount_amt === 20 && c.net_total === 860, `Capped ${JSON.stringify(c)}`);
    });

    let redeemSaleId = 0;
    await test('Redeeming: limits checked on the server, bill and cash go down', async () => {
      assert((await sell(cashierHeaders, { customer_id: custA, redeem_points: 100, items: [{ product_id: med, quantity: 2 }] })).status === 400, 'More than the balance');
      assert((await sell(cashierHeaders, { customer_id: custA, redeem_points: 30, items: [{ product_id: med, quantity: 2 }] })).status === 400, 'Below the minimum');
      const pct = await sell(cashierHeaders, { customer_id: custA, redeem_points: 60, items: [{ product_id: cheap, quantity: 1 }] });
      assert(pct.status === 400 && /at most 20%/.test(pct.body.error), `Over 20% of the bill: ${JSON.stringify(pct.body)}`);
      assert((await sell(cashierHeaders, { redeem_points: 60, items: [{ product_id: med, quantity: 2 }] })).status === 400, 'No customer');
      assert((await pointsOf(custA)) === 61, 'Refused sales changed nothing');

      const sale = await sell(cashierHeaders, { customer_id: custA, redeem_points: 61, items: [{ product_id: med, quantity: 2 }], net_total: 5, total: 5 });
      assert(sale.status === 200, `Redeem ${sale.status} ${JSON.stringify(sale.body)}`);
      const s = sale.body.sale;
      assert(s.points_redeemed === 61 && s.points_redeemed_value === 61 && s.net_total === 1939 && s.cash_tendered === 1939, `Redeemed ${JSON.stringify(s)}`);
      assert(s.points_earned === 19 && s.points_balance === 19, `Earned on what was paid ${s.points_earned} / ${s.points_balance}`);
      redeemSaleId = s.id;
    });

    await test('Returns: earned points taken back and used points given back, in step', async () => {
      const first = await post('/sales/return', cashierHeaders, { sale_id: redeemSaleId, return_items: [{ product_id: med, quantity: 1 }] });
      assert(first.status === 200, `Return ${first.status} ${JSON.stringify(first.body)}`);
      // Half returned: 10 of 19 earned back out (rounded), 31 of 61 used given back (rounded)
      assert((await pointsOf(custA)) === 19 - 10 + 31, `After half ${await pointsOf(custA)}`);
      const second = await post('/sales/return', cashierHeaders, { sale_id: redeemSaleId, return_items: [{ product_id: med, quantity: 1 }] });
      assert(second.status === 200, `Second return ${second.status}`);
      assert((await pointsOf(custA)) === 61, `Full return restores the balance exactly (${await pointsOf(custA)})`);

      // Points already used elsewhere cannot be taken back: the balance stays at zero
      const custC = await newCustomer('Chand');
      const sale = await sell(cashierHeaders, { customer_id: custC, items: [{ product_id: med, quantity: 1 }] });
      assert((await post(`/customers/${custC}/loyalty/adjust`, adminHeaders, { points: -10, notes: 'Gift given' })).status === 200, 'Points spent');
      assert((await post('/sales/return', cashierHeaders, { sale_id: sale.body.sale.id, return_items: [{ product_id: med, quantity: 1 }] })).status === 200, 'Return');
      assert((await pointsOf(custC)) === 0, 'Never below zero');
      const row = await prisma.loyaltyTransaction.findFirst({ where: { customerId: custC, type: 'earn_reversed' } });
      assert(!!row?.notes?.includes('already used'), `Shortfall noted: ${row?.notes}`);
    });

    await test('Expiry: due points are written off, oldest first', async () => {
      const custD = await newCustomer('Dawood');
      await prisma.loyaltyTransaction.createMany({
        data: [
          { customerId: custD, type: 'adjust', points: 25, remaining: 25, expiresAt: '2020-01-01', notes: 'old' },
          { customerId: custD, type: 'adjust', points: 40, remaining: 40, expiresAt: '2099-01-01', notes: 'new' }
        ]
      });
      await prisma.customer.update({ where: { id: custD }, data: { loyaltyPoints: 65 } });
      const info = await request(`/customers/${custD}/loyalty`, cashierHeaders);
      assert(info.status === 200 && info.body.points === 40, `After expiry ${JSON.stringify(info.body.points)}`);
      assert(info.body.history.some((h: any) => h.type === 'expire' && h.points === -25), 'Expire row');
    });

    await test('Automatic upgrade: moves up after enough buying, never down', async () => {
      const gold = (await request('/loyalty/plans', adminHeaders)).body.find((p: any) => p.id === goldId);
      assert((await put(`/loyalty/plans/${goldId}`, adminHeaders, { ...gold, upgrade_spend: 3000 })).status === 200, 'Gold from Rs 3000');
      const sale = await sell(cashierHeaders, { customer_id: custA, items: [{ product_id: cheap, quantity: 1 }] });
      assert(sale.status === 200, 'Sale');
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: custA } });
      assert(customer.loyaltyPlanId === goldId, `Moved to Gold (${customer.loyaltyPlanId})`);
      assert(!!(await prisma.loyaltyTransaction.findFirst({ where: { customerId: custA, type: 'plan_change' } })), 'Plan change row');

      await post('/loyalty/plans', adminHeaders, { name: 'Silver', points_per_100: 1.5, point_value: 1, upgrade_spend: 1000 });
      await sell(cashierHeaders, { customer_id: custA, items: [{ product_id: cheap, quantity: 1 }] });
      assert((await prisma.customer.findUniqueOrThrow({ where: { id: custA } })).loyaltyPlanId === goldId, 'Not moved down to Silver');
    });

    await test('Manual points and plan changes need the loyalty permission and are logged', async () => {
      assert((await post(`/customers/${custA}/loyalty/adjust`, cashierHeaders, { points: 100, notes: 'Gift' })).status === 403, 'Cashier cannot adjust');
      const before = await pointsOf(custA);
      const add = await post(`/customers/${custA}/loyalty/adjust`, adminHeaders, { points: 100, notes: 'Eid gift' });
      assert(add.status === 200 && add.body.points === before + 100, `Added ${JSON.stringify(add.body)}`);
      assert((await post(`/customers/${custA}/loyalty/adjust`, adminHeaders, { points: -1_000_000, notes: 'Too many' })).status === 400, 'Cannot go below zero');
      assert((await post(`/customers/${custA}/loyalty/adjust`, adminHeaders, { points: 5, notes: '' })).status === 400, 'Reason required');
      assert(!!(await prisma.auditLog.findFirst({ where: { action: 'LOYALTY_POINTS_ADJUSTED' } })), 'Audit row');
      const members = await request(`/loyalty/members?plan_id=${goldId}`, adminHeaders);
      assert(members.status === 200 && members.body.members.some((m: any) => m.id === custA), 'Members list by plan');
      assert((await request('/loyalty/members', cashierHeaders)).status === 403, 'Cashier cannot list members');
      assert((await request(`/loyalty/plans/${goldId}`, adminHeaders, { method: 'DELETE' })).status === 409, 'A used plan cannot be deleted');
    });

    await test('Switched off again: points stay, nothing is earned or redeemed', async () => {
      assert((await put('/developer/settings', developerHeaders, { loyalty_feature_allowed: 'false' })).status === 200, 'Developer closes the gate');
      const before = await pointsOf(custA);
      const sale = await sell(cashierHeaders, { customer_id: custA, items: [{ product_id: med, quantity: 1 }] });
      assert(sale.status === 200 && sale.body.sale.points_earned === 0 && sale.body.sale.member_discount_amt === 0, 'No loyalty on the sale');
      assert((await pointsOf(custA)) === before, 'Points kept');
      assert((await request('/loyalty/plans', adminHeaders)).status === 403, 'Plans hidden');
      const found = (await request(`/customers/search?q=Ali ${suffix}`, cashierHeaders)).body.find((c: any) => c.id === custA);
      assert(found && found.loyalty_plan === undefined, 'POS gets no plan');
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM10: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM10Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
