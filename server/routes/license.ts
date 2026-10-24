import { Router, type Request, type Response } from 'express';
import { logSecurityAudit } from '../security/audit';
import { getLicenseState, readLicenseRecord, saveLicense } from '../security/license';
import { buildDemoLicense, buildFullLicense, extendDemoLicense } from '../security/licenseMath';
import { parseBody, licenseUpdateSchema } from '../validation/schemas';
import { getActingUser, isSetupLocked, sendError } from '../http/context';

// Demo / Full license status and Developer license changes
const router = Router();

router.get('/api/license/status', async (_req: Request, res: Response) => {
  try {
    if (!(await isSetupLocked())) {
      return res.json({ configured: false, mode: null, expiresAt: null, daysLeft: null, expired: false });
    }
    const state = await getLicenseState();
    res.json({ configured: true, mode: state.mode, expiresAt: state.expiresAt, daysLeft: state.daysLeft, expired: state.expired, reason: state.reason });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.put('/api/developer/license', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      await logSecurityAudit({
        action: 'LICENSE_UPDATED',
        module: 'LICENSE',
        status: 'FAILED',
        details: 'Unauthorized attempt to change the license without developer role',
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }
    if (!parseBody(licenseUpdateSchema, req.body, res)) return;
    const body = req.body as { action: 'full' } | { action: 'demo' | 'extend'; demoDays: number };

    const now = Date.now();
    let next;
    if (body.action === 'full') {
      next = buildFullLicense(now);
    } else if (body.action === 'demo') {
      next = buildDemoLicense(body.demoDays, now);
    } else {
      // Extending a missing or tampered record starts a fresh demo
      const current = await readLicenseRecord();
      next = current ? extendDemoLicense(current, body.demoDays, now) : buildDemoLicense(body.demoDays, now);
    }
    await saveLicense(next);

    await logSecurityAudit({
      action: 'LICENSE_UPDATED',
      module: 'LICENSE',
      status: 'SUCCESS',
      details: body.action === 'full'
        ? 'License switched to Full'
        : `License ${body.action === 'demo' ? 'set to a new demo of' : 'demo extended by'} ${body.demoDays} day(s); ends ${next.expiresAt}`,
      userId: actingUser.id,
      userName: actingUser.username
    });

    const state = await getLicenseState();
    res.json({ success: true, mode: state.mode, expiresAt: state.expiresAt, daysLeft: state.daysLeft, expired: state.expired });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
