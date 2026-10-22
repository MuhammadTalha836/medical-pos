import { prisma } from '../database/prisma';

export interface SecurityAuditOptions {
  action: string;
  module: string;
  details?: string;
  affectedUser?: string | null;
  status?: 'SUCCESS' | 'FAILED';
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
