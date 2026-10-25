/** Medicine schedules and the prescription rules shared by the Medicines form, the POS and the API. */

export const MEDICINE_SCHEDULES = ['none', 'rx', 'controlled'] as const;
export type MedicineSchedule = (typeof MEDICINE_SCHEDULES)[number];

export const SCHEDULE_LABELS: Record<MedicineSchedule, string> = {
  none: 'None',
  rx: 'Prescription (Rx)',
  controlled: 'Controlled'
};

export const isMedicineSchedule = (value: unknown): value is MedicineSchedule =>
  typeof value === 'string' && (MEDICINE_SCHEDULES as readonly string[]).includes(value);

/** Stored value for anything read back from the database (unknown or empty means none) */
export function normalizeSchedule(value: unknown): MedicineSchedule {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isMedicineSchedule(v) ? v : 'none';
}

/** Prescription details entered at the counter for a sale with controlled medicines */
export interface PrescriptionInput {
  patient_name: string;
  patient_phone?: string;
  patient_cnic?: string;
  doctor_name: string;
  doctor_reg_no?: string;
  prescription_no: string;
  notes?: string;
}

export const PRESCRIPTION_TEXT_MAX = 120;
export const PRESCRIPTION_NOTES_MAX = 300;

/** CNIC is optional; when given it must be 13 digits (dashes allowed: 12345-1234567-1) */
export function isValidCnic(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  return v === '' || /^\d{5}-?\d{7}-?\d$/.test(v);
}

/** Labels of the required fields still empty; [] means the prescription can be saved */
export function missingPrescriptionFields(rx: { [K in keyof PrescriptionInput]?: string | null } | null | undefined): string[] {
  const missing: string[] = [];
  if (!rx?.patient_name?.trim()) missing.push('patient name');
  if (!rx?.doctor_name?.trim()) missing.push('doctor name');
  if (!rx?.prescription_no?.trim()) missing.push('prescription number');
  return missing;
}
