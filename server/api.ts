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
  optimizeDatabase
} from './database/backup';

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
          { name: 'admin', displayName: 'Administrator', description: 'Full system access and master privileges', isSystem: 1, permissions: JSON.stringify(adminPerms) },
          { name: 'cashier', displayName: 'Counter Cashier', description: 'POS sales, customer credit recoveries, and view/add medicines. Cannot delete/edit records.', isSystem: 0, permissions: JSON.stringify(cashierPerms) },
          { name: 'pharmacist', displayName: 'Pharmacist', description: 'Dispensing, master coding, and inventory purchases.', isSystem: 0, permissions: JSON.stringify(pharmacistPerms) }
        ]
      });
    }
  } catch (error) {
    console.error('[Prisma] Role seeding check failed:', error);
  }
}
ensureDefaultRoles().catch(err => {
  console.error('[Prisma] Role seeding error:', err);
});

// 2.1 Authentication & Profile
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findFirst({
      where: { username, password },
      select: { id: true, username: true, fullName: true, role: true, status: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'This user account has been disabled. Please contact Administrator.' });
    }

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
      if (existingUser.password !== currentPassword) {
        return res.status(400).json({ error: 'Current password does not match' });
      }
      await prisma.user.update({
        where: { id: idNum },
        data: {
          username: username.trim(),
          fullName: full_name.trim(),
          password: newPassword
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
    const user = await prisma.user.findFirst({
      where: { id: idNum, password: oldPassword }
    });
    if (!user) {
      return res.status(400).json({ error: 'Current password does not match' });
    }

    await prisma.user.update({
      where: { id: idNum },
      data: { password: newPassword }
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

    res.json(users.map(u => ({
      id: u.id,
      username: u.username,
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
    const { username, password, full_name, role } = req.body;
    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const duplicate = await prisma.user.findUnique({
      where: { username: username.trim() }
    });
    if (duplicate) {
      return res.status(400).json({ error: 'Username is already in use' });
    }

    const newUser = await prisma.user.create({
      data: {
        username: username.trim(),
        password,
        fullName: full_name.trim(),
        role: role || 'cashier',
        status: 'active'
      }
    });
    res.json({ success: true, id: newUser.id });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.put('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const { username, full_name, role, status, password } = req.body;

    const existing = await prisma.user.findUnique({ where: { id: idNum } });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
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
      updateData.password = password;
    }

    await prisma.user.update({
      where: { id: idNum },
      data: updateData
    });

    res.json({ success: true, message: 'User updated successfully' });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
  }
});

app.delete('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const idNum = Number(req.params.id);
    const targetUser = await prisma.user.findUnique({ where: { id: idNum } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser.id === 1 || targetUser.username === 'admin') {
      return res.status(400).json({ error: 'Primary Administrator account cannot be deleted' });
    }

    await prisma.user.delete({ where: { id: idNum } });
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(400).json({ error: getErrorMessage(error) });
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

app.post('/api/products', async (req: Request, res: Response) => {
  try {
    const {
      company_id, c_code, p_code, barcode, name, generic_name, unit_type,
      packing, box_trade_price, box_retail_price, unit_trade_price, unit_retail_price,
      default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert
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
      default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert, status
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

    // Generate Invoice No (e.g., INV-20261016-0001)
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await prisma.sale.count({
      where: { invoiceNo: { startsWith: `INV-${today}-` } }
    });
    const invoiceNo = `INV-${today}-${String(countToday + 1).padStart(4, '0')}`;

    const result = await prisma.$transaction(async (tx) => {
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
          totalGross: parseFloat(total_gross) || 0,
          totalItemDiscount: parseFloat(total_item_discount) || 0,
          billDiscountPct: parseFloat(bill_discount_pct) || 0,
          billDiscountAmt: parseFloat(bill_discount_amt) || 0,
          netTotal: parseFloat(net_total) || 0,
          cashTendered: parseFloat(cash_tendered) || (parseFloat(net_total) || 0),
          changeDue: parseFloat(change_due) || 0,
          paymentType: payment_type || 'Cash',
          notes: notes || null
        }
      });

      // 2. Insert Sale Items & Deduct Stock
      for (const item of items) {
        const prod = await tx.product.findUnique({ where: { id: Number(item.product_id) } });
        if (!prod) throw new Error(`Product ID ${item.product_id} not found.`);

        const isLoose = item.is_loose ? 1 : 0;
        const packing = prod.packing || 1;
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
            quantity: parseFloat(item.quantity),
            unitPrice: parseFloat(item.unit_price),
            unitCost,
            grossAmount: parseFloat(item.gross_amount),
            discountPct: parseFloat(item.discount_pct) || 0,
            discountAmount: parseFloat(item.discount_amount) || 0,
            netAmount: parseFloat(item.net_amount),
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
            currentBalance: { increment: parseFloat(net_total) || 0 }
          }
        });
      }

      return { saleId: sale.id, invoiceNo };
    });

    res.json({ success: true, ...result });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
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
    res.status(500).json({ error: getErrorMessage(error) });
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
          const totalBoxes = Number(item.quantity_boxes || 0) + Number(item.bonus_boxes || 0);
          const packing = prod.packing || 1;
          const boxCost = Number(item.box_cost_price);
          const boxRetail = Number(item.box_retail_price);
          const unitCost = boxCost / packing;
          const unitRetail = boxRetail / packing;

          await tx.purchaseItem.create({
            data: {
              purchaseId: purchase.id,
              productId: prod.id,
              productName: prod.name,
              batchNo: item.batch_no || 'NA',
              expiryDate: item.expiry_date || '',
              quantityBoxes: Number(item.quantity_boxes),
              bonusBoxes: Number(item.bonus_boxes || 0),
              boxCostPrice: boxCost,
              boxRetailPrice: boxRetail,
              discountPct: parseFloat(item.discount_pct) || 0,
              totalCost: parseFloat(item.total_cost) || 0
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
  const { customDir } = req.body;
  try {
    const result = await createBackup('manual', customDir);
    res.json(result);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

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
      max_bill_discount_pct: '14'
    };
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    res.json(settings);
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post('/api/settings', async (req: Request, res: Response) => {
  try {
    const settings = req.body;

    await prisma.$transaction(
      Object.entries(settings).map(([key, val]) =>
        prisma.systemSetting.upsert({
          where: { key },
          update: { value: String(val) },
          create: { key, value: String(val) }
        })
      )
    );

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error: unknown) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

app.listen(PORT, () => {
  console.log(`[PharmaCare Server] Running locally on http://localhost:${PORT}`);
});
