/**
 * PharmaCare Pro - Phase 1 End-to-End Test Suite
 * Covers: Password Hashing (Bcrypt), RFC 6238 TOTP Engine, developer-gated Setup Wizard
 * (master key unlock, admin creation, license), Developer Login with replay protection,
 * Rate Limiting & Account Lockout, sessions and Data Isolation.
 * Runs on a temporary copy of the database (see testEnv.ts).
 */

import { TEST_DEVELOPER_EMAIL, TEST_DEVELOPER_SECRET } from './testEnv';
import http from 'http';
import { app } from '../api';
import { prisma } from '../database/prisma';
import { hashPassword, verifyPassword } from '../security/passwords';
import {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  encryptTotpSecret,
  decryptTotpSecret,
  base32Encode,
  base32Decode
} from '../security/totp';

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
  const fullUrl = path.startsWith('http') ? path : `${baseUrl}${path}`;
  const res = await fetch(fullUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
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

async function runPhase1Tests() {
  console.log(colors.bold(colors.cyan('\n======================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase 1 Functional Test Suite     ')));
  console.log(colors.bold(colors.cyan('  (Core Setup, Bcrypt, Offline TOTP, Setup Wizard)   ')));
  console.log(colors.bold(colors.cyan('======================================================\n')));

  // Always an in-process server: sessions live in this process
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://localhost:${addr.port}/api`;
      resolve();
    });
  });

  let testsPassed = 0;
  let testsTotal = 0;

  async function step(name: string, fn: () => Promise<void>) {
    testsTotal++;
    process.stdout.write(`[Test ${testsTotal}] ${name} ... `);
    try {
      await fn();
      console.log(colors.green('PASSED ✓'));
      testsPassed++;
    } catch (err: any) {
      console.log(colors.red('FAILED ✗'));
      console.error(colors.red(`   Error: ${err.message}`));
      throw err;
    }
  }

  try {
    // ------------------------------------------------------------------------
    // 1. Password Hashing (Bcrypt) Unit Tests
    // ------------------------------------------------------------------------
    await step('Verify Bcrypt Hashing and Legacy Plaintext Auto-Upgrade', async () => {
      const plaintext = 'SuperSecret123!';
      const hash = await hashPassword(plaintext);

      assert(typeof hash === 'string' && hash.startsWith('$2'), 'Hash is valid bcrypt string');

      // Verify correct password
      const checkValid = await verifyPassword(plaintext, hash);
      assert(checkValid.valid === true, 'Correct password verifies successfully');
      assert(checkValid.needsRehash === false, 'Already hashed password does not need rehash');

      // Verify wrong password
      const checkWrong = await verifyPassword('WrongPassword', hash);
      assert(checkWrong.valid === false, 'Wrong password rejected');

      // Verify legacy plaintext check and auto-rehash flag
      const legacyCheck = await verifyPassword('legacyPlain', 'legacyPlain');
      assert(legacyCheck.valid === true, 'Legacy plaintext verifies');
      assert(legacyCheck.needsRehash === true, 'Legacy plaintext flags needsRehash');
    });

    // ------------------------------------------------------------------------
    // 2. RFC 6238 TOTP Engine & Clock Drift Tolerance
    // ------------------------------------------------------------------------
    await step('Verify RFC 6238 TOTP Generation, Clock Drift, and AES-256 Encryption', async () => {
      const secret = generateTotpSecret();
      assert(typeof secret === 'string' && secret.length >= 16, 'Base32 secret generated');

      // Base32 roundtrip
      const testBuf = Buffer.from('PharmaCareTOTPTest');
      const b32 = base32Encode(testBuf);
      const decodedBuf = base32Decode(b32);
      assert(decodedBuf.toString('utf8') === 'PharmaCareTOTPTest', 'Base32 roundtrip matches');

      // Current TOTP code
      const currentCode = generateTotpCode(secret);
      assert(/^\d{6}$/.test(currentCode), 'Current TOTP code is 6 digits');

      // Verify within current window
      assert(verifyTotpCode(secret, currentCode, 1), 'Current code passes verification');

      // Verify with 30s drift backward (1 step)
      const nowSec = Math.floor(Date.now() / 1000);
      const pastCode = generateTotpCode(secret, nowSec - 30);
      assert(verifyTotpCode(secret, pastCode, 1), 'Past code within 30s window passes');

      // Verify with 30s drift forward (1 step)
      const futureCode = generateTotpCode(secret, nowSec + 30);
      assert(verifyTotpCode(secret, futureCode, 1), 'Future code within 30s window passes');

      // Reject expired code (+120s / 4 steps away)
      const farFutureCode = generateTotpCode(secret, nowSec + 120);
      assert(!verifyTotpCode(secret, farFutureCode, 1), 'Far future code (+120s) rejected');

      // Reject invalid strings
      assert(!verifyTotpCode(secret, '000000', 1) || verifyTotpCode(secret, '000000', 1) === (currentCode === '000000'), 'Random invalid code rejected');
      assert(!verifyTotpCode(secret, 'abc', 1), 'Malformed code rejected');

      // AES-256-GCM encryption & decryption at rest
      const encrypted = encryptTotpSecret(secret);
      assert(encrypted.includes(':') && encrypted !== secret, 'Secret is encrypted in iv:tag:cipher format');
      const decrypted = decryptTotpSecret(encrypted);
      assert(decrypted === secret, 'Decrypted secret matches original plaintext');
    });

    // ------------------------------------------------------------------------
    // 3. Database Schema & Role Verification
    // ------------------------------------------------------------------------
    await step('Verify Developer Role and User Model Columns in Database', async () => {
      const devRole = await prisma.role.findUnique({ where: { name: 'developer' } });
      assert(devRole !== null, 'Developer role exists in database');
      assert(devRole?.displayName === 'System Developer', 'Developer role display name is correct');

      // Verify columns in SQLite
      const userSample = await prisma.user.findFirst();
      if (userSample) {
        assert('email' in userSample, 'email column exists on User');
        assert('totpSecret' in userSample, 'totpSecret column exists on User');
        assert('failedLoginAttempts' in userSample, 'failedLoginAttempts column exists on User');
        assert('lockedUntil' in userSample, 'lockedUntil column exists on User');
      }
    });

    // ------------------------------------------------------------------------
    // 4. Developer-gated Setup Wizard
    // ------------------------------------------------------------------------
    const nowSec = () => Math.floor(Date.now() / 1000);
    const adminUsername = `owner_${Date.now().toString(36)}`;
    const adminPassword = 'StoreOwner#2026';
    let setupToken = '';
    let unlockCode = '';
    let developerToken = '';

    const setupBody = (overrides: Record<string, unknown> = {}) => JSON.stringify({
      setupToken,
      storeName: 'Test Medical Pharmacy',
      storeAddress: 'Test Commercial Ave',
      admin: { fullName: 'Store Owner', username: adminUsername, password: adminPassword },
      backup: { frequency: 'daily', time: '22:30' },
      adminPermissions: { can_delete_invoice: false },
      policies: {
        allow_admin_create_cashier: true,
        allow_admin_create_admin: false,
        allow_admin_edit_store_identity: false,
        allow_admin_hide_store_identity: false
      },
      license: { mode: 'demo', demoDays: 30 },
      ...overrides
    });

    await step('Setup wizard is locked behind the developer master code', async () => {
      // Reset setup on this temporary database copy
      await prisma.systemSetting.upsert({
        where: { key: 'setup_completed' },
        update: { value: 'false' },
        create: { key: 'setup_completed', value: 'false' }
      });
      await prisma.user.deleteMany({ where: { role: 'developer' } });

      const statusRes = await request('/setup/status');
      assert(statusRes.ok, 'Setup status endpoint responds');
      assert(statusRes.body.isSetupCompleted === false, 'Setup status is not completed');
      assert(statusRes.body.developerEmail === TEST_DEVELOPER_EMAIL, 'Fixed developer email is reported');
      assert(statusRes.body.developerKeyConfigured === true, 'Developer key is configured');

      // The old self-registration endpoints are gone
      const legacyInit = await request('/setup/initialize', { method: 'POST', body: JSON.stringify({ developerEmail: 'hacker@malicious.local' }) });
      assert(legacyInit.status === 401 || legacyInit.status === 404, 'Old QR self-registration endpoint no longer works');

      const noTokenComplete = await request('/setup/complete', { method: 'POST', body: setupBody({ setupToken: 'forged-token' }) });
      assert(noTokenComplete.status === 401, 'Setup cannot be completed without unlocking first');

      const badUnlock = await request('/setup/unlock', { method: 'POST', body: JSON.stringify({ code: '000000' }) });
      assert(badUnlock.status === 401, 'Wrong developer code rejected');

      // A code from a different authenticator (any other secret) is useless
      const otherSecretCode = generateTotpCode(generateTotpSecret());
      const otherUnlock = await request('/setup/unlock', { method: 'POST', body: JSON.stringify({ code: otherSecretCode }) });
      assert(otherUnlock.status === 401 || otherSecretCode === generateTotpCode(TEST_DEVELOPER_SECRET), 'Code from another authenticator rejected');

      unlockCode = generateTotpCode(TEST_DEVELOPER_SECRET, nowSec());
      const goodUnlock = await request('/setup/unlock', { method: 'POST', body: JSON.stringify({ code: unlockCode }) });
      assert(goodUnlock.ok, `Developer code unlocks the wizard (${JSON.stringify(goodUnlock.body)})`);
      assert(typeof goodUnlock.body.setupToken === 'string' && goodUnlock.body.setupToken.length > 20, 'Setup token returned');
      setupToken = goodUnlock.body.setupToken;

      const replay = await request('/setup/unlock', { method: 'POST', body: JSON.stringify({ code: unlockCode }) });
      assert(replay.status === 401 && /already used/.test(replay.body.error), 'The same code cannot be used twice');
    });

    await step('Setup completion validates input and creates the Admin, settings and license', async () => {
      const weakPassword = await request('/setup/complete', {
        method: 'POST',
        body: setupBody({ admin: { fullName: 'Store Owner', username: adminUsername, password: 'short' } })
      });
      assert(weakPassword.status === 400, 'Admin password under 8 characters rejected');

      const badLicense = await request('/setup/complete', { method: 'POST', body: setupBody({ license: { mode: 'demo', demoDays: 0 } }) });
      assert(badLicense.status === 400, 'Demo of 0 days rejected');

      const done = await request('/setup/complete', { method: 'POST', body: setupBody() });
      assert(done.ok, `Setup completes (${JSON.stringify(done.body)})`);
      assert(done.body.user.role === 'developer', 'Returns the Developer user');
      assert(done.body.user.email === TEST_DEVELOPER_EMAIL, 'Developer uses the fixed email');
      assert(typeof done.body.token === 'string', 'Returns a developer session token');
      developerToken = done.body.token;

      const admin = await prisma.user.findUnique({ where: { username: adminUsername } });
      assert(admin?.role === 'admin' && admin.status === 'active', 'Admin account created');
      assert(!!admin && /^\$2[aby]\$/.test(admin.password), 'Admin password stored as bcrypt hash');

      const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
      const perms = JSON.parse(adminRole?.permissions || '{}');
      assert(perms.can_delete_invoice === false && perms.pos === true, 'Admin permissions chosen by the Developer are saved');

      const settings = await prisma.systemSetting.findMany({ where: { key: { in: ['backup_scheduled_time', 'store_name', 'license_mode', 'license_signature'] } } });
      const map = Object.fromEntries(settings.map(r => [r.key, r.value]));
      assert(map.backup_scheduled_time === '22:30', 'Backup time saved');
      assert(map.store_name === 'Test Medical Pharmacy', 'Store name saved');
      assert(map.license_mode === 'demo' && /^[0-9a-f]{64}$/.test(map.license_signature), 'Signed demo license saved');

      const license = await request('/license/status');
      assert(license.body.mode === 'demo' && license.body.daysLeft === 30 && license.body.expired === false, '30-day demo active');
    });

    await step('Setup is permanently locked afterwards', async () => {
      const statusRes = await request('/setup/status');
      assert(statusRes.body.isSetupCompleted === true, 'System is now marked setup_completed = true');

      const rerunUnlock = await request('/setup/unlock', { method: 'POST', body: JSON.stringify({ code: generateTotpCode(TEST_DEVELOPER_SECRET, nowSec() + 30) }) });
      assert(rerunUnlock.status === 403, 'Re-running setup unlock is forbidden (HTTP 403)');

      const rerunComplete = await request('/setup/complete', { method: 'POST', body: setupBody() });
      assert(rerunComplete.status === 403, 'Re-running setup completion is forbidden (HTTP 403)');
    });

    // ------------------------------------------------------------------------
    // 5. Developer Login & Rate Limiting Lockout
    // ------------------------------------------------------------------------
    await step('Developer login uses the master authenticator code once', async () => {
      const wrongEmail = await request('/auth/developer-login', {
        method: 'POST',
        body: JSON.stringify({ email: 'someone@else.local', code: generateTotpCode(TEST_DEVELOPER_SECRET, nowSec() + 30) })
      });
      assert(wrongEmail.status === 401, 'Only the fixed developer email can sign in');

      const code = generateTotpCode(TEST_DEVELOPER_SECRET, nowSec() + 30);
      const loginRes = await request('/auth/developer-login', { method: 'POST', body: JSON.stringify({ email: TEST_DEVELOPER_EMAIL, code }) });
      assert(loginRes.ok, `Developer login succeeds (${JSON.stringify(loginRes.body)})`);
      assert(loginRes.body.user.role === 'developer', 'User role is developer');
      assert(typeof loginRes.body.token === 'string', 'Session token returned');
      developerToken = loginRes.body.token;

      const replay = await request('/auth/developer-login', { method: 'POST', body: JSON.stringify({ email: TEST_DEVELOPER_EMAIL, code }) });
      assert(replay.status === 401, 'Replayed developer code rejected');
      await prisma.user.updateMany({ where: { role: 'developer' }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    });

    await step('Test Developer Rate Limiting and 15-Minute Account Lockout', async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        const failRes = await request('/auth/developer-login', {
          method: 'POST',
          body: JSON.stringify({ email: TEST_DEVELOPER_EMAIL, code: '000000' })
        });
        assert(failRes.status === 401, `Attempt ${attempt} rejected with 401`);
      }

      const lockRes = await request('/auth/developer-login', {
        method: 'POST',
        body: JSON.stringify({ email: TEST_DEVELOPER_EMAIL, code: '000000' })
      });
      assert(lockRes.status === 429, '5th failed attempt triggers HTTP 429 Lockout');
      assert(lockRes.body.error.includes('locked'), 'Lockout message returned');

      const lockedAttemptRes = await request('/auth/developer-login', {
        method: 'POST',
        body: JSON.stringify({ email: TEST_DEVELOPER_EMAIL, code: generateTotpCode(TEST_DEVELOPER_SECRET, nowSec() + 30) })
      });
      assert(lockedAttemptRes.status === 429, 'Locked account blocks even valid code while locked');

      await prisma.user.updateMany({ where: { role: 'developer' }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    });

    // ------------------------------------------------------------------------
    // 6. Sessions, Data Isolation & Security Boundaries
    // ------------------------------------------------------------------------
    await step('Verify sessions, credentials isolation and developer account protection', async () => {
      const devHeaders = { Authorization: `Bearer ${developerToken}` };
      const devUser = await prisma.user.findFirst({ where: { role: 'developer' } });
      assert(devUser !== null, 'Developer user exists');

      const noToken = await request('/users');
      assert(noToken.status === 401 && noToken.body.code === 'SESSION_REQUIRED', 'No session -> 401');

      const spoofed = await request('/users', { headers: { 'x-user-id': String(devUser!.id) } });
      assert(spoofed.status === 401, 'A spoofed x-user-id header is ignored');

      const usersRes = await request('/users', { headers: devHeaders });
      assert(usersRes.ok, 'Users endpoint returns 200 with a session');
      for (const u of usersRes.body) {
        assert(!('password' in u), 'Password strictly omitted from user response');
        assert(!('totp_secret' in u), 'totp_secret strictly omitted from user response');
        assert(!('totpSecret' in u), 'totpSecret strictly omitted from user response');
      }

      const createDevAttempt = await request('/users', {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({ username: 'fake_developer', password: 'password123', full_name: 'Imposter', role: 'developer' })
      });
      assert(createDevAttempt.status === 400, 'Cannot create developer user via standard /api/users');

      const deleteAttempt = await request(`/users/${devUser?.id}`, { method: 'DELETE', headers: devHeaders });
      assert(deleteAttempt.status === 400, 'Developer account cannot be deleted via /api/users/:id');

      const preLoginSettings = await request('/settings');
      assert(preLoginSettings.ok && preLoginSettings.body.store_name === 'Test Medical Pharmacy', 'Store name is public on the login screen');
      assert(preLoginSettings.body.backup_scheduled_time === undefined, 'Other settings stay private before login');
      const fullSettings = await request('/settings', { headers: devHeaders });
      assert(fullSettings.body.backup_scheduled_time === '22:30' && fullSettings.body.license_signature === undefined, 'Signed license never leaves the server');
    });

    // ------------------------------------------------------------------------
    // 7. Staff Login with Bcrypt
    // ------------------------------------------------------------------------
    await step('Verify Staff Login (Admin) with username + password and no TOTP', async () => {
      const wrong = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: adminUsername, password: 'wrong-password' }) });
      assert(wrong.status === 401, 'Wrong password rejected');

      const developerByPassword = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'developer', password: 'anything' }) });
      assert(developerByPassword.status === 401, 'Developer cannot sign in with a password');

      const adminLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: adminUsername, password: adminPassword }) });
      assert(adminLogin.ok, 'Admin logs in with the password the Developer set');
      assert(adminLogin.body.user.role === 'admin', 'Role is admin');
      assert(adminLogin.body.user.permissions?.can_delete_invoice === false, 'Admin gets the Developer-chosen permissions');

      const adminHeaders = { Authorization: `Bearer ${adminLogin.body.token}` };
      const me = await request('/users', { headers: adminHeaders });
      assert(me.ok, 'Admin session works');

      const logout = await request('/auth/logout', { method: 'POST', headers: adminHeaders });
      assert(logout.ok, 'Logout succeeds');
      const afterLogout = await request('/users', { headers: adminHeaders });
      assert(afterLogout.status === 401, 'Token is revoked after logout');
    });

    console.log(colors.bold(colors.green('\n======================================================')));
    console.log(colors.bold(colors.green(`  ALL ${testsPassed}/${testsTotal} PHASE 1 TESTS PASSED SUCCESSFULLY!  `)));
    console.log(colors.bold(colors.green('======================================================\n')));

    if (server) server.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error: any) {
    console.log(colors.bold(colors.red('\n======================================================')));
    console.log(colors.bold(colors.red(`  PHASE 1 TEST SUITE FAILED (${testsPassed}/${testsTotal} passed)  `)));
    console.log(colors.bold(colors.red('======================================================\n')));
    if (server) server.close();
    await prisma.$disconnect();
    process.exit(1);
  } finally {
    if (server) server.close();
    await prisma.$disconnect();
  }
}

runPhase1Tests();
