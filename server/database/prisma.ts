import { PrismaClient } from '@prisma/client';
import { migrateLegacyInvoiceSettings } from '../invoice/invoiceSettings';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * Enforces SQLite performance, locking timeout, and foreign key integrity pragmas.
 * Note: SQLite PRAGMA statements return rows, so $queryRaw is used instead of $executeRaw.
 */
export async function initPrisma(): Promise<void> {
  try {
    await prisma.$queryRaw`PRAGMA journal_mode = WAL;`;
    await prisma.$queryRaw`PRAGMA synchronous = NORMAL;`;
    await prisma.$queryRaw`PRAGMA foreign_keys = ON;`;
    await prisma.$queryRaw`PRAGMA busy_timeout = 5000;`;

    // Safe migrations for user model additions
    try { await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN email TEXT;`); } catch {}
    try { await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN totp_secret TEXT;`); } catch {}
    try { await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;`); } catch {}
    try { await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN locked_until DATETIME;`); } catch {}
    try { await prisma.$executeRawUnsafe(`ALTER TABLE audit_logs ADD COLUMN affected_user TEXT;`); } catch {}
    try { await prisma.$executeRawUnsafe(`ALTER TABLE audit_logs ADD COLUMN status TEXT DEFAULT 'SUCCESS';`); } catch {}
    try { await prisma.$executeRawUnsafe(`ALTER TABLE sales ADD COLUMN store_name_snapshot TEXT;`); } catch {}
    try { await prisma.$executeRawUnsafe(`ALTER TABLE sales ADD COLUMN store_address_snapshot TEXT;`); } catch {}
    try { await prisma.$executeRawUnsafe(`ALTER TABLE sales ADD COLUMN invoice_footer_snapshot TEXT;`); } catch {}

    // Phase 3: move legacy A4/A5 paper sizes and sheet templates onto thermal equivalents
    try { await migrateLegacyInvoiceSettings(prisma); } catch (err) {
      console.error('[Prisma] Invoice settings migration failed:', err);
    }
  } catch (error) {
    console.error('[Prisma] Failed to apply SQLite pragmas:', error);
  }
}
