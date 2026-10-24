/**
 * Import this FIRST in every integration suite (ES modules run imports in order, before the suite body).
 * It points the API at a fresh database (with the sample catalog) and a temp backup folder in an OS temp
 * folder, and installs a fixed test developer key, so suites never touch the real database, backups or license.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// RFC 4648 Base32 test key (not the real developer key)
export const TEST_DEVELOPER_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const TEST_DEVELOPER_EMAIL = 'developer@pharmacare.test';

process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';
process.env.PHARMACARE_SAMPLE_DATA = 'true';
process.env.PHARMACARE_DEV_TOTP_SECRET = TEST_DEVELOPER_SECRET;
process.env.PHARMACARE_DEVELOPER_EMAIL = TEST_DEVELOPER_EMAIL;

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacare-suite-'));
const dataDir = path.join(TEST_ROOT, 'data');
fs.mkdirSync(dataDir, { recursive: true });

process.env.PHARMACARE_DATA_DIR = dataDir;
process.env.PHARMACARE_BACKUP_DIR = path.join(TEST_ROOT, 'backups');

process.on('exit', () => {
  try {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // Temp folder is cleaned by the OS eventually
  }
});
