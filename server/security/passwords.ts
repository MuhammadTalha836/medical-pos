import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/**
 * Hashes a plaintext password using bcrypt with salt rounds.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Verifies a password against the stored string.
 * Supports transparent upgrade of legacy plaintext passwords:
 * if the stored password is not a bcrypt hash, it tests plaintext equality
 * and flags `needsRehash: true` so the caller can save the new bcrypt hash.
 */
export async function verifyPassword(
  plaintext: string,
  stored: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!stored) {
    return { valid: false, needsRehash: false };
  }

  // Check if stored string is a standard bcrypt hash ($2a$, $2b$, $2y$)
  const isBcrypt = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(stored);

  if (isBcrypt) {
    const valid = await bcrypt.compare(plaintext, stored);
    return { valid, needsRehash: false };
  }

  // Legacy plaintext fallback check
  const valid = plaintext === stored;
  return { valid, needsRehash: valid };
}
