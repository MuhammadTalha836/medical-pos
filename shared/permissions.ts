// Role permission matrix shared by the server (enforcement, seed) and the UI (role editors, menus).
// The Developer changes the Admin role's permissions; Admins manage the other roles.

export const PERMISSION_GROUPS = [
  {
    title: 'Modules',
    items: [
      { key: 'pos', label: 'Counter Sales (POS)' },
      { key: 'dashboard', label: 'Dashboard Overview' },
      { key: 'sales', label: 'Sales History & Invoices' },
      { key: 'shifts', label: 'Admin Shift Management' },
      { key: 'expenses', label: 'Shop Expenses' },
      { key: 'khata', label: 'Customer Credit Khata' },
      { key: 'masters', label: 'Medicine & Company Masters' },
      { key: 'purchases', label: 'Purchases & Stock Inward' },
      { key: 'reports', label: 'Reports & Analytics' },
      { key: 'utilities', label: 'System Utilities & Backup' },
      { key: 'settings', label: 'System Settings' }
    ]
  },
  {
    title: 'Medicines & Companies',
    items: [
      { key: 'can_add_product', label: 'Add New Medicine' },
      { key: 'can_edit_product', label: 'Edit Medicine Details' },
      { key: 'can_delete_product', label: 'Delete Medicine' },
      { key: 'can_count_stock', label: 'Count Shelf Stock' },
      { key: 'can_adjust_stock', label: 'Adjust Stock & Apply Counts' },
      { key: 'can_add_company', label: 'Add Company / Supplier' },
      { key: 'can_edit_company', label: 'Edit Company' },
      { key: 'can_delete_company', label: 'Delete Company' }
    ]
  },
  {
    title: 'Sales',
    items: [
      { key: 'can_discount', label: 'Give Discounts' },
      { key: 'can_return_sale', label: 'Process Sale Returns' },
      { key: 'can_delete_invoice', label: 'Delete Invoices' },
      { key: 'can_view_all_sales', label: 'View All Staff Invoices' }
    ]
  },
  {
    title: 'Purchases & Khata',
    items: [
      { key: 'can_add_purchase', label: 'Record Supplier Purchases' },
      { key: 'can_pay_supplier', label: 'Pay Suppliers' },
      { key: 'can_return_purchase', label: 'Return Goods to Supplier' },
      { key: 'can_add_customer', label: 'Register Khata Account' },
      { key: 'can_edit_customer', label: 'Edit Customer & Limits' },
      { key: 'can_delete_customer', label: 'Delete Khata Account' },
      { key: 'can_receive_payment', label: 'Receive Cash Recoveries' },
      { key: 'can_manage_loyalty', label: 'Manage Loyalty Plans & Points' }
    ]
  },
  {
    title: 'Finance, Utilities & Security',
    items: [
      { key: 'can_view_financial_kpis', label: 'View Revenue & Financial KPIs' },
      { key: 'can_add_expense', label: 'Record Shop Expenses' },
      { key: 'can_day_close', label: 'Close & Reopen the Day' },
      { key: 'can_backup', label: 'Run Backup' },
      { key: 'can_restore', label: 'Restore Database Snapshot' },
      { key: 'can_shift_close', label: 'Execute Shift Closing' },
      { key: 'can_manage_shifts', label: 'Manage & Reopen Shifts' },
      { key: 'can_stock_zero', label: 'Reset Stock Zero Audit' },
      { key: 'can_manage_users', label: 'Manage Staff Logins' },
      { key: 'can_manage_roles', label: 'Manage Cashier & Custom Roles' },
      { key: 'can_manage_terminals', label: 'Manage Counter Computers (LAN)' },
      { key: 'can_view_audit_log', label: 'View Security Audit Log' }
    ]
  }
] as const;

export type PermissionKey = (typeof PERMISSION_GROUPS)[number]['items'][number]['key'];
export type RolePermissions = Record<PermissionKey, boolean>;

export const PERMISSION_KEYS: PermissionKey[] = PERMISSION_GROUPS.flatMap(group => group.items.map(item => item.key));

function permissionsWith(granted: PermissionKey[]): RolePermissions {
  const result = {} as RolePermissions;
  for (const key of PERMISSION_KEYS) result[key] = granted.includes(key);
  return result;
}

export const DEFAULT_ADMIN_PERMISSIONS: RolePermissions = permissionsWith(PERMISSION_KEYS);

export const DEFAULT_CASHIER_PERMISSIONS: RolePermissions = permissionsWith([
  'pos', 'sales', 'khata', 'masters', 'expenses',
  'can_add_product', 'can_add_company', 'can_return_sale', 'can_add_customer', 'can_receive_payment', 'can_discount', 'can_shift_close',
  'can_add_expense', 'can_count_stock'
]);

export const DEFAULT_PHARMACIST_PERMISSIONS: RolePermissions = permissionsWith([
  'dashboard', 'pos', 'sales', 'khata', 'masters', 'purchases', 'expenses',
  'can_add_product', 'can_edit_product', 'can_add_company', 'can_edit_company', 'can_return_sale', 'can_view_all_sales',
  'can_add_purchase', 'can_add_customer', 'can_receive_payment', 'can_edit_customer', 'can_discount', 'can_shift_close',
  'can_add_expense', 'can_count_stock'
]);

// Starting point for a new custom role: counter sales only
export const DEFAULT_BLANK_PERMISSIONS: RolePermissions = permissionsWith(['pos', 'sales', 'can_discount']);

/** Keeps only known permission keys, as booleans; missing keys fall back to the given defaults. */
export function normalizePermissions(input: Record<string, unknown>, defaults: Partial<RolePermissions>): RolePermissions {
  const result = {} as RolePermissions;
  for (const key of PERMISSION_KEYS) {
    result[key] = typeof input[key] === 'boolean' ? (input[key] as boolean) : defaults[key] === true;
  }
  return result;
}

/** Parses a role's stored JSON permissions; malformed JSON counts as no permissions. */
export function parsePermissions(json: string | null | undefined): Partial<Record<string, boolean>> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}
