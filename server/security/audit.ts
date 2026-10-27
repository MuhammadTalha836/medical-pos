import { prisma } from '../database/prisma';

interface SecurityAuditOptions {
  action: string;
  module: string;
  details?: string;
  affectedUser?: string | null;
  status?: 'SUCCESS' | 'FAILED' | 'DENIED';
  userId?: number | null;
  userName?: string | null;
}

/**
 * Redacts any passwords, secrets, or sensitive credentials before persisting to audit logs.
 */
function sanitizeAuditDetails(details?: string): string | null {
  if (!details) return null;

  return details
    .replace(/(password|newPassword|currentPassword|oldPassword|totpSecret|secret|tempToken)[=:]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/"(password|newPassword|currentPassword|oldPassword|totpSecret|secret|tempToken)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"');
}

/**
 * Records a structured security audit log entry.
 * Guarantees plaintext passwords and TOTP secrets are strictly excluded.
 */
export async function logSecurityAudit(options: SecurityAuditOptions): Promise<void> {
  try {
    const cleanDetails = sanitizeAuditDetails(options.details);
    await prisma.auditLog.create({
      data: {
        action: options.action,
        module: options.module,
        details: cleanDetails,
        affectedUser: options.affectedUser || null,
        status: options.status || 'SUCCESS',
        userId: options.userId ? Number(options.userId) : null,
        userName: options.userName || null
      }
    });
  } catch (err) {
    console.error('[SecurityAudit] Failed to record audit log:', err);
  }
}

// One PERMISSION_DENIED row per user + permission + path per 10 minutes, so polling screens cannot flood the log
const DENIAL_THROTTLE_MS = 10 * 60 * 1000;
const lastDenials = new Map<string, number>();

/** Records that a signed-in user was refused (403) because their role lacks a permission */
export async function logDenied(
  actor: { id: number; username: string; fullName?: string } | null,
  permissionKey: string,
  request: { method: string; path: string },
  now = Date.now()
): Promise<void> {
  if (!actor) return;
  const key = `${actor.id}|${permissionKey}|${request.method} ${request.path}`;
  const last = lastDenials.get(key);
  if (last !== undefined && now - last < DENIAL_THROTTLE_MS) return;
  lastDenials.set(key, now);
  if (lastDenials.size > 5000) lastDenials.clear();
  const area = request.path.split('/')[2] || 'API';
  await logSecurityAudit({
    action: 'PERMISSION_DENIED',
    module: area.charAt(0).toUpperCase() + area.slice(1),
    details: `${request.method} ${request.path} needs ${permissionKey}`,
    status: 'DENIED',
    userId: actor.id,
    userName: actor.fullName || actor.username
  });
}
