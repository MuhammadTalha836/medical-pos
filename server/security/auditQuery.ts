import type { Request } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';

/**
 * One page of the security audit log, filtered by ?module=&action=&status=&user=&page=&limit=. Shared by the
 * Developer's audit trail and the Admin's read-only view, which leaves out the Developer account's own rows.
 */
export async function queryAuditLogs(query: Request['query'], options: { excludeUserIds?: number[] } = {}) {
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.max(1, Math.min(200, parseInt(String(query.limit || '50'), 10) || 50));
  const skip = (page - 1) * limit;

  const where: Prisma.AuditLogWhereInput = {};
  if (query.module) where.module = String(query.module);
  if (query.action) where.action = String(query.action);
  if (query.status) where.status = String(query.status);
  if (query.user) {
    const u = String(query.user);
    where.OR = [{ userName: { contains: u } }, { affectedUser: { contains: u } }];
  }
  if (options.excludeUserIds?.length) {
    // Rows without a user (system jobs) stay visible
    where.AND = [{ OR: [{ userId: null }, { userId: { notIn: options.excludeUserIds } }] }];
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip, take: limit })
  ]);

  return {
    logs: logs.map(l => ({
      id: l.id,
      action: l.action,
      module: l.module,
      details: l.details,
      affected_user: l.affectedUser,
      status: l.status,
      user_id: l.userId,
      user_name: l.userName,
      created_at: l.createdAt.toISOString()
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
}
