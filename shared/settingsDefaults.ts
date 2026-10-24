import { DEFAULT_DEVELOPER_FOOTER } from './invoice';
import { DEFAULT_DEVELOPER_PROFILE_SETTINGS } from './developerProfile';
import { DEFAULT_BACKUP_MODE } from './backup';

// Default system_settings values, shared by the seed, GET /api/settings and the Settings page.
// Settings are stored as strings; booleans are 'true' / 'false'.

const DEFAULT_RETURN_POLICY =
  'Unopened medicines in original packaging may be returned or exchanged within 3 days with this invoice. Heat-sensitive and loose units are non-returnable.';

// Receipt fields the Admin can show or hide (Invoice Settings tab)
export const INVOICE_FIELD_KEYS = [
  'show_store_name',
  'show_store_phone',
  'show_store_address',
  'show_store_license',
  'show_invoice_no',
  'show_invoice_date',
  'show_cashier_name',
  'show_customer_name',
  'show_customer_phone',
  'show_col_product_name',
  'show_col_p_code',
  'show_col_unit',
  'show_col_unit_price',
  'show_col_discount',
  'show_col_tax',
  'show_col_total',
  'show_summary_item_count',
  'show_summary_gross',
  'show_summary_discount',
  'show_summary_tax',
  'show_summary_net',
  'show_summary_received',
  'show_summary_change',
  'show_terms',
  'show_footer_note',
  'show_return_policy',
  'show_developer_info'
] as const;

export const ALL_INVOICE_FIELDS_VISIBLE: Record<string, string> = Object.fromEntries(
  INVOICE_FIELD_KEYS.map(key => [key, 'true'])
);

export const DEFAULT_INVOICE_SETTINGS: Record<string, string> = {
  default_invoice_template: 'classic',
  invoice_paper_size: '80mm',
  paper_width: '80mm',
  return_policy_text: DEFAULT_RETURN_POLICY,
  ...ALL_INVOICE_FIELDS_VISIBLE
};

export const DEFAULT_SETTINGS: Record<string, string> = {
  store_name: '',
  store_address: '',
  store_phone: '',
  drug_license_no: '',
  tax_no: '',
  receipt_header: '',
  receipt_footer: 'Wishing you swift health & wellness!',
  receipt_terms:
    '1. Returns accepted within 3 days with original bill.\n2. Cold-chain, cut strips, and loose units are non-refundable.\n3. Please consult a doctor before altering dosages.',
  currency_symbol: 'Rs.',
  auto_backup_dir: './backups',
  auto_backup_enabled: 'true',
  low_stock_threshold: '10',
  max_bill_discount_pct: '14',
  ...DEFAULT_INVOICE_SETTINGS,
  setup_completed: 'false',
  developer_email: '',
  backup_retention_limit: '10',
  backup_mode: DEFAULT_BACKUP_MODE,
  backup_frequency: 'daily',
  backup_scheduled_time: '23:00',
  backup_weekly_day: '0',
  developer_invoice_footer: DEFAULT_DEVELOPER_FOOTER,
  ...DEFAULT_DEVELOPER_PROFILE_SETTINGS,
  allow_admin_create_cashier: 'true',
  allow_admin_create_admin: 'false',
  allow_admin_edit_store_identity: 'false',
  allow_admin_hide_store_identity: 'false'
};
