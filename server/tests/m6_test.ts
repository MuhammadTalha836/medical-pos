/**
 * PharmaCare Pro - M6 Test Suite (docs/FEATURE_ROADMAP.md)
 * Covers the substitutes search: formula matching (case, spacing, ingredient order, strength), ordering,
 * exclusions, unknown and formula-less medicines, the generics suggestions list and the login requirement.
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


async function runM6Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - M6 Test Suite (Substitutes search)          ')));
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
  const supplier = await prisma.company.create({ data: { code: `M6${suffix}`.toUpperCase(), name: `M6 Pharma ${suffix}` } });
  // A formula of its own so the sample catalog never matches
  const formula = `Zetamol${suffix} 500 mg + Caffeine`;
  const med = (name: string, data: Record<string, unknown> = {}) => prisma.product.create({
    data: { companyId: supplier.id, cCode: supplier.code, pCode: `M6-${name}-${suffix}`, name: `M6 ${name} ${suffix}`, packing: 10, boxRetailPrice: 100, unitRetailPrice: 10, ...data }
  });

  const asked = await med('Asked', { genericName: formula, stockBoxes: 0 });
  const empty = await med('Empty', { genericName: `caffeine+ZETAMOL${suffix} 500mg`, stockBoxes: 0 });
  const small = await med('Small', { genericName: `  caffeine ,  zetamol${suffix} 500MG `, stockBoxes: 1 });
  const big = await med('Big', { genericName: `Caffeine and Zetamol${suffix} 500 mg`, stockBoxes: 4 });
  await med('Inactive', { genericName: formula, stockBoxes: 9, status: 'inactive' });
  await med('Stronger', { genericName: `Zetamol${suffix} 650 mg + Caffeine`, stockBoxes: 9 });
  const noFormula = await med('NoFormula', { stockBoxes: 3 });

  try {
    await test('Substitutes match the formula however it is written, in stock first', async () => {
      const res = await request(`/products/${asked.id}/substitutes`, devHeaders);
      assert(res.status === 200, `Status ${res.status}`);
      assert(res.body.product.id === asked.id, 'The asked medicine is returned');
      const ids = res.body.substitutes.map((p: any) => p.id);
      assert(JSON.stringify(ids) === JSON.stringify([big.id, small.id, empty.id]), `Order ${JSON.stringify(res.body.substitutes.map((p: any) => p.name))}`);
      assert(res.body.substitutes[0].company_name === supplier.name && 'box_retail_price' in res.body.substitutes[0], 'Rows carry the POS fields');
    });

    await test('The medicine itself, inactive medicines and other strengths are left out', async () => {
      const res = await request(`/products/${big.id}/substitutes`, devHeaders);
      const names = res.body.substitutes.map((p: any) => p.name);
      assert(!names.some((n: string) => /Big|Inactive|Stronger/.test(n)), `Names ${JSON.stringify(names)}`);
      assert(names.length === 3, `Asked, Small and Empty expected, got ${JSON.stringify(names)}`);
    });

    await test('Unknown medicine gives 404; no formula gives an empty list', async () => {
      assert((await request('/products/999999/substitutes', devHeaders)).status === 404, 'Unknown is 404');
      const res = await request(`/products/${noFormula.id}/substitutes`, devHeaders);
      assert(res.status === 200 && res.body.substitutes.length === 0, `Empty list, got ${JSON.stringify(res.body)}`);
    });

    await test('Generics lists formulas in use, filtered by text', async () => {
      const res = await request(`/products/generics?q=${encodeURIComponent(`zetamol${suffix}`)}`, devHeaders);
      assert(res.status === 200 && res.body.length >= 1, `Status ${res.status} ${JSON.stringify(res.body)}`);
      assert(res.body.every((g: any) => g.generic_name.toLowerCase().includes(`zetamol${suffix}`)), 'Filtered by q');
      const all = await request('/products/generics', devHeaders);
      assert(all.body.some((g: any) => g.generic_name === 'Paracetamol'), 'Sample formulas listed');
    });

    await test('Substitutes and generics need a login', async () => {
      assert((await request(`/products/${asked.id}/substitutes`, { Authorization: '' })).status === 401, 'Substitutes 401');
      assert((await request('/products/generics', { Authorization: '' })).status === 401, 'Generics 401');
    });
  } finally {
    server.close();
  }

  console.log(colors.bold(`\nM6: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runM6Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
