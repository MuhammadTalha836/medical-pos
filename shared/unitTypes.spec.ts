import { describe, expect, it } from 'vitest';
import { DEFAULT_UNIT_TYPES, parseUnitTypes, unitChoices, unitTypesError } from './unitTypes';

describe('medicine unit types', () => {
  it('falls back to the default list when the setting is missing or broken', () => {
    expect(parseUnitTypes(undefined)).toEqual(DEFAULT_UNIT_TYPES);
    expect(parseUnitTypes('not json')).toEqual(DEFAULT_UNIT_TYPES);
    expect(parseUnitTypes('[]')).toEqual(DEFAULT_UNIT_TYPES);
    expect(parseUnitTypes(JSON.stringify([' ml ', 'Sachet', 3]))).toEqual(['ml', 'Sachet']);
  });

  it('checks the list before it is saved', () => {
    expect(unitTypesError(JSON.stringify(['ml', 'Litre']))).toBeNull();
    expect(unitTypesError('[]')).toMatch(/at least one/);
    expect(unitTypesError(JSON.stringify(['ml', 'ML']))).toMatch(/twice/);
    expect(unitTypesError(JSON.stringify(['x'.repeat(41)]))).toMatch(/40 characters/);
    expect(unitTypesError(JSON.stringify(Array.from({ length: 51 }, (_, i) => `u${i}`)))).toMatch(/50/);
    expect(unitTypesError('{')).toMatch(/could not be read/);
  });

  it('keeps a medicine unit that is no longer listed', () => {
    expect(unitChoices(['ml'], 'Tablets')).toEqual(['ml', 'Tablets']);
    expect(unitChoices(['ml'], 'ML')).toEqual(['ml']);
    expect(unitChoices(['ml'], '')).toEqual(['ml']);
  });
});
