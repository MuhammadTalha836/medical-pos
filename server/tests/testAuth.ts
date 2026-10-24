// Session helpers for the integration suites (the API runs in the same process, so tokens can be minted directly)
import crypto from 'crypto';
import { prisma } from '../database/prisma';
import { createSession } from '../security/sessions';
import { hashPassword } from '../security/passwords';
import { saveLicense } from '../security/license';
import { buildFullLicense } from '../security/licenseMath';

export function authHeaders(user: { id: number; role: string } | null | undefined): Record<string, string> {
  if (!user) return {};
  return { Authorization: `Bearer ${createSession(user)}` };
}

// Fixture admin on the fresh test database (fresh installs have no staff accounts)
export const TEST_ADMIN = { username: 'admin', password: 'admin123' };

/** Returns the first active admin, creating the fixture admin when the database has none. */
export async function ensureTestAdmin() {
  const existing = await prisma.user.findFirst({ where: { role: 'admin', status: 'active' }, orderBy: { id: 'asc' } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      username: TEST_ADMIN.username,
      password: await hashPassword(TEST_ADMIN.password),
      fullName: 'Test Administrator',
      role: 'admin',
      status: 'active'
    }
  });
}

/** Returns the developer account, creating it (as the setup wizard would) when the database has none. */
export async function ensureTestDeveloper() {
  const existing = await prisma.user.findFirst({ where: { role: 'developer' } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      username: 'developer',
      // Developers sign in with the authenticator code only; this hash is never used
      password: await hashPassword(crypto.randomUUID()),
      fullName: 'System Developer',
      role: 'developer',
      status: 'active',
      email: process.env.PHARMACARE_DEVELOPER_EMAIL
    }
  });
}

let defaultAdminHeaders: Record<string, string> | null = null;

/** Headers for an active admin, used by requests that do not pass their own Authorization. */
export async function adminAuthHeaders(): Promise<Record<string, string>> {
  if (!defaultAdminHeaders) {
    defaultAdminHeaders = authHeaders(await ensureTestAdmin());
  }
  return defaultAdminHeaders;
}

/** Turns the fresh test database into an installed store: setup completed, with a full license signed with the test key. */
export async function useFullTestLicense(): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key: 'setup_completed' }, update: { value: 'true' }, create: { key: 'setup_completed', value: 'true' } });
  await saveLicense(buildFullLicense(Date.now()));
}
