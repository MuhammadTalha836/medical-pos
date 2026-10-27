import Database from 'better-sqlite3';
import { COLUMN_MIGRATIONS, ONE_OPEN_SHIFT_INDEX_SQL, POST_MIGRATION_SQL, SCHEMA_SQL } from './schema';
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

/** The app version that last opened this database (a restore refuses backups made by a newer one) */
export const currentAppVersion = () => process.env.PHARMACARE_APP_VERSION || '0.0.0-dev';

/**
 * Brings a database up to this version: tables, indexes, columns added since the first release, default rows and
 * the version stamp. Runs at start-up and again right after a restore (an older backup gets today's columns).
 */
export function upgradeSchema(db: Database.Database) {
  db.exec(SCHEMA_SQL);
  applyColumnMigrations(db);
  db.exec(POST_MIGRATION_SQL);
  try {
    db.exec(ONE_OPEN_SHIFT_INDEX_SQL);
  } catch (err) {
    console.warn('[DB] One-open-shift index skipped: a user has more than one open shift. Close the extra shift.', err);
  }

  // Default settings and roles (never overwrites existing rows)
  seedInitialData(db);
  db.prepare(`
    INSERT INTO system_settings (key, value) VALUES ('app_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(currentAppVersion());
}

function initDatabase(): Database.Database {
  const db = new Database(DB_PATH);

  // Performance and integrity pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  upgradeSchema(db);
  return db;
}

export const db = initDatabase();
