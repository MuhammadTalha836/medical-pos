import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { decryptBackup, deriveCloudKey, encryptBackup, openSecret, sealSecret } from './cloudCrypto';
import { cloudFileName, cloudRetryDelayMs, driveFilesToPrune } from './cloudMath';
import { localRetentionFor, normalizeBackupMode } from '../../../shared/backup';

const master = crypto.randomBytes(20);

describe('online backup encryption', () => {
  const key = deriveCloudKey(master, 'backup-file-v1');

  it('round-trips a backup file', () => {
    const plain = crypto.randomBytes(5000);
    const sealed = encryptBackup(plain, key);
    expect(sealed.includes(plain.subarray(0, 64))).toBe(false);
    expect(decryptBackup(sealed, key).equals(plain)).toBe(true);
  });

  it('rejects a tampered file, a wrong key and a foreign file', () => {
    const sealed = encryptBackup(Buffer.from('SQLite format 3 data'), key);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptBackup(tampered, key)).toThrow(/damaged/);
    expect(() => decryptBackup(sealed, deriveCloudKey(crypto.randomBytes(20), 'backup-file-v1'))).toThrow(/damaged/);
    expect(() => decryptBackup(Buffer.from('SQLite format 3\0 plain'), key)).toThrow(/not a 100% Offline POS/);
  });

  it('derives separate keys per purpose and seals secrets', () => {
    expect(deriveCloudKey(master, 'drive-token-v1').equals(key)).toBe(false);
    const tokenKey = deriveCloudKey(master, 'drive-token-v1');
    expect(openSecret(sealSecret('1//refresh-token', tokenKey), tokenKey)).toBe('1//refresh-token');
  });
});

describe('online backup queue rules', () => {
  it('backs off 1, 2, 4 minutes up to one hour', () => {
    expect(cloudRetryDelayMs(0)).toBe(0);
    expect(cloudRetryDelayMs(1)).toBe(60_000);
    expect(cloudRetryDelayMs(3)).toBe(240_000);
    expect(cloudRetryDelayMs(20)).toBe(3_600_000);
  });

  it('prunes the oldest Drive files beyond the limit', () => {
    const files = [
      { id: 'a', name: 'a', createdTime: '2026-01-01T00:00:00Z' },
      { id: 'c', name: 'c', createdTime: '2026-01-03T00:00:00Z' },
      { id: 'b', name: 'b', createdTime: '2026-01-02T00:00:00Z' }
    ];
    expect(driveFilesToPrune(files, 2).map(f => f.id)).toEqual(['a']);
    expect(driveFilesToPrune(files, 0).map(f => f.id)).toEqual(['b', 'a']);
  });

  it('names the encrypted copy and keeps few local copies in Online mode', () => {
    expect(cloudFileName('pharmacy_backup_manual_x.db')).toBe('pharmacy_backup_manual_x.pcbackup');
    expect(localRetentionFor('online', 10)).toBe(2);
    expect(localRetentionFor('both', 10)).toBe(10);
    expect(localRetentionFor('online', 1)).toBe(1);
    expect(normalizeBackupMode('cloud')).toBe('offline');
  });
});
