import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { pruneBackupsByRetentionLimit, getConfiguredBackupDir } from '../database/backup';
import { isValidBackupTime, isValidFrequency } from '../backup/scheduler';
import { hashPassword } from '../security/passwords';
import { logSecurityAudit } from '../security/audit';
import { getDeveloperEmail } from '../security/developerKey';
import { revokeUserSessions } from '../security/sessions';
import { parseBody, developerSettingsSchema } from '../validation/schemas';
import { DEFAULT_DEVELOPER_FOOTER, FOOTER_MAX_LENGTH } from '../../shared/invoice';
import { getActingUser, sendError } from '../http/context';

// Developer-only settings, password resets
const router = Router();

router.get('/api/developer/settings', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }

    const settingsRows = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'backup_retention_limit',
            'backup_frequency',
            'backup_scheduled_time',
            'backup_weekly_day',
            'allow_admin_create_cashier',
            'allow_admin_create_admin',
            'allow_admin_edit_store_identity',
            'allow_admin_hide_store_identity',
            'store_name',
            'store_address',
            'developer_invoice_footer',
            'developer_email'
          ]
        }
      }
    });

    const devSettings: Record<string, string> = {
      backup_retention_limit: '30',
      backup_frequency: 'daily',
      backup_scheduled_time: '23:00',
      backup_weekly_day: '0',
      allow_admin_create_cashier: 'true',
      allow_admin_create_admin: 'false',
      allow_admin_edit_store_identity: 'false',
      allow_admin_hide_store_identity: 'false',
      store_name: 'PharmaCare Pharmacy',
      store_address: 'Main Boulevard, Healthcare City',
      developer_invoice_footer: DEFAULT_DEVELOPER_FOOTER,
      developer_email: ''
    };

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

    const allowedKeys = [
      'backup_retention_limit',
      'backup_frequency',
      'backup_scheduled_time',
      'backup_weekly_day',
      'allow_admin_create_cashier',
      'allow_admin_create_admin',
      'allow_admin_edit_store_identity',
      'allow_admin_hide_store_identity',
      'store_name',
      'store_address',
      'developer_invoice_footer'
    ];

    const updates: Record<string, string> = {};
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) {
        updates[key] = String(req.body[key]);
      }
    }

    // Backup policy validation
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
    for (const key of ['allow_admin_create_cashier', 'allow_admin_create_admin', 'allow_admin_edit_store_identity', 'allow_admin_hide_store_identity']) {
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

    // Apply a lowered retention limit right away (only verified routine backups in the backup folder)
    if (updates.backup_retention_limit) {
      pruneBackupsByRetentionLimit(Number(updates.backup_retention_limit), getConfiguredBackupDir());
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
    if (!new_password || typeof new_password !== 'string' || new_password.trim().length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
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
