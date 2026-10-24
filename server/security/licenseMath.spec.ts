import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  buildDemoLicense,
  buildFullLicense,
  computeLicenseState,
  extendDemoLicense,
  signLicense,
  verifyLicenseSignature
} from './licenseMath';

const NOW = Date.parse('2026-10-24T10:00:00.000Z');
const KEY = Buffer.alloc(32, 7);

describe('license rules', () => {
  it('counts demo days down and expires at the end date', () => {
    const demo = buildDemoLicense(14, NOW);
    expect(computeLicenseState(demo, true, NOW)).toMatchObject({ mode: 'demo', daysLeft: 14, expired: false, reason: 'ok' });
    expect(computeLicenseState(demo, true, NOW + 13.5 * DAY_MS).daysLeft).toBe(1);
    expect(computeLicenseState(demo, true, NOW + 14 * DAY_MS)).toMatchObject({ expired: true, daysLeft: 0, reason: 'expired' });
  });

  it('never expires a full license', () => {
    expect(computeLicenseState(buildFullLicense(NOW), true, NOW + 5000 * DAY_MS)).toMatchObject({ mode: 'full', expired: false, daysLeft: null });
  });

  it('treats a missing or tampered record as expired', () => {
    expect(computeLicenseState(null, false, NOW)).toMatchObject({ expired: true, reason: 'missing' });
    expect(computeLicenseState(buildFullLicense(NOW), false, NOW)).toMatchObject({ expired: true, reason: 'tampered' });
  });

  it('ignores a clock moved backwards', () => {
    const demo = { ...buildDemoLicense(10, NOW), lastSeenAt: new Date(NOW + 9 * DAY_MS).toISOString() };
    const rolledBack = computeLicenseState(demo, true, NOW + DAY_MS);
    expect(rolledBack.clockRolledBack).toBe(true);
    expect(rolledBack.daysLeft).toBe(1);
  });

  it('extends from the old end date, or from now once expired', () => {
    const demo = buildDemoLicense(10, NOW);
    expect(Date.parse(extendDemoLicense(demo, 5, NOW + DAY_MS).expiresAt!)).toBe(NOW + 15 * DAY_MS);
    const later = NOW + 30 * DAY_MS;
    expect(Date.parse(extendDemoLicense(demo, 5, later).expiresAt!)).toBe(later + 5 * DAY_MS);
    expect(extendDemoLicense(buildFullLicense(NOW), 7, NOW).mode).toBe('demo');
  });

  it('signature detects any edited field', () => {
    const demo = buildDemoLicense(14, NOW);
    const signature = signLicense(demo, KEY);
    expect(verifyLicenseSignature(demo, signature, KEY)).toBe(true);
    expect(verifyLicenseSignature({ ...demo, mode: 'full' }, signature, KEY)).toBe(false);
    expect(verifyLicenseSignature({ ...demo, expiresAt: new Date(NOW + 999 * DAY_MS).toISOString() }, signature, KEY)).toBe(false);
    expect(verifyLicenseSignature(demo, signature, Buffer.alloc(32, 8))).toBe(false);
    expect(verifyLicenseSignature(demo, 'not-a-signature', KEY)).toBe(false);
  });
});
