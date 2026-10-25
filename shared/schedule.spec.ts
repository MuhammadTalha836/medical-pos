import { describe, expect, it } from 'vitest';
import { isValidCnic, missingPrescriptionFields, normalizeSchedule } from './schedule';

describe('normalizeSchedule', () => {
  it('keeps known values and falls back to none', () => {
    expect(normalizeSchedule('controlled')).toBe('controlled');
    expect(normalizeSchedule(' RX ')).toBe('rx');
    expect(normalizeSchedule('narcotic')).toBe('none');
    expect(normalizeSchedule(null)).toBe('none');
  });
});

describe('missingPrescriptionFields', () => {
  it('lists every empty required field', () => {
    expect(missingPrescriptionFields(null)).toEqual(['patient name', 'doctor name', 'prescription number']);
    expect(missingPrescriptionFields({ patient_name: 'Ali', doctor_name: '  ', prescription_no: 'R-1' })).toEqual(['doctor name']);
  });

  it('is empty when patient, doctor and prescription number are given', () => {
    expect(missingPrescriptionFields({ patient_name: 'Ali', doctor_name: 'Dr Khan', prescription_no: 'R-1' })).toEqual([]);
  });
});

describe('isValidCnic', () => {
  it('accepts blank or 13 digits with or without dashes', () => {
    expect(isValidCnic('')).toBe(true);
    expect(isValidCnic('35202-1234567-1')).toBe(true);
    expect(isValidCnic('3520212345671')).toBe(true);
    expect(isValidCnic('35202-123')).toBe(false);
  });
});
