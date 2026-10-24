import type { Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { parsePermissions } from '../../shared/permissions';

export const SESSION_REQUIRED_ERROR = { error: 'Your session has ended. Please log in again.', code: 'SESSION_REQUIRED' };
export const LICENSE_EXPIRED_ERROR = {
  error: 'The demo period for this pharmacy has ended. Please contact the developer to continue using PharmaCare Pro.',
  code: 'LICENSE_EXPIRED'
};

export type Actor = { id: number; username: string; role: string; fullName: string };

// The logged-in user, resolved by the session middleware from the bearer token (never from client headers)
export async function getActingUser(req: Request): Promise<Actor | null> {
  return (req.res?.locals.actor as Actor | undefined) ?? null;
}

// Session user as the id/name fields older handlers used to read from the request body
export async function sessionIdentity(req: Request) {
  const actor = await getActingUser(req);
  const id = actor ? actor.id : null;
  const name = actor ? actor.fullName || actor.username : null;
  return { user_id: id, user_name: name, admin_id: id, admin_name: name };
}

// Developer always passes; Admin and custom roles are checked against their role's JSON permissions
export async function hasRolePermission(roleName: string, permissionKey: string): Promise<boolean> {
  if (roleName === 'developer') return true;
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  return !!role && parsePermissions(role.permissions)[permissionKey] === true;
}

/** Returns the acting user when their role has the permission; otherwise sends 403 and returns null. */
export async function requirePermission(req: Request, res: Response, permissionKey: string, deniedMessage: string): Promise<Actor | null> {
  const actingUser = await getActingUser(req);
  if (!actingUser || !(await hasRolePermission(actingUser.role, permissionKey))) {
    res.status(403).json({ error: deniedMessage });
    return null;
  }
  return actingUser;
}

// The setup wizard is locked once it completed and the developer account exists
export async function isSetupLocked(): Promise<boolean> {
  const setupSetting = await prisma.systemSetting.findUnique({ where: { key: 'setup_completed' } });
  const devUser = await prisma.user.findFirst({ where: { role: 'developer' } });
  return setupSetting?.value === 'true' && !!devUser;
}

const GENERIC_ERROR = 'Something went wrong. Please try again.';

function isDatabaseError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return true;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return error instanceof Error && (error.name === 'SqliteError' || (typeof code === 'string' && code.startsWith('SQLITE_')));
}

/**
 * The message a user may see for an error. Messages thrown by our own handlers pass through; database and
 * driver errors are replaced by plain text (and logged), so internal details never reach the screen.
 */
function publicErrorMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return 'A record with the same value already exists.';
    if (error.code === 'P2003') return 'This record is linked to other data and cannot be changed or removed.';
    if (error.code === 'P2025') return 'Record not found.';
    console.error('[API] Database error:', error);
    return GENERIC_ERROR;
  }
  if (isDatabaseError(error)) {
    console.error('[API] Database error:', error);
    return GENERIC_ERROR;
  }
  if (error instanceof Error && error.message) return error.message;
  console.error('[API] Unexpected error:', error);
  return GENERIC_ERROR;
}

export function sendError(res: Response, error: unknown, status = 500): void {
  res.status(status).json({ error: publicErrorMessage(error) });
}
