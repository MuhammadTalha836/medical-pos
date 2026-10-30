// Pure backup-schedule math (no database or file access), shared by the scheduler, the API and unit tests.

// Phase 4: Developer-controlled frequency; Admin controls only the time of day.
// every_2_days / every_3_days (Phase C5) run on fixed calendar days, so the rhythm survives restarts and missed days.
const BACKUP_FREQUENCIES = ['off', 'twice_daily', 'daily', 'every_2_days', 'every_3_days', 'weekly'] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

export const DEFAULT_BACKUP_TIME = '23:00';
export const FAILURE_RETRY_MS = 15 * 60 * 1000;

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

interface ScheduleInput {
  frequency: BackupFrequency;
  time: string; // 'HH:MM' local time
  weekday?: number; // 0 = Sunday ... 6 = Saturday, used by 'weekly'
  lastSuccessAt?: Date | null;
  lastAttemptAt?: Date | null;
  lastAttemptFailed?: boolean;
  now: Date;
}

interface ScheduleResult {
  enabled: boolean;
  latestDueSlot: Date | null; // most recent scheduled slot at or before now
  nextRunAt: Date | null; // when the next backup will run
  isDue: boolean;
  /** Two scheduled backups in a row were missed: the warning the Admin sees (one missed slot is only "due") */
  isOverdue: boolean;
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
  if (frequency === 'every_2_days' || frequency === 'every_3_days') {
    // Day number counted from 1970-01-01 in the local calendar
    const dayNumber = Math.round(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000);
    return dayNumber % (frequency === 'every_2_days' ? 2 : 3) === 0 ? [base] : [];
  }
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
    return { enabled: false, latestDueSlot: null, nextRunAt: null, isDue: false, isOverdue: false };
  }

  // The two newest slots at or before now (16 days back covers two weekly slots)
  const pastSlots: Date[] = [];
  for (let offset = 0; offset <= 16 && pastSlots.length < 2; offset++) {
    const candidates = slotsForDay(addDays(now, -offset), frequency, time, weekday).filter(s => s.getTime() <= now.getTime());
    pastSlots.push(...candidates.reverse());
  }
  const latestDueSlot: Date | null = pastSlots[0] ?? null;
  const previousSlot: Date | null = pastSlots[1] ?? null;

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
  const isOverdue = !!previousSlot && (!lastSuccess || lastSuccess.getTime() < previousSlot.getTime());
  const nextRunAt = isDue ? now : retryAt ?? upcomingSlot;
  return { enabled: true, latestDueSlot, nextRunAt, isDue, isOverdue };
}
