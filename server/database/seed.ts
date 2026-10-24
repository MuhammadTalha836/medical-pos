import type Database from 'better-sqlite3';
import { DEFAULT_SETTINGS } from '../../shared/settingsDefaults';
import {
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_CASHIER_PERMISSIONS,
  DEFAULT_PHARMACIST_PERMISSIONS,
  PERMISSION_KEYS
} from '../../shared/permissions';
import { seedSampleData } from './sampleData';

const BUILT_IN_ROLES: Array<[name: string, displayName: string, description: string, isSystem: number, permissions: Record<string, boolean>]> = [
  ['developer', 'System Developer', 'Master system configuration, security rules, and authenticator sign-in', 1, DEFAULT_ADMIN_PERMISSIONS],
  ['admin', 'Administrator', 'Full system access and master privileges', 1, DEFAULT_ADMIN_PERMISSIONS],
  ['cashier', 'Counter Cashier', 'POS sales, customer credit recoveries, and view/add medicines. Cannot delete/edit records.', 0, DEFAULT_CASHIER_PERMISSIONS],
  ['pharmacist', 'Pharmacist', 'Dispensing, master coding, and inventory purchases.', 0, DEFAULT_PHARMACIST_PERMISSIONS]
];

/**
 * Default settings and built-in roles. Safe to run on every startup: it never overwrites existing rows.
 * There are no default staff accounts: the Developer creates the Admin (with its password) in the setup
 * wizard, and the Admin creates cashiers. Shipping fixed passwords such as admin123 would leave a backdoor.
 */
export function seedInitialData(db: Database.Database) {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(key, value);
  }

  const insertRole = db.prepare(`
    INSERT OR IGNORE INTO roles (name, display_name, description, is_system, permissions)
    VALUES (?, ?, ?, ?, ?)
  `);
  // A fresh database gets every built-in role; later starts only make sure the developer role exists,
  // so roles an Admin deleted (cashier, pharmacist) do not come back
  const roleCount = (db.prepare('SELECT COUNT(*) as count FROM roles').get() as { count: number }).count;
  for (const [name, displayName, description, isSystem, permissions] of BUILT_IN_ROLES) {
    if (roleCount === 0 || name === 'developer') {
      insertRole.run(name, displayName, description, isSystem, JSON.stringify(permissions));
    }
  }

  backfillRolePermissions(db);

  if (process.env.PHARMACARE_SAMPLE_DATA === 'true') {
    seedSampleData(db);
  }
}

/**
 * Roles saved before newer permission keys existed (e.g. 'shifts', 'can_manage_shifts') get those keys added
 * with the built-in defaults. Existing values are never changed.
 */
function backfillRolePermissions(db: Database.Database) {
  const defaultsByRole = Object.fromEntries(BUILT_IN_ROLES.map(([name, , , , permissions]) => [name, permissions]));
  const roles = db.prepare('SELECT id, name, permissions FROM roles').all() as Array<{ id: number; name: string; permissions: string }>;
  const update = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?');
  for (const role of roles) {
    let stored: Record<string, unknown>;
    try {
      stored = JSON.parse(role.permissions || '{}');
    } catch {
      console.error(`[Seed] Role "${role.name}" has unreadable permissions; left unchanged`);
      continue;
    }
    const missing = PERMISSION_KEYS.filter(key => !(key in stored));
    if (missing.length === 0) continue;
    const defaults: Partial<Record<string, boolean>> = defaultsByRole[role.name] ?? {};
    for (const key of missing) stored[key] = defaults[key] === true;
    update.run(JSON.stringify(stored), role.id);
  }
}
