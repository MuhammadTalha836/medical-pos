import express, { Request, Response } from 'express';
import cors from 'cors';
import { db } from './database/db';
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

// -------------------------------------------------------------
// 1. Health & Dashboard KPI
// -------------------------------------------------------------
app.get('/api/status', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() });
});

app.get('/api/dashboard/stats', (_req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const todaySales = db.prepare(`
      SELECT 
        COUNT(id) as total_invoices,
        COALESCE(SUM(net_total), 0) as total_revenue,
        COALESCE(SUM(total_gross - net_total), 0) as total_discount
      FROM sales 
      WHERE DATE(sale_date) = ? AND status = 'completed'
    `).get(today) as any;

    const totalProducts = (db.prepare("SELECT COUNT(*) as count FROM products WHERE status = 'active'").get() as any).count;
    const lowStockCount = (db.prepare("SELECT COUNT(*) as count FROM products WHERE stock_boxes <= min_stock_alert AND status = 'active'").get() as any).count;
    const outOfStockCount = (db.prepare("SELECT COUNT(*) as count FROM products WHERE stock_boxes = 0 AND stock_loose = 0 AND status = 'active'").get() as any).count;
    const expiredCount = (db.prepare('SELECT COUNT(*) as count FROM product_batches WHERE expiry_date <= ? AND (quantity_boxes > 0 OR quantity_loose > 0)').get(today) as any).count;

    const recentSales = db.prepare(`
      SELECT id, invoice_no, customer_name, net_total, payment_type, sale_date, status
      FROM sales
      ORDER BY id DESC
      LIMIT 6
    `).all();

    const lowStockItems = db.prepare(`
      SELECT p.id, p.c_code, p.p_code, p.name, p.unit_type, p.stock_boxes, p.stock_loose, p.min_stock_alert, p.location_rack
      FROM products p
      WHERE (p.stock_boxes <= p.min_stock_alert) AND p.status = 'active'
      ORDER BY p.stock_boxes ASC
      LIMIT 8
    `).all();

    res.json({
      todaySales,
      totalProducts,
      lowStockCount,
      outOfStockCount,
      expiredCount,
      recentSales,
      lowStockItems
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 2. Roles, Authentication & Users
// -------------------------------------------------------------

// Ensure roles table exists and seed default roles if empty
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    is_system INTEGER DEFAULT 0,
    permissions TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const roleCountCheck = (db.prepare('SELECT COUNT(*) as count FROM roles').get() as { count: number }).count;
if (roleCountCheck === 0) {
  const insertRole = db.prepare(`
    INSERT INTO roles (name, display_name, description, is_system, permissions)
    VALUES (?, ?, ?, ?, ?)
  `);

  const adminPerms = {
    dashboard: true, pos: true, sales: true, khata: true, masters: true, purchases: true, reports: true, utilities: true, settings: true,
    can_add_product: true, can_edit_product: true, can_delete_product: true, can_add_company: true, can_edit_company: true, can_delete_company: true,
    can_delete_invoice: true, can_return_sale: true, can_view_all_sales: true, can_view_financial_kpis: true, can_add_purchase: true,
    can_add_customer: true, can_receive_payment: true, can_edit_customer: true, can_delete_customer: true, can_discount: true,
    can_backup: true, can_restore: true, can_shift_close: true, can_stock_zero: true, can_manage_users: true, can_manage_roles: true
  };

  const cashierPerms = {
    dashboard: false, pos: true, sales: true, khata: true, masters: true, purchases: false, reports: false, utilities: false, settings: false,
    can_add_product: true, can_edit_product: false, can_delete_product: false, can_add_company: true, can_edit_company: false, can_delete_company: false,
    can_delete_invoice: false, can_return_sale: true, can_view_all_sales: false, can_view_financial_kpis: false, can_add_purchase: false,
    can_add_customer: true, can_receive_payment: true, can_edit_customer: false, can_delete_customer: false, can_discount: true,
    can_backup: false, can_restore: false, can_shift_close: false, can_stock_zero: false, can_manage_users: false, can_manage_roles: false
  };

  const pharmacistPerms = {
    dashboard: true, pos: true, sales: true, khata: true, masters: true, purchases: true, reports: false, utilities: false, settings: false,
    can_add_product: true, can_edit_product: true, can_delete_product: false, can_add_company: true, can_edit_company: true, can_delete_company: false,
    can_delete_invoice: false, can_return_sale: true, can_view_all_sales: true, can_view_financial_kpis: false, can_add_purchase: true,
    can_add_customer: true, can_receive_payment: true, can_edit_customer: true, can_delete_customer: false, can_discount: true,
    can_backup: false, can_restore: false, can_shift_close: true, can_stock_zero: false, can_manage_users: false, can_manage_roles: false
  };

  insertRole.run('admin', 'Administrator', 'Full system access and master privileges', 1, JSON.stringify(adminPerms));
  insertRole.run('cashier', 'Counter Cashier', 'POS sales, customer credit recoveries, and view/add medicines. Cannot delete/edit records.', 0, JSON.stringify(cashierPerms));
  insertRole.run('pharmacist', 'Pharmacist', 'Dispensing, master coding, and inventory purchases.', 0, JSON.stringify(pharmacistPerms));
}

// 2.1 Authentication & Profile
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT id, username, full_name, role, status FROM users WHERE username = ? AND password = ?').get(username, password) as any;

  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'This user account has been disabled. Please contact Administrator.' });
  }

  // Fetch permissions for user's role
  const roleRow = db.prepare('SELECT name, display_name, permissions FROM roles WHERE name = ?').get(user.role) as any;
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
      ...user,
      role_display: roleRow ? roleRow.display_name : user.role,
      permissions
    }
  });
});

app.put('/api/auth/profile', (req: Request, res: Response) => {
  const { userId, username, full_name, currentPassword, newPassword } = req.body;
  if (!userId || !username || !full_name) {
    return res.status(400).json({ error: 'Missing required user profile fields' });
  }

  const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!existingUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Check if username is being taken by another user
  const duplicate = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), userId);
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
    db.prepare('UPDATE users SET username = ?, full_name = ?, password = ? WHERE id = ?').run(
      username.trim(), full_name.trim(), newPassword, userId
    );
  } else {
    db.prepare('UPDATE users SET username = ?, full_name = ? WHERE id = ?').run(
      username.trim(), full_name.trim(), userId
    );
  }

  const updatedUser = db.prepare('SELECT id, username, full_name, role, status FROM users WHERE id = ?').get(userId) as any;
  const roleRow = db.prepare('SELECT name, display_name, permissions FROM roles WHERE name = ?').get(updatedUser.role) as any;

  res.json({
    success: true,
    message: 'Profile updated successfully',
    user: {
      ...updatedUser,
      role_display: roleRow ? roleRow.display_name : updatedUser.role,
      permissions: roleRow?.permissions ? JSON.parse(roleRow.permissions) : null
    }
  });
});

app.post('/api/auth/change-password', (req: Request, res: Response) => {
  const { userId, oldPassword, newPassword } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND password = ?').get(userId, oldPassword);
  if (!user) {
    return res.status(400).json({ error: 'Current password does not match' });
  }

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newPassword, userId);
  res.json({ success: true, message: 'Password updated successfully' });
});

// 2.2 Users Management
app.get('/api/users', (_req: Request, res: Response) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role, u.status, u.created_at,
           r.display_name as role_display
    FROM users u
    LEFT JOIN roles r ON u.role = r.name
    ORDER BY u.id ASC
  `).all();
  res.json(users);
});

app.post('/api/users', (req: Request, res: Response) => {
  const { username, password, full_name, role } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const duplicate = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (duplicate) {
    return res.status(400).json({ error: 'Username is already in use' });
  }

  try {
    const info = db.prepare('INSERT INTO users (username, password, full_name, role, status) VALUES (?, ?, ?, ?, ?)').run(
      username.trim(), password, full_name.trim(), role || 'cashier', 'active'
    );
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/users/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { username, full_name, role, status, password } = req.body;

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  if (!existing) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (username && username.trim() !== existing.username) {
    const duplicate = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), id);
    if (duplicate) {
      return res.status(400).json({ error: 'Username is already taken' });
    }
  }

  try {
    if (password && password.trim() !== '') {
      db.prepare(`
        UPDATE users 
        SET username = ?, full_name = ?, role = ?, status = ?, password = ?
        WHERE id = ?
      `).run(username.trim(), full_name.trim(), role || existing.role, status || existing.status, password, id);
    } else {
      db.prepare(`
        UPDATE users 
        SET username = ?, full_name = ?, role = ?, status = ?
        WHERE id = ?
      `).run(username.trim(), full_name.trim(), role || existing.role, status || existing.status, id);
    }
    res.json({ success: true, message: 'User updated successfully' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/users/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Prevent deleting admin id 1
  if (targetUser.id === 1 || targetUser.username === 'admin') {
    return res.status(400).json({ error: 'Primary Administrator account cannot be deleted' });
  }

  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// 2.3 Roles & Granular Permissions Management
app.get('/api/roles', (_req: Request, res: Response) => {
  try {
    const roles = db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM users u WHERE u.role = r.name) as user_count
      FROM roles r
      ORDER BY r.id ASC
    `).all() as any[];

    const parsedRoles = roles.map(r => ({
      ...r,
      permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions
    }));

    res.json(parsedRoles);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/roles', (req: Request, res: Response) => {
  const { name, display_name, description, permissions } = req.body;
  if (!name || !display_name || !permissions) {
    return res.status(400).json({ error: 'Role identifier, display name, and permissions are required' });
  }

  const roleKey = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').trim();
  const existing = db.prepare('SELECT id FROM roles WHERE name = ?').get(roleKey);
  if (existing) {
    return res.status(400).json({ error: `A role with identifier "${roleKey}" already exists` });
  }

  try {
    const permsJson = typeof permissions === 'string' ? permissions : JSON.stringify(permissions);
    const info = db.prepare(`
      INSERT INTO roles (name, display_name, description, is_system, permissions)
      VALUES (?, ?, ?, 0, ?)
    `).run(roleKey, display_name.trim(), description || null, permsJson);

    res.json({ success: true, id: info.lastInsertRowid });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/roles/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { display_name, description, permissions } = req.body;

  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
  if (!role) {
    return res.status(404).json({ error: 'Role not found' });
  }

  try {
    // If system admin role, keep critical permissions safe
    let permsJson = typeof permissions === 'string' ? permissions : JSON.stringify(permissions);
    if (role.name === 'admin') {
      const parsed = typeof permissions === 'string' ? JSON.parse(permissions) : permissions;
      parsed.settings = true;
      parsed.can_manage_roles = true;
      parsed.can_manage_users = true;
      permsJson = JSON.stringify(parsed);
    }

    db.prepare(`
      UPDATE roles
      SET display_name = ?, description = ?, permissions = ?
      WHERE id = ?
    `).run(display_name || role.display_name, description !== undefined ? description : role.description, permsJson, id);

    res.json({ success: true, message: 'Role permissions updated successfully' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/roles/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
  if (!role) {
    return res.status(404).json({ error: 'Role not found' });
  }

  if (role.is_system === 1 || role.name === 'admin') {
    return res.status(400).json({ error: 'System-protected roles cannot be deleted' });
  }

  const assignedUsers = (db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get(role.name) as { count: number }).count;
  if (assignedUsers > 0) {
    return res.status(400).json({ error: `Cannot delete role "${role.display_name}". ${assignedUsers} user(s) are currently assigned to it.` });
  }

  try {
    db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 3. Companies / Manufacturers
// -------------------------------------------------------------
app.get('/api/companies', (_req: Request, res: Response) => {
  const companies = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.company_id = c.id) as product_count
    FROM companies c
    ORDER BY c.name ASC
  `).all();
  res.json(companies);
});

app.post('/api/companies', (req: Request, res: Response) => {
  const { code, name, contact_person, phone, email, address } = req.body;
  try {
    const info = db.prepare(`
      INSERT INTO companies (code, name, contact_person, phone, email, address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(code.toUpperCase().trim(), name.trim(), contact_person, phone, email, address);
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/companies/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { code, name, contact_person, phone, email, address, status } = req.body;
  try {
    db.prepare(`
      UPDATE companies
      SET code = ?, name = ?, contact_person = ?, phone = ?, email = ?, address = ?, status = ?
      WHERE id = ?
    `).run(code.toUpperCase().trim(), name.trim(), contact_person, phone, email, address, status || 'active', id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/companies/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM companies WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Ensure customer_payments table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS customer_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    notes TEXT,
    previous_balance REAL NOT NULL,
    new_balance REAL NOT NULL,
    user_name TEXT,
    payment_date DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// -------------------------------------------------------------
// 3.5 Customers & Credit Ledger (Khata)
// -------------------------------------------------------------
app.get('/api/customers', (_req: Request, res: Response) => {
  try {
    const customers = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) as invoices_count,
        (SELECT COALESCE(SUM(s.net_total), 0) FROM sales s WHERE s.customer_id = c.id AND s.payment_type = 'Credit') as total_credit_sales,
        (SELECT COALESCE(SUM(p.amount), 0) FROM customer_payments p WHERE p.customer_id = c.id) as total_payments
      FROM customers c
      ORDER BY c.current_balance DESC, c.name ASC
    `).all();
    res.json(customers);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/customers', (req: Request, res: Response) => {
  const { name, phone, address, credit_limit } = req.body;
  try {
    const info = db.prepare(`
      INSERT INTO customers (name, phone, address, credit_limit, current_balance)
      VALUES (?, ?, ?, ?, 0.0)
    `).run(name.trim(), phone || null, address || null, parseFloat(credit_limit) || 0);
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/customers/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, phone, address, credit_limit } = req.body;
  try {
    db.prepare(`
      UPDATE customers 
      SET name = ?, phone = ?, address = ?, credit_limit = ?
      WHERE id = ?
    `).run(name.trim(), phone || null, address || null, parseFloat(credit_limit) || 0, id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/customers/:id/payment', (req: Request, res: Response) => {
  const { id } = req.params;
  const { amount, payment_method, notes } = req.body;
  const paymentAmt = parseFloat(amount);
  if (isNaN(paymentAmt) || paymentAmt <= 0) {
    return res.status(400).json({ error: 'Valid positive payment amount required' });
  }

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const newBalance = Math.max(0, customer.current_balance - paymentAmt);

  const transaction = db.transaction(() => {
    db.prepare('UPDATE customers SET current_balance = ? WHERE id = ?').run(newBalance, id);

    db.prepare(`
      INSERT INTO customer_payments (customer_id, amount, payment_method, notes, previous_balance, new_balance, user_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, paymentAmt, payment_method || 'cash', notes || null, customer.current_balance, newBalance, 'Cashier');

    db.prepare(`
      INSERT INTO audit_logs (action, module, details, user_name)
      VALUES (?, ?, ?, ?)
    `).run(
      'CUSTOMER_PAYMENT',
      'Khata',
      `Payment received: ${paymentAmt} (${payment_method || 'Cash'}). Previous: ${customer.current_balance}, New Balance: ${newBalance}. Notes: ${notes || 'None'}`,
      'Cashier'
    );
  });

  try {
    transaction();
    res.json({ success: true, new_balance: newBalance });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/customers/:id/ledger', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const sales = db.prepare(`
      SELECT id, invoice_no, sale_date, net_total, payment_type, status
      FROM sales
      WHERE customer_id = ?
      ORDER BY id DESC
    `).all(id);

    const payments = db.prepare(`
      SELECT id, amount, payment_method, notes, previous_balance, new_balance, payment_date, user_name
      FROM customer_payments
      WHERE customer_id = ?
      ORDER BY id DESC
    `).all(id);

    res.json({ customer, sales, payments });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 4. Products Master
// -------------------------------------------------------------
app.get('/api/products', (req: Request, res: Response) => {
  const { q, company_id, low_stock } = req.query;
  let query = `
    SELECT p.*, c.name as company_name
    FROM products p
    LEFT JOIN companies c ON p.company_id = c.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (q) {
    query += ` AND (p.name LIKE ? OR p.p_code LIKE ? OR p.c_code LIKE ? OR p.barcode LIKE ? OR p.generic_name LIKE ?)`;
    const search = `%${q}%`;
    params.push(search, search, search, search, search);
  }

  if (company_id) {
    query += ` AND p.company_id = ?`;
    params.push(company_id);
  }

  if (low_stock === 'true') {
    query += ` AND p.stock_boxes <= p.min_stock_alert`;
  }

  query += ` ORDER BY p.name ASC`;

  const products = db.prepare(query).all(...params);
  res.json(products);
});

app.get('/api/products/search', (req: Request, res: Response) => {
  const { q } = req.query;
  if (!q) return res.json([]);

  const search = `%${q}%`;
  const products = db.prepare(`
    SELECT p.*, c.name as company_name
    FROM products p
    LEFT JOIN companies c ON p.company_id = c.id
    WHERE p.status = 'active' AND (
      p.barcode = ? OR
      p.p_code LIKE ? OR
      p.c_code LIKE ? OR
      p.name LIKE ? OR
      p.generic_name LIKE ?
    )
    ORDER BY (p.barcode = ?) DESC, p.name ASC
    LIMIT 25
  `).all(q, search, search, search, search, q);

  res.json(products);
});

app.post('/api/products', (req: Request, res: Response) => {
  const {
    company_id, c_code, p_code, barcode, name, generic_name, unit_type,
    packing, box_trade_price, box_retail_price, unit_trade_price, unit_retail_price,
    default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert
  } = req.body;

  try {
    const info = db.prepare(`
      INSERT INTO products (
        company_id, c_code, p_code, barcode, name, generic_name, unit_type,
        packing, box_trade_price, box_retail_price, unit_trade_price, unit_retail_price,
        default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      company_id || null, c_code, p_code, barcode || null, name, generic_name || null, unit_type || 'Tablets',
      packing || 1, box_trade_price || 0, box_retail_price || 0, unit_trade_price || 0, unit_retail_price || 0,
      default_discount_pct || 0, location_rack || null, stock_boxes || 0, stock_loose || 0, min_stock_alert || 10
    );

    res.json({ success: true, id: info.lastInsertRowid });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/products/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    company_id, c_code, p_code, barcode, name, generic_name, unit_type,
    packing, box_trade_price, box_retail_price, unit_trade_price, unit_retail_price,
    default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert, status
  } = req.body;

  try {
    db.prepare(`
      UPDATE products SET
        company_id = ?, c_code = ?, p_code = ?, barcode = ?, name = ?, generic_name = ?, unit_type = ?,
        packing = ?, box_trade_price = ?, box_retail_price = ?, unit_trade_price = ?, unit_retail_price = ?,
        default_discount_pct = ?, location_rack = ?, stock_boxes = ?, stock_loose = ?, min_stock_alert = ?,
        status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      company_id || null, c_code, p_code, barcode || null, name, generic_name || null, unit_type,
      packing, box_trade_price, box_retail_price, unit_trade_price, unit_retail_price,
      default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert,
      status || 'active', id
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/products/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 5. Sales & Counter POS
// -------------------------------------------------------------
app.post('/api/sales', (req: Request, res: Response) => {
  const {
    customer_id, customer_name, customer_phone, user_id, user_name,
    items, total_gross, total_item_discount, bill_discount_pct, bill_discount_amt,
    net_total, cash_tendered, change_due, payment_type, notes
  } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Sale must include at least one item.' });
  }

  const transaction = db.transaction(() => {
    // 1. Generate Invoice No (e.g., INV-20261016-0001)
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = (db.prepare(`
      SELECT COUNT(*) as count FROM sales WHERE invoice_no LIKE ?
    `).get(`INV-${today}-%`) as any).count;
    const invoiceNo = `INV-${today}-${String(countToday + 1).padStart(4, '0')}`;

    // 2. Insert Sale Master
    const insertSale = db.prepare(`
      INSERT INTO sales (
        invoice_no, customer_id, customer_name, customer_phone, user_id, user_name,
        total_gross, total_item_discount, bill_discount_pct, bill_discount_amt,
        net_total, cash_tendered, change_due, payment_type, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const saleInfo = insertSale.run(
      invoiceNo, customer_id || null, customer_name || 'Counter Customer', customer_phone || null,
      user_id || null, user_name || 'Cashier', total_gross, total_item_discount,
      bill_discount_pct || 0, bill_discount_amt || 0, net_total, cash_tendered || net_total,
      change_due || 0, payment_type || 'Cash', notes || null
    );

    const saleId = saleInfo.lastInsertRowid;

    // 3. Insert Sale Items & Deduct Stock
    const insertItem = db.prepare(`
      INSERT INTO sale_items (
        sale_id, product_id, c_code, p_code, product_name, unit_type, location_rack,
        is_loose, quantity, unit_price, unit_cost, gross_amount, discount_pct, discount_amount, net_amount, batch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateProductStock = db.prepare(`
      UPDATE products SET
        stock_boxes = ?,
        stock_loose = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    for (const item of items) {
      const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
      if (!prod) throw new Error(`Product ID ${item.product_id} not found.`);

      const isLoose = item.is_loose ? 1 : 0;
      const packing = prod.packing || 1;
      const unitCost = isLoose ? prod.unit_trade_price : prod.box_trade_price;

      insertItem.run(
        saleId, prod.id, prod.c_code, prod.p_code, prod.name, prod.unit_type, prod.location_rack,
        isLoose, item.quantity, item.unit_price, unitCost, item.gross_amount,
        item.discount_pct || 0, item.discount_amount || 0, item.net_amount, item.batch_id || null
      );

      // Decrement inventory logically:
      // Convert current stock to total loose units:
      let totalCurrentUnits = (prod.stock_boxes * packing) + prod.stock_loose;
      const unitsToDeduct = isLoose ? item.quantity : (item.quantity * packing);
      totalCurrentUnits = Math.max(0, totalCurrentUnits - unitsToDeduct);

      const newBoxes = Math.floor(totalCurrentUnits / packing);
      const newLoose = totalCurrentUnits % packing;

      updateProductStock.run(newBoxes, newLoose, prod.id);
    }

    // If credit sale to registered customer, update outstanding Khata balance
    if (payment_type === 'Credit' && customer_id) {
      db.prepare('UPDATE customers SET current_balance = current_balance + ? WHERE id = ?').run(net_total, customer_id);
    }

    return { saleId, invoiceNo };
  });

  try {
    const result = transaction();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sales', (req: Request, res: Response) => {
  const { date_from, date_to, invoice_no, customer_id } = req.query;
  let query = 'SELECT * FROM sales WHERE 1=1';
  const params: any[] = [];

  if (invoice_no) {
    query += ' AND invoice_no LIKE ?';
    params.push(`%${invoice_no}%`);
  }
  if (date_from) {
    query += ' AND DATE(sale_date) >= ?';
    params.push(date_from);
  }
  if (date_to) {
    query += ' AND DATE(sale_date) <= ?';
    params.push(date_to);
  }
  if (customer_id) {
    query += ' AND customer_id = ?';
    params.push(customer_id);
  }

  query += ' ORDER BY id DESC LIMIT 100';

  const sales = db.prepare(query).all(...params);
  res.json(sales);
});

app.get('/api/sales/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as any;
  if (!sale) return res.status(404).json({ error: 'Sale invoice not found' });

  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
  res.json({ ...sale, items });
});

app.post('/api/sales/return', (req: Request, res: Response) => {
  const { sale_id, original_invoice_no, customer_name, return_items, reason, user_id, user_name } = req.body;
  if (!return_items || return_items.length === 0) {
    return res.status(400).json({ error: 'No return items specified' });
  }

  const transaction = db.transaction(() => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = (db.prepare('SELECT COUNT(*) as count FROM sale_returns WHERE return_no LIKE ?').get(`SR-${today}-%`) as any).count;
    const returnNo = `SR-${today}-${String(countToday + 1).padStart(4, '0')}`;

    let totalRefund = 0;
    for (const item of return_items) {
      totalRefund += Number(item.total_refund || (item.quantity * item.unit_refund_price));
    }

    const insertReturn = db.prepare(`
      INSERT INTO sale_returns (return_no, sale_id, original_invoice_no, customer_name, refund_amount, reason, user_id, user_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const returnInfo = insertReturn.run(
      returnNo, sale_id || null, original_invoice_no || null, customer_name || 'Customer',
      totalRefund, reason || null, user_id || null, user_name || 'Cashier'
    );

    const returnId = returnInfo.lastInsertRowid;

    const insertReturnItem = db.prepare(`
      INSERT INTO sale_return_items (sale_return_id, product_id, product_name, is_loose, quantity, unit_refund_price, total_refund)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const updateProductStock = db.prepare(`
      UPDATE products SET
        stock_boxes = ?,
        stock_loose = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    for (const item of return_items) {
      const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
      if (prod) {
        const isLoose = item.is_loose ? 1 : 0;
        const packing = prod.packing || 1;
        const itemRefund = item.total_refund || (item.quantity * item.unit_refund_price);

        insertReturnItem.run(returnId, prod.id, prod.name, isLoose, item.quantity, item.unit_refund_price, itemRefund);

        let totalUnits = (prod.stock_boxes * packing) + prod.stock_loose;
        const unitsToAdd = isLoose ? item.quantity : (item.quantity * packing);
        totalUnits += unitsToAdd;

        const newBoxes = Math.floor(totalUnits / packing);
        const newLoose = totalUnits % packing;
        updateProductStock.run(newBoxes, newLoose, prod.id);
      }
    }

    if (sale_id) {
      db.prepare("UPDATE sales SET status = 'returned' WHERE id = ?").run(sale_id);
    }

    return { returnId, returnNo, totalRefund };
  });

  try {
    const result = transaction();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 6. Purchases & Supplier Inward
// -------------------------------------------------------------
app.get('/api/purchases', (_req: Request, res: Response) => {
  const purchases = db.prepare(`
    SELECT p.*, c.name as company_name, c.code as company_code
    FROM purchases p
    LEFT JOIN companies c ON p.company_id = c.id
    ORDER BY p.id DESC LIMIT 100
  `).all();
  res.json(purchases);
});

app.post('/api/purchases', (req: Request, res: Response) => {
  const {
    supplier_invoice_no, company_id, purchase_date, items,
    total_gross, discount_amount, tax_amount, net_total, payment_status, notes, user_id
  } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Purchase must have items' });
  }

  const company = db.prepare('SELECT name FROM companies WHERE id = ?').get(company_id) as any;
  if (!company) return res.status(400).json({ error: 'Company not found' });

  const transaction = db.transaction(() => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = (db.prepare('SELECT COUNT(*) as count FROM purchases WHERE invoice_no LIKE ?').get(`PUR-${today}-%`) as any).count;
    const invoiceNo = `PUR-${today}-${String(countToday + 1).padStart(4, '0')}`;

    const insertPurchase = db.prepare(`
      INSERT INTO purchases (
        invoice_no, supplier_invoice_no, company_id, company_name, purchase_date,
        total_gross, discount_amount, tax_amount, net_total, payment_status, notes, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const purInfo = insertPurchase.run(
      invoiceNo, supplier_invoice_no || null, company_id, company.name, purchase_date || new Date().toISOString().split('T')[0],
      total_gross, discount_amount || 0, tax_amount || 0, net_total, payment_status || 'Paid', notes || null, user_id || null
    );

    const purchaseId = purInfo.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO purchase_items (
        purchase_id, product_id, product_name, batch_no, expiry_date,
        quantity_boxes, bonus_boxes, box_cost_price, box_retail_price, discount_pct, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateProduct = db.prepare(`
      UPDATE products SET
        stock_boxes = stock_boxes + ?,
        box_trade_price = ?,
        box_retail_price = ?,
        unit_trade_price = ?,
        unit_retail_price = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const insertBatch = db.prepare(`
      INSERT INTO product_batches (
        product_id, batch_no, expiry_date, purchase_cost, retail_price, quantity_boxes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
      if (prod) {
        const totalBoxes = Number(item.quantity_boxes || 0) + Number(item.bonus_boxes || 0);
        const packing = prod.packing || 1;
        const boxCost = Number(item.box_cost_price);
        const boxRetail = Number(item.box_retail_price);
        const unitCost = boxCost / packing;
        const unitRetail = boxRetail / packing;

        insertItem.run(
          purchaseId, prod.id, prod.name, item.batch_no || 'NA', item.expiry_date || '',
          item.quantity_boxes, item.bonus_boxes || 0, boxCost, boxRetail, item.discount_pct || 0, item.total_cost
        );

        updateProduct.run(totalBoxes, boxCost, boxRetail, unitCost, unitRetail, prod.id);

        insertBatch.run(prod.id, item.batch_no || 'B-NEW', item.expiry_date || '', boxCost, boxRetail, totalBoxes);
      }
    }

    return { purchaseId, invoiceNo };
  });

  try {
    const result = transaction();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 7. Comprehensive Reports Engine
// -------------------------------------------------------------

// Available Stock with valuation
app.get('/api/reports/stock/available', (_req: Request, res: Response) => {
  const stock = db.prepare(`
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
  `).all();
  res.json(stock);
});

// Expired & Near-Expiry Products
app.get('/api/reports/stock/expired', (req: Request, res: Response) => {
  const { days = '0' } = req.query;
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + Number(days));
  const targetStr = targetDate.toISOString().split('T')[0];

  const expired = db.prepare(`
    SELECT 
      b.id as batch_id, b.batch_no, b.expiry_date, b.quantity_boxes, b.quantity_loose,
      p.id as product_id, p.c_code, p.p_code, p.name as product_name, p.unit_type, p.location_rack,
      p.box_trade_price, (b.quantity_boxes * p.box_trade_price) as loss_valuation,
      c.name as company_name
    FROM product_batches b
    JOIN products p ON b.product_id = p.id
    LEFT JOIN companies c ON p.company_id = c.id
    WHERE b.expiry_date <= ? AND (b.quantity_boxes > 0 OR b.quantity_loose > 0)
    ORDER BY b.expiry_date ASC
  `).all(targetStr);

  res.json(expired);
});

// Finished / Zero stock
app.get('/api/reports/stock/finished', (_req: Request, res: Response) => {
  const finished = db.prepare(`
    SELECT p.id, p.c_code, p.p_code, p.name, p.unit_type, p.location_rack, p.box_retail_price, c.name as company_name
    FROM products p
    LEFT JOIN companies c ON p.company_id = c.id
    WHERE p.stock_boxes = 0 AND p.stock_loose = 0 AND p.status = 'active'
    ORDER BY p.name ASC
  `).all();
  res.json(finished);
});

// Sales & Profit/Loss Summary
app.get('/api/reports/financial/pnl-summary', (req: Request, res: Response) => {
  const { date_from, date_to } = req.query;
  let where = "WHERE s.status = 'completed'";
  const params: any[] = [];

  if (date_from) {
    where += " AND DATE(s.sale_date) >= ?";
    params.push(date_from);
  }
  if (date_to) {
    where += " AND DATE(s.sale_date) <= ?";
    params.push(date_to);
  }

  const pnl = db.prepare(`
    SELECT 
      COUNT(DISTINCT s.id) as total_invoices,
      COALESCE(SUM(si.net_amount), 0) as total_revenue,
      COALESCE(SUM(si.quantity * si.unit_cost), 0) as total_cost_of_goods,
      COALESCE(SUM(si.net_amount) - SUM(si.quantity * si.unit_cost) - SUM(s.bill_discount_amt), 0) as gross_profit
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    ${where}
  `).get(...params);

  res.json(pnl);
});

// Invoice-wise P&L
app.get('/api/reports/financial/invoice-pnl', (req: Request, res: Response) => {
  const { date_from, date_to } = req.query;
  let where = "WHERE s.status = 'completed'";
  const params: any[] = [];

  if (date_from) {
    where += " AND DATE(s.sale_date) >= ?";
    params.push(date_from);
  }
  if (date_to) {
    where += " AND DATE(s.sale_date) <= ?";
    params.push(date_to);
  }

  const list = db.prepare(`
    SELECT 
      s.id, s.invoice_no, s.sale_date, s.customer_name, s.payment_type,
      s.net_total as sale_amount,
      SUM(si.quantity * si.unit_cost) as total_cost,
      (s.net_total - SUM(si.quantity * si.unit_cost)) as net_profit,
      ROUND(((s.net_total - SUM(si.quantity * si.unit_cost)) / NULLIF(s.net_total, 0)) * 100, 2) as profit_margin_pct
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    ${where}
    GROUP BY s.id
    ORDER BY s.id DESC
    LIMIT 100
  `).all(...params);

  res.json(list);
});

// Product-wise sales
app.get('/api/reports/sales/product-wise', (req: Request, res: Response) => {
  const list = db.prepare(`
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
  `).all();
  res.json(list);
});

// Company-wise sales
app.get('/api/reports/sales/company-wise', (_req: Request, res: Response) => {
  const list = db.prepare(`
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
  `).all();
  res.json(list);
});

// -------------------------------------------------------------
// 8. Utilities: Local Backup & Restore, Stock Zero, Optimization
// -------------------------------------------------------------

app.get('/api/utilities/backups', (_req: Request, res: Response) => {
  try {
    const list = getBackupList();
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/utilities/backup', async (req: Request, res: Response) => {
  const { customDir } = req.body;
  try {
    const result = await createBackup('manual', customDir);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/utilities/optimize', (_req: Request, res: Response) => {
  try {
    const result = optimizeDatabase();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Daily Closing Utility
app.post('/api/utilities/closing', async (req: Request, res: Response) => {
  const {
    closing_date, opening_cash, total_sales_cash, total_sales_card, total_sales_credit,
    total_returns, total_purchases_paid, expenses_total, expected_cash, actual_cash, difference,
    notes, user_id, user_name
  } = req.body;

  try {
    const today = closing_date || new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    const insertClosing = db.prepare(`
      INSERT OR REPLACE INTO daily_closings (
        closing_date, opening_time, closing_time, user_id, user_name,
        opening_cash, total_sales_cash, total_sales_card, total_sales_credit,
        total_returns, total_purchases_paid, expenses_total, expected_cash, actual_cash, difference,
        notes, is_closed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    insertClosing.run(
      today, now, now, user_id || null, user_name || 'Admin',
      opening_cash || 0, total_sales_cash || 0, total_sales_card || 0, total_sales_credit || 0,
      total_returns || 0, total_purchases_paid || 0, expenses_total || 0, expected_cash || 0, actual_cash || 0, difference || 0,
      notes || null
    );

    // Auto-backup on closing if enabled
    const autoBackupEnabled = db.prepare("SELECT value FROM system_settings WHERE key = 'auto_backup_enabled'").get() as any;
    let backupResult = null;
    if (autoBackupEnabled && autoBackupEnabled.value === 'true') {
      try {
        backupResult = await createBackup('auto_daily');
      } catch (bkErr) {
        console.error('Auto backup during closing error:', bkErr);
      }
    }

    res.json({ success: true, message: 'Daily closing recorded successfully.', backup: backupResult });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 9. System Settings
// -------------------------------------------------------------
app.get('/api/settings', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT key, value FROM system_settings').all() as Array<{ key: string; value: string }>;
  const settings: Record<string, string> = {
    max_bill_discount_pct: '14'
  };
  for (const r of rows) {
    settings[r.key] = r.value;
  }
  res.json(settings);
});

app.post('/api/settings', (req: Request, res: Response) => {
  const settings = req.body;
  const upsert = db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  const transaction = db.transaction(() => {
    for (const [key, val] of Object.entries(settings)) {
      upsert.run(key, String(val));
    }
  });

  try {
    transaction();
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`[PharmaCare Server] Running locally on http://localhost:${PORT}`);
});
