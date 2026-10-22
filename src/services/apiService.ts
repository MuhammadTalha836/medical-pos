import {
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
  SetupInitializeResponse,
  SetupVerifyResponse
} from '../types';

const API_BASE = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Unknown server error' }));
    throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  // Setup & First-Time Initialization
  getSetupStatus: () =>
    fetch(`${API_BASE}/setup/status`).then(r => handleResponse<SetupStatusResponse>(r)),
  initializeSetup: (data: { developerEmail: string; storeName?: string; storeAddress?: string }) =>
    fetch(`${API_BASE}/setup/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<SetupInitializeResponse>(r)),
  verifySetup: (data: {
    developerEmail: string;
    code: string;
    tempToken: string;
    storeName?: string;
    storeAddress?: string;
    adminPassword?: string;
  }) =>
    fetch(`${API_BASE}/setup/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<SetupVerifyResponse>(r)),

  // Auth & Status
  getStatus: () => fetch(`${API_BASE}/status`).then(r => handleResponse<{ status: string; time: string }>(r)),
  getDashboardStats: () => fetch(`${API_BASE}/dashboard/stats`).then(r => handleResponse<any>(r)),
  login: (credentials: { username: string; password: string }) =>
    fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    }).then(r => handleResponse<{ success: boolean; user: User }>(r)),
  developerLogin: (credentials: { email: string; code: string }) =>
    fetch(`${API_BASE}/auth/developer-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    }).then(r => handleResponse<{ success: boolean; user: User }>(r)),
  updateProfile: (data: { userId: number; username: string; full_name: string; currentPassword?: string; newPassword?: string }) =>
    fetch(`${API_BASE}/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; user: User; message: string }>(r)),

  // Users Management
  getUsers: () => fetch(`${API_BASE}/users`).then(r => handleResponse<User[]>(r)),
  createUser: (data: any) =>
    fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; id: number }>(r)),
  updateUser: (id: number, data: any) =>
    fetch(`${API_BASE}/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean }>(r)),
  deleteUser: (id: number) =>
    fetch(`${API_BASE}/users/${id}`, {
      method: 'DELETE'
    }).then(r => handleResponse<{ success: boolean }>(r)),

  // Roles & Permissions
  getRoles: () => fetch(`${API_BASE}/roles`).then(r => handleResponse<Role[]>(r)),
  createRole: (data: Partial<Role>) =>
    fetch(`${API_BASE}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; id: number }>(r)),
  updateRole: (id: number, data: Partial<Role>) =>
    fetch(`${API_BASE}/roles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean }>(r)),
  deleteRole: (id: number) =>
    fetch(`${API_BASE}/roles/${id}`, {
      method: 'DELETE'
    }).then(r => handleResponse<{ success: boolean }>(r)),

  // Customers & Credit (Khata)
  getCustomers: () => fetch(`${API_BASE}/customers`).then(r => handleResponse<Customer[]>(r)),
  createCustomer: (data: Partial<Customer>) =>
    fetch(`${API_BASE}/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; id: number }>(r)),
  updateCustomer: (id: number, data: Partial<Customer>) =>
    fetch(`${API_BASE}/customers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean }>(r)),
  recordCustomerPayment: (customerId: number, data: { amount: number; payment_method: string; notes?: string; shift_id?: number | null }) =>
    fetch(`${API_BASE}/customers/${customerId}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; new_balance: number }>(r)),
  getCustomerLedger: (customerId: number) =>
    fetch(`${API_BASE}/customers/${customerId}/ledger`).then(r => handleResponse<{ customer: Customer; sales: any[]; payments: any[] }>(r)),

  // Companies
  getCompanies: () => fetch(`${API_BASE}/companies`).then(r => handleResponse<Company[]>(r)),
  createCompany: (data: Partial<Company>) =>
    fetch(`${API_BASE}/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; id: number }>(r)),
  updateCompany: (id: number, data: Partial<Company>) =>
    fetch(`${API_BASE}/companies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean }>(r)),
  deleteCompany: (id: number) =>
    fetch(`${API_BASE}/companies/${id}`, { method: 'DELETE' }).then(r => handleResponse<{ success: boolean }>(r)),

  // Products
  getProducts: (params?: { q?: string; company_id?: number; low_stock?: boolean }) => {
    const url = new URL(`${API_BASE}/products`, window.location.origin);
    if (params?.q) url.searchParams.append('q', params.q);
    if (params?.company_id) url.searchParams.append('company_id', String(params.company_id));
    if (params?.low_stock) url.searchParams.append('low_stock', 'true');
    return fetch(url.toString()).then(r => handleResponse<Product[]>(r));
  },
  searchProducts: (q: string) =>
    fetch(`${API_BASE}/products/search?q=${encodeURIComponent(q)}`).then(r => handleResponse<Product[]>(r)),
  createProduct: (data: Partial<Product>) =>
    fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; id: number }>(r)),
  updateProduct: (id: number, data: Partial<Product>) =>
    fetch(`${API_BASE}/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean }>(r)),
  deleteProduct: (id: number) =>
    fetch(`${API_BASE}/products/${id}`, { method: 'DELETE' }).then(r => handleResponse<{ success: boolean }>(r)),

  // Sales & POS
  createSale: (data: any) =>
    fetch(`${API_BASE}/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; saleId: number; invoiceNo: string }>(r)),
  getSales: (params?: { date_from?: string; date_to?: string; invoice_no?: string }) => {
    const url = new URL(`${API_BASE}/sales`, window.location.origin);
    if (params?.date_from) url.searchParams.append('date_from', params.date_from);
    if (params?.date_to) url.searchParams.append('date_to', params.date_to);
    if (params?.invoice_no) url.searchParams.append('invoice_no', params.invoice_no);
    return fetch(url.toString()).then(r => handleResponse<SaleInvoice[]>(r));
  },
  getSaleById: (id: number) => fetch(`${API_BASE}/sales/${id}`).then(r => handleResponse<SaleInvoice>(r)),
  createSaleReturn: (data: any) =>
    fetch(`${API_BASE}/sales/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<any>(r)),

  // Purchases
  getPurchases: () => fetch(`${API_BASE}/purchases`).then(r => handleResponse<PurchaseInvoice[]>(r)),
  createPurchase: (data: any) =>
    fetch(`${API_BASE}/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; purchaseId: number; invoiceNo: string }>(r)),

  // Reports
  getAvailableStockReport: () => fetch(`${API_BASE}/reports/stock/available`).then(r => handleResponse<any[]>(r)),
  getExpiredStockReport: (days = 0) => fetch(`${API_BASE}/reports/stock/expired?days=${days}`).then(r => handleResponse<any[]>(r)),
  getFinishedStockReport: () => fetch(`${API_BASE}/reports/stock/finished`).then(r => handleResponse<any[]>(r)),
  getPnlSummaryReport: (params?: { date_from?: string; date_to?: string }) => {
    const url = new URL(`${API_BASE}/reports/financial/pnl-summary`, window.location.origin);
    if (params?.date_from) url.searchParams.append('date_from', params.date_from);
    if (params?.date_to) url.searchParams.append('date_to', params.date_to);
    return fetch(url.toString()).then(r => handleResponse<any>(r));
  },
  getInvoicePnlReport: (params?: { date_from?: string; date_to?: string }) => {
    const url = new URL(`${API_BASE}/reports/financial/invoice-pnl`, window.location.origin);
    if (params?.date_from) url.searchParams.append('date_from', params.date_from);
    if (params?.date_to) url.searchParams.append('date_to', params.date_to);
    return fetch(url.toString()).then(r => handleResponse<any[]>(r));
  },
  getProductWiseSalesReport: () => fetch(`${API_BASE}/reports/sales/product-wise`).then(r => handleResponse<any[]>(r)),
  getCompanyWiseSalesReport: () => fetch(`${API_BASE}/reports/sales/company-wise`).then(r => handleResponse<any[]>(r)),

  // Utilities & Local Backup
  getBackupList: () => fetch(`${API_BASE}/utilities/backups`).then(r => handleResponse<any>(r)),
  createBackup: (customDir?: string, secondaryDir?: string) =>
    fetch(`${API_BASE}/utilities/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customDir, secondaryDir })
    }).then(r => handleResponse<any>(r)),
  restoreBackup: (backupFilePath: string) =>
    fetch(`${API_BASE}/utilities/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupFilePath })
    }).then(r => handleResponse<any>(r)),
  resetStockZero: (data: { company_id?: number; confirmation_code: string; user_id?: number; user_name?: string }) =>
    fetch(`${API_BASE}/utilities/stock-zero`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<any>(r)),
  optimizeDatabase: () =>
    fetch(`${API_BASE}/utilities/optimize`, { method: 'POST' }).then(r => handleResponse<any>(r)),
  recordDailyClosing: (data: any) =>
    fetch(`${API_BASE}/utilities/closing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<any>(r)),

  // Cashier Shifts & Drawer Reconciliation
  getActiveShift: (userId: number) =>
    fetch(`${API_BASE}/shifts/active?user_id=${userId}`).then(r => handleResponse<{ activeShift: CashierShift | null; summary?: ShiftSummary }>(r)),
  startShift: (data: { user_id: number; user_name: string; opening_cash: number; notes?: string }) =>
    fetch(`${API_BASE}/shifts/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; shift: CashierShift }>(r)),
  getShiftSummary: (shiftId: number) =>
    fetch(`${API_BASE}/shifts/${shiftId}/summary`).then(r => handleResponse<{ shift: CashierShift; summary: ShiftSummary }>(r)),
  closeShift: (shiftId: number, data: { actual_cash: number; notes?: string; user_id?: number; user_name?: string }) =>
    fetch(`${API_BASE}/shifts/${shiftId}/close`, {
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
    return fetch(url.toString()).then(r => handleResponse<CashierShift[]>(r));
  },
  getShiftDetails: (shiftId: number) =>
    fetch(`${API_BASE}/shifts/${shiftId}`).then(r => handleResponse<{ shift: CashierShift; sales: any[]; returns: any[]; payments: any[] }>(r)),
  reopenShiftByAdmin: (shiftId: number, data: { admin_id: number; admin_name: string; reason: string }) =>
    fetch(`${API_BASE}/shifts/${shiftId}/admin/reopen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; message: string; shift: CashierShift }>(r)),
  correctShiftByAdmin: (shiftId: number, data: { admin_id: number; admin_name: string; corrected_closing_cash: number; reason: string }) =>
    fetch(`${API_BASE}/shifts/${shiftId}/admin/correct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; message: string; shift: CashierShift }>(r)),
  adminForceCloseShift: (shiftId: number, data: { admin_id: number; admin_name: string; actual_cash: number; reason: string; notes?: string }) =>
    fetch(`${API_BASE}/shifts/${shiftId}/admin/force-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => handleResponse<{ success: boolean; message: string; shift: CashierShift }>(r)),

  // System Settings
  getSettings: () => fetch(`${API_BASE}/settings`).then(r => handleResponse<SystemSettings>(r)),
  saveSettings: (settings: Partial<SystemSettings>) =>
    fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    }).then(r => handleResponse<{ success: boolean; message: string }>(r)),
};
