import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';
import { migrateLegacyInvoiceSettings } from '../invoice/invoiceSettings';
import { DB_PATH } from './paths';
// Creates the tables and applies column migrations before Prisma connects
import './db';

// Prisma 7 connects through the better-sqlite3 driver adapter, using the same file as db.ts
const adapter = new PrismaBetterSqlite3({ url: `file:${DB_PATH}` });

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * Applies the connection pragmas and startup data fixes. The schema itself is created by db.ts.
 * Note: SQLite PRAGMA statements return rows, so $queryRaw is used instead of $executeRaw.
 */
export async function initPrisma(): Promise<void> {
  try {
    await prisma.$queryRaw`PRAGMA journal_mode = WAL;`;
    await prisma.$queryRaw`PRAGMA synchronous = NORMAL;`;
    await prisma.$queryRaw`PRAGMA foreign_keys = ON;`;
    await prisma.$queryRaw`PRAGMA busy_timeout = 5000;`;

    // Phase 4: shift-close backups always accompany the schedule, so the old 'on_shift_close' rule becomes daily
    try {
      await prisma.systemSetting.updateMany({ where: { key: 'backup_frequency', value: 'on_shift_close' }, data: { value: 'daily' } });
    } catch (err) {
      console.error('[Prisma] Backup frequency migration failed:', err);
    }

    // Phase 3: move legacy A4/A5 paper sizes and sheet templates onto thermal equivalents
    try { await migrateLegacyInvoiceSettings(prisma); } catch (err) {
      console.error('[Prisma] Invoice settings migration failed:', err);
    }
  } catch (error) {
    console.error('[Prisma] Failed to apply SQLite pragmas:', error);
  }
}
