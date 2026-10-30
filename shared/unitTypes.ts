// Medicine sale units (C2). The Admin keeps the list in the setting medicine_unit_types (a JSON array of names);
// products store their unit as plain text, so removing a name from the list never changes a saved medicine.

export const DEFAULT_UNIT_TYPES = [
  'Tablets', 'Capsules', 'Strip', 'Box', 'Bottle', 'Syrup', 'Suspension',
  'Injection', 'Drops', 'Sachet', 'Ointment', 'Inhaler', 'Unit'
];

export const UNIT_TYPES_MAX = 50;
export const UNIT_TYPE_NAME_MAX = 40;

/** The saved list, or the default list when the setting is missing or broken */
export function parseUnitTypes(json: string | null | undefined): string[] {
  if (!json) return [...DEFAULT_UNIT_TYPES];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [...DEFAULT_UNIT_TYPES];
    const names = parsed.filter((n): n is string => typeof n === 'string').map(n => n.trim()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_UNIT_TYPES];
  } catch {
    return [...DEFAULT_UNIT_TYPES];
  }
}

/** Why a list cannot be saved, or null when it is fine: 1-50 names, each 1-40 characters, no repeats (any case) */
export function unitTypesError(value: unknown): string | null {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      return 'The unit list could not be read.';
    }
  }
  if (!Array.isArray(list) || list.length === 0) return 'Keep at least one medicine unit.';
  if (list.length > UNIT_TYPES_MAX) return `At most ${UNIT_TYPES_MAX} medicine units can be listed.`;
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'string' || !item.trim()) return 'A medicine unit name cannot be blank.';
    if (item.trim().length > UNIT_TYPE_NAME_MAX) return `A medicine unit name can be at most ${UNIT_TYPE_NAME_MAX} characters.`;
    const key = item.trim().toLowerCase();
    if (seen.has(key)) return `"${item.trim()}" is in the list twice.`;
    seen.add(key);
  }
  return null;
}

/** The choices for a medicine form: the list, plus the medicine's own unit when it is no longer listed */
export function unitChoices(list: string[], current?: string | null): string[] {
  const value = current?.trim();
  return value && !list.some(n => n.toLowerCase() === value.toLowerCase()) ? [...list, value] : list;
}
