import type { RolePermissions } from '../../shared/permissions';
import type { InvoiceTemplate as InvoiceTemplateType, InvoicePaperSize } from '../../shared/invoice';

export type { RolePermissions, InvoiceTemplateType, InvoicePaperSize };

export interface Role {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  is_system: number;
  permissions: RolePermissions;
  user_count?: number;
  created_at?: string;
}

export interface User {
  id: number;
  username: string;
  email?: string;
  full_name: string;
  role: string;
  role_display?: string;
  status: 'active' | 'inactive';
  permissions?: RolePermissions;
  created_at?: string;
}

export interface SetupStatusResponse {
  success: boolean;
  isSetupCompleted: boolean;
  developerEmail?: string | null;
  developerKeyConfigured?: boolean;
}

export interface SetupUnlockResponse {
  success: boolean;
  setupToken: string;
  developerEmail: string;
  expiresInMinutes: number;
}

export type LicenseChoice = { mode: 'full' } | { mode: 'demo'; demoDays: number };

export interface SetupCompletePayload {
  setupToken: string;
  storeName: string;
  storeAddress: string;
  admin: { fullName: string; username: string; password: string };
  backup: { dir?: string; frequency: string; time: string; weeklyDay?: number };
  adminPermissions: Record<string, boolean>;
  policies: {
    allow_admin_create_cashier: boolean;
    allow_admin_create_admin: boolean;
    allow_admin_edit_store_identity: boolean;
    allow_admin_hide_store_identity: boolean;
  };
  license: LicenseChoice;
}

export interface LoginResponse {
  success: boolean;
  token: string;
  user: User;
  message?: string;
}

export interface LicenseStatus {
  configured?: boolean;
  mode: 'demo' | 'full' | null;
  expiresAt: string | null;
  daysLeft: number | null;
  expired: boolean;
  reason?: 'ok' | 'expired' | 'missing' | 'tampered';
}

export interface Company {
  id: number;
  code: string;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  status: 'active' | 'inactive';
  product_count?: number;
  created_at?: string;
}

export interface Customer {
  id: number;
  name: string;
  phone?: string;
  address?: string;
  credit_limit: number;
  current_balance: number;
  invoices_count?: number;
  created_at?: string;
}

export interface Product {
  id: number;
  company_id?: number | null;
  c_code: string;
  p_code: string;
  barcode?: string | null;
  name: string;
  generic_name?: string | null;
  unit_type: string;
  packing: number;
  box_trade_price: number;
  box_retail_price: number;
  unit_trade_price: number;
  unit_retail_price: number;
  default_discount_pct: number;
  location_rack?: string | null;
  stock_boxes: number;
  stock_loose: number;
  min_stock_alert: number;
  allow_open_sale?: boolean | number;
  min_sale_qty?: number;
  status: 'active' | 'inactive';
  company_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CartItem {
  product: Product;
  is_loose: boolean; // false = Full Box/Strip, true = Loose Unit
  quantity: number;
  unit_price: number;
  discount_pct: number;
  discount_amount: number;
  gross_amount: number;
  net_amount: number;
  batch_id?: number;
}

export interface SaleInvoice {
  id: number;
  invoice_no: string;
  customer_id?: number | null;
  customer_name: string;
  customer_phone?: string | null;
  user_id?: number | null;
  user_name: string;
  sale_date: string;
  total_gross: number;
  total_item_discount: number;
  bill_discount_pct: number;
  bill_discount_amt: number;
  net_total: number;
  cash_tendered: number;
  change_due: number;
  payment_type: 'Cash' | 'Card' | 'Credit' | 'Online';
  status: 'completed' | 'returned' | 'cancelled';
  notes?: string | null;
  shift_id?: number | null;
  items?: SaleItem[];

  // Phase 3: store identity & developer footer captured when the sale was made (null on older sales)
  store_name_snapshot?: string | null;
  store_address_snapshot?: string | null;
  invoice_footer_snapshot?: string | null;
}

export interface SaleItem {
  id?: number;
  sale_id?: number;
  product_id: number;
  c_code: string;
  p_code: string;
  product_name: string;
  unit_type: string;
  location_rack?: string | null;
  is_loose: number;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  gross_amount: number;
  discount_pct: number;
  discount_amount: number;
  net_amount: number;
  batch_id?: number;
}

export interface PurchaseItem {
  id?: number;
  purchase_id?: number;
  product_id: number;
  product_name: string;
  batch_no: string;
  expiry_date: string;
  quantity_boxes: number;
  bonus_boxes: number;
  box_cost_price: number;
  box_retail_price: number;
  discount_pct: number;
  total_cost: number;
}

export interface PurchaseInvoice {
  id: number;
  invoice_no: string;
  supplier_invoice_no?: string;
  company_id: number;
  company_name: string;
  company_code?: string;
  purchase_date: string;
  total_gross: number;
  discount_amount: number;
  tax_amount: number;
  net_total: number;
  payment_status: 'Paid' | 'Pending' | 'Partial';
  paid_amount?: number;
  notes?: string;
  created_at: string;
  items?: PurchaseItem[];
}


export interface SystemSettings {
  store_name: string;
  store_address: string;
  store_phone: string;
  drug_license_no: string;
  tax_no: string;
  receipt_header: string;
  receipt_footer: string;
  receipt_terms: string;
  currency_symbol: string;
  auto_backup_dir: string;
  auto_backup_enabled: string;
  low_stock_threshold: string;
  paper_width: string;
  max_bill_discount_pct?: string;

  // Requirement 9: Advanced Invoice Settings
  default_invoice_template?: InvoiceTemplateType;
  invoice_paper_size?: InvoicePaperSize;
  return_policy_text?: string;

  // Configurable Field Visibility Flags ('true' | 'false')
  show_store_name?: string;
  show_store_phone?: string;
  show_store_address?: string;
  show_store_license?: string;
  show_invoice_no?: string;
  show_invoice_date?: string;

  show_cashier_name?: string;
  show_customer_name?: string;
  show_customer_phone?: string;

  show_col_product_name?: string;
  show_col_p_code?: string;
  show_col_unit?: string;
  show_col_unit_price?: string;
  show_col_discount?: string;
  show_col_tax?: string;
  show_col_total?: string;

  show_summary_item_count?: string;
  show_summary_gross?: string;
  show_summary_discount?: string;
  show_summary_tax?: string;
  show_summary_net?: string;
  show_summary_received?: string;
  show_summary_change?: string;

  show_terms?: string;
  show_footer_note?: string;
  show_return_policy?: string;
  show_developer_info?: string; // Strictly mandatory 'true'

  [key: string]: string | undefined;
}

export interface CashierShift {
  id: number;
  shift_no: string;
  user_id: number;
  user_name: string;
  start_time: string;
  end_time?: string | null;
  duration_minutes?: number | null;
  opening_cash: number;
  closing_cash?: number | null;
  expected_cash?: number | null;
  cash_difference?: number | null;
  total_sales_count: number;
  total_sales_amount: number;
  total_cash_sales: number;
  total_card_sales: number;
  total_credit_sales: number;
  total_returns_amount: number;
  total_customer_payments: number;
  notes?: string | null;
  status: 'open' | 'closed';
  created_at?: string;
  updated_at?: string;
}

export interface ShiftSummary {
  shift: CashierShift;
  opening_cash: number;
  total_sales_cash: number;
  total_sales_card: number;
  total_sales_credit: number;
  total_returns_cash: number;
  total_customer_payments_cash: number;
  expected_cash: number;
  actual_cash?: number;
  difference?: number;
  invoices_count: number;
  returns_count: number;
  duration_formatted: string;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  module: string;
  details?: string | null;
  affected_user?: string | null;
  status: 'SUCCESS' | 'FAILED';
  user_id?: number | null;
  user_name?: string | null;
  created_at: string;
}

// Phase 4: Developer-controlled automatic backup frequency
export type BackupFrequency = 'off' | 'twice_daily' | 'daily' | 'weekly';

export interface BackupStatus {
  frequency: BackupFrequency;
  scheduled_time: string;
  weekly_day: number;
  enabled: boolean;
  next_run_at: string | null;
  is_overdue: boolean;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_status: 'success' | 'failed' | null;
  last_error: string | null;
  last_type: string | null;
  last_backup_file: string | null;
  retention_limit: number;
  retained_count: number;
  pre_restore_keep: number;
}

export interface DeveloperSettingsPayload {
  backup_retention_limit: string;
  backup_frequency: string;
  backup_scheduled_time?: string;
  backup_weekly_day?: string;
  allow_admin_create_cashier: string;
  allow_admin_create_admin: string;
  allow_admin_edit_store_identity: string;
  allow_admin_hide_store_identity: string;
  store_name: string;
  store_address: string;
  developer_invoice_footer: string;
  developer_email?: string;
}

export interface ElectronAPI {
  printThermal: (options?: { silent?: boolean; printerName?: string; paperWidthMm?: 58 | 80 }) => Promise<{ success: boolean; error?: string }>;
  selectBackupDir: () => Promise<string | null>;
  selectRestoreFile: () => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
