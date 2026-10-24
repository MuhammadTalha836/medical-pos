// Calendar dates in the computer's own time zone. toISOString() is UTC, which puts sales made after
// midnight (before 05:00 in Pakistan) on the previous day.

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD for the local calendar day */
export function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** YYYYMMDD for invoice, return and shift numbers */
export function localDateKey(date = new Date()): string {
  return localDateString(date).replace(/-/g, '');
}
