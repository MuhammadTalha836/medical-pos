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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. Purchase Return Items
CREATE TABLE IF NOT EXISTS purchase_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_boxes INTEGER NOT NULL,
  box_cost_price REAL NOT NULL,
  total_refund REAL NOT NULL
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
  notes TEXT,
  is_closed INTEGER NOT NULL DEFAULT 0,
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
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
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
`;

/**
 * Columns added after the first release. Databases created before a column existed get it on startup;
 * new databases already have it from SCHEMA_SQL. To add a column: put it in the CREATE TABLE above, add it
 * here, add it to prisma/schema.prisma, and run `npm run prisma:generate`.
 */
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
  { table: 'backup_history', column: 'cloud_error', definition: 'TEXT' }
];
