export interface RolePermissions {
  // Module Visibility
  dashboard: boolean;
  pos: boolean;
  sales: boolean;
  khata: boolean;
  masters: boolean;
  purchases: boolean;
  reports: boolean;
  utilities: boolean;
  settings: boolean;
  shifts: boolean; // Admin Shift Management page

  // Granular Actions
  can_add_product: boolean;
  can_edit_product: boolean;
  can_delete_product: boolean;
  can_add_company: boolean;
  can_edit_company: boolean;
  can_delete_company: boolean;
  can_delete_invoice: boolean;
  can_return_sale: boolean;
  can_view_all_sales: boolean;
  can_view_financial_kpis: boolean;
  can_add_purchase: boolean;
  can_add_customer: boolean;
  can_receive_payment: boolean;
  can_edit_customer: boolean;
  can_delete_customer: boolean;
  can_discount: boolean;
  can_backup: boolean;
  can_restore: boolean;
  can_shift_close: boolean;
  can_manage_shifts: boolean;
  can_stock_zero: boolean;
  can_manage_users: boolean;
  can_manage_roles: boolean;
}

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
  full_name: string;
  role: string;
  role_display?: string;
  status: 'active' | 'inactive';
  permissions?: RolePermissions;
  created_at?: string;
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

export interface CustomerPayment {
  id: number;
  customer_id: number;
  amount: number;
  payment_method: 'Cash' | 'Card' | 'Online';
  notes?: string;
  shift_id?: number | null;
  payment_date: string;
}

export interface ProductBatch {
  id: number;
  product_id: number;
  batch_no: string;
  expiry_date: string;
  purchase_cost: number;
  retail_price: number;
  quantity_boxes: number;
  quantity_loose: number;
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
  [key: string]: string | undefined;
}

export interface DailyClosing {
  id?: number;
  closing_date: string;
  opening_time?: string;
  closing_time?: string;
  user_name?: string;
  opening_cash: number;
  total_sales_cash: number;
  total_sales_card: number;
  total_sales_credit: number;
  total_returns: number;
  total_purchases_paid: number;
  expenses_total: number;
  expected_cash: number;
  actual_cash: number;
  difference: number;
  notes?: string;
  is_closed: number;
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
