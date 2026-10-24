/**
 * PharmaCare Pro - Phase 5 Test Suite
 * Covers: server sessions (no trust in client headers), session revocation, identity taken from the session,
 * Developer-only Admin permissions, and the signed Demo / Full license (expiry lock, tampering, clock rollback).
 * Runs on a temporary copy of the database (see testEnv.ts).
 */

import './testEnv';
import http from 'http';
import { app } from '../api';
import { authHeaders, ensureTestDeveloper, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { hashPassword } from '../security/passwords';
import { saveLicense } from '../security/license';
import { DAY_MS, buildDemoLicense } from '../security/licenseMath';

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

async function request(p: string, options?: RequestInit) {
  const res = await fetch(`${baseUrl}${p}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
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

async function login(username: string, password: string) {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

async function runPhase5Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase 5 Test Suite                           ')));
  console.log(colors.bold(colors.cyan('  (Server Sessions, Admin Permissions, Demo / Full License)     ')));
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

  // Fixtures on the test database
  const suffix = Date.now().toString(36);
  const adminPassword = 'AdminPass#55';
  const cashierPassword = 'CashierPass#55';
  const devUser = await ensureTestDeveloper();
  const adminUser = await prisma.user.create({
    data: { username: `p5_admin_${suffix}`, password: await hashPassword(adminPassword), fullName: 'P5 Admin', role: 'admin', status: 'active' }
  });
  const cashierUser = await prisma.user.create({
    data: { username: `p5_cashier_${suffix}`, password: await hashPassword(cashierPassword), fullName: 'P5 Cashier', role: 'cashier', status: 'active' }
  });
  const devHeaders = authHeaders(devUser);

  try {
    // -------------------------------------------------------------
    // 1. Sessions
    // -------------------------------------------------------------
    await test('Sessions: protected routes need a login session (spoofed x-user-id is ignored)', async () => {
      const routes: Array<[string, string]> = [
        ['GET', '/products'],
        ['GET', '/users'],
        ['POST', '/sales'],
        ['POST', '/utilities/stock-zero'],
        ['PUT', '/roles/1'],
        ['POST', '/shifts/1/admin/reopen'],
        ['GET', '/developer/settings'],
        ['PUT', '/developer/license'],
        ['GET', '/reports/financial/pnl-summary'],
      ];
      for (const [method, p] of routes) {
        const anon = await request(p, { method, body: method === 'GET' ? undefined : '{}' });
        assert(anon.status === 401 && anon.body.code === 'SESSION_REQUIRED', `${method} ${p} without session: expected 401, got ${anon.status}`);
        const spoofed = await request(p, { method, headers: { 'x-user-id': String(devUser.id) }, body: method === 'GET' ? undefined : '{}' });
        assert(spoofed.status === 401, `${method} ${p} with spoofed x-user-id: expected 401, got ${spoofed.status}`);
      }
      const forged = await request('/products', { headers: { Authorization: 'Bearer not-a-real-token' } });
      assert(forged.status === 401, 'A made-up token is rejected');
    });

    await test('Sessions: public routes stay reachable and settings are trimmed before login', async () => {
      assert((await request('/status')).status === 200, '/status is public');
      assert((await request('/setup/status')).status === 200, '/setup/status is public');
      assert((await request('/license/status')).status === 200, '/license/status is public');
      const settings = await request('/settings');
      assert(settings.status === 200, '/settings is public');
      // Store identity plus the developer details chosen for the login screen
      const allowed = ['store_name', 'store_address', 'store_phone', 'currency_symbol', 'developer_info_login', 'developer_name', 'developer_phone'];
      assert(Object.keys(settings.body).every(k => allowed.includes(k)), `Only store identity before login, got ${Object.keys(settings.body).join(',')}`);
    });

    await test('Sessions: logout, password reset and disabling an account end sessions', async () => {
      const first = await login(adminUser.username, adminPassword);
      assert(first.status === 200 && typeof first.body.token === 'string', 'Admin logs in');
      const h1 = { Authorization: `Bearer ${first.body.token}` };
      assert((await request('/products', { headers: h1 })).status === 200, 'Token works');
      assert((await request('/auth/logout', { method: 'POST', headers: h1 })).status === 200, 'Logout ok');
      assert((await request('/products', { headers: h1 })).status === 401, 'Token revoked by logout');

      const cashierLogin = await login(cashierUser.username, cashierPassword);
      const hc = { Authorization: `Bearer ${cashierLogin.body.token}` };
      const reset = await request(`/developer/users/${cashierUser.id}/reset-password`, { method: 'POST', headers: devHeaders, body: JSON.stringify({ new_password: 'NewCashier#66' }) });
      assert(reset.status === 200, 'Developer resets cashier password');
      assert((await request('/products', { headers: hc })).status === 401, 'Cashier session revoked by password reset');

      const again = await login(cashierUser.username, 'NewCashier#66');
      const hc2 = { Authorization: `Bearer ${again.body.token}` };
      const disable = await request(`/users/${cashierUser.id}`, { method: 'PUT', headers: devHeaders, body: JSON.stringify({ status: 'inactive' }) });
      assert(disable.status === 200, 'Developer disables the cashier');
      assert((await request('/products', { headers: hc2 })).status === 401, 'Disabled account loses its session');
      await request(`/users/${cashierUser.id}`, { method: 'PUT', headers: devHeaders, body: JSON.stringify({ status: 'active' }) });
    });

    await test('Identity: change-password applies to the signed-in user, never a userId in the body', async () => {
      const adminHeaders = authHeaders(adminUser);
      const res = await request('/auth/change-password', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ userId: cashierUser.id, oldPassword: adminPassword, newPassword: 'AdminPass#77' })
      });
      assert(res.status === 200, `Own password change ok (${JSON.stringify(res.body)})`);
      assert((await login(adminUser.username, 'AdminPass#77')).status === 200, 'Admin password changed');
      assert((await login(cashierUser.username, 'NewCashier#66')).status === 200, 'Cashier password untouched');
      await prisma.user.update({ where: { id: adminUser.id }, data: { password: await hashPassword(adminPassword) } });
    });

    await test('Identity: shift admin actions need shift permission and audit the real user', async () => {
      const shift = await prisma.cashierShift.create({
        data: {
          shiftNo: `SHF-P5-${suffix}`,
          userId: cashierUser.id,
          userName: cashierUser.fullName,
          openingCash: 0,
          status: 'closed',
          startTime: new Date(Date.now() - 3600_000),
          endTime: new Date()
        }
      });
      const byCashier = await request(`/shifts/${shift.id}/admin/reopen`, { method: 'POST', headers: authHeaders(cashierUser), body: JSON.stringify({ reason: 'test' }) });
      assert(byCashier.status === 403, `Cashier cannot reopen shifts (got ${byCashier.status})`);

      const byAdmin = await request(`/shifts/${shift.id}/admin/reopen`, {
        method: 'POST',
        headers: authHeaders(adminUser),
        body: JSON.stringify({ reason: 'Counting error', admin_id: devUser.id, admin_name: 'Somebody Else' })
      });
      assert(byAdmin.status === 200, `Admin reopens (${JSON.stringify(byAdmin.body)})`);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'ADMIN_SHIFT_REOPEN' }, orderBy: { id: 'desc' } });
      assert(audit?.userId === adminUser.id && audit.userName === adminUser.fullName, 'Audit records the session user, not the body fields');
      await prisma.cashierShift.delete({ where: { id: shift.id } });
    });

    // -------------------------------------------------------------
    // 2. Admin permissions belong to the Developer
    // -------------------------------------------------------------
    await test('Permissions: Admin cannot change the admin role; the Developer can', async () => {
      const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
      const viaRoles = await request(`/roles/${adminRole!.id}`, {
        method: 'PUT',
        headers: authHeaders(adminUser),
        body: JSON.stringify({ permissions: { ...JSON.parse(adminRole!.permissions), can_delete_invoice: true } })
      });
      assert(viaRoles.status === 403, `Admin editing own role: expected 403, got ${viaRoles.status}`);

      const adminCall = await request('/developer/admin-permissions', { method: 'PUT', headers: authHeaders(adminUser), body: JSON.stringify({ reports: false }) });
      assert(adminCall.status === 403, 'Admin cannot call the developer endpoint');

      const devCall = await request('/developer/admin-permissions', { method: 'PUT', headers: devHeaders, body: JSON.stringify({ reports: false, made_up_key: true }) });
      assert(devCall.status === 200 && devCall.body.permissions.reports === false, 'Developer turns off Admin reports');
      assert(devCall.body.permissions.made_up_key === undefined, 'Unknown permission keys are dropped');
      const relogin = await login(adminUser.username, adminPassword);
      assert(relogin.body.user.permissions.reports === false, 'Admin login carries the new permissions');

      const badValue = await request('/developer/admin-permissions', { method: 'PUT', headers: devHeaders, body: JSON.stringify({ reports: 'yes' }) });
      assert(badValue.status === 400, 'Non-boolean permission rejected');
      await request('/developer/admin-permissions', { method: 'PUT', headers: devHeaders, body: JSON.stringify({ reports: true }) });
    });

    await test('Permissions: the last active Admin cannot be disabled or deleted', async () => {
      const activeAdmins = await prisma.user.findMany({ where: { role: 'admin', status: 'active' } });
      const others = activeAdmins.filter(a => a.id !== adminUser.id);
      await prisma.user.updateMany({ where: { id: { in: others.map(a => a.id) } }, data: { status: 'inactive' } });
      try {
        const disable = await request(`/users/${adminUser.id}`, { method: 'PUT', headers: devHeaders, body: JSON.stringify({ status: 'inactive' }) });
        assert(disable.status === 400, `Disabling the last admin: expected 400, got ${disable.status}`);
        const del = await request(`/users/${adminUser.id}`, { method: 'DELETE', headers: devHeaders });
        assert(del.status === 400, `Deleting the last admin: expected 400, got ${del.status}`);
      } finally {
        await prisma.user.updateMany({ where: { id: { in: others.map(a => a.id) } }, data: { status: 'active' } });
      }
    });

    // -------------------------------------------------------------
    // 3. Demo / Full license
    // -------------------------------------------------------------
    await test('License: an expired demo locks Admin and Cashier but not the Developer', async () => {
      const adminSession = authHeaders(adminUser);
      await saveLicense(buildDemoLicense(3, Date.now() - 5 * DAY_MS));

      const status = await request('/license/status');
      assert(status.body.expired === true && status.body.mode === 'demo', 'Status reports the demo as ended');

      const adminLogin = await login(adminUser.username, adminPassword);
      assert(adminLogin.status === 403 && adminLogin.body.code === 'LICENSE_EXPIRED', `Admin login blocked (got ${adminLogin.status})`);
      const cashierLogin = await login(cashierUser.username, 'NewCashier#66');
      assert(cashierLogin.status === 403, 'Cashier login blocked');

      const existing = await request('/products', { headers: adminSession });
      assert(existing.status === 403 && existing.body.code === 'LICENSE_EXPIRED', 'An already signed-in admin is locked out too');

      const dev = await request('/developer/settings', { headers: devHeaders });
      assert(dev.status === 200, 'Developer keeps working');
      const devProducts = await request('/products', { headers: devHeaders });
      assert(devProducts.status === 200, 'Developer can still open store data');
    });

    await test('License: only the Developer can extend the demo or activate Full', async () => {
      const byAdmin = await request('/developer/license', { method: 'PUT', headers: authHeaders(adminUser), body: JSON.stringify({ action: 'full' }) });
      assert(byAdmin.status === 403, `Admin cannot change the license (got ${byAdmin.status})`);

      const invalid = await request('/developer/license', { method: 'PUT', headers: devHeaders, body: JSON.stringify({ action: 'extend', demoDays: 0 }) });
      assert(invalid.status === 400, '0 days rejected');

      const extend = await request('/developer/license', { method: 'PUT', headers: devHeaders, body: JSON.stringify({ action: 'extend', demoDays: 10 }) });
      assert(extend.status === 200 && extend.body.expired === false && extend.body.daysLeft === 10, `Expired demo extended from today (${JSON.stringify(extend.body)})`);
      assert((await login(adminUser.username, adminPassword)).status === 200, 'Admin can sign in again');

      const full = await request('/developer/license', { method: 'PUT', headers: devHeaders, body: JSON.stringify({ action: 'full' }) });
      assert(full.status === 200 && full.body.mode === 'full' && full.body.daysLeft === null, 'Full version activated');

      const audit = await prisma.auditLog.findFirst({ where: { action: 'LICENSE_UPDATED', status: 'SUCCESS' }, orderBy: { id: 'desc' } });
      assert(!!audit && /Full/.test(audit.details || ''), 'License changes are audited');
    });

    await test('License: editing the database cannot turn a demo into Full', async () => {
      await saveLicense(buildDemoLicense(2, Date.now() - 10 * DAY_MS));
      await prisma.systemSetting.update({ where: { key: 'license_mode' }, data: { value: 'full' } });
      const status = await request('/license/status');
      assert(status.body.expired === true && status.body.reason === 'tampered', `Tampered license is locked (${JSON.stringify(status.body)})`);
      assert((await login(adminUser.username, adminPassword)).status === 403, 'Admin blocked on a tampered license');

      // Deleting the license rows does not help either
      await prisma.systemSetting.deleteMany({ where: { key: { startsWith: 'license_' } } });
      const missing = await request('/license/status');
      assert(missing.body.expired === true && missing.body.reason === 'missing', 'Missing license is locked');

      const writeViaSettings = await request('/settings', { method: 'POST', headers: devHeaders, body: JSON.stringify({ license_mode: 'full', license_signature: 'x' }) });
      assert(writeViaSettings.status === 200, 'Settings save succeeds');
      assert((await prisma.systemSetting.findUnique({ where: { key: 'license_mode' } })) === null, '/api/settings cannot write license keys');
    });

    await test('License: turning the PC clock back does not add demo days', async () => {
      const now = Date.now();
      // Demo ended yesterday by the last recorded clock, but the PC clock now reads 5 days earlier
      await saveLicense({ ...buildDemoLicense(4, now - 8 * DAY_MS), lastSeenAt: new Date(now + 5 * DAY_MS).toISOString() });
      const status = await request('/license/status');
      assert(status.body.expired === true, 'Still expired when the clock is behind the last recorded time');
      const audit = await prisma.auditLog.findFirst({ where: { action: 'LICENSE_CLOCK_ROLLBACK' } });
      assert(!!audit, 'Clock rollback is audited');
    });
  } finally {
    await useFullTestLicense();
  }

  console.log(colors.bold(colors.cyan('\n------------------------------------------------------')));
  console.log(colors.bold(`Phase 5 Tests: ${colors.green(`${passed} Passed`)}, ${failed > 0 ? colors.red(`${failed} Failed`) : '0 Failed'}`));
  console.log(colors.bold(colors.cyan('------------------------------------------------------\n')));

  server.close();
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runPhase5Tests().catch(async (err) => {
  console.error(colors.red(`Phase 5 suite crashed: ${err?.stack || err}`));
  if (server) server.close();
  await prisma.$disconnect();
  process.exit(1);
});
