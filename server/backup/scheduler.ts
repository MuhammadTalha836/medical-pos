import { prisma } from '../database/prisma';
import { createBackup, BackupResult, BackupType, getConfiguredBackupDir } from '../database/backup';
import { logSecurityAudit } from '../security/audit';
import {
  computeSchedule,
  DEFAULT_BACKUP_TIME,
  isValidBackupTime,
  normalizeFrequency
} from './schedule';

export * from './schedule';

const CHECK_INTERVAL_MS = 60 * 1000;
const STARTUP_DELAY_MS = 15 * 1000;

// -------------------------------------------------------------
// Persistence of backup state in system_settings
// -------------------------------------------------------------
const STATE_KEYS = [
  'backup_frequency',
  'backup_scheduled_time',
  'backup_weekly_day',
  'auto_backup_dir',
  'secondary_backup_dir',
  'last_backup_time',
  'last_backup_file',
  'last_backup_status',
  'last_backup_error',
  'last_backup_attempt_at',
  'last_backup_type'
];

async function readBackupSettings(): Promise<Record<string, string>> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: STATE_KEYS } } });
  const values: Record<string, string> = {};
  for (const row of rows) values[row.key] = row.value;
  return values;
}

async function writeSettings(values: Record<string, string>) {
  await prisma.$transaction(
    Object.entries(values).map(([key, value]) =>
      prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Schedule inputs derived from stored settings (shared by the scheduler and the status endpoint).
 */
export async function getScheduleState(now: Date = new Date()) {
  const s = await readBackupSettings();
  const frequency = normalizeFrequency(s.backup_frequency);
  const time = isValidBackupTime(s.backup_scheduled_time) ? s.backup_scheduled_time : DEFAULT_BACKUP_TIME;
  const weekday = parseInt(s.backup_weekly_day ?? '0', 10);
  const schedule = computeSchedule({
    frequency,
    time,
    weekday,
    lastSuccessAt: parseDate(s.last_backup_time),
    lastAttemptAt: parseDate(s.last_backup_attempt_at),
    lastAttemptFailed: s.last_backup_status === 'failed',
    now
  });
  return { settings: s, frequency, time, weekday: isNaN(weekday) ? 0 : weekday, schedule };
}

/**
 * Records the outcome of any backup (scheduled, manual or shift-close) so the dashboard and scheduler
 * share one source of truth. Failures keep the last successful backup time untouched.
 */
async function recordBackupOutcome(
  type: BackupType,
  outcome: { result?: BackupResult; error?: unknown },
  actor?: { id?: number | null; username?: string | null }
) {
  const attemptAt = new Date().toISOString();
  if (outcome.result) {
    await writeSettings({
      last_backup_time: outcome.result.timestamp,
      last_backup_file: outcome.result.filepath,
      last_backup_status: 'success',
      last_backup_error: '',
      last_backup_attempt_at: attemptAt,
      last_backup_type: type
    });
  } else {
    const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    await writeSettings({
      last_backup_status: 'failed',
      last_backup_error: message.slice(0, 500),
      last_backup_attempt_at: attemptAt,
      last_backup_type: type
    });
  }

  await logSecurityAudit({
    action: type === 'scheduled' ? 'SCHEDULED_BACKUP' : type === 'shift_close' ? 'SHIFT_CLOSE_BACKUP' : 'MANUAL_BACKUP',
    module: 'BACKUP',
    status: outcome.result ? 'SUCCESS' : 'FAILED',
    details: outcome.result
      ? `Verified backup ${outcome.result.filename} created${outcome.result.prunedCount ? `, pruned ${outcome.result.prunedCount} old backup(s)` : ''}`
      : `Backup failed: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`,
    userId: actor?.id ?? null,
    userName: actor?.username ?? 'System'
  });
}

/**
 * Runs a backup into the configured folders and records the outcome. Never throws.
 */
export async function runRecordedBackup(
  type: BackupType,
  actor?: { id?: number | null; username?: string | null }
): Promise<{ result?: BackupResult; error?: string }> {
  const s = await readBackupSettings();
  try {
    const result = await createBackup(type, getConfiguredBackupDir(), s.secondary_backup_dir || undefined);
    await recordBackupOutcome(type, { result }, actor);
    return { result };
  } catch (error) {
    await recordBackupOutcome(type, { error }, actor);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

let schedulerRunning = false;

/**
 * One scheduler tick: runs a scheduled backup if a slot is due (including missed slots after power-off).
 */
/** Shift-close backup: runs alongside the schedule unless the Developer switched automatic backups off. */
export async function runShiftCloseBackup(actor: { id?: number | null; username?: string | null }) {
  const { frequency } = await getScheduleState();
  if (frequency === 'off') return null;
  const { result, error } = await runRecordedBackup('shift_close', actor);
  if (error) console.error('Shift-close backup error:', error);
  return result ?? null;
}

export async function runSchedulerTick(now: Date = new Date()): Promise<boolean> {
  if (schedulerRunning) return false;
  schedulerRunning = true;
  try {
    const { schedule } = await getScheduleState(now);
    if (!schedule.isDue) return false;
    console.log('[Backup Scheduler] Scheduled backup is due, starting...');
    const { result, error } = await runRecordedBackup('scheduled');
    if (result) {
      console.log(`[Backup Scheduler] Verified backup created: ${result.filename}`);
    } else {
      console.error(`[Backup Scheduler] Backup failed (will retry later): ${error}`);
    }
    return true;
  } catch (err: any) {
    console.error('[Backup Scheduler] Error:', err?.message || err);
    return false;
  } finally {
    schedulerRunning = false;
  }
}

/**
 * Starts the offline backup scheduler: a check shortly after startup (catches up runs missed while the
 * PC was off) and then once a minute. Timers are unref'd so they never keep the process alive on their own.
 */
export function startBackupScheduler() {
  setTimeout(() => void runSchedulerTick(), STARTUP_DELAY_MS).unref();
  setInterval(() => void runSchedulerTick(), CHECK_INTERVAL_MS).unref();
}
