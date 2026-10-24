import { authenticator } from 'otplib';

// RFC 4648 Base32 alphabet (the master key is decoded to derive the license signing key)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decodes an RFC 4648 Base32 string into a Buffer.
 */
export function base32Decode(base32Str: string): Buffer {
  const cleanStr = base32Str.toUpperCase().replace(/[\s-=_]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleanStr.length; i++) {
    const char = cleanStr[i];
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s step) via otplib's Google Authenticator-compatible preset
const TOTP_OPTIONS = { step: 30, digits: 6 };

function authenticatorAt(timestampSec: number, window: number = 0) {
  return authenticator.clone({ ...TOTP_OPTIONS, window, epoch: timestampSec * 1000 });
}

/**
 * Generates a cryptographically random 20-byte Base32 secret for TOTP.
 */
export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

/**
 * Generates an RFC 6238 TOTP code for a given secret at a given timestamp (used by the test suites).
 *
 * @param secret Base32 encoded secret key
 * @param timestampSec Unix timestamp in seconds (defaults to Date.now() / 1000)
 * @param stepSec Step interval in seconds (default 30)
 * @param digits Number of digits (default 6)
 */
export function generateTotpCode(
  secret: string,
  timestampSec: number = Math.floor(Date.now() / 1000),
  stepSec: number = 30,
  digits: number = 6
): string {
  return authenticator.clone({ step: stepSec, digits, epoch: timestampSec * 1000 }).generate(secret);
}

/**
 * Verifies a 6-digit TOTP code with +/- `window` steps of clock drift and returns the matched 30 s time
 * step (or null). Callers store the step and reject any code whose step is not newer, so a code can never
 * be used twice.
 */
export function verifyTotpStep(
  secret: string,
  userCode: string,
  window: number = 1,
  currentTimestampSec: number = Math.floor(Date.now() / 1000)
): number | null {
  if (!userCode || typeof userCode !== 'string') return null;
  const cleanedCode = userCode.trim().replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleanedCode)) return null;

  try {
    const delta = authenticatorAt(currentTimestampSec, window).checkDelta(cleanedCode, secret);
    return delta === null ? null : Math.floor(currentTimestampSec / TOTP_OPTIONS.step) + delta;
  } catch {
    return null;
  }
}

/**
 * Builds standard otpauth:// URI for authenticator QR codes.
 */
export function generateTotpUri(
  account: string,
  secret: string,
  issuer: string = 'PharmaCare Pro'
): string {
  return authenticator.clone(TOTP_OPTIONS).keyuri(account, issuer, secret);
}
