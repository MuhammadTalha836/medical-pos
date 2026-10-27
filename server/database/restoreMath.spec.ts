import { describe, expect, it } from 'vitest';
import { compareVersions, restoreVersionError } from './restoreMath';

describe('compareVersions', () => {
  it('compares part by part as numbers', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('1.2.9', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('treats missing parts as 0 and ignores text after a dash', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('0.0.0-dev', '0.0.0')).toBe(0);
    expect(compareVersions('1.0.1-beta', '1.0.0')).toBe(1);
  });
});

describe('restoreVersionError', () => {
  it('refuses only a backup from a newer version', () => {
    expect(restoreVersionError('1.1.0', '1.0.0')).toMatch(/newer version/);
    expect(restoreVersionError('1.0.0', '1.0.0')).toBeNull();
    expect(restoreVersionError('0.9.0', '1.0.0')).toBeNull();
  });

  it('allows an old backup that has no version stamp', () => {
    expect(restoreVersionError(null, '1.0.0')).toBeNull();
    expect(restoreVersionError(undefined, '1.0.0')).toBeNull();
  });
});
