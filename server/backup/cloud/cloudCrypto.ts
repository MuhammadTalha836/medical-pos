import crypto from 'crypto';

/**
 * Encryption for online backups and the stored Google sign-in (pure: no DB, no network).
 * Keys are derived from the developer master key, so a backup file downloaded from Drive cannot be opened
 * without this app, and any build with the same master key can restore it on a new computer.
 *
 * File layout: MAGIC (4) | IV (12) | GCM tag (16) | ciphertext. The magic is authenticated as AAD.
 */
const MAGIC = Buffer.from('PCB1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES + TAG_BYTES;

export type CloudKeyPurpose = 'backup-file-v1' | 'drive-token-v1';

export function deriveCloudKey(masterKey: Buffer, purpose: CloudKeyPurpose): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, 'pharmacare-cloud-backup', purpose, 32));
}

export function encryptBackup(plain: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decryptBackup(sealed: Buffer, key: Buffer): Buffer {
  if (sealed.length < HEADER_BYTES || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('This file is not a 100% Offline POS online backup.');
  }
  const iv = sealed.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = sealed.subarray(MAGIC.length + IV_BYTES, HEADER_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(sealed.subarray(HEADER_BYTES)), decipher.final()]);
  } catch {
    throw new Error('The online backup could not be opened: it is damaged or was made with a different developer key.');
  }
}

/** Seals a short secret (the Google refresh token) for storage in system_settings. */
export function sealSecret(value: string, key: Buffer): string {
  return encryptBackup(Buffer.from(value, 'utf8'), key).toString('base64');
}

export function openSecret(sealed: string, key: Buffer): string {
  return decryptBackup(Buffer.from(sealed, 'base64'), key).toString('utf8');
}
