import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { base32Decode } from './totp';

/**
 * The developer's master TOTP key. One key (one entry in the developer's authenticator app) unlocks
 * the setup wizard and the developer login on every installation.
 *
 * Packaged builds get both values injected at build time by electron.vite.config.ts from .env.developer.
 * Dev servers and tests read the environment, falling back to .env.developer in the project folder.
 * The file is created by `npm run developer:key` and must never be committed.
 */
export const DEVELOPER_KEY_FILE = '.env.developer';
export const DEFAULT_DEVELOPER_EMAIL = 'muhammadtalhatalha425@gmail.com';

export class DeveloperKeyMissingError extends Error {
  constructor() {
    super('Developer master key is not configured. Run "npm run developer:key" and rebuild the app.');
    this.name = 'DeveloperKeyMissingError';
  }
}

let keyFileChecked = false;

function loadKeyFile(): void {
  if (keyFileChecked) return;
  keyFileChecked = true;
  if (process.env.PHARMACARE_DEV_TOTP_SECRET) return;
  const file = path.resolve(process.cwd(), DEVELOPER_KEY_FILE);
  if (fs.existsSync(file)) {
    dotenv.config({ path: file, quiet: true });
  }
}

function isUsableSecret(secret: string | undefined): secret is string {
  if (!secret) return false;
  try {
    // At least 80 bits, as RFC 4226 requires
    return base32Decode(secret).length >= 10;
  } catch {
    return false;
  }
}

export function isDeveloperKeyConfigured(): boolean {
  loadKeyFile();
  return isUsableSecret(process.env.PHARMACARE_DEV_TOTP_SECRET);
}

/** Base32 master secret. Throws DeveloperKeyMissingError instead of ever falling back to a default. */
export function getDeveloperSecret(): string {
  loadKeyFile();
  const secret = process.env.PHARMACARE_DEV_TOTP_SECRET;
  if (!isUsableSecret(secret)) throw new DeveloperKeyMissingError();
  return secret;
}

export function getDeveloperEmail(): string {
  loadKeyFile();
  return (process.env.PHARMACARE_DEVELOPER_EMAIL || DEFAULT_DEVELOPER_EMAIL).trim().toLowerCase();
}

/**
 * Google sign-in client (a "Desktop app" OAuth client from the developer's Google Cloud project) used for
 * online backups. Optional: without it the build offers only offline backups. Comes from .env.developer.
 */
export function getGoogleOAuthClient(): { clientId: string; clientSecret: string } | null {
  loadKeyFile();
  const clientId = (process.env.PHARMACARE_GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.PHARMACARE_GOOGLE_CLIENT_SECRET || '').trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
