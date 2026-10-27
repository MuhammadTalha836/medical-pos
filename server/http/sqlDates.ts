import { Prisma } from '../generated/prisma/client';

/**
 * The shop's local calendar day (YYYY-MM-DD) of a stored date column, for raw SQL filters. Dates are stored in
 * mixed formats: integer milliseconds (Prisma 6), `YYYY-MM-DD HH:MM:SS` in UTC (raw SQL) and ISO text (Prisma 7).
 * Plain `DATE(col)` returns NULL for the integers and the UTC day for the rest, so early-morning sales fell on the
 * day before. `column` must be a fixed column name from our own code, never user input.
 */
export function localDateSql(column: string): Prisma.Sql {
  if (!/^[a-z_]+(\.[a-z_]+)?$/.test(column)) throw new Error(`Invalid column name: ${column}`);
  const col = Prisma.raw(column);
  return Prisma.sql`(CASE typeof(${col})
    WHEN 'integer' THEN date(${col} / 1000, 'unixepoch', 'localtime')
    WHEN 'real' THEN date(${col} / 1000, 'unixepoch', 'localtime')
    ELSE date(${col}, 'localtime')
  END)`;
}
