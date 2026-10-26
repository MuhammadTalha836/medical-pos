import type { MedicineSchedule } from '../../shared/schedule';
export type { MedicineSchedule, PrescriptionInput } from '../../shared/schedule';
import type { RolePermissions } from '../../shared/permissions';
import type { InvoiceTemplate as InvoiceTemplateType, InvoicePaperSize } from '../../shared/invoice';
import type { BackupMode } from '../../shared/backup';
export type { BackupMode };

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
  /** This build can upload backups to Google Drive */
  onlineBackupAvailable?: boolean;
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
  backup: { dir?: string; mode?: BackupMode; frequency: string; time: string; weeklyDay?: number };
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
  /** Sum of the customer's non-returned invoices */
  total_purchases?: number;
  total_credit_sales?: number;
  total_payments?: number;
  created_at?: string;
  /** Loyalty (M10) */
  loyalty_points?: number;
  loyalty_plan_id?: number | null;
  loyalty_plan_name?: string | null;
  /** Only in the POS search while loyalty is on: the customer's plan (or the default plan) */
  loyalty_plan?: LoyaltyPlan | null;
  points_value?: number;
}

/** One invoice in a customer's history (GET /api/customers/:id/ledger) */
export interface CustomerInvoiceRow {
  id: number;
  invoice_no: string;
  sale_date: string;
  net_total: number;
  payment_type: string;
  status: string;
  items_count: number;
}

/** One khata payment received from a customer */
export interface CustomerPaymentRow {
  id: number;
  amount: number;
  payment_method: string;
  notes: string | null;
  previous_balance: number;
  new_balance: number;
  payment_date: string;
  user_name?: string | null;
}

export interface CustomerLedger {
  customer: Customer;
  sales: CustomerInvoiceRow[];
  payments: CustomerPaymentRow[];
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
  schedule?: MedicineSchedule;
  status: 'active' | 'inactive';
  company_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SubstitutesResult {
  product: { id: number; name: string; generic_name: string | null };
  substitutes: Product[];
}

export interface ControlledRegisterRow {
  id: number;
  sale_id: number;
  invoice_no: string;
  sale_date: string;
  sale_status: string;
  product_id: number;
  product_name: string;
  quantity: number;
  is_loose: boolean;
  returned_qty: number;
  patient_name: string;
  patient_phone: string | null;
  patient_cnic: string | null;
  doctor_name: string;
  doctor_reg_no: string | null;
  prescription_no: string;
  notes: string | null;
  user_name: string | null;
  created_at: string;
}

export interface Expense {
  id: number;
  category: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'cheque' | 'online';
  reference: string | null;
  notes: string | null;
  expense_date: string;
  shift_id: number | null;
  shift_no: string | null;
  user_id: number | null;
  user_name: string | null;
  created_at: string;
  /** Why it cannot be changed (closed day or closed shift), or null */
  locked_reason: string | null;
}

export interface ExpenseList {
  expenses: Expense[];
  total: number;
  categories: string[];
  closed_dates: string[];
  sees_all: boolean;
}

export interface ExpenseInput {
  category: string;
  amount: number;
  payment_method: Expense['payment_method'];
  expense_date: string;
  reference?: string;
  notes?: string;
}

export interface DayCloseFigures {
  invoices_count: number;
  sales_total: number;
  sales_cash: number;
  sales_card: number;
  sales_credit: number;
  returns_count: number;
  returns_total: number;
  net_sales: number;
  cost_of_goods: number;
  gross_profit: number;
  expenses_total: number;
  expenses_cash: number;
  expenses_by_category: { category: string; amount: number; count: number }[];
  net_profit: number;
  customer_payments_cash: number;
  supplier_paid: number;
  shifts: { count: number; open_count: number; opening_cash: number; expected_cash: number; counted_cash: number; difference: number };
}

export interface DayClosing {
  date: string;
  is_closed: boolean;
  closing_time: string | null;
  user_name: string | null;
  /** Closed by the midnight run, not by a person */
  auto_closed: boolean;
  notes: string | null;
  invoices_count: number;
  sales_cash: number;
  sales_card: number;
  sales_credit: number;
  returns_total: number;
  cost_of_goods: number;
  expenses_total: number;
  net_profit: number;
  supplier_paid: number;
  customer_payments_cash: number;
  opening_cash: number;
  expected_cash: number;
  counted_cash: number;
  difference: number;
  open_shifts_at_close: number;
}

export interface DayCloseReport {
  date: string;
  today: string;
  figures: DayCloseFigures;
  closing: DayClosing | null;
  open_shifts: { shift_no: string; user_name: string; day: string }[];
  can_close: boolean;
}

export interface DayCloseRangeDay {
  date: string;
  invoices_count: number;
  sales_total: number;
  returns_total: number;
  net_sales: number;
  cost_of_goods: number;
  gross_profit: number;
  expenses_total: number;
  net_profit: number;
  closing: { is_closed: boolean; auto_closed: boolean; user_name: string | null } | null;
}

export interface DayCloseRange {
  from: string;
  to: string;
  totals: DayCloseFigures;
  days: DayCloseRangeDay[];
  open_shifts: { shift_no: string; user_name: string; day: string }[];
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
  status: 'completed' | 'partially_returned' | 'returned' | 'cancelled';
  notes?: string | null;
  shift_id?: number | null;
  items?: SaleItem[];

  // Phase 3: store identity & developer footer captured when the sale was made (null on older sales)
  store_name_snapshot?: string | null;
  store_address_snapshot?: string | null;
  invoice_footer_snapshot?: string | null;

  // Loyalty (M10)
  member_discount_pct?: number;
  member_discount_amt?: number;
  points_redeemed?: number;
  points_redeemed_value?: number;
  points_earned?: number;
  loyalty_plan_name?: string | null;
  points_balance?: number | null;
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
  /** Already returned from this line (invoice details only) */
  returned_qty?: number;
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
  /** Purchase details only: boxes already sent back, and still returnable (bought + bonus − returned) */
  returned_boxes?: number;
  returnable_boxes?: number;
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
  /** Still owed on this bill after payments and returns (purchase list only) */
  amount_due?: number;
  notes?: string;
  created_at: string;
  items?: PurchaseItem[];
}

/** One supplier (company) with what the store owes it */
export interface SupplierSummary {
  id: number;
  code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  status: string;
  total_purchased: number;
  total_paid: number;
  total_returned: number;
  balance: number;
  unpaid_bills: number;
  last_purchase_date: string | null;
}

/** One batch of a medicine (Medicines → Batches) */
export interface ProductBatchRow {
  id: number;
  batch_no: string;
  expiry_date: string;
  quantity_boxes: number;
  quantity_loose: number;
  units: number;
  purchase_cost: number;
  status: 'expired' | 'near' | 'ok' | 'no_expiry';
  created_at: string;
}

/** One medicine on the reorder (short) list */
export interface ReorderItem {
  product_id: number;
  name: string;
  generic_name: string | null;
  company_id: number | null;
  company_name: string;
  company_phone: string | null;
  packing: number;
  unit_type: string;
  stock_boxes: number;
  stock_loose: number;
  min_stock_alert: number;
  sold_30d_units: number;
  avg_daily_units: number;
  days_left: number | null;
  reason: 'below_minimum' | 'running_out';
  suggested_boxes: number;
  box_trade_price: number;
  box_retail_price: number;
  estimated_cost: number;
}

export interface ReorderList {
  cover_days: number;
  generated_at: string;
  items: ReorderItem[];
}

/** A return of goods to a supplier (or an expiry claim) */
export interface PurchaseReturnSummary {
  id: number;
  return_no: string;
  company_id: number;
  company_name: string;
  purchase_invoice_no: string | null;
  return_date: string;
  total_credit: number;
  reason: string | null;
  is_expiry_claim: boolean;
  items_count: number;
  user_name: string | null;
}

export interface PurchaseReturnDetails extends Omit<PurchaseReturnSummary, 'items_count'> {
  company_code: string;
  company_phone: string | null;
  supplier_invoice_no: string | null;
  items: Array<{ id: number; product_id: number; product_name: string; p_code: string; batch_no: string | null; quantity_boxes: number; rate: number; credit: number }>;
}

/** Expired or near-expiry stock that can be claimed back from its supplier */
export interface ExpiryCandidate {
  batch_id: number;
  product_id: number;
  product_name: string;
  company_id: number;
  company_name: string;
  batch_no: string;
  expiry_date: string;
  expired: boolean;
  days_left: number;
  boxes: number;
  purchase_item_id: number | null;
  rate: number;
  credit: number;
}

export interface PurchaseReturnLineInput {
  product_id: number;
  quantity_boxes: number;
  purchase_item_id?: number | null;
  batch_no?: string | null;
}

export type SupplierPaymentMethod = 'cash' | 'bank' | 'cheque' | 'online';

export interface SupplierLedgerEntry {
  date: string;
  kind: 'purchase' | 'paid_with_purchase' | 'payment' | 'return';
  reference: string;
  details: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface SupplierLedger {
  supplier: { id: number; code: string; name: string; phone: string | null; address: string | null; contact_person: string | null };
  totals: { purchased: number; paid: number; returned: number; balance: number };
  dues: Array<{
    id: number;
    invoice_no: string;
    supplier_invoice_no: string | null;
    date: string;
    net_total: number;
    settled: number;
    due: number;
    status: 'Paid' | 'Partial' | 'Pending';
  }>;
  entries: SupplierLedgerEntry[];
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
  /** Days of sales a reorder should cover (Purchases → Reorder) */
  reorder_cover_days?: string;
  auto_day_close?: string;
  // Loyalty (M10): the Developer's gate and the Admin's switch
  loyalty_feature_allowed?: string;
  loyalty_enabled?: string;
  whatsapp_receipt_template?: string;
  whatsapp_reminder_template?: string;

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
  /** Shop expenses paid out of the drawer during the shift */
  total_expenses_cash?: number;
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
  total_expenses_cash?: number;
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
  cloud: {
    mode: BackupMode;
    connected: boolean;
    account_email: string | null;
    last_upload_at: string | null;
    last_error: string | null;
    pending_count: number;
    next_retry_at: string | null;
  };
}

/** Google Drive sign-in started from the app (polled until connected or failed) */
export type CloudConnectProgress =
  | { status: 'idle' }
  | { status: 'waiting'; startedAt: string }
  | { status: 'connected'; email: string }
  | { status: 'failed'; error: string };

export interface CloudBackupStatus {
  mode: BackupMode;
  /** This build can upload to Google Drive */
  available: boolean;
  connected: boolean;
  account_email: string | null;
  connected_at: string | null;
  last_upload_at: string | null;
  last_upload_file: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  pending_count: number;
  next_retry_at: string | null;
  connect: CloudConnectProgress;
}

export interface CloudBackupFile {
  id: string;
  name: string;
  size: number;
  createdTime: string;
  checksum: string | null;
}

export interface DeveloperSettingsPayload {
  backup_retention_limit: string;
  backup_mode?: BackupMode;
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
  /** Developer profile keys (shared/developerProfile.ts) */
  [key: string]: string | undefined;
}

export interface PrinterInfo {
  name: string;
  displayName: string;
}

export interface ThermalPrintOptions {
  /** A complete HTML document holding the receipt (#thermal-receipt-printable) */
  html: string;
  silent?: boolean;
  printerName?: string;
  paperWidthMm?: 58 | 80;
}

export interface ElectronAPI {
  printThermal: (options: ThermalPrintOptions) => Promise<{ success: boolean; error?: string }>;
  listPrinters: () => Promise<PrinterInfo[]>;
  selectBackupDir: () => Promise<string | null>;
  selectRestoreFile: () => Promise<string | null>;
  /** Opens the Google sign-in page for online backups in the system browser */
  openCloudSignIn: (url: string) => Promise<boolean>;
  /** Opens a https://wa.me/ link (message ready to send) in WhatsApp */
  openWhatsApp: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/** A physical stock count (M9) */
export interface StockCount {
  id: number;
  count_no: string;
  title: string | null;
  notes: string | null;
  company_id: number | null;
  status: 'open' | 'applied' | 'cancelled';
  user_name: string | null;
  applied_at: string | null;
  applied_by: string | null;
  created_at: string;
  items_count?: number;
  counted_count?: number;
  differences_count?: number;
}

export interface StockCountLine {
  id: number;
  product_id: number;
  product_name: string;
  p_code: string | null;
  barcode: string | null;
  location_rack: string | null;
  unit_type: string;
  packing: number;
  unit_cost: number;
  missing: boolean;
  current_units: number;
  system_units: number;
  counted_units: number | null;
  difference_units: number | null;
  difference_value: number;
  counted_at: string | null;
  user_name: string | null;
}

export interface StockCountDetail extends StockCount {
  items: StockCountLine[];
  totals: { loss_value: number; gain_value: number; net_value: number; differences_count: number };
}

export interface StockAdjustmentRow {
  id: number;
  product_id: number;
  product_name: string;
  packing: number;
  unit_type: string;
  delta_units: number;
  stock_before: number;
  stock_after: number;
  reason: string;
  notes: string | null;
  batch_no: string | null;
  unit_cost: number;
  value: number;
  count_id: number | null;
  user_name: string | null;
  created_at: string;
}

export interface StockAdjustmentList {
  adjustments: StockAdjustmentRow[];
  totals: { count: number; loss_units: number; gain_units: number; loss_value: number; gain_value: number; net_value: number };
}

export interface StockAdjustInput {
  reason: string;
  direction: 'in' | 'out';
  boxes: number;
  loose: number;
  batch_id?: number | null;
  notes?: string;
}

/** A loyalty plan (M10); the same fields describe a ready-made template */
export interface LoyaltyPlan {
  id: number;
  name: string;
  points_per_100: number;
  point_value: number;
  min_bill_to_earn: number;
  discount_pct: number;
  min_redeem_points: number;
  max_redeem_pct: number;
  expiry_months: number;
  earn_on_credit: boolean;
  upgrade_spend: number;
  is_default: boolean;
  status: 'active' | 'archived';
  members?: number;
}

export type LoyaltyPlanInput = Omit<LoyaltyPlan, 'id' | 'status' | 'members'>;

export interface LoyaltyTemplate extends Omit<LoyaltyPlanInput, 'is_default'> {
  key: string;
  description: string;
}

export interface LoyaltyHistoryRow {
  id: number;
  type: 'earn' | 'redeem' | 'earn_reversed' | 'redeem_refunded' | 'adjust' | 'expire' | 'plan_change';
  points: number;
  remaining: number;
  expires_at: string | null;
  invoice_no: string | null;
  notes: string | null;
  user_name: string | null;
  created_at: string;
}

export interface CustomerLoyalty {
  customer_id: number;
  name: string;
  points: number;
  points_value: number;
  plan: LoyaltyPlan | null;
  plan_assigned: boolean;
  spend_12m: number;
  expiring_30d: number;
  active: boolean;
  history: LoyaltyHistoryRow[];
}

export interface LoyaltyMember {
  id: number;
  name: string;
  phone: string | null;
  plan_id: number | null;
  plan_name: string | null;
  points: number;
  points_value: number;
  last_activity: string | null;
}

export interface LoyaltyMembers {
  members: LoyaltyMember[];
  totals: { members: number; points: number; value: number };
}
