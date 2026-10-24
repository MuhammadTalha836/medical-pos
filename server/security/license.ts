import crypto from 'crypto';
import { prisma } from '../database/prisma';
import { base32Decode } from './totp';
import { DeveloperKeyMissingError, getDeveloperSecret } from './developerKey';
import { logSecurityAudit } from './audit';
import {
  computeLicenseState,
  isLicenseMode,
  signLicense,
  verifyLicenseSignature,
  type LicenseRecord,
  type LicenseState
} from './licenseMath';

// Demo / Full license stored in system_settings and signed with a key derived from the developer master key,
// so editing the database file cannot turn a demo into a full license or push its end date.
const KEYS = {
  mode: 'license_mode',
  demoDays: 'license_demo_days',
  startedAt: 'license_started_at',
  expiresAt: 'license_expires_at',
  lastSeenAt: 'license_last_seen_at',
  signature: 'license_signature'
} as const;

export const LICENSE_SETTING_KEYS: string[] = Object.values(KEYS);

// Only refresh the stored "last seen" clock once a minute
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000;

function licenseKey(): Buffer {
  const master = base32Decode(getDeveloperSecret());
  return Buffer.from(crypto.hkdfSync('sha256', master, 'pharmacare-license', 'license-signature-v1', 32));
}

async function readStored(): Promise<{ record: LicenseRecord | null; signature: string | null }> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: LICENSE_SETTING_KEYS } } });
  const values: Record<string, string> = {};
  for (const row of rows) values[row.key] = row.value;

  const mode = values[KEYS.mode];
  if (!isLicenseMode(mode) || !values[KEYS.startedAt] || !values[KEYS.lastSeenAt]) {
    return { record: null, signature: null };
  }
  return {
    record: {
      mode,
      demoDays: Number(values[KEYS.demoDays] || 0),
      startedAt: values[KEYS.startedAt],
      expiresAt: values[KEYS.expiresAt] || null,
      lastSeenAt: values[KEYS.lastSeenAt]
    },
    signature: values[KEYS.signature] || null
  };
}

/** Signs and stores a license record. Returns the upserts so callers can run them inside their own transaction. */
export function licenseWrites(record: LicenseRecord) {
  const signature = signLicense(record, licenseKey());
  const values: Record<string, string> = {
    [KEYS.mode]: record.mode,
    [KEYS.demoDays]: String(record.demoDays),
    [KEYS.startedAt]: record.startedAt,
    [KEYS.expiresAt]: record.expiresAt ?? '',
    [KEYS.lastSeenAt]: record.lastSeenAt,
    [KEYS.signature]: signature
  };
  return Object.entries(values).map(([key, value]) =>
    prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  );
}

export async function saveLicense(record: LicenseRecord): Promise<void> {
  await prisma.$transaction(licenseWrites(record));
}

export async function readLicenseRecord(): Promise<LicenseRecord | null> {
  const { record, signature } = await readStored();
  if (!record) return null;
  try {
    return verifyLicenseSignature(record, signature, licenseKey()) ? record : null;
  } catch {
    return null;
  }
}

let rollbackLogged = false;

/**
 * Current license state. A missing developer key, a missing record or a bad signature all count as
 * expired, so the store locks rather than running unlicensed. Also advances the stored "last seen"
 * clock, which is what makes turning the PC clock back useless.
 */
export async function getLicenseState(now: number = Date.now()): Promise<LicenseState> {
  const { record, signature } = await readStored();
  let key: Buffer;
  try {
    key = licenseKey();
  } catch (error) {
    if (error instanceof DeveloperKeyMissingError) {
      return { mode: record?.mode ?? 'demo', expiresAt: null, daysLeft: 0, expired: true, clockRolledBack: false, reason: 'missing' };
    }
    throw error;
  }

  const valid = !!record && verifyLicenseSignature(record, signature, key);
  const state = computeLicenseState(record, valid, now);

  if (state.clockRolledBack && !rollbackLogged) {
    rollbackLogged = true;
    await logSecurityAudit({
      action: 'LICENSE_CLOCK_ROLLBACK',
      module: 'LICENSE',
      status: 'FAILED',
      details: `System clock is behind the last recorded time (${record?.lastSeenAt}). Demo days are counted from the last recorded time.`
    });
  }

  if (record && valid && !state.expired) {
    const lastSeen = Date.parse(record.lastSeenAt) || 0;
    if (now - lastSeen >= LAST_SEEN_WRITE_INTERVAL_MS) {
      await prisma.$transaction(licenseWrites({ ...record, lastSeenAt: new Date(now).toISOString() }));
    }
  }

  return state;
}
