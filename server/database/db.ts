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

  // Seed default data if database is fresh
  seedInitialData(db);

  return db;
}

export const db = initDatabase();
