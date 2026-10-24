// Session helpers for the integration suites (the API runs in the same process, so tokens can be minted directly)
import { prisma } from '../database/prisma';
import { createSession } from '../security/sessions';
import { saveLicense } from '../security/license';
import { buildFullLicense } from '../security/licenseMath';

export function authHeaders(user: { id: number; role: string } | null | undefined): Record<string, string> {
  if (!user) return {};
  return { Authorization: `Bearer ${createSession(user)}` };
}

let defaultAdminHeaders: Record<string, string> | null = null;

/** Headers for an active admin, used by requests that do not pass their own Authorization. */
export async function adminAuthHeaders(): Promise<Record<string, string>> {
  if (!defaultAdminHeaders) {
    const admin = await prisma.user.findFirst({ where: { role: 'admin', status: 'active' }, orderBy: { id: 'asc' } });
    if (!admin) throw new Error('Test database has no active admin user');
    defaultAdminHeaders = authHeaders(admin);
  }
  return defaultAdminHeaders;
}

/** The suites run on a copy of the real DB; give that copy a full license signed with the test key. */
export async function useFullTestLicense(): Promise<void> {
  await saveLicense(buildFullLicense(Date.now()));
}
