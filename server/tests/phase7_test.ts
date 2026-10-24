/**
 * PharmaCare Pro - Phase 7 Test Suite
 * Covers online backups to the owner's Google Drive: the backup type setting (Developer only), the Google
 * sign-in loopback flow, encrypted uploads, the offline retry queue, Drive retention, Online mode's small local
 * retention, restore from Drive (keeping the current connection) and disconnect.
 * Google is replaced by an in-memory fake behind a fetch stub, so the suite never touches the internet.
 */

import './testEnv';
import http from 'http';
import { app } from '../api';
import { adminAuthHeaders, authHeaders, ensureTestDeveloper, useFullTestLicense } from './testAuth';
import { prisma } from '../database/prisma';
import { countRetainedBackups } from '../database/backup';
import { resetCloudRetry, runCloudUploads } from '../backup/cloud/cloudBackup';
import { clearAccessTokenCache } from '../backup/cloud/googleDrive';

process.env.PHARMACARE_GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.PHARMACARE_GOOGLE_CLIENT_SECRET = 'test-client-secret';

const colors = {
  green: (t: string) => `\x1b[32m${t}\x1b[0m`,
  red: (t: string) => `\x1b[31m${t}\x1b[0m`,
  cyan: (t: string) => `\x1b[36m${t}\x1b[0m`,
  bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
};

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// -------------------------------------------------------------
// Fake Google (OAuth + Drive v3) behind a fetch stub
// -------------------------------------------------------------
interface FakeFile { id: string; name: string; parents: string[]; mimeType: string; data: Buffer; createdTime: string; appProperties: Record<string, string> }
const google = {
  networkDown: false,
  revoked: [] as string[],
  files: new Map<string, FakeFile>(),
  uploads: new Map<string, { name: string; parents: string[]; appProperties: Record<string, string> }>(),
  seq: 0,
  validRefresh: new Set(['rt-owner'])
};
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

async function fakeGoogle(url: URL, init: RequestInit = {}): Promise<Response> {
  if (google.networkDown) throw new TypeError('fetch failed');
  const method = (init.method || 'GET').toUpperCase();
  const auth = new Headers(init.headers).get('authorization');

  if (url.href.startsWith('https://oauth2.googleapis.com/token')) {
    const form = new URLSearchParams(String(init.body));
    if (form.get('grant_type') === 'authorization_code') {
      if (form.get('code') !== 'good-code' || !form.get('code_verifier')) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'at-owner', expires_in: 3600, refresh_token: 'rt-owner' });
    }
    if (!google.validRefresh.has(form.get('refresh_token') || '')) return json({ error: 'invalid_grant' }, 400);
    return json({ access_token: 'at-owner', expires_in: 3600 });
  }
  if (url.href.startsWith('https://oauth2.googleapis.com/revoke')) {
    google.revoked.push(url.searchParams.get('token') || '');
    return json({});
  }
  if (auth !== 'Bearer at-owner' && !url.searchParams.has('upload_id')) return json({ error: { message: 'Invalid Credentials' } }, 401);

  if (url.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'owner@gmail.test' } });

  if (url.pathname === '/upload/drive/v3/files') {
    if (method === 'POST') {
      const meta = JSON.parse(String(init.body));
      const uploadId = `u${++google.seq}`;
      google.uploads.set(uploadId, meta);
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${uploadId}` } });
    }
    const meta = google.uploads.get(url.searchParams.get('upload_id') || '');
    if (!meta) return json({ error: { message: 'Not found' } }, 404);
    const id = `f${++google.seq}`;
    google.files.set(id, {
      id, name: meta.name, parents: meta.parents, mimeType: 'application/octet-stream',
      data: Buffer.from(init.body as Uint8Array), createdTime: new Date(Date.now() + google.seq * 1000).toISOString(), appProperties: meta.appProperties
    });
    return json({ id });
  }

  if (url.pathname === '/drive/v3/files' && method === 'POST') {
    const meta = JSON.parse(String(init.body));
    const id = `d${++google.seq}`;
    google.files.set(id, { id, name: meta.name, parents: [], mimeType: meta.mimeType, data: Buffer.alloc(0), createdTime: new Date().toISOString(), appProperties: {} });
    return json({ id });
  }
  if (url.pathname === '/drive/v3/files') {
    const q = url.searchParams.get('q') || '';
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const list = [...google.files.values()].filter(f =>
      parent ? f.parents.includes(parent) && f.appProperties.pharmacare === 'backup' : f.mimeType === 'application/vnd.google-apps.folder' && q.includes(f.name)
    ).sort((a, b) => b.createdTime.localeCompare(a.createdTime));
    return json({ files: list.map(f => ({ id: f.id, name: f.name, size: String(f.data.length), createdTime: f.createdTime, appProperties: f.appProperties })) });
  }
  const fileId = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)?.[1];
  if (fileId) {
    const file = google.files.get(decodeURIComponent(fileId));
    if (method === 'DELETE') {
      google.files.delete(decodeURIComponent(fileId));
      return new Response(null, { status: file ? 204 : 404 });
    }
    if (!file) return json({ error: { message: 'File not found' } }, 404);
    if (url.searchParams.get('alt') === 'media') return new Response(new Uint8Array(file.data), { status: 200 });
    return json({ id: file.id, name: file.name, parents: file.parents, trashed: false, appProperties: file.appProperties });
  }
  return json({ error: { message: `Unhandled fake route ${method} ${url.pathname}` } }, 500);
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (/(^|\.)googleapis\.com$|^accounts\.google\.com$/.test(url.hostname)) return fakeGoogle(url, init);
  return realFetch(input, init);
}) as typeof fetch;

// -------------------------------------------------------------
let server: http.Server;
let baseUrl = '';

async function request(p: string, headers: Record<string, string>, options?: RequestInit) {
  const res = await realFetch(`${baseUrl}${p}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...headers, ...options?.headers },
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function setSetting(key: string, value: string) {
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** Waits until a backup's upload settles (uploaded, skipped, or failed with an error recorded). */
async function waitForUpload(historyId: number) {
  for (let i = 0; i < 100; i++) {
    const row = await prisma.backupHistory.findUnique({ where: { id: historyId } });
    if (row && (row.cloudStatus !== 'pending' || row.cloudError)) return row;
    await sleep(50);
  }
  throw new Error(`Upload of backup ${historyId} did not settle`);
}

async function runPhase7Tests() {
  console.log(colors.bold(colors.cyan('\n================================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Phase 7 Test Suite                           ')));
  console.log(colors.bold(colors.cyan('  (Online Backups to Google Drive)                              ')));
  console.log(colors.bold(colors.cyan('================================================================\n')));

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as any).port}/api`;
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

  const dev = await ensureTestDeveloper();
  const devHeaders = authHeaders(dev);
  const adminHeaders = await adminAuthHeaders();
  const backupNow = async () => {
    const res = await request('/utilities/backup', adminHeaders, { method: 'POST' });
    assert(res.status === 200, `Backup: expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.historyId as number;
  };

  try {
    await test('Setup status reports that this build can back up online', async () => {
      const res = await request('/setup/status', { Authorization: '' });
      assert(res.body.onlineBackupAvailable === true, 'onlineBackupAvailable true with a Google client configured');
      const locked = await request('/setup/cloud/connect', { Authorization: '' }, { method: 'POST', body: JSON.stringify({ setupToken: 'x' }) });
      assert(locked.status === 403, `Setup Drive connect after setup: expected 403, got ${locked.status}`);
    });

    await test('Backup type: Developer only, validated, never writable by the Admin', async () => {
      const bad = await request('/developer/settings', devHeaders, { method: 'PUT', body: JSON.stringify({ backup_mode: 'cloud' }) });
      assert(bad.status === 400, `Invalid mode: expected 400, got ${bad.status}`);
      await request('/settings', adminHeaders, { method: 'POST', body: JSON.stringify({ backup_mode: 'both' }) });
      const row = await prisma.systemSetting.findUnique({ where: { key: 'backup_mode' } });
      assert((row?.value ?? 'offline') === 'offline', `Admin could not change the backup type, got ${row?.value}`);
      const ok = await request('/developer/settings', devHeaders, { method: 'PUT', body: JSON.stringify({ backup_mode: 'both' }) });
      assert(ok.status === 200, `Developer sets Both: expected 200, got ${ok.status}`);
      const adminConnect = await request('/developer/cloud/connect', adminHeaders, { method: 'POST' });
      assert(adminConnect.status === 403, `Admin connect: expected 403, got ${adminConnect.status}`);
    });

    await test('A backup made before Drive is connected waits as pending', async () => {
      const id = await backupNow();
      const row = await prisma.backupHistory.findUnique({ where: { id } });
      assert(row?.cloudStatus === 'pending', `Expected pending, got ${row?.cloudStatus}`);
    });

    await test('Google sign-in: loopback redirect stores the account and uploads the waiting backup', async () => {
      const start = await request('/developer/cloud/connect', devHeaders, { method: 'POST' });
      assert(start.status === 200 && start.body.authUrl.startsWith('https://accounts.google.com/'), `Connect: ${start.status} ${JSON.stringify(start.body)}`);
      const auth = new URL(start.body.authUrl);
      assert(auth.searchParams.get('scope') === 'https://www.googleapis.com/auth/drive.file', 'Only the drive.file scope is requested');
      assert(auth.searchParams.get('code_challenge_method') === 'S256', 'PKCE is used');

      const redirect = new URL(auth.searchParams.get('redirect_uri')!);
      const wrongState = await realFetch(`${redirect.origin}/?code=good-code&state=forged`);
      assert(wrongState.status === 404, 'A forged state is ignored');
      const page = await realFetch(`${redirect.origin}/?code=good-code&state=${auth.searchParams.get('state')}`);
      assert(page.status === 200 && (await page.text()).includes('owner@gmail.test'), 'Browser page confirms the account');

      const status = await request('/developer/cloud', devHeaders);
      assert(status.body.connected && status.body.account_email === 'owner@gmail.test', `Connected: ${JSON.stringify(status.body)}`);
      assert(status.body.connect.status === 'connected', 'Progress reports connected');
      const stored = await prisma.systemSetting.findUnique({ where: { key: 'gdrive_refresh_token' } });
      assert(!!stored && !stored.value.includes('rt-owner'), 'The refresh token is stored encrypted');

      const pending = await prisma.backupHistory.findFirst({ where: { cloudStatus: { not: null } }, orderBy: { id: 'desc' } });
      const settled = await waitForUpload(pending!.id);
      assert(settled.cloudStatus === 'uploaded' && !!settled.cloudFileId, `Waiting backup uploaded, got ${settled.cloudStatus} ${settled.cloudError}`);
    });

    await test('Uploaded copies are encrypted and checksummed', async () => {
      const uploaded = [...google.files.values()].filter(f => f.appProperties.pharmacare === 'backup');
      assert(uploaded.length === 1, `One file in Drive, got ${uploaded.length}`);
      assert(uploaded[0].data.subarray(0, 4).toString() === 'PCB1', 'Encrypted file header');
      assert(!uploaded[0].data.includes(Buffer.from('SQLite format 3')), 'No plain database inside');
      assert(/^[0-9a-f]{64}$/.test(uploaded[0].appProperties.checksum), 'Checksum recorded');
      assert(uploaded[0].name.endsWith('.pcbackup'), `Name ${uploaded[0].name}`);
    });

    await test('Settings never expose the Google sign-in', async () => {
      const res = await request('/settings', devHeaders);
      assert(!Object.keys(res.body).some(k => k.startsWith('gdrive_')), 'No gdrive_* keys in /api/settings');
      await request('/settings', devHeaders, { method: 'POST', body: JSON.stringify({ gdrive_account_email: 'evil@x.test' }) });
      const row = await prisma.systemSetting.findUnique({ where: { key: 'gdrive_account_email' } });
      assert(row?.value === 'owner@gmail.test', 'gdrive_* keys cannot be written through /api/settings');
    });

    await test('Offline: the upload waits and retries with backoff; the newest backup supersedes older ones', async () => {
      google.networkDown = true;
      const first = await backupNow();
      const row = await waitForUpload(first);
      assert(row.cloudStatus === 'pending' && /internet/.test(row.cloudError || ''), `Pending with error, got ${row.cloudStatus} ${row.cloudError}`);
      const waiting = await runCloudUploads();
      assert(waiting.status === 'idle' && /retry/.test(waiting.reason), `Backoff respected, got ${JSON.stringify(waiting)}`);
      const status = await request('/backups/status', adminHeaders);
      assert(status.body.cloud.pending_count === 1 && !!status.body.cloud.next_retry_at, `Status shows waiting upload: ${JSON.stringify(status.body.cloud)}`);

      google.networkDown = false;
      const second = await backupNow();
      const settled = await waitForUpload(second);
      assert(settled.cloudStatus === 'uploaded', `Newest uploaded, got ${settled.cloudStatus}`);
      const older = await prisma.backupHistory.findUnique({ where: { id: first } });
      assert(older?.cloudStatus === 'skipped', `Older pending skipped, got ${older?.cloudStatus}`);
    });

    await test('Drive keeps only the retention limit', async () => {
      await setSetting('backup_retention_limit', '2');
      resetCloudRetry();
      for (let i = 0; i < 2; i++) await waitForUpload(await backupNow());
      const inDrive = [...google.files.values()].filter(f => f.appProperties.pharmacare === 'backup');
      assert(inDrive.length === 2, `Drive keeps 2, got ${inDrive.length}`);
    });

    await test('Online mode keeps only the newest copies on this computer', async () => {
      await setSetting('backup_retention_limit', '5');
      const res = await request('/developer/settings', devHeaders, { method: 'PUT', body: JSON.stringify({ backup_mode: 'online' }) });
      assert(res.status === 200, `Set Online: ${res.status}`);
      for (let i = 0; i < 3; i++) await waitForUpload(await backupNow());
      assert(countRetainedBackups() === 2, `2 local copies in Online mode, got ${countRetainedBackups()}`);
      const status = await request('/backups/status', adminHeaders);
      assert(status.body.retention_limit === 2, `Status shows the local limit, got ${status.body.retention_limit}`);
    });

    await test('Restore from Drive keeps the current Google connection', async () => {
      const list = await request('/utilities/cloud-backups', adminHeaders);
      assert(list.status === 200 && list.body.length > 0, `List: ${list.status} ${JSON.stringify(list.body)}`);
      const marker = `restore-marker-${Date.now()}`;
      await setSetting('store_phone', marker);
      // A sign-in stored in an old backup must not replace today's one
      const restored = await request('/utilities/restore-cloud', adminHeaders, { method: 'POST', body: JSON.stringify({ fileId: list.body[0].id }) });
      assert(restored.status === 200 && restored.body.success, `Restore: ${restored.status} ${JSON.stringify(restored.body)}`);
      const phone = await prisma.systemSetting.findUnique({ where: { key: 'store_phone' } });
      assert(phone?.value !== marker, 'Data came back from the online backup');
      const email = await prisma.systemSetting.findUnique({ where: { key: 'gdrive_account_email' } });
      assert(email?.value === 'owner@gmail.test', 'Google connection kept after restore');

      const foreign = await request('/utilities/restore-cloud', adminHeaders, { method: 'POST', body: JSON.stringify({ fileId: 'not-in-the-folder-123' }) });
      assert(foreign.status === 400, `Unknown file: expected 400, got ${foreign.status}`);
    });

    await test('Revoked access is reported and the backup stays pending', async () => {
      google.validRefresh.clear();
      resetCloudRetry();
      // Expire the cached access token so the revoked sign-in is noticed on the next upload
      clearAccessTokenCache();
      const id = await backupNow();
      const row = await waitForUpload(id);
      assert(row.cloudStatus === 'pending' && /Connect Google Drive again/.test(row.cloudError || ''), `Auth error, got ${row.cloudError}`);
      google.validRefresh.add('rt-owner');
    });

    await test('Disconnect revokes and forgets the Google sign-in', async () => {
      const res = await request('/developer/cloud/disconnect', devHeaders, { method: 'POST' });
      assert(res.status === 200, `Disconnect: ${res.status}`);
      assert(google.revoked.includes('rt-owner'), 'Token revoked at Google');
      const left = await prisma.systemSetting.count({ where: { key: { startsWith: 'gdrive_' } } });
      assert(left === 0, `No gdrive_* settings left, got ${left}`);
      const status = await request('/backups/status', adminHeaders);
      assert(status.body.cloud.connected === false, 'Status shows not connected');
    });
  } finally {
    await setSetting('backup_mode', 'offline');
    server.close();
  }

  console.log(colors.bold(`\nPhase 7: ${passed} passed, ${failed} failed\n`));
  if (failed > 0) process.exit(1);
}

runPhase7Tests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
