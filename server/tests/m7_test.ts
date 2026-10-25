/**
 * PharmaCare Pro - M7 Test Suite (docs/FEATURE_ROADMAP.md)
 * Covers the WhatsApp message settings: default templates, saving, the settings permission and the length
 * limit, plus the supplier phone on the reorder list. Phone and message formatting is in shared/whatsapp.spec.ts.
 * Runs on a fresh test database (see testEnv.ts).
 */

import './testEnv';
import http from 'http';
import { app } from '../api';
import { authHeaders, ensureTestAdmin, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { DEFAULT_WHATSAPP_RECEIPT_TEMPLATE, DEFAULT_WHATSAPP_REMINDER_TEMPLATE, WHATSAPP_TEMPLATE_MAX } from '../../shared/whatsapp';

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


async function runM7Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M7 Test Suite (WhatsApp messages)           ')));
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
  const cashier = await prisma.user.create({
    data: { username: `m7_cashier_${suffix}`, password: 'x', fullName: 'M7 Cashier', role: 'cashier', status: 'active' }
  });
  const save = (headers: Record<string, string>, body: Record<string, string>) =>
    request('/settings', headers, { method: 'POST', body: JSON.stringify(body) });

  try {
    await test('Settings return the default WhatsApp templates', async () => {
      const res = await request('/settings', adminHeaders);
      assert(res.status === 200, `Status ${res.status}`);
      assert(res.body.whatsapp_receipt_template === DEFAULT_WHATSAPP_RECEIPT_TEMPLATE, 'Default receipt template');
      assert(res.body.whatsapp_reminder_template === DEFAULT_WHATSAPP_REMINDER_TEMPLATE, 'Default reminder template');
    });

    await test('An Admin saves a template and gets it back', async () => {
      const text = `Dear {customer}, you owe {balance}. ${suffix}`;
      const res = await save(adminHeaders, { whatsapp_reminder_template: text });
      assert(res.status === 200, `Status ${res.status} ${JSON.stringify(res.body)}`);
      const after = await request('/settings', adminHeaders);
      assert(after.body.whatsapp_reminder_template === text, `Saved ${after.body.whatsapp_reminder_template}`);
    });

    await test('A cashier cannot change the templates', async () => {
      const res = await save(authHeaders(cashier), { whatsapp_receipt_template: 'Hacked' });
      assert(res.status === 403, `Status ${res.status}`);
      const after = await request('/settings', adminHeaders);
      assert(after.body.whatsapp_receipt_template === DEFAULT_WHATSAPP_RECEIPT_TEMPLATE, 'Template unchanged');
    });

    await test(`A template over ${WHATSAPP_TEMPLATE_MAX} characters is refused`, async () => {
      const res = await save(adminHeaders, { whatsapp_receipt_template: 'x'.repeat(WHATSAPP_TEMPLATE_MAX + 1) });
      assert(res.status === 400 && /WhatsApp/.test(res.body.error), `Status ${res.status} ${JSON.stringify(res.body)}`);
      const ok = await save(adminHeaders, { whatsapp_receipt_template: 'x'.repeat(WHATSAPP_TEMPLATE_MAX) });
      assert(ok.status === 200, `Exactly the limit is allowed, got ${ok.status}`);
    });

    await test('The reorder list carries the supplier phone', async () => {
      const supplier = await prisma.company.create({ data: { code: `M7${suffix}`.toUpperCase(), name: `M7 Pharma ${suffix}`, phone: '0300-1234567' } });
      await prisma.product.create({
        data: { companyId: supplier.id, cCode: supplier.code, pCode: `M7-${suffix}`, name: `M7 Low ${suffix}`, packing: 10, boxRetailPrice: 100, unitRetailPrice: 10, boxTradePrice: 80, stockBoxes: 1, minStockAlert: 5 }
      });
      const res = await request(`/reorder?company_id=${supplier.id}`, adminHeaders);
      assert(res.status === 200, `Status ${res.status}`);
      const items = Array.isArray(res.body) ? res.body : res.body.items;
      assert(items.length === 1 && items[0].company_phone === '0300-1234567', `Items ${JSON.stringify(items)}`);
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM7: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM7Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
