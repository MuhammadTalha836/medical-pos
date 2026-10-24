import { Router, type Request, type Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { logSecurityAudit } from '../security/audit';
import { DEFAULT_ADMIN_PERMISSIONS, normalizePermissions, parsePermissions } from '../../shared/permissions';
import { getActingUser, sendError } from '../http/context';

// Developer-only Admin permissions and audit log
const router = Router();

// Admin role permissions, set by the Developer (Admins cannot change their own matrix)
router.get('/api/developer/admin-permissions', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }
    const role = await prisma.role.findUnique({ where: { name: 'admin' } });
    res.json(normalizePermissions(parsePermissions(role?.permissions), DEFAULT_ADMIN_PERMISSIONS));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.put('/api/developer/admin-permissions', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.values(body).some(v => typeof v !== 'boolean')) {
      return res.status(400).json({ error: 'Admin permissions must be true/false values' });
    }
    const role = await prisma.role.findUnique({ where: { name: 'admin' } });
    const permissions = normalizePermissions({ ...parsePermissions(role?.permissions), ...body }, DEFAULT_ADMIN_PERMISSIONS);

    await prisma.role.update({ where: { name: 'admin' }, data: { permissions: JSON.stringify(permissions) } });
    await logSecurityAudit({
      action: 'ADMIN_PERMISSIONS_UPDATE',
      module: 'DEVELOPER_SETTINGS',
      status: 'SUCCESS',
      details: `Admin permissions updated. Disabled: ${Object.entries(permissions).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'none'}`,
      userId: actingUser.id,
      userName: actingUser.username
    });
    res.json({ success: true, permissions });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.get('/api/developer/audit-logs', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10)));
    const skip = (page - 1) * limit;

    const whereClause: Prisma.AuditLogWhereInput = {};
    if (req.query.module) {
      whereClause.module = String(req.query.module);
    }
    if (req.query.action) {
      whereClause.action = String(req.query.action);
    }
    if (req.query.status) {
      whereClause.status = String(req.query.status);
    }
    if (req.query.user) {
      const u = String(req.query.user);
      whereClause.OR = [
        { userName: { contains: u } },
        { affectedUser: { contains: u } }
      ];
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where: whereClause }),
      prisma.auditLog.findMany({
        where: whereClause,
        orderBy: { id: 'desc' },
        skip,
        take: limit
      })
    ]);

    res.json({
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
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
