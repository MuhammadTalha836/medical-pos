import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { db, DB_PATH } from './db';

// The Electron app points PHARMACARE_BACKUP_DIR at its per-user folder; dev and tests use ./backups
export const DEFAULT_BACKUP_DIR = path.resolve(process.env.PHARMACARE_BACKUP_DIR || path.join(process.cwd(), 'backups'));

if (!fs.existsSync(DEFAULT_BACKUP_DIR)) {
  fs.mkdirSync(DEFAULT_BACKUP_DIR, { recursive: true });
}

export type BackupType = 'manual' | 'scheduled' | 'shift_close' | 'pre_restore';

// Routine backups share the Developer retention limit; pre-restore safety snapshots are kept separately.
// 'auto_daily' is the pre-Phase 4 name for automatic backups and is still pruned as routine.
const ROUTINE_BACKUP_TYPES = ['manual', 'scheduled', 'shift_close', 'auto_daily'];
export const PRE_RESTORE_KEEP = 3;
export const DEFAULT_RETENTION_LIMIT = 30;

// Tables every valid PharmaCare database must contain
const REQUIRED_TABLES = ['system_settings', 'products', 'sales', 'users'];

export interface BackupResult {
  success: boolean;
  filename: string;
  filepath: string;
  sizeBytes: number;
  type: string;
  timestamp: string;
  checksumSha256?: string;
  secondaryPath?: string;
  prunedCount?: number;
  message?: string;
}

/**
 * Calculates SHA-256 checksum of a file for integrity verification.
 */
export function calculateFileChecksum(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

/**
 * Verifies that a file is a complete, uncorrupted PharmaCare SQLite database:
 * valid header, PRAGMA integrity_check = ok, and the core tables present.
 * Opens the file read-only so verification never modifies it.
 */
export function verifyBackupFile(filePath: string): { ok: boolean; error?: string } {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'Backup file does not exist.' };
  }

  const header = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
    return { ok: false, error: 'File is not a valid SQLite database.' };
  }

  let check: Database.Database | null = null;
  try {
    check = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = check.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      return { ok: false, error: `Integrity check failed: ${integrity.map(r => r.integrity_check).join('; ')}` };
    }
    const tables = new Set(
      (check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(t => t.name)
    );
    const missing = REQUIRED_TABLES.filter(t => !tables.has(t));
    if (missing.length > 0) {
      return { ok: false, error: `Backup is missing required tables: ${missing.join(', ')}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `Backup could not be opened: ${err.message}` };
  } finally {
    check?.close();
  }
}

function removeIfExists(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Best effort cleanup
  }
}

function getSettingValue(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value?: string } | undefined;
  return row?.value;
}

/**
 * Resolves the configured primary backup folder (admin-set auto_backup_dir, else ./backups).
 */
export function getConfiguredBackupDir(): string {
  const configured = getSettingValue('auto_backup_dir');
  // Relative folders (e.g. the default './backups') resolve against the app's base folder, not the process cwd
  return configured && configured.trim() ? path.resolve(path.dirname(DEFAULT_BACKUP_DIR), configured.trim()) : DEFAULT_BACKUP_DIR;
}

export function getRetentionLimit(): number {
  const parsed = parseInt(getSettingValue('backup_retention_limit') || '', 10);
  return isNaN(parsed) || parsed < 1 ? DEFAULT_RETENTION_LIMIT : parsed;
}

// Serializes all backups (manual, scheduled, shift-close, pre-restore) so they never overlap
let backupQueue: Promise<unknown> = Promise.resolve();

/**
 * Creates a verified backup of the SQLite database.
 * The snapshot is written to a .partial file, verified (integrity_check + core tables), checksummed,
 * and only then renamed into place and recorded. Old backups are pruned only after that succeeds;
 * a failed backup is recorded as 'failed' and never triggers pruning.
 */
export function createBackup(
  backupType: BackupType = 'manual',
  customDir?: string,
  secondaryDir?: string
): Promise<BackupResult> {
  const run = backupQueue.then(() => runBackup(backupType, customDir, secondaryDir));
  backupQueue = run.catch(() => undefined);
  return run;
}

async function runBackup(backupType: BackupType, customDir?: string, secondaryDir?: string): Promise<BackupResult> {
  const targetDir = customDir ? path.resolve(customDir) : DEFAULT_BACKUP_DIR;
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-');
  const filename = `pharmacy_backup_${backupType}_${dateStr}.db`;
  const filepath = path.join(targetDir, filename);
  const partialPath = `${filepath}.partial`;

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 1. Snapshot via better-sqlite3's online backup API into a temporary file
    await db.backup(partialPath);

    // Make the snapshot self-contained (no -wal/-shm side files) before verification
    const snapshot = new Database(partialPath, { fileMustExist: true });
    try {
      snapshot.pragma('journal_mode = DELETE');
    } finally {
      snapshot.close();
    }

    // 2. Verify integrity before the backup is allowed to count
    const verification = verifyBackupFile(partialPath);
    if (!verification.ok) {
      throw new Error(verification.error);
    }

    // 3. Commit atomically and confirm the checksum survived the rename
    const checksum = calculateFileChecksum(partialPath);
    fs.renameSync(partialPath, filepath);
    if (calculateFileChecksum(filepath) !== checksum) {
      throw new Error('Checksum mismatch after writing backup file.');
    }
    fs.writeFileSync(`${filepath}.sha256`, `${checksum}  ${filename}\n`, 'utf8');
    const stats = fs.statSync(filepath);

    // Multi-Destination: Copy to secondary destination (e.g. External USB drive) if configured
    let secondaryPath: string | undefined = undefined;
    if (secondaryDir && secondaryDir.trim()) {
      try {
        const secDirResolved = path.resolve(secondaryDir.trim());
        if (!fs.existsSync(secDirResolved)) {
          fs.mkdirSync(secDirResolved, { recursive: true });
        }
        const copyPath = path.join(secDirResolved, filename);
        fs.copyFileSync(filepath, copyPath);
        if (calculateFileChecksum(copyPath) === checksum) {
          fs.writeFileSync(`${copyPath}.sha256`, `${checksum}  ${filename}\n`, 'utf8');
          secondaryPath = copyPath;
        } else {
          removeIfExists(copyPath);
          console.warn('[Backup] Secondary copy checksum mismatch; copy discarded.');
        }
      } catch (secErr: any) {
        console.warn('[Backup] Secondary destination copy warning:', secErr.message);
      }
    }

    // 4. Record the verified backup
    db.prepare(`
      INSERT INTO backup_history (backup_filename, backup_path, backup_type, file_size_bytes, status, checksum_sha256, verified, secondary_path)
      VALUES (?, ?, ?, ?, 'success', ?, 1, ?)
    `).run(filename, filepath, backupType, stats.size, checksum, secondaryPath ?? null);

    // 5. Only now is it safe to prune older backups in this folder
    const prunedCount = backupType === 'pre_restore'
      ? prunePreRestoreSnapshots(targetDir)
      : pruneBackupsByRetentionLimit(undefined, targetDir);

    return {
      success: true,
      filename,
      filepath,
      secondaryPath,
      checksumSha256: checksum,
      sizeBytes: stats.size,
      type: backupType,
      timestamp: now.toISOString(),
      prunedCount,
      message: secondaryPath
        ? 'Backup created, verified, and synced to secondary external drive.'
        : 'Backup created and verified successfully.'
    };
  } catch (error: any) {
    removeIfExists(partialPath);
    removeIfExists(`${partialPath}-wal`);
    removeIfExists(`${partialPath}-shm`);
    const message = error?.message || String(error);
    try {
      db.prepare(`
        INSERT INTO backup_history (backup_filename, backup_path, backup_type, file_size_bytes, status, verified, error_message)
        VALUES (?, ?, ?, 0, 'failed', 0, ?)
      `).run(filename, filepath, backupType, message);
    } catch {
      // History is best effort when the database itself is the problem
    }
    console.error('Backup failed:', message);
    throw new Error(`Backup failed: ${message}`);
  }
}

interface RetainedBackupRow {
  id: number;
  backup_filename: string;
  backup_path: string;
  secondary_path: string | null;
}

function deleteBackupRow(row: RetainedBackupRow) {
  removeIfExists(row.backup_path);
  removeIfExists(`${row.backup_path}.sha256`);
  if (row.secondary_path) {
    removeIfExists(row.secondary_path);
    removeIfExists(`${row.secondary_path}.sha256`);
  }
  db.prepare('DELETE FROM backup_history WHERE id = ?').run(row.id);
}

/**
 * Verified successful backups of the given types stored in a folder, newest first.
 * Only files recorded in backup_history are ever considered, so unrelated files are never touched.
 */
function listVerifiedBackups(dir: string, types: string[]): RetainedBackupRow[] {
  const placeholders = types.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT id, backup_filename, backup_path, secondary_path
    FROM backup_history
    WHERE status = 'success' AND verified = 1 AND backup_type IN (${placeholders})
    ORDER BY id DESC
  `).all(...types) as RetainedBackupRow[];

  const resolvedDir = path.resolve(dir);
  return rows.filter(r => path.dirname(path.resolve(r.backup_path)) === resolvedDir && fs.existsSync(r.backup_path));
}

export function countRetainedBackups(dir: string = getConfiguredBackupDir()): number {
  return listVerifiedBackups(dir, ROUTINE_BACKUP_TYPES).length;
}

/**
 * Enforces the Developer retention limit on routine backups in a folder: keeps the newest N verified
 * backups and deletes older ones (with their checksum sidecars and secondary copies).
 * The newest verified backup is never deleted because N is at least 1.
 */
export function pruneBackupsByRetentionLimit(customLimit?: number, dir: string = getConfiguredBackupDir()): number {
  try {
    let maxKeep = customLimit ?? getRetentionLimit();
    if (isNaN(maxKeep) || maxKeep < 1) maxKeep = 1;

    const retained = listVerifiedBackups(dir, ROUTINE_BACKUP_TYPES);
    let deletedCount = 0;
    for (const row of retained.slice(maxKeep)) {
      try {
        deleteBackupRow(row);
        deletedCount++;
      } catch (e) {
        console.warn('[Backup Prune] Error removing file:', row.backup_filename, e);
      }
    }
    return deletedCount;
  } catch (err) {
    console.warn('[Backup Prune] Warning:', err);
    return 0;
  }
}

/**
 * Keeps only the newest pre-restore safety snapshots in a folder.
 */
export function prunePreRestoreSnapshots(dir: string = getConfiguredBackupDir()): number {
  try {
    let deletedCount = 0;
    for (const row of listVerifiedBackups(dir, ['pre_restore']).slice(PRE_RESTORE_KEEP)) {
      deleteBackupRow(row);
      deletedCount++;
    }
    return deletedCount;
  } catch (err) {
    console.warn('[Backup Prune] Pre-restore warning:', err);
    return 0;
  }
}

/**
 * Lists all existing backups from directory and database history.
 */
export function getBackupList() {
  const records = db.prepare('SELECT * FROM backup_history ORDER BY id DESC LIMIT 50').all();
  const backupDir = getConfiguredBackupDir();

  // Also check disk files in the configured backup directory
  const diskFiles = fs.existsSync(backupDir) && fs.statSync(backupDir).isDirectory()
    ? fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.db'))
        .map(f => {
          const fp = path.join(backupDir, f);
          const stat = fs.statSync(fp);
          const shaFile = `${fp}.sha256`;
          let checksum = '';
          if (fs.existsSync(shaFile)) {
            try {
              checksum = fs.readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0];
            } catch {
              checksum = '';
            }
          }
          return {
            filename: f,
            path: fp,
            sizeBytes: stat.size,
            mtime: stat.mtime,
            checksum
          };
        })
    : [];

  return { records, diskFiles };
}

/**
 * Restores a SQLite database from a chosen backup file with automatic safety snapshot.
 * The chosen file is fully verified before anything is touched.
 */
export async function restoreDatabase(backupFilePath: string): Promise<{ success: boolean; message: string }> {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error('Selected backup file does not exist.');
  }

  const verification = verifyBackupFile(backupFilePath);
  if (!verification.ok) {
    throw new Error(`Restore aborted, the selected backup failed verification: ${verification.error}`);
  }

  // 1. Create a safety snapshot of current DB before replacing
  await createBackup('pre_restore', getConfiguredBackupDir());

  // 2. Perform restore by copying backup file over active DB
  // Checkpoint WAL first
  db.pragma('wal_checkpoint(TRUNCATE)');
  
  // Copy backup file
  fs.copyFileSync(backupFilePath, DB_PATH);

  // Re-verify integrity
  const integrity = db.pragma('quick_check') as Array<{ quick_check: string }>;
  if (integrity.length > 0 && integrity[0].quick_check !== 'ok') {
    throw new Error(`Database integrity check warning: ${integrity[0].quick_check}`);
  }

  return {
    success: true,
    message: 'Database restored successfully! Integrity check passed.'
  };
}

/**
 * Stock Zero Utility: Reset stock count for all products or a specific company with audit logging.
 */
export function resetStockZero(companyId?: number, userId?: number, userName?: string) {
  const transaction = db.transaction(() => {
    let affected = 0;
    if (companyId) {
      const updateProd = db.prepare('UPDATE products SET stock_boxes = 0, stock_loose = 0, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?');
      const res = updateProd.run(companyId);
      affected = res.changes;

      // Update batches
      db.prepare(`
        UPDATE product_batches
        SET quantity_boxes = 0, quantity_loose = 0
        WHERE product_id IN (SELECT id FROM products WHERE company_id = ?)
      `).run(companyId);
    } else {
      const updateProd = db.prepare('UPDATE products SET stock_boxes = 0, stock_loose = 0, updated_at = CURRENT_TIMESTAMP');
      const res = updateProd.run();
      affected = res.changes;

      db.prepare('UPDATE product_batches SET quantity_boxes = 0, quantity_loose = 0').run();
    }

    // Log to audit table
    db.prepare(`
      INSERT INTO audit_logs (action, module, details, user_id, user_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'STOCK_ZERO',
      'Inventory',
      `Stock zero reset executed. Target Company ID: ${companyId || 'ALL'}. Affected products: ${affected}`,
      userId || null,
      userName || 'System'
    );

    return affected;
  });

  return transaction();
}

/**
 * Optimizes SQLite database and cleans up fragmented pages.
 */
export function optimizeDatabase(): { success: boolean; message: string; sizeBefore: number; sizeAfter: number } {
  const sizeBefore = fs.statSync(DB_PATH).size;

  db.pragma('optimize');
  db.exec('VACUUM;');
  db.exec('ANALYZE;');

  const sizeAfter = fs.statSync(DB_PATH).size;

  return {
    success: true,
    message: 'Database optimized successfully. Indexes recomputed and pages defragmented.',
    sizeBefore,
    sizeAfter
  };
}
