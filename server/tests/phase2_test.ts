/**
 * PharmaCare Pro - Phase 2 Comprehensive Test Suite
 * Covers:
 *  - TC-03: Developer Access Control Enforcement
 *  - TC-04: RBAC Policy Enforcement (Admin Cashier/Admin creation toggles, role escalation block)
 *  - TC-05: Protected Store Identity & Developer Invoice Footer
 *  - TC-06: Developer Staff Password Reset
 *  - TC-07: Security Audit Logging & Plaintext Password Redaction
 *  - Backup Retention Limit Pruning
 */

process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import './testEnv';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from '../api';
import { authHeaders, adminAuthHeaders, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { hashPassword } from '../security/passwords';
import { pruneBackupsByRetentionLimit } from '../database/backup';

const colors = {
  green: (t: string) => `\x1b[32m${t}\x1b[0m`,
  red: (t: string) => `\x1b[31m${t}\x1b[0m`,
  cyan: (t: string) => `\x1b[36m${t}\x1b[0m`,
  yellow: (t: string) => `\x1b[33m${t}\x1b[0m`,
  bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
};

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

let server: http.Server;
let baseUrl: string;

async function request(path: string, options?: RequestInit) {
  const auth = options?.headers && 'Authorization' in (options.headers as Record<string, string>) ? {} : await adminAuthHeaders();
  const fullUrl = path.startsWith('http') ? path : `${baseUrl}${path}`;
  const res = await fetch(fullUrl, {
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

async function runPhase2Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase 2 Test Suite                           ')));
  console.log(colors.bold(colors.cyan('  (RBAC Policies, Protected Settings, Password Reset, Audit)    ')));
  console.log(colors.bold(colors.cyan('================================================================\n')));

  // Always an in-process server: login sessions live in this process
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://localhost:${addr.port}/api`;
      resolve();
    });
  });
  await useFullTestLicense();

  console.log(`[Phase2 Test] Target API: ${baseUrl}\n`);

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
  // Test Fixture Setup: Ensure Developer, Admin, and Cashier Users
  // -------------------------------------------------------------
  const hashedPw = await hashPassword('password123');

  let devUser = await prisma.user.findFirst({ where: { role: 'developer' } });
  if (!devUser) {
    devUser = await prisma.user.create({
      data: {
        username: 'dev_test_master',
        password: hashedPw,
        fullName: 'Dev Test Master',
        role: 'developer',
        status: 'active',
        email: 'dev@test.local'
      }
    });
  }

  let adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        username: 'admin_test_p2',
        password: hashedPw,
        fullName: 'Admin Test P2',
        role: 'admin',
        status: 'active'
      }
    });
  }

  const devHeaders = authHeaders(devUser);

  const adminHeaders = authHeaders(adminUser);

  // -------------------------------------------------------------
  // TC-03: Access Control Enforcement (Task 2.1)
  // -------------------------------------------------------------
  await test('TC-03.1: Reject unauthenticated access to GET /api/developer/settings with 403', async () => {
    const res = await request('/developer/settings');
    assert(res.status === 403, `Expected status 403, got ${res.status}`);
  });

  await test('TC-03.2: Reject non-developer (Admin) access to GET /api/developer/settings with 403', async () => {
    const res = await request('/developer/settings', {
      headers: adminHeaders
    });
    assert(res.status === 403, `Expected status 403, got ${res.status}`);
  });

  await test('TC-03.3: Permit Developer access to GET /api/developer/settings', async () => {
    const res = await request('/developer/settings', {
      headers: devHeaders
    });
    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    assert(res.body.backup_retention_limit !== undefined, 'Expected backup_retention_limit in settings');
    assert(res.body.allow_admin_create_cashier !== undefined, 'Expected allow_admin_create_cashier in settings');
  });

  await test('TC-03.4: Reject non-developer PUT /api/developer/settings with 403', async () => {
    const res = await request('/developer/settings', {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ backup_retention_limit: '15' })
    });
    assert(res.status === 403, `Expected status 403, got ${res.status}`);
  });

  await test('TC-03.5: Permit Developer PUT /api/developer/settings and update settings', async () => {
    const res = await request('/developer/settings', {
      method: 'PUT',
      headers: devHeaders,
      body: JSON.stringify({
        backup_retention_limit: '45',
        backup_frequency: 'twice_daily',
        developer_invoice_footer: 'PharmaCare Pro • Antigravity Verified'
      })
    });
    assert(res.status === 200, `Expected status 200, got ${res.status}`);

    const verify = await request('/developer/settings', { headers: devHeaders });
    assert(verify.body.backup_retention_limit === '45', 'backup_retention_limit was not updated');
    assert(verify.body.backup_frequency === 'twice_daily', 'backup_frequency was not updated');
  });

  // -------------------------------------------------------------
  // TC-04: RBAC Cashier & Admin Policy Enforcement (Task 2.2)
  // -------------------------------------------------------------
  await test('TC-04.1: Enforce allow_admin_create_cashier=false blocks Admin creating cashier', async () => {
    // Set allow_admin_create_cashier to false
    await request('/developer/settings', {
      method: 'PUT',
      headers: devHeaders,
      body: JSON.stringify({ allow_admin_create_cashier: 'false' })
    });

    const randCashier = `cashier_blocked_${Date.now()}`;
    const res = await request('/users', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        username: randCashier,
        password: 'password123',
        full_name: 'Blocked Cashier',
        role: 'cashier'
      })
    });

    assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
    assert(res.body.error?.includes('disabled by Developer policy'), `Unexpected error: ${res.body.error}`);
  });

  await test('TC-04.2: Enforce allow_admin_create_cashier=true permits Admin creating cashier', async () => {
    // Re-enable allow_admin_create_cashier
    await request('/developer/settings', {
      method: 'PUT',
      headers: devHeaders,
      body: JSON.stringify({ allow_admin_create_cashier: 'true' })
    });

    const randCashier = `cashier_ok_${Date.now()}`;
    const res = await request('/users', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        username: randCashier,
        password: 'password123',
        full_name: 'Allowed Cashier',
        role: 'cashier'
      })
    });

    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
    assert(res.body.id !== undefined, 'User id should be returned');
  });

  await test('TC-04.3: Enforce allow_admin_create_admin=false blocks Admin creating secondary admin', async () => {
    // Set allow_admin_create_admin to false
    await request('/developer/settings', {
      method: 'PUT',
      headers: devHeaders,
      body: JSON.stringify({ allow_admin_create_admin: 'false' })
    });

    const randAdmin = `admin_sec_${Date.now()}`;
    const res = await request('/users', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        username: randAdmin,
        password: 'password123',
        full_name: 'Secondary Admin',
        role: 'admin'
      })
    });

    assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
    assert(res.body.error?.includes('disabled by Developer policy'), `Unexpected error: ${res.body.error}`);
  });

  await test('TC-04.4: Block registration of developer role via standard user creation', async () => {
    const randDev = `dev_impostor_${Date.now()}`;
    const res = await request('/users', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        username: randDev,
        password: 'password123',
        full_name: 'Impostor Dev',
        role: 'developer'
      })
    });

    assert(res.status === 400, `Expected 400 Bad Request, got ${res.status}`);
  });

  await test('TC-04.5: Block role escalation to Developer on PUT /api/users/:id', async () => {
    const targetUser = await prisma.user.create({
      data: {
        username: `escalate_test_${Date.now()}`,
        password: hashedPw,
        fullName: 'Escalation Test',
        role: 'cashier',
        status: 'active'
      }
    });

    const res = await request(`/users/${targetUser.id}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ role: 'developer' })
    });

    assert(res.status === 400, `Expected 400 Bad Request on role escalation, got ${res.status}`);
  });

  await test('TC-04.6: Block non-developer from modifying Developer account', async () => {
    const res = await request(`/users/${devUser.id}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ full_name: 'Tampered Developer' })
    });

    assert(res.status === 403, `Expected 403 Forbidden when admin modifies developer, got ${res.status}`);
  });

  await test('TC-04.7: Block deletion of Developer account', async () => {
    const res = await request(`/users/${devUser.id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });

    assert(res.status === 400, `Expected 400 Bad Request when deleting developer, got ${res.status}`);
  });

  // -------------------------------------------------------------
  // TC-05: Protected Store Identity & Developer Footer (Task 2.1)
  // -------------------------------------------------------------
  await test('TC-05.1: Protect Store Name and Address against Admin modification when disabled', async () => {
    // Set allow_admin_edit_store_identity = 'false'
    await request('/developer/settings', {
      method: 'PUT',
      headers: devHeaders,
      body: JSON.stringify({
        allow_admin_edit_store_identity: 'false',
        store_name: 'PharmaCare Master Vault',
        store_address: 'Locked Boulevard 42'
      })
    });

    // Admin attempts to overwrite store_name and store_address via standard /api/settings
    const res = await request('/settings', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        store_name: 'Hijacked Store Name',
        store_address: 'Hijacked Address',
        currency_symbol: 'PKR'
      })
    });

    assert(res.status === 200, `Settings save should succeed with unpermitted keys stripped, got ${res.status}`);

    // Verify protected values were NOT overwritten
    const check = await request('/settings');
    assert(check.body.store_name === 'PharmaCare Master Vault', `store_name was tampered: ${check.body.store_name}`);
    assert(check.body.store_address === 'Locked Boulevard 42', `store_address was tampered: ${check.body.store_address}`);
    assert(check.body.currency_symbol === 'PKR', 'Unrestricted setting was not saved');
  });

  await test('TC-05.2: Enforce show_developer_info strictly true and footer locked', async () => {
    await request('/settings', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        show_developer_info: 'false',
        developer_invoice_footer: 'Unauthorized Dev Attribution'
      })
    });

    const check = await request('/settings');
    assert(check.body.show_developer_info === 'true', 'show_developer_info must remain strictly true');
    assert(check.body.developer_invoice_footer !== 'Unauthorized Dev Attribution', 'developer_invoice_footer was tampered by admin');
  });

  // -------------------------------------------------------------
  // TC-06: Developer Staff Password Reset (Task 2.2)
  // -------------------------------------------------------------
  await test('TC-06.1: Developer resets password for staff user successfully', async () => {
    const testStaff = await prisma.user.create({
      data: {
        username: `staff_reset_${Date.now()}`,
        password: await hashPassword('oldPassword123'),
        fullName: 'Staff Reset Candidate',
        role: 'cashier',
        status: 'active'
      }
    });

    const res = await request(`/developer/users/${testStaff.id}/reset-password`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({ new_password: 'BrandNewPassword999' })
    });

    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
    assert(res.body.success === true, 'Success flag should be true');

    // Test logging in with the new password
    const loginRes = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: testStaff.username,
        password: 'BrandNewPassword999'
      })
    });

    assert(loginRes.status === 200, `Expected 200 OK with new password, got ${loginRes.status}`);
    assert(loginRes.body.user.username === testStaff.username, 'Login user mismatch');

    // Test logging in with old password fails
    const oldLoginRes = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: testStaff.username,
        password: 'oldPassword123'
      })
    });

    assert(oldLoginRes.status === 401, 'Old password should be rejected');
  });

  await test('TC-06.2: Reject non-developer calling developer password reset with 403', async () => {
    const res = await request(`/developer/users/${adminUser.id}/reset-password`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ new_password: 'SomeNewPassword123' })
    });

    assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
  });

  // -------------------------------------------------------------
  // TC-07: Security Audit Logging & Secret Redaction (Task 2.3)
  // -------------------------------------------------------------
  await test('TC-07.1: Developer can retrieve audit logs via GET /api/developer/audit-logs', async () => {
    const res = await request('/developer/audit-logs?limit=20', {
      headers: devHeaders
    });

    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
    assert(Array.isArray(res.body.logs), 'Expected logs array');
    assert(res.body.total >= 1, 'Expected at least 1 audit log entry');
  });

  await test('TC-07.2: Reject non-developer access to GET /api/developer/audit-logs with 403', async () => {
    const res = await request('/developer/audit-logs', {
      headers: adminHeaders
    });

    assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
  });

  await test('TC-07.3: Audit logs strictly redact plaintext passwords and TOTP secrets', async () => {
    const res = await request('/developer/audit-logs?limit=100', {
      headers: devHeaders
    });

    assert(res.status === 200, 'Audit logs retrieval failed');
    const logs = res.body.logs;

    const sensitivePatterns = [
      /password123/i,
      /BrandNewPassword999/i,
      /oldPassword123/i,
      /password=[^R\s,;]+/i, // anything other than [REDACTED]
      /totpSecret=[^R\s,;]+/i
    ];

    for (const log of logs) {
      const details = log.details || '';
      for (const pattern of sensitivePatterns) {
        assert(!pattern.test(details), `Security leak! Found sensitive pattern ${pattern} in log: "${details}"`);
      }
    }
  });

  // -------------------------------------------------------------
  // Backup Retention Pruning Logic
  // -------------------------------------------------------------
  await test('Backup Retention: pruneBackupsByRetentionLimit executes safely without errors', async () => {
    // Prune an empty temp folder: pruning the configured folder would delete the store's real backups
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacare-phase2-'));
    try {
      const pruned = pruneBackupsByRetentionLimit(30, tmpDir);
      assert(pruned === 0, `Expected nothing to prune in an empty folder, pruned ${pruned}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log(colors.bold(colors.cyan('\n------------------------------------------------------')));
  console.log(colors.bold(`Phase 2 Tests: ${colors.green(String(passed) + ' Passed')}, ${failed > 0 ? colors.red(String(failed) + ' Failed') : '0 Failed'}`));
  console.log(colors.bold(colors.cyan('------------------------------------------------------\n')));

  if (server) {
    server.close();
  }

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
