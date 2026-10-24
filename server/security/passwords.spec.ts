import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords';

describe('password hashing (bcryptjs)', () => {
  it('hashes with bcrypt and verifies only the right password', async () => {
    const hash = await hashPassword('Secret#123');
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(hash).not.toContain('Secret#123');
    expect(await verifyPassword('Secret#123', hash)).toEqual({ valid: true, needsRehash: false });
    expect((await verifyPassword('wrong', hash)).valid).toBe(false);
  });

  it('accepts a legacy plaintext password once and flags it for rehashing', async () => {
    expect(await verifyPassword('admin123', 'admin123')).toEqual({ valid: true, needsRehash: true });
    expect((await verifyPassword('nope', 'admin123')).valid).toBe(false);
    expect((await verifyPassword('anything', '')).valid).toBe(false);
  });
});
