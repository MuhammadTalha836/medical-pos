import { describe, expect, it } from 'vitest';
import { describeBackupSchedule } from './backup';
import { normalizePaperSize, normalizeTemplate } from './invoice';

describe('backup schedule description', () => {
  it('describes each frequency', () => {
    expect(describeBackupSchedule('off', '23:00', 0)).toBe('Automatic backups are off');
    expect(describeBackupSchedule('daily', '23:00', 0)).toBe('Daily at 23:00');
    expect(describeBackupSchedule('weekly', '10:00', 3)).toBe('Weekly on Wednesday at 10:00');
    expect(describeBackupSchedule('twice_daily', '09:30', 0)).toBe('Every 12 hours at 09:30 and 21:30');
    expect(describeBackupSchedule('twice_daily', '18:05', 0)).toBe('Every 12 hours at 18:05 and 06:05');
  });
});

describe('client invoice normalizers', () => {
  it('mirror the server rules', () => {
    expect(normalizeTemplate('standard')).toBe('classic');
    expect(normalizePaperSize('A5')).toBe('80mm');
  });
});
