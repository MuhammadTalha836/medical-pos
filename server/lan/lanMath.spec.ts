import { describe, expect, it } from 'vitest';
import {
  checkPairingCode, isLocalOnly, isLoopback, isOnline, isOpenLanRoute, newPairingCode, PAIRING_LOCK_MS, recordPairingFailure,
  sameFingerprint, shortFingerprint, terminalNameError, versionsMatch
} from './lanMath';

describe('who is calling', () => {
  it('knows this computer from others', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.20')).toBe(false);
    expect(isLoopback('::ffff:192.168.1.20')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  it('keeps Developer, setup, restore and LAN set-up on the main computer', () => {
    expect(isLocalOnly('/api/auth/developer-login')).toBe(true);
    expect(isLocalOnly('/api/developer/settings')).toBe(true);
    expect(isLocalOnly('/api/setup/complete')).toBe(true);
    expect(isLocalOnly('/api/utilities/restore')).toBe(true);
    expect(isLocalOnly('/api/lan/pairing-code/')).toBe(true);
    expect(isLocalOnly('/api/auth/login')).toBe(false);
    expect(isLocalOnly('/api/sales')).toBe(false);
    expect(isLocalOnly('/api/developers')).toBe(false);
  });

  it('lets an unpaired PC only see the server and pair', () => {
    expect(isOpenLanRoute('GET', '/api/lan/health')).toBe(true);
    expect(isOpenLanRoute('POST', '/api/lan/pair')).toBe(true);
    expect(isOpenLanRoute('GET', '/api/settings')).toBe(false);
    expect(isOpenLanRoute('POST', '/api/lan/health')).toBe(false);
  });
});

describe('pairing codes', () => {
  const now = 1_000_000;
  const active = { code: '042917', expiresAt: now + 60_000, used: false };
  const fresh = { failures: 0, lockedUntil: 0 };

  it('are six digits', () => {
    expect(newPairingCode(() => 0.0429171)).toBe('042917');
    expect(newPairingCode(() => 0.999999)).toMatch(/^\d{6}$/);
  });

  it('work once, before they expire', () => {
    expect(checkPairingCode(active, ' 042917 ', fresh, now)).toBe('ok');
    expect(checkPairingCode(active, '111111', fresh, now)).toBe('wrong');
    expect(checkPairingCode({ ...active, used: true }, '042917', fresh, now)).toBe('used');
    expect(checkPairingCode(active, '042917', fresh, now + 61_000)).toBe('expired');
    expect(checkPairingCode(null, '042917', fresh, now)).toBe('wrong');
  });

  it('lock an address after five wrong tries', () => {
    let attempts = fresh;
    for (let i = 0; i < 4; i++) attempts = recordPairingFailure(attempts, now);
    expect(attempts).toEqual({ failures: 4, lockedUntil: 0 });
    attempts = recordPairingFailure(attempts, now);
    expect(attempts.lockedUntil).toBe(now + PAIRING_LOCK_MS);
    expect(checkPairingCode(active, '042917', attempts, now + 1000)).toBe('locked');
    expect(recordPairingFailure(attempts, now + PAIRING_LOCK_MS + 1)).toEqual({ failures: 1, lockedUntil: 0 });
  });
});

describe('versions, fingerprints and names', () => {
  it('needs the same version', () => {
    expect(versionsMatch('1.2.0', '1.2.0')).toBe(true);
    expect(versionsMatch('1.1.9', '1.2.0')).toBe(false);
    expect(versionsMatch(undefined, '1.2.0')).toBe(true);
  });

  it('compares fingerprints whatever the format', () => {
    expect(shortFingerprint('ab:cd:ef:01:23:45')).toBe('AB:CD:EF:01');
    expect(sameFingerprint('AB:CD:EF', 'abcdef')).toBe(true);
    expect(sameFingerprint('AB:CD:EF', 'abcdee')).toBe(false);
    expect(sameFingerprint('', '')).toBe(false);
  });

  it('checks counter names and online state', () => {
    expect(terminalNameError('Counter 1')).toBeNull();
    expect(terminalNameError('  ')).toMatch(/name/);
    expect(terminalNameError('x'.repeat(41))).toMatch(/40/);
    expect(isOnline(new Date(1000), 1000 + 60_000)).toBe(true);
    expect(isOnline(new Date(1000), 1000 + 180_000)).toBe(false);
    expect(isOnline(null, 1000)).toBe(false);
  });
});
