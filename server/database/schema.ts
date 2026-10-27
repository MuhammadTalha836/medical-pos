export const SCHEMA_SQL = `
-- Enable Foreign Keys and WAL Mode
PRAGMA foreign_keys = ON;

-- 0. Roles & Granular Permissions
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER DEFAULT 0,
  permissions TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 1. Users & Authentication
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  status TEXT NOT NULL DEFAULT 'active',
  totp_secret TEXT,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Companies (Manufacturers / Suppliers)
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL, -- e.g., 'GSK', 'ABT', 'SEARLE', 'GETZ'
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Products
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  c_code TEXT NOT NULL, -- Company Code
  p_code TEXT UNIQUE NOT NULL, -- Product Code / Barcode (e.g., 'PAN-500', 'AUG-625')
  barcode TEXT,
  name TEXT NOT NULL,
  generic_name TEXT, -- Generic Formula (e.g. 'Paracetamol 500mg')
  unit_type TEXT NOT NULL DEFAULT 'Tablets', -- 'Tablets', 'Capsules', 'Syrup', 'Suspension', 'Injection', 'Drops', 'Sachet', 'Ointment', 'Inhaler'
  packing INTEGER NOT NULL DEFAULT 1, -- Units per box/strip (e.g. 100 tablets per box)
  box_trade_price REAL NOT NULL DEFAULT 0.0, -- T-Price on the box
  box_retail_price REAL NOT NULL DEFAULT 0.0, -- Retail price on box
  unit_trade_price REAL NOT NULL DEFAULT 0.0, -- Cost per single unit
  unit_retail_price REAL NOT NULL DEFAULT 0.0, -- PP Unit (selling price for loose/strip unit)
  default_discount_pct REAL NOT NULL DEFAULT 0.0, -- Retail price discount %
  location_rack TEXT, -- Location / Rack identifier (e.g. 'A-12', 'Shelf-3')
  stock_boxes INTEGER NOT NULL DEFAULT 0, -- Stock count in whole boxes
  stock_loose INTEGER NOT NULL DEFAULT 0, -- Loose units count (0 to packing-1)
  min_stock_alert INTEGER NOT NULL DEFAULT 10, -- Low stock alert threshold
  allow_open_sale INTEGER NOT NULL DEFAULT 1, -- 1 = Yes (Allow loose unit sales), 0 = No (Full pack only)
  min_sale_qty INTEGER NOT NULL DEFAULT 1, -- Smallest quantity permitted per sale
  schedule TEXT NOT NULL DEFAULT 'none', -- 'none' | 'rx' (prescription reminder) | 'controlled' (register required)
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Product Batches (Batch & Expiry tracking)
CREATE TABLE IF NOT EXISTS product_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_no TEXT NOT NULL,
  expiry_date TEXT NOT NULL, -- YYYY-MM-DD
  purchase_cost REAL NOT NULL DEFAULT 0.0,
  retail_price REAL NOT NULL DEFAULT 0.0,
  quantity_boxes INTEGER NOT NULL DEFAULT 0,
  quantity_loose INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Customers
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  credit_limit REAL DEFAULT 0.0,
  current_balance REAL DEFAULT 0.0,
  loyalty_plan_id INTEGER,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5b. Customer Payments (Khata Recoveries)
CREATE TABLE IF NOT EXISTS customer_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  notes TEXT,
  previous_balance REAL NOT NULL,
  new_balance REAL NOT NULL,
  user_name TEXT,
  shift_id INTEGER REFERENCES cashier_shifts(id),
  payment_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Sales Invoices
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT DEFAULT 'Counter Customer',
  customer_phone TEXT,
  user_id INTEGER REFERENCES users(id),
  user_name TEXT,
  sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_gross REAL NOT NULL DEFAULT 0.0,
  total_item_discount REAL NOT NULL DEFAULT 0.0,
  bill_discount_pct REAL NOT NULL DEFAULT 0.0,
  bill_discount_amt REAL NOT NULL DEFAULT 0.0,
  net_total REAL NOT NULL DEFAULT 0.0,
  cash_tendered REAL NOT NULL DEFAULT 0.0,
  change_due REAL NOT NULL DEFAULT 0.0,
  payment_type TEXT NOT NULL DEFAULT 'Cash', -- 'Cash', 'Card', 'Credit'
  status TEXT NOT NULL DEFAULT 'completed', -- 'completed', 'partially_returned', 'returned', 'cancelled'
  notes TEXT,
  shift_id INTEGER REFERENCES cashier_shifts(id),
  store_name_snapshot TEXT,
  store_address_snapshot TEXT,
  invoice_footer_snapshot TEXT,
  member_discount_pct REAL NOT NULL DEFAULT 0.0,
  member_discount_amt REAL NOT NULL DEFAULT 0.0,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  points_redeemed_value REAL NOT NULL DEFAULT 0.0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  loyalty_plan_name TEXT,
  points_balance INTEGER,
  terminal_id INTEGER,
  terminal_name TEXT,
  client_request_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. Sale Items
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  c_code TEXT NOT NULL,
  p_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  location_rack TEXT,
  is_loose INTEGER NOT NULL DEFAULT 0, -- 0 = Box/Pack, 1 = Loose unit
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL, -- For exact P&L calculation
  gross_amount REAL NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0.0,
  discount_amount REAL NOT NULL DEFAULT 0.0,
  net_amount REAL NOT NULL,
  batch_id INTEGER REFERENCES product_batches(id)
);

-- 8. Sale Returns
CREATE TABLE IF NOT EXISTS sale_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no TEXT UNIQUE NOT NULL,
  sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  original_invoice_no TEXT,
  customer_name TEXT,
  refund_amount REAL NOT NULL DEFAULT 0.0,
  reason TEXT,
  user_id INTEGER REFERENCES users(id),
  user_name TEXT,
  shift_id INTEGER REFERENCES cashier_shifts(id),
  terminal_id INTEGER,
  terminal_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. Sale Return Items
CREATE TABLE IF NOT EXISTS sale_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  is_loose INTEGER NOT NULL DEFAULT 0,
  quantity REAL NOT NULL,
  unit_refund_price REAL NOT NULL,
  total_refund REAL NOT NULL
);

-- 10. Purchase Invoices (Supplier Inward)
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,
  supplier_invoice_no TEXT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  company_name TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  total_gross REAL NOT NULL DEFAULT 0.0,
  discount_amount REAL NOT NULL DEFAULT 0.0,
  tax_amount REAL NOT NULL DEFAULT 0.0,
  net_total REAL NOT NULL DEFAULT 0.0,
  payment_status TEXT NOT NULL DEFAULT 'Paid', -- 'Paid', 'Pending', 'Partial'
  paid_amount REAL NOT NULL DEFAULT 0.0,
  user_id INTEGER REFERENCES users(id),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. Purchase Items
CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  batch_no TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  quantity_boxes INTEGER NOT NULL,
  bonus_boxes INTEGER NOT NULL DEFAULT 0,
  box_cost_price REAL NOT NULL,
  box_retail_price REAL NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0.0,
  total_cost REAL NOT NULL
);

-- 12. Purchase Returns
CREATE TABLE IF NOT EXISTS purchase_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no TEXT UNIQUE NOT NULL,
  purchase_id INTEGER REFERENCES purchases(id),
  company_id INTEGER NOT NULL REFERENCES companies(id),
  company_name TEXT NOT NULL,
  return_date DATE NOT NULL,
  total_refund REAL NOT NULL DEFAULT 0.0,
  reason TEXT,
  is_expiry_claim INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER,
  user_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. Purchase Return Items
CREATE TABLE IF NOT EXISTS purchase_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT,
  purchase_item_id INTEGER REFERENCES purchase_items(id),
  batch_no TEXT,
  quantity_boxes INTEGER NOT NULL,
  box_cost_price REAL NOT NULL,
  total_refund REAL NOT NULL
);

-- Which batches each sale line was taken from (FEFO), so returns go back to the same batch
CREATE TABLE IF NOT EXISTS sale_item_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  batch_id INTEGER NOT NULL REFERENCES product_batches(id) ON DELETE CASCADE,
  units INTEGER NOT NULL,
  returned_units INTEGER NOT NULL DEFAULT 0
);

-- Controlled-medicine register: one row per controlled sale line, with the prescription details
CREATE TABLE IF NOT EXISTS prescription_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  is_loose INTEGER NOT NULL DEFAULT 0,
  patient_name TEXT NOT NULL,
  patient_phone TEXT,
  patient_cnic TEXT,
  doctor_name TEXT NOT NULL,
  doctor_reg_no TEXT,
  prescription_no TEXT NOT NULL,
  notes TEXT,
  user_id INTEGER,
  user_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Payments to suppliers (distributors) against what the store owes them
CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  notes TEXT,
  payment_date TEXT NOT NULL,
  user_id INTEGER,
  user_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14. Daily Closings
CREATE TABLE IF NOT EXISTS daily_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  closing_date TEXT UNIQUE NOT NULL, -- YYYY-MM-DD
  opening_time DATETIME NOT NULL,
  closing_time DATETIME,
  user_id INTEGER REFERENCES users(id),
  user_name TEXT,
  opening_cash REAL NOT NULL DEFAULT 0.0,
  total_sales_cash REAL NOT NULL DEFAULT 0.0,
  total_sales_card REAL NOT NULL DEFAULT 0.0,
  total_sales_credit REAL NOT NULL DEFAULT 0.0,
  total_returns REAL NOT NULL DEFAULT 0.0,
  total_purchases_paid REAL NOT NULL DEFAULT 0.0,
  expenses_total REAL NOT NULL DEFAULT 0.0,
  expected_cash REAL NOT NULL DEFAULT 0.0,
  actual_cash REAL NOT NULL DEFAULT 0.0,
  difference REAL NOT NULL DEFAULT 0.0,
  invoices_count INTEGER NOT NULL DEFAULT 0,
  total_cost_of_goods REAL NOT NULL DEFAULT 0.0,
  customer_payments_cash REAL NOT NULL DEFAULT 0.0,
  net_profit REAL NOT NULL DEFAULT 0.0,
  open_shifts_at_close INTEGER NOT NULL DEFAULT 0,
  auto_closed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_closed INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14b. Shop expenses (M8). expense_date is the local calendar day; cash expenses paid during a shift carry its id
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  notes TEXT,
  expense_date TEXT NOT NULL,
  shift_id INTEGER REFERENCES cashier_shifts(id),
  user_id INTEGER,
  user_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14c. Stock counts and adjustments (M9). Product ids carry no foreign key: the history outlives a deleted medicine.
-- A count changes nothing until it is applied; every stock change outside sales and purchases is a stock_adjustments row.
CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_no TEXT NOT NULL UNIQUE,
  title TEXT,
  notes TEXT,
  company_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  user_id INTEGER,
  user_name TEXT,
  applied_at DATETIME,
  applied_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  system_units INTEGER NOT NULL DEFAULT 0,
  counted_units INTEGER,
  counted_at DATETIME,
  user_name TEXT,
  UNIQUE (count_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  delta_units INTEGER NOT NULL,
  stock_before INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  batch_id INTEGER,
  unit_cost REAL NOT NULL DEFAULT 0.0,
  count_id INTEGER,
  user_id INTEGER,
  user_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14d. Loyalty (M10). Plans hold the rules; loyalty_transactions is the points ledger. customers.loyalty_points is
-- the balance, recomputed from the ledger in the same transaction. remaining = unused points of a plus row (oldest first, expiry).
CREATE TABLE IF NOT EXISTS loyalty_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  points_per_100 REAL NOT NULL DEFAULT 1.0,
  point_value REAL NOT NULL DEFAULT 1.0,
  min_bill_to_earn REAL NOT NULL DEFAULT 0.0,
  discount_pct REAL NOT NULL DEFAULT 0.0,
  min_redeem_points INTEGER NOT NULL DEFAULT 0,
  max_redeem_pct REAL NOT NULL DEFAULT 100.0,
  expiry_months INTEGER NOT NULL DEFAULT 0,
  earn_on_credit INTEGER NOT NULL DEFAULT 0,
  upgrade_spend REAL NOT NULL DEFAULT 0.0,
  is_default INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_id INTEGER,
  sale_return_id INTEGER,
  type TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  remaining INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  notes TEXT,
  user_id INTEGER,
  user_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14e. LAN terminals (M11): the main computer (is_server = 1) and every paired counter PC.
-- Only the SHA-256 of a counter's key is stored; a revoked counter is refused at once.
CREATE TABLE IF NOT EXISTS terminals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE,
  is_server INTEGER NOT NULL DEFAULT 0,
  paired_at DATETIME,
  last_seen_at DATETIME,
  last_ip TEXT,
  app_version TEXT,
  revoked_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 15. System Settings
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 16. Backup History
CREATE TABLE IF NOT EXISTS backup_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_filename TEXT NOT NULL,
  backup_path TEXT NOT NULL,
  backup_type TEXT NOT NULL, -- 'manual', 'scheduled', 'shift_close', 'pre_restore' (legacy: 'auto_daily')
  file_size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'success', -- 'success', 'failed'
  checksum_sha256 TEXT,
  verified INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  secondary_path TEXT,
  cloud_status TEXT, -- online copy: 'pending', 'uploaded', 'skipped' (a newer backup was uploaded instead); NULL = offline only
  cloud_file_id TEXT,
  cloud_uploaded_at DATETIME,
  cloud_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 17. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  details TEXT,
  affected_user TEXT,
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  user_id INTEGER REFERENCES users(id),
  user_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 18. Cashier Shifts
CREATE TABLE IF NOT EXISTS cashier_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_no TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  user_name TEXT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME,
  duration_minutes INTEGER,
  opening_cash REAL NOT NULL DEFAULT 0.0,
  closing_cash REAL,
  expected_cash REAL,
  cash_difference REAL,
  total_sales_count INTEGER DEFAULT 0,
  total_sales_amount REAL DEFAULT 0.0,
  total_cash_sales REAL DEFAULT 0.0,
  total_card_sales REAL DEFAULT 0.0,
  total_credit_sales REAL DEFAULT 0.0,
  total_returns_amount REAL DEFAULT 0.0,
  total_customer_payments REAL DEFAULT 0.0,
  total_expenses_cash REAL DEFAULT 0.0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  terminal_id INTEGER,
  terminal_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_products_c_code ON products(c_code);
CREATE INDEX IF NOT EXISTS idx_products_p_code ON products(p_code);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON sales(invoice_no);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON product_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_shifts_user_status ON cashier_shifts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_shifts_shift_no ON cashier_shifts(shift_no);
CREATE INDEX IF NOT EXISTS idx_shifts_start_time ON cashier_shifts(start_time);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_company ON supplier_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_batches_item ON sale_item_batches(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_prescription_records_sale ON prescription_records(sale_id);
CREATE INDEX IF NOT EXISTS idx_prescription_records_created ON prescription_records(created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_shift ON expenses(shift_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_created ON stock_adjustments(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product ON stock_adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON stock_count_items(count_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_customer ON loyalty_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_sale ON loyalty_transactions(sale_id);
`;

/**
 * Columns added after the first release. Databases created before a column existed get it on startup;
 * new databases already have it from SCHEMA_SQL. To add a column: put it in the CREATE TABLE above, add it
 * here, add it to prisma/schema.prisma, and run `npm run prisma:generate`.
 */
/** Indexes on columns that COLUMN_MIGRATIONS may have just added (run after them) */
export const POST_MIGRATION_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request ON sales(client_request_id);
CREATE INDEX IF NOT EXISTS idx_sales_terminal ON sales(terminal_id);
`;

/**
 * One open shift per user, enforced by the database (two counters may press Start Shift together). Kept apart from
 * POST_MIGRATION_SQL: an older database that already holds two open shifts for one user cannot take it until one
 * of them is closed, and that must not stop the app from starting.
 */
export const ONE_OPEN_SHIFT_INDEX_SQL =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open ON cashier_shifts(user_id) WHERE status = 'open';";

export const COLUMN_MIGRATIONS: Array<{ table: string; column: string; definition: string }> = [
  { table: 'sales', column: 'shift_id', definition: 'INTEGER REFERENCES cashier_shifts(id)' },
  { table: 'sale_returns', column: 'shift_id', definition: 'INTEGER REFERENCES cashier_shifts(id)' },
  { table: 'customer_payments', column: 'shift_id', definition: 'INTEGER REFERENCES cashier_shifts(id)' },
  { table: 'products', column: 'allow_open_sale', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'products', column: 'min_sale_qty', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'users', column: 'email', definition: 'TEXT' },
  { table: 'users', column: 'totp_secret', definition: 'TEXT' },
  { table: 'users', column: 'failed_login_attempts', definition: 'INTEGER DEFAULT 0' },
  { table: 'users', column: 'locked_until', definition: 'DATETIME' },
  { table: 'audit_logs', column: 'affected_user', definition: 'TEXT' },
  { table: 'audit_logs', column: 'status', definition: "TEXT DEFAULT 'SUCCESS'" },
  { table: 'sales', column: 'store_name_snapshot', definition: 'TEXT' },
  { table: 'sales', column: 'store_address_snapshot', definition: 'TEXT' },
  { table: 'sales', column: 'invoice_footer_snapshot', definition: 'TEXT' },
  { table: 'backup_history', column: 'checksum_sha256', definition: 'TEXT' },
  { table: 'backup_history', column: 'verified', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'backup_history', column: 'error_message', definition: 'TEXT' },
  { table: 'backup_history', column: 'secondary_path', definition: 'TEXT' },
  { table: 'backup_history', column: 'cloud_status', definition: 'TEXT' },
  { table: 'backup_history', column: 'cloud_file_id', definition: 'TEXT' },
  { table: 'backup_history', column: 'cloud_uploaded_at', definition: 'DATETIME' },
  { table: 'backup_history', column: 'cloud_error', definition: 'TEXT' },
  { table: 'purchase_returns', column: 'is_expiry_claim', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'purchase_returns', column: 'user_id', definition: 'INTEGER' },
  { table: 'purchase_returns', column: 'user_name', definition: 'TEXT' },
  { table: 'purchase_return_items', column: 'product_name', definition: 'TEXT' },
  { table: 'purchase_return_items', column: 'purchase_item_id', definition: 'INTEGER REFERENCES purchase_items(id)' },
  { table: 'purchase_return_items', column: 'batch_no', definition: 'TEXT' },
  { table: 'products', column: 'schedule', definition: "TEXT NOT NULL DEFAULT 'none'" },
  { table: 'cashier_shifts', column: 'total_expenses_cash', definition: 'REAL DEFAULT 0.0' },
  { table: 'daily_closings', column: 'invoices_count', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'daily_closings', column: 'total_cost_of_goods', definition: 'REAL NOT NULL DEFAULT 0.0' },
  { table: 'daily_closings', column: 'customer_payments_cash', definition: 'REAL NOT NULL DEFAULT 0.0' },
  { table: 'daily_closings', column: 'net_profit', definition: 'REAL NOT NULL DEFAULT 0.0' },
  { table: 'daily_closings', column: 'open_shifts_at_close', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'daily_closings', column: 'auto_closed', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'customers', column: 'loyalty_plan_id', definition: 'INTEGER' },
  { table: 'customers', column: 'loyalty_points', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'sales', column: 'member_discount_pct', definition: 'REAL NOT NULL DEFAULT 0.0' },
  { table: 'sales', column: 'member_discount_amt', definition: 'REAL NOT NULL DEFAULT 0.0' },
  { table: 'sales', column: 'points_redeemed', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'sales', column: 'points_redeemed_value', definition: 'REAL NOT NULL DEFAULT 0.0' },
  { table: 'sales', column: 'points_earned', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'sales', column: 'loyalty_plan_name', definition: 'TEXT' },
  { table: 'sales', column: 'points_balance', definition: 'INTEGER' },
  { table: 'sales', column: 'terminal_id', definition: 'INTEGER' },
  { table: 'sales', column: 'terminal_name', definition: 'TEXT' },
  { table: 'sales', column: 'client_request_id', definition: 'TEXT' },
  { table: 'sale_returns', column: 'terminal_id', definition: 'INTEGER' },
  { table: 'sale_returns', column: 'terminal_name', definition: 'TEXT' },
  { table: 'cashier_shifts', column: 'terminal_id', definition: 'INTEGER' },
  { table: 'cashier_shifts', column: 'terminal_name', definition: 'TEXT' }
];
