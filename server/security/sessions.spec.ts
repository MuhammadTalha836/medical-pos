import { describe, expect, it } from 'vitest';
import { DEVELOPER_SESSION_IDLE_MS, SESSION_IDLE_MS, createSession, getBearerToken, resolveSession, revokeSession, revokeUserSessions } from './sessions';

describe('server sessions', () => {
  it('resolves a token to its user until revoked', () => {
    const token = createSession({ id: 41, role: 'cashier' });
    expect(resolveSession(token)?.userId).toBe(41);
    revokeSession(token);
    expect(resolveSession(token)).toBeNull();
    expect(resolveSession('made-up-token')).toBeNull();
  });

  it('expires idle sessions, sooner for the developer', () => {
    const now = 1_800_000_000_000;
    const staff = createSession({ id: 42, role: 'admin' }, now);
    const developer = createSession({ id: 43, role: 'developer' }, now);
    expect(resolveSession(developer, now + DEVELOPER_SESSION_IDLE_MS + 1)).toBeNull();
    expect(resolveSession(staff, now + DEVELOPER_SESSION_IDLE_MS + 1)?.userId).toBe(42);
    expect(resolveSession(staff, now + DEVELOPER_SESSION_IDLE_MS + 2 + SESSION_IDLE_MS)).toBeNull();
  });

  it('revokes every session of a user except the one kept', () => {
    const a = createSession({ id: 44, role: 'cashier' });
    const b = createSession({ id: 44, role: 'cashier' });
    revokeUserSessions(44, b);
    expect(resolveSession(a)).toBeNull();
    expect(resolveSession(b)?.userId).toBe(44);
  });

  it('reads only Bearer authorization headers', () => {
    expect(getBearerToken('Bearer abc.def')).toBe('abc.def');
    expect(getBearerToken('Basic abc')).toBeNull();
    expect(getBearerToken(undefined)).toBeNull();
  });
});
