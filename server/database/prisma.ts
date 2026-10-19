import { PrismaClient } from '@prisma/client';

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
  } catch (error) {
    console.error('[Prisma] Failed to apply SQLite pragmas:', error);
  }
}
