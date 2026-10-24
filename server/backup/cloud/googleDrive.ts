import crypto from 'crypto';
import http from 'http';
import { getGoogleOAuthClient } from '../../security/developerKey';

/**
 * Minimal Google Drive client over plain fetch (no SDK). Sign-in uses the installed-app flow Google
 * recommends for desktop apps: the system browser + a one-time loopback redirect on 127.0.0.1 + PKCE.
 * The `drive.file` scope only reaches files and folders this app created, never the owner's other files.
 */
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DRIVE_URL = 'https://www.googleapis.com/drive/v3';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const BACKUP_FOLDER_NAME = '100% Offline POS Backups';
/** appProperties marker on every file this app uploads */
const BACKUP_MARKER = { key: 'pharmacare', value: 'backup' };

const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export class DriveAuthError extends Error {
  constructor(message = 'Google Drive access was removed or has expired. Connect Google Drive again.') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

export function isDriveConfigured(): boolean {
  return getGoogleOAuthClient() !== null;
}

function requireClient() {
  const client = getGoogleOAuthClient();
  if (!client) throw new Error('Online backup is not available in this build. Ask the developer to enable it.');
  return client;
}

async function driveFetch(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error('Could not reach Google Drive. Check the internet connection.');
  }
}

async function failure(res: Response, what: string): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: string | { message?: string }; error_description?: string };
    detail = typeof body.error === 'string' ? body.error_description || body.error : body.error?.message || '';
  } catch {
    // Non-JSON error body
  }
  if (res.status === 401 || detail === 'invalid_grant' || /invalid_grant|revoked|expired/i.test(detail)) {
    return new DriveAuthError();
  }
  return new Error(`${what} failed (${res.status})${detail ? `: ${detail}` : ''}`);
}

// -------------------------------------------------------------
// Tokens
// -------------------------------------------------------------
interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = requireClient();
  const res = await driveFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString()
  });
  if (!res.ok) throw await failure(res, 'Google sign-in');
  return (await res.json()) as TokenResponse;
}

let cachedAccess: { refreshToken: string; token: string; expiresAt: number } | null = null;

/** A short-lived access token for the stored refresh token, cached until a minute before it expires. */
export async function getAccessToken(refreshToken: string): Promise<string> {
  if (cachedAccess && cachedAccess.refreshToken === refreshToken && cachedAccess.expiresAt > Date.now() + 60_000) {
    return cachedAccess.token;
  }
  const res = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  cachedAccess = { refreshToken, token: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 };
  return res.access_token;
}

export function clearAccessTokenCache() {
  cachedAccess = null;
}

/** Best effort: tells Google to forget this app's access for the account. */
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    await driveFetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' });
  } catch {
    // Offline: the stored token is deleted anyway
  }
  clearAccessTokenCache();
}

// -------------------------------------------------------------
// Sign-in (installed-app loopback flow)
// -------------------------------------------------------------
export interface DriveConnection {
  refreshToken: string;
  email: string;
}

export type ConnectProgress =
  | { status: 'idle' }
  | { status: 'waiting'; startedAt: string }
  | { status: 'connected'; email: string }
  | { status: 'failed'; error: string };

let progress: ConnectProgress = { status: 'idle' };
let pending: { server: http.Server; timer: NodeJS.Timeout } | null = null;

function closePending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.server.close();
  pending = null;
}

export function getConnectProgress(): ConnectProgress {
  return progress;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
}

function resultPage(title: string, message: string): string {
  message = escapeHtml(message);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="max-width:420px;text-align:center"><h1 style="color:#2dd4bf;font-size:22px">${title}</h1><p style="font-size:15px;line-height:1.5">${message}</p></div></body></html>`;
}

/**
 * Starts a Google sign-in and returns the page to open in the system browser. When the owner allows access,
 * Google redirects to a one-time listener on 127.0.0.1; the code is exchanged for a refresh token and handed
 * to `onConnected` (which stores it). Poll `getConnectProgress()` for the outcome.
 */
export async function startConnect(onConnected: (connection: DriveConnection) => Promise<void>): Promise<{ authUrl: string }> {
  const { clientId } = requireClient();
  closePending();

  const state = crypto.randomBytes(16).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  server.on('request', async (req, res) => {
    const url = new URL(req.url || '/', redirectUri);
    if (url.pathname !== '/' || url.searchParams.get('state') !== state) {
      res.writeHead(404).end();
      return;
    }
    const send = (status: number, title: string, message: string) =>
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(resultPage(title, message));

    const code = url.searchParams.get('code');
    try {
      if (!code) throw new Error(url.searchParams.get('error') === 'access_denied' ? 'Google Drive access was not allowed.' : 'Google sign-in was cancelled.');
      const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
      if (!tokens.refresh_token) throw new Error('Google did not return a lasting sign-in. Remove the app from the Google account and connect again.');
      cachedAccess = { refreshToken: tokens.refresh_token, token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
      const email = await getAccountEmail(tokens.access_token);
      await onConnected({ refreshToken: tokens.refresh_token, email });
      progress = { status: 'connected', email };
      send(200, 'Google Drive connected', `Backups will be saved to ${email}. You can close this tab and return to 100% Offline POS.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      progress = { status: 'failed', error: message };
      send(400, 'Google Drive not connected', `${message} Close this tab and try again from 100% Offline POS.`);
    } finally {
      closePending();
    }
  });

  const timer = setTimeout(() => {
    progress = { status: 'failed', error: 'Google sign-in timed out. Try connecting again.' };
    closePending();
  }, CONNECT_TIMEOUT_MS);
  timer.unref();
  pending = { server, timer };
  progress = { status: 'waiting', startedAt: new Date().toISOString() };

  const authUrl = `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  }).toString()}`;
  return { authUrl };
}

export function cancelConnect() {
  closePending();
  progress = { status: 'idle' };
}

// -------------------------------------------------------------
// Drive files
// -------------------------------------------------------------
function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function getAccountEmail(token: string): Promise<string> {
  const res = await driveFetch(`${DRIVE_URL}/about?fields=user(emailAddress)`, { headers: auth(token) });
  if (!res.ok) throw await failure(res, 'Reading the Google account');
  const body = (await res.json()) as { user?: { emailAddress?: string } };
  return body.user?.emailAddress || 'Google account';
}

/** Returns the app's backup folder, creating it when it is missing or was deleted. */
export async function ensureBackupFolder(token: string, knownId?: string): Promise<string> {
  if (knownId) {
    const res = await driveFetch(`${DRIVE_URL}/files/${encodeURIComponent(knownId)}?fields=id,trashed`, { headers: auth(token) });
    if (res.ok && !((await res.json()) as { trashed?: boolean }).trashed) return knownId;
    if (!res.ok && res.status !== 404) throw await failure(res, 'Finding the backup folder');
  }
  const q = `mimeType='${FOLDER_MIME}' and name='${BACKUP_FOLDER_NAME}' and trashed=false`;
  const found = await driveFetch(`${DRIVE_URL}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`, { headers: auth(token) });
  if (!found.ok) throw await failure(found, 'Finding the backup folder');
  const existing = ((await found.json()) as { files?: Array<{ id: string }> }).files?.[0];
  if (existing) return existing.id;

  const created = await driveFetch(`${DRIVE_URL}/files?fields=id`, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: FOLDER_MIME })
  });
  if (!created.ok) throw await failure(created, 'Creating the backup folder');
  return ((await created.json()) as { id: string }).id;
}

export interface DriveFile {
  id: string;
  name: string;
  size: number;
  createdTime: string;
  checksum: string | null;
}

/** Uploads one encrypted backup with a resumable session (one request for the body). */
export async function uploadBackupFile(
  token: string,
  folderId: string,
  name: string,
  body: Buffer,
  checksumSha256: string
): Promise<string> {
  const session = await driveFetch(`${UPLOAD_URL}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      ...auth(token),
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/octet-stream',
      'X-Upload-Content-Length': String(body.length)
    },
    body: JSON.stringify({
      name,
      parents: [folderId],
      appProperties: { [BACKUP_MARKER.key]: BACKUP_MARKER.value, checksum: checksumSha256 }
    })
  });
  if (!session.ok) throw await failure(session, 'Starting the upload');
  const location = session.headers.get('location');
  if (!location) throw new Error('Google Drive did not accept the upload. Try again later.');

  const put = await driveFetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(body)
  }, UPLOAD_TIMEOUT_MS);
  if (!put.ok) throw await failure(put, 'Uploading the backup');
  return ((await put.json()) as { id: string }).id;
}

/** This app's backups in the folder, newest first. */
export async function listBackupFiles(token: string, folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false and appProperties has { key='${BACKUP_MARKER.key}' and value='${BACKUP_MARKER.value}' }`,
      fields: 'nextPageToken,files(id,name,size,createdTime,appProperties)',
      orderBy: 'createdTime desc',
      pageSize: '100',
      spaces: 'drive'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await driveFetch(`${DRIVE_URL}/files?${params}`, { headers: auth(token) });
    if (!res.ok) throw await failure(res, 'Listing online backups');
    const body = (await res.json()) as {
      nextPageToken?: string;
      files?: Array<{ id: string; name: string; size?: string; createdTime: string; appProperties?: Record<string, string> }>;
    };
    for (const f of body.files ?? []) {
      files.push({ id: f.id, name: f.name, size: Number(f.size || 0), createdTime: f.createdTime, checksum: f.appProperties?.checksum || null });
    }
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return files;
}

/** Downloads one of this app's backups after checking it sits in the backup folder. */
export async function downloadBackupFile(token: string, folderId: string, fileId: string): Promise<{ data: Buffer; checksum: string | null; name: string }> {
  const metaRes = await driveFetch(`${DRIVE_URL}/files/${encodeURIComponent(fileId)}?fields=id,name,parents,trashed,appProperties`, { headers: auth(token) });
  if (metaRes.status === 404) throw new Error('That online backup no longer exists.');
  if (!metaRes.ok) throw await failure(metaRes, 'Reading the online backup');
  const meta = (await metaRes.json()) as { name: string; parents?: string[]; trashed?: boolean; appProperties?: Record<string, string> };
  if (meta.trashed || !meta.parents?.includes(folderId) || meta.appProperties?.[BACKUP_MARKER.key] !== BACKUP_MARKER.value) {
    throw new Error('That file is not one of this store\'s online backups.');
  }

  const res = await driveFetch(`${DRIVE_URL}/files/${encodeURIComponent(fileId)}?alt=media`, { headers: auth(token) }, UPLOAD_TIMEOUT_MS);
  if (!res.ok) throw await failure(res, 'Downloading the online backup');
  return { data: Buffer.from(await res.arrayBuffer()), checksum: meta.appProperties?.checksum || null, name: meta.name };
}

export async function deleteDriveFile(token: string, fileId: string): Promise<void> {
  const res = await driveFetch(`${DRIVE_URL}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: auth(token) });
  if (!res.ok && res.status !== 404) throw await failure(res, 'Deleting an old online backup');
}
