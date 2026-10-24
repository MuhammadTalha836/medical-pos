import Database from 'better-sqlite3';
import { COLUMN_MIGRATIONS, SCHEMA_SQL } from './schema';
import { seedInitialData } from './seed';
import { DB_PATH } from './paths';

export { DB_PATH };

// Adds any column an older database is missing (checked first, so nothing fails or logs on a current database)
function applyColumnMigrations(db: Database.Database) {
  for (const { table, column, definition } of COLUMN_MIGRATIONS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
  }
}

function initDatabase(): Database.Database {
  const db = new Database(DB_PATH);

  // Performance and integrity pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Tables, indexes, then columns added since the first release
  db.exec(SCHEMA_SQL);
  applyColumnMigrations(db);

  // Default settings and roles (never overwrites existing rows)
  seedInitialData(db);

  return db;
}

export const db = initDatabase();
