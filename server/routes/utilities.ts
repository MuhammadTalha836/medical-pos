import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { getBackupList, restoreDatabase, resetStockZero, optimizeDatabase, countRetainedBackups, getRetentionLimit, PRE_RESTORE_KEEP } from '../database/backup';
import { getScheduleState, isValidBackupTime, runRecordedBackup } from '../backup/scheduler';
import { logSecurityAudit } from '../security/audit';
import { parseBody, backupScheduleSchema } from '../validation/schemas';
import { getActingUser, hasRolePermission, sendError } from '../http/context';

// Backups, restore, stock zero and database optimization
const router = Router();

async function requireBackupPermission(req: Request, res: Response, permissionKey: 'can_backup' | 'can_restore', action: string) {
  const actingUser = await getActingUser(req);
  if (!actingUser || !(await hasRolePermission(actingUser.role, permissionKey))) {
    await logSecurityAudit({
      action,
      module: 'BACKUP',
      status: 'FAILED',
      details: `Unauthorized ${action} attempt without ${permissionKey} permission`,
      userId: actingUser?.id,
      userName: actingUser?.username
    });
    res.status(403).json({ error: `Access denied: ${permissionKey} permission required` });
    return null;
  }
  return actingUser;
}

router.get('/api/utilities/backups', async (req: Request, res: Response) => {
  try {
    if (!(await requireBackupPermission(req, res, 'can_backup', 'BACKUP_LIST'))) return;
    const list = getBackupList();
    res.json(list);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/utilities/backup', async (req: Request, res: Response) => {
  try {
    const actingUser = await requireBackupPermission(req, res, 'can_backup', 'MANUAL_BACKUP');
    if (!actingUser) return;

    const { result, error } = await runRecordedBackup('manual', { id: actingUser.id, username: actingUser.username });
    if (!result) {
      return res.status(500).json({ error });
    }
    res.json(result);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Backup health for the dashboard (any signed-in user; file paths only for backup operators)
router.get('/api/backups/status', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser) {
      return res.status(401).json({ error: 'Sign in required' });
    }
    const canSeePaths = await hasRolePermission(actingUser.role, 'can_backup');
    const { settings, frequency, time, weekday, schedule } = await getScheduleState();

    res.json({
      frequency,
      scheduled_time: time,
      weekly_day: weekday,
      enabled: schedule.enabled,
      next_run_at: schedule.nextRunAt ? schedule.nextRunAt.toISOString() : null,
      is_overdue: schedule.isDue,
      last_success_at: settings.last_backup_time || null,
      last_attempt_at: settings.last_backup_attempt_at || null,
      last_status: settings.last_backup_status || (settings.last_backup_time ? 'success' : null),
      last_error: settings.last_backup_status === 'failed' ? settings.last_backup_error || null : null,
      last_type: settings.last_backup_type || null,
      last_backup_file: canSeePaths ? settings.last_backup_file || null : null,
      retention_limit: getRetentionLimit(),
      retained_count: countRetainedBackups(),
      pre_restore_keep: PRE_RESTORE_KEEP
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Admin may change only the time of day; frequency stays under Developer control
router.put('/api/backups/schedule', async (req: Request, res: Response) => {
  try {
    const actingUser = await requireBackupPermission(req, res, 'can_backup', 'BACKUP_SCHEDULE_UPDATE');
    if (!actingUser) return;

    const body = parseBody(backupScheduleSchema, req.body, res);
    if (!body) return;
    const time = body.backup_scheduled_time;
    if (!isValidBackupTime(time)) {
      return res.status(400).json({ error: 'Backup time must use 24-hour HH:MM format' });
    }

    await prisma.systemSetting.upsert({
      where: { key: 'backup_scheduled_time' },
      update: { value: time },
      create: { key: 'backup_scheduled_time', value: time }
    });
    await logSecurityAudit({
      action: 'BACKUP_SCHEDULE_UPDATE',
      module: 'BACKUP',
      status: 'SUCCESS',
      details: `Backup time of day set to ${time}`,
      userId: actingUser.id,
      userName: actingUser.username
    });

    const { schedule } = await getScheduleState();
    res.json({ success: true, backup_scheduled_time: time, next_run_at: schedule.nextRunAt ? schedule.nextRunAt.toISOString() : null });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/utilities/restore', async (req: Request, res: Response) => {
  const actingUser = await requireBackupPermission(req, res, 'can_restore', 'DATABASE_RESTORE');
  if (!actingUser) return;

  const { backupFilePath } = req.body;
  if (!backupFilePath) {
    return res.status(400).json({ error: 'backupFilePath is required' });
  }

  try {
    const result = await restoreDatabase(backupFilePath);
    await logSecurityAudit({
      action: 'DATABASE_RESTORE',
      module: 'BACKUP',
      status: 'SUCCESS',
      details: `Database restored from ${String(backupFilePath).split(/[\\/]/).pop()}`,
      userId: actingUser.id,
      userName: actingUser.username
    });
    res.json(result);
  } catch (error: unknown) {
    await logSecurityAudit({
      action: 'DATABASE_RESTORE',
      module: 'BACKUP',
      status: 'FAILED',
      details: error instanceof Error ? error.message : String(error),
      userId: actingUser.id,
      userName: actingUser.username
    });
    sendError(res, error, 400);
  }
});

router.post('/api/utilities/stock-zero', async (req: Request, res: Response) => {
  const { company_id, confirmation_code } = req.body;
  const actingUser = await getActingUser(req);
  if (!actingUser || !(await hasRolePermission(actingUser.role, 'can_stock_zero'))) {
    return res.status(403).json({ error: 'Access denied: stock reset permission required' });
  }
  if (confirmation_code !== 'RESET-ZERO-CONFIRM') {
    return res.status(400).json({ error: 'Invalid confirmation code. Please enter RESET-ZERO-CONFIRM to proceed.' });
  }

  try {
    const affected = resetStockZero(company_id ? Number(company_id) : undefined, actingUser.id, actingUser.fullName || actingUser.username);
    res.json({ success: true, message: `Successfully zeroed stock for ${affected} product(s).`, affected });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/utilities/optimize', (_req: Request, res: Response) => {
  try {
    const result = optimizeDatabase();
    res.json(result);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
