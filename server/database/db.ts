import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA_SQL } from './schema';
import { seedInitialData } from './seed';

const DB_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const DB_PATH = path.join(DB_DIR, 'pharmacy.db');

export function initDatabase(customPath?: string): Database.Database {
  const targetPath = customPath || DB_PATH;
  const db = new Database(targetPath);

  // Performance and integrity pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Execute schema
  db.exec(SCHEMA_SQL);

  // Safe migrations for shift_id and product open-sale columns if upgrading existing database
  try { db.exec(`ALTER TABLE sales ADD COLUMN shift_id INTEGER REFERENCES cashier_shifts(id);`); } catch {}
  try { db.exec(`ALTER TABLE sale_returns ADD COLUMN shift_id INTEGER REFERENCES cashier_shifts(id);`); } catch {}
  try { db.exec(`ALTER TABLE customer_payments ADD COLUMN shift_id INTEGER REFERENCES cashier_shifts(id);`); } catch {}
  try { db.exec(`ALTER TABLE products ADD COLUMN allow_open_sale INTEGER NOT NULL DEFAULT 1;`); } catch {}
  try { db.exec(`ALTER TABLE products ADD COLUMN min_sale_qty INTEGER NOT NULL DEFAULT 1;`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN email TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN locked_until DATETIME;`); } catch {}
  try { db.exec(`ALTER TABLE audit_logs ADD COLUMN affected_user TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE audit_logs ADD COLUMN status TEXT DEFAULT 'SUCCESS';`); } catch {}
  try { db.exec(`ALTER TABLE sales ADD COLUMN store_name_snapshot TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE sales ADD COLUMN store_address_snapshot TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE sales ADD COLUMN invoice_footer_snapshot TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE backup_history ADD COLUMN checksum_sha256 TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE backup_history ADD COLUMN verified INTEGER NOT NULL DEFAULT 1;`); } catch {}
  try { db.exec(`ALTER TABLE backup_history ADD COLUMN error_message TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE backup_history ADD COLUMN secondary_path TEXT;`); } catch {}

  // Seed default data if database is fresh
  seedInitialData(db);

  return db;
}

export const db = initDatabase();
