import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVELOPER_PROFILE_SETTINGS,
  composeInvoiceFooter,
  composeWhatsAppCredit,
  developerInfoFor,
  formatDeveloperLine,
  isValidInfoFields,
  parseInfoFields
} from './developerProfile';
import { DEFAULT_DEVELOPER_FOOTER } from './invoice';

const profile = {
  ...DEFAULT_DEVELOPER_PROFILE_SETTINGS,
  developer_name: 'Talha Tech',
  developer_phone: '0300-1234567',
  developer_contact_email: 'help@talha.example'
};

describe('developer profile', () => {
  it('validates and normalizes placement field lists', () => {
    expect(isValidInfoFields('name, phone')).toBe(true);
    expect(isValidInfoFields('')).toBe(true);
    expect(isValidInfoFields('name,password')).toBe(false);
    expect(parseInfoFields('phone,name,phone, bogus')).toEqual(['name', 'phone']);
    expect(parseInfoFields(undefined)).toEqual([]);
  });

  it('returns only filled-in fields chosen for a placement', () => {
    expect(developerInfoFor(profile, 'login').map(i => i.value)).toEqual(['Talha Tech', '0300-1234567']);
    expect(developerInfoFor({ ...profile, developer_info_login: 'email,website' }, 'login').map(i => i.key)).toEqual(['email']);
    expect(developerInfoFor({ ...profile, developer_info_login: '' }, 'login')).toEqual([]);
    expect(developerInfoFor(null, 'about')).toEqual([]);
  });

  it('uses the default fields when a placement was never saved', () => {
    expect(developerInfoFor({ developer_name: 'Talha Tech' }, 'sidebar').map(i => i.key)).toEqual(['name']);
  });

  it('formats one line, leading with the name', () => {
    expect(formatDeveloperLine(developerInfoFor(profile, 'invoice'))).toBe('Software by Talha Tech • 0300-1234567');
    expect(formatDeveloperLine(developerInfoFor({ ...profile, developer_info_invoice: 'phone' }, 'invoice'))).toBe('0300-1234567');
    expect(formatDeveloperLine([])).toBe('');
  });

  it('composes the WhatsApp line with its lead text, or nothing when no detail is chosen', () => {
    expect(composeWhatsAppCredit(profile)).toBe('Software built and developed by Talha Tech • 0300-1234567');
    expect(composeWhatsAppCredit({ ...profile, developer_whatsapp_lead: 'Powered by', developer_info_whatsapp: 'name' })).toBe('Powered by Talha Tech');
    expect(composeWhatsAppCredit({ ...profile, developer_whatsapp_lead: '' })).toBe('Talha Tech • 0300-1234567');
    expect(composeWhatsAppCredit({ ...profile, developer_info_whatsapp: '' })).toBe('');
  });

  it('composes the receipt footer from the footer text and the receipt line', () => {
    expect(composeInvoiceFooter({ ...profile, developer_invoice_footer: 'Thanks' })).toBe('Thanks\nSoftware by Talha Tech • 0300-1234567');
    expect(composeInvoiceFooter({})).toBe(DEFAULT_DEVELOPER_FOOTER);
  });
});
