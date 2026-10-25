import { DEFAULT_DEVELOPER_FOOTER } from './invoice';

/**
 * Developer contact details shown inside the app (advertising for the software's developer).
 * The Developer fills the profile and picks, per placement, which fields appear there.
 * Stored in system_settings: one key per field, and one comma list of field keys per placement.
 */

export const DEVELOPER_PROFILE_FIELDS = [
  { key: 'name', setting: 'developer_name', label: 'Name', maxLength: 60 },
  { key: 'company', setting: 'developer_company', label: 'Company', maxLength: 80 },
  { key: 'phone', setting: 'developer_phone', label: 'Phone', maxLength: 30 },
  { key: 'whatsapp', setting: 'developer_whatsapp', label: 'WhatsApp', maxLength: 30 },
  { key: 'email', setting: 'developer_contact_email', label: 'Email', maxLength: 80 },
  { key: 'website', setting: 'developer_website', label: 'Website', maxLength: 80 },
  { key: 'tagline', setting: 'developer_tagline', label: 'Message', maxLength: 120 }
] as const;

export type DeveloperField = (typeof DEVELOPER_PROFILE_FIELDS)[number]['key'];

const ALL_FIELDS = DEVELOPER_PROFILE_FIELDS.map(f => f.key) as DeveloperField[];

export const DEVELOPER_INFO_PLACEMENTS = [
  { key: 'login', setting: 'developer_info_login', label: 'Login screen', defaultFields: ['name', 'phone'] },
  { key: 'sidebar', setting: 'developer_info_sidebar', label: 'Sidebar', defaultFields: ['name', 'phone'] },
  { key: 'invoice', setting: 'developer_info_invoice', label: 'Sale receipt', defaultFields: ['name', 'phone'] },
  { key: 'about', setting: 'developer_info_about', label: 'Support window', defaultFields: ALL_FIELDS },
  // Edited in its own WhatsApp section of the Developer Profile, not in the placement table
  { key: 'whatsapp', setting: 'developer_info_whatsapp', label: 'WhatsApp messages', defaultFields: ['name', 'phone'] }
] as const satisfies readonly { key: string; setting: string; label: string; defaultFields: readonly DeveloperField[] }[];

export type DeveloperPlacement = (typeof DEVELOPER_INFO_PLACEMENTS)[number]['key'];

/** Words before the developer's details at the end of every WhatsApp message */
export const WHATSAPP_CREDIT_LEAD_SETTING = 'developer_whatsapp_lead';
export const DEFAULT_WHATSAPP_CREDIT_LEAD = 'Software built and developed by';
export const WHATSAPP_CREDIT_LEAD_MAX = 60;

export const DEVELOPER_PROFILE_SETTING_KEYS: string[] = [
  ...DEVELOPER_PROFILE_FIELDS.map(f => f.setting),
  ...DEVELOPER_INFO_PLACEMENTS.map(p => p.setting),
  WHATSAPP_CREDIT_LEAD_SETTING
];

export const DEFAULT_DEVELOPER_PROFILE_SETTINGS: Record<string, string> = Object.fromEntries([
  ...DEVELOPER_PROFILE_FIELDS.map(f => [f.setting, '']),
  ...DEVELOPER_INFO_PLACEMENTS.map(p => [p.setting, p.defaultFields.join(',')]),
  [WHATSAPP_CREDIT_LEAD_SETTING, DEFAULT_WHATSAPP_CREDIT_LEAD]
]);

/** True when every comma-separated entry is a known field key (an empty list hides the placement). */
export function isValidInfoFields(value: string): boolean {
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .every(key => (ALL_FIELDS as string[]).includes(key));
}

/** Known field keys from a stored comma list, deduplicated, in profile order. */
export function parseInfoFields(value: string | undefined): DeveloperField[] {
  const picked = new Set((value ?? '').split(',').map(s => s.trim()));
  return ALL_FIELDS.filter(key => picked.has(key));
}

export interface DeveloperInfoItem {
  key: DeveloperField;
  label: string;
  value: string;
}

/** The filled-in fields the Developer chose for one placement. */
export function developerInfoFor(settings: object | null | undefined, placement: DeveloperPlacement): DeveloperInfoItem[] {
  const values = (settings ?? {}) as Record<string, string | undefined>;
  const config = DEVELOPER_INFO_PLACEMENTS.find(p => p.key === placement)!;
  const fields = parseInfoFields(values[config.setting] ?? config.defaultFields.join(','));
  return DEVELOPER_PROFILE_FIELDS.filter(f => fields.includes(f.key))
    .map(f => ({ key: f.key, label: f.label, value: (values[f.setting] ?? '').trim() }))
    .filter(item => item.value);
}

/** One line for small spaces, e.g. "Software by Talha Tech • 0300-1234567". */
export function formatDeveloperLine(items: DeveloperInfoItem[]): string {
  if (items.length === 0) return '';
  const [first, ...rest] = items;
  const lead = first.key === 'name' || first.key === 'company' ? `Software by ${first.value}` : first.value;
  return [lead, ...rest.map(item => item.value)].join(' • ');
}

/**
 * Last line of every WhatsApp message, e.g. "Software built and developed by Muhammad Talha • 0306-8646827".
 * Empty when the Developer chose no WhatsApp details. Staff templates cannot remove it.
 */
export function composeWhatsAppCredit(settings: object | null | undefined): string {
  const items = developerInfoFor(settings, 'whatsapp');
  if (items.length === 0) return '';
  const stored = ((settings ?? {}) as Record<string, string | undefined>)[WHATSAPP_CREDIT_LEAD_SETTING];
  const lead = (stored ?? DEFAULT_WHATSAPP_CREDIT_LEAD).trim();
  const values = items.map(item => item.value).join(' • ');
  return lead ? `${lead} ${values}` : values;
}

/** Receipt footer: the Developer's footer text plus the receipt developer line (snapshotted on each sale). */
export function composeInvoiceFooter(settings: object | null | undefined): string {
  const footer = ((settings ?? {}) as Record<string, string | undefined>).developer_invoice_footer || DEFAULT_DEVELOPER_FOOTER;
  return [footer, formatDeveloperLine(developerInfoFor(settings, 'invoice'))].filter(Boolean).join('\n');
}
