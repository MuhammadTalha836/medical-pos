import { describe, expect, it } from 'vitest';
import { describeBackupSchedule } from './backup';

describe('backup schedule description', () => {
  it('describes each frequency', () => {
    expect(describeBackupSchedule('off', '23:00', 0)).toBe('Automatic backups are off');
    expect(describeBackupSchedule('daily', '23:00', 0)).toBe('Daily at 23:00');
    expect(describeBackupSchedule('weekly', '10:00', 3)).toBe('Weekly on Wednesday at 10:00');
    expect(describeBackupSchedule('every_2_days', '22:00', 0)).toBe('Every 2 days at 22:00');
    expect(describeBackupSchedule('every_3_days', '22:00', 0)).toBe('Every 3 days at 22:00');
    expect(describeBackupSchedule('twice_daily', '09:30', 0)).toBe('Every 12 hours at 09:30 and 21:30');
    expect(describeBackupSchedule('twice_daily', '18:05', 0)).toBe('Every 12 hours at 18:05 and 06:05');
  });
});
