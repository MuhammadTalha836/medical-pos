import {
  BackupStatus,
  ControlledRegisterRow,
  DayCloseRange,
  DayCloseReport,
  DayClosing,
  ExpenseInput,
  ExpenseList,
  CustomerLoyalty,
  LoyaltyMembers,
  LoyaltyPlan,
  LoyaltyPlanInput,
  LoyaltyTemplate,
  LanStatus,
  StockAdjustInput,
  StockAdjustmentList,
  StockCount,
  StockCountDetail,
  SubstitutesResult,
  CloudBackupFile,
  CloudBackupStatus,
  CloudConnectProgress,
  Company,
  Product,
  SaleInvoice,
  PurchaseInvoice,
  SystemSettings,
  User,
  Customer,
  CustomerLedger,
  Role,
  CashierShift,
  ShiftSummary,
  SetupStatusResponse,
  SetupUnlockResponse,
  SetupCompletePayload,
  LoginResponse,
  LicenseStatus,
  AuditLogEntry,
  DeveloperSettingsPayload,
  SupplierSummary,
  SupplierLedger,
  SupplierPaymentMethod,
  PurchaseReturnSummary,
  PurchaseReturnDetails,
  ExpiryCandidate,
  PurchaseReturnLineInput,
  ReorderList,
  ProductBatchRow
} from '../types';

const API_BASE = '/api';
export const SESSION_STORAGE_KEY = 'pharmacare_user_session';
// Fired when the server ends the session (expired, logged out elsewhere, demo ended); the auth store logs out
export const SESSION_ENDED_EVENT = 'pharmacare:session-ended';

type Query = Record<string, string | number | boolean | undefined | null>;
type Success = { success: boolean };
type SuccessMessage = { success: boolean; message: string };

function getSessionToken(): string | null {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    return stored ? JSON.parse(stored)?.token || null : null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  /** `data` is the full error body, for answers that carry details (e.g. the existing customer on a 409) */
  constructor(message: string, public status: number, public code?: string, public data?: any) {
    super(message);
  }
}

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '' && value !== false) params.append(key, String(value));
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

// Every API call carries the session token; the server decides who the user is
async function request<T>(method: string, path: string, options: { body?: unknown; query?: Query } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Unknown server error' }));
    if ((res.status === 401 && errorData.code === 'SESSION_REQUIRED') || errorData.code === 'LICENSE_EXPIRED') {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { code: errorData.code } }));
    }
    // Counter PC: this counter was removed on the main computer, or the versions differ; the counter's own
    // screen takes over (pair again / please update)
    if (errorData.code === 'TERMINAL_NOT_PAIRED' || errorData.code === 'VERSION_MISMATCH') {
      void window.electronAPI?.lanRetry();
    }
    throw new ApiError(errorData.error || `HTTP ${res.status}: ${res.statusText}`, res.status, errorData.code, errorData);
  }
  return res.json();
}

const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query });
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body });
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, { body });
const del = <T>(path: string) => request<T>('DELETE', path);

type DateRange = { date_from?: string; date_to?: string };
type AdminShiftAction = { admin_id: number; admin_name: string; reason: string };

export const api = {
  // Setup & first-time initialization
  getSetupStatus: () => get<SetupStatusResponse>('/setup/status'),
  unlockSetup: (code: string) => post<SetupUnlockResponse>('/setup/unlock', { code }),
  completeSetup: (data: SetupCompletePayload) => post<LoginResponse>('/setup/complete', data),
  getLicenseStatus: () => get<LicenseStatus>('/license/status'),

  // Auth & dashboard
  getDashboardStats: () => get<any>('/dashboard/stats'),
  login: (credentials: { username: string; password: string }) => post<LoginResponse>('/auth/login', credentials),
  developerLogin: (credentials: { email: string; code: string }) => post<LoginResponse>('/auth/developer-login', credentials),
  logout: () => post<Success>('/auth/logout'),
  updateProfile: (data: { userId?: number; username: string; full_name: string; currentPassword?: string; newPassword?: string }) =>
    put<{ success: boolean; user: User; message: string }>('/auth/profile', data),

  // Users
  getUsers: () => get<User[]>('/users'),
  createUser: (data: { username: string; password: string; full_name: string; role: string }) =>
    post<{ success: boolean; id: number }>('/users', data),
  updateUser: (id: number, data: { username?: string; full_name?: string; role?: string; status?: string; password?: string }) =>
    put<Success>(`/users/${id}`, data),
  deleteUser: (id: number) => del<Success>(`/users/${id}`),

  // Roles & permissions
  getRoles: () => get<Role[]>('/roles'),
  createRole: (data: Partial<Role>) => post<{ success: boolean; id: number }>('/roles', data),
  updateRole: (id: number, data: Partial<Role>) => put<Success>(`/roles/${id}`, data),
  deleteRole: (id: number) => del<Success>(`/roles/${id}`),

  // Customers & credit (khata)
  getCustomers: () => get<Customer[]>('/customers'),
  createCustomer: (data: Partial<Customer>) => post<{ success: boolean; id: number; customer: Customer }>('/customers', data),
  searchCustomers: (q: string) => get<Customer[]>('/customers/search', { q }),
  updateCustomer: (id: number, data: Partial<Customer>) => put<Success>(`/customers/${id}`, data),
  recordCustomerPayment: (customerId: number, data: { amount: number; payment_method: string; notes?: string; shift_id?: number | null }) =>
    post<{ success: boolean; new_balance: number }>(`/customers/${customerId}/payment`, data),
  getCustomerLedger: (customerId: number) => get<CustomerLedger>(`/customers/${customerId}/ledger`),
  deleteCustomer: (id: number) => del<Success>(`/customers/${id}`),

  // Counters on the shop network (LAN mode)
  getLanHealth: () => get<{ app: string; version: string; server_time: string; server_name: string; mode: string; paired: boolean }>('/lan/health'),
  getLanStatus: () => get<LanStatus>('/lan/status'),
  makePairingCode: () => post<{ code: string; expires_at: string; fingerprint_short: string }>('/lan/pairing-code'),
  renameTerminal: (id: number, name: string) => put<Success>(`/lan/terminals/${id}`, { name }),
  revokeTerminal: (id: number) => post<Success>(`/lan/terminals/${id}/revoke`),
  setLanMode: (mode: 'standalone' | 'server', port: number) =>
    put<{ success: boolean; restart_needed: boolean; mode: string; port: number }>('/lan/mode', { mode, port }),

  // Loyalty points and plans
  getLoyaltyPlans: () => get<LoyaltyPlan[]>('/loyalty/plans'),
  getLoyaltyTemplates: () => get<LoyaltyTemplate[]>('/loyalty/templates'),
  createLoyaltyPlan: (data: LoyaltyPlanInput) => post<{ success: boolean; plan: LoyaltyPlan }>('/loyalty/plans', data),
  updateLoyaltyPlan: (id: number, data: LoyaltyPlanInput) => put<{ success: boolean; plan: LoyaltyPlan }>(`/loyalty/plans/${id}`, data),
  archiveLoyaltyPlan: (id: number, restore = false) => post<Success>(`/loyalty/plans/${id}/archive`, { restore }),
  deleteLoyaltyPlan: (id: number) => del<Success>(`/loyalty/plans/${id}`),
  getLoyaltyMembers: (params?: { plan_id?: number; q?: string }) => get<LoyaltyMembers>('/loyalty/members', params),
  getCustomerLoyalty: (customerId: number) => get<CustomerLoyalty>(`/customers/${customerId}/loyalty`),
  adjustLoyaltyPoints: (customerId: number, points: number, notes: string) =>
    post<{ success: boolean; points: number }>(`/customers/${customerId}/loyalty/adjust`, { points, notes }),
  setCustomerPlan: (customerId: number, planId: number | null) => put<Success>(`/customers/${customerId}/plan`, { plan_id: planId }),

  // Companies
  getCompanies: () => get<Company[]>('/companies'),
  createCompany: (data: Partial<Company>) => post<{ success: boolean; id: number }>('/companies', data),
  updateCompany: (id: number, data: Partial<Company>) => put<Success>(`/companies/${id}`, data),

  // Products
  getProducts: (params?: { q?: string; company_id?: number; low_stock?: boolean }) => get<Product[]>('/products', params),
  searchProducts: (q: string) => get<Product[]>('/products/search', { q }),
  getSubstitutes: (id: number) => get<SubstitutesResult>(`/products/${id}/substitutes`),
  getGenericNames: (q?: string) => get<{ generic_name: string; uses: number }[]>('/products/generics', q ? { q } : undefined),
  createProduct: (data: Partial<Product>) => post<{ success: boolean; id: number }>('/products', data),
  updateProduct: (id: number, data: Partial<Product>) => put<Success>(`/products/${id}`, data),
  deleteProduct: (id: number) => del<Success>(`/products/${id}`),

  // Sales & POS
  createSale: (data: unknown) =>
    post<{
      success: boolean;
      saleId: number;
      invoiceNo: string;
      store_name_snapshot?: string | null;
      store_address_snapshot?: string | null;
      invoice_footer_snapshot?: string | null;
      /** The sale as the server priced and stored it */
      sale: SaleInvoice;
    }>('/sales', data),
  getSales: (params?: DateRange & { invoice_no?: string }) => get<SaleInvoice[]>('/sales', params),
  getSaleById: (id: number) => get<SaleInvoice>(`/sales/${id}`),
  createSaleReturn: (data: unknown) => post<any>('/sales/return', data),

  // Purchases
  getPurchases: () => get<PurchaseInvoice[]>('/purchases'),
  getPurchaseById: (id: number) => get<PurchaseInvoice>(`/purchases/${id}`),

  getProductBatches: (productId: number) => get<ProductBatchRow[]>(`/products/${productId}/batches`),
  updateProductBatch: (productId: number, batchId: number, data: { batch_no: string; expiry_date: string | null }) =>
    put<Success>(`/products/${productId}/batches/${batchId}`, data),
  getReorderList: (coverDays?: number) => get<ReorderList>('/reorder', { cover_days: coverDays }),

  // Returns to suppliers and expiry claims
  getPurchaseReturns: () => get<PurchaseReturnSummary[]>('/purchase-returns'),
  getPurchaseReturn: (id: number) => get<PurchaseReturnDetails>(`/purchase-returns/${id}`),
  getExpiryCandidates: (days: number) => get<ExpiryCandidate[]>('/purchase-returns/expiry-candidates', { days }),
  createPurchaseReturn: (data: { company_id: number; purchase_id?: number | null; reason?: string; is_expiry_claim?: boolean; items: PurchaseReturnLineInput[] }) =>
    post<{ success: boolean; id: number; returnNo: string; totalCredit: number }>('/purchase-returns', data),
  createPurchase: (data: unknown) => post<{ success: boolean; purchaseId: number; invoiceNo: string; netTotal: number; paidAmount: number }>('/purchases', data),

  // Suppliers (payables)
  getSuppliers: () => get<SupplierSummary[]>('/suppliers'),
  getSupplierLedger: (id: number) => get<SupplierLedger>(`/suppliers/${id}/ledger`),
  paySupplier: (id: number, data: { amount: number; payment_method: SupplierPaymentMethod; payment_date: string; reference?: string; notes?: string }) =>
    post<{ success: boolean; id: number; balance: number }>(`/suppliers/${id}/payments`, data),

  // Reports
  getAvailableStockReport: () => get<any[]>('/reports/stock/available'),
  getExpiredStockReport: (days = 0) => get<any[]>('/reports/stock/expired', { days: String(days) }),
  getFinishedStockReport: () => get<any[]>('/reports/stock/finished'),
  getPnlSummaryReport: (params?: DateRange) => get<any>('/reports/financial/pnl-summary', params),
  getInvoicePnlReport: (params?: DateRange) => get<any[]>('/reports/financial/invoice-pnl', params),
  getProductWiseSalesReport: () => get<any[]>('/reports/sales/product-wise'),
  getCompanyWiseSalesReport: () => get<any[]>('/reports/sales/company-wise'),
  getControlledRegister: (params?: DateRange) => get<ControlledRegisterRow[]>('/reports/controlled-register', params),
  getDayClose: (date: string) => get<DayCloseReport>('/day-close', { date }),
  getDayCloseRange: (from: string, to: string) => get<DayCloseRange>('/day-close/range', { from, to }),
  getDayCloseHistory: () => get<DayClosing[]>('/day-close/history'),
  closeDay: (date: string, notes?: string) => post<{ success: boolean; closing: DayClosing }>('/day-close', { date, notes }),
  reopenDay: (date: string) => post<Success>(`/day-close/${date}/reopen`),

  // Shop expenses
  getExpenses: (params?: DateRange & { category?: string }) => get<ExpenseList>('/expenses', params),
  createExpense: (data: ExpenseInput) => post<{ success: boolean; id: number; shift_id: number | null }>('/expenses', data),
  updateExpense: (id: number, data: ExpenseInput) => put<Success>(`/expenses/${id}`, data),
  deleteExpense: (id: number) => del<Success>(`/expenses/${id}`),

  // Stock counts and adjustments
  getStockCounts: () => get<StockCount[]>('/stock/counts'),
  getStockCount: (id: number) => get<StockCountDetail>(`/stock/counts/${id}`),
  createStockCount: (data: { title?: string; notes?: string; company_id?: number | null }) =>
    post<{ success: boolean; count: StockCount }>('/stock/counts', data),
  saveStockCountItem: (id: number, data: { product_id?: number; barcode?: string; counted_boxes?: number; counted_loose?: number }) =>
    put<Success>(`/stock/counts/${id}/items`, data),
  removeStockCountItem: (id: number, productId: number) => del<Success>(`/stock/counts/${id}/items/${productId}`),
  applyStockCount: (id: number) =>
    post<{ success: boolean; counted: number; changed: number; loss_value: number; gain_value: number }>(`/stock/counts/${id}/apply`),
  cancelStockCount: (id: number) => post<Success>(`/stock/counts/${id}/cancel`),
  adjustStock: (productId: number, data: StockAdjustInput) =>
    post<{ success: boolean; stock_boxes: number; stock_loose: number }>(`/products/${productId}/adjust`, data),
  getStockAdjustments: (params?: { from?: string; to?: string; product_id?: number; reason?: string }) =>
    get<StockAdjustmentList>('/stock/adjustments', params),

  // Backups & utilities (backups always go to the saved primary/secondary folders)
  getBackupList: () => get<any>('/utilities/backups'),
  createBackup: () => post<any>('/utilities/backup'),
  restoreBackup: (backupFilePath: string) => post<any>('/utilities/restore', { backupFilePath }),
  getBackupStatus: () => get<BackupStatus>('/backups/status'),
  updateBackupTime: (backupScheduledTime: string) =>
    put<{ success: boolean; backup_scheduled_time: string; next_run_at: string | null }>('/backups/schedule', {
      backup_scheduled_time: backupScheduledTime
    }),
  resetStockZero: (data: { company_id?: number; confirmation_code: string }) => post<any>('/utilities/stock-zero', data),
  optimizeDatabase: () => post<any>('/utilities/optimize'),
  getCloudBackups: () => get<CloudBackupFile[]>('/utilities/cloud-backups'),
  restoreCloudBackup: (fileId: string) => post<SuccessMessage>('/utilities/restore-cloud', { fileId }),

  // Cashier shifts & drawer reconciliation
  getActiveShift: (userId: number) =>
    get<{ activeShift: CashierShift | null; summary?: ShiftSummary }>('/shifts/active', { user_id: userId }),
  startShift: (data: { user_id: number; user_name: string; opening_cash: number; notes?: string }) =>
    post<{ success: boolean; shift: CashierShift }>('/shifts/start', data),
  getShiftSummary: (shiftId: number) => get<{ shift: CashierShift; summary: ShiftSummary }>(`/shifts/${shiftId}/summary`),
  closeShift: (shiftId: number, data: { actual_cash: number; notes?: string; user_id?: number; user_name?: string }) =>
    post<{ success: boolean; message: string; shift: CashierShift; backup?: any }>(`/shifts/${shiftId}/close`, data),
  getShifts: (params?: DateRange & { user_id?: number; status?: string }) => get<CashierShift[]>('/shifts', params),
  getShiftDetails: (shiftId: number) =>
    get<{ shift: CashierShift; sales: any[]; returns: any[]; payments: any[]; expenses: any[] }>(`/shifts/${shiftId}`),
  reopenShiftByAdmin: (shiftId: number, data: AdminShiftAction) =>
    post<SuccessMessage & { shift: CashierShift }>(`/shifts/${shiftId}/admin/reopen`, data),
  correctShiftByAdmin: (shiftId: number, data: AdminShiftAction & { corrected_closing_cash: number }) =>
    post<SuccessMessage & { shift: CashierShift }>(`/shifts/${shiftId}/admin/correct`, data),
  adminForceCloseShift: (shiftId: number, data: AdminShiftAction & { actual_cash: number; notes?: string }) =>
    post<SuccessMessage & { shift: CashierShift }>(`/shifts/${shiftId}/admin/force-close`, data),

  // System settings
  getSettings: () => get<SystemSettings>('/settings'),
  saveSettings: (settings: Partial<SystemSettings>) => post<SuccessMessage>('/settings', settings),

  // Developer-protected settings, license and audit log
  getDeveloperSettings: () => get<DeveloperSettingsPayload>('/developer/settings'),
  updateDeveloperSettings: (data: Partial<DeveloperSettingsPayload>) => put<SuccessMessage>('/developer/settings', data),
  getCloudBackupStatus: () => get<CloudBackupStatus>('/developer/cloud'),
  connectCloudBackup: () => post<{ authUrl: string }>('/developer/cloud/connect'),
  disconnectCloudBackup: () => post<SuccessMessage>('/developer/cloud/disconnect'),
  uploadCloudBackupNow: () =>
    post<{ status: 'idle'; reason: string } | { status: 'uploaded'; filename: string; pruned: number }>('/developer/cloud/upload'),
  // Setup wizard (before the developer account exists): authorized by the setup token
  connectCloudBackupInSetup: (setupToken: string) => post<{ authUrl: string }>('/setup/cloud/connect', { setupToken }),
  getCloudBackupSetupStatus: (setupToken: string) =>
    post<{ available: boolean; connected: boolean; account_email: string | null; connect: CloudConnectProgress }>('/setup/cloud/status', { setupToken }),
  developerResetPassword: (userId: number, newPassword: string) =>
    post<SuccessMessage>(`/developer/users/${userId}/reset-password`, { new_password: newPassword }),
  getDeveloperAuditLogs: (params?: { page?: number; limit?: number; module?: string; action?: string; status?: string; user?: string }) =>
    get<{ logs: AuditLogEntry[]; total: number; page: number; totalPages: number }>('/developer/audit-logs', params),
  updateLicense: (data: { action: 'full' } | { action: 'demo' | 'extend'; demoDays: number }) =>
    put<LicenseStatus & { success: boolean }>('/developer/license', data),
  getAdminPermissions: () => get<Record<string, boolean>>('/developer/admin-permissions'),
  updateAdminPermissions: (permissions: Record<string, boolean>) =>
    put<{ success: boolean; permissions: Record<string, boolean> }>('/developer/admin-permissions', permissions)
};
