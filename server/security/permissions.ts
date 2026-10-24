// Default permission matrices for the built-in roles. The Developer can change the Admin role's
// permissions (setup wizard and Developer Settings); Admins manage the other roles.

export const DEFAULT_ADMIN_PERMISSIONS: Record<string, boolean> = {
  dashboard: true, pos: true, sales: true, shifts: true, khata: true, masters: true, purchases: true, reports: true, utilities: true, settings: true,
  can_add_product: true, can_edit_product: true, can_delete_product: true, can_add_company: true, can_edit_company: true, can_delete_company: true,
  can_delete_invoice: true, can_return_sale: true, can_view_all_sales: true, can_view_financial_kpis: true, can_add_purchase: true,
  can_add_customer: true, can_receive_payment: true, can_edit_customer: true, can_delete_customer: true, can_discount: true,
  can_backup: true, can_restore: true, can_shift_close: true, can_manage_shifts: true, can_stock_zero: true, can_manage_users: true, can_manage_roles: true
};

export const DEFAULT_CASHIER_PERMISSIONS: Record<string, boolean> = {
  dashboard: false, pos: true, sales: true, shifts: false, khata: true, masters: true, purchases: false, reports: false, utilities: false, settings: false,
  can_add_product: true, can_edit_product: false, can_delete_product: false, can_add_company: true, can_edit_company: false, can_delete_company: false,
  can_delete_invoice: false, can_return_sale: true, can_view_all_sales: false, can_view_financial_kpis: false, can_add_purchase: false,
  can_add_customer: true, can_receive_payment: true, can_edit_customer: false, can_delete_customer: false, can_discount: true,
  can_backup: false, can_restore: false, can_shift_close: true, can_manage_shifts: false, can_stock_zero: false, can_manage_users: false, can_manage_roles: false
};

export const DEFAULT_PHARMACIST_PERMISSIONS: Record<string, boolean> = {
  dashboard: true, pos: true, sales: true, shifts: false, khata: true, masters: true, purchases: true, reports: false, utilities: false, settings: false,
  can_add_product: true, can_edit_product: true, can_delete_product: false, can_add_company: true, can_edit_company: true, can_delete_company: false,
  can_delete_invoice: false, can_return_sale: true, can_view_all_sales: true, can_view_financial_kpis: false, can_add_purchase: true,
  can_add_customer: true, can_receive_payment: true, can_edit_customer: true, can_delete_customer: false, can_discount: true,
  can_backup: false, can_restore: false, can_shift_close: true, can_manage_shifts: false, can_stock_zero: false, can_manage_users: false, can_manage_roles: false
};

export const PERMISSION_KEYS = Object.keys(DEFAULT_ADMIN_PERMISSIONS);

/** Keeps only known permission keys, as booleans; missing keys fall back to the given defaults. */
export function normalizePermissions(input: Record<string, unknown>, defaults: Record<string, boolean>): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of PERMISSION_KEYS) {
    result[key] = typeof input[key] === 'boolean' ? (input[key] as boolean) : defaults[key] === true;
  }
  return result;
}
