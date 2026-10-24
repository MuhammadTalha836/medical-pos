/** Backup type chosen by the Developer at install: on this computer, in the owner's Google Drive, or both. */

export const BACKUP_MODES = ['offline', 'online', 'both'] as const;
export type BackupMode = (typeof BACKUP_MODES)[number];

export const DEFAULT_BACKUP_MODE: BackupMode = 'offline';

export const BACKUP_MODE_LABELS: Record<BackupMode, string> = {
  offline: 'Offline (this computer)',
  online: 'Online (Google Drive)',
  both: 'Both (this computer + Google Drive)'
};

/** In Online mode only the newest copies stay on this computer; Google Drive keeps the full retention. */
export const ONLINE_LOCAL_KEEP = 2;

export function isBackupMode(value: unknown): value is BackupMode {
  return typeof value === 'string' && (BACKUP_MODES as readonly string[]).includes(value);
}

export function normalizeBackupMode(value: unknown): BackupMode {
  return isBackupMode(value) ? value : DEFAULT_BACKUP_MODE;
}

export function usesCloud(mode: BackupMode): boolean {
  return mode !== 'offline';
}

/** Backups kept on this computer for a mode and the Developer retention limit. */
export function localRetentionFor(mode: BackupMode, retentionLimit: number): number {
  return mode === 'online' ? Math.min(retentionLimit, ONLINE_LOCAL_KEEP) : retentionLimit;
}
