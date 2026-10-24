import {
  BackupStatus,
  Company,
  Product,
  SaleInvoice,
  PurchaseInvoice,
  SystemSettings,
  User,
  Customer,
  Role,
  CashierShift,
  ShiftSummary,
  SetupStatusResponse,
  SetupUnlockResponse,
  SetupCompletePayload,
  LoginResponse,
  LicenseStatus,
  AuditLogEntry,
  DeveloperSettingsPayload
} from '../types';

const API_BASE = '/api';
export const SESSION_STORAGE_KEY = 'pharmacare_user_session';
// Fired when the server ends the session (expired, logged out elsewhere, demo ended); the auth store logs out
export const SESSION_ENDED_EVENT = 'pharmacare:session-ended';

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    return stored ? JSON.parse(stored)?.token || null : null;
  } catch {
    return null;
  }
}

export function getAuthHeaders(customHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders
  };
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Every API call carries the session token; the server decides who the user is
function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, headers: getAuthHeaders(init.headers as Record<string, string> | undefined) });
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Unknown server error' }));
    if ((res.status === 401 && errorData.code === 'SESSION_REQUIRED') || errorData.code === 'LICENSE_EXPIRED') {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { code: errorData.code } }));
    }
    throw new ApiError(errorData.error || `HTTP ${res.status}: ${res.statusText}`, res.status, errorData.code);
  }
  return res.json();
}

export const api = {
  // Setup & First-Time Initialization
  getSetupStatus: () =>
    apiFetch(`${API_BASE}/setup/status`).then(r => handleResponse<SetupStatusResponse>(r)),
  unlockSetup: (code: string) =>
    apiFetch(`${API_BASE}/setup/unlock`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ code })
    }).then(r => handleResponse<SetupUnlockResponse>(r)),
  completeSetup: (data: SetupCompletePayload) =>
    apiFetch(`${API_BASE}/setup/complete`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    }).then(r => handleResponse<LoginResponse>(r)),
  getLicenseStatus: () => apiFetch(`${API_BASE}/license/status`).then(r => handleResponse<LicenseStatus>(r)),

  // Auth & Status
  getStatus: () => apiFetch(`${API_BASE}/status`).then(r => handleResponse<{ status: string; time: string }>(r)),
  getDashboardStats: () => apiFetch(`${API_BASE}/dashboard/stats`, { headers: getAuthHeaders() }).then(r => handleResponse<any>(r)),
  login: (credentials: { username: string; password: string }) =>
    apiFetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    }).then(r => handleResponse<LoginResponse>(r)),
  developerLogin: (credentials: { email: string; code: string }) =>
    apiFetch(`${API_BASE}/auth/developer-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    }).then(r => handleResponse<LoginResponse>(r)),
  logout: () =>
    apiFetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: getAuthHeaders() }).then(r => handleResponse<{ success: boolean }>(r)),
  updateProfile: (data: { userId?: number; username: string; full_name: string; currentPassword?: string; newPassword?: string }) =>
    apiFetch(`${API_BASE}/auth/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; user: User; message: string }>(r)),

  // Users Management
  getUsers: () => apiFetch(`${API_BASE}/users`, { headers: getAuthHeaders() }).then(r => handleResponse<User[]>(r)),
  createUser: (data: any) =>
    apiFetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; id: number }>(r)),
  updateUser: (id: number, data: any) =>
    apiFetch(`${API_BASE}/users/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean }>(r)),
  deleteUser: (id: number) =>
    apiFetch(`${API_BASE}/users/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    }).then(r => handleResponse<{ success: boolean }>(r)),

  // Roles & Permissions
  getRoles: () => apiFetch(`${API_BASE}/roles`).then(r => handleResponse<Role[]>(r)),
  createRole: (data: Partial<Role>) =>
    apiFetch(`${API_BASE}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; id: number }>(r)),
  updateRole: (id: number, data: Partial<Role>) =>
    apiFetch(`${API_BASE}/roles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean }>(r)),
  deleteRole: (id: number) =>
    apiFetch(`${API_BASE}/roles/${id}`, {
      method: 'DELETE'
    }).then(r => handleResponse<{ success: boolean }>(r)),

  // Customers & Credit (Khata)
  getCustomers: () => apiFetch(`${API_BASE}/customers`).then(r => handleResponse<Customer[]>(r)),
  createCustomer: (data: Partial<Customer>) =>
    apiFetch(`${API_BASE}/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; id: number }>(r)),
  updateCustomer: (id: number, data: Partial<Customer>) =>
    apiFetch(`${API_BASE}/customers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean }>(r)),
  recordCustomerPayment: (customerId: number, data: { amount: number; payment_method: string; notes?: string; shift_id?: number | null }) =>
    apiFetch(`${API_BASE}/customers/${customerId}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; new_balance: number }>(r)),
  getCustomerLedger: (customerId: number) =>
    apiFetch(`${API_BASE}/customers/${customerId}/ledger`).then(r => handleResponse<{ customer: Customer; sales: any[]; payments: any[] }>(r)),

  // Companies
  getCompanies: () => apiFetch(`${API_BASE}/companies`).then(r => handleResponse<Company[]>(r)),
  createCompany: (data: Partial<Company>) =>
    apiFetch(`${API_BASE}/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; id: number }>(r)),
  updateCompany: (id: number, data: Partial<Company>) =>
    apiFetch(`${API_BASE}/companies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean }>(r)),
  deleteCompany: (id: number) =>
    apiFetch(`${API_BASE}/companies/${id}`, { method: 'DELETE' }).then(r => handleResponse<{ success: boolean }>(r)),

  // Products
  getProducts: (params?: { q?: string; company_id?: number; low_stock?: boolean }) => {
    const url = new URL(`${API_BASE}/products`, window.location.origin);
    if (params?.q) url.searchParams.append('q', params.q);
    if (params?.company_id) url.searchParams.append('company_id', String(params.company_id));
    if (params?.low_stock) url.searchParams.append('low_stock', 'true');
    return apiFetch(url.toString()).then(r => handleResponse<Product[]>(r));
  },
  searchProducts: (q: string) =>
    apiFetch(`${API_BASE}/products/search?q=${encodeURIComponent(q)}`).then(r => handleResponse<Product[]>(r)),
  createProduct: (data: Partial<Product>) =>
    apiFetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; id: number }>(r)),
  updateProduct: (id: number, data: Partial<Product>) =>
    apiFetch(`${API_BASE}/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean }>(r)),
  deleteProduct: (id: number) =>
    apiFetch(`${API_BASE}/products/${id}`, { method: 'DELETE' }).then(r => handleResponse<{ success: boolean }>(r)),

  // Sales & POS
  createSale: (data: any) =>
    apiFetch(`${API_BASE}/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{
      success: boolean;
      saleId: number;
      invoiceNo: string;
      store_name_snapshot?: string | null;
      store_address_snapshot?: string | null;
      invoice_footer_snapshot?: string | null;
    }>(r)),
  getSales: (params?: { date_from?: string; date_to?: string; invoice_no?: string }) => {
    const url = new URL(`${API_BASE}/sales`, window.location.origin);
    if (params?.date_from) url.searchParams.append('date_from', params.date_from);
    if (params?.date_to) url.searchParams.append('date_to', params.date_to);
    if (params?.invoice_no) url.searchParams.append('invoice_no', params.invoice_no);
    return apiFetch(url.toString()).then(r => handleResponse<SaleInvoice[]>(r));
  },
  getSaleById: (id: number) => apiFetch(`${API_BASE}/sales/${id}`).then(r => handleResponse<SaleInvoice>(r)),
  createSaleReturn: (data: any) =>
    apiFetch(`${API_BASE}/sales/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<any>(r)),

  // Purchases
  getPurchases: () => apiFetch(`${API_BASE}/purchases`).then(r => handleResponse<PurchaseInvoice[]>(r)),
  createPurchase: (data: any) =>
    apiFetch(`${API_BASE}/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; purchaseId: number; invoiceNo: string }>(r)),

  // Reports
  getAvailableStockReport: () => apiFetch(`${API_BASE}/reports/stock/available`).then(r => handleResponse<any[]>(r)),
  getExpiredStockReport: (days = 0) => apiFetch(`${API_BASE}/reports/stock/expired?days=${days}`).then(r => handleResponse<any[]>(r)),
  getFinishedStockReport: () => apiFetch(`${API_BASE}/reports/stock/finished`).then(r => handleResponse<any[]>(r)),
  getPnlSummaryReport: (params?: { date_from?: string; date_to?: string }) => {
    const url = new URL(`${API_BASE}/reports/financial/pnl-summary`, window.location.origin);
    if (params?.date_from) url.searchParams.append('date_from', params.date_from);
    if (params?.date_to) url.searchParams.append('date_to', params.date_to);
    return apiFetch(url.toString()).then(r => handleResponse<any>(r));
  },
  getInvoicePnlReport: (params?: { date_from?: string; date_to?: string }) => {
    const url = new URL(`${API_BASE}/reports/financial/invoice-pnl`, window.location.origin);
    if (params?.date_from) url.searchParams.append('date_from', params.date_from);
    if (params?.date_to) url.searchParams.append('date_to', params.date_to);
    return apiFetch(url.toString()).then(r => handleResponse<any[]>(r));
  },
  getProductWiseSalesReport: () => apiFetch(`${API_BASE}/reports/sales/product-wise`).then(r => handleResponse<any[]>(r)),
  getCompanyWiseSalesReport: () => apiFetch(`${API_BASE}/reports/sales/company-wise`).then(r => handleResponse<any[]>(r)),

  // Utilities & Local Backup
  getBackupList: () => apiFetch(`${API_BASE}/utilities/backups`, { headers: getAuthHeaders() }).then(r => handleResponse<any>(r)),
  // Backups always go to the saved primary/secondary folders (Utilities -> Backup & Vault)
  createBackup: () =>
    apiFetch(`${API_BASE}/utilities/backup`, {
      method: 'POST',
      headers: getAuthHeaders()
    }).then(r => handleResponse<any>(r)),
  restoreBackup: (backupFilePath: string) =>
    apiFetch(`${API_BASE}/utilities/restore`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ backupFilePath })
    }).then(r => handleResponse<any>(r)),
  getBackupStatus: () =>
    apiFetch(`${API_BASE}/backups/status`, { headers: getAuthHeaders() }).then(r => handleResponse<BackupStatus>(r)),
  updateBackupTime: (backupScheduledTime: string) =>
    apiFetch(`${API_BASE}/backups/schedule`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ backup_scheduled_time: backupScheduledTime })
    }).then(r => handleResponse<{ success: boolean; backup_scheduled_time: string; next_run_at: string | null }>(r)),
  resetStockZero: (data: { company_id?: number; confirmation_code: string; user_id?: number; user_name?: string }) =>
    apiFetch(`${API_BASE}/utilities/stock-zero`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<any>(r)),
  optimizeDatabase: () =>
    apiFetch(`${API_BASE}/utilities/optimize`, { method: 'POST' }).then(r => handleResponse<any>(r)),
  recordDailyClosing: (data: any) =>
    apiFetch(`${API_BASE}/utilities/closing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<any>(r)),

  // Cashier Shifts & Drawer Reconciliation
  getActiveShift: (userId: number) =>
    apiFetch(`${API_BASE}/shifts/active?user_id=${userId}`).then(r => handleResponse<{ activeShift: CashierShift | null; summary?: ShiftSummary }>(r)),
  startShift: (data: { user_id: number; user_name: string; opening_cash: number; notes?: string }) =>
    apiFetch(`${API_BASE}/shifts/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; shift: CashierShift }>(r)),
  getShiftSummary: (shiftId: number) =>
    apiFetch(`${API_BASE}/shifts/${shiftId}/summary`).then(r => handleResponse<{ shift: CashierShift; summary: ShiftSummary }>(r)),
  closeShift: (shiftId: number, data: { actual_cash: number; notes?: string; user_id?: number; user_name?: string }) =>
    apiFetch(`${API_BASE}/shifts/${shiftId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; message: string; shift: CashierShift; backup?: any }>(r)),
  getShifts: (params?: { user_id?: number; status?: string; date_from?: string; date_to?: string }) => {
    const url = new URL(`${API_BASE}/shifts`, window.location.origin);
    if (params?.user_id) url.searchParams.append('user_id', String(params.user_id));
    if (params?.status) url.searchParams.append('status', params.status);
    if (params?.date_from) url.searchParams.append('date_from', params.date_from);
    if (params?.date_to) url.searchParams.append('date_to', params.date_to);
    return apiFetch(url.toString()).then(r => handleResponse<CashierShift[]>(r));
  },
  getShiftDetails: (shiftId: number) =>
    apiFetch(`${API_BASE}/shifts/${shiftId}`).then(r => handleResponse<{ shift: CashierShift; sales: any[]; returns: any[]; payments: any[] }>(r)),
  reopenShiftByAdmin: (shiftId: number, data: { admin_id: number; admin_name: string; reason: string }) =>
    apiFetch(`${API_BASE}/shifts/${shiftId}/admin/reopen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; message: string; shift: CashierShift }>(r)),
  correctShiftByAdmin: (shiftId: number, data: { admin_id: number; admin_name: string; corrected_closing_cash: number; reason: string }) =>
    apiFetch(`${API_BASE}/shifts/${shiftId}/admin/correct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; message: string; shift: CashierShift }>(r)),
  adminForceCloseShift: (shiftId: number, data: { admin_id: number; admin_name: string; actual_cash: number; reason: string; notes?: string }) =>
    apiFetch(`${API_BASE}/shifts/${shiftId}/admin/force-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; message: string; shift: CashierShift }>(r)),

  // System Settings
  getSettings: () => apiFetch(`${API_BASE}/settings`).then(r => handleResponse<SystemSettings>(r)),
  saveSettings: (settings: Partial<SystemSettings>) =>
    apiFetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings)
    }).then(r => handleResponse<{ success: boolean; message: string }>(r)),

  // Developer Protected Settings & RBAC
  getDeveloperSettings: () =>
    apiFetch(`${API_BASE}/developer/settings`, {
      headers: getAuthHeaders()
    }).then(r => handleResponse<DeveloperSettingsPayload>(r)),
  updateDeveloperSettings: (data: Partial<DeveloperSettingsPayload>) =>
    apiFetch(`${API_BASE}/developer/settings`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; message: string }>(r)),
  developerResetPassword: (userId: number, newPassword: string) =>
    apiFetch(`${API_BASE}/developer/users/${userId}/reset-password`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ new_password: newPassword })
    }).then(r => handleResponse<{ success: boolean; message: string }>(r)),
  getDeveloperAuditLogs: (params?: { page?: number; limit?: number; module?: string; action?: string; status?: string; user?: string }) => {
    const url = new URL(`${API_BASE}/developer/audit-logs`, window.location.origin);
    if (params?.page) url.searchParams.append('page', String(params.page));
    if (params?.limit) url.searchParams.append('limit', String(params.limit));
    if (params?.module) url.searchParams.append('module', params.module);
    if (params?.action) url.searchParams.append('action', params.action);
    if (params?.status) url.searchParams.append('status', params.status);
    if (params?.user) url.searchParams.append('user', params.user);
    return apiFetch(url.toString(), {
      headers: getAuthHeaders()
    }).then(r => handleResponse<{ logs: AuditLogEntry[]; total: number; page: number; totalPages: number }>(r));
  },
  updateLicense: (data: { action: 'full' } | { action: 'demo' | 'extend'; demoDays: number }) =>
    apiFetch(`${API_BASE}/developer/license`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    }).then(r => handleResponse<LicenseStatus & { success: boolean }>(r)),
  getAdminPermissions: () =>
    apiFetch(`${API_BASE}/developer/admin-permissions`, { headers: getAuthHeaders() }).then(r => handleResponse<Record<string, boolean>>(r)),
  updateAdminPermissions: (permissions: Record<string, boolean>) =>
    apiFetch(`${API_BASE}/developer/admin-permissions`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(permissions)
    }).then(r => handleResponse<{ success: boolean; permissions: Record<string, boolean> }>(r)),
};
