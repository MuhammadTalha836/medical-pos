import crypto from 'crypto';

// Pure license rules (no database), unit-tested in licenseMath.spec.ts. Storage lives in license.ts.

type LicenseMode = 'demo' | 'full';

export interface LicenseRecord {
  mode: LicenseMode;
  demoDays: number;
  startedAt: string;
  expiresAt: string | null;
  // Highest clock reading seen so far; setting the PC clock back cannot add demo days
  lastSeenAt: string;
}

export interface LicenseState {
  mode: LicenseMode;
  expiresAt: string | null;
  daysLeft: number | null;
  expired: boolean;
  clockRolledBack: boolean;
  reason: 'ok' | 'expired' | 'missing' | 'tampered';
}

export const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_ROLLBACK_TOLERANCE_MS = 10 * 60 * 1000;

export function isLicenseMode(value: unknown): value is LicenseMode {
  return value === 'demo' || value === 'full';
}

export function buildFullLicense(now: number): LicenseRecord {
  const iso = new Date(now).toISOString();
  return { mode: 'full', demoDays: 0, startedAt: iso, expiresAt: null, lastSeenAt: iso };
}

export function buildDemoLicense(days: number, now: number): LicenseRecord {
  const iso = new Date(now).toISOString();
  return { mode: 'demo', demoDays: days, startedAt: iso, expiresAt: new Date(now + days * DAY_MS).toISOString(), lastSeenAt: iso };
}

/** Adds days to a demo. An already expired demo is extended from now, not from its old end date. */
export function extendDemoLicense(record: LicenseRecord, days: number, now: number): LicenseRecord {
  const effectiveNow = Math.max(now, Date.parse(record.lastSeenAt) || 0);
  const currentEnd = record.mode === 'demo' && record.expiresAt ? Date.parse(record.expiresAt) || 0 : 0;
  const base = Math.max(currentEnd, effectiveNow);
  return {
    ...record,
    mode: 'demo',
    demoDays: record.demoDays + days,
    expiresAt: new Date(base + days * DAY_MS).toISOString(),
    lastSeenAt: new Date(effectiveNow).toISOString()
  };
}

export function computeLicenseState(record: LicenseRecord | null, signatureValid: boolean, now: number): LicenseState {
  if (!record) {
    return { mode: 'demo', expiresAt: null, daysLeft: 0, expired: true, clockRolledBack: false, reason: 'missing' };
  }
  if (!signatureValid) {
    return { mode: record.mode, expiresAt: record.expiresAt, daysLeft: 0, expired: true, clockRolledBack: false, reason: 'tampered' };
  }

  const lastSeen = Date.parse(record.lastSeenAt) || 0;
  const clockRolledBack = now < lastSeen - CLOCK_ROLLBACK_TOLERANCE_MS;
  const effectiveNow = Math.max(now, lastSeen);

  if (record.mode === 'full') {
    return { mode: 'full', expiresAt: null, daysLeft: null, expired: false, clockRolledBack, reason: 'ok' };
  }

  const end = record.expiresAt ? Date.parse(record.expiresAt) : NaN;
  const remaining = Number.isNaN(end) ? 0 : end - effectiveNow;
  const expired = remaining <= 0;
  return {
    mode: 'demo',
    expiresAt: record.expiresAt,
    daysLeft: expired ? 0 : Math.ceil(remaining / DAY_MS),
    expired,
    clockRolledBack,
    reason: expired ? 'expired' : 'ok'
  };
}

function canonicalPayload(record: LicenseRecord): string {
  return ['v1', record.mode, record.demoDays, record.startedAt, record.expiresAt ?? '', record.lastSeenAt].join('|');
}

export function signLicense(record: LicenseRecord, key: Buffer): string {
  return crypto.createHmac('sha256', key).update(canonicalPayload(record)).digest('hex');
}

export function verifyLicenseSignature(record: LicenseRecord, signature: string | null | undefined, key: Buffer): boolean {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signLicense(record, key), 'hex'));
}
