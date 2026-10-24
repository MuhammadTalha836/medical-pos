import React, { useEffect, useState } from 'react';
import { api } from '../../services/apiService';
import { Customer } from '../../types';
import { Modal } from '../common/Modal';
import { isValidPhone } from '../../../shared/customers';

interface CustomerFormModalProps {
  isOpen: boolean;
  /** Customer being edited; null registers a new one */
  customer: Customer | null;
  currency: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const EMPTY_FORM = { name: '', phone: '', address: '', credit_limit: 0 };

// Add or edit a customer: name, a phone unique to this customer, address and credit limit
export const CustomerFormModal: React.FC<CustomerFormModalProps> = ({ isOpen, customer, currency, onClose, onSaved }) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setForm(customer
      ? { name: customer.name, phone: customer.phone || '', address: customer.address || '', credit_limit: customer.credit_limit || 0 }
      : EMPTY_FORM);
  }, [isOpen, customer]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPhone(form.phone)) {
      setError('Enter the customer\'s phone number (7 to 15 digits).');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      if (customer) {
        await api.updateCustomer(customer.id, form);
        onSaved(`Customer "${form.name}" updated.`);
      } else {
        await api.createCustomer(form);
        onSaved(`Customer "${form.name}" added.`);
      }
    } catch (err: any) {
      // e.g. "This phone number already belongs to ..."
      setError(err.message || 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={customer ? `Edit Customer: ${customer.name}` : 'Add Customer'}
      maxWidth="max-w-md"
    >
      <form onSubmit={save} className="space-y-4">
        <label className="block">
          <span className="field-label">Customer / clinic name</span>
          <input
            type="text"
            required
            autoFocus
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. Dr. Rashid Clinic"
            className="field-input w-full"
          />
        </label>

        <label className="block">
          <span className="field-label">Phone number</span>
          <input
            type="text"
            required
            inputMode="tel"
            value={form.phone}
            onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
            placeholder="e.g. 0300-1234567"
            className="field-input w-full"
          />
          <span className="field-hint">Required. Each customer has their own number, so customers with the same name are not mixed up.</span>
        </label>

        <label className="block">
          <span className="field-label">Address</span>
          <input
            type="text"
            value={form.address}
            onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))}
            placeholder="Shop, street, city"
            className="field-input w-full"
          />
        </label>

        <label className="block">
          <span className="field-label">Credit limit ({currency})</span>
          <input
            type="number"
            min="0"
            value={form.credit_limit}
            onChange={e => setForm(prev => ({ ...prev, credit_limit: parseFloat(e.target.value) || 0 }))}
            className="field-input w-full font-mono"
          />
          <span className="field-hint">Credit sales that would go over this amount are blocked. 0 means no limit.</span>
        </label>

        {error && <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : customer ? 'Save Changes' : 'Add Customer'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
