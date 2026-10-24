import crypto from 'crypto';

/**
 * Server-side login sessions. The client only holds an opaque random token; who the user is and what
 * role they have is decided here, never from anything the client sends. Sessions live in the API
 * process memory (the Electron main process when packaged), so restarting the app logs everyone out.
 */
export interface SessionRecord {
  userId: number;
  role: string;
  createdAt: number;
  lastSeenAt: number;
}

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const DEVELOPER_SESSION_IDLE_MS = 2 * 60 * 60 * 1000;

// Keyed by SHA-256 of the token, so a memory dump does not reveal usable tokens
const sessions = new Map<string, SessionRecord>();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function idleLimit(role: string): number {
  return role === 'developer' ? DEVELOPER_SESSION_IDLE_MS : SESSION_IDLE_MS;
}

export function createSession(user: { id: number; role: string }, now: number = Date.now()): string {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(hashToken(token), { userId: user.id, role: user.role, createdAt: now, lastSeenAt: now });
  return token;
}

/** Returns the session for a token and refreshes its idle timer, or null if unknown or expired. */
export function resolveSession(token: string | undefined | null, now: number = Date.now()): SessionRecord | null {
  if (!token) return null;
  const key = hashToken(token);
  const session = sessions.get(key);
  if (!session) return null;
  if (now - session.lastSeenAt > idleLimit(session.role)) {
    sessions.delete(key);
    return null;
  }
  session.lastSeenAt = now;
  return session;
}

export function revokeSession(token: string | undefined | null): void {
  if (token) sessions.delete(hashToken(token));
}

/** Logs a user out everywhere, e.g. after a password reset or when the account is disabled. */
export function revokeUserSessions(userId: number, exceptToken?: string | null): void {
  const keep = exceptToken ? hashToken(exceptToken) : null;
  for (const [key, session] of sessions) {
    if (session.userId === userId && key !== keep) sessions.delete(key);
  }
}

/** Reads "Authorization: Bearer <token>". */
export function getBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}
