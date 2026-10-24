import express, { type NextFunction, type Request, type Response } from 'express';
import { prisma } from './database/prisma';
import { getBearerToken, resolveSession, revokeSession } from './security/sessions';
import { getLicenseState } from './security/license';
import { LICENSE_EXPIRED_ERROR, SESSION_REQUIRED_ERROR, sendError, type Actor } from './http/context';
import dashboardRoutes from './routes/dashboard';
import setupRoutes from './routes/setup';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import developerRoutes from './routes/developer';
import licenseRoutes from './routes/license';
import developerAdminRoutes from './routes/developerAdmin';
import roleRoutes from './routes/roles';
import companyRoutes from './routes/companies';
import customerRoutes from './routes/customers';
import productRoutes from './routes/products';
import saleRoutes from './routes/sales';
import purchaseRoutes from './routes/purchases';
import reportRoutes from './routes/reports';
import utilityRoutes from './routes/utilities';
import shiftRoutes from './routes/shifts';
import settingsRoutes from './routes/settings';
import supplierRoutes from './routes/suppliers';

// SQLite aggregations return BigInt; serialize them as plain numbers
declare global {
  interface BigInt {
    toJSON(): number;
  }
}
BigInt.prototype.toJSON = function (): number {
  return Number(this);
};

// Routes reachable without a login session. Everything else under /api needs "Authorization: Bearer <token>".
const PUBLIC_API_ROUTES = new Set([
  'GET /api/status',
  'GET /api/setup/status',
  'POST /api/setup/unlock',
  'POST /api/setup/complete',
  'POST /api/setup/cloud/connect',
  'POST /api/setup/cloud/status',
  'POST /api/auth/login',
  'POST /api/auth/developer-login',
  'GET /api/license/status',
  'GET /api/settings'
]);

// Resolves the bearer token into res.locals.actor, then enforces login and the license on every /api route
async function sessionGate(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req.headers.authorization);
    const session = resolveSession(token);
    let actor: Actor | null = null;
    if (session) {
      const user = await prisma.user.findUnique({ where: { id: session.userId } });
      if (user && user.status === 'active' && user.role === session.role) {
        actor = { id: user.id, username: user.username, role: user.role, fullName: user.fullName };
      } else {
        revokeSession(token);
      }
    }
    res.locals.actor = actor;
    res.locals.sessionToken = actor ? token : null;

    const routeKey = `${req.method} ${req.originalUrl.split('?')[0].replace(/\/+$/, '')}`;
    if (PUBLIC_API_ROUTES.has(routeKey)) return next();
    if (!actor) return res.status(401).json(SESSION_REQUIRED_ERROR);

    // Expired demo: only the Developer can still work (to extend it or switch to Full)
    if (actor.role !== 'developer' && (await getLicenseState()).expired) {
      revokeSession(token);
      return res.status(403).json(LICENSE_EXPIRED_ERROR);
    }
    next();
  } catch (error: unknown) {
    sendError(res, error);
  }
}

export const app = express();

// The UI is always served from the same origin (Vite proxy in development, the API itself when packaged),
// so no CORS headers are sent and other websites cannot call the API from a browser.
app.use(express.json());
app.use('/api', sessionGate);

for (const routes of [
  dashboardRoutes, setupRoutes, authRoutes, userRoutes, developerRoutes, licenseRoutes, developerAdminRoutes, roleRoutes,
  companyRoutes, customerRoutes, productRoutes, saleRoutes, purchaseRoutes, reportRoutes, utilityRoutes, shiftRoutes, settingsRoutes,
  supplierRoutes
]) {
  app.use(routes);
}

app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Malformed JSON bodies and anything a route did not catch
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const { status, type } = error as { status?: number; type?: string };
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid request data.' });
    return;
  }
  sendError(res, error, status && status >= 400 && status < 500 ? status : 500);
});
