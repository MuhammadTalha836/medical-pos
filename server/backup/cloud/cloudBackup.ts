import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '../../database/prisma';
import { getRetentionLimit, restoreDatabase } from '../../database/backup';
import { logSecurityAudit } from '../../security/audit';
import { getDeveloperSecret } from '../../security/developerKey';
import { base32Decode } from '../../security/totp';
import { normalizeBackupMode, usesCloud, type BackupMode } from '../../../shared/backup';
import { deriveCloudKey, decryptBackup, encryptBackup, openSecret, sealSecret, type CloudKeyPurpose } from './cloudCrypto';
import { cloudFileName, cloudRetryDelayMs, driveFilesToPrune } from './cloudMath';
import {
  DriveAuthError,
  cancelConnect,
  clearAccessTokenCache,
  deleteDriveFile,
  downloadBackupFile,
  ensureBackupFolder,
  getAccessToken,
  getConnectProgress,
  isDriveConfigured,
  listBackupFiles,
  revokeToken,
  startConnect,
  uploadBackupFile,
  type DriveFile
} from './googleDrive';

/**
 * Online backups: after a verified local backup, the newest one is encrypted and uploaded to the owner's
 * Google Drive. Uploads never block a backup: they queue as 'pending' on the backup_history row and are retried
 * (with backoff) by the scheduler tick until the internet is back. Older pending rows are superseded by newer ones.
 */
const KEYS = {
  refreshToken: 'gdrive_refresh_token',
  email: 'gdrive_account_email',
  folderId: 'gdrive_folder_id',
  connectedAt: 'gdrive_connected_at',
  lastUploadAt: 'gdrive_last_upload_at',
  lastUploadFile: 'gdrive_last_upload_file',
  lastError: 'gdrive_last_error',
  lastAttemptAt: 'gdrive_last_attempt_at'
} as const;

/** Never readable or writable through /api/settings */
export const CLOUD_SETTING_KEYS: string[] = Object.values(KEYS);

type Actor = { id?: number | null; username?: string | null };

function cloudKey(purpose: CloudKeyPurpose): Buffer {
  return deriveCloudKey(base32Decode(getDeveloperSecret()), purpose);
}

async function readSettings(): Promise<Record<string, string>> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: [...CLOUD_SETTING_KEYS, 'backup_mode'] } } });
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function writeSettings(values: Record<string, string>) {
  await prisma.$transaction(
    Object.entries(values).map(([key, value]) =>
      prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );
}

export async function getBackupMode(): Promise<BackupMode> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'backup_mode' } });
  return normalizeBackupMode(row?.value);
}

function storedRefreshToken(settings: Record<string, string>): string | null {
  if (!settings[KEYS.refreshToken]) return null;
  try {
    return openSecret(settings[KEYS.refreshToken], cloudKey('drive-token-v1'));
  } catch {
    return null;
  }
}

// Retry state for the upload queue (in memory: a restart simply tries again)
const retry = { failures: 0, nextAttemptAt: 0 };
let uploading = false;

// -------------------------------------------------------------
// Connect / disconnect
// -------------------------------------------------------------
export async function startDriveConnect(actor: Actor) {
  return startConnect(async ({ refreshToken, email }) => {
    const folderId = await ensureBackupFolder(await getAccessToken(refreshToken));
    await writeSettings({
      [KEYS.refreshToken]: sealSecret(refreshToken, cloudKey('drive-token-v1')),
      [KEYS.email]: email,
      [KEYS.folderId]: folderId,
      [KEYS.connectedAt]: new Date().toISOString(),
      [KEYS.lastError]: ''
    });
    retry.failures = 0;
    retry.nextAttemptAt = 0;
    await logSecurityAudit({
      action: 'CLOUD_BACKUP_CONNECT',
      module: 'BACKUP',
      status: 'SUCCESS',
      details: `Google Drive connected for online backups: ${email}`,
      userId: actor.id ?? null,
      userName: actor.username ?? 'Developer'
    });
    // Upload the newest waiting backup straight away
    void runCloudUploads({ force: true });
  });
}

export async function disconnectDrive(actor: Actor) {
  cancelConnect();
  const settings = await readSettings();
  const token = storedRefreshToken(settings);
  if (token) await revokeToken(token);
  clearAccessTokenCache();
  await prisma.systemSetting.deleteMany({ where: { key: { in: CLOUD_SETTING_KEYS } } });
  await logSecurityAudit({
    action: 'CLOUD_BACKUP_DISCONNECT',
    module: 'BACKUP',
    status: 'SUCCESS',
    details: `Google Drive disconnected${settings[KEYS.email] ? ` (${settings[KEYS.email]})` : ''}`,
    userId: actor.id ?? null,
    userName: actor.username ?? 'Developer'
  });
}

export function getDriveConnectProgress() {
  return getConnectProgress();
}

// -------------------------------------------------------------
// Status
// -------------------------------------------------------------
export interface CloudStatus {
  mode: BackupMode;
  available: boolean;
  connected: boolean;
  account_email: string | null;
  connected_at: string | null;
  last_upload_at: string | null;
  last_upload_file: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  pending_count: number;
  next_retry_at: string | null;
}

export async function getCloudStatus(): Promise<CloudStatus> {
  const settings = await readSettings();
  const connected = !!settings[KEYS.refreshToken];
  return {
    mode: normalizeBackupMode(settings.backup_mode),
    available: isDriveConfigured(),
    connected,
    account_email: connected ? settings[KEYS.email] || null : null,
    connected_at: settings[KEYS.connectedAt] || null,
    last_upload_at: settings[KEYS.lastUploadAt] || null,
    last_upload_file: settings[KEYS.lastUploadFile] || null,
    last_attempt_at: settings[KEYS.lastAttemptAt] || null,
    last_error: settings[KEYS.lastError] || null,
    pending_count: await prisma.backupHistory.count({ where: { cloudStatus: 'pending' } }),
    next_retry_at: retry.nextAttemptAt > Date.now() ? new Date(retry.nextAttemptAt).toISOString() : null
  };
}

// -------------------------------------------------------------
// Upload queue
// -------------------------------------------------------------
/** Marks a verified backup for upload when the backup type includes Google Drive. */
export async function queueCloudUpload(historyId: number): Promise<boolean> {
  if (!usesCloud(await getBackupMode())) return false;
  await prisma.backupHistory.update({ where: { id: historyId }, data: { cloudStatus: 'pending', cloudError: null } });
  return true;
}

async function connection(settings: Record<string, string>) {
  const refreshToken = storedRefreshToken(settings);
  if (!refreshToken) throw new DriveAuthError('Google Drive is not connected. Connect it in Developer Settings.');
  const token = await getAccessToken(refreshToken);
  const folderId = await ensureBackupFolder(token, settings[KEYS.folderId] || undefined);
  if (folderId !== settings[KEYS.folderId]) await writeSettings({ [KEYS.folderId]: folderId });
  return { token, folderId };
}

export type CloudUploadOutcome =
  | { status: 'idle'; reason: string }
  | { status: 'uploaded'; filename: string; pruned: number }
  | { status: 'failed'; error: string };

/**
 * Uploads the newest pending backup (older pending ones are marked 'skipped'). Respects the retry backoff
 * unless `force` is set. Never throws.
 */
export async function runCloudUploads(options: { force?: boolean; now?: number } = {}): Promise<CloudUploadOutcome> {
  const now = options.now ?? Date.now();
  if (uploading) return { status: 'idle', reason: 'An upload is already running.' };
  if (!options.force && retry.nextAttemptAt > now) return { status: 'idle', reason: 'Waiting before the next retry.' };

  uploading = true;
  try {
    const settings = await readSettings();
    if (!usesCloud(normalizeBackupMode(settings.backup_mode))) return { status: 'idle', reason: 'Online backup is off.' };
    if (!settings[KEYS.refreshToken] || !isDriveConfigured()) return { status: 'idle', reason: 'Google Drive is not connected.' };

    const pending = await prisma.backupHistory.findMany({ where: { cloudStatus: 'pending' }, orderBy: { id: 'desc' } });
    if (pending.length === 0) return { status: 'idle', reason: 'Nothing to upload.' };

    const [newest, ...older] = pending;
    if (older.length > 0) {
      await prisma.backupHistory.updateMany({ where: { id: { in: older.map(r => r.id) } }, data: { cloudStatus: 'skipped' } });
    }
    if (!fs.existsSync(newest.backupPath)) {
      await prisma.backupHistory.update({ where: { id: newest.id }, data: { cloudStatus: 'skipped', cloudError: 'Local file no longer exists' } });
      return { status: 'idle', reason: 'The waiting backup file no longer exists.' };
    }

    try {
      const { token, folderId } = await connection(settings);
      const sealed = encryptBackup(fs.readFileSync(newest.backupPath), cloudKey('backup-file-v1'));
      const checksum = newest.checksumSha256 || crypto.createHash('sha256').update(fs.readFileSync(newest.backupPath)).digest('hex');
      const fileId = await uploadBackupFile(token, folderId, cloudFileName(newest.backupFilename), sealed, checksum);
      const uploadedAt = new Date();
      await prisma.backupHistory.update({
        where: { id: newest.id },
        data: { cloudStatus: 'uploaded', cloudFileId: fileId, cloudUploadedAt: uploadedAt, cloudError: null }
      });
      await writeSettings({
        [KEYS.lastUploadAt]: uploadedAt.toISOString(),
        [KEYS.lastUploadFile]: newest.backupFilename,
        [KEYS.lastAttemptAt]: uploadedAt.toISOString(),
        [KEYS.lastError]: ''
      });
      retry.failures = 0;
      retry.nextAttemptAt = 0;

      const pruned = await pruneDrive(token, folderId);
      await logSecurityAudit({
        action: 'CLOUD_BACKUP_UPLOAD',
        module: 'BACKUP',
        status: 'SUCCESS',
        details: `Backup ${newest.backupFilename} uploaded to Google Drive${pruned ? `, removed ${pruned} old online backup(s)` : ''}`
      });
      return { status: 'uploaded', filename: newest.backupFilename, pruned };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      retry.failures += 1;
      retry.nextAttemptAt = now + cloudRetryDelayMs(retry.failures);
      await prisma.backupHistory.update({ where: { id: newest.id }, data: { cloudError: message.slice(0, 500) } });
      await writeSettings({ [KEYS.lastError]: message.slice(0, 500), [KEYS.lastAttemptAt]: new Date(now).toISOString() });
      // One audit entry per failure streak, not one per retry
      if (retry.failures === 1) {
        await logSecurityAudit({
          action: 'CLOUD_BACKUP_UPLOAD',
          module: 'BACKUP',
          status: 'FAILED',
          details: `Online backup upload failed (will retry): ${message}`
        });
      }
      return { status: 'failed', error: message };
    }
  } catch (error) {
    console.error('[Online Backup] Error:', error instanceof Error ? error.message : error);
    return { status: 'failed', error: 'The online backup could not run.' };
  } finally {
    uploading = false;
  }
}

/** Keeps the newest `backup_retention_limit` files in the Drive folder. Best effort. */
async function pruneDrive(token: string, folderId: string): Promise<number> {
  try {
    const extra = driveFilesToPrune(await listBackupFiles(token, folderId), getRetentionLimit());
    for (const file of extra) await deleteDriveFile(token, file.id);
    return extra.length;
  } catch (error) {
    console.warn('[Online Backup] Pruning old online backups:', error instanceof Error ? error.message : error);
    return 0;
  }
}

/** Test hook: clears the retry backoff. */
export function resetCloudRetry() {
  retry.failures = 0;
  retry.nextAttemptAt = 0;
}

// -------------------------------------------------------------
// Restore
// -------------------------------------------------------------
/**
 * Runs a restore while keeping this computer's backup type and Google Drive connection: an older backup may hold
 * a sign-in that was since revoked (or none at all), which would silently stop online backups.
 */
export async function keepingCloudConnection<T>(restore: () => Promise<T>): Promise<T> {
  const current = await readSettings();
  const result = await restore();
  await prisma.systemSetting.deleteMany({ where: { key: { in: CLOUD_SETTING_KEYS } } });
  const kept = Object.fromEntries(Object.entries(current).filter(([, value]) => value !== ''));
  if (Object.keys(kept).length > 0) await writeSettings(kept);
  clearAccessTokenCache();
  return result;
}

export async function listCloudBackups(): Promise<DriveFile[]> {
  const { token, folderId } = await connection(await readSettings());
  return listBackupFiles(token, folderId);
}

/** Downloads, decrypts and checks an online backup, then restores it like a local file. */
export async function restoreFromCloud(fileId: string) {
  const { token, folderId } = await connection(await readSettings());
  const { data, checksum, name } = await downloadBackupFile(token, folderId, fileId);
  const plain = decryptBackup(data, cloudKey('backup-file-v1'));
  if (checksum && crypto.createHash('sha256').update(plain).digest('hex') !== checksum) {
    throw new Error('The downloaded backup does not match its checksum. Try another backup.');
  }

  const tempPath = path.join(os.tmpdir(), `pharmacare_online_restore_${crypto.randomBytes(6).toString('hex')}.db`);
  fs.writeFileSync(tempPath, plain, { mode: 0o600 });
  try {
    const result = await keepingCloudConnection(() => restoreDatabase(tempPath));
    return { ...result, name };
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}
