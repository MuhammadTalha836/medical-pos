// UI-only permission helpers. The matrix itself (keys, labels, defaults) lives in shared/permissions.ts.
export { PERMISSION_GROUPS } from '../../shared/permissions';

export const ADMIN_POLICY_TOGGLES: Array<{ key: 'allow_admin_create_cashier' | 'allow_admin_create_admin' | 'allow_admin_edit_store_identity' | 'allow_admin_hide_store_identity'; label: string; hint: string }> = [
  { key: 'allow_admin_create_cashier', label: 'Admin can create cashiers', hint: 'Admin adds counter staff with username + password.' },
  { key: 'allow_admin_create_admin', label: 'Admin can create other admins', hint: 'Usually off: only the Developer creates admins.' },
  { key: 'allow_admin_edit_store_identity', label: 'Admin can edit store name/address', hint: 'Printed on every receipt.' },
  { key: 'allow_admin_hide_store_identity', label: 'Admin can hide store name/address on receipts', hint: 'Usually off.' }
];
