import fs from 'fs';
import path from 'path';
import { db, DB_PATH } from './db';

export const DEFAULT_BACKUP_DIR = path.resolve(process.cwd(), 'backups');

if (!fs.existsSync(DEFAULT_BACKUP_DIR)) {
  fs.mkdirSync(DEFAULT_BACKUP_DIR, { recursive: true });
}

export interface BackupResult {
  success: boolean;
  filename: string;
  filepath: string;
  sizeBytes: number;
  type: string;
  timestamp: string;
  message?: string;
}

/**
 * Creates an atomic backup of the SQLite database using SQLite's backup API.
 */
export async function createBackup(
  backupType: 'manual' | 'auto_daily' | 'pre_restore' = 'manual',
  customDir?: string
): Promise<BackupResult> {
  const targetDir = customDir ? path.resolve(customDir) : DEFAULT_BACKUP_DIR;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-');
  const filename = `pharmacy_backup_${backupType}_${dateStr}.db`;
  const filepath = path.join(targetDir, filename);

  try {
    // Utilize better-sqlite3 native async atomic backup API
    await db.backup(filepath);

    const stats = fs.statSync(filepath);

    // Record in backup history table
    const insertHistory = db.prepare(`
      INSERT INTO backup_history (backup_filename, backup_path, backup_type, file_size_bytes, status)
      VALUES (?, ?, ?, ?, 'success')
    `);
    insertHistory.run(filename, filepath, backupType, stats.size);

    return {
      success: true,
      filename,
      filepath,
      sizeBytes: stats.size,
      type: backupType,
      timestamp: now.toISOString(),
      message: 'Backup created successfully.'
    };
  } catch (error: any) {
    console.error('Backup failed:', error);
    throw new Error(`Backup failed: ${error.message}`);
  }
}

/**
 * Lists all existing backups from directory and database history.
 */
export function getBackupList() {
  const records = db.prepare('SELECT * FROM backup_history ORDER BY id DESC LIMIT 50').all();

  // Also check disk files in default directory
  const diskFiles = fs.existsSync(DEFAULT_BACKUP_DIR)
    ? fs.readdirSync(DEFAULT_BACKUP_DIR)
        .filter(f => f.endsWith('.db'))
        .map(f => {
          const fp = path.join(DEFAULT_BACKUP_DIR, f);
          const stat = fs.statSync(fp);
          return {
            filename: f,
            path: fp,
            sizeBytes: stat.size,
            mtime: stat.mtime
          };
        })
    : [];

  return { records, diskFiles };
}

/**
 * Restores a SQLite database from a chosen backup file with automatic safety snapshot.
 */
export async function restoreDatabase(backupFilePath: string): Promise<{ success: boolean; message: string }> {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error('Selected backup file does not exist.');
  }

  // Verify header is a valid SQLite 3 file
  const buffer = Buffer.alloc(16);
  const fd = fs.openSync(backupFilePath, 'r');
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);

  if (buffer.toString('utf8', 0, 15) !== 'SQLite format 3') {
    throw new Error('The selected file is not a valid SQLite database.');
  }

  // 1. Create a safety snapshot of current DB before replacing
  await createBackup('pre_restore');

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
