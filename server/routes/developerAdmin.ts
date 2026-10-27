import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { logSecurityAudit } from '../security/audit';
import { DEFAULT_ADMIN_PERMISSIONS, normalizePermissions, parsePermissions } from '../../shared/permissions';
import { getActingUser, requirePermission, sendError } from '../http/context';
import { queryAuditLogs } from '../security/auditQuery';

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
    res.json(await queryAuditLogs(req.query));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// The Admin's read-only view of the same log, without the Developer account's own actions
router.get('/api/audit-logs', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_view_audit_log', 'You do not have permission to view the audit log.'))) return;
    const developers = await prisma.user.findMany({ where: { role: 'developer' }, select: { id: true } });
    res.json(await queryAuditLogs(req.query, { excludeUserIds: developers.map(d => d.id) }));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
