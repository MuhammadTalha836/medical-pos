import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WHATSAPP_REMINDER_TEMPLATE,
  fillTemplate,
  receiptMessage,
  reminderMessage,
  whatsappLink,
  whatsappPhone,
  whatsappPhoneWarning
} from './whatsapp';

const money = (n: number) => `Rs. ${n.toFixed(2)}`;

describe('whatsappPhone', () => {
  it('turns Pakistani mobile numbers into 92XXXXXXXXXX', () => {
    for (const phone of ['0300-1234567', '03001234567', '+92 300 1234567', '0092 300 1234567', '3001234567', '923001234567']) {
      expect(whatsappPhone(phone)).toBe('923001234567');
    }
  });

  it('keeps foreign numbers and refuses what cannot be a WhatsApp number', () => {
    expect(whatsappPhone('+971 50 123 4567')).toBe('971501234567');
    expect(whatsappPhone('1234567')).toBeNull();
    expect(whatsappPhone('042-1234567')).toBeNull();
    expect(whatsappPhone('')).toBeNull();
    expect(whatsappPhone(null)).toBeNull();
  });

  it('warns about a mobile number missing a digit, not about a good or empty one', () => {
    expect(whatsappPhoneWarning('0344767632')).toMatch(/11 digits/);
    expect(whatsappPhoneWarning('0344-7676321')).toBeNull();
    expect(whatsappPhoneWarning('')).toBeNull();
  });
});

describe('fillTemplate', () => {
  it('fills known placeholders and keeps unknown ones', () => {
    expect(fillTemplate('Hi {customer}, {unknown} {customer}', { customer: 'Ali' })).toBe('Hi Ali, {unknown} Ali');
  });
});

describe('whatsappLink', () => {
  it('encodes the message and needs a usable phone', () => {
    expect(whatsappLink('0300-1234567', 'A & B\nسلام')).toBe(`https://wa.me/923001234567?text=${encodeURIComponent('A & B\nسلام')}`);
    expect(whatsappLink('123', 'Hi')).toBeNull();
  });
});

describe('receiptMessage', () => {
  const sale = {
    invoice_no: 'INV-20261025-0001',
    customer_name: 'Ali',
    sale_date: '2026-10-25T10:30:00',
    net_total: 240,
    payment_type: 'Cash',
    store_name_snapshot: 'City Pharmacy',
    items: [{ product_name: 'Panadol', quantity: 2, is_loose: 0, net_amount: 240 }]
  };

  it('uses the default template with the invoice details', () => {
    const text = receiptMessage(sale, { store_phone: '042-111' }, money);
    expect(text).toContain('Assalam-o-Alaikum Ali');
    expect(text).toContain('INV-20261025-0001');
    expect(text).toContain('- Panadol x 2 Bx = Rs. 240.00');
    expect(text).toContain('Total: Rs. 240.00 (Cash)');
    expect(text).toContain('City Pharmacy 042-111');
  });

  it('caps the item lines and uses a saved template', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ product_name: `Med ${i}`, quantity: 1, is_loose: 1, net_amount: 1 }));
    const text = receiptMessage({ ...sale, items }, { whatsapp_receipt_template: '{items}' }, money);
    expect(text.split('\n')).toHaveLength(26);
    expect(text).toContain('- Med 0 x 1 Unit = Rs. 1.00');
    expect(text.endsWith('...and 5 more')).toBe(true);
  });
});

describe('reminderMessage', () => {
  it('shows the balance, and a blank template falls back to the default', () => {
    const text = reminderMessage({ name: 'Sara', current_balance: 1500 }, { store_name: 'City Pharmacy', whatsapp_reminder_template: '  ' }, money);
    expect(text).toContain('Assalam-o-Alaikum Sara');
    expect(text).toContain('Your khata balance is Rs. 1500.00');
    expect(DEFAULT_WHATSAPP_REMINDER_TEMPLATE).toContain('{balance}');
  });
});
