import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { hashPassword } from '../security/passwords';
import { logSecurityAudit } from '../security/audit';
import { revokeUserSessions } from '../security/sessions';
import { parseBody, createUserSchema, updateUserSchema } from '../validation/schemas';
import { requirePermission, sendError } from '../http/context';

// Staff accounts; needs the 'can_manage_users' permission (the Developer always has it)
const router = Router();

router.get('/api/users', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_manage_users', 'Access denied: user management permission required'))) return;
    const users = await prisma.user.findMany({
      orderBy: { id: 'asc' }
    });
    const roles = await prisma.role.findMany();
    const roleMap = new Map(roles.map(r => [r.name, r.displayName]));

    // Strictly exclude password and totpSecret
    res.json(users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      full_name: u.fullName,
      role: u.role,
      status: u.status,
      created_at: u.createdAt,
      role_display: roleMap.get(u.role) || u.role
    })));
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/users', async (req: Request, res: Response) => {
  try {
    const actingUser = await requirePermission(req, res, 'can_manage_users', 'Access denied: user management permission required');
    if (!actingUser) return;
    const { username, password, full_name, role } = req.body;
    const targetRole = (role || 'cashier').toLowerCase();

    if (!parseBody(createUserSchema, req.body, res)) return;
    if (!(await prisma.role.findUnique({ where: { name: targetRole } }))) {
      return res.status(400).json({ error: 'The selected role does not exist' });
    }

    if (targetRole === 'developer') {
      await logSecurityAudit({
        action: 'USER_CREATE',
        module: 'USERS',
        status: 'FAILED',
        details: 'Attempt to register developer role via standard user creation',
        affectedUser: username,
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(400).json({ error: 'Developer role cannot be registered via standard user creation' });
    }

    // If acting user is NOT developer, enforce developer-configured policies
    if (actingUser?.role !== 'developer') {
      if (targetRole === 'cashier') {
        const cashierSetting = await prisma.systemSetting.findUnique({
          where: { key: 'allow_admin_create_cashier' }
        });
        if (cashierSetting?.value === 'false') {
          await logSecurityAudit({
            action: 'USER_CREATE',
            module: 'USERS',
            status: 'FAILED',
            details: 'Policy violation: Admin attempted to create cashier while disabled by developer policy',
            affectedUser: username,
            userId: actingUser?.id,
            userName: actingUser?.username
          });
          return res.status(403).json({ error: 'Creation of cashier accounts is disabled by Developer policy' });
        }
      } else if (targetRole === 'admin') {
        const adminSetting = await prisma.systemSetting.findUnique({
          where: { key: 'allow_admin_create_admin' }
        });
        if (adminSetting?.value !== 'true') {
          await logSecurityAudit({
            action: 'USER_CREATE',
            module: 'USERS',
            status: 'FAILED',
            details: 'Policy violation: Admin attempted to create administrator while disabled by developer policy',
            affectedUser: username,
            userId: actingUser?.id,
            userName: actingUser?.username
          });
          return res.status(403).json({ error: 'Creation of administrator accounts is disabled by Developer policy' });
        }
      }
    }

    const duplicate = await prisma.user.findUnique({
      where: { username: username.trim() }
    });
    if (duplicate) {
      return res.status(400).json({ error: 'Username is already in use' });
    }

    const hashedPassword = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        username: username.trim(),
        password: hashedPassword,
        fullName: full_name.trim(),
        role: targetRole,
        status: 'active'
      }
    });

    await logSecurityAudit({
      action: 'USER_CREATE',
      module: 'USERS',
      status: 'SUCCESS',
      details: `Created user ${newUser.username} with role ${newUser.role}`,
      affectedUser: newUser.username,
      userId: actingUser?.id,
      userName: actingUser?.username
    });

    res.json({ success: true, id: newUser.id });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.put('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const actingUser = await requirePermission(req, res, 'can_manage_users', 'Access denied: user management permission required');
    if (!actingUser) return;
    const idNum = Number(req.params.id);
    if (!parseBody(updateUserSchema, req.body, res)) return;
    const { username, full_name, role, status, password } = req.body;

    const existing = await prisma.user.findUnique({ where: { id: idNum } });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only developer can modify a developer account
    if (existing.role === 'developer' && actingUser?.role !== 'developer') {
      await logSecurityAudit({
        action: 'USER_UPDATE',
        module: 'USERS',
        status: 'FAILED',
        details: `Unauthorized attempt by ${actingUser?.username || 'unknown'} to modify Developer account ${existing.username}`,
        affectedUser: existing.username,
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(403).json({ error: 'Only developer can modify developer accounts' });
    }

    if (role && role.toLowerCase() === 'developer' && existing.role !== 'developer') {
      await logSecurityAudit({
        action: 'USER_UPDATE',
        module: 'USERS',
        status: 'FAILED',
        details: `Attempt to escalate role to developer for ${existing.username}`,
        affectedUser: existing.username,
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(400).json({ error: 'Cannot escalate user role to Developer' });
    }

    if (existing.role === 'developer' && role && role.toLowerCase() !== 'developer') {
      return res.status(400).json({ error: 'Developer role cannot be downgraded' });
    }

    const roleChanges = !!role && role !== existing.role;
    if (roleChanges && existing.id === actingUser.id && actingUser.role !== 'developer') {
      return res.status(403).json({ error: 'You cannot change your own role. Ask another administrator or the Developer.' });
    }
    if (roleChanges && !(await prisma.role.findUnique({ where: { name: role } }))) {
      return res.status(400).json({ error: 'The selected role does not exist' });
    }

    // Only the Developer may change an Admin account or grant the Admin role, unless the Developer allows Admins to create Admins
    if (actingUser.role !== 'developer' && (existing.role === 'admin' || role?.toLowerCase() === 'admin') && existing.id !== actingUser.id) {
      const adminSetting = await prisma.systemSetting.findUnique({ where: { key: 'allow_admin_create_admin' } });
      if (adminSetting?.value !== 'true') {
        return res.status(403).json({ error: 'Only the Developer can change administrator accounts' });
      }
    }

    // Never leave the store without an active Admin
    if (existing.role === 'admin' && ((role && role.toLowerCase() !== 'admin') || status === 'inactive')) {
      const activeAdmins = await prisma.user.count({ where: { role: 'admin', status: 'active' } });
      if (activeAdmins <= 1) {
        return res.status(400).json({ error: 'The last active Administrator cannot be disabled or demoted' });
      }
    }

    if (username && username.trim() !== existing.username) {
      const duplicate = await prisma.user.findFirst({
        where: {
          username: username.trim(),
          NOT: { id: idNum }
        }
      });
      if (duplicate) {
        return res.status(400).json({ error: 'Username is already taken' });
      }
    }

    const updateData: { username: string; fullName: string; role: string; status: string; password?: string; failedLoginAttempts?: number; lockedUntil?: null } = {
      username: username ? username.trim() : existing.username,
      fullName: full_name ? full_name.trim() : existing.fullName,
      role: role || existing.role,
      status: status || existing.status,
    };
    if (password && password.trim() !== '') {
      updateData.password = await hashPassword(password.trim());
      // A reset also unlocks an account locked by wrong passwords
      updateData.failedLoginAttempts = 0;
      updateData.lockedUntil = null;
    }

    await prisma.user.update({
      where: { id: idNum },
      data: updateData
    });
    // A new password, role or status takes effect immediately: sign the user out everywhere
    if (updateData.password || updateData.role !== existing.role || updateData.status !== existing.status) {
      revokeUserSessions(idNum, idNum === actingUser.id ? res.locals.sessionToken : null);
    }

    await logSecurityAudit({
      action: (password && password.trim() !== '') ? 'PASSWORD_CHANGE' : 'USER_UPDATE',
      module: 'USERS',
      status: 'SUCCESS',
      details: `Updated user ${existing.username} (role: ${updateData.role})`,
      affectedUser: existing.username,
      userId: actingUser?.id,
      userName: actingUser?.username
    });

    res.json({ success: true, message: 'User updated successfully' });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.delete('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const actingUser = await requirePermission(req, res, 'can_manage_users', 'Access denied: user management permission required');
    if (!actingUser) return;
    const idNum = Number(req.params.id);
    const targetUser = await prisma.user.findUnique({ where: { id: idNum } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser.role === 'developer') {
      await logSecurityAudit({
        action: 'USER_DELETE',
        module: 'USERS',
        status: 'FAILED',
        details: `Attempt to delete developer account ${targetUser.username}`,
        affectedUser: targetUser.username,
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(400).json({ error: 'Developer account cannot be deleted' });
    }

    if (targetUser.role === 'admin') {
      if (actingUser.role !== 'developer') {
        return res.status(403).json({ error: 'Only the Developer can delete administrator accounts' });
      }
      const activeAdmins = await prisma.user.count({ where: { role: 'admin', status: 'active' } });
      if (activeAdmins <= 1 && targetUser.status === 'active') {
        return res.status(400).json({ error: 'Primary Administrator account cannot be deleted' });
      }
    }
    if (targetUser.id === actingUser.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    await prisma.user.delete({ where: { id: idNum } });
    revokeUserSessions(idNum);

    await logSecurityAudit({
      action: 'USER_DELETE',
      module: 'USERS',
      status: 'SUCCESS',
      details: `Deleted user ${targetUser.username} with role ${targetUser.role}`,
      affectedUser: targetUser.username,
      userId: actingUser?.id,
      userName: actingUser?.username
    });

    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
