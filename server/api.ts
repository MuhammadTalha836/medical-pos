import 'dotenv/config';

import { app } from './app';
import { initPrisma } from './database/prisma';
import { startBackupScheduler } from './backup/scheduler';

// Entry point: Electron (electron/main.ts) and the test suites import `app` from here and call `listen` themselves.

initPrisma().catch(err => {
  console.error('[Prisma] Initialization error:', err);
});

// Offline backup scheduler (disabled under test runs so suites exit cleanly)
if (process.env.NODE_ENV !== 'test' && !process.env.TEST_MODE) {
  startBackupScheduler();
}

export { app };
