/**
 * PharmaCare Pro - M11 Test Suite (docs/FEATURE_ROADMAP.md, docs/MULTI_PC_LAN_MODE.md)
 * Covers multi-PC LAN mode on the API: counters must be paired (one-time code, key), routes that stay on the main
 * computer, version check, removing a counter, one sign-in per cashier, shifts bound to their counter, retried
 * sales saved once, the last unit sold once, and changing this computer's LAN role.
 * Counter requests are simulated with "x-test-remote: 1" (honoured only under TEST_MODE). The two-PC parts
 * (certificate pinning, tray, firewall) need real machines: see docs/LAN_SETUP_GUIDE.md.
 * Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';
import { app } from '../api';
import { authHeaders, ensureTestAdmin, ensureTestDeveloper, TEST_ADMIN, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { DATA_DIR } from '../database/paths';
import { hashPassword } from '../security/passwords';
import { lanConfigPath, readLanConfig } from '../lan/lanConfig';

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

/** Headers of a counter PC (its main process adds the key; the version matches the test server) */
const counter = (key: string, extra: Record<string, string> = {}) => ({ 'x-test-remote': '1', 'x-terminal-key': key, 'x-app-version': '0.0.0-dev', ...extra });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function runM11Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M11 Test Suite (multi-PC LAN mode)           ')));
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
  const cashierPassword = 'counter-pass-1';
  const cashier = await prisma.user.create({
    data: { username: `m11_cashier_${suffix}`, password: await hashPassword(cashierPassword), fullName: 'M11 Cashier', role: 'cashier', status: 'active' }
  });
  const remote = { 'x-test-remote': '1' };

  const pair = async (name: string) => {
    const code = await post('/lan/pairing-code', adminHeaders, {});
    assert(code.status === 200 && /^\d{6}$/.test(code.body.code), `Code ${code.status} ${JSON.stringify(code.body)}`);
    const res = await post('/lan/pair', remote, { code: code.body.code, name, version: '0.0.0-dev' });
    assert(res.status === 200 && typeof res.body.key === 'string', `Pair ${res.status} ${JSON.stringify(res.body)}`);
    return { key: res.body.key as string, id: res.body.terminal_id as number, code: code.body.code as string };
  };
  const login = async (headers: Record<string, string>, username: string, password: string) => {
    const res = await post('/auth/login', headers, { username, password });
    assert(res.status === 200, `Login ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.token as string;
  };

  let counterA = { key: '', id: 0, code: '' };
  let counterB = { key: '', id: 0, code: '' };

  try {
    await test('Off until the Developer turns on several computers', async () => {
      const status = await request('/lan/status', adminHeaders);
      assert(status.status === 403 && status.body.code === 'LAN_OFF', `Status ${status.status} ${JSON.stringify(status.body)}`);
      assert((await post('/lan/pairing-code', adminHeaders, {})).status === 403, 'No pairing code while off');
      assert((await post('/lan/pair', remote, { code: '123456', name: 'Early', version: '0.0.0-dev' })).status === 403, 'No pairing while off');
      assert((await put('/lan/mode', developerHeaders, { mode: 'server' })).status === 200, 'Developer turns it on');
      assert((await request('/lan/status', adminHeaders)).status === 200, 'Admin sees the counters now');
    });

    await test('An unpaired computer sees only the health check and pairing', async () => {
      const health = await request('/lan/health', remote);
      assert(health.status === 200 && health.body.version === '0.0.0-dev' && health.body.paired === false, `Health ${JSON.stringify(health.body)}`);
      assert((await request('/settings', remote)).status === 401, 'Settings refused');
      assert((await post('/auth/login', remote, TEST_ADMIN)).status === 401, 'Login refused');
      const fake = await request('/settings', counter('not-a-real-key-at-all-123456'));
      assert(fake.status === 401 && fake.body.code === 'TERMINAL_NOT_PAIRED', 'Unknown key refused');
    });

    await test('Pairing: code made on the main computer, used once', async () => {
      assert((await post('/lan/pairing-code', authHeaders(cashier), {})).status === 403, 'Cashier cannot make a code');
      counterA = await pair('Counter A');
      const again = await post('/lan/pair', remote, { code: counterA.code, name: 'Counter X', version: '0.0.0-dev' });
      assert(again.status === 401, `Code used twice: ${again.status}`);
      assert((await post('/lan/pair', remote, { code: '12', name: 'Bad' })).status === 400, 'Bad code format');
      counterB = await pair('Counter B');
      const health = await request('/lan/health', counter(counterA.key));
      assert(health.body.paired === true, 'Health knows the paired key');
      assert((await post('/lan/pairing-code', counter(counterA.key, bearer(await login(counter(counterA.key), TEST_ADMIN.username, TEST_ADMIN.password))), {})).status === 403,
        'Pairing codes only on the main computer');
      const status = await request('/lan/status', adminHeaders);
      assert(status.status === 200 && status.body.terminals.some((t: any) => t.name === 'Counter A' && t.online) && status.body.terminals.some((t: any) => t.is_server),
        `Status ${JSON.stringify(status.body.terminals)}`);
    });

    await test('A paired counter works, but Developer, setup, restore and LAN set-up stay on the main computer', async () => {
      const token = await login(counter(counterA.key), cashier.username, cashierPassword);
      assert((await request('/products', counter(counterA.key, bearer(token)))).status === 200, 'Medicines load on the counter');
      assert((await post('/auth/developer-login', counter(counterA.key), { email: 'x', code: '123456' })).status === 403, 'Developer sign-in refused');
      assert((await request('/setup/status', counter(counterA.key))).status === 403, 'Setup refused');
      assert((await post('/utilities/restore', counter(counterA.key, adminHeaders), { backupFilePath: 'x' })).status === 403, 'Restore refused');
      assert((await put('/lan/mode', counter(counterA.key, developerHeaders), { mode: 'server' })).status === 403, 'Mode refused');
      const old = await request('/settings', counter(counterA.key, { 'x-app-version': '0.0.1' }));
      assert(old.status === 426 && old.body.code === 'VERSION_MISMATCH', `Version mismatch ${old.status}`);
      const before = (await prisma.systemSetting.findUnique({ where: { key: 'auto_backup_dir' } }))?.value ?? null;
      await post('/settings', counter(counterA.key, adminHeaders), { auto_backup_dir: 'C:/evil' });
      assert(((await prisma.systemSetting.findUnique({ where: { key: 'auto_backup_dir' } }))?.value ?? null) === before, 'Backup folder unchanged from a counter');
    });

    await test('One sign-in per cashier; Admin may be on two computers', async () => {
      const onA = await login(counter(counterA.key), cashier.username, cashierPassword);
      const onB = await login(counter(counterB.key), cashier.username, cashierPassword);
      assert((await request('/products', counter(counterA.key, bearer(onA)))).status === 401, 'Counter A signed out');
      assert((await request('/products', counter(counterB.key, bearer(onB)))).status === 200, 'Counter B signed in');
      const adminA = await login(counter(counterA.key), TEST_ADMIN.username, TEST_ADMIN.password);
      await login(counter(counterB.key), TEST_ADMIN.username, TEST_ADMIN.password);
      assert((await request('/products', counter(counterA.key, bearer(adminA)))).status === 200, 'Admin still signed in on A');
    });

    const company = await prisma.company.create({ data: { code: `M11${suffix}`.toUpperCase(), name: `M11 Pharma ${suffix}` } });
    const product = await post('/products', adminHeaders, {
      company_id: company.id, c_code: company.code, p_code: `M11-${suffix}`, name: `M11 Med ${suffix}`,
      unit_type: 'Tablets', packing: 1, box_trade_price: 50, box_retail_price: 80, unit_retail_price: 80, stock_boxes: 6, allow_open_sale: 0
    });
    const productId = product.body.id as number;

    let tokenA = '';
    await test('A shift belongs to the counter it was opened on', async () => {
      tokenA = await login(counter(counterA.key), cashier.username, cashierPassword);
      const shift = await post('/shifts/start', counter(counterA.key, bearer(tokenA)), { opening_cash: 500 });
      assert(shift.status === 200, `Shift ${shift.status} ${JSON.stringify(shift.body)}`);
      const saved = await prisma.cashierShift.findFirstOrThrow({ where: { userId: cashier.id, status: 'open' } });
      assert(saved.terminalName === 'Counter A', `Shift terminal ${saved.terminalName}`);

      const sale = await post('/sales', counter(counterA.key, bearer(tokenA)), { payment_type: 'Cash', items: [{ product_id: productId, quantity: 1 }] });
      assert(sale.status === 200 && sale.body.sale.terminal_name === 'Counter A', `Sale on A ${sale.status} ${JSON.stringify(sale.body.sale?.terminal_name)}`);

      const tokenB = await login(counter(counterB.key), cashier.username, cashierPassword);
      const fromB = await post('/sales', counter(counterB.key, bearer(tokenB)), { payment_type: 'Cash', items: [{ product_id: productId, quantity: 1 }] });
      assert(fromB.status === 403 && fromB.body.code === 'SHIFT_ON_OTHER_COUNTER' && /Counter A/.test(fromB.body.error), `From B ${fromB.status} ${JSON.stringify(fromB.body)}`);
      const fromMain = await post('/sales', authHeaders(cashier), { payment_type: 'Cash', items: [{ product_id: productId, quantity: 1 }] });
      assert(fromMain.status === 403, `From the main computer ${fromMain.status}`);
      const ret = await post('/sales/return', counter(counterB.key, bearer(tokenB)), { sale_id: sale.body.sale.id, return_items: [{ product_id: productId, quantity: 1 }] });
      assert(ret.status === 403, `Return from B ${ret.status}`);
      tokenA = await login(counter(counterA.key), cashier.username, cashierPassword);
    });

    await test('A retried bill is saved once', async () => {
      const requestId = crypto.randomUUID();
      const before = (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockBoxes;
      const body = { payment_type: 'Cash', client_request_id: requestId, items: [{ product_id: productId, quantity: 1 }] };
      const first = await post('/sales', counter(counterA.key, bearer(tokenA)), body);
      const second = await post('/sales', counter(counterA.key, bearer(tokenA)), body);
      assert(first.status === 200 && second.status === 200 && second.body.duplicate === true, `Retry ${second.status} ${JSON.stringify(second.body)}`);
      assert(first.body.sale.invoice_no === second.body.sale.invoice_no, 'Same invoice');
      assert((await prisma.sale.count({ where: { clientRequestId: requestId } })) === 1, 'One sale row');
      assert((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockBoxes === before - 1, 'Stock taken once');
    });

    await test('Two counters selling the last unit: exactly one sale', async () => {
      await prisma.product.update({ where: { id: productId }, data: { stockBoxes: 1, stockLoose: 0 } });
      await prisma.$transaction(async tx => {
        const { syncProductBatches } = await import('../stock/batchStock');
        await syncProductBatches(tx, productId);
      });
      const admin2 = await login(counter(counterB.key), TEST_ADMIN.username, TEST_ADMIN.password);
      await post('/shifts/start', counter(counterB.key, bearer(admin2)), { opening_cash: 0 });
      const results = await Promise.all([
        post('/sales', counter(counterA.key, bearer(tokenA)), { payment_type: 'Cash', items: [{ product_id: productId, quantity: 1 }] }),
        post('/sales', counter(counterB.key, bearer(admin2)), { payment_type: 'Cash', items: [{ product_id: productId, quantity: 1 }] })
      ]);
      const ok = results.filter(r => r.status === 200).length;
      const refused = results.filter(r => r.status === 400 && /stock/i.test(r.body.error)).length;
      assert(ok === 1 && refused === 1, `Results ${results.map(r => `${r.status} ${r.body.error ?? ''}`).join(' | ')}`);
      const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
      assert(p.stockBoxes === 0 && p.stockLoose === 0, 'Stock at zero');
    });

    await test('Removing a counter stops it at once and signs its users out', async () => {
      assert((await post(`/lan/terminals/${counterB.id}/revoke`, authHeaders(cashier), {})).status === 403, 'Cashier cannot remove counters');
      const tokenB = await login(counter(counterB.key), TEST_ADMIN.username, TEST_ADMIN.password);
      assert((await post(`/lan/terminals/${counterB.id}/revoke`, adminHeaders, {})).status === 200, 'Removed');
      assert((await request('/settings', counter(counterB.key))).status === 401, 'Key refused');
      assert((await request('/products', bearer(tokenB))).status === 401, 'Its session ended');
      assert((await put(`/lan/terminals/${counterA.id}`, adminHeaders, { name: 'Front Counter' })).status === 200, 'Renamed');
      assert(!!(await prisma.auditLog.findFirst({ where: { action: 'TERMINAL_REVOKED' } })), 'Audit row');
    });

    await test("Developer sets this computer's role on the main computer only", async () => {
      assert((await put('/lan/mode', adminHeaders, { mode: 'server' })).status === 403, 'Admin cannot change the role');
      assert((await put('/lan/mode', developerHeaders, { mode: 'client' })).status === 400, 'Counter mode is set from the connection screen');
      const res = await put('/lan/mode', developerHeaders, { mode: 'server', port: 4600 });
      assert(res.status === 200 && res.body.restart_needed === true, `Mode ${res.status}`);
      assert(fs.existsSync(lanConfigPath(DATA_DIR)), 'Config file written');
      const config = readLanConfig(DATA_DIR);
      assert(config.mode === 'server' && config.port === 4600, `Config ${JSON.stringify(config)}`);
      await put('/lan/mode', developerHeaders, { mode: 'standalone' });
      assert((await request('/lan/status', adminHeaders)).status === 403, 'Turned off again: counters hidden');
      await put('/lan/mode', developerHeaders, { mode: 'server' });
    });

    await test('Five wrong pairing codes lock that computer for a while', async () => {
      const code = (await post('/lan/pairing-code', adminHeaders, {})).body.code as string;
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await post('/lan/pair', remote, { code: wrong, name: 'Guess' });
      const locked = await post('/lan/pair', remote, { code, name: 'Guess' });
      assert(locked.status === 429, `Locked ${locked.status}`);
      assert(!!(await prisma.auditLog.findFirst({ where: { action: 'TERMINAL_PAIR', status: 'FAILED' } })), 'Failures logged');
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM11: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM11Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
