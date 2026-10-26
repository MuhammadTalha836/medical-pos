import { prisma } from '../database/prisma';
import { logSecurityAudit } from '../security/audit';
import { localDateString } from '../../shared/dates';
import { closeDay, closeSummary, DayCloseError } from './closeDay';
import { loadPeriod } from './loadDayClose';

// Automatic day close: after midnight, every finished day with activity is closed on its own.
// The computer may be off at midnight, so it catches up on the last LOOKBACK_DAYS days.

const LOOKBACK_DAYS = 31;

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/** Closes every finished day (before `now`'s local day) that had activity and is not closed. Returns the closed dates. */
export async function runAutoDayClose(now: Date = new Date()): Promise<string[]> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'auto_day_close' } });
  if (setting?.value === 'false') return [];

  const from = localDateString(addDays(now, -LOOKBACK_DAYS));
  const to = localDateString(addDays(now, -1));
  const [{ days }, closed] = await Promise.all([
    loadPeriod(from, to),
    prisma.dailyClosing.findMany({ where: { closingDate: { gte: from, lte: to }, isClosed: 1 }, select: { closingDate: true } })
  ]);
  const alreadyClosed = new Set(closed.map(c => c.closingDate));

  const done: string[] = [];
  // Oldest first, so the history fills in date order
  for (const { date } of [...days].reverse()) {
    if (alreadyClosed.has(date)) continue;
    try {
      const { figures, openShifts } = await closeDay(date, null, null);
      done.push(date);
      await logSecurityAudit({
        action: 'DAY_AUTO_CLOSED',
        module: 'Day Close',
        details: `${closeSummary(date, figures, openShifts.length)} (automatic)`,
        userName: 'system'
      });
    } catch (error) {
      // Someone closed it at the same moment: nothing to do
      if (!(error instanceof DayCloseError)) throw error;
    }
  }
  return done;
}

let lastRunFor: string | null = null;

/** Called from the scheduler tick: runs once per local day (and once after start-up) */
export async function autoDayCloseTick(now: Date = new Date()): Promise<void> {
  const today = localDateString(now);
  if (lastRunFor === today) return;
  const done = await runAutoDayClose(now);
  lastRunFor = today;
  if (done.length) console.log(`[DayClose] Closed automatically: ${done.join(', ')}`);
}
