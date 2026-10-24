import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { logSecurityAudit } from '../security/audit';
import { normalizePermissions, parsePermissions, PERMISSION_KEYS, type RolePermissions } from '../../shared/permissions';
import { requirePermission, sendError, type Actor } from '../http/context';

// Roles and permission matrices; needs 'can_manage_roles'. The built-in admin and developer roles are changed only by the Developer
const router = Router();

const DEVELOPER_MANAGED_ROLES = ['admin', 'developer'];

function readPermissions(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      return readPermissions(JSON.parse(input));
    } catch {
      throw new Error('Permissions must be a list of true/false values');
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Permissions must be a list of true/false values');
  return input as Record<string, unknown>;
}

/**
 * Nobody but the Developer can hand out a permission they do not hold themselves. Keys the role already had stay
 * as they are, so an Admin can still edit a role the Developer gave more rights to.
 */
async function assertGrantable(actor: Actor, next: RolePermissions, current: Partial<Record<string, boolean>>) {
  if (actor.role === 'developer') return;
  const own = parsePermissions((await prisma.role.findUnique({ where: { name: actor.role } }))?.permissions);
  const blocked = PERMISSION_KEYS.filter(key => next[key] && !current[key] && own[key] !== true);
  if (blocked.length > 0) {
    await logSecurityAudit({
      action: 'ROLE_UPDATE',
      module: 'USERS',
      status: 'FAILED',
      details: `${actor.username} tried to grant permissions they do not have: ${blocked.join(', ')}`,
      userId: actor.id,
      userName: actor.username
    });
    throw new Error('You cannot give a role permissions that your own account does not have.');
  }
}

router.get('/api/roles', async (_req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { id: 'asc' }
    });

    const userCounts = await prisma.user.groupBy({
      by: ['role'],
      _count: { id: true }
    });
    const countMap = new Map(userCounts.map(uc => [uc.role, uc._count.id]));

    const parsedRoles = roles.map(r => ({
      id: r.id,
      name: r.name,
      display_name: r.displayName,
      description: r.description,
      is_system: r.isSystem,
      created_at: r.createdAt,
      user_count: countMap.get(r.name) || 0,
      permissions: parsePermissions(r.permissions)
    }));

    res.json(parsedRoles);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/roles', async (req: Request, res: Response) => {
  try {
    const actingUser = await requirePermission(req, res, 'can_manage_roles', 'Access denied: role management permission required');
    if (!actingUser) return;
    const { name, display_name, description, permissions } = req.body;
    if (!name || !display_name || !permissions || typeof name !== 'string' || typeof display_name !== 'string') {
      return res.status(400).json({ error: 'Role identifier, display name, and permissions are required' });
    }

    const roleKey = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').trim();
    if (DEVELOPER_MANAGED_ROLES.includes(roleKey)) {
      return res.status(400).json({ error: `A role with identifier "${roleKey}" already exists` });
    }
    const existing = await prisma.role.findUnique({ where: { name: roleKey } });
    if (existing) {
      return res.status(400).json({ error: `A role with identifier "${roleKey}" already exists` });
    }

    const normalized = normalizePermissions(readPermissions(permissions), {});
    await assertGrantable(actingUser, normalized, {});
    const permsJson = JSON.stringify(normalized);
    const newRole = await prisma.role.create({
      data: {
        name: roleKey,
        displayName: display_name.trim(),
        description: description || null,
        isSystem: 0,
        permissions: permsJson
      }
    });

    res.json({ success: true, id: newRole.id });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.put('/api/roles/:id', async (req: Request, res: Response) => {
  try {
    const actingUser = await requirePermission(req, res, 'can_manage_roles', 'Access denied: role management permission required');
    if (!actingUser) return;
    const idNum = Number(req.params.id);
    const { display_name, description, permissions } = req.body;

    const role = await prisma.role.findUnique({ where: { id: idNum } });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (DEVELOPER_MANAGED_ROLES.includes(role.name) && actingUser.role !== 'developer') {
      await logSecurityAudit({
        action: 'ROLE_UPDATE',
        module: 'USERS',
        status: 'FAILED',
        details: `Attempt by ${actingUser.username} to change the ${role.name} role permissions`,
        userId: actingUser.id,
        userName: actingUser.username
      });
      return res.status(403).json({ error: 'Administrator permissions are managed by the Developer' });
    }

    // Unknown keys are dropped; a missing permissions object keeps the current matrix
    let permsJson = role.permissions;
    if (permissions !== undefined) {
      const normalized = normalizePermissions(readPermissions(permissions), {});
      await assertGrantable(actingUser, normalized, parsePermissions(role.permissions));
      permsJson = JSON.stringify(normalized);
    }

    await prisma.role.update({
      where: { id: idNum },
      data: {
        displayName: display_name || role.displayName,
        description: description !== undefined ? description : role.description,
        permissions: permsJson
      }
    });

    res.json({ success: true, message: 'Role permissions updated successfully' });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.delete('/api/roles/:id', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_manage_roles', 'Access denied: role management permission required'))) return;
    const idNum = Number(req.params.id);
    const role = await prisma.role.findUnique({ where: { id: idNum } });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (role.isSystem === 1 || role.name === 'admin') {
      return res.status(400).json({ error: 'System-protected roles cannot be deleted' });
    }

    const assignedUsers = await prisma.user.count({ where: { role: role.name } });
    if (assignedUsers > 0) {
      return res.status(400).json({ error: `Cannot delete role "${role.displayName}". ${assignedUsers} user(s) are currently assigned to it.` });
    }

    await prisma.role.delete({ where: { id: idNum } });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
