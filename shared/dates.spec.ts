import { describe, expect, it } from 'vitest';
import { localDateKey, localDateString } from './dates';

describe('local dates', () => {
  it('uses the local calendar day, not UTC', () => {
    const justAfterMidnight = new Date(2026, 9, 24, 0, 30);
    expect(localDateString(justAfterMidnight)).toBe('2026-10-24');
    expect(localDateKey(justAfterMidnight)).toBe('20261024');
  });
});
