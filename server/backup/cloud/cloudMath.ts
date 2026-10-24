/** Pure rules for the online backup queue (kept free of DB/network imports for unit tests). */

const FIRST_RETRY_MS = 60 * 1000;
const MAX_RETRY_MS = 60 * 60 * 1000;

/** Wait after the Nth failed upload in a row: 1, 2, 4 ... minutes, capped at one hour. */
export function cloudRetryDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures < 1) return 0;
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (consecutiveFailures - 1));
}

export interface DriveBackupFile {
  id: string;
  name: string;
  createdTime: string;
}

/** Files beyond the newest `keep` (by creation time) that should be deleted from Drive. */
export function driveFilesToPrune<T extends DriveBackupFile>(files: T[], keep: number): T[] {
  const limit = Math.max(1, Math.floor(keep));
  return [...files]
    .sort((a, b) => Date.parse(b.createdTime) - Date.parse(a.createdTime))
    .slice(limit);
}

/** Name of the encrypted copy in Drive for a local backup file. */
export function cloudFileName(localFilename: string): string {
  return `${localFilename.replace(/\.db$/i, '')}.pcbackup`;
}
