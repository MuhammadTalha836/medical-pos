import 'dotenv/config';

import { app } from './app';
import { initPrisma } from './database/prisma';
import { startBackupScheduler } from './backup/scheduler';

// Entry point: `npm run dev:server` runs this file directly; Electron and the test suites import `app` from it.

initPrisma().catch(err => {
  console.error('[Prisma] Initialization error:', err);
});

// Offline backup scheduler (disabled under test runs so suites exit cleanly)
if (process.env.NODE_ENV !== 'test' && !process.env.TEST_MODE) {
  startBackupScheduler();
}

export { app };

if (process.env.NODE_ENV !== 'test' && !process.env.TEST_MODE && (process.argv[1]?.endsWith('api.ts') || process.argv[1]?.endsWith('api.js'))) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`[PharmaCare Server] Running on http://localhost:${PORT}`);
  });
}
