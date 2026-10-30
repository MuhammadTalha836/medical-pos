import { BackupFrequency } from '../types';

export const BACKUP_FREQUENCY_LABELS: Record<BackupFrequency, string> = {
  off: 'Off',
  twice_daily: 'Every 12 hours',
  daily: 'Daily',
  every_2_days: 'Every 2 days',
  every_3_days: 'Every 3 days',
  weekly: 'Weekly'
};

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function describeBackupSchedule(frequency: BackupFrequency, time: string, weekday: number): string {
  if (frequency === 'off') return 'Automatic backups are off';
  if (frequency === 'weekly') return `Weekly on ${WEEKDAY_LABELS[weekday] ?? 'Sunday'} at ${time}`;
  if (frequency === 'twice_daily') {
    const [h, m] = time.split(':').map(Number);
    const second = `${String((h + 12) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return `Every 12 hours at ${time} and ${second}`;
  }
  if (frequency === 'every_2_days') return `Every 2 days at ${time}`;
  if (frequency === 'every_3_days') return `Every 3 days at ${time}`;
  return `Daily at ${time}`;
}
