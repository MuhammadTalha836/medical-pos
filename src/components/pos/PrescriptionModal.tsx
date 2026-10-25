import React, { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Modal } from '../common/Modal';
import { PrescriptionInput } from '../../types';
import { PRESCRIPTION_NOTES_MAX, PRESCRIPTION_TEXT_MAX, isValidCnic, missingPrescriptionFields } from '../../../shared/schedule';

interface PrescriptionModalProps {
  isOpen: boolean;
  /** Names of the controlled medicines on the invoice */
  medicines: string[];
  /** Details already entered on this invoice, or the customer as a starting point */
  initial: Partial<PrescriptionInput>;
  onCancel: () => void;
  onSave: (prescription: PrescriptionInput) => void;
}

const EMPTY: PrescriptionInput = { patient_name: '', patient_phone: '', patient_cnic: '', doctor_name: '', doctor_reg_no: '', prescription_no: '', notes: '' };

/** Prescription details the law requires before a controlled medicine is sold; they go into the register */
export const PrescriptionModal: React.FC<PrescriptionModalProps> = ({ isOpen, medicines, initial, onCancel, onSave }) => {
  const [form, setForm] = useState<PrescriptionInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(initial).filter(([, v]) => v != null)) });
    setError(null);
    // Only when it opens: the starting values must not overwrite what is being typed
  }, [isOpen]);

  const set = (key: keyof PrescriptionInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const missing = missingPrescriptionFields(form);
    if (missing.length > 0) {
      setError(`Enter the ${missing.join(', ')}.`);
      return;
    }
    if (!isValidCnic(form.patient_cnic)) {
      setError('CNIC must be 13 digits, e.g. 35202-1234567-1.');
      return;
    }
    const trimmed = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, (v ?? '').trim()])) as unknown as PrescriptionInput;
    onSave(trimmed);
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Prescription Details" maxWidth="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-3 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-800 dark:text-rose-300">
          <ClipboardList className="w-5 h-5 shrink-0 mt-0.5" />
          <p>
            <span className="font-semibold">{medicines.join(', ')}</span>
            {medicines.length === 1 ? ' is a controlled medicine.' : ' are controlled medicines.'} Copy the details from the prescription. They are saved in the controlled register.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block sm:col-span-2">
            <span className="field-label">Patient name *</span>
            <input type="text" autoFocus maxLength={PRESCRIPTION_TEXT_MAX} value={form.patient_name} onChange={set('patient_name')} className="field-input w-full" />
          </label>
          <label className="block">
            <span className="field-label">Patient phone</span>
            <input type="tel" maxLength={20} value={form.patient_phone} onChange={set('patient_phone')} className="field-input w-full font-mono" />
          </label>
          <label className="block">
            <span className="field-label">CNIC</span>
            <input type="text" maxLength={20} value={form.patient_cnic} onChange={set('patient_cnic')} placeholder="35202-1234567-1" className="field-input w-full font-mono" />
          </label>
          <label className="block">
            <span className="field-label">Doctor name *</span>
            <input type="text" maxLength={PRESCRIPTION_TEXT_MAX} value={form.doctor_name} onChange={set('doctor_name')} className="field-input w-full" />
          </label>
          <label className="block">
            <span className="field-label">Doctor registration no.</span>
            <input type="text" maxLength={PRESCRIPTION_TEXT_MAX} value={form.doctor_reg_no} onChange={set('doctor_reg_no')} className="field-input w-full font-mono" />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Prescription no. *</span>
            <input type="text" maxLength={PRESCRIPTION_TEXT_MAX} value={form.prescription_no} onChange={set('prescription_no')} className="field-input w-full font-mono" />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Notes</span>
            <input type="text" maxLength={PRESCRIPTION_NOTES_MAX} value={form.notes} onChange={set('notes')} placeholder="e.g. Dose as written, 5 days" className="field-input w-full" />
          </label>
        </div>

        {error && <p className="text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary">Save and Complete Sale</button>
        </div>
      </form>
    </Modal>
  );
};
