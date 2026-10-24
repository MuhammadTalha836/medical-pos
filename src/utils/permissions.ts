// Permission matrix groups and labels shared by the setup wizard and Developer Settings (Admin permissions).
// Keys mirror server/security/permissions.ts.

export interface PermissionGroup {
  title: string;
  items: Array<{ key: string; label: string }>;
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'Modules',
    items: [
      { key: 'pos', label: 'Counter Sales (POS)' },
      { key: 'dashboard', label: 'Dashboard Overview' },
      { key: 'sales', label: 'Sales History & Invoices' },
      { key: 'shifts', label: 'Admin Shift Management' },
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
      { key: 'can_add_customer', label: 'Register Khata Account' },
      { key: 'can_edit_customer', label: 'Edit Customer & Limits' },
      { key: 'can_delete_customer', label: 'Delete Khata Account' },
      { key: 'can_receive_payment', label: 'Receive Cash Recoveries' }
    ]
  },
  {
    title: 'Finance, Utilities & Security',
    items: [
      { key: 'can_view_financial_kpis', label: 'View Revenue & Financial KPIs' },
      { key: 'can_backup', label: 'Run Local SQLite Backup' },
      { key: 'can_restore', label: 'Restore Database Snapshot' },
      { key: 'can_shift_close', label: 'Execute Shift Closing' },
      { key: 'can_manage_shifts', label: 'Manage & Reopen Shifts' },
      { key: 'can_stock_zero', label: 'Reset Stock Zero Audit' },
      { key: 'can_manage_users', label: 'Manage Staff Logins' },
      { key: 'can_manage_roles', label: 'Manage Cashier & Custom Roles' }
    ]
  }
];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap(group => group.items.map(item => item.key));

export const DEFAULT_ADMIN_PERMISSION_STATE: Record<string, boolean> = Object.fromEntries(ALL_PERMISSION_KEYS.map(key => [key, true]));

export const ADMIN_POLICY_TOGGLES: Array<{ key: 'allow_admin_create_cashier' | 'allow_admin_create_admin' | 'allow_admin_edit_store_identity' | 'allow_admin_hide_store_identity'; label: string; hint: string }> = [
  { key: 'allow_admin_create_cashier', label: 'Admin can create cashiers', hint: 'Admin adds counter staff with username + password.' },
  { key: 'allow_admin_create_admin', label: 'Admin can create other admins', hint: 'Usually off: only the Developer creates admins.' },
  { key: 'allow_admin_edit_store_identity', label: 'Admin can edit store name/address', hint: 'Printed on every receipt.' },
  { key: 'allow_admin_hide_store_identity', label: 'Admin can hide store name/address on receipts', hint: 'Usually off.' }
];
