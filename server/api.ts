import 'dotenv/config';

import express, { Request, Response } from 'express';
import cors from 'cors';
import { Prisma } from '@prisma/client';
import { prisma, initPrisma } from './database/prisma';
import {
  createBackup,
  getBackupList,
  restoreDatabase,
  resetStockZero,
  optimizeDatabase,
  pruneBackupsByRetentionLimit
} from './database/backup';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { hashPassword, verifyPassword } from './security/passwords';
import {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateTotpUri,
  encryptTotpSecret,
  decryptTotpSecret
} from './security/totp';
import { logSecurityAudit } from './security/audit';
import {
  DEFAULT_DEVELOPER_FOOTER,
  FOOTER_MAX_LENGTH,
  isValidPaperSize,
  isValidTemplate,
  normalizePaperSize,
  normalizeTemplate
} from './invoice/invoiceSettings';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Declare toJSON for BigInt to enable seamless JSON serialization for SQLite aggregations
declare global {
  interface BigInt {
    toJSON(): number;
  }
}

BigInt.prototype.toJSON = function (): number {
  return Number(this);
};

// Helper for type-safe error message extraction
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Helper to reliably extract and verify acting user from request headers
async function getActingUser(req: Request): Promise<{ id: number; username: string; role: string; fullName: string } | null> {
  const rawUserId = req.headers['x-user-id'];
  if (!rawUserId) return null;
  const userId = Number(rawUserId);
  if (isNaN(userId)) return null;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName
    };
  } catch {
    return null;
  }
}

// Initialize SQLite WAL mode and busy timeout via Prisma
initPrisma().catch(err => {
  console.error('[Prisma] Initialization error:', err);
});

// Helper formatters to map Prisma models to client-expected snake_case contracts
interface SaleItemEntity {
  id?: number;
  saleId: number;
  productId: number;
  cCode: string;
  pCode: string;
  productName: string;
  unitType: string;
  locationRack: string | null;
  isLoose: number;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  grossAmount: number;
  discountPct: number;
  discountAmount: number;
  netAmount: number;
  batchId: number | null;
}

interface SaleEntity {
  id: number;
  invoiceNo: string;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  userId: number | null;
  userName: string | null;
  saleDate: Date;
  totalGross: number;
  totalItemDiscount: number;
  billDiscountPct: number;
  billDiscountAmt: number;
  netTotal: number;
  cashTendered: number;
  changeDue: number;
  paymentType: string;
  status: string;
  notes: string | null;
  storeNameSnapshot?: string | null;
  storeAddressSnapshot?: string | null;
  invoiceFooterSnapshot?: string | null;
  createdAt: Date;
  items?: SaleItemEntity[];
}

function formatSaleItem(item: SaleItemEntity) {
  return {
    id: item.id,
    sale_id: item.saleId,
    product_id: item.productId,
    c_code: item.cCode,
    p_code: item.pCode,
    product_name: item.productName,
    unit_type: item.unitType,
    location_rack: item.locationRack,
    is_loose: item.isLoose,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    unit_cost: item.unitCost,
    gross_amount: item.grossAmount,
    discount_pct: item.discountPct,
    discount_amount: item.discountAmount,
    net_amount: item.netAmount,
    batch_id: item.batchId
  };
}

function formatSale(sale: SaleEntity) {
  return {
    id: sale.id,
    invoice_no: sale.invoiceNo,
    customer_id: sale.customerId,
    customer_name: sale.customerName,
    customer_phone: sale.customerPhone,
    user_id: sale.userId,
    user_name: sale.userName,
    sale_date: sale.saleDate,
    total_gross: sale.totalGross,
    total_item_discount: sale.totalItemDiscount,
    bill_discount_pct: sale.billDiscountPct,
    bill_discount_amt: sale.billDiscountAmt,
    net_total: sale.netTotal,
    cash_tendered: sale.cashTendered,
    change_due: sale.changeDue,
    payment_type: sale.paymentType,
    status: sale.status,
    notes: sale.notes,
    store_name_snapshot: sale.storeNameSnapshot ?? null,
    store_address_snapshot: sale.storeAddressSnapshot ?? null,
    invoice_footer_snapshot: sale.invoiceFooterSnapshot ?? null,
    created_at: sale.createdAt,
    items: sale.items ? sale.items.map(formatSaleItem) : undefined
  };
}

// -------------------------------------------------------------
// 1. Health & Dashboard KPI
// -------------------------------------------------------------
app.get('/api/status', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() });
});

app.get('/api/dashboard/stats', async (_req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const startOfToday = new Date(today + 'T00:00:00.000Z');
    const endOfToday = new Date(today + 'T23:59:59.999Z');

    const todaySalesAgg = await prisma.sale.aggregate({
      where: {
        saleDate: {
          gte: startOfToday,
          lte: endOfToday
        },
        status: 'completed'
      },
      _count: { id: true },
      _sum: {
        netTotal: true,
        totalGross: true
      }
    });

    const totalRevenue = todaySalesAgg._sum.netTotal || 0;
    const totalGross = todaySalesAgg._sum.totalGross || 0;
    const todaySales = {
      total_invoices: todaySalesAgg._count.id || 0,
      total_revenue: totalRevenue,
      total_discount: totalGross - totalRevenue
    };

    const totalProducts = await prisma.product.count({ where: { status: 'active' } });

    const lowStockRaw = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*) as count FROM products WHERE stock_boxes <= min_stock_alert AND status = 'active'
    `;
    const lowStockCount = Number(lowStockRaw[0]?.count || 0);

    const outOfStockCount = await prisma.product.count({
      where: { stockBoxes: 0, stockLoose: 0, status: 'active' }
    });

    const expiredCount = await prisma.productBatch.count({
      where: {
        expiryDate: { lte: today },
        OR: [
          { quantityBoxes: { gt: 0 } },
          { quantityLoose: { gt: 0 } }
        ]
      }
    });

    const recentSales = await prisma.sale.findMany({
      select: {
        id: true,
        invoiceNo: true,
        customerName: true,
        netTotal: true,
        paymentType: true,
        saleDate: true,
        status: true
      },
      orderBy: { id: 'desc' },
      take: 6
    });

    const lowStockItems = await prisma.$queryRaw<Array<{
      id: number;
      c_code: string;
      p_code: string;
      name: string;
      unit_type: string;
      stock_boxes: number;
      stock_loose: number;
      min_stock_alert: number;
      location_rack: string | null;
    }>>`
      SELECT p.id, p.c_code, p.p_code, p.name, p.unit_type, p.stock_boxes, p.stock_loose, p.min_stock_alert, p.location_rack
      FROM products p
      WHERE (p.stock_boxes <= p.min_stock_alert) AND p.status = 'active'
      ORDER BY p.stock_boxes ASC
      LIMIT 8
    `;

    res.json({
      todaySales,
      totalProducts,
      lowStockCount,
      outOfStockCount,
      expiredCount,
      recentSales: recentSales.map(s => ({
        id: s.id,
        invoice_no: s.invoiceNo,
        customer_name: s.customerName,
        net_total: s.netTotal,
        payment_type: s.paymentType,
        sale_date: s.saleDate,
        status: s.status
      })),
      lowStockItems
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 2. Roles, Authentication & Users
// -------------------------------------------------------------

// Seed default roles if roles table is fresh
async function ensureDefaultRoles(): Promise<void> {
  try {
    const roleCount = await prisma.role.count();
    if (roleCount === 0) {
      const adminPerms = {
        dashboard: true, pos: true, sales: true, shifts: true, khata: true, masters: true, purchases: true, reports: true, utilities: true, settings: true,
        can_add_product: true, can_edit_product: true, can_delete_product: true, can_add_company: true, can_edit_company: true, can_delete_company: true,
        can_delete_invoice: true, can_return_sale: true, can_view_all_sales: true, can_view_financial_kpis: true, can_add_purchase: true,
        can_add_customer: true, can_receive_payment: true, can_edit_customer: true, can_delete_customer: true, can_discount: true,
        can_backup: true, can_restore: true, can_shift_close: true, can_manage_shifts: true, can_stock_zero: true, can_manage_users: true, can_manage_roles: true
      };

      const cashierPerms = {
        dashboard: false, pos: true, sales: true, shifts: false, khata: true, masters: true, purchases: false, reports: false, utilities: false, settings: false,
        can_add_product: true, can_edit_product: false, can_delete_product: false, can_add_company: true, can_edit_company: false, can_delete_company: false,
        can_delete_invoice: false, can_return_sale: true, can_view_all_sales: false, can_view_financial_kpis: false, can_add_purchase: false,
        can_add_customer: true, can_receive_payment: true, can_edit_customer: false, can_delete_customer: false, can_discount: true,
        can_backup: false, can_restore: false, can_shift_close: true, can_manage_shifts: false, can_stock_zero: false, can_manage_users: false, can_manage_roles: false
      };

      const pharmacistPerms = {
        dashboard: true, pos: true, sales: true, shifts: false, khata: true, masters: true, purchases: true, reports: false, utilities: false, settings: false,
        can_add_product: true, can_edit_product: true, can_delete_product: false, can_add_company: true, can_edit_company: true, can_delete_company: false,
        can_delete_invoice: false, can_return_sale: true, can_view_all_sales: true, can_view_financial_kpis: false, can_add_purchase: true,
        can_add_customer: true, can_receive_payment: true, can_edit_customer: true, can_delete_customer: false, can_discount: true,
        can_backup: false, can_restore: false, can_shift_close: true, can_manage_shifts: false, can_stock_zero: false, can_manage_users: false, can_manage_roles: false
      };

      await prisma.role.createMany({
        data: [
          { name: 'developer', displayName: 'System Developer', description: 'Master system configuration, security rules, and TOTP authentication', isSystem: 1, permissions: JSON.stringify(adminPerms) },
          { name: 'admin', displayName: 'Administrator', description: 'Full system access and master privileges', isSystem: 1, permissions: JSON.stringify(adminPerms) },
          { name: 'cashier', displayName: 'Counter Cashier', description: 'POS sales, customer credit recoveries, and view/add medicines. Cannot delete/edit records.', isSystem: 0, permissions: JSON.stringify(cashierPerms) },
          { name: 'pharmacist', displayName: 'Pharmacist', description: 'Dispensing, master coding, and inventory purchases.', isSystem: 0, permissions: JSON.stringify(pharmacistPerms) }
        ]
      });
    } else {
      const devRole = await prisma.role.findUnique({ where: { name: 'developer' } });
      if (!devRole) {
        const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
        await prisma.role.create({
          data: {
            name: 'developer',
            displayName: 'System Developer',
            description: 'Master system configuration, security rules, and TOTP authentication',
            isSystem: 1,
            permissions: adminRole?.permissions || '{}'
          }
        });
      }
    }
  } catch (error) {
    console.error('[Prisma] Role seeding check failed:', error);
  }
}
ensureDefaultRoles().catch(err => {
  console.error('[Prisma] Role seeding error:', err);
});

// -------------------------------------------------------------
// 2.0 First-Time Setup Wizard & Offline TOTP Setup
// -------------------------------------------------------------
app.get('/api/setup/status', async (_req: Request, res: Response) => {
  try {
    const setupSetting = await prisma.systemSetting.findUnique({ where: { key: 'setup_completed' } });
    const devUser = await prisma.user.findFirst({ where: { role: 'developer' } });

    const isSetupCompleted = setupSetting?.value === 'true' && !!devUser;
    res.json({
      success: true,
      isSetupCompleted,
      developerEmail: devUser?.email || null
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/setup/initialize', async (req: Request, res: Response) => {
  try {
    const setupSetting = await prisma.systemSetting.findUnique({ where: { key: 'setup_completed' } });
    const devUser = await prisma.user.findFirst({ where: { role: 'developer' } });
    if (setupSetting?.value === 'true' && devUser) {
      return res.status(403).json({ error: 'Setup wizard is permanently locked. System is already initialized.' });
    }

    const { developerEmail } = req.body;
    if (!developerEmail || typeof developerEmail !== 'string' || !developerEmail.includes('@')) {
      return res.status(400).json({ error: 'Valid developer email address is required' });
    }

    const cleanEmail = developerEmail.trim().toLowerCase();
    const secret = generateTotpSecret();
    const uri = generateTotpUri(cleanEmail, secret, 'PharmaCare Pro');
    const qrCodeDataUrl = await QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 6
    });

    const tempToken = encryptTotpSecret(secret);

    res.json({
      success: true,
      secret,
      qrCodeDataUrl,
      uri,
      tempToken
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/setup/verify', async (req: Request, res: Response) => {
  try {
    const setupSetting = await prisma.systemSetting.findUnique({ where: { key: 'setup_completed' } });
    const devUser = await prisma.user.findFirst({ where: { role: 'developer' } });
    if (setupSetting?.value === 'true' && devUser) {
      return res.status(403).json({ error: 'Setup wizard is permanently locked. System is already initialized.' });
    }

    const { developerEmail, code, tempToken, storeName, storeAddress, adminPassword } = req.body;
    if (!developerEmail || !code || !tempToken) {
      return res.status(400).json({ error: 'Developer email, 6-digit TOTP code, and setup session token are required' });
    }

    const secret = decryptTotpSecret(tempToken);
    if (!secret) {
      return res.status(400).json({ error: 'Invalid or expired setup session token' });
    }

    const isValid = verifyTotpCode(secret, String(code).trim(), 1);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code. Please check your authenticator app and try again.' });
    }

    const cleanEmail = developerEmail.trim().toLowerCase();
    const encryptedSecret = encryptTotpSecret(secret);

    // Save or update developer user
    const existingDev = await prisma.user.findFirst({
      where: { OR: [{ role: 'developer' }, { email: cleanEmail }, { username: 'developer' }] }
    });

    let savedDevUser;
    if (existingDev) {
      savedDevUser = await prisma.user.update({
        where: { id: existingDev.id },
        data: {
          username: 'developer',
          email: cleanEmail,
          fullName: 'System Developer',
          role: 'developer',
          status: 'active',
          totpSecret: encryptedSecret,
          failedLoginAttempts: 0,
          lockedUntil: null
        }
      });
    } else {
      savedDevUser = await prisma.user.create({
        data: {
          username: 'developer',
          email: cleanEmail,
          password: await hashPassword(crypto.randomBytes(16).toString('hex')),
          fullName: 'System Developer',
          role: 'developer',
          status: 'active',
          totpSecret: encryptedSecret
        }
      });
    }

    // If initial admin password provided, update admin account with bcrypt hash
    if (adminPassword && typeof adminPassword === 'string' && adminPassword.trim().length > 0) {
      const hashedAdminPassword = await hashPassword(adminPassword.trim());
      const adminAcc = await prisma.user.findFirst({ where: { username: 'admin' } });
      if (adminAcc) {
        await prisma.user.update({
          where: { id: adminAcc.id },
          data: { password: hashedAdminPassword }
        });
      }
    } else {
      // Ensure existing admin account password is secure
      const adminAcc = await prisma.user.findFirst({ where: { username: 'admin' } });
      if (adminAcc && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(adminAcc.password)) {
        await prisma.user.update({
          where: { id: adminAcc.id },
          data: { password: await hashPassword(adminAcc.password) }
        });
      }
    }

    // Update store settings if provided
    if (storeName && typeof storeName === 'string' && storeName.trim()) {
      await prisma.systemSetting.upsert({
        where: { key: 'store_name' },
        update: { value: storeName.trim() },
        create: { key: 'store_name', value: storeName.trim() }
      });
    }
    if (storeAddress && typeof storeAddress === 'string' && storeAddress.trim()) {
      await prisma.systemSetting.upsert({
        where: { key: 'store_address' },
        update: { value: storeAddress.trim() },
        create: { key: 'store_address', value: storeAddress.trim() }
      });
    }

    // Save developer settings and lock setup
    await prisma.systemSetting.upsert({
      where: { key: 'setup_completed' },
      update: { value: 'true' },
      create: { key: 'setup_completed', value: 'true' }
    });
    await prisma.systemSetting.upsert({
      where: { key: 'developer_email' },
      update: { value: cleanEmail },
      create: { key: 'developer_email', value: cleanEmail }
    });

    // Record in audit log
    await prisma.auditLog.create({
      data: {
        action: 'SETUP_COMPLETED',
        module: 'SECURITY',
        details: `Initial setup completed. Developer account registered: ${cleanEmail}`,
        userId: savedDevUser.id,
        userName: savedDevUser.fullName
      }
    });

    const roleRow = await prisma.role.findUnique({ where: { name: 'developer' } });
    let permissions = null;
    if (roleRow && roleRow.permissions) {
      try { permissions = JSON.parse(roleRow.permissions); } catch {}
    }

    res.json({
      success: true,
      message: 'Setup verified and locked successfully',
      user: {
        id: savedDevUser.id,
        username: savedDevUser.username,
        email: savedDevUser.email,
        full_name: savedDevUser.fullName,
        role: savedDevUser.role,
        status: savedDevUser.status,
        role_display: 'System Developer',
        permissions
      }
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 2.1 Authentication & Profile
// -------------------------------------------------------------

// 2.1a Developer Offline TOTP Login
app.post('/api/auth/developer-login', async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Developer email and 6-digit TOTP code are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const devUser = await prisma.user.findFirst({
      where: { email: cleanEmail, role: 'developer' }
    });

    if (!devUser) {
      return res.status(401).json({ error: 'Invalid developer credentials' });
    }

    if (devUser.status !== 'active') {
      return res.status(403).json({ error: 'Developer account is deactivated.' });
    }

    // Check rate limit lockout
    if (devUser.lockedUntil && new Date(devUser.lockedUntil) > new Date()) {
      const remainingMs = new Date(devUser.lockedUntil).getTime() - Date.now();
      const remainingMins = Math.max(1, Math.ceil(remainingMs / 60000));
      return res.status(429).json({
        error: `Account is temporarily locked due to repeated failed login attempts. Please wait ${remainingMins} minute(s).`
      });
    }

    if (!devUser.totpSecret) {
      return res.status(500).json({ error: 'Developer TOTP secret not configured on this system.' });
    }

    const secret = decryptTotpSecret(devUser.totpSecret);
    const isValid = verifyTotpCode(secret, String(code).trim(), 1);

    if (!isValid) {
      const attempts = (devUser.failedLoginAttempts || 0) + 1;
      let lockedUntil: Date | null = null;
      let errorMsg = `Invalid TOTP code. (${Math.max(0, 5 - attempts)} attempt(s) remaining)`;

      if (attempts >= 5) {
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lock
        errorMsg = 'Too many failed login attempts. Developer access is temporarily locked for 15 minutes.';
      }

      await prisma.user.update({
        where: { id: devUser.id },
        data: { failedLoginAttempts: attempts, lockedUntil }
      });

      await prisma.auditLog.create({
        data: {
          action: 'DEV_LOGIN_FAILED',
          module: 'AUTH',
          details: `Failed TOTP login attempt for developer ${cleanEmail}. Consecutive attempts: ${attempts}`,
          userId: devUser.id,
          userName: devUser.fullName
        }
      });

      return res.status(attempts >= 5 ? 429 : 401).json({ error: errorMsg });
    }

    // Reset failed attempts on success
    await prisma.user.update({
      where: { id: devUser.id },
      data: { failedLoginAttempts: 0, lockedUntil: null }
    });

    await prisma.auditLog.create({
      data: {
        action: 'DEV_LOGIN_SUCCESS',
        module: 'AUTH',
        details: `Developer ${cleanEmail} logged in successfully via offline TOTP`,
        userId: devUser.id,
        userName: devUser.fullName
      }
    });

    const roleRow = await prisma.role.findUnique({ where: { name: 'developer' } });
    let permissions = null;
    if (roleRow && roleRow.permissions) {
      try { permissions = JSON.parse(roleRow.permissions); } catch {}
    }

    res.json({
      success: true,
      user: {
        id: devUser.id,
        username: devUser.username,
        email: devUser.email,
        full_name: devUser.fullName,
        role: devUser.role,
        status: devUser.status,
        role_display: 'System Developer',
        permissions
      }
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 2.1b Staff Login (Admin / Cashier) with bcrypt password verification
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim();
    const user = await prisma.user.findFirst({
      where: { username: cleanUsername }
    });

    if (!user) {
      await logSecurityAudit({
        action: 'LOGIN',
        module: 'AUTH',
        status: 'FAILED',
        details: `Failed login attempt for username: ${cleanUsername}`,
        affectedUser: cleanUsername
      });
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (user.status !== 'active') {
      await logSecurityAudit({
        action: 'LOGIN',
        module: 'AUTH',
        status: 'FAILED',
        details: `Login attempt on disabled account: ${cleanUsername}`,
        affectedUser: cleanUsername,
        userId: user.id,
        userName: user.username
      });
      return res.status(403).json({ error: 'This user account has been disabled. Please contact Administrator.' });
    }

    // Verify password with bcrypt + legacy auto-rehash
    const { valid, needsRehash } = await verifyPassword(password, user.password);
    if (!valid) {
      await logSecurityAudit({
        action: 'LOGIN',
        module: 'AUTH',
        status: 'FAILED',
        details: `Failed login attempt (invalid password) for user: ${cleanUsername}`,
        affectedUser: cleanUsername,
        userId: user.id,
        userName: user.username
      });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Transparently upgrade legacy plaintext password to bcrypt hash
    if (needsRehash) {
      try {
        const hashedPassword = await hashPassword(password);
        await prisma.user.update({
          where: { id: user.id },
          data: { password: hashedPassword }
        });
      } catch (rehashErr) {
        console.error('[Auth] Failed to rehash password:', rehashErr);
      }
    }

    await logSecurityAudit({
      action: 'LOGIN',
      module: 'AUTH',
      status: 'SUCCESS',
      details: `User ${user.username} logged in successfully (role: ${user.role})`,
      affectedUser: user.username,
      userId: user.id,
      userName: user.username
    });

    const roleRow = await prisma.role.findUnique({ where: { name: user.role } });
    let permissions = null;
    if (roleRow && roleRow.permissions) {
      try {
        permissions = JSON.parse(roleRow.permissions);
      } catch {
        permissions = null;
      }
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        status: user.status,
        role_display: roleRow ? roleRow.displayName : user.role,
        permissions
      }
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.put('/api/auth/profile', async (req: Request, res: Response) => {
  try {
    const { userId, username, full_name, currentPassword, newPassword } = req.body;
    if (!userId || !username || !full_name) {
      return res.status(400).json({ error: 'Missing required user profile fields' });
    }

    const idNum = Number(userId);
    const existingUser = await prisma.user.findUnique({ where: { id: idNum } });
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const duplicate = await prisma.user.findFirst({
      where: {
        username: username.trim(),
        NOT: { id: idNum }
      }
    });
    if (duplicate) {
      return res.status(400).json({ error: 'Username is already taken by another account' });
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to change password' });
      }
      const { valid } = await verifyPassword(currentPassword, existingUser.password);
      if (!valid) {
        return res.status(400).json({ error: 'Current password does not match' });
      }
      const hashedNewPassword = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: idNum },
        data: {
          username: username.trim(),
          fullName: full_name.trim(),
          password: hashedNewPassword
        }
      });
    } else {
      await prisma.user.update({
        where: { id: idNum },
        data: {
          username: username.trim(),
          fullName: full_name.trim()
        }
      });
    }

    const updatedUser = await prisma.user.findUnique({ where: { id: idNum } });
    const roleRow = updatedUser ? await prisma.role.findUnique({ where: { name: updatedUser.role } }) : null;

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser!.id,
        username: updatedUser!.username,
        email: updatedUser!.email,
        full_name: updatedUser!.fullName,
        role: updatedUser!.role,
        status: updatedUser!.status,
        role_display: roleRow ? roleRow.displayName : updatedUser!.role,
        permissions: roleRow?.permissions ? JSON.parse(roleRow.permissions) : null
      }
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/auth/change-password', async (req: Request, res: Response) => {
  try {
    const { userId, oldPassword, newPassword } = req.body;
    const idNum = Number(userId);
    const user = await prisma.user.findUnique({
      where: { id: idNum }
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { valid } = await verifyPassword(oldPassword, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Current password does not match' });
    }

    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: idNum },
      data: { password: hashedPassword }
    });
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 2.2 Users Management
app.get('/api/users', async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { id: 'asc' }
    });
    const roles = await prisma.role.findMany();
    const roleMap = new Map(roles.map(r => [r.name, r.displayName]));

    // Strictly exclude password and totpSecret
    res.json(users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      full_name: u.fullName,
      role: u.role,
      status: u.status,
      created_at: u.createdAt,
      role_display: roleMap.get(u.role) || u.role
    })));
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/users', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    const { username, password, full_name, role } = req.body;
    const targetRole = (role || 'cashier').toLowerCase();

    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (targetRole === 'developer') {
      await logSecurityAudit({
        action: 'USER_CREATE',
        module: 'USERS',
        status: 'FAILED',
        details: 'Attempt to register developer role via standard user creation',
        affectedUser: username,
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(400).json({ error: 'Developer role cannot be registered via standard user creation' });
    }

    // If acting user is NOT developer, enforce developer-configured policies
    if (actingUser?.role !== 'developer') {
      if (targetRole === 'cashier') {
        const cashierSetting = await prisma.systemSetting.findUnique({
          where: { key: 'allow_admin_create_cashier' }
        });
        if (cashierSetting?.value === 'false') {
          await logSecurityAudit({
            action: 'USER_CREATE',
            module: 'USERS',
            status: 'FAILED',
            details: 'Policy violation: Admin attempted to create cashier while disabled by developer policy',
            affectedUser: username,
            userId: actingUser?.id,
            userName: actingUser?.username
          });
          return res.status(403).json({ error: 'Creation of cashier accounts is disabled by Developer policy' });
        }
      } else if (targetRole === 'admin') {
        const adminSetting = await prisma.systemSetting.findUnique({
          where: { key: 'allow_admin_create_admin' }
        });
        if (adminSetting?.value !== 'true') {
          await logSecurityAudit({
            action: 'USER_CREATE',
            module: 'USERS',
            status: 'FAILED',
            details: 'Policy violation: Admin attempted to create administrator while disabled by developer policy',
            affectedUser: username,
            userId: actingUser?.id,
            userName: actingUser?.username
          });
          return res.status(403).json({ error: 'Creation of administrator accounts is disabled by Developer policy' });
        }
      }
    }

    const duplicate = await prisma.user.findUnique({
      where: { username: username.trim() }
    });
    if (duplicate) {
      return res.status(400).json({ error: 'Username is already in use' });
    }

    const hashedPassword = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        username: username.trim(),
        password: hashedPassword,
        fullName: full_name.trim(),
        role: targetRole,
        status: 'active'
      }
    });

    await logSecurityAudit({
      action: 'USER_CREATE',
      module: 'USERS',
      status: 'SUCCESS',
      details: `Created user ${newUser.username} with role ${newUser.role}`,
      affectedUser: newUser.username,
      userId: actingUser?.id,
      userName: actingUser?.username
    });

    res.json({ success: true, id: newUser.id });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.put('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    const idNum = Number(req.params.id);
    const { username, full_name, role, status, password } = req.body;

    const existing = await prisma.user.findUnique({ where: { id: idNum } });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only developer can modify a developer account
    if (existing.role === 'developer' && actingUser?.role !== 'developer') {
      await logSecurityAudit({
        action: 'USER_UPDATE',
        module: 'USERS',
        status: 'FAILED',
        details: `Unauthorized attempt by ${actingUser?.username || 'unknown'} to modify Developer account ${existing.username}`,
        affectedUser: existing.username,
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(403).json({ error: 'Only developer can modify developer accounts' });
    }

    if (role && role.toLowerCase() === 'developer' && existing.role !== 'developer') {
      await logSecurityAudit({
        action: 'USER_UPDATE',
        module: 'USERS',
        status: 'FAILED',
        details: `Attempt to escalate role to developer for ${existing.username}`,
        affectedUser: existing.username,
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(400).json({ error: 'Cannot escalate user role to Developer' });
    }

    if (existing.role === 'developer' && role && role.toLowerCase() !== 'developer') {
      return res.status(400).json({ error: 'Developer role cannot be downgraded' });
    }

    if (username && username.trim() !== existing.username) {
      const duplicate = await prisma.user.findFirst({
        where: {
          username: username.trim(),
          NOT: { id: idNum }
        }
      });
      if (duplicate) {
        return res.status(400).json({ error: 'Username is already taken' });
      }
    }

    const updateData: { username: string; fullName: string; role: string; status: string; password?: string } = {
      username: username ? username.trim() : existing.username,
      fullName: full_name ? full_name.trim() : existing.fullName,
      role: role || existing.role,
      status: status || existing.status,
    };
    if (password && password.trim() !== '') {
      updateData.password = await hashPassword(password.trim());
    }

    await prisma.user.update({
      where: { id: idNum },
      data: updateData
    });

    await logSecurityAudit({
      action: (password && password.trim() !== '') ? 'PASSWORD_CHANGE' : 'USER_UPDATE',
      module: 'USERS',
      status: 'SUCCESS',
      details: `Updated user ${existing.username} (role: ${updateData.role})`,
      affectedUser: existing.username,
      userId: actingUser?.id,
      userName: actingUser?.username
    });

    res.json({ success: true, message: 'User updated successfully' });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.delete('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    const idNum = Number(req.params.id);
    const targetUser = await prisma.user.findUnique({ where: { id: idNum } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser.role === 'developer') {
      await logSecurityAudit({
        action: 'USER_DELETE',
        module: 'USERS',
        status: 'FAILED',
        details: `Attempt to delete developer account ${targetUser.username}`,
        affectedUser: targetUser.username,
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(400).json({ error: 'Developer account cannot be deleted' });
    }

    if (targetUser.id === 1 || targetUser.username === 'admin') {
      return res.status(400).json({ error: 'Primary Administrator account cannot be deleted' });
    }

    await prisma.user.delete({ where: { id: idNum } });

    await logSecurityAudit({
      action: 'USER_DELETE',
      module: 'USERS',
      status: 'SUCCESS',
      details: `Deleted user ${targetUser.username} with role ${targetUser.role}`,
      affectedUser: targetUser.username,
      userId: actingUser?.id,
      userName: actingUser?.username
    });

    res.json({ success: true });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

// 2.2b Dedicated Protected Developer Endpoints
app.get('/api/developer/settings', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }

    const settingsRows = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'backup_retention_limit',
            'backup_frequency',
            'backup_scheduled_time',
            'allow_admin_create_cashier',
            'allow_admin_create_admin',
            'allow_admin_edit_store_identity',
            'allow_admin_hide_store_identity',
            'store_name',
            'store_address',
            'developer_invoice_footer',
            'developer_email'
          ]
        }
      }
    });

    const devSettings: Record<string, string> = {
      backup_retention_limit: '30',
      backup_frequency: 'daily',
      backup_scheduled_time: '23:00',
      allow_admin_create_cashier: 'true',
      allow_admin_create_admin: 'false',
      allow_admin_edit_store_identity: 'false',
      allow_admin_hide_store_identity: 'false',
      store_name: 'PharmaCare Pharmacy',
      store_address: 'Main Boulevard, Healthcare City',
      developer_invoice_footer: DEFAULT_DEVELOPER_FOOTER,
      developer_email: ''
    };

    for (const row of settingsRows) {
      devSettings[row.key] = row.value;
    }

    res.json(devSettings);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.put('/api/developer/settings', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      await logSecurityAudit({
        action: 'DEVELOPER_SETTINGS_UPDATE',
        module: 'DEVELOPER_SETTINGS',
        status: 'FAILED',
        details: 'Unauthorized attempt to modify developer settings without developer role',
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }

    const allowedKeys = [
      'backup_retention_limit',
      'backup_frequency',
      'backup_scheduled_time',
      'allow_admin_create_cashier',
      'allow_admin_create_admin',
      'allow_admin_edit_store_identity',
      'allow_admin_hide_store_identity',
      'store_name',
      'store_address',
      'developer_invoice_footer',
      'developer_email'
    ];

    const updates: Record<string, string> = {};
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) {
        updates[key] = String(req.body[key]);
      }
    }

    // Protected store identity & footer validation
    for (const key of ['store_name', 'store_address']) {
      if (updates[key] !== undefined) {
        updates[key] = updates[key].trim();
        if (!updates[key]) {
          return res.status(400).json({ error: `${key === 'store_name' ? 'Store name' : 'Store address'} cannot be empty` });
        }
      }
    }
    if (updates.developer_invoice_footer !== undefined) {
      updates.developer_invoice_footer = updates.developer_invoice_footer.trim();
      if (!updates.developer_invoice_footer) {
        return res.status(400).json({ error: 'Invoice footer cannot be empty' });
      }
      if (updates.developer_invoice_footer.length > FOOTER_MAX_LENGTH) {
        return res.status(400).json({ error: `Invoice footer cannot exceed ${FOOTER_MAX_LENGTH} characters` });
      }
    }
    for (const key of ['allow_admin_create_cashier', 'allow_admin_create_admin', 'allow_admin_edit_store_identity', 'allow_admin_hide_store_identity']) {
      if (updates[key] !== undefined && updates[key] !== 'true' && updates[key] !== 'false') {
        return res.status(400).json({ error: `${key} must be 'true' or 'false'` });
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.$transaction(
        Object.entries(updates).map(([k, v]) =>
          prisma.systemSetting.upsert({
            where: { key: k },
            update: { value: v },
            create: { key: k, value: v }
          })
        )
      );
    }

    // Trigger backup pruning if retention limit was changed
    if (updates.backup_retention_limit) {
      const limit = parseInt(updates.backup_retention_limit, 10);
      if (!isNaN(limit)) {
        pruneBackupsByRetentionLimit(limit);
      }
    }

    await logSecurityAudit({
      action: 'DEVELOPER_SETTINGS_UPDATE',
      module: 'DEVELOPER_SETTINGS',
      status: 'SUCCESS',
      details: `Updated developer settings keys: ${Object.keys(updates).join(', ')}`,
      userId: actingUser.id,
      userName: actingUser.username
    });

    res.json({ success: true, message: 'Developer settings updated successfully' });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/developer/users/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      await logSecurityAudit({
        action: 'DEVELOPER_PASSWORD_RESET',
        module: 'USERS',
        status: 'FAILED',
        details: 'Unauthorized attempt to reset user password without developer role',
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }

    const targetId = Number(req.params.id);
    const { new_password } = req.body;
    if (!new_password || typeof new_password !== 'string' || new_password.trim().length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    const hashedPassword = await hashPassword(new_password.trim());
    await prisma.user.update({
      where: { id: targetId },
      data: { password: hashedPassword }
    });

    await logSecurityAudit({
      action: 'DEVELOPER_PASSWORD_RESET',
      module: 'USERS',
      status: 'SUCCESS',
      details: `Developer reset password for user ${targetUser.username} (${targetUser.role})`,
      affectedUser: targetUser.username,
      userId: actingUser.id,
      userName: actingUser.username
    });

    res.json({ success: true, message: `Password reset successfully for ${targetUser.username}` });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.get('/api/developer/audit-logs', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || actingUser.role !== 'developer') {
      return res.status(403).json({ error: 'Access denied: Developer role required' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10)));
    const skip = (page - 1) * limit;

    const whereClause: Prisma.AuditLogWhereInput = {};
    if (req.query.module) {
      whereClause.module = String(req.query.module);
    }
    if (req.query.action) {
      whereClause.action = String(req.query.action);
    }
    if (req.query.status) {
      whereClause.status = String(req.query.status);
    }
    if (req.query.user) {
      const u = String(req.query.user);
      whereClause.OR = [
        { userName: { contains: u } },
        { affectedUser: { contains: u } }
      ];
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where: whereClause }),
      prisma.auditLog.findMany({
        where: whereClause,
        orderBy: { id: 'desc' },
        skip,
        take: limit
      })
    ]);

    res.json({
      logs: logs.map(l => ({
        id: l.id,
        action: l.action,
        module: l.module,
        details: l.details,
        affected_user: l.affectedUser,
        status: l.status,
        user_id: l.userId,
        user_name: l.userName,
        created_at: l.createdAt.toISOString()
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 2.3 Roles & Granular Permissions Management
app.get('/api/roles', async (_req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { id: 'asc' }
    });

    const userCounts = await prisma.user.groupBy({
      by: ['role'],
      _count: { id: true }
    });
    const countMap = new Map(userCounts.map(uc => [uc.role, uc._count.id]));

    const parsedRoles = roles.map(r => ({
      id: r.id,
      name: r.name,
      display_name: r.displayName,
      description: r.description,
      is_system: r.isSystem,
      created_at: r.createdAt,
      user_count: countMap.get(r.name) || 0,
      permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions
    }));

    res.json(parsedRoles);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/roles', async (req: Request, res: Response) => {
  try {
    const { name, display_name, description, permissions } = req.body;
    if (!name || !display_name || !permissions) {
      return res.status(400).json({ error: 'Role identifier, display name, and permissions are required' });
    }

    const roleKey = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').trim();
    const existing = await prisma.role.findUnique({ where: { name: roleKey } });
    if (existing) {
      return res.status(400).json({ error: `A role with identifier "${roleKey}" already exists` });
    }

    const permsJson = typeof permissions === 'string' ? permissions : JSON.stringify(permissions);
    const newRole = await prisma.role.create({
      data: {
        name: roleKey,
        displayName: display_name.trim(),
        description: description || null,
        isSystem: 0,
        permissions: permsJson
      }
    });

    res.json({ success: true, id: newRole.id });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.put('/api/roles/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const { display_name, description, permissions } = req.body;

    const role = await prisma.role.findUnique({ where: { id: idNum } });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    let permsJson = typeof permissions === 'string' ? permissions : JSON.stringify(permissions);
    if (role.name === 'admin') {
      const parsed = typeof permissions === 'string' ? JSON.parse(permissions) : permissions;
      parsed.settings = true;
      parsed.can_manage_roles = true;
      parsed.can_manage_users = true;
      permsJson = JSON.stringify(parsed);
    }

    await prisma.role.update({
      where: { id: idNum },
      data: {
        displayName: display_name || role.displayName,
        description: description !== undefined ? description : role.description,
        permissions: permsJson
      }
    });

    res.json({ success: true, message: 'Role permissions updated successfully' });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.delete('/api/roles/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const role = await prisma.role.findUnique({ where: { id: idNum } });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (role.isSystem === 1 || role.name === 'admin') {
      return res.status(400).json({ error: 'System-protected roles cannot be deleted' });
    }

    const assignedUsers = await prisma.user.count({ where: { role: role.name } });
    if (assignedUsers > 0) {
      return res.status(400).json({ error: `Cannot delete role "${role.displayName}". ${assignedUsers} user(s) are currently assigned to it.` });
    }

    await prisma.role.delete({ where: { id: idNum } });
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 3. Companies / Manufacturers
// -------------------------------------------------------------
app.get('/api/companies', async (_req: Request, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { products: true }
        }
      }
    });

    res.json(companies.map(c => ({
      id: c.id,
      code: c.code,
      name: c.name,
      contact_person: c.contactPerson,
      phone: c.phone,
      email: c.email,
      address: c.address,
      status: c.status,
      created_at: c.createdAt,
      product_count: c._count.products
    })));
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/companies', async (req: Request, res: Response) => {
  try {
    const { code, name, contact_person, phone, email, address } = req.body;
    const newCompany = await prisma.company.create({
      data: {
        code: code.toUpperCase().trim(),
        name: name.trim(),
        contactPerson: contact_person || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        status: 'active'
      }
    });
    res.json({ success: true, id: newCompany.id });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.put('/api/companies/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const { code, name, contact_person, phone, email, address, status } = req.body;
    await prisma.company.update({
      where: { id: idNum },
      data: {
        code: code.toUpperCase().trim(),
        name: name.trim(),
        contactPerson: contact_person,
        phone: phone,
        email: email,
        address: address,
        status: status || 'active'
      }
    });
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.delete('/api/companies/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    await prisma.company.delete({ where: { id: idNum } });
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 3.5 Customers & Credit Ledger (Khata)
// -------------------------------------------------------------
app.get('/api/customers', async (_req: Request, res: Response) => {
  try {
    const customers = await prisma.$queryRaw<any[]>`
      SELECT c.id, c.name, c.phone, c.address, c.credit_limit, c.current_balance, c.created_at,
        (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) as invoices_count,
        (SELECT COALESCE(SUM(s.net_total), 0) FROM sales s WHERE s.customer_id = c.id AND s.payment_type = 'Credit') as total_credit_sales,
        (SELECT COALESCE(SUM(p.amount), 0) FROM customer_payments p WHERE p.customer_id = c.id) as total_payments
      FROM customers c
      ORDER BY c.current_balance DESC, c.name ASC
    `;
    res.json(customers);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/customers', async (req: Request, res: Response) => {
  try {
    const { name, phone, address, credit_limit } = req.body;
    const newCustomer = await prisma.customer.create({
      data: {
        name: name.trim(),
        phone: phone || null,
        address: address || null,
        creditLimit: parseFloat(credit_limit) || 0,
        currentBalance: 0.0
      }
    });
    res.json({ success: true, id: newCustomer.id });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.put('/api/customers/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const { name, phone, address, credit_limit } = req.body;
    await prisma.customer.update({
      where: { id: idNum },
      data: {
        name: name.trim(),
        phone: phone || null,
        address: address || null,
        creditLimit: parseFloat(credit_limit) || 0
      }
    });
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/customers/:id/payment', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const { amount, payment_method, notes, shift_id, user_id, user_name } = req.body;
    const paymentAmt = parseFloat(amount);
    if (isNaN(paymentAmt) || paymentAmt <= 0) {
      return res.status(400).json({ error: 'Valid positive payment amount required' });
    }

    const customer = await prisma.customer.findUnique({ where: { id: idNum } });
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    let activeShiftId = shift_id ? Number(shift_id) : null;
    if (!activeShiftId && user_id) {
      const activeShift = await prisma.cashierShift.findFirst({
        where: { userId: Number(user_id), status: 'open' },
        orderBy: { id: 'desc' }
      });
      if (activeShift) {
        activeShiftId = activeShift.id;
      }
    }

    const newBalance = Math.max(0, customer.currentBalance - paymentAmt);

    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: idNum },
        data: { currentBalance: newBalance }
      });

      await tx.customerPayment.create({
        data: {
          customerId: idNum,
          amount: paymentAmt,
          paymentMethod: payment_method || 'cash',
          notes: notes || null,
          previousBalance: customer.currentBalance,
          newBalance: newBalance,
          userName: user_name || 'Cashier',
          shiftId: activeShiftId
        }
      });

      await tx.auditLog.create({
        data: {
          action: 'CUSTOMER_PAYMENT',
          module: 'Khata',
          details: `Payment received: ${paymentAmt} (${payment_method || 'Cash'}). Previous: ${customer.currentBalance}, New Balance: ${newBalance}. Notes: ${notes || 'None'}`,
          userName: 'Cashier'
        }
      });
    });

    res.json({ success: true, new_balance: newBalance });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.get('/api/customers/:id/ledger', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const customer = await prisma.customer.findUnique({ where: { id: idNum } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const sales = await prisma.sale.findMany({
      where: { customerId: idNum },
      select: {
        id: true,
        invoiceNo: true,
        saleDate: true,
        netTotal: true,
        paymentType: true,
        status: true
      },
      orderBy: { id: 'desc' }
    });

    const payments = await prisma.customerPayment.findMany({
      where: { customerId: idNum },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        notes: true,
        previousBalance: true,
        newBalance: true,
        paymentDate: true,
        userName: true
      },
      orderBy: { id: 'desc' }
    });

    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        credit_limit: customer.creditLimit,
        current_balance: customer.currentBalance,
        created_at: customer.createdAt
      },
      sales: sales.map(s => ({
        id: s.id,
        invoice_no: s.invoiceNo,
        sale_date: s.saleDate,
        net_total: s.netTotal,
        payment_type: s.paymentType,
        status: s.status
      })),
      payments: payments.map(p => ({
        id: p.id,
        amount: p.amount,
        payment_method: p.paymentMethod,
        notes: p.notes,
        previous_balance: p.previousBalance,
        new_balance: p.newBalance,
        payment_date: p.paymentDate,
        user_name: p.userName
      }))
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 4. Products Master
// -------------------------------------------------------------
app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const { q, company_id, low_stock } = req.query;
    const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

    if (q) {
      const search = `%${String(q).trim()}%`;
      conditions.push(Prisma.sql`(p.name LIKE ${search} OR p.p_code LIKE ${search} OR p.c_code LIKE ${search} OR p.barcode LIKE ${search} OR p.generic_name LIKE ${search})`);
    }

    if (company_id) {
      conditions.push(Prisma.sql`p.company_id = ${Number(company_id)}`);
    }

    if (low_stock === 'true') {
      conditions.push(Prisma.sql`p.stock_boxes <= p.min_stock_alert`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const products = await prisma.$queryRaw<any[]>`
      SELECT p.id, p.company_id, p.c_code, p.p_code, p.barcode, p.name, p.generic_name,
             p.unit_type, p.packing, p.box_trade_price, p.box_retail_price,
             p.unit_trade_price, p.unit_retail_price, p.default_discount_pct,
             p.location_rack, p.stock_boxes, p.stock_loose, p.min_stock_alert,
             p.allow_open_sale, p.min_sale_qty,
             p.status, p.created_at, p.updated_at, c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE ${whereClause}
      ORDER BY p.name ASC
    `;
    res.json(products);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.get('/api/products/search', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const searchTerm = String(q).trim();
    const searchWildcard = `%${searchTerm}%`;

    const products = await prisma.$queryRaw<any[]>`
      SELECT p.id, p.company_id, p.c_code, p.p_code, p.barcode, p.name, p.generic_name,
             p.unit_type, p.packing, p.box_trade_price, p.box_retail_price,
             p.unit_trade_price, p.unit_retail_price, p.default_discount_pct,
             p.location_rack, p.stock_boxes, p.stock_loose, p.min_stock_alert,
             p.allow_open_sale, p.min_sale_qty,
             p.status, p.created_at, p.updated_at, c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.status = 'active' AND (
        p.barcode = ${searchTerm} OR
        p.p_code LIKE ${searchWildcard} OR
        p.c_code LIKE ${searchWildcard} OR
        p.name LIKE ${searchWildcard} OR
        p.generic_name LIKE ${searchWildcard}
      )
      ORDER BY (p.barcode = ${searchTerm}) DESC, p.name ASC
      LIMIT 25
    `;

    res.json(products);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.get('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const products: any[] = await prisma.$queryRaw`
      SELECT p.id, p.company_id, p.c_code, p.p_code, p.barcode, p.name, p.generic_name,
             p.unit_type, p.packing, p.box_trade_price, p.box_retail_price,
             p.unit_trade_price, p.unit_retail_price, p.default_discount_pct,
             p.location_rack, p.stock_boxes, p.stock_loose, p.min_stock_alert,
             p.allow_open_sale, p.min_sale_qty,
             p.status, p.created_at, p.updated_at, c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.id = ${id}
      LIMIT 1
    `;
    if (!products || products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(products[0]);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/products', async (req: Request, res: Response) => {
  try {
    const {
      company_id, c_code, p_code, barcode, name, generic_name, unit_type,
      packing, box_trade_price, box_retail_price, unit_trade_price, unit_retail_price,
      default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert,
      allow_open_sale, min_sale_qty
    } = req.body;

    const newProd = await prisma.product.create({
      data: {
        companyId: company_id ? Number(company_id) : null,
        cCode: c_code,
        pCode: p_code,
        barcode: barcode || null,
        name,
        genericName: generic_name || null,
        unitType: unit_type || 'Tablets',
        packing: Number(packing) || 1,
        boxTradePrice: parseFloat(box_trade_price) || 0,
        boxRetailPrice: parseFloat(box_retail_price) || 0,
        unitTradePrice: parseFloat(unit_trade_price) || 0,
        unitRetailPrice: parseFloat(unit_retail_price) || 0,
        defaultDiscountPct: parseFloat(default_discount_pct) || 0,
        locationRack: location_rack || null,
        stockBoxes: parseInt(stock_boxes) || 0,
        stockLoose: parseInt(stock_loose) || 0,
        minStockAlert: parseInt(min_stock_alert) || 10,
        allowOpenSale: allow_open_sale !== undefined ? (allow_open_sale ? 1 : 0) : 1,
        minSaleQty: parseInt(min_sale_qty) || 1,
        status: 'active'
      }
    });

    res.json({ success: true, id: newProd.id });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.put('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const {
      company_id, c_code, p_code, barcode, name, generic_name, unit_type,
      packing, box_trade_price, box_retail_price, unit_trade_price, unit_retail_price,
      default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert, status,
      allow_open_sale, min_sale_qty
    } = req.body;

    await prisma.product.update({
      where: { id: idNum },
      data: {
        companyId: company_id ? Number(company_id) : null,
        cCode: c_code,
        pCode: p_code,
        barcode: barcode || null,
        name,
        genericName: generic_name || null,
        unitType: unit_type,
        packing: Number(packing) || 1,
        boxTradePrice: parseFloat(box_trade_price) || 0,
        boxRetailPrice: parseFloat(box_retail_price) || 0,
        unitTradePrice: parseFloat(unit_trade_price) || 0,
        unitRetailPrice: parseFloat(unit_retail_price) || 0,
        defaultDiscountPct: parseFloat(default_discount_pct) || 0,
        locationRack: location_rack || null,
        stockBoxes: parseInt(stock_boxes) || 0,
        stockLoose: parseInt(stock_loose) || 0,
        minStockAlert: parseInt(min_stock_alert) || 10,
        allowOpenSale: allow_open_sale !== undefined ? (allow_open_sale ? 1 : 0) : 1,
        minSaleQty: parseInt(min_sale_qty) || 1,
        status: status || 'active'
      }
    });

    res.json({ success: true });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.delete('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    await prisma.product.delete({ where: { id: idNum } });
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 5. Sales & Counter POS
// -------------------------------------------------------------
app.post('/api/sales', async (req: Request, res: Response) => {
  try {
    const {
      customer_id, customer_name, customer_phone, user_id, user_name,
      items, total_gross, total_item_discount, bill_discount_pct, bill_discount_amt,
      net_total, cash_tendered, change_due, payment_type, notes, shift_id
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Sale must include at least one item.' });
    }

    // Strict Shift Lock: Verify active open shift
    let activeShiftId = shift_id ? Number(shift_id) : null;
    if (!activeShiftId && user_id) {
      const activeShift = await prisma.cashierShift.findFirst({
        where: { userId: Number(user_id), status: 'open' },
        orderBy: { id: 'desc' }
      });
      if (activeShift) {
        activeShiftId = activeShift.id;
      }
    }

    if (!activeShiftId) {
      return res.status(403).json({ error: 'No active open cashier shift found. You must start a shift before invoicing.' });
    }

    const verifiedShift = await prisma.cashierShift.findUnique({ where: { id: activeShiftId } });
    if (!verifiedShift || verifiedShift.status !== 'open') {
      return res.status(403).json({ error: 'This shift is closed and locked. Sales cannot be added to a closed shift.' });
    }

    // Compute item gross, discount, and net amounts defensively
    let computedGross = 0;
    let computedItemDiscount = 0;
    const computedItems = items.map((item: any) => {
      const qty = parseFloat(item.quantity) || 1;
      const price = parseFloat(item.unit_price) || 0;
      const grossAmt = item.gross_amount !== undefined && !isNaN(parseFloat(item.gross_amount))
        ? parseFloat(item.gross_amount)
        : (qty * price);
      const discPct = parseFloat(item.discount_pct) || 0;
      const discAmt = item.discount_amount !== undefined && !isNaN(parseFloat(item.discount_amount))
        ? parseFloat(item.discount_amount)
        : (grossAmt * (discPct / 100));
      const netAmt = item.net_amount !== undefined && !isNaN(parseFloat(item.net_amount))
        ? parseFloat(item.net_amount)
        : (grossAmt - discAmt);

      computedGross += grossAmt;
      computedItemDiscount += discAmt;
      return {
        ...item,
        quantity: qty,
        unit_price: price,
        gross_amount: grossAmt,
        discount_pct: discPct,
        discount_amount: discAmt,
        net_amount: netAmt
      };
    });

    const finalTotalGross = parseFloat(total_gross) || computedGross;
    const finalItemDiscount = parseFloat(total_item_discount) || computedItemDiscount;
    const billDiscPct = parseFloat(bill_discount_pct) || 0;
    const billDiscAmt = parseFloat(bill_discount_amt) || ((finalTotalGross - finalItemDiscount) * (billDiscPct / 100));
    const finalNetTotal = parseFloat(net_total) || Math.max(0, finalTotalGross - finalItemDiscount - billDiscAmt);
    const tendered = parseFloat(cash_tendered) || parseFloat(req.body.tendered_amount) || finalNetTotal;
    const finalChangeDue = parseFloat(change_due) || Math.max(0, tendered - finalNetTotal);

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const executeSaleTransaction = async () => {
      return await prisma.$transaction(async (tx) => {
        // Query latest invoice sequence today inside transaction
        const latestSale = await tx.sale.findFirst({
          where: { invoiceNo: { startsWith: `INV-${today}-` } },
          orderBy: { id: 'desc' },
          select: { invoiceNo: true }
        });

        let nextSeq = 1;
        if (latestSale?.invoiceNo) {
          const parts = latestSale.invoiceNo.split('-');
          const lastNum = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(lastNum)) {
            nextSeq = lastNum + 1;
          }
        }
        const invoiceNo = `INV-${today}-${String(nextSeq).padStart(4, '0')}`;

        // Snapshot the protected store identity & developer footer so reprints match the original receipt
        const identityRows = await tx.systemSetting.findMany({
          where: { key: { in: ['store_name', 'store_address', 'developer_invoice_footer'] } }
        });
        const identity: Record<string, string> = {};
        for (const row of identityRows) identity[row.key] = row.value;
        const storeNameSnapshot = identity.store_name ?? null;
        const storeAddressSnapshot = identity.store_address ?? null;
        const invoiceFooterSnapshot = identity.developer_invoice_footer || DEFAULT_DEVELOPER_FOOTER;

        // 1. Insert Sale Master
        const sale = await tx.sale.create({
          data: {
            invoiceNo,
            customerId: customer_id ? Number(customer_id) : null,
            customerName: customer_name || 'Counter Customer',
            customerPhone: customer_phone || null,
            userId: user_id ? Number(user_id) : null,
            userName: user_name || 'Cashier',
            shiftId: activeShiftId,
            totalGross: finalTotalGross,
            totalItemDiscount: finalItemDiscount,
            billDiscountPct: billDiscPct,
            billDiscountAmt: billDiscAmt,
            netTotal: finalNetTotal,
            cashTendered: tendered,
            changeDue: finalChangeDue,
            paymentType: payment_type || 'Cash',
            notes: notes || null,
            storeNameSnapshot,
            storeAddressSnapshot,
            invoiceFooterSnapshot
          }
        });

      // 2. Validate Open-Sale Rules & Deduct Stock
      for (const item of computedItems) {
        const prod = await tx.product.findUnique({ where: { id: Number(item.product_id) } });
        if (!prod) throw new Error(`Product ID ${item.product_id} not found.`);

        const isLoose = item.is_loose ? 1 : 0;
        const packing = prod.packing || 1;

        // Open-Sale Validation: Prohibit selling loose units if allowOpenSale is 0
        if (isLoose && (!prod.allowOpenSale || prod.allowOpenSale === 0)) {
          throw new Error(`Open packaging sale is prohibited for "${prod.name}". This medicine cannot be sold as an individual unit. Please sell it in its original packaging.`);
        }

        // Minimum Sale Quantity Validation
        const minQty = prod.minSaleQty || 1;
        if (item.quantity < minQty) {
          const unitLabel = isLoose ? prod.unitType : 'Pack(s)';
          throw new Error(`Minimum sale quantity for "${prod.name}" is ${minQty} ${unitLabel}. (Requested: ${item.quantity})`);
        }

        const unitCost = isLoose ? prod.unitTradePrice : prod.boxTradePrice;

        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: prod.id,
            cCode: prod.cCode,
            pCode: prod.pCode,
            productName: prod.name,
            unitType: prod.unitType,
            locationRack: prod.locationRack,
            isLoose,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            unitCost,
            grossAmount: item.gross_amount,
            discountPct: item.discount_pct,
            discountAmount: item.discount_amount,
            netAmount: item.net_amount,
            batchId: item.batch_id ? Number(item.batch_id) : null
          }
        });

        // Decrement inventory logically:
        let totalCurrentUnits = (prod.stockBoxes * packing) + prod.stockLoose;
        const unitsToDeduct = isLoose ? item.quantity : (item.quantity * packing);
        totalCurrentUnits = Math.max(0, totalCurrentUnits - unitsToDeduct);

        const newBoxes = Math.floor(totalCurrentUnits / packing);
        const newLoose = totalCurrentUnits % packing;

        await tx.product.update({
          where: { id: prod.id },
          data: {
            stockBoxes: newBoxes,
            stockLoose: newLoose
          }
        });
      }

      // 3. Update customer Khata balance if credit sale
      if (payment_type === 'Credit' && customer_id) {
        await tx.customer.update({
          where: { id: Number(customer_id) },
          data: {
            currentBalance: { increment: finalNetTotal }
          }
        });
      }

        return {
          saleId: sale.id,
          invoiceNo,
          netTotal: sale.netTotal,
          changeDue: sale.changeDue,
          store_name_snapshot: storeNameSnapshot,
          store_address_snapshot: storeAddressSnapshot,
          invoice_footer_snapshot: invoiceFooterSnapshot
        };
      });
    };

    let result: any = null;
    let attempts = 0;
    while (attempts < 5) {
      try {
        attempts++;
        result = await executeSaleTransaction();
        break;
      } catch (err: any) {
        if ((err.code === 'P2002' || err.message?.includes('Unique constraint') || err.message?.includes('SQLITE_BUSY')) && attempts < 5) {
          await new Promise((r) => setTimeout(r, 25 * attempts));
          continue;
        }
        throw err;
      }
    }

    res.json({ success: true, ...result });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.get('/api/sales', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to, invoice_no, customer_id } = req.query;
    const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

    if (invoice_no) {
      const search = `%${String(invoice_no).trim()}%`;
      conditions.push(Prisma.sql`invoice_no LIKE ${search}`);
    }
    if (date_from) {
      conditions.push(Prisma.sql`DATE(sale_date) >= ${String(date_from)}`);
    }
    if (date_to) {
      conditions.push(Prisma.sql`DATE(sale_date) <= ${String(date_to)}`);
    }
    if (customer_id) {
      conditions.push(Prisma.sql`customer_id = ${Number(customer_id)}`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const sales = await prisma.$queryRaw<any[]>`
      SELECT * FROM sales
      WHERE ${whereClause}
      ORDER BY id DESC
      LIMIT 100
    `;
    res.json(sales);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.get('/api/sales/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const sale = await prisma.sale.findUnique({
      where: { id: idNum },
      include: {
        items: true
      }
    });

    if (!sale) return res.status(404).json({ error: 'Sale invoice not found' });
    res.json(formatSale(sale));
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/sales/return', async (req: Request, res: Response) => {
  try {
    const { sale_id, original_invoice_no, customer_name, return_items, reason, user_id, user_name, shift_id } = req.body;
    if (!return_items || return_items.length === 0) {
      return res.status(400).json({ error: 'No return items specified' });
    }

    // Strict Shift Lock: Verify active open shift for returns
    let activeShiftId = shift_id ? Number(shift_id) : null;
    if (!activeShiftId && user_id) {
      const activeShift = await prisma.cashierShift.findFirst({
        where: { userId: Number(user_id), status: 'open' },
        orderBy: { id: 'desc' }
      });
      if (activeShift) {
        activeShiftId = activeShift.id;
      }
    }

    if (!activeShiftId) {
      return res.status(403).json({ error: 'No active open cashier shift found. You must start a shift before processing returns.' });
    }

    const verifiedShift = await prisma.cashierShift.findUnique({ where: { id: activeShiftId } });
    if (!verifiedShift || verifiedShift.status !== 'open') {
      return res.status(403).json({ error: 'This shift is closed and locked. Returns cannot be processed under a closed shift.' });
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await prisma.saleReturn.count({
      where: { returnNo: { startsWith: `SR-${today}-` } }
    });
    const returnNo = `SR-${today}-${String(countToday + 1).padStart(4, '0')}`;

    let totalRefund = 0;
    for (const item of return_items) {
      totalRefund += Number(item.total_refund || (item.quantity * item.unit_refund_price));
    }

    const result = await prisma.$transaction(async (tx) => {
      const saleReturn = await tx.saleReturn.create({
        data: {
          returnNo,
          saleId: sale_id ? Number(sale_id) : null,
          originalInvoiceNo: original_invoice_no || null,
          customerName: customer_name || 'Customer',
          refundAmount: totalRefund,
          reason: reason || null,
          userId: user_id ? Number(user_id) : null,
          userName: user_name || 'Cashier',
          shiftId: activeShiftId
        }
      });

      for (const item of return_items) {
        const prod = await tx.product.findUnique({ where: { id: Number(item.product_id) } });
        if (prod) {
          const isLoose = item.is_loose ? 1 : 0;
          if (isLoose && (!prod.allowOpenSale || prod.allowOpenSale === 0)) {
            throw new Error(`This medicine cannot be returned as a loose unit because open packaging sales are prohibited for "${prod.name}".`);
          }
          const packing = prod.packing || 1;
          const itemRefund = item.total_refund || (item.quantity * item.unit_refund_price);

          await tx.saleReturnItem.create({
            data: {
              saleReturnId: saleReturn.id,
              productId: prod.id,
              productName: prod.name,
              isLoose,
              quantity: parseFloat(item.quantity),
              unitRefundPrice: parseFloat(item.unit_refund_price),
              totalRefund: itemRefund
            }
          });

          let totalUnits = (prod.stockBoxes * packing) + prod.stockLoose;
          const unitsToAdd = isLoose ? item.quantity : (item.quantity * packing);
          totalUnits += unitsToAdd;

          const newBoxes = Math.floor(totalUnits / packing);
          const newLoose = totalUnits % packing;

          await tx.product.update({
            where: { id: prod.id },
            data: {
              stockBoxes: newBoxes,
              stockLoose: newLoose
            }
          });
        }
      }

      if (sale_id) {
        await tx.sale.update({
          where: { id: Number(sale_id) },
          data: { status: 'returned' }
        });
      }

      return { returnId: saleReturn.id, returnNo, totalRefund };
    });

    res.json({ success: true, ...result });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 6. Purchases & Supplier Inward
// -------------------------------------------------------------
app.get('/api/purchases', async (_req: Request, res: Response) => {
  try {
    const purchases = await prisma.$queryRaw<any[]>`
      SELECT p.*, c.name as company_name, c.code as company_code
      FROM purchases p
      LEFT JOIN companies c ON p.company_id = c.id
      ORDER BY p.id DESC LIMIT 100
    `;
    res.json(purchases);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/purchases', async (req: Request, res: Response) => {
  try {
    const {
      supplier_invoice_no, company_id, purchase_date, items,
      total_gross, discount_amount, tax_amount, net_total, payment_status, notes, user_id
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Purchase must have items' });
    }

    const company = await prisma.company.findUnique({ where: { id: Number(company_id) } });
    if (!company) return res.status(400).json({ error: 'Company not found' });

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await prisma.purchase.count({
      where: { invoiceNo: { startsWith: `PUR-${today}-` } }
    });
    const invoiceNo = `PUR-${today}-${String(countToday + 1).padStart(4, '0')}`;

    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          invoiceNo,
          supplierInvoiceNo: supplier_invoice_no || null,
          companyId: company.id,
          companyName: company.name,
          purchaseDate: purchase_date || new Date().toISOString().split('T')[0],
          totalGross: parseFloat(total_gross) || 0,
          discountAmount: parseFloat(discount_amount) || 0,
          taxAmount: parseFloat(tax_amount) || 0,
          netTotal: parseFloat(net_total) || 0,
          paymentStatus: payment_status || 'Paid',
          notes: notes || null,
          userId: user_id ? Number(user_id) : null
        }
      });

      for (const item of items) {
        const prod = await tx.product.findUnique({ where: { id: Number(item.product_id) } });
        if (prod) {
          const qtyBoxes = Number(item.quantity_boxes ?? item.boxes ?? 0);
          const bonusBoxes = Number(item.bonus_boxes || 0);
          const totalBoxes = qtyBoxes + bonusBoxes;
          const packing = prod.packing || 1;
          const boxCost = Number(item.box_cost_price ?? item.box_trade_price ?? prod.boxTradePrice ?? 0);
          const boxRetail = Number(item.box_retail_price ?? prod.boxRetailPrice ?? 0);
          const unitCost = packing > 0 ? (boxCost / packing) : boxCost;
          const unitRetail = packing > 0 ? (boxRetail / packing) : boxRetail;
          const discPct = parseFloat(item.discount_pct) || 0;
          const totalCost = item.total_cost !== undefined ? parseFloat(item.total_cost) : (qtyBoxes * boxCost * (1 - discPct / 100));

          await tx.purchaseItem.create({
            data: {
              purchaseId: purchase.id,
              productId: prod.id,
              productName: prod.name,
              batchNo: item.batch_no || 'NA',
              expiryDate: item.expiry_date || '',
              quantityBoxes: qtyBoxes,
              bonusBoxes: bonusBoxes,
              boxCostPrice: boxCost,
              boxRetailPrice: boxRetail,
              discountPct: discPct,
              totalCost: totalCost
            }
          });

          await tx.product.update({
            where: { id: prod.id },
            data: {
              stockBoxes: { increment: totalBoxes },
              boxTradePrice: boxCost,
              boxRetailPrice: boxRetail,
              unitTradePrice: unitCost,
              unitRetailPrice: unitRetail
            }
          });

          await tx.productBatch.create({
            data: {
              productId: prod.id,
              batchNo: item.batch_no || 'B-NEW',
              expiryDate: item.expiry_date || '',
              purchaseCost: boxCost,
              retailPrice: boxRetail,
              quantityBoxes: totalBoxes
            }
          });
        }
      }

      return { purchaseId: purchase.id, invoiceNo };
    });

    res.json({ success: true, ...result });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 7. Comprehensive Reports Engine
// -------------------------------------------------------------

// Available Stock with valuation
app.get('/api/reports/stock/available', async (_req: Request, res: Response) => {
  try {
    const stock = await prisma.$queryRaw<any[]>`
      SELECT 
        p.id, p.c_code, p.p_code, p.name, p.generic_name, p.unit_type, p.packing,
        p.location_rack, p.stock_boxes, p.stock_loose, p.box_trade_price, p.box_retail_price,
        p.unit_trade_price, p.unit_retail_price,
        ((p.stock_boxes * p.box_trade_price) + (p.stock_loose * p.unit_trade_price)) as total_cost_value,
        ((p.stock_boxes * p.box_retail_price) + (p.stock_loose * p.unit_retail_price)) as total_retail_value,
        c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.status = 'active'
      ORDER BY p.name ASC
    `;
    res.json(stock);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// Expired & Near-Expiry Products
app.get('/api/reports/stock/expired', async (req: Request, res: Response) => {
  try {
    const days = req.query.days ? String(req.query.days) : '0';
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + Number(days));
    const targetStr = targetDate.toISOString().split('T')[0];

    const expired = await prisma.$queryRaw<any[]>`
      SELECT 
        b.id as batch_id, b.batch_no, b.expiry_date, b.quantity_boxes, b.quantity_loose,
        p.id as product_id, p.c_code, p.p_code, p.name as product_name, p.unit_type, p.location_rack,
        p.box_trade_price, (b.quantity_boxes * p.box_trade_price) as loss_valuation,
        c.name as company_name
      FROM product_batches b
      JOIN products p ON b.product_id = p.id
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE b.expiry_date <= ${targetStr} AND (b.quantity_boxes > 0 OR b.quantity_loose > 0)
      ORDER BY b.expiry_date ASC
    `;

    res.json(expired);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// Finished / Zero stock
app.get('/api/reports/stock/finished', async (_req: Request, res: Response) => {
  try {
    const finished = await prisma.$queryRaw<any[]>`
      SELECT p.id, p.c_code, p.p_code, p.name, p.unit_type, p.location_rack, p.box_retail_price, c.name as company_name
      FROM products p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.stock_boxes = 0 AND p.stock_loose = 0 AND p.status = 'active'
      ORDER BY p.name ASC
    `;
    res.json(finished);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// Sales & Profit/Loss Summary
app.get('/api/reports/financial/pnl-summary', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query;
    const conditions: Prisma.Sql[] = [Prisma.sql`s.status = 'completed'`];

    if (date_from) {
      conditions.push(Prisma.sql`DATE(s.sale_date) >= ${String(date_from)}`);
    }
    if (date_to) {
      conditions.push(Prisma.sql`DATE(s.sale_date) <= ${String(date_to)}`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const pnlRaw = await prisma.$queryRaw<any[]>`
      SELECT 
        COUNT(DISTINCT s.id) as total_invoices,
        COALESCE(SUM(si.net_amount), 0) as total_revenue,
        COALESCE(SUM(si.quantity * si.unit_cost), 0) as total_cost_of_goods,
        COALESCE(SUM(si.net_amount) - SUM(si.quantity * si.unit_cost) - SUM(s.bill_discount_amt), 0) as gross_profit
      FROM sales s
      JOIN sale_items si ON s.id = si.sale_id
      WHERE ${whereClause}
    `;

    res.json(pnlRaw[0] || { total_invoices: 0, total_revenue: 0, total_cost_of_goods: 0, gross_profit: 0 });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// Invoice-wise P&L
app.get('/api/reports/financial/invoice-pnl', async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query;
    const conditions: Prisma.Sql[] = [Prisma.sql`s.status = 'completed'`];

    if (date_from) {
      conditions.push(Prisma.sql`DATE(s.sale_date) >= ${String(date_from)}`);
    }
    if (date_to) {
      conditions.push(Prisma.sql`DATE(s.sale_date) <= ${String(date_to)}`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const list = await prisma.$queryRaw<any[]>`
      SELECT 
        s.id, s.invoice_no, s.sale_date, s.customer_name, s.payment_type,
        s.net_total as sale_amount,
        SUM(si.quantity * si.unit_cost) as total_cost,
        (s.net_total - SUM(si.quantity * si.unit_cost)) as net_profit,
        ROUND(((s.net_total - SUM(si.quantity * si.unit_cost)) / NULLIF(s.net_total, 0)) * 100, 2) as profit_margin_pct
      FROM sales s
      JOIN sale_items si ON s.id = si.sale_id
      WHERE ${whereClause}
      GROUP BY s.id
      ORDER BY s.id DESC
      LIMIT 100
    `;

    res.json(list);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// Product-wise sales
app.get('/api/reports/sales/product-wise', async (_req: Request, res: Response) => {
  try {
    const list = await prisma.$queryRaw<any[]>`
      SELECT 
        si.product_id, si.c_code, si.p_code, si.product_name, si.unit_type,
        SUM(si.quantity) as total_quantity_sold,
        SUM(si.net_amount) as total_sales_amount,
        SUM(si.quantity * si.unit_cost) as total_cost_amount,
        (SUM(si.net_amount) - SUM(si.quantity * si.unit_cost)) as gross_profit
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed'
      GROUP BY si.product_id
      ORDER BY total_sales_amount DESC
      LIMIT 50
    `;
    res.json(list);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// Company-wise sales
app.get('/api/reports/sales/company-wise', async (_req: Request, res: Response) => {
  try {
    const list = await prisma.$queryRaw<any[]>`
      SELECT 
        si.c_code as company_code,
        c.name as company_name,
        COUNT(DISTINCT s.id) as invoice_count,
        SUM(si.quantity) as total_units_sold,
        SUM(si.net_amount) as total_revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN companies c ON si.c_code = c.code
      WHERE s.status = 'completed'
      GROUP BY si.c_code
      ORDER BY total_revenue DESC
    `;
    res.json(list);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 8. Utilities: Local Backup & Restore, Stock Zero, Optimization
// -------------------------------------------------------------

app.get('/api/utilities/backups', (_req: Request, res: Response) => {
  try {
    const list = getBackupList();
    res.json(list);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/utilities/backup', async (req: Request, res: Response) => {
  const { customDir, secondaryDir } = req.body;
  try {
    let finalSecondary = secondaryDir;
    if (!finalSecondary) {
      const secRow = await prisma.systemSetting.findUnique({ where: { key: 'secondary_backup_dir' } });
      if (secRow && secRow.value) finalSecondary = secRow.value;
    }

    const result = await createBackup('manual', customDir, finalSecondary);

    // Save timestamp & path in settings
    await prisma.systemSetting.upsert({
      where: { key: 'last_backup_time' },
      update: { value: result.timestamp },
      create: { key: 'last_backup_time', value: result.timestamp }
    });
    await prisma.systemSetting.upsert({
      where: { key: 'last_backup_file' },
      update: { value: result.filepath },
      create: { key: 'last_backup_file', value: result.filepath }
    });

    res.json(result);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// Auto-Backup Background Scheduler (runs every 30 minutes)
setInterval(async () => {
  try {
    const enabledRow = await prisma.systemSetting.findUnique({ where: { key: 'auto_backup_enabled' } });
    if (enabledRow?.value !== 'true') return;

    const intervalRow = await prisma.systemSetting.findUnique({ where: { key: 'auto_backup_interval_hours' } });
    const intervalHours = Number(intervalRow?.value || '24');
    const intervalMs = intervalHours * 60 * 60 * 1000;

    const lastTimeRow = await prisma.systemSetting.findUnique({ where: { key: 'last_backup_time' } });
    const lastBackupMs = lastTimeRow?.value ? new Date(lastTimeRow.value).getTime() : 0;
    const now = Date.now();

    if (now - lastBackupMs >= intervalMs) {
      console.log('[Auto-Backup] Triggering scheduled database backup...');
      const targetDirRow = await prisma.systemSetting.findUnique({ where: { key: 'auto_backup_dir' } });
      const secondaryDirRow = await prisma.systemSetting.findUnique({ where: { key: 'secondary_backup_dir' } });

      const result = await createBackup(
        'auto_daily',
        targetDirRow?.value || undefined,
        secondaryDirRow?.value || undefined
      );

      await prisma.systemSetting.upsert({
        where: { key: 'last_backup_time' },
        update: { value: result.timestamp },
        create: { key: 'last_backup_time', value: result.timestamp }
      });
      await prisma.systemSetting.upsert({
        where: { key: 'last_backup_file' },
        update: { value: result.filepath },
        create: { key: 'last_backup_file', value: result.filepath }
      });

      console.log(`[Auto-Backup] Scheduled backup completed: ${result.filename} (${(result.sizeBytes / 1024).toFixed(1)} KB)`);
    }
  } catch (err: any) {
    console.error('[Auto-Backup Daemon] Error:', err.message);
  }
}, 30 * 60 * 1000);

app.post('/api/utilities/restore', async (req: Request, res: Response) => {
  const { backupFilePath } = req.body;
  if (!backupFilePath) {
    return res.status(400).json({ error: 'backupFilePath is required' });
  }

  try {
    const result = await restoreDatabase(backupFilePath);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/utilities/stock-zero', (req: Request, res: Response) => {
  const { company_id, confirmation_code, user_id, user_name } = req.body;
  if (confirmation_code !== 'RESET-ZERO-CONFIRM') {
    return res.status(400).json({ error: 'Invalid confirmation code. Please enter RESET-ZERO-CONFIRM to proceed.' });
  }

  try {
    const affected = resetStockZero(company_id ? Number(company_id) : undefined, user_id, user_name);
    res.json({ success: true, message: `Successfully zeroed stock for ${affected} product(s).`, affected });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/utilities/optimize', (_req: Request, res: Response) => {
  try {
    const result = optimizeDatabase();
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 8b. Cashier Shift Management & Drawer Reconciliation
// -------------------------------------------------------------

function formatShiftDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// 1. Get active shift for a cashier user
app.get('/api/shifts/active', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const shift = await prisma.cashierShift.findFirst({
      where: {
        userId: Number(user_id),
        status: 'open'
      },
      orderBy: { id: 'desc' }
    });

    if (!shift) {
      return res.json({ activeShift: null });
    }

    // Compute live shift stats
    const [sales, returns, customerPayments] = await Promise.all([
      prisma.sale.findMany({
        where: { shiftId: shift.id },
        select: { netTotal: true, cashTendered: true, changeDue: true, paymentType: true }
      }),
      prisma.saleReturn.findMany({
        where: { shiftId: shift.id },
        select: { refundAmount: true }
      }),
      prisma.customerPayment.findMany({
        where: { shiftId: shift.id },
        select: { amount: true, paymentMethod: true }
      })
    ]);

    let totalCashSales = 0;
    let totalCardSales = 0;
    let totalCreditSales = 0;
    let totalSalesAmount = 0;

    for (const s of sales) {
      totalSalesAmount += s.netTotal;
      if (s.paymentType === 'Cash') {
        totalCashSales += s.netTotal;
      } else if (s.paymentType === 'Card') {
        totalCardSales += s.netTotal;
      } else if (s.paymentType === 'Credit') {
        totalCreditSales += s.netTotal;
      }
    }

    let totalReturnsCash = 0;
    for (const r of returns) {
      totalReturnsCash += r.refundAmount;
    }

    let totalCustomerPaymentsCash = 0;
    for (const cp of customerPayments) {
      if (cp.paymentMethod.toLowerCase() === 'cash') {
        totalCustomerPaymentsCash += cp.amount;
      }
    }

    const expectedCash = shift.openingCash + totalCashSales + totalCustomerPaymentsCash - totalReturnsCash;
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(shift.startTime).getTime()) / 60000));

    res.json({
      activeShift: {
        id: shift.id,
        shift_no: shift.shiftNo,
        user_id: shift.userId,
        user_name: shift.userName,
        start_time: shift.startTime,
        end_time: shift.endTime,
        duration_minutes: elapsedMinutes,
        opening_cash: shift.openingCash,
        closing_cash: shift.closingCash,
        expected_cash: expectedCash,
        cash_difference: shift.cashDifference,
        total_sales_count: sales.length,
        total_sales_amount: totalSalesAmount,
        total_cash_sales: totalCashSales,
        total_card_sales: totalCardSales,
        total_credit_sales: totalCreditSales,
        total_returns_amount: totalReturnsCash,
        total_customer_payments: totalCustomerPaymentsCash,
        notes: shift.notes,
        status: shift.status
      },
      summary: {
        opening_cash: shift.openingCash,
        total_sales_cash: totalCashSales,
        total_sales_card: totalCardSales,
        total_sales_credit: totalCreditSales,
        total_returns_cash: totalReturnsCash,
        total_customer_payments_cash: totalCustomerPaymentsCash,
        expected_cash: expectedCash,
        invoices_count: sales.length,
        returns_count: returns.length,
        duration_formatted: formatShiftDuration(elapsedMinutes)
      }
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 2. Open a new cashier shift
app.post('/api/shifts/start', async (req: Request, res: Response) => {
  try {
    const { user_id, user_name, opening_cash, notes } = req.body;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Check if user already has an open shift
    const existingOpen = await prisma.cashierShift.findFirst({
      where: {
        userId: Number(user_id),
        status: 'open'
      }
    });

    if (existingOpen) {
      return res.status(400).json({
        error: `User already has an active open shift (${existingOpen.shiftNo}). You must close it before starting a new one.`,
        activeShift: existingOpen
      });
    }

    // Generate unique shift number: e.g. SH-YYYYMMDD-0001
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await prisma.cashierShift.count({
      where: { shiftNo: { startsWith: `SH-${today}-` } }
    });
    const shiftNo = `SH-${today}-${String(countToday + 1).padStart(4, '0')}`;

    const newShift = await prisma.cashierShift.create({
      data: {
        shiftNo,
        userId: Number(user_id),
        userName: user_name || 'Cashier',
        startTime: new Date(),
        openingCash: parseFloat(opening_cash) || 0,
        notes: notes || null,
        status: 'open'
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'SHIFT_OPENED',
        module: 'Shift Management',
        details: `Shift ${shiftNo} opened by ${user_name} with opening float ${opening_cash || 0}`,
        userId: Number(user_id),
        userName: user_name || 'Cashier'
      }
    });

    res.json({
      success: true,
      shift: {
        id: newShift.id,
        shift_no: newShift.shiftNo,
        user_id: newShift.userId,
        user_name: newShift.userName,
        start_time: newShift.startTime,
        opening_cash: newShift.openingCash,
        status: newShift.status,
        notes: newShift.notes
      }
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 3. Get live summary for active shift closing modal
app.get('/api/shifts/:id/summary', async (req: Request, res: Response) => {
  try {
    const shiftId = Number(req.params.id);
    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const [sales, returns, customerPayments] = await Promise.all([
      prisma.sale.findMany({
        where: { shiftId: shift.id },
        select: { id: true, invoiceNo: true, netTotal: true, cashTendered: true, changeDue: true, paymentType: true, saleDate: true }
      }),
      prisma.saleReturn.findMany({
        where: { shiftId: shift.id },
        select: { id: true, returnNo: true, refundAmount: true, createdAt: true }
      }),
      prisma.customerPayment.findMany({
        where: { shiftId: shift.id },
        select: { id: true, amount: true, paymentMethod: true, paymentDate: true }
      })
    ]);

    let totalCashSales = 0;
    let totalCardSales = 0;
    let totalCreditSales = 0;
    let totalSalesAmount = 0;

    for (const s of sales) {
      totalSalesAmount += s.netTotal;
      if (s.paymentType === 'Cash') {
        totalCashSales += s.netTotal;
      } else if (s.paymentType === 'Card') {
        totalCardSales += s.netTotal;
      } else if (s.paymentType === 'Credit') {
        totalCreditSales += s.netTotal;
      }
    }

    let totalReturnsCash = 0;
    for (const r of returns) {
      totalReturnsCash += r.refundAmount;
    }

    let totalCustomerPaymentsCash = 0;
    for (const cp of customerPayments) {
      if (cp.paymentMethod.toLowerCase() === 'cash') {
        totalCustomerPaymentsCash += cp.amount;
      }
    }

    const expectedCash = shift.openingCash + totalCashSales + totalCustomerPaymentsCash - totalReturnsCash;
    const endTime = shift.endTime || new Date();
    const durationMinutes = Math.max(1, Math.round((new Date(endTime).getTime() - new Date(shift.startTime).getTime()) / 60000));

    res.json({
      shift: {
        id: shift.id,
        shift_no: shift.shiftNo,
        user_id: shift.userId,
        user_name: shift.userName,
        start_time: shift.startTime,
        end_time: shift.endTime,
        duration_minutes: durationMinutes,
        opening_cash: shift.openingCash,
        closing_cash: shift.closingCash,
        expected_cash: shift.expectedCash || expectedCash,
        cash_difference: shift.cashDifference,
        total_sales_count: sales.length,
        total_sales_amount: totalSalesAmount,
        total_cash_sales: totalCashSales,
        total_card_sales: totalCardSales,
        total_credit_sales: totalCreditSales,
        total_returns_amount: totalReturnsCash,
        total_customer_payments: totalCustomerPaymentsCash,
        notes: shift.notes,
        status: shift.status
      },
      summary: {
        opening_cash: shift.openingCash,
        total_sales_cash: totalCashSales,
        total_sales_card: totalCardSales,
        total_sales_credit: totalCreditSales,
        total_returns_cash: totalReturnsCash,
        total_customer_payments_cash: totalCustomerPaymentsCash,
        expected_cash: expectedCash,
        invoices_count: sales.length,
        returns_count: returns.length,
        duration_formatted: formatShiftDuration(durationMinutes)
      }
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 4. Reconcile, close, and lock shift
app.post('/api/shifts/:id/close', async (req: Request, res: Response) => {
  try {
    const shiftId = Number(req.params.id);
    const { actual_cash, notes, user_id, user_name } = req.body;

    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    if (shift.status === 'closed') {
      return res.status(400).json({ error: 'Shift is already closed and locked.' });
    }

    const [sales, returns, customerPayments] = await Promise.all([
      prisma.sale.findMany({
        where: { shiftId: shift.id },
        select: { netTotal: true, paymentType: true }
      }),
      prisma.saleReturn.findMany({
        where: { shiftId: shift.id },
        select: { refundAmount: true }
      }),
      prisma.customerPayment.findMany({
        where: { shiftId: shift.id },
        select: { amount: true, paymentMethod: true }
      })
    ]);

    let totalCashSales = 0;
    let totalCardSales = 0;
    let totalCreditSales = 0;
    let totalSalesAmount = 0;

    for (const s of sales) {
      totalSalesAmount += s.netTotal;
      if (s.paymentType === 'Cash') totalCashSales += s.netTotal;
      else if (s.paymentType === 'Card') totalCardSales += s.netTotal;
      else if (s.paymentType === 'Credit') totalCreditSales += s.netTotal;
    }

    let totalReturnsCash = 0;
    for (const r of returns) {
      totalReturnsCash += r.refundAmount;
    }

    let totalCustomerPaymentsCash = 0;
    for (const cp of customerPayments) {
      if (cp.paymentMethod.toLowerCase() === 'cash') totalCustomerPaymentsCash += cp.amount;
    }

    const expectedCash = shift.openingCash + totalCashSales + totalCustomerPaymentsCash - totalReturnsCash;
    const actualCashNum = parseFloat(actual_cash) || 0;
    const difference = actualCashNum - expectedCash;
    const now = new Date();
    const durationMinutes = Math.max(1, Math.round((now.getTime() - new Date(shift.startTime).getTime()) / 60000));

    const updatedShift = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: 'closed',
        endTime: now,
        durationMinutes: durationMinutes,
        closingCash: actualCashNum,
        expectedCash: expectedCash,
        cashDifference: difference,
        totalSalesCount: sales.length,
        totalSalesAmount: totalSalesAmount,
        totalCashSales: totalCashSales,
        totalCardSales: totalCardSales,
        totalCreditSales: totalCreditSales,
        totalReturnsAmount: totalReturnsCash,
        totalCustomerPayments: totalCustomerPaymentsCash,
        notes: notes || shift.notes
      }
    });

    // Auto-backup on shift close if configured
    let backupResult = null;
    const autoBackupSetting = await prisma.systemSetting.findUnique({ where: { key: 'auto_backup_enabled' } });
    if (autoBackupSetting?.value === 'true') {
      try {
        backupResult = await createBackup('auto_daily');
      } catch (bkErr) {
        console.error('Auto backup during shift closing error:', bkErr);
      }
    }

    // Write audit log
    await prisma.auditLog.create({
      data: {
        action: 'SHIFT_CLOSED',
        module: 'Shift Management',
        details: `Shift ${shift.shiftNo} closed by ${user_name || shift.userName}. Duration: ${formatShiftDuration(durationMinutes)}. Expected: ${expectedCash}, Actual: ${actualCashNum}, Variance: ${difference}`,
        userId: user_id ? Number(user_id) : shift.userId,
        userName: user_name || shift.userName
      }
    });

    res.json({
      success: true,
      message: 'Shift reconciled and locked successfully.',
      shift: {
        id: updatedShift.id,
        shift_no: updatedShift.shiftNo,
        user_id: updatedShift.userId,
        user_name: updatedShift.userName,
        start_time: updatedShift.startTime,
        end_time: updatedShift.endTime,
        duration_minutes: updatedShift.durationMinutes,
        opening_cash: updatedShift.openingCash,
        closing_cash: updatedShift.closingCash,
        expected_cash: updatedShift.expectedCash,
        cash_difference: updatedShift.cashDifference,
        total_sales_count: updatedShift.totalSalesCount,
        total_sales_amount: updatedShift.totalSalesAmount,
        total_cash_sales: updatedShift.totalCashSales,
        total_card_sales: updatedShift.totalCardSales,
        total_credit_sales: updatedShift.totalCreditSales,
        total_returns_amount: updatedShift.totalReturnsAmount,
        total_customer_payments: updatedShift.totalCustomerPayments,
        notes: updatedShift.notes,
        status: updatedShift.status
      },
      backup: backupResult
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 5. List all shifts with filters
app.get('/api/shifts', async (req: Request, res: Response) => {
  try {
    const { user_id, status, date_from, date_to } = req.query;
    const where: Prisma.CashierShiftWhereInput = {};

    if (user_id) where.userId = Number(user_id);
    if (status) where.status = String(status);
    if (date_from || date_to) {
      where.startTime = {};
      if (date_from) where.startTime.gte = new Date(`${date_from}T00:00:00.000Z`);
      if (date_to) where.startTime.lte = new Date(`${date_to}T23:59:59.999Z`);
    }

    const shifts = await prisma.cashierShift.findMany({
      where,
      orderBy: { id: 'desc' }
    });

    const result = await Promise.all(shifts.map(async (s) => {
      if (s.status === 'open') {
        const [sales, returns, customerPayments] = await Promise.all([
          prisma.sale.findMany({
            where: { shiftId: s.id },
            select: { netTotal: true, paymentType: true }
          }),
          prisma.saleReturn.findMany({
            where: { shiftId: s.id },
            select: { refundAmount: true }
          }),
          prisma.customerPayment.findMany({
            where: { shiftId: s.id },
            select: { amount: true, paymentMethod: true }
          })
        ]);

        let totalCashSales = 0;
        let totalCardSales = 0;
        let totalCreditSales = 0;
        let totalSalesAmount = 0;
        for (const sale of sales) {
          totalSalesAmount += sale.netTotal;
          if (sale.paymentType === 'Cash') totalCashSales += sale.netTotal;
          else if (sale.paymentType === 'Card') totalCardSales += sale.netTotal;
          else if (sale.paymentType === 'Credit') totalCreditSales += sale.netTotal;
        }

        const totalReturnsAmount = returns.reduce((sum, r) => sum + r.refundAmount, 0);
        const totalCustomerPayments = customerPayments.filter(p => p.paymentMethod.toLowerCase() === 'cash').reduce((sum, p) => sum + p.amount, 0);
        const expectedCash = s.openingCash + totalCashSales + totalCustomerPayments - totalReturnsAmount;
        const durationMinutes = Math.max(0, Math.floor((Date.now() - new Date(s.startTime).getTime()) / 60000));

        return {
          id: s.id,
          shift_no: s.shiftNo,
          user_id: s.userId,
          user_name: s.userName,
          start_time: s.startTime,
          end_time: s.endTime,
          duration_minutes: durationMinutes,
          opening_cash: s.openingCash,
          closing_cash: s.closingCash,
          expected_cash: expectedCash,
          cash_difference: s.cashDifference,
          total_sales_count: sales.length,
          total_sales_amount: totalSalesAmount,
          total_cash_sales: totalCashSales,
          total_card_sales: totalCardSales,
          total_credit_sales: totalCreditSales,
          total_returns_amount: totalReturnsAmount,
          total_customer_payments: totalCustomerPayments,
          notes: s.notes,
          status: s.status,
          created_at: s.createdAt,
          updated_at: s.updatedAt
        };
      }

      return {
        id: s.id,
        shift_no: s.shiftNo,
        user_id: s.userId,
        user_name: s.userName,
        start_time: s.startTime,
        end_time: s.endTime,
        duration_minutes: s.durationMinutes,
        opening_cash: s.openingCash,
        closing_cash: s.closingCash,
        expected_cash: s.expectedCash,
        cash_difference: s.cashDifference,
        total_sales_count: s.totalSalesCount,
        total_sales_amount: s.totalSalesAmount,
        total_cash_sales: s.totalCashSales,
        total_card_sales: s.totalCardSales,
        total_credit_sales: s.totalCreditSales,
        total_returns_amount: s.totalReturnsAmount,
        total_customer_payments: s.totalCustomerPayments,
        notes: s.notes,
        status: s.status,
        created_at: s.createdAt,
        updated_at: s.updatedAt
      };
    }));

    res.json(result);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 6. Get shift details with transactions
app.get('/api/shifts/:id', async (req: Request, res: Response) => {
  try {
    const shiftId = Number(req.params.id);
    const shift = await prisma.cashierShift.findUnique({
      where: { id: shiftId },
      include: {
        sales: {
          select: {
            id: true,
            invoiceNo: true,
            customerName: true,
            totalGross: true,
            netTotal: true,
            paymentType: true,
            saleDate: true,
            status: true
          },
          orderBy: { id: 'desc' }
        },
        saleReturns: {
          select: {
            id: true,
            returnNo: true,
            originalInvoiceNo: true,
            customerName: true,
            refundAmount: true,
            reason: true,
            createdAt: true
          },
          orderBy: { id: 'desc' }
        },
        customerPayments: {
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
            notes: true,
            paymentDate: true
          },
          orderBy: { id: 'desc' }
        }
      }
    });

    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    let totalSalesCount = shift.totalSalesCount;
    let totalSalesAmount = shift.totalSalesAmount;
    let totalCashSales = shift.totalCashSales;
    let totalCardSales = shift.totalCardSales;
    let totalCreditSales = shift.totalCreditSales;
    let totalReturnsAmount = shift.totalReturnsAmount;
    let totalCustomerPayments = shift.totalCustomerPayments;
    let expectedCash = shift.expectedCash;
    let durationMinutes = shift.durationMinutes;

    if (shift.status === 'open') {
      totalSalesCount = shift.sales.length;
      totalSalesAmount = 0;
      totalCashSales = 0;
      totalCardSales = 0;
      totalCreditSales = 0;
      for (const s of shift.sales) {
        totalSalesAmount += s.netTotal;
        if (s.paymentType === 'Cash') totalCashSales += s.netTotal;
        else if (s.paymentType === 'Card') totalCardSales += s.netTotal;
        else if (s.paymentType === 'Credit') totalCreditSales += s.netTotal;
      }
      totalReturnsAmount = shift.saleReturns.reduce((sum, r) => sum + r.refundAmount, 0);
      totalCustomerPayments = shift.customerPayments.filter(p => p.paymentMethod.toLowerCase() === 'cash').reduce((sum, p) => sum + p.amount, 0);
      expectedCash = shift.openingCash + totalCashSales + totalCustomerPayments - totalReturnsAmount;
      durationMinutes = Math.max(0, Math.floor((Date.now() - new Date(shift.startTime).getTime()) / 60000));
    }

    res.json({
      shift: {
        id: shift.id,
        shift_no: shift.shiftNo,
        user_id: shift.userId,
        user_name: shift.userName,
        start_time: shift.startTime,
        end_time: shift.endTime,
        duration_minutes: durationMinutes,
        opening_cash: shift.openingCash,
        closing_cash: shift.closingCash,
        expected_cash: expectedCash,
        cash_difference: shift.cashDifference,
        total_sales_count: totalSalesCount,
        total_sales_amount: totalSalesAmount,
        total_cash_sales: totalCashSales,
        total_card_sales: totalCardSales,
        total_credit_sales: totalCreditSales,
        total_returns_amount: totalReturnsAmount,
        total_customer_payments: totalCustomerPayments,
        notes: shift.notes,
        status: shift.status
      },
      sales: shift.sales.map(s => ({
        id: s.id,
        invoice_no: s.invoiceNo,
        customer_name: s.customerName,
        total_gross: s.totalGross,
        net_total: s.netTotal,
        payment_type: s.paymentType,
        sale_date: s.saleDate,
        status: s.status
      })),
      returns: shift.saleReturns.map(r => ({
        id: r.id,
        return_no: r.returnNo,
        original_invoice_no: r.originalInvoiceNo,
        customer_name: r.customerName,
        refund_amount: r.refundAmount,
        reason: r.reason,
        created_at: r.createdAt
      })),
      payments: shift.customerPayments.map(p => ({
        id: p.id,
        amount: p.amount,
        payment_method: p.paymentMethod,
        notes: p.notes,
        payment_date: p.paymentDate
      }))
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 7. Admin Exceptional Reopen
app.post('/api/shifts/:id/admin/reopen', async (req: Request, res: Response) => {
  try {
    const shiftId = Number(req.params.id);
    const { admin_id, admin_name, reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A mandatory reason is required for reopening a closed shift.' });
    }

    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    if (shift.status === 'open') {
      return res.status(400).json({ error: 'Shift is already open.' });
    }

    const updated = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: 'open',
        endTime: null,
        durationMinutes: null
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_SHIFT_REOPEN',
        module: 'Shift Management',
        details: `Shift ${shift.shiftNo} reopened by Admin ${admin_name || 'Admin'} (ID #${admin_id}). Reason: ${reason}`,
        userId: admin_id ? Number(admin_id) : null,
        userName: admin_name || 'Admin'
      }
    });

    res.json({
      success: true,
      message: `Shift ${shift.shiftNo} reopened successfully.`,
      shift: {
        id: updated.id,
        shift_no: updated.shiftNo,
        user_id: updated.userId,
        user_name: updated.userName,
        start_time: updated.startTime,
        end_time: updated.endTime,
        duration_minutes: updated.durationMinutes,
        opening_cash: updated.openingCash,
        closing_cash: updated.closingCash,
        expected_cash: updated.expectedCash,
        cash_difference: updated.cashDifference,
        status: updated.status,
        notes: updated.notes
      }
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 8. Admin Exceptional Cash Reconciliation Correction
app.post('/api/shifts/:id/admin/correct', async (req: Request, res: Response) => {
  try {
    const shiftId = Number(req.params.id);
    const { admin_id, admin_name, corrected_closing_cash, reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A mandatory reason is required for correcting shift cash figures.' });
    }

    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const newClosingCash = parseFloat(corrected_closing_cash) || 0;
    const expected = shift.expectedCash || 0;
    const newDifference = newClosingCash - expected;
    const oldClosingCash = shift.closingCash;

    const updated = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        closingCash: newClosingCash,
        cashDifference: newDifference,
        notes: shift.notes ? `${shift.notes} | [Corrected by ${admin_name}: ${reason}]` : `[Corrected by ${admin_name}: ${reason}]`
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_SHIFT_CORRECT',
        module: 'Shift Management',
        details: `Shift ${shift.shiftNo} closing cash corrected by Admin ${admin_name || 'Admin'}. Old: ${oldClosingCash}, New: ${newClosingCash}, New Variance: ${newDifference}. Reason: ${reason}`,
        userId: admin_id ? Number(admin_id) : null,
        userName: admin_name || 'Admin'
      }
    });

    res.json({
      success: true,
      message: `Shift ${shift.shiftNo} cash figures corrected successfully.`,
      shift: {
        id: updated.id,
        shift_no: updated.shiftNo,
        user_id: updated.userId,
        user_name: updated.userName,
        start_time: updated.startTime,
        end_time: updated.endTime,
        duration_minutes: updated.durationMinutes,
        opening_cash: updated.openingCash,
        closing_cash: updated.closingCash,
        expected_cash: updated.expectedCash,
        cash_difference: updated.cashDifference,
        status: updated.status,
        notes: updated.notes
      }
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// 9. Admin Force-Close an Active Shift (emergency recovery for abandoned shifts)
app.post('/api/shifts/:id/admin/force-close', async (req: Request, res: Response) => {
  try {
    const shiftId = Number(req.params.id);
    const { admin_id, admin_name, actual_cash, notes, reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A mandatory administrative reason is required to force-close a shift.' });
    }

    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (shift.status !== 'open') {
      return res.status(400).json({ error: 'Shift is already closed.' });
    }

    const [sales, returns, customerPayments] = await Promise.all([
      prisma.sale.findMany({
        where: { shiftId: shift.id },
        select: { netTotal: true, paymentType: true }
      }),
      prisma.saleReturn.findMany({
        where: { shiftId: shift.id },
        select: { refundAmount: true }
      }),
      prisma.customerPayment.findMany({
        where: { shiftId: shift.id },
        select: { amount: true, paymentMethod: true }
      })
    ]);

    let totalCashSales = 0, totalCardSales = 0, totalCreditSales = 0, totalSalesAmount = 0;
    for (const s of sales) {
      totalSalesAmount += s.netTotal;
      if (s.paymentType === 'Cash') totalCashSales += s.netTotal;
      else if (s.paymentType === 'Card') totalCardSales += s.netTotal;
      else if (s.paymentType === 'Credit') totalCreditSales += s.netTotal;
    }
    let totalReturnsCash = 0;
    for (const r of returns) totalReturnsCash += r.refundAmount;
    let totalCustomerPaymentsCash = 0;
    for (const cp of customerPayments) {
      if (cp.paymentMethod.toLowerCase() === 'cash') totalCustomerPaymentsCash += cp.amount;
    }

    const expectedCash = shift.openingCash + totalCashSales + totalCustomerPaymentsCash - totalReturnsCash;
    const actualCashNum = parseFloat(actual_cash) ?? expectedCash;
    const difference = actualCashNum - expectedCash;
    const now = new Date();
    const durationMinutes = Math.max(1, Math.round((now.getTime() - new Date(shift.startTime).getTime()) / 60000));

    const adminNote = `[Force-Closed by ${admin_name || 'Admin'}: ${String(reason).trim()}]`;
    const updatedShift = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: 'closed',
        endTime: now,
        durationMinutes,
        closingCash: actualCashNum,
        expectedCash,
        cashDifference: difference,
        totalSalesCount: sales.length,
        totalSalesAmount,
        totalCashSales,
        totalCardSales,
        totalCreditSales,
        totalReturnsAmount: totalReturnsCash,
        totalCustomerPayments: totalCustomerPaymentsCash,
        notes: notes ? `${notes} | ${adminNote}` : adminNote
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_SHIFT_FORCE_CLOSE',
        module: 'Shift Management',
        details: `Shift ${shift.shiftNo} force-closed by Admin ${admin_name || 'Admin'} (ID #${admin_id}). Duration: ${formatShiftDuration(durationMinutes)}. Expected: ${expectedCash.toFixed(2)}, Actual: ${actualCashNum.toFixed(2)}, Variance: ${difference.toFixed(2)}. Reason: ${reason}`,
        userId: admin_id ? Number(admin_id) : null,
        userName: admin_name || 'Admin'
      }
    });

    res.json({
      success: true,
      message: `Shift ${shift.shiftNo} has been force-closed by admin.`,
      shift: {
        id: updatedShift.id,
        shift_no: updatedShift.shiftNo,
        user_id: updatedShift.userId,
        user_name: updatedShift.userName,
        start_time: updatedShift.startTime,
        end_time: updatedShift.endTime,
        duration_minutes: updatedShift.durationMinutes,
        opening_cash: updatedShift.openingCash,
        closing_cash: updatedShift.closingCash,
        expected_cash: updatedShift.expectedCash,
        cash_difference: updatedShift.cashDifference,
        total_sales_count: updatedShift.totalSalesCount,
        total_sales_amount: updatedShift.totalSalesAmount,
        total_cash_sales: updatedShift.totalCashSales,
        total_card_sales: updatedShift.totalCardSales,
        total_credit_sales: updatedShift.totalCreditSales,
        total_returns_amount: updatedShift.totalReturnsAmount,
        total_customer_payments: updatedShift.totalCustomerPayments,
        notes: updatedShift.notes,
        status: updatedShift.status
      }
    });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// Daily Closing Utility
app.post('/api/utilities/closing', async (req: Request, res: Response) => {
  try {
    const {
      closing_date, opening_cash, total_sales_cash, total_sales_card, total_sales_credit,
      total_returns, total_purchases_paid, expenses_total, expected_cash, actual_cash, difference,
      notes, user_id, user_name
    } = req.body;

    const today = closing_date || new Date().toISOString().split('T')[0];
    const now = new Date();

    await prisma.dailyClosing.upsert({
      where: { closingDate: today },
      create: {
        closingDate: today,
        openingTime: now,
        closingTime: now,
        userId: user_id ? Number(user_id) : null,
        userName: user_name || 'Admin',
        openingCash: parseFloat(opening_cash) || 0,
        totalSalesCash: parseFloat(total_sales_cash) || 0,
        totalSalesCard: parseFloat(total_sales_card) || 0,
        totalSalesCredit: parseFloat(total_sales_credit) || 0,
        totalReturns: parseFloat(total_returns) || 0,
        totalPurchasesPaid: parseFloat(total_purchases_paid) || 0,
        expensesTotal: parseFloat(expenses_total) || 0,
        expectedCash: parseFloat(expected_cash) || 0,
        actualCash: parseFloat(actual_cash) || 0,
        difference: parseFloat(difference) || 0,
        notes: notes || null,
        isClosed: 1
      },
      update: {
        closingTime: now,
        userId: user_id ? Number(user_id) : null,
        userName: user_name || 'Admin',
        openingCash: parseFloat(opening_cash) || 0,
        totalSalesCash: parseFloat(total_sales_cash) || 0,
        totalSalesCard: parseFloat(total_sales_card) || 0,
        totalSalesCredit: parseFloat(total_sales_credit) || 0,
        totalReturns: parseFloat(total_returns) || 0,
        totalPurchasesPaid: parseFloat(total_purchases_paid) || 0,
        expensesTotal: parseFloat(expenses_total) || 0,
        expectedCash: parseFloat(expected_cash) || 0,
        actualCash: parseFloat(actual_cash) || 0,
        difference: parseFloat(difference) || 0,
        notes: notes || null,
        isClosed: 1
      }
    });

    // Auto-backup on closing if enabled
    const autoBackupSetting = await prisma.systemSetting.findUnique({ where: { key: 'auto_backup_enabled' } });
    let backupResult = null;
    if (autoBackupSetting?.value === 'true') {
      try {
        backupResult = await createBackup('auto_daily');
      } catch (bkErr) {
        console.error('Auto backup during closing error:', bkErr);
      }
    }

    res.json({ success: true, message: 'Daily closing recorded successfully.', backup: backupResult });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// -------------------------------------------------------------
// 9. System Settings
// -------------------------------------------------------------
app.get('/api/settings', async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.systemSetting.findMany();
    const settings: Record<string, string> = {
      max_bill_discount_pct: '14',
      default_invoice_template: 'classic',
      invoice_paper_size: '80mm',
      return_policy_text: 'Unopened medicines in original packaging may be returned or exchanged within 3 days with this invoice. Heat-sensitive and loose units are non-returnable.',
      show_store_name: 'true',
      show_store_phone: 'true',
      show_store_address: 'true',
      show_store_license: 'true',
      show_invoice_no: 'true',
      show_invoice_date: 'true',
      show_cashier_name: 'true',
      show_customer_name: 'true',
      show_customer_phone: 'true',
      show_col_product_name: 'true',
      show_col_p_code: 'true',
      show_col_unit: 'true',
      show_col_unit_price: 'true',
      show_col_discount: 'true',
      show_col_tax: 'true',
      show_col_total: 'true',
      show_summary_item_count: 'true',
      show_summary_gross: 'true',
      show_summary_discount: 'true',
      show_summary_tax: 'true',
      show_summary_net: 'true',
      show_summary_received: 'true',
      show_summary_change: 'true',
      show_terms: 'true',
      show_footer_note: 'true',
      show_return_policy: 'true',
      show_developer_info: 'true'
    };
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    // Developer information is mandatory and cannot be disabled
    settings.show_developer_info = 'true';

    // Thermal-only invoices: never hand out legacy A4/A5 sizes or sheet templates
    settings.default_invoice_template = normalizeTemplate(settings.default_invoice_template);
    settings.invoice_paper_size = normalizePaperSize(settings.invoice_paper_size ?? settings.paper_width);
    settings.paper_width = settings.invoice_paper_size;
    if (!settings.developer_invoice_footer) {
      settings.developer_invoice_footer = DEFAULT_DEVELOPER_FOOTER;
    }

    // Store identity stays visible on receipts unless the Developer allows hiding it
    if (settings.allow_admin_hide_store_identity !== 'true') {
      settings.show_store_name = 'true';
      settings.show_store_address = 'true';
    }

    // Developer identity is only served through the protected developer endpoint
    delete settings.developer_email;
    res.json(settings);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// Developer and Admin always manage settings; other roles need the 'settings' permission
async function canManageSettings(roleName: string): Promise<boolean> {
  if (roleName === 'developer' || roleName === 'admin') return true;
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) return false;
  try {
    return JSON.parse(role.permissions || '{}').settings === true;
  } catch {
    return false;
  }
}

// Keys only the Developer may change through any settings endpoint
const DEVELOPER_ONLY_SETTING_KEYS = [
  'developer_invoice_footer',
  'show_developer_info',
  'allow_admin_create_cashier',
  'allow_admin_create_admin',
  'allow_admin_edit_store_identity',
  'allow_admin_hide_store_identity',
  'backup_retention_limit',
  'backup_frequency',
  'backup_scheduled_time'
];

app.post('/api/settings', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || !(await canManageSettings(actingUser.role))) {
      await logSecurityAudit({
        action: 'SETTINGS_UPDATE',
        module: 'SETTINGS',
        status: 'FAILED',
        details: 'Unauthorized attempt to modify system settings without settings permission',
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(403).json({ error: 'Access denied: settings permission required' });
    }

    const settings: Record<string, unknown> = { ...req.body };
    // Developer info is strictly mandatory
    settings.show_developer_info = 'true';
    // Setup lock and developer identity are only managed by the setup wizard / developer endpoint
    delete settings.setup_completed;
    delete settings.developer_email;

    // Thermal-only invoices: reject A3/A4/A5 sizes and retired sheet templates
    if (settings.default_invoice_template !== undefined && !isValidTemplate(settings.default_invoice_template)) {
      return res.status(400).json({ error: 'Invalid invoice template. Allowed: classic, compact, detailed' });
    }
    if (settings.invoice_paper_size !== undefined && !isValidPaperSize(settings.invoice_paper_size)) {
      return res.status(400).json({ error: 'Invalid paper size. Only 58mm and 80mm thermal rolls are supported' });
    }
    if (settings.paper_width !== undefined && !isValidPaperSize(settings.paper_width)) {
      return res.status(400).json({ error: 'Invalid paper width. Only 58mm and 80mm thermal rolls are supported' });
    }
    // invoice_paper_size is canonical; keep the legacy paper_width key in step with it
    if (settings.invoice_paper_size !== undefined) {
      settings.paper_width = settings.invoice_paper_size;
    } else if (settings.paper_width !== undefined) {
      settings.invoice_paper_size = settings.paper_width;
    }

    // If acting user is NOT developer, protect developer-managed keys & store identity
    if (actingUser.role !== 'developer') {
      for (const key of DEVELOPER_ONLY_SETTING_KEYS) {
        delete settings[key];
      }

      const identityToggles = await prisma.systemSetting.findMany({
        where: { key: { in: ['allow_admin_edit_store_identity', 'allow_admin_hide_store_identity'] } }
      });
      const toggles: Record<string, string> = {};
      for (const row of identityToggles) toggles[row.key] = row.value;

      if (toggles.allow_admin_edit_store_identity !== 'true') {
        delete settings.store_name;
        delete settings.store_address;
      }
      if (toggles.allow_admin_hide_store_identity !== 'true') {
        delete settings.show_store_name;
        delete settings.show_store_address;
      }
    }

    if (Object.keys(settings).length > 0) {
      await prisma.$transaction(
        Object.entries(settings).map(([key, val]) =>
          prisma.systemSetting.upsert({
            where: { key },
            update: { value: String(val) },
            create: { key, value: String(val) }
          })
        )
      );
    }

    await logSecurityAudit({
      action: 'SETTINGS_UPDATE',
      module: 'SETTINGS',
      status: 'SUCCESS',
      details: `Settings updated by ${actingUser?.username || 'system'}`,
      userId: actingUser?.id,
      userName: actingUser?.username
    });

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

export { app };

if (process.env.NODE_ENV !== 'test' && !process.env.TEST_MODE && (process.argv[1]?.endsWith('api.ts') || process.argv[1]?.endsWith('api.js'))) {
  app.listen(PORT, () => {
    console.log(`[PharmaCare Server] Running locally on http://localhost:${PORT}`);
  });
}
