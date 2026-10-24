import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { isValidBackupTime, isValidFrequency } from '../backup/scheduler';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { hashPassword } from '../security/passwords';
import { logSecurityAudit } from '../security/audit';
import { getDeveloperEmail, isDeveloperKeyConfigured } from '../security/developerKey';
import { verifyDeveloperCode, DEVELOPER_CODE_ERRORS } from '../security/developerAuth';
import { createSession } from '../security/sessions';
import { licenseWrites } from '../security/license';
import { buildDemoLicense, buildFullLicense } from '../security/licenseMath';
import { DEFAULT_ADMIN_PERMISSIONS, normalizePermissions } from '../../shared/permissions';
import { parseBody, setupUnlockSchema, setupCompleteSchema } from '../validation/schemas';
import { isSetupLocked, sendError } from '../http/context';
import { getCloudStatus, getDriveConnectProgress, startDriveConnect } from '../backup/cloud/cloudBackup';
import { isDriveConfigured } from '../backup/cloud/googleDrive';
import { DEFAULT_BACKUP_MODE } from '../../shared/backup';
import { sessionUserPayload } from '../http/formatters';

// First-time setup wizard, unlocked only by the developer master authenticator code
const router = Router();

const SETUP_LOCKED_ERROR = { error: 'Setup wizard is permanently locked. System is already initialized.' };

// Setup unlock: only the developer's master authenticator code opens the wizard.
// Failed attempts are limited in memory because no user row exists yet.
const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000;
const SETUP_MAX_ATTEMPTS = 5;
const SETUP_LOCK_MS = 15 * 60 * 1000;
const setupTokens = new Map<string, number>();
const setupUnlockLimiter = { failures: 0, lockedUntil: 0 };

function hashSetupToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isSetupTokenValid(token: string): boolean {
  const expiresAt = setupTokens.get(hashSetupToken(token));
  return !!expiresAt && expiresAt > Date.now();
}

router.get('/api/setup/status', async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      isSetupCompleted: await isSetupLocked(),
      developerEmail: getDeveloperEmail(),
      developerKeyConfigured: isDeveloperKeyConfigured(),
      onlineBackupAvailable: isDriveConfigured()
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/setup/unlock', async (req: Request, res: Response) => {
  try {
    if (await isSetupLocked()) {
      return res.status(403).json(SETUP_LOCKED_ERROR);
    }
    if (setupUnlockLimiter.lockedUntil > Date.now()) {
      const remainingMins = Math.max(1, Math.ceil((setupUnlockLimiter.lockedUntil - Date.now()) / 60000));
      return res.status(429).json({ error: `Too many wrong codes. Setup is locked for ${remainingMins} minute(s).` });
    }
    if (!parseBody(setupUnlockSchema, req.body, res)) return;

    const result = await verifyDeveloperCode(String(req.body.code));
    if (result !== 'ok') {
      if (result !== 'not_configured') {
        setupUnlockLimiter.failures += 1;
        if (setupUnlockLimiter.failures >= SETUP_MAX_ATTEMPTS) {
          setupUnlockLimiter.failures = 0;
          setupUnlockLimiter.lockedUntil = Date.now() + SETUP_LOCK_MS;
        }
      }
      await logSecurityAudit({
        action: 'SETUP_UNLOCK',
        module: 'SECURITY',
        status: 'FAILED',
        details: `Setup wizard unlock rejected (${result})`
      });
      return res.status(result === 'not_configured' ? 500 : 401).json({ error: DEVELOPER_CODE_ERRORS[result] });
    }

    setupUnlockLimiter.failures = 0;
    const setupToken = crypto.randomBytes(32).toString('base64url');
    setupTokens.clear();
    setupTokens.set(hashSetupToken(setupToken), Date.now() + SETUP_TOKEN_TTL_MS);

    await logSecurityAudit({
      action: 'SETUP_UNLOCK',
      module: 'SECURITY',
      status: 'SUCCESS',
      details: 'Setup wizard unlocked with the developer authenticator code'
    });

    res.json({ success: true, setupToken, developerEmail: getDeveloperEmail(), expiresInMinutes: SETUP_TOKEN_TTL_MS / 60000 });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Google Drive for online backups can be connected from the wizard (the developer is not signed in yet)
async function requireSetupToken(req: Request, res: Response): Promise<boolean> {
  if (await isSetupLocked()) {
    res.status(403).json(SETUP_LOCKED_ERROR);
    return false;
  }
  if (typeof req.body?.setupToken !== 'string' || !isSetupTokenValid(req.body.setupToken)) {
    res.status(401).json({ error: 'Setup session expired. Unlock the wizard with the developer code again.' });
    return false;
  }
  return true;
}

router.post('/api/setup/cloud/connect', async (req: Request, res: Response) => {
  try {
    if (!(await requireSetupToken(req, res))) return;
    res.json(await startDriveConnect({ username: 'Developer (setup)' }));
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.post('/api/setup/cloud/status', async (req: Request, res: Response) => {
  try {
    if (!(await requireSetupToken(req, res))) return;
    const status = await getCloudStatus();
    res.json({ available: status.available, connected: status.connected, account_email: status.account_email, connect: getDriveConnectProgress() });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/setup/complete', async (req: Request, res: Response) => {
  try {
    if (await isSetupLocked()) {
      return res.status(403).json(SETUP_LOCKED_ERROR);
    }
    if (!parseBody(setupCompleteSchema, req.body, res)) return;
    const body = req.body as {
      setupToken: string;
      storeName: string;
      storeAddress: string;
      admin: { fullName: string; username: string; password: string };
      backup: { dir?: string; mode?: string; frequency: string; time: string; weeklyDay?: number };
      adminPermissions: Record<string, boolean>;
      policies: Record<string, boolean>;
      license: { mode: 'full' } | { mode: 'demo'; demoDays: number };
    };

    if (!isSetupTokenValid(body.setupToken)) {
      return res.status(401).json({ error: 'Setup session expired. Unlock the wizard with the developer code again.' });
    }

    if (!isValidFrequency(body.backup.frequency)) {
      return res.status(400).json({ error: 'Invalid backup frequency. Allowed: off, twice_daily, daily, weekly' });
    }
    if (!isValidBackupTime(body.backup.time)) {
      return res.status(400).json({ error: 'Backup time must use 24-hour HH:MM format' });
    }

    // The backup folder must exist (or be creatable) and be writable on this computer
    let backupDir = '';
    if (body.backup.dir) {
      backupDir = path.resolve(body.backup.dir);
      try {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.accessSync(backupDir, fs.constants.W_OK);
      } catch {
        return res.status(400).json({ error: `Backup folder is not writable: ${backupDir}` });
      }
    }

    const adminUsername = body.admin.username.trim();
    const developerEmail = getDeveloperEmail();
    const existingAdmin = await prisma.user.findUnique({ where: { username: adminUsername } });
    if (existingAdmin && existingAdmin.role !== 'admin') {
      return res.status(400).json({ error: `Username "${adminUsername}" is already used by a ${existingAdmin.role} account` });
    }

    const adminPermissions = normalizePermissions(body.adminPermissions, DEFAULT_ADMIN_PERMISSIONS);
    const now = Date.now();
    const license = body.license.mode === 'demo' ? buildDemoLicense(body.license.demoDays, now) : buildFullLicense(now);
    const adminPasswordHash = await hashPassword(body.admin.password);

    const settings: Record<string, string> = {
      store_name: body.storeName.trim(),
      store_address: body.storeAddress.trim(),
      backup_mode: body.backup.mode ?? DEFAULT_BACKUP_MODE,
      backup_frequency: body.backup.frequency,
      backup_scheduled_time: body.backup.time,
      backup_weekly_day: String(body.backup.weeklyDay ?? 0),
      allow_admin_create_cashier: String(body.policies.allow_admin_create_cashier),
      allow_admin_create_admin: String(body.policies.allow_admin_create_admin),
      allow_admin_edit_store_identity: String(body.policies.allow_admin_edit_store_identity),
      allow_admin_hide_store_identity: String(body.policies.allow_admin_hide_store_identity),
      developer_email: developerEmail,
      setup_completed: 'true'
    };
    if (backupDir) settings.auto_backup_dir = backupDir;

    const existingDev = await prisma.user.findFirst({
      where: { OR: [{ role: 'developer' }, { email: developerEmail }, { username: 'developer' }] }
    });
    const developerData = {
      username: 'developer',
      email: developerEmail,
      fullName: 'System Developer',
      role: 'developer',
      status: 'active',
      totpSecret: null,
      failedLoginAttempts: 0,
      lockedUntil: null
    };
    const adminData = {
      username: adminUsername,
      password: adminPasswordHash,
      fullName: body.admin.fullName.trim(),
      role: 'admin',
      status: 'active'
    };

    const [devUser, adminUser] = await prisma.$transaction([
      existingDev
        ? prisma.user.update({ where: { id: existingDev.id }, data: developerData })
        : prisma.user.create({ data: { ...developerData, password: await hashPassword(crypto.randomBytes(24).toString('hex')) } }),
      existingAdmin
        ? prisma.user.update({ where: { id: existingAdmin.id }, data: adminData })
        : prisma.user.create({ data: adminData }),
      prisma.role.upsert({
        where: { name: 'admin' },
        update: { permissions: JSON.stringify(adminPermissions) },
        create: { name: 'admin', displayName: 'Administrator', description: 'Full system access and master privileges', isSystem: 1, permissions: JSON.stringify(adminPermissions) }
      }),
      ...licenseWrites(license),
      ...Object.entries(settings).map(([key, value]) =>
        prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
      )
    ]);
    setupTokens.clear();

    await logSecurityAudit({
      action: 'SETUP_COMPLETED',
      module: 'SECURITY',
      status: 'SUCCESS',
      details: `Initial setup completed by developer ${developerEmail}. Admin account: ${adminUser.username}. License: ${license.mode}${license.mode === 'demo' ? ` (${license.demoDays} days)` : ''}`,
      affectedUser: adminUser.username,
      userId: devUser.id,
      userName: devUser.fullName
    });

    res.json({
      success: true,
      message: 'Setup completed and locked successfully',
      token: createSession(devUser),
      user: await sessionUserPayload(devUser)
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
