/**
 * PharmaCare Pro - Phase 3 Test Suite
 * Covers:
 *  - TC-01: Only 58mm / 80mm thermal templates are accepted (A3/A4/A5 and sheet templates rejected)
 *  - TC-02: Admin template & roll-width selection persists in the database
 *  - Legacy invoice settings migration (A4 / 'thermal' -> 80mm / 'classic')
 *  - POST /api/settings authorization & developer-only key protection
 *  - Protected store identity: Admin cannot hide store name/address unless the Developer allows it
 *  - Developer invoice footer validation (length, multi-line)
 *  - Sale snapshot of store identity & footer for historical reprints
 *
 * Runs against the local database: every setting it touches is restored and every record it creates is deleted.
 */

process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import './testEnv';
import http from 'http';
import { app } from '../api';
import { authHeaders, adminAuthHeaders, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { hashPassword } from '../security/passwords';
import { migrateLegacyInvoiceSettings } from '../invoice/invoiceSettings';
import { FOOTER_MAX_LENGTH } from '../../shared/invoice';

const colors = {
  green: (t: string) => `\x1b[32m${t}\x1b[0m`,
  red: (t: string) => `\x1b[31m${t}\x1b[0m`,
  cyan: (t: string) => `\x1b[36m${t}\x1b[0m`,
  bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
};

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

let server: http.Server | undefined;
let baseUrl: string;

async function request(path: string, options?: RequestInit) {
  const auth = options?.headers && 'Authorization' in (options.headers as Record<string, string>) ? {} : await adminAuthHeaders();
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...auth,
      ...options?.headers,
    },
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  return { status: res.status, ok: res.ok, body: json };
}

// Settings keys this suite modifies; their original values are restored at the end
const TOUCHED_SETTING_KEYS = [
  'default_invoice_template',
  'invoice_paper_size',
  'paper_width',
  'show_store_name',
  'show_store_address',
  'store_name',
  'store_address',
  'developer_invoice_footer',
  'developer_email',
  'setup_completed',
  'allow_admin_edit_store_identity',
  'allow_admin_hide_store_identity'
];

async function getRawSetting(key: string): Promise<string | undefined> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value;
}

async function setRawSetting(key: string, value: string) {
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

async function runPhase3Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase 3 Test Suite                           ')));
  console.log(colors.bold(colors.cyan('  (Thermal Templates, Protected Store Identity, Footer, Snapshot)')));
  console.log(colors.bold(colors.cyan('================================================================\n')));

  // Always use an in-process server so the suite exercises the current code
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server!.address() as any;
      baseUrl = `http://localhost:${addr.port}/api`;
      resolve();
    });
  });
  await useFullTestLicense();
  console.log(`[Phase3 Test] Target API: ${baseUrl}\n`);

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

  // -------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------
  const originalSettings: Record<string, string | undefined> = {};
  for (const key of TOUCHED_SETTING_KEYS) {
    originalSettings[key] = await getRawSetting(key);
  }

  const createdUserIds: number[] = [];
  const createdSaleIds: number[] = [];
  let testShiftId: number | null = null;
  let stockProduct: { id: number; stockBoxes: number; stockLoose: number } | null = null;

  const hashedPw = await hashPassword('password123');
  const stamp = Date.now();

  let devUser = await prisma.user.findFirst({ where: { role: 'developer' } });
  if (!devUser) {
    devUser = await prisma.user.create({
      data: { username: `dev_p3_${stamp}`, password: hashedPw, fullName: 'Dev P3', role: 'developer', status: 'active', email: 'dev-p3@test.local' }
    });
    createdUserIds.push(devUser.id);
  }

  const adminUser = await prisma.user.create({
    data: { username: `admin_p3_${stamp}`, password: hashedPw, fullName: 'Admin P3', role: 'admin', status: 'active' }
  });
  createdUserIds.push(adminUser.id);

  const cashierUser = await prisma.user.create({
    data: { username: `cashier_p3_${stamp}`, password: hashedPw, fullName: 'Cashier P3', role: 'cashier', status: 'active' }
  });
  createdUserIds.push(cashierUser.id);

  const devHeaders = authHeaders(devUser);
  const adminHeaders = authHeaders(adminUser);
  const cashierHeaders = authHeaders(cashierUser);

  const postSettings = (headers: Record<string, string>, body: Record<string, unknown>) =>
    request('/settings', { method: 'POST', headers, body: JSON.stringify(body) });
  const putDeveloperSettings = (body: Record<string, unknown>) =>
    request('/developer/settings', { method: 'PUT', headers: devHeaders, body: JSON.stringify(body) });

  try {
    // Start from a known identity-lock state
    await putDeveloperSettings({ allow_admin_edit_store_identity: 'false', allow_admin_hide_store_identity: 'false' });

    // -------------------------------------------------------------
    // TC-01: Thermal-only templates
    // -------------------------------------------------------------
    for (const size of ['A3', 'A4', 'A5', '100mm']) {
      await test(`TC-01: POST /settings rejects paper size ${size} with 400`, async () => {
        const res = await postSettings(adminHeaders, { invoice_paper_size: size });
        assert(res.status === 400, `Expected 400, got ${res.status}`);
        assert((await getRawSetting('invoice_paper_size')) !== size, `${size} was persisted`);
      });
    }

    await test('TC-01: POST /settings rejects legacy paper_width A4 with 400', async () => {
      const res = await postSettings(adminHeaders, { paper_width: 'A4' });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    for (const template of ['standard', 'thermal', 'enterprise']) {
      await test(`TC-01: POST /settings rejects template "${template}" with 400`, async () => {
        const res = await postSettings(adminHeaders, { default_invoice_template: template });
        assert(res.status === 400, `Expected 400, got ${res.status}`);
      });
    }

    await test('TC-01: GET /settings only ever returns thermal values', async () => {
      await setRawSetting('default_invoice_template', 'standard');
      await setRawSetting('invoice_paper_size', 'A5');
      const res = await request('/settings');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(['classic', 'compact', 'detailed'].includes(res.body.default_invoice_template), `Got template ${res.body.default_invoice_template}`);
      assert(['58mm', '80mm'].includes(res.body.invoice_paper_size), `Got paper ${res.body.invoice_paper_size}`);
      assert(res.body.paper_width === res.body.invoice_paper_size, 'paper_width should mirror invoice_paper_size');
    });

    // -------------------------------------------------------------
    // Legacy migration
    // -------------------------------------------------------------
    await test('Migration: legacy A4 / thermal settings become 80mm / classic', async () => {
      await setRawSetting('default_invoice_template', 'thermal');
      await setRawSetting('invoice_paper_size', 'A4');
      await setRawSetting('paper_width', 'A4');
      await migrateLegacyInvoiceSettings(prisma);
      assert((await getRawSetting('default_invoice_template')) === 'classic', 'template not migrated to classic');
      assert((await getRawSetting('invoice_paper_size')) === '80mm', 'paper size not migrated to 80mm');
      assert((await getRawSetting('paper_width')) === '80mm', 'paper_width not migrated to 80mm');
    });

    await test('Migration: valid 58mm / detailed settings are left untouched', async () => {
      await setRawSetting('default_invoice_template', 'detailed');
      await setRawSetting('invoice_paper_size', '58mm');
      await setRawSetting('paper_width', '58mm');
      await migrateLegacyInvoiceSettings(prisma);
      assert((await getRawSetting('default_invoice_template')) === 'detailed', 'detailed template was changed');
      assert((await getRawSetting('invoice_paper_size')) === '58mm', '58mm paper size was changed');
    });

    // -------------------------------------------------------------
    // TC-02: Admin selection persists
    // -------------------------------------------------------------
    await test('TC-02: Admin saves compact + 58mm and it persists in the database', async () => {
      const res = await postSettings(adminHeaders, { default_invoice_template: 'compact', invoice_paper_size: '58mm' });
      assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

      const fetched = await request('/settings');
      assert(fetched.body.default_invoice_template === 'compact', 'GET did not return compact');
      assert(fetched.body.invoice_paper_size === '58mm', 'GET did not return 58mm');

      // Stored in SQLite, so the choice survives an application restart
      assert((await getRawSetting('default_invoice_template')) === 'compact', 'compact not stored');
      assert((await getRawSetting('invoice_paper_size')) === '58mm', '58mm not stored');
      assert((await getRawSetting('paper_width')) === '58mm', 'paper_width not mirrored');
    });

    // -------------------------------------------------------------
    // Authorization
    // -------------------------------------------------------------
    await test('Auth: unauthenticated POST /settings is rejected with 401', async () => {
      const res = await request('/settings', { method: 'POST', headers: { Authorization: '' }, body: JSON.stringify({ receipt_footer: 'hacked' }) });
      assert(res.status === 401, `Expected 401, got ${res.status}`);
    });

    await test('Auth: Cashier POST /settings is rejected with 403 and audited as FAILED', async () => {
      const before = new Date();
      const res = await postSettings(cashierHeaders, { default_invoice_template: 'detailed' });
      assert(res.status === 403, `Expected 403, got ${res.status}`);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'SETTINGS_UPDATE', status: 'FAILED', userId: cashierUser.id, createdAt: { gte: new Date(before.getTime() - 1000) } }
      });
      assert(!!audit, 'Expected a FAILED SETTINGS_UPDATE audit entry for the cashier');
      assert((await getRawSetting('default_invoice_template')) === 'compact', 'Cashier changed the template');
    });

    // -------------------------------------------------------------
    // Developer-only keys
    // -------------------------------------------------------------
    await test('Protected keys: Admin cannot change setup lock, developer email, footer or identity toggles', async () => {
      const before: Record<string, string | undefined> = {};
      const keys = ['setup_completed', 'developer_email', 'developer_invoice_footer', 'allow_admin_hide_store_identity', 'allow_admin_edit_store_identity'];
      for (const key of keys) before[key] = await getRawSetting(key);

      const res = await postSettings(adminHeaders, {
        setup_completed: 'false',
        developer_email: 'attacker@evil.local',
        developer_invoice_footer: 'Admin override footer',
        allow_admin_hide_store_identity: 'true',
        allow_admin_edit_store_identity: 'true'
      });
      assert(res.status === 200, `Expected 200 (keys silently stripped), got ${res.status}`);

      for (const key of keys) {
        assert((await getRawSetting(key)) === before[key], `${key} was modified by admin`);
      }
    });

    await test('Protected keys: even the Developer cannot reset setup_completed through /settings', async () => {
      const before = await getRawSetting('setup_completed');
      const res = await postSettings(devHeaders, { setup_completed: before === 'true' ? 'false' : 'true' });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert((await getRawSetting('setup_completed')) === before, 'setup_completed was modified');
    });

    await test('Privacy: GET /settings does not expose developer_email', async () => {
      const res = await request('/settings');
      assert(!('developer_email' in res.body), 'developer_email leaked in public settings');
    });

    // -------------------------------------------------------------
    // Protected store identity (hide lock)
    // -------------------------------------------------------------
    await test('Identity lock: Admin cannot hide store name/address while the lock is on', async () => {
      const res = await postSettings(adminHeaders, { show_store_name: 'false', show_store_address: 'false' });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const fetched = await request('/settings');
      assert(fetched.body.show_store_name === 'true', 'store name was hidden');
      assert(fetched.body.show_store_address === 'true', 'store address was hidden');
    });

    await test('Identity lock: stale stored "false" values are forced visible while the lock is on', async () => {
      await setRawSetting('show_store_name', 'false');
      await setRawSetting('show_store_address', 'false');
      const fetched = await request('/settings');
      assert(fetched.body.show_store_name === 'true', 'stale hidden store name was served');
      assert(fetched.body.show_store_address === 'true', 'stale hidden store address was served');
    });

    await test('Identity lock: Admin can hide store name once the Developer allows it', async () => {
      const enable = await putDeveloperSettings({ allow_admin_hide_store_identity: 'true' });
      assert(enable.status === 200, `Developer toggle failed: ${enable.status}`);

      const res = await postSettings(adminHeaders, { show_store_name: 'false', show_store_address: 'true' });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const fetched = await request('/settings');
      assert(fetched.body.show_store_name === 'false', 'store name could not be hidden with permission');

      await putDeveloperSettings({ allow_admin_hide_store_identity: 'false' });
      const relocked = await request('/settings');
      assert(relocked.body.show_store_name === 'true', 'store name stayed hidden after the lock was re-enabled');
    });

    await test('Identity lock: Admin cannot rename the store while edit is locked', async () => {
      const before = await getRawSetting('store_name');
      await postSettings(adminHeaders, { store_name: 'Renamed By Admin' });
      assert((await getRawSetting('store_name')) === before, 'store_name changed by admin');
    });

    // -------------------------------------------------------------
    // Developer footer validation
    // -------------------------------------------------------------
    await test(`Footer: Developer footer longer than ${FOOTER_MAX_LENGTH} characters is rejected with 400`, async () => {
      const res = await putDeveloperSettings({ developer_invoice_footer: 'x'.repeat(FOOTER_MAX_LENGTH + 1) });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test('Footer: empty footer and empty store name are rejected with 400', async () => {
      const footer = await putDeveloperSettings({ developer_invoice_footer: '   ' });
      assert(footer.status === 400, `Expected 400 for empty footer, got ${footer.status}`);
      const name = await putDeveloperSettings({ store_name: '' });
      assert(name.status === 400, `Expected 400 for empty store name, got ${name.status}`);
    });

    await test('Footer: invalid toggle value is rejected with 400', async () => {
      const res = await putDeveloperSettings({ allow_admin_hide_store_identity: 'yes' });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test('Footer: multi-line 300-character footer is saved and served to receipts', async () => {
      const footer = `Line one: PharmaCare Pro support\n${'Long-unbroken-text-'.repeat(15)}`.slice(0, 300);
      const res = await putDeveloperSettings({ developer_invoice_footer: footer });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const fetched = await request('/settings');
      assert(fetched.body.developer_invoice_footer === footer.trim(), 'footer not served by GET /settings');
      assert(fetched.body.developer_invoice_footer.includes('\n'), 'line break was not preserved');
    });

    // -------------------------------------------------------------
    // Sale snapshot of store identity & footer
    // -------------------------------------------------------------
    const product = await prisma.product.findFirst({ where: { status: 'active', stockBoxes: { gte: 2 } } });
    if (product) {
      stockProduct = { id: product.id, stockBoxes: product.stockBoxes, stockLoose: product.stockLoose };
      const shift = await prisma.cashierShift.create({
        data: { shiftNo: `P3-TEST-${stamp}`, userId: adminUser.id, userName: adminUser.fullName, startTime: new Date(), openingCash: 0, status: 'open' }
      });
      testShiftId = shift.id;

      const createSale = async () => {
        const res = await request('/sales', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: 'Phase 3 Snapshot Test',
            payment_type: 'Cash',
            user_id: adminUser.id,
            user_name: adminUser.fullName,
            shift_id: shift.id,
            items: [{ product_id: product.id, is_loose: 0, quantity: 1, unit_price: product.boxRetailPrice, discount_pct: 0 }]
          })
        });
        assert(res.status === 200, `Sale creation failed: ${res.status} ${JSON.stringify(res.body)}`);
        createdSaleIds.push(res.body.saleId);
        return res.body;
      };

      await test('Snapshot: sale stores and returns the current store identity & footer', async () => {
        await putDeveloperSettings({ store_name: 'Snapshot Pharmacy A', store_address: 'Address A', developer_invoice_footer: 'Footer A' });
        const sale = await createSale();
        assert(sale.store_name_snapshot === 'Snapshot Pharmacy A', 'POST /sales did not return store_name_snapshot');
        assert(sale.store_address_snapshot === 'Address A', 'POST /sales did not return store_address_snapshot');
        assert(sale.invoice_footer_snapshot === 'Footer A', 'POST /sales did not return invoice_footer_snapshot');

        const fetched = await request(`/sales/${sale.saleId}`);
        assert(fetched.body.store_name_snapshot === 'Snapshot Pharmacy A', 'GET /sales/:id missing store_name_snapshot');
        assert(fetched.body.invoice_footer_snapshot === 'Footer A', 'GET /sales/:id missing invoice_footer_snapshot');
      });

      await test('Snapshot: reprint of an old sale keeps its original identity after the Developer changes it', async () => {
        await putDeveloperSettings({ store_name: 'Snapshot Pharmacy B', store_address: 'Address B', developer_invoice_footer: 'Footer B' });
        const saleB = await createSale();

        const oldSale = await request(`/sales/${createdSaleIds[0]}`);
        assert(oldSale.body.store_name_snapshot === 'Snapshot Pharmacy A', 'old sale lost its original store name');
        assert(oldSale.body.store_address_snapshot === 'Address A', 'old sale lost its original address');
        assert(oldSale.body.invoice_footer_snapshot === 'Footer A', 'old sale lost its original footer');

        const newSale = await request(`/sales/${saleB.saleId}`);
        assert(newSale.body.store_name_snapshot === 'Snapshot Pharmacy B', 'new sale did not use the new store name');
        assert(newSale.body.invoice_footer_snapshot === 'Footer B', 'new sale did not use the new footer');
      });

      await test('Snapshot: sales list includes snapshot columns', async () => {
        const list = await request('/sales?invoice_no=INV-');
        assert(Array.isArray(list.body), 'Expected an array from GET /sales');
        const row = list.body.find((s: any) => s.id === createdSaleIds[0]);
        assert(!!row, 'test sale not found in list');
        assert(row.store_name_snapshot === 'Snapshot Pharmacy A', 'list row missing store_name_snapshot');
      });

      await test('Snapshot: pre-Phase 3 sales with NULL snapshots still load for reprint', async () => {
        await prisma.sale.update({
          where: { id: createdSaleIds[0] },
          data: { storeNameSnapshot: null, storeAddressSnapshot: null, invoiceFooterSnapshot: null }
        });
        const res = await request(`/sales/${createdSaleIds[0]}`);
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.body.store_name_snapshot === null, 'expected null snapshot for legacy sale');
        assert(Array.isArray(res.body.items) && res.body.items.length === 1, 'legacy sale items missing');
      });
    } else {
      console.log(colors.red('⚠ SKIP: Snapshot tests need an active product with at least 2 boxes in stock'));
    }
  } finally {
    // -------------------------------------------------------------
    // Cleanup: restore settings, remove created records, restore stock
    // -------------------------------------------------------------
    for (const key of TOUCHED_SETTING_KEYS) {
      const value = originalSettings[key];
      if (value === undefined) {
        await prisma.systemSetting.deleteMany({ where: { key } });
      } else {
        await setRawSetting(key, value);
      }
    }
    if (createdSaleIds.length > 0) {
      await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
    }
    if (stockProduct) {
      await prisma.product.update({
        where: { id: stockProduct.id },
        data: { stockBoxes: stockProduct.stockBoxes, stockLoose: stockProduct.stockLoose }
      });
    }
    if (testShiftId) {
      await prisma.cashierShift.delete({ where: { id: testShiftId } });
    }
    if (createdUserIds.length > 0) {
      await prisma.auditLog.updateMany({ where: { userId: { in: createdUserIds } }, data: { userId: null } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log(colors.bold(colors.cyan('\n------------------------------------------------------')));
  console.log(colors.bold(`Phase 3 Tests: ${colors.green(String(passed) + ' Passed')}, ${failed > 0 ? colors.red(String(failed) + ' Failed') : '0 Failed'}`));
  console.log(colors.bold(colors.cyan('------------------------------------------------------\n')));

  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();

  // Background timers started by the API module would otherwise keep the process alive
  process.exit(failed > 0 ? 1 : 0);
}

runPhase3Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
