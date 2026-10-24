import { describe, expect, it } from 'vitest';
import { isValidPaperSize, isValidTemplate, normalizePaperSize, normalizeTemplate } from './invoice';

describe('thermal-only invoice settings', () => {
  it('accepts only the three thermal designs', () => {
    for (const t of ['classic', 'compact', 'detailed']) expect(isValidTemplate(t)).toBe(true);
    for (const t of ['thermal', 'standard', 'A4', '', null]) expect(isValidTemplate(t)).toBe(false);
  });

  it('accepts only 58mm and 80mm rolls', () => {
    expect(isValidPaperSize('58mm')).toBe(true);
    expect(isValidPaperSize('80mm')).toBe(true);
    for (const p of ['A3', 'A4', 'A5', '100mm', undefined]) expect(isValidPaperSize(p)).toBe(false);
  });

  it('normalizes legacy values to thermal defaults', () => {
    expect(normalizeTemplate('thermal')).toBe('classic');
    expect(normalizeTemplate('standard')).toBe('classic');
    expect(normalizeTemplate('detailed')).toBe('detailed');
    expect(normalizePaperSize('A4')).toBe('80mm');
    expect(normalizePaperSize('58mm')).toBe('58mm');
  });
});
