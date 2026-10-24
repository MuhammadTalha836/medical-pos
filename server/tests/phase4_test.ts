/**
 * PharmaCare Pro - Phase 4 Test Suite
 * Covers:
 *  - Schedule math: daily / twice-daily / weekly slots, missed-run catch-up, failure backoff, clock rollback, off
 *  - TC-11: retention keeps exactly N verified backups, pruning only after a verified success
 *  - Failed backups never prune and never remove the last known-good backup
 *  - Pre-restore safety snapshots are kept separately from the retention limit
 *  - Backup verification (integrity_check) and restore guard against corrupt files
 *  - Scheduler tick end-to-end (success, failure recording, retry backoff)
 *  - RBAC on backup endpoints, Admin time-of-day only, Developer policy validation, status endpoint
 *
 * All backups are written to a temporary folder; settings and history rows are restored afterwards,
 * so the real backups/ folder is never touched.
 */

process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import './testEnv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import Database from 'better-sqlite3';
import { app } from '../api';
import { authHeaders, adminAuthHeaders, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { db } from '../database/db';
import { hashPassword } from '../security/passwords';
import {
  createBackup,
  verifyBackupFile,
  pruneBackupsByRetentionLimit,
  countRetainedBackups,
  PRE_RESTORE_KEEP
} from '../database/backup';
import { computeSchedule, runSchedulerTick, FAILURE_RETRY_MS } from '../backup/scheduler';

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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let server: http.Server | undefined;
let baseUrl: string;

// Explicitly no session (the request helper otherwise signs requests in as an admin)
const ANONYMOUS = { Authorization: '' };

async function request(p: string, options?: RequestInit) {
  const auth = options?.headers && 'Authorization' in (options.headers as Record<string, string>) ? {} : await adminAuthHeaders();
  const res = await fetch(`${baseUrl}${p}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...auth, ...options?.headers },
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

const TOUCHED_SETTING_KEYS = [
  'backup_retention_limit',
  'backup_frequency',
  'backup_scheduled_time',
  'backup_weekly_day',
  'auto_backup_dir',
  'secondary_backup_dir',
  'auto_backup_enabled',
  'last_backup_time',
  'last_backup_file',
  'last_backup_status',
  'last_backup_error',
  'last_backup_attempt_at',
  'last_backup_type'
];

async function getRawSetting(key: string): Promise<string | undefined> {
  return (await prisma.systemSetting.findUnique({ where: { key } }))?.value;
}

async function setRawSetting(key: string, value: string) {
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

function dbFilesIn(dir: string, typeFragment?: string): string[] {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.db') && (!typeFragment || f.includes(typeFragment)))
    .sort();
}

/** Local-time date helper: (year, month 1-12, day, hour, minute) */
function at(y: number, mo: number, d: number, h: number, mi = 0, s = 0): Date {
  return new Date(y, mo - 1, d, h, mi, s);
}

async function runPhase4Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase 4 Test Suite                           ')));
  console.log(colors.bold(colors.cyan('  (Backup Retention, Verification, Offline Scheduler, RBAC)     ')));
  console.log(colors.bold(colors.cyan('================================================================\n')));

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server!.address() as any;
      baseUrl = `http://localhost:${addr.port}/api`;
      resolve();
    });
  });
  await useFullTestLicense();
  console.log(`[Phase4 Test] Target API: ${baseUrl}\n`);

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
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

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacare-phase4-'));
  const retentionDir = path.join(tmpRoot, 'retention');
  const schedulerDir = path.join(tmpRoot, 'scheduler');
  const blockerFile = path.join(tmpRoot, 'not-a-folder');
  fs.writeFileSync(blockerFile, 'this file blocks backups from being written here');

  const stamp = Date.now();
  const hashedPw = await hashPassword('password123');
  const createdUserIds: number[] = [];

  let devUser = await prisma.user.findFirst({ where: { role: 'developer' } });
  if (!devUser) {
    devUser = await prisma.user.create({
      data: { username: `dev_p4_${stamp}`, password: hashedPw, fullName: 'Dev P4', role: 'developer', status: 'active', email: 'dev-p4@test.local' }
    });
    createdUserIds.push(devUser.id);
  }
  const adminUser = await prisma.user.create({
    data: { username: `admin_p4_${stamp}`, password: hashedPw, fullName: 'Admin P4', role: 'admin', status: 'active' }
  });
  const cashierUser = await prisma.user.create({
    data: { username: `cashier_p4_${stamp}`, password: hashedPw, fullName: 'Cashier P4', role: 'cashier', status: 'active' }
  });
  createdUserIds.push(adminUser.id, cashierUser.id);

  const devHeaders = authHeaders(devUser);
  const adminHeaders = authHeaders(adminUser);
  const cashierHeaders = authHeaders(cashierUser);

  try {
    // Keep backups of this run away from any real secondary drive
    await setRawSetting('secondary_backup_dir', '');

    // -------------------------------------------------------------
    // 1. Schedule math (pure)
    // -------------------------------------------------------------
    await test('Schedule: daily backup is not due before its time and points at today\'s slot', () => {
      const r = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 9, 23, 5), now: at(2026, 10, 10, 22, 0) });
      assert(r.enabled && !r.isDue, 'should not be due before 23:00');
      assert(r.nextRunAt?.getTime() === at(2026, 10, 10, 23, 0).getTime(), `next run should be 23:00 today, got ${r.nextRunAt}`);
    });

    await test('Schedule: daily backup is due after its time and quiet after a success', () => {
      const due = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 9, 23, 5), now: at(2026, 10, 10, 23, 30) });
      assert(due.isDue, 'should be due after 23:00');
      const done = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 10, 23, 31), now: at(2026, 10, 10, 23, 40) });
      assert(!done.isDue, 'should not be due after a successful backup');
      assert(done.nextRunAt?.getTime() === at(2026, 10, 11, 23, 0).getTime(), `next run should be tomorrow 23:00, got ${done.nextRunAt}`);
    });

    await test('Schedule: every-12-hours runs at T and T+12h', () => {
      const afternoon = computeSchedule({ frequency: 'twice_daily', time: '09:30', lastSuccessAt: at(2026, 10, 10, 9, 31), now: at(2026, 10, 10, 15, 0) });
      assert(!afternoon.isDue, 'should not be due between slots');
      assert(afternoon.nextRunAt?.getTime() === at(2026, 10, 10, 21, 30).getTime(), `next slot should be 21:30, got ${afternoon.nextRunAt}`);
      const night = computeSchedule({ frequency: 'twice_daily', time: '09:30', lastSuccessAt: at(2026, 10, 10, 9, 31), now: at(2026, 10, 10, 22, 0) });
      assert(night.isDue, 'should be due after the 21:30 slot');
    });

    await test('Schedule: weekly runs only on the configured weekday', () => {
      // Find a Wednesday (3) in October 2026
      let wed = at(2026, 10, 1, 10, 0);
      while (wed.getDay() !== 3) wed = new Date(wed.getFullYear(), wed.getMonth(), wed.getDate() + 1, 10, 0);
      const tue = new Date(wed.getFullYear(), wed.getMonth(), wed.getDate() - 1, 12, 0);
      const lastWeek = new Date(wed.getFullYear(), wed.getMonth(), wed.getDate() - 7, 10, 5);

      const before = computeSchedule({ frequency: 'weekly', time: '10:00', weekday: 3, lastSuccessAt: lastWeek, now: tue });
      assert(!before.isDue, 'should not be due on Tuesday');
      assert(before.nextRunAt?.getTime() === wed.getTime(), `next run should be Wednesday 10:00, got ${before.nextRunAt}`);

      const onDay = computeSchedule({
        frequency: 'weekly', time: '10:00', weekday: 3, lastSuccessAt: lastWeek,
        now: new Date(wed.getFullYear(), wed.getMonth(), wed.getDate(), 11, 0)
      });
      assert(onDay.isDue, 'should be due on Wednesday after 10:00');
    });

    await test('Schedule: 3 days powered off produces exactly one catch-up backup', () => {
      const now = at(2026, 10, 10, 8, 0);
      const missed = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 6, 23, 1), now });
      assert(missed.isDue, 'missed runs should trigger a catch-up');
      assert(missed.latestDueSlot?.getTime() === at(2026, 10, 9, 23, 0).getTime(), 'catch-up targets the most recent slot');
      const afterCatchUp = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 10, 8, 0, 30), now: at(2026, 10, 10, 8, 1) });
      assert(!afterCatchUp.isDue, 'only one catch-up backup should run');
    });

    await test('Schedule: failed attempt waits 15 minutes before retrying', () => {
      const now = at(2026, 10, 10, 23, 20);
      const recent = computeSchedule({
        frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 9, 23, 1),
        lastAttemptAt: new Date(now.getTime() - 5 * 60 * 1000), lastAttemptFailed: true, now
      });
      assert(!recent.isDue, 'should back off after a recent failure');
      assert(recent.nextRunAt?.getTime() === now.getTime() - 5 * 60 * 1000 + FAILURE_RETRY_MS, 'retry time should be attempt + 15 min');

      const older = computeSchedule({
        frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 9, 23, 1),
        lastAttemptAt: new Date(now.getTime() - 20 * 60 * 1000), lastAttemptFailed: true, now
      });
      assert(older.isDue, 'should retry once the backoff has passed');
    });

    await test('Schedule: clock moved backwards still produces a backup', () => {
      const now = at(2026, 10, 10, 23, 30);
      const r = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 12, 23, 0), now });
      assert(r.isDue, 'a last success in the future must not block backups');
    });

    await test('Schedule: off is never due and has no next run', () => {
      const r = computeSchedule({ frequency: 'off', time: '23:00', lastSuccessAt: null, now: at(2026, 10, 10, 23, 30) });
      assert(!r.enabled && !r.isDue && r.nextRunAt === null, 'off should disable the schedule');
    });

    // -------------------------------------------------------------
    // 2. TC-11: retention keeps exactly N verified backups
    // -------------------------------------------------------------
    await setRawSetting('backup_retention_limit', '4');
    const createdBackups: string[] = [];

    await test('TC-11: with a limit of 4, six backups leave exactly the newest 4 on disk', async () => {
      for (let i = 0; i < 6; i++) {
        const result = await createBackup(i % 2 === 0 ? 'manual' : 'scheduled', retentionDir);
        createdBackups.push(result.filename);
        await sleep(5);
      }
      const remaining = dbFilesIn(retentionDir);
      assert(remaining.length === 4, `expected 4 backups, found ${remaining.length}`);
      const newest4 = createdBackups.slice(-4).sort();
      assert(JSON.stringify(remaining) === JSON.stringify(newest4), 'the newest 4 backups must be the ones kept');
      for (const f of remaining) {
        assert(fs.existsSync(path.join(retentionDir, `${f}.sha256`)), `missing checksum sidecar for ${f}`);
      }
      const sidecars = fs.readdirSync(retentionDir).filter(f => f.endsWith('.sha256'));
      assert(sidecars.length === 4, `pruned backups must take their sidecars with them (found ${sidecars.length})`);
      assert(countRetainedBackups(retentionDir) === 4, 'history should track 4 retained backups');
    });

    await test('TC-11: every retained backup is verified and passes integrity_check', () => {
      for (const f of dbFilesIn(retentionDir)) {
        const row = db.prepare('SELECT status, verified, checksum_sha256 FROM backup_history WHERE backup_filename = ?').get(f) as any;
        assert(row && row.status === 'success' && row.verified === 1, `${f} is not recorded as verified`);
        assert(typeof row.checksum_sha256 === 'string' && row.checksum_sha256.length === 64, `${f} has no checksum`);
        const check = new Database(path.join(retentionDir, f), { readonly: true });
        const integrity = (check.pragma('integrity_check') as any[])[0].integrity_check;
        check.close();
        assert(integrity === 'ok', `${f} integrity_check returned ${integrity}`);
      }
      const leftovers = fs.readdirSync(retentionDir).filter(f => f.endsWith('.partial') || f.endsWith('-wal') || f.endsWith('-shm'));
      assert(leftovers.length === 0, `temporary files left behind: ${leftovers.join(', ')}`);
    });

    await test('TC-11: lowering the limit prunes oldest first and never below one backup', () => {
      pruneBackupsByRetentionLimit(2, retentionDir);
      const after = dbFilesIn(retentionDir);
      const newest2 = createdBackups.slice(-2).sort();
      assert(JSON.stringify(after) === JSON.stringify(newest2), `should keep the newest 2, kept ${after.join(', ')}`);
      pruneBackupsByRetentionLimit(0, retentionDir);
      const last = dbFilesIn(retentionDir);
      assert(last.length === 1 && last[0] === createdBackups[createdBackups.length - 1], 'a limit below 1 must still keep the newest backup');
    });

    // -------------------------------------------------------------
    // 3. Failed backup never prunes
    // -------------------------------------------------------------
    await test('Failure: a failed backup is recorded and does not delete the last known-good backup', async () => {
      await setRawSetting('backup_retention_limit', '1');
      const goodBefore = dbFilesIn(retentionDir);
      let threw = false;
      try {
        await createBackup('manual', blockerFile);
      } catch {
        threw = true;
      }
      assert(threw, 'backup into a blocked location should throw');
      const failedRow = db.prepare("SELECT status, verified, error_message FROM backup_history WHERE backup_path LIKE ? ORDER BY id DESC").get(`${blockerFile}%`) as any;
      assert(failedRow && failedRow.status === 'failed' && failedRow.verified === 0, 'failed attempt must be recorded');
      assert(!!failedRow.error_message, 'failed attempt must record an error message');
      assert(JSON.stringify(dbFilesIn(retentionDir)) === JSON.stringify(goodBefore), 'existing good backups must be untouched');
      await setRawSetting('backup_retention_limit', '4');
    });

    await test('Failure: failed history rows never count toward the retention limit', async () => {
      await createBackup('manual', retentionDir);
      assert(countRetainedBackups(retentionDir) === dbFilesIn(retentionDir).length, 'retained count must equal verified files on disk');
    });

    // -------------------------------------------------------------
    // 4. Pre-restore snapshots are separate
    // -------------------------------------------------------------
    await test(`Pre-restore: safety snapshots do not count toward N and keep the newest ${PRE_RESTORE_KEEP}`, async () => {
      const routineBefore = countRetainedBackups(retentionDir);
      for (let i = 0; i < PRE_RESTORE_KEEP + 2; i++) {
        await createBackup('pre_restore', retentionDir);
        await sleep(5);
      }
      assert(countRetainedBackups(retentionDir) === routineBefore, 'pre-restore snapshots changed the routine count');
      assert(dbFilesIn(retentionDir, '_pre_restore_').length === PRE_RESTORE_KEEP, `expected ${PRE_RESTORE_KEEP} pre-restore snapshots`);
    });

    // -------------------------------------------------------------
    // 5. Verification
    // -------------------------------------------------------------
    const garbageFile = path.join(tmpRoot, 'garbage.db');
    const truncatedFile = path.join(tmpRoot, 'truncated.db');
    fs.writeFileSync(garbageFile, 'definitely not a database');

    await test('Verify: rejects a non-SQLite file and a truncated backup, accepts a real one', () => {
      const real = path.join(retentionDir, dbFilesIn(retentionDir, '_manual_').pop()!);
      const bytes = fs.readFileSync(real);
      fs.writeFileSync(truncatedFile, bytes.subarray(0, Math.floor(bytes.length / 2)));

      assert(!verifyBackupFile(garbageFile).ok, 'garbage file should fail verification');
      assert(!verifyBackupFile(truncatedFile).ok, 'truncated backup should fail verification');
      assert(!verifyBackupFile(path.join(tmpRoot, 'missing.db')).ok, 'missing file should fail verification');
      assert(verifyBackupFile(real).ok, `real backup should pass: ${verifyBackupFile(real).error}`);
    });

    await test('Restore guard: a corrupt file is rejected before the live database is touched', async () => {
      const preRestoreRowsBefore = (db.prepare("SELECT COUNT(*) as c FROM backup_history WHERE backup_type = 'pre_restore'").get() as any).c;
      const res = await request('/utilities/restore', {
        method: 'POST',
        headers: devHeaders,
        body: JSON.stringify({ backupFilePath: truncatedFile })
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
      assert(String(res.body.error).includes('verification'), `unexpected error: ${res.body.error}`);
      const preRestoreRowsAfter = (db.prepare("SELECT COUNT(*) as c FROM backup_history WHERE backup_type = 'pre_restore'").get() as any).c;
      assert(preRestoreRowsAfter === preRestoreRowsBefore, 'no safety snapshot should be taken for a rejected restore');
    });

    // -------------------------------------------------------------
    // 6. Scheduler tick end-to-end (writes only into the temp folder)
    // -------------------------------------------------------------
    await test('Scheduler: a due slot creates a verified scheduled backup and records success', async () => {
      await setRawSetting('auto_backup_dir', schedulerDir);
      await setRawSetting('backup_frequency', 'daily');
      await setRawSetting('backup_scheduled_time', '00:00');
      await setRawSetting('last_backup_time', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString());
      await setRawSetting('last_backup_status', 'success');

      const ran = await runSchedulerTick();
      assert(ran, 'tick should run a backup for the missed slot');
      assert(dbFilesIn(schedulerDir, '_scheduled_').length === 1, 'one scheduled backup should exist');
      assert((await getRawSetting('last_backup_status')) === 'success', 'status should be success');

      const again = await runSchedulerTick();
      assert(!again, 'a second tick must not create another backup for the same slot');
    });

    await test('Scheduler: a failed run keeps the last success time and backs off before retrying', async () => {
      const lastGood = await getRawSetting('last_backup_time');
      await setRawSetting('last_backup_time', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString());
      const staleSuccess = await getRawSetting('last_backup_time');
      await setRawSetting('auto_backup_dir', blockerFile);

      const ran = await runSchedulerTick();
      assert(ran, 'tick should attempt the backup');
      assert((await getRawSetting('last_backup_status')) === 'failed', 'status should be failed');
      assert(!!(await getRawSetting('last_backup_error')), 'failure message should be stored');
      assert((await getRawSetting('last_backup_time')) === staleSuccess, 'last success time must not change on failure');
      assert(dbFilesIn(schedulerDir).length === 1, 'the earlier good scheduled backup must remain');

      const retry = await runSchedulerTick();
      assert(!retry, 'an immediate retry must wait for the backoff');
      assert(lastGood !== undefined, 'sanity');
    });

    await test('Status: dashboard endpoint reports failure, next run and retention', async () => {
      const res = await request('/backups/status', { headers: devHeaders });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.body.last_status === 'failed' && !!res.body.last_error, 'failure should be reported');
      assert(res.body.enabled === true && typeof res.body.next_run_at === 'string', 'next run should be reported');
      assert(res.body.retention_limit === 4, `retention limit should be 4, got ${res.body.retention_limit}`);
      assert(typeof res.body.retained_count === 'number', 'retained count should be reported');
    });

    await test('Status: requires sign-in and hides file paths from cashiers', async () => {
      const anon = await request('/backups/status', { headers: ANONYMOUS });
      assert(anon.status === 401, `expected 401 for anonymous, got ${anon.status}`);
      await setRawSetting('last_backup_file', path.join(schedulerDir, 'example.db'));
      const cashier = await request('/backups/status', { headers: cashierHeaders });
      assert(cashier.status === 200, `expected 200, got ${cashier.status}`);
      assert(cashier.body.last_backup_file === null, 'cashier must not see backup file paths');
      const dev = await request('/backups/status', { headers: devHeaders });
      assert(dev.body.last_backup_file !== null, 'developer should see the backup file path');
    });

    // -------------------------------------------------------------
    // 7. RBAC and policy validation
    // -------------------------------------------------------------
    await test('RBAC: Cashier and anonymous users cannot list, create or restore backups', async () => {
      // No session -> 401 before any route runs; a signed-in cashier -> 403
      for (const [headers, expected] of [[cashierHeaders, 403], [ANONYMOUS, 401]] as const) {
        const list = await request('/utilities/backups', { headers });
        const create = await request('/utilities/backup', { method: 'POST', headers });
        const restore = await request('/utilities/restore', { method: 'POST', headers, body: JSON.stringify({ backupFilePath: garbageFile }) });
        assert(list.status === expected && create.status === expected && restore.status === expected,
          `expected ${expected}s, got list=${list.status} create=${create.status} restore=${restore.status}`);
      }
      const audit = await prisma.auditLog.findFirst({ where: { module: 'BACKUP', status: 'FAILED', userId: cashierUser.id } });
      assert(!!audit, 'denied backup access should be audited');
    });

    await test('RBAC: Admin can list backups and set only the time of day', async () => {
      const list = await request('/utilities/backups', { headers: adminHeaders });
      assert(list.status === 200, `admin list expected 200, got ${list.status}`);

      const ok = await request('/backups/schedule', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ backup_scheduled_time: '02:15' }) });
      assert(ok.status === 200, `expected 200, got ${ok.status}`);
      assert((await getRawSetting('backup_scheduled_time')) === '02:15', 'time was not saved');

      const freq = await request('/backups/schedule', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ backup_scheduled_time: '03:00', backup_frequency: 'off' }) });
      assert(freq.status === 400, `frequency change by admin should be 400, got ${freq.status}`);
      assert((await getRawSetting('backup_frequency')) === 'daily', 'admin changed the frequency');

      for (const bad of ['25:00', '7:5', 'noon', '']) {
        const res = await request('/backups/schedule', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ backup_scheduled_time: bad }) });
        assert(res.status === 400, `time "${bad}" should be rejected, got ${res.status}`);
      }

      const cashier = await request('/backups/schedule', { method: 'PUT', headers: cashierHeaders, body: JSON.stringify({ backup_scheduled_time: '04:00' }) });
      assert(cashier.status === 403, `cashier schedule change should be 403, got ${cashier.status}`);
    });

    await test('RBAC: Admin cannot switch automatic backups off or change frequency via /settings', async () => {
      await request('/settings', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ auto_backup_enabled: 'false', backup_frequency: 'off', last_backup_status: 'success' })
      });
      assert((await getRawSetting('backup_frequency')) === 'daily', 'admin changed backup_frequency');
      assert((await getRawSetting('last_backup_status')) === 'failed', 'admin overwrote backup run state');
    });

    await test('Developer: invalid frequency, weekday, time and retention values are rejected', async () => {
      const cases: Record<string, string>[] = [
        { backup_frequency: 'hourly' },
        { backup_frequency: 'on_shift_close' },
        { backup_weekly_day: '7' },
        { backup_scheduled_time: '24:00' },
        { backup_retention_limit: '0' },
        { backup_retention_limit: '366' },
        { backup_retention_limit: '2.5' }
      ];
      for (const body of cases) {
        const res = await request('/developer/settings', { method: 'PUT', headers: devHeaders, body: JSON.stringify(body) });
        assert(res.status === 400, `${JSON.stringify(body)} should be rejected, got ${res.status}`);
      }
    });

    await test('Developer: can set weekly frequency and weekday; off disables the schedule', async () => {
      // Start from a fresh success so the next run is the weekly slot rather than a failure retry
      await setRawSetting('last_backup_time', new Date().toISOString());
      await setRawSetting('last_backup_status', 'success');
      const weekly = await request('/developer/settings', {
        method: 'PUT', headers: devHeaders, body: JSON.stringify({ backup_frequency: 'weekly', backup_weekly_day: '3' })
      });
      assert(weekly.status === 200, `expected 200, got ${weekly.status}`);
      const status = await request('/backups/status', { headers: devHeaders });
      assert(status.body.frequency === 'weekly' && status.body.weekly_day === 3, 'weekly schedule not reported');
      assert(!status.body.is_overdue, 'should not be overdue right after a success');
      assert(new Date(status.body.next_run_at).getDay() === 3, `next run should fall on a Wednesday, got ${status.body.next_run_at}`);

      await request('/developer/settings', { method: 'PUT', headers: devHeaders, body: JSON.stringify({ backup_frequency: 'off' }) });
      const off = await request('/backups/status', { headers: devHeaders });
      assert(off.body.enabled === false && off.body.next_run_at === null, 'off should disable the schedule');
      const tick = await runSchedulerTick();
      assert(!tick, 'no scheduled backup may run while off');
    });
  } finally {
    // -------------------------------------------------------------
    // Cleanup: restore settings, remove temp backups and their history rows, remove test users
    // -------------------------------------------------------------
    for (const key of TOUCHED_SETTING_KEYS) {
      const value = originalSettings[key];
      if (value === undefined) {
        await prisma.systemSetting.deleteMany({ where: { key } });
      } else {
        await setRawSetting(key, value);
      }
    }
    db.prepare('DELETE FROM backup_history WHERE backup_path LIKE ?').run(`${tmpRoot}%`);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (createdUserIds.length > 0) {
      await prisma.auditLog.updateMany({ where: { userId: { in: createdUserIds } }, data: { userId: null } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  }

  console.log(colors.bold(colors.cyan('\n------------------------------------------------------')));
  console.log(colors.bold(`Phase 4 Tests: ${colors.green(String(passed) + ' Passed')}, ${failed > 0 ? colors.red(String(failed) + ' Failed') : '0 Failed'}`));
  console.log(colors.bold(colors.cyan('------------------------------------------------------\n')));

  server?.closeAllConnections();
  server?.close();
  await prisma.$disconnect();
  process.exitCode = failed > 0 ? 1 : 0;
}

runPhase4Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
