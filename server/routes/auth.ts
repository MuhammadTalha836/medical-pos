import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { hashPassword, verifyPassword } from '../security/passwords';
import { logSecurityAudit } from '../security/audit';
import { getDeveloperEmail } from '../security/developerKey';
import { verifyDeveloperCode, DEVELOPER_CODE_ERRORS } from '../security/developerAuth';
import { createSession, revokeSession, revokeUserSessions } from '../security/sessions';
import { getLicenseState } from '../security/license';
import { parseBody, developerLoginSchema, loginSchema } from '../validation/schemas';
import { getActingUser, sendError, SESSION_REQUIRED_ERROR, LICENSE_EXPIRED_ERROR } from '../http/context';
import { sessionUserPayload } from '../http/formatters';

// Developer and staff login, logout, profile and password change
const router = Router();

// 2.1a Developer login: fixed developer email + code from the developer's master authenticator
router.post('/api/auth/developer-login', async (req: Request, res: Response) => {
  try {
    if (!parseBody(developerLoginSchema, req.body, res)) return;
    const { email, code } = req.body;

    const cleanEmail = email.trim().toLowerCase();
    const devUser = await prisma.user.findFirst({ where: { role: 'developer' } });

    if (!devUser || cleanEmail !== getDeveloperEmail()) {
      return res.status(401).json({ error: 'Invalid developer credentials' });
    }

    if (devUser.status !== 'active') {
      return res.status(403).json({ error: 'Developer account is deactivated.' });
    }

    // Check rate limit lockout
    if (devUser.lockedUntil && new Date(devUser.lockedUntil) > new Date()) {
      const remainingMs = new Date(devUser.lockedUntil).getTime() - Date.now();
      const remainingMins = Math.max(1, Math.ceil(remainingMs / 60000));
      return res.status(429).json({
        error: `Account is temporarily locked due to repeated failed login attempts. Please wait ${remainingMins} minute(s).`
      });
    }

    const result = await verifyDeveloperCode(String(code));
    if (result === 'not_configured') {
      return res.status(500).json({ error: DEVELOPER_CODE_ERRORS.not_configured });
    }

    if (result !== 'ok') {
      const attempts = (devUser.failedLoginAttempts || 0) + 1;
      let lockedUntil: Date | null = null;
      let errorMsg = result === 'replayed'
        ? DEVELOPER_CODE_ERRORS.replayed
        : `Invalid authenticator code. (${Math.max(0, 5 - attempts)} attempt(s) remaining)`;

      if (attempts >= 5) {
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lock
        errorMsg = 'Too many failed login attempts. Developer access is temporarily locked for 15 minutes.';
      }

      await prisma.user.update({
        where: { id: devUser.id },
        data: { failedLoginAttempts: attempts, lockedUntil }
      });

      await logSecurityAudit({
        action: 'DEV_LOGIN_FAILED',
        module: 'AUTH',
        status: 'FAILED',
        details: `Failed developer login for ${cleanEmail} (${result}). Consecutive attempts: ${attempts}`,
        userId: devUser.id,
        userName: devUser.fullName
      });

      return res.status(attempts >= 5 ? 429 : 401).json({ error: errorMsg });
    }

    // Reset failed attempts on success
    await prisma.user.update({
      where: { id: devUser.id },
      data: { failedLoginAttempts: 0, lockedUntil: null }
    });

    await logSecurityAudit({
      action: 'DEV_LOGIN_SUCCESS',
      module: 'AUTH',
      status: 'SUCCESS',
      details: `Developer ${cleanEmail} logged in with the master authenticator code`,
      userId: devUser.id,
      userName: devUser.fullName
    });

    res.json({
      success: true,
      token: createSession(devUser),
      user: await sessionUserPayload(devUser)
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// 2.1b Staff Login (Admin / Cashier) with bcrypt password verification
router.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    if (!parseBody(loginSchema, req.body, res)) return;
    const { username, password } = req.body;

    const cleanUsername = username.trim();
    const user = await prisma.user.findFirst({
      where: { username: cleanUsername }
    });

    // The Developer signs in only with the master authenticator code, never with a password
    if (!user || user.role === 'developer') {
      await logSecurityAudit({
        action: 'LOGIN',
        module: 'AUTH',
        status: 'FAILED',
        details: `Failed login attempt for username: ${cleanUsername}`,
        affectedUser: cleanUsername
      });
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (user.status !== 'active') {
      await logSecurityAudit({
        action: 'LOGIN',
        module: 'AUTH',
        status: 'FAILED',
        details: `Login attempt on disabled account: ${cleanUsername}`,
        affectedUser: cleanUsername,
        userId: user.id,
        userName: user.username
      });
      return res.status(403).json({ error: 'This user account has been disabled. Please contact Administrator.' });
    }

    // Verify password with bcrypt + legacy auto-rehash
    const { valid, needsRehash } = await verifyPassword(password, user.password);
    if (!valid) {
      await logSecurityAudit({
        action: 'LOGIN',
        module: 'AUTH',
        status: 'FAILED',
        details: `Failed login attempt (invalid password) for user: ${cleanUsername}`,
        affectedUser: cleanUsername,
        userId: user.id,
        userName: user.username
      });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Expired demo: staff cannot sign in until the Developer extends it or switches to Full
    if ((await getLicenseState()).expired) {
      await logSecurityAudit({
        action: 'LOGIN',
        module: 'AUTH',
        status: 'FAILED',
        details: `Login blocked for ${user.username}: demo period has ended`,
        affectedUser: user.username,
        userId: user.id,
        userName: user.username
      });
      return res.status(403).json(LICENSE_EXPIRED_ERROR);
    }

    // Transparently upgrade legacy plaintext password to bcrypt hash
    if (needsRehash) {
      try {
        const hashedPassword = await hashPassword(password);
        await prisma.user.update({
          where: { id: user.id },
          data: { password: hashedPassword }
        });
      } catch (rehashErr) {
        console.error('[Auth] Failed to rehash password:', rehashErr);
      }
    }

    await logSecurityAudit({
      action: 'LOGIN',
      module: 'AUTH',
      status: 'SUCCESS',
      details: `User ${user.username} logged in successfully (role: ${user.role})`,
      affectedUser: user.username,
      userId: user.id,
      userName: user.username
    });

    res.json({
      success: true,
      token: createSession(user),
      user: await sessionUserPayload(user)
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/auth/logout', async (req: Request, res: Response) => {
  const actingUser = await getActingUser(req);
  revokeSession(res.locals.sessionToken);
  if (actingUser) {
    await logSecurityAudit({
      action: 'LOGOUT',
      module: 'AUTH',
      status: 'SUCCESS',
      details: `User ${actingUser.username} logged out`,
      userId: actingUser.id,
      userName: actingUser.username
    });
  }
  res.json({ success: true });
});

router.put('/api/auth/profile', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    const { username, full_name, currentPassword, newPassword } = req.body;
    if (!actingUser || !username || !full_name) {
      return res.status(400).json({ error: 'Missing required user profile fields' });
    }

    // Always the signed-in user; a userId in the body is ignored
    const idNum = actingUser.id;
    const existingUser = await prisma.user.findUnique({ where: { id: idNum } });
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const duplicate = await prisma.user.findFirst({
      where: {
        username: username.trim(),
        NOT: { id: idNum }
      }
    });
    if (duplicate) {
      return res.status(400).json({ error: 'Username is already taken by another account' });
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to change password' });
      }
      const { valid } = await verifyPassword(currentPassword, existingUser.password);
      if (!valid) {
        return res.status(400).json({ error: 'Current password does not match' });
      }
      const hashedNewPassword = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: idNum },
        data: {
          username: username.trim(),
          fullName: full_name.trim(),
          password: hashedNewPassword
        }
      });
      revokeUserSessions(idNum, res.locals.sessionToken);
    } else {
      await prisma.user.update({
        where: { id: idNum },
        data: {
          username: username.trim(),
          fullName: full_name.trim()
        }
      });
    }

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: idNum } });
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: await sessionUserPayload(updatedUser)
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/auth/change-password', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    const { oldPassword, newPassword } = req.body;
    if (!actingUser) {
      return res.status(401).json(SESSION_REQUIRED_ERROR);
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }
    const idNum = actingUser.id;
    const user = await prisma.user.findUnique({
      where: { id: idNum }
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { valid } = await verifyPassword(oldPassword, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Current password does not match' });
    }

    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: idNum },
      data: { password: hashedPassword }
    });
    revokeUserSessions(idNum, res.locals.sessionToken);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
