import { prisma } from '../database/prisma';
import { createBackup, BackupResult, BackupType, getConfiguredBackupDir } from '../database/backup';
import { logSecurityAudit } from '../security/audit';

// Phase 4: Developer-controlled frequency; Admin controls only the time of day.
export const BACKUP_FREQUENCIES = ['off', 'twice_daily', 'daily', 'weekly'] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

export const DEFAULT_BACKUP_TIME = '23:00';
export const FAILURE_RETRY_MS = 15 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const STARTUP_DELAY_MS = 15 * 1000;

export function isValidFrequency(value: unknown): value is BackupFrequency {
  return typeof value === 'string' && (BACKUP_FREQUENCIES as readonly string[]).includes(value);
}

export function isValidBackupTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function normalizeFrequency(value: unknown): BackupFrequency {
  // 'on_shift_close' predates Phase 4: shift-close backups now always run alongside a daily schedule
  if (value === 'on_shift_close') return 'daily';
  return isValidFrequency(value) ? value : 'daily';
}

export interface ScheduleInput {
  frequency: BackupFrequency;
  time: string; // 'HH:MM' local time
  weekday?: number; // 0 = Sunday ... 6 = Saturday, used by 'weekly'
  lastSuccessAt?: Date | null;
  lastAttemptAt?: Date | null;
  lastAttemptFailed?: boolean;
  now: Date;
}

export interface ScheduleResult {
  enabled: boolean;
  latestDueSlot: Date | null; // most recent scheduled slot at or before now
  nextRunAt: Date | null; // when the next backup will run
  isDue: boolean;
}

function parseTime(time: string): { hours: number; minutes: number } {
  const [h, m] = (isValidBackupTime(time) ? time : DEFAULT_BACKUP_TIME).split(':').map(Number);
  return { hours: h, minutes: m };
}

/**
 * All slot timestamps for one calendar day (local time) under the given rule.
 */
function slotsForDay(day: Date, frequency: BackupFrequency, time: string, weekday: number): Date[] {
  const { hours, minutes } = parseTime(time);
  const base = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
  if (frequency === 'daily') return [base];
  if (frequency === 'weekly') return day.getDay() === weekday ? [base] : [];
  if (frequency === 'twice_daily') {
    const second = new Date(day.getFullYear(), day.getMonth(), day.getDate(), (hours + 12) % 24, minutes, 0, 0);
    return [base, second].sort((a, b) => a.getTime() - b.getTime());
  }
  return [];
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Pure schedule calculation used by the background scheduler and the status endpoint.
 * - Catch-up: if the newest slot at or before now has no successful backup after it, a backup is due.
 *   Several missed slots (e.g. the PC was off for days) produce a single catch-up backup.
 * - Failure backoff: after a failed attempt, retries wait FAILURE_RETRY_MS.
 * - Clock rollback: a last success "in the future" is ignored so backups do not stop.
 */
export function computeSchedule(input: ScheduleInput): ScheduleResult {
  const { frequency, time, now } = input;
  const weekday = Number.isInteger(input.weekday) && input.weekday! >= 0 && input.weekday! <= 6 ? input.weekday! : 0;

  if (frequency === 'off') {
    return { enabled: false, latestDueSlot: null, nextRunAt: null, isDue: false };
  }

  // Newest slot at or before now (search back up to 8 days covers the weekly rule)
  let latestDueSlot: Date | null = null;
  for (let offset = 0; offset <= 8 && !latestDueSlot; offset++) {
    const candidates = slotsForDay(addDays(now, -offset), frequency, time, weekday).filter(s => s.getTime() <= now.getTime());
    if (candidates.length > 0) latestDueSlot = candidates[candidates.length - 1];
  }

  // Next slot strictly after now
  let upcomingSlot: Date | null = null;
  for (let offset = 0; offset <= 8 && !upcomingSlot; offset++) {
    const candidates = slotsForDay(addDays(now, offset), frequency, time, weekday).filter(s => s.getTime() > now.getTime());
    if (candidates.length > 0) upcomingSlot = candidates[0];
  }

  let lastSuccess = input.lastSuccessAt ?? null;
  if (lastSuccess && lastSuccess.getTime() > now.getTime()) {
    lastSuccess = null; // system clock moved backwards
  }

  const slotMissed = !!latestDueSlot && (!lastSuccess || lastSuccess.getTime() < latestDueSlot.getTime());
  let retryAt: Date | null = null;
  if (slotMissed && input.lastAttemptFailed && input.lastAttemptAt && input.lastAttemptAt.getTime() <= now.getTime()) {
    const retry = input.lastAttemptAt.getTime() + FAILURE_RETRY_MS;
    if (retry > now.getTime()) retryAt = new Date(retry);
  }

  const isDue = slotMissed && !retryAt;
  const nextRunAt = isDue ? now : retryAt ?? upcomingSlot;
  return { enabled: true, latestDueSlot, nextRunAt, isDue };
}

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
export async function recordBackupOutcome(
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
