import { describe, expect, it } from 'vitest';
import { computeSchedule, FAILURE_RETRY_MS, isValidBackupTime, normalizeFrequency } from './schedule';

/** Local-time date helper: (year, month 1-12, day, hour, minute, second) */
const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);

describe('computeSchedule', () => {
  it('daily: not due before the slot, next run is today', () => {
    const r = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 9, 23, 5), now: at(2026, 10, 10, 22) });
    expect(r.isDue).toBe(false);
    expect(r.nextRunAt).toEqual(at(2026, 10, 10, 23));
  });

  it('daily: due after the slot, quiet after a success', () => {
    expect(computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 9, 23, 5), now: at(2026, 10, 10, 23, 30) }).isDue).toBe(true);
    const done = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 10, 23, 31), now: at(2026, 10, 10, 23, 40) });
    expect(done.isDue).toBe(false);
    expect(done.nextRunAt).toEqual(at(2026, 10, 11, 23));
  });

  it('twice_daily: runs at T and T+12h', () => {
    const r = computeSchedule({ frequency: 'twice_daily', time: '09:30', lastSuccessAt: at(2026, 10, 10, 9, 31), now: at(2026, 10, 10, 15) });
    expect(r.isDue).toBe(false);
    expect(r.nextRunAt).toEqual(at(2026, 10, 10, 21, 30));
    expect(computeSchedule({ frequency: 'twice_daily', time: '09:30', lastSuccessAt: at(2026, 10, 10, 9, 31), now: at(2026, 10, 10, 22) }).isDue).toBe(true);
  });

  it('weekly: only on the configured weekday', () => {
    // 2026-10-07 is a Wednesday
    const r = computeSchedule({ frequency: 'weekly', time: '10:00', weekday: 3, lastSuccessAt: at(2026, 9, 30, 10, 5), now: at(2026, 10, 6, 12) });
    expect(r.isDue).toBe(false);
    expect(r.nextRunAt).toEqual(at(2026, 10, 7, 10));
    expect(computeSchedule({ frequency: 'weekly', time: '10:00', weekday: 3, lastSuccessAt: at(2026, 9, 30, 10, 5), now: at(2026, 10, 7, 11) }).isDue).toBe(true);
  });

  it('power-off for days produces exactly one catch-up backup', () => {
    const missed = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 6, 23, 1), now: at(2026, 10, 10, 8) });
    expect(missed.isDue).toBe(true);
    expect(missed.latestDueSlot).toEqual(at(2026, 10, 9, 23));
    expect(computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 10, 8, 0, 30), now: at(2026, 10, 10, 8, 1) }).isDue).toBe(false);
  });

  it('backs off 15 minutes after a failed attempt', () => {
    const now = at(2026, 10, 10, 23, 20);
    const attempt = new Date(now.getTime() - 5 * 60 * 1000);
    const r = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 9, 23, 1), lastAttemptAt: attempt, lastAttemptFailed: true, now });
    expect(r.isDue).toBe(false);
    expect(r.nextRunAt?.getTime()).toBe(attempt.getTime() + FAILURE_RETRY_MS);
  });

  it('a clock moved backwards does not stop backups', () => {
    expect(computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt: at(2026, 10, 12, 23), now: at(2026, 10, 10, 23, 30) }).isDue).toBe(true);
  });

  it('off is never due', () => {
    expect(computeSchedule({ frequency: 'off', time: '23:00', now: at(2026, 10, 10, 23, 30) })).toEqual({ enabled: false, latestDueSlot: null, nextRunAt: null, isDue: false, isOverdue: false });
  });
});

describe('schedule validation', () => {
  it('accepts only 24-hour HH:MM times', () => {
    expect(isValidBackupTime('00:00')).toBe(true);
    expect(isValidBackupTime('23:59')).toBe(true);
    for (const bad of ['24:00', '7:05', '12:60', 'noon', '', undefined]) expect(isValidBackupTime(bad)).toBe(false);
  });

  it('maps legacy and unknown frequencies', () => {
    expect(normalizeFrequency('on_shift_close')).toBe('daily');
    expect(normalizeFrequency('weekly')).toBe('weekly');
    expect(normalizeFrequency('hourly')).toBe('daily');
  });

  it('every 2 / every 3 days: slots on fixed calendar days', () => {
    for (const [frequency, gap] of [['every_2_days', 2], ['every_3_days', 3]] as const) {
      const first = computeSchedule({ frequency, time: '22:00', lastSuccessAt: at(2026, 10, 10, 12), now: at(2026, 10, 10, 12, 1) }).nextRunAt!;
      const after = new Date(first.getTime() + 60_000);
      const second = computeSchedule({ frequency, time: '22:00', lastSuccessAt: after, now: after }).nextRunAt!;
      expect(first.getHours()).toBe(22);
      expect(Math.round((second.getTime() - first.getTime()) / 86_400_000)).toBe(gap);
    }
  });

  it('overdue only after two missed slots in a row (C5)', () => {
    const lastSuccessAt = at(2026, 10, 9, 23, 5);
    const oneMissed = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt, now: at(2026, 10, 11, 9) });
    expect(oneMissed.isDue).toBe(true);
    expect(oneMissed.isOverdue).toBe(false);
    const twoMissed = computeSchedule({ frequency: 'daily', time: '23:00', lastSuccessAt, now: at(2026, 10, 12, 9) });
    expect(twoMissed.isOverdue).toBe(true);
    const weekly = computeSchedule({ frequency: 'weekly', weekday: 0, time: '10:00', lastSuccessAt: at(2026, 10, 4, 11), now: at(2026, 10, 13, 9) });
    expect(weekly.isDue).toBe(true);
    expect(weekly.isOverdue).toBe(false);
  });
});
