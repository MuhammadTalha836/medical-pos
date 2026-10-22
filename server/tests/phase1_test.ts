/**
 * PharmaCare Pro - Phase 1 End-to-End Test Suite
 * Covers: Password Hashing (Bcrypt), Offline RFC 6238 TOTP Engine,
 * Setup Wizard Flow, Offline Developer Login, Rate Limiting & Account Lockout,
 * and Data Isolation.
 */

process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

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

  // Check if port 3001 is already running, else start ephemeral server
  try {
    const probe = await fetch('http://localhost:3001/api/status').catch(() => null);
    if (probe && probe.ok) {
      baseUrl = 'http://localhost:3001/api';
    } else {
      await new Promise<void>((resolve) => {
        server = app.listen(0, () => {
          const addr = server.address() as any;
          baseUrl = `http://localhost:${addr.port}/api`;
          resolve();
        });
      });
    }
  } catch {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://localhost:${addr.port}/api`;
        resolve();
      });
    });
  }

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
    // 4. Setup Wizard Flow & Lockout
    // ------------------------------------------------------------------------
    let setupSecret = '';
    let setupTempToken = '';
    const testDevEmail = 'lead.developer@pharmacare.local';

    await step('Test Setup Wizard Initialization (Secret & QR Code)', async () => {
      // Temporarily clear setup_completed for testing setup wizard flow
      await prisma.systemSetting.upsert({
        where: { key: 'setup_completed' },
        update: { value: 'false' },
        create: { key: 'setup_completed', value: 'false' }
      });
      await prisma.user.deleteMany({ where: { role: 'developer' } });

      const statusRes = await request('/setup/status');
      assert(statusRes.ok, 'Setup status endpoint responds');
      assert(statusRes.body.isSetupCompleted === false, 'Setup status is not completed');

      // Initialize setup
      const initRes = await request('/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          developerEmail: testDevEmail,
          storeName: 'Test Medical Pharmacy',
          storeAddress: 'Test Commercial Ave'
        })
      });

      assert(initRes.ok, 'Initialize setup succeeds');
      assert(initRes.body.secret && initRes.body.qrCodeDataUrl, 'Returns secret and QR Code Data URL');
      assert(initRes.body.tempToken, 'Returns temporary encrypted setup token');

      setupSecret = initRes.body.secret;
      setupTempToken = initRes.body.tempToken;
    });

    await step('Test Setup Wizard Verification and Permanent Lockout', async () => {
      // 1. Submit invalid code -> must be rejected
      const badVerifyRes = await request('/setup/verify', {
        method: 'POST',
        body: JSON.stringify({
          developerEmail: testDevEmail,
          code: '999999', // Incorrect code
          tempToken: setupTempToken
        })
      });
      assert(badVerifyRes.status === 400, 'Invalid TOTP code rejected with HTTP 400');

      // 2. Submit valid code -> must succeed
      const validCode = generateTotpCode(setupSecret);
      const goodVerifyRes = await request('/setup/verify', {
        method: 'POST',
        body: JSON.stringify({
          developerEmail: testDevEmail,
          code: validCode,
          tempToken: setupTempToken,
          storeName: 'Test Medical Pharmacy',
          storeAddress: 'Test Commercial Ave',
          adminPassword: 'newAdminPassword123'
        })
      });

      assert(goodVerifyRes.ok, 'Valid TOTP code completes setup');
      assert(goodVerifyRes.body.user && goodVerifyRes.body.user.role === 'developer', 'Returns Developer user');

      // 3. Verify setup is now completed and locked
      const statusRes = await request('/setup/status');
      assert(statusRes.body.isSetupCompleted === true, 'System is now marked setup_completed = true');

      // 4. Attempting to re-run setup initialize must be strictly forbidden (HTTP 403)
      const rerunInitRes = await request('/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({ developerEmail: 'hacker@malicious.local' })
      });
      assert(rerunInitRes.status === 403, 'Re-running setup initialization is forbidden (HTTP 403)');

      // 5. Attempting to re-run setup verify must also be forbidden (HTTP 403)
      const rerunVerifyRes = await request('/setup/verify', {
        method: 'POST',
        body: JSON.stringify({
          developerEmail: 'hacker@malicious.local',
          code: '123456',
          tempToken: setupTempToken
        })
      });
      assert(rerunVerifyRes.status === 403, 'Re-running setup verification is forbidden (HTTP 403)');
    });

    // ------------------------------------------------------------------------
    // 5. Offline Developer Login & Rate Limiting Lockout
    // ------------------------------------------------------------------------
    await step('Test Offline Developer Login with Valid TOTP', async () => {
      const code = generateTotpCode(setupSecret);
      const loginRes = await request('/auth/developer-login', {
        method: 'POST',
        body: JSON.stringify({
          email: testDevEmail,
          code
        })
      });

      assert(loginRes.ok, 'Developer login succeeds with valid TOTP');
      assert(loginRes.body.user.role === 'developer', 'User role is developer');
      assert(loginRes.body.user.email === testDevEmail, 'User email matches');
    });

    await step('Test Developer Rate Limiting and 15-Minute Account Lockout', async () => {
      // Perform 5 consecutive failed login attempts
      for (let attempt = 1; attempt <= 4; attempt++) {
        const failRes = await request('/auth/developer-login', {
          method: 'POST',
          body: JSON.stringify({
            email: testDevEmail,
            code: '000000'
          })
        });
        assert(failRes.status === 401, `Attempt ${attempt} rejected with 401`);
      }

      // 5th failed attempt should trigger lockout (HTTP 429)
      const lockRes = await request('/auth/developer-login', {
        method: 'POST',
        body: JSON.stringify({
          email: testDevEmail,
          code: '000000'
        })
      });
      assert(lockRes.status === 429, '5th failed attempt triggers HTTP 429 Lockout');
      assert(lockRes.body.error.includes('locked'), 'Lockout message returned');

      // Subsequent attempt even with correct code should still be locked
      const validCode = generateTotpCode(setupSecret);
      const lockedAttemptRes = await request('/auth/developer-login', {
        method: 'POST',
        body: JSON.stringify({
          email: testDevEmail,
          code: validCode
        })
      });
      assert(lockedAttemptRes.status === 429, 'Locked account blocks even valid code while locked');

      // Clear lockout for further tests
      await prisma.user.updateMany({
        where: { email: testDevEmail },
        data: { failedLoginAttempts: 0, lockedUntil: null }
      });
    });

    // ------------------------------------------------------------------------
    // 6. Data Isolation & Security Boundaries
    // ------------------------------------------------------------------------
    await step('Verify Credentials Isolation and Developer Account Protection', async () => {
      // 1. GET /api/users must NEVER expose password or totp_secret
      const usersRes = await request('/users');
      assert(usersRes.ok, 'Users endpoint returns 200');
      for (const u of usersRes.body) {
        assert(!('password' in u), 'Password strictly omitted from user response');
        assert(!('totp_secret' in u), 'totp_secret strictly omitted from user response');
        assert(!('totpSecret' in u), 'totpSecret strictly omitted from user response');
      }

      // 2. Attempting to create a user with role 'developer' via standard API is rejected
      const createDevAttempt = await request('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: 'fake_developer',
          password: 'password123',
          full_name: 'Imposter',
          role: 'developer'
        })
      });
      assert(createDevAttempt.status === 400, 'Cannot create developer user via standard /api/users');

      // 3. Attempting to delete developer account via /api/users/:id is rejected
      const devUser = await prisma.user.findFirst({ where: { role: 'developer' } });
      assert(devUser !== null, 'Developer user exists');

      const deleteAttempt = await request(`/users/${devUser?.id}`, {
        method: 'DELETE'
      });
      assert(deleteAttempt.status === 400, 'Developer account cannot be deleted via /api/users/:id');
    });

    // ------------------------------------------------------------------------
    // 7. Staff Login with Bcrypt
    // ------------------------------------------------------------------------
    await step('Verify Staff Login (Admin / Cashier) with Bcrypt Verification', async () => {
      // Verify login with updated admin password
      const adminLogin = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'admin',
          password: 'newAdminPassword123'
        })
      });
      assert(adminLogin.ok, 'Admin logs in with bcrypt-hashed password');
      assert(adminLogin.body.user.role === 'admin', 'Role is admin');

      // Reset admin password to standard 'admin123' with bcrypt for ongoing tests
      const hashedDefault = await hashPassword('admin123');
      await prisma.user.updateMany({
        where: { username: 'admin' },
        data: { password: hashedDefault }
      });

      const resetLogin = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'admin',
          password: 'admin123'
        })
      });
      assert(resetLogin.ok, 'Admin logs in with admin123');
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
