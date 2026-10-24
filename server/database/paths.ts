import path from 'path';
import fs from 'fs';

// Single source of truth for the SQLite file used by both better-sqlite3 (db.ts) and Prisma (prisma.ts).
// The Electron app points PHARMACARE_DATA_DIR at its per-user folder; dev and tests use ./data.
const DB_DIR = path.resolve(process.env.PHARMACARE_DATA_DIR || path.join(process.cwd(), 'data'));
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const DB_PATH = path.join(DB_DIR, 'pharmacy.db');
