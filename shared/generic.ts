/** Generic-formula matching shared by the substitutes search (API) and the Medicines form. */

/**
 * The key two medicines must share to be substitutes: lower case, single spaces, strengths written without a
 * space ("500 mg" = "500mg"), ingredients (split on +, comma, & or "and") sorted. Different strengths stay
 * different. "/" is not a separator because strengths use it ("120mg/5ml"). Empty means no formula.
 */
export function genericKey(name: string | null | undefined): string {
  const text = (name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text
    .split(/\s*(?:\+|,|&|\band\b)\s*/)
    .map(part => part.replace(/(\d)\s+(?=[a-z%])/g, '$1').replace(/\s*\/\s*/g, '/').trim())
    .filter(Boolean)
    .sort()
    .join('+');
}

export interface SubstituteCandidate {
  id: number;
  name: string;
  generic_name?: string | null;
  unit_type?: string | null;
  packing?: number | null;
  stock_boxes: number;
  stock_loose: number;
  status?: string | null;
}

const stockUnits = (p: SubstituteCandidate) => (Number(p.stock_boxes) || 0) * (Number(p.packing) || 1) + (Number(p.stock_loose) || 0);

/** Other active medicines with the same formula: in stock first, then the same unit type, then most stock, then name */
export function rankSubstitutes<T extends SubstituteCandidate>(target: SubstituteCandidate, candidates: T[]): T[] {
  const key = genericKey(target.generic_name);
  if (!key) return [];
  return candidates
    .filter(c => c.id !== target.id && (c.status ?? 'active') === 'active' && genericKey(c.generic_name) === key)
    .sort((a, b) => {
      const inStock = Number(stockUnits(b) > 0) - Number(stockUnits(a) > 0);
      if (inStock) return inStock;
      const sameUnit = Number(b.unit_type === target.unit_type) - Number(a.unit_type === target.unit_type);
      if (sameUnit) return sameUnit;
      const more = stockUnits(b) - stockUnits(a);
      if (more) return more;
      return a.name.localeCompare(b.name);
    });
}
