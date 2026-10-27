import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { pruneBackupsByRetentionLimit, getConfiguredBackupDir } from '../database/backup';
import { isValidBackupTime, isValidFrequency } from '../backup/scheduler';
import {
  disconnectDrive,
  getCloudStatus,
  getDriveConnectProgress,
  runCloudUploads,
  startDriveConnect
} from '../backup/cloud/cloudBackup';
import { isBackupMode } from '../../shared/backup';
import { hashPassword } from '../security/passwords';
import { PASSWORD_MIN_MESSAGE, isValidPassword } from '../../shared/passwords';
import { logDenied, logSecurityAudit } from '../security/audit';
import { getDeveloperEmail } from '../security/developerKey';
import { revokeUserSessions } from '../security/sessions';
import { parseBody, developerSettingsSchema } from '../validation/schemas';
import { FOOTER_MAX_LENGTH } from '../../shared/invoice';
import { DEFAULT_SETTINGS } from '../../shared/settingsDefaults';
import {
  DEVELOPER_INFO_PLACEMENTS,
  DEVELOPER_PROFILE_FIELDS,
  DEVELOPER_PROFILE_SETTING_KEYS,
  WHATSAPP_CREDIT_LEAD_MAX,
  WHATSAPP_CREDIT_LEAD_SETTING,
  isValidInfoFields,
  parseInfoFields
} from '../../shared/developerProfile';
import { getActingUser, sendError } from '../http/context';

// Developer-only settings, password resets
const router = Router();

// Settings the Developer edits on the Developer page (developer_email is read-only: it comes from the master key)
const WRITABLE_DEVELOPER_SETTING_KEYS = [
  'backup_retention_limit',
  'backup_mode',
  'backup_frequency',
  'backup_scheduled_time',
  'backup_weekly_day',
  'allow_admin_create_cashier',
  'allow_admin_create_admin',
  'allow_admin_edit_store_identity',
  'allow_admin_hide_store_identity',
  'loyalty_feature_allowed',
  'store_name',
  'store_address',
  'developer_invoice_footer',
  ...DEVELOPER_PROFILE_SETTING_KEYS
];
const DEVELOPER_SETTING_KEYS = [...WRITABLE_DEVELOPER_SETTING_KEYS, 'developer_email'];

router.get('/api/developer/settings', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }

    const settingsRows = await prisma.systemSetting.findMany({ where: { key: { in: DEVELOPER_SETTING_KEYS } } });
    const devSettings: Record<string, string> = Object.fromEntries(
      DEVELOPER_SETTING_KEYS.map(key => [key, DEFAULT_SETTINGS[key] ?? ''])
    );

    for (const row of settingsRows) {
      devSettings[row.key] = row.value;
    }
    // The developer sign-in email is fixed by the build's master key
    devSettings.developer_email = getDeveloperEmail();
    if (devSettings.backup_frequency === 'on_shift_close') {
      devSettings.backup_frequency = 'daily';
    }

    res.json(devSettings);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.put('/api/developer/settings', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      await logSecurityAudit({
        action: 'DEVELOPER_SETTINGS_UPDATE',
        module: 'DEVELOPER_SETTINGS',
        status: 'FAILED',
        details: 'Unauthorized attempt to modify developer settings without developer role',
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }

    if (!parseBody(developerSettingsSchema, req.body, res)) return;

    const updates: Record<string, string> = {};
    for (const key of WRITABLE_DEVELOPER_SETTING_KEYS) {
      if (req.body[key] !== undefined) {
        updates[key] = String(req.body[key]);
      }
    }

    // Backup policy validation
    if (updates.backup_mode !== undefined && !isBackupMode(updates.backup_mode)) {
      return res.status(400).json({ error: 'Invalid backup type. Allowed: offline, online, both' });
    }
    if (updates.backup_frequency !== undefined && !isValidFrequency(updates.backup_frequency)) {
      return res.status(400).json({ error: 'Invalid backup frequency. Allowed: off, twice_daily, daily, weekly' });
    }
    if (updates.backup_scheduled_time !== undefined && !isValidBackupTime(updates.backup_scheduled_time)) {
      return res.status(400).json({ error: 'Backup time must use 24-hour HH:MM format' });
    }
    if (updates.backup_weekly_day !== undefined && !/^[0-6]$/.test(updates.backup_weekly_day)) {
      return res.status(400).json({ error: 'Weekly backup day must be 0 (Sunday) to 6 (Saturday)' });
    }
    if (updates.backup_retention_limit !== undefined) {
      const limit = Number(updates.backup_retention_limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 365) {
        return res.status(400).json({ error: 'Backup retention limit must be a whole number between 1 and 365' });
      }
      updates.backup_retention_limit = String(limit);
    }

    // Protected store identity & footer validation
    for (const key of ['store_name', 'store_address']) {
      if (updates[key] !== undefined) {
        updates[key] = updates[key].trim();
        if (!updates[key]) {
          return res.status(400).json({ error: `${key === 'store_name' ? 'Store name' : 'Store address'} cannot be empty` });
        }
      }
    }
    if (updates.developer_invoice_footer !== undefined) {
      updates.developer_invoice_footer = updates.developer_invoice_footer.trim();
      if (!updates.developer_invoice_footer) {
        return res.status(400).json({ error: 'Invoice footer cannot be empty' });
      }
      if (updates.developer_invoice_footer.length > FOOTER_MAX_LENGTH) {
        return res.status(400).json({ error: `Invoice footer cannot exceed ${FOOTER_MAX_LENGTH} characters` });
      }
    }
    // Developer contact details (advertising) and where each one is shown
    for (const field of DEVELOPER_PROFILE_FIELDS) {
      if (updates[field.setting] === undefined) continue;
      updates[field.setting] = updates[field.setting].trim();
      if (updates[field.setting].length > field.maxLength) {
        return res.status(400).json({ error: `Developer ${field.label.toLowerCase()} cannot exceed ${field.maxLength} characters` });
      }
    }
    if (updates[WHATSAPP_CREDIT_LEAD_SETTING] !== undefined) {
      updates[WHATSAPP_CREDIT_LEAD_SETTING] = updates[WHATSAPP_CREDIT_LEAD_SETTING].trim();
      if (updates[WHATSAPP_CREDIT_LEAD_SETTING].length > WHATSAPP_CREDIT_LEAD_MAX) {
        return res.status(400).json({ error: `The WhatsApp line text cannot exceed ${WHATSAPP_CREDIT_LEAD_MAX} characters` });
      }
    }
    for (const placement of DEVELOPER_INFO_PLACEMENTS) {
      if (updates[placement.setting] === undefined) continue;
      if (!isValidInfoFields(updates[placement.setting])) {
        return res.status(400).json({ error: `Unknown developer detail selected for the ${placement.label.toLowerCase()}` });
      }
      updates[placement.setting] = parseInfoFields(updates[placement.setting]).join(',');
    }
    for (const key of ['allow_admin_create_cashier', 'allow_admin_create_admin', 'allow_admin_edit_store_identity', 'allow_admin_hide_store_identity', 'loyalty_feature_allowed']) {
      if (updates[key] !== undefined && updates[key] !== 'true' && updates[key] !== 'false') {
        return res.status(400).json({ error: `${key} must be 'true' or 'false'` });
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.$transaction(
        Object.entries(updates).map(([k, v]) =>
          prisma.systemSetting.upsert({
            where: { key: k },
            update: { value: v },
            create: { key: k, value: v }
          })
        )
      );
    }

    // Apply a lowered retention limit (or Online mode's smaller local copy count) right away
    if (updates.backup_retention_limit || updates.backup_mode) {
      pruneBackupsByRetentionLimit(undefined, getConfiguredBackupDir());
    }

    await logSecurityAudit({
      action: 'DEVELOPER_SETTINGS_UPDATE',
      module: 'DEVELOPER_SETTINGS',
      status: 'SUCCESS',
      details: `Updated developer settings keys: ${Object.keys(updates).join(', ')}`,
      userId: actingUser.id,
      userName: actingUser.username
    });

    res.json({ success: true, message: 'Developer settings updated successfully' });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// -------------------------------------------------------------
// Online backup (Google Drive): only the Developer connects or changes the account
// -------------------------------------------------------------
async function requireDeveloper(req: Request, res: Response) {
  const actingUser = await getActingUser(req);
  if (!actingUser || actingUser.role !== 'developer') {
    await logDenied(actingUser, 'developer', req);
    res.status(403).json({ error: 'Access denied: Developer role required' });
    return null;
  }
  return actingUser;
}

router.get('/api/developer/cloud', async (req: Request, res: Response) => {
  try {
    if (!(await requireDeveloper(req, res))) return;
    res.json({ ...(await getCloudStatus()), connect: getDriveConnectProgress() });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/developer/cloud/connect', async (req: Request, res: Response) => {
  try {
    const actingUser = await requireDeveloper(req, res);
    if (!actingUser) return;
    res.json(await startDriveConnect({ id: actingUser.id, username: actingUser.username }));
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.post('/api/developer/cloud/disconnect', async (req: Request, res: Response) => {
  try {
    const actingUser = await requireDeveloper(req, res);
    if (!actingUser) return;
    await disconnectDrive({ id: actingUser.id, username: actingUser.username });
    res.json({ success: true, message: 'Google Drive disconnected. Online backups are paused until it is connected again.' });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Retry waiting uploads now instead of waiting for the next automatic retry
router.post('/api/developer/cloud/upload', async (req: Request, res: Response) => {
  try {
    if (!(await requireDeveloper(req, res))) return;
    const outcome = await runCloudUploads({ force: true });
    if (outcome.status === 'failed') return res.status(502).json({ error: outcome.error });
    res.json(outcome);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/developer/users/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      await logSecurityAudit({
        action: 'DEVELOPER_PASSWORD_RESET',
        module: 'USERS',
        status: 'FAILED',
        details: 'Unauthorized attempt to reset user password without developer role',
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }

    const targetId = Number(req.params.id);
    const { new_password } = req.body;
    if (!isValidPassword(new_password)) {
      return res.status(400).json({ error: PASSWORD_MIN_MESSAGE });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    const hashedPassword = await hashPassword(new_password.trim());
    await prisma.user.update({
      where: { id: targetId },
      data: { password: hashedPassword }
    });
    revokeUserSessions(targetId);

    await logSecurityAudit({
      action: 'DEVELOPER_PASSWORD_RESET',
      module: 'USERS',
      status: 'SUCCESS',
      details: `Developer reset password for user ${targetUser.username} (${targetUser.role})`,
      affectedUser: targetUser.username,
      userId: actingUser.id,
      userName: actingUser.username
    });

    res.json({ success: true, message: `Password reset successfully for ${targetUser.username}` });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
