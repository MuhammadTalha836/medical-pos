// Pure rules for restoring a backup (no database access), so they can be unit-tested.

/**
 * Compares two app versions part by part ("1.2.10" > "1.2.9"). Returns 1 when `a` is newer, -1 when older, 0 when
 * equal. Text after a dash and non-numeric parts are ignored, so "0.0.0-dev" equals "0.0.0".
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('-')[0].split('.').map(p => Number.parseInt(p, 10)).map(n => (Number.isFinite(n) ? n : 0));
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Why a backup from `backupVersion` cannot go into this app, or null when it can (no stamp = an older backup) */
export function restoreVersionError(backupVersion: string | null | undefined, appVersion: string): string | null {
  if (!backupVersion) return null;
  return compareVersions(backupVersion, appVersion) > 0
    ? `This backup was made by a newer version of PharmaCare Pro (${backupVersion}). This computer has ${appVersion}. Update PharmaCare Pro first, then restore it.`
    : null;
}
