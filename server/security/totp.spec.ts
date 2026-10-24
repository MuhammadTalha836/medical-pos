import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  generateTotpCode,
  generateTotpSecret,
  generateTotpUri,
  verifyTotpStep
} from './totp';

// RFC 6238 Appendix B secret "12345678901234567890" (SHA-1) in Base32
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP (otplib)', () => {
  it('matches the RFC 6238 SHA-1 test vectors (last 6 digits)', () => {
    expect(generateTotpCode(RFC_SECRET, 59)).toBe('287082');
    expect(generateTotpCode(RFC_SECRET, 1111111109)).toBe('081804');
    expect(generateTotpCode(RFC_SECRET, 1234567890)).toBe('005924');
  });

  it('rejects malformed codes', () => {
    const secret = generateTotpSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef']) expect(verifyTotpStep(secret, bad)).toBeNull();
  });

  it('builds an authenticator URI with issuer and secret', () => {
    const uri = generateTotpUri('dev@store.local', RFC_SECRET);
    expect(uri.startsWith('otpauth://totp/PharmaCare%20Pro:dev%40store.local?')).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
  });

  it('generates 160-bit Base32 secrets', () => {
    expect(base32Decode(generateTotpSecret()).length).toBe(20);
    expect(base32Decode('OBUGC4TNMFRWC4TF').toString()).toBe('pharmacare');
  });
});

describe('TOTP time steps (replay protection)', () => {
  it('accepts codes within one 30 s step, returns that step, and rejects older ones', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000;
    const step = Math.floor(now / 30);
    expect(verifyTotpStep(secret, generateTotpCode(secret, now), 1, now)).toBe(step);
    expect(verifyTotpStep(secret, generateTotpCode(secret, now - 30), 1, now)).toBe(step - 1);
    expect(verifyTotpStep(secret, generateTotpCode(secret, now + 30), 1, now)).toBe(step + 1);
    expect(verifyTotpStep(secret, generateTotpCode(secret, now - 120), 1, now)).toBeNull();
    expect(verifyTotpStep(secret, 'abcdef', 1, now)).toBeNull();
  });
});
