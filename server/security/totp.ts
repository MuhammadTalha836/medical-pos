import crypto from 'crypto';
import { authenticator } from 'otplib';

// RFC 4648 Base32 Alphabet (helpers kept for callers that encode/decode raw keys)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encodes a buffer to an RFC 4648 Base32 string (without padding).
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

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
 * Generates an RFC 6238 TOTP code for a given secret at a given timestamp.
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
 * Verifies a 6-digit TOTP code with time-step drift tolerance.
 *
 * @param secret Base32 secret
 * @param userCode 6-digit code provided by user
 * @param window Tolerance window steps (+/- window * 30s). Default 1 (+/- 30s)
 * @param currentTimestampSec Timestamp in seconds (defaults to current time)
 */
export function verifyTotpCode(
  secret: string,
  userCode: string,
  window: number = 1,
  currentTimestampSec: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!userCode || typeof userCode !== 'string') return false;
  const cleanedCode = userCode.trim().replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleanedCode)) return false;

  try {
    return authenticatorAt(currentTimestampSec, window).check(cleanedCode, secret);
  } catch {
    return false;
  }
}

/**
 * Like verifyTotpCode, but returns the matched 30 s time step (or null). Callers store the step
 * and reject any code whose step is not newer, so a code can never be used twice.
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

// ----------------------------------------------------------------------------
// AES-256-GCM Secret Encryption at Rest
// ----------------------------------------------------------------------------
const ENCRYPTION_MASTER_SEED = process.env.ENCRYPTION_MASTER_SEED || 'pharmacare-offline-desktop-master-totp-key-2026';
const DERIVED_KEY = crypto.scryptSync(ENCRYPTION_MASTER_SEED, 'pharmacare-salt-v1', 32);

/**
 * Encrypts a plaintext TOTP secret with AES-256-GCM before database storage.
 */
export function encryptTotpSecret(plaintextSecret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DERIVED_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextSecret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a stored AES-256-GCM TOTP secret.
 * Gracefully handles unencrypted legacy secrets.
 */
export function decryptTotpSecret(storedValue: string): string {
  if (!storedValue) return '';

  const parts = storedValue.split(':');
  if (parts.length === 3) {
    try {
      const [ivHex, authTagHex, encryptedHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const encrypted = Buffer.from(encryptedHex, 'hex');

      const decipher = crypto.createDecipheriv('aes-256-gcm', DERIVED_KEY, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      // If decryption fails, return as-is
      return storedValue;
    }
  }

  // Not formatted as iv:tag:data, return raw
  return storedValue;
}
