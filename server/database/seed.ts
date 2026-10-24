import type Database from 'better-sqlite3';

export function seedInitialData(db: Database.Database) {
  // 1. Seed System Settings
  const defaultSettings: Record<string, string> = {
    store_name: 'AL-SHIFA PHARMACY & WELLNESS',
    store_address: 'Suite #12-14, Health Plaza, Main Commercial Ave',
    store_phone: '+92 300 9876543 / 051-4567890',
    drug_license_no: 'DL-PHARM-2024-9981',
    tax_no: 'NTN: 7392819-1',
    receipt_header: 'Quality Medicines • Certified Pharmacist on Duty',
    receipt_footer: 'Wishing you swift health & wellness!',
    receipt_terms: '1. Returns accepted within 3 days with original bill.\n2. Cold-chain, cut strips, and loose items are non-refundable.\n3. Please consult a doctor before altering dosages.',
    currency_symbol: 'Rs.',
    auto_backup_dir: './backups',
    auto_backup_enabled: 'true',
    low_stock_threshold: '10',
    paper_width: '80mm',
    max_bill_discount_pct: '14',
    default_invoice_template: 'classic',
    invoice_paper_size: '80mm',
    return_policy_text: 'Unopened medicines in original packaging may be returned or exchanged within 3 days with this invoice. Heat-sensitive and loose items are non-returnable.',
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
    show_developer_info: 'true',
    setup_completed: 'false',
    developer_email: '',
    backup_retention_limit: '10',
    backup_frequency: 'daily',
    backup_scheduled_time: '23:00',
    backup_weekly_day: '0',
    developer_invoice_footer: 'Software maintained by System Developer',
    allow_admin_create_cashier: 'true',
    allow_admin_create_admin: 'false',
    allow_admin_edit_store_identity: 'false',
    allow_admin_hide_store_identity: 'false'
  };

  const insertSetting = db.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)');
  for (const [key, val] of Object.entries(defaultSettings)) {
    insertSetting.run(key, val);
  }

  // 2. Seed Default Roles & Permissions
  const roleCount = (db.prepare('SELECT COUNT(*) as count FROM roles').get() as { count: number }).count;
  if (roleCount === 0) {
    const insertRole = db.prepare(`
      INSERT INTO roles (name, display_name, description, is_system, permissions)
      VALUES (?, ?, ?, ?, ?)
    `);

    const adminPerms = {
      dashboard: true,
      pos: true,
      sales: true,
      khata: true,
      masters: true,
      purchases: true,
      reports: true,
      utilities: true,
      settings: true,
      can_add_product: true,
      can_edit_product: true,
      can_delete_product: true,
      can_add_company: true,
      can_edit_company: true,
      can_delete_company: true,
      can_delete_invoice: true,
      can_return_sale: true,
      can_view_all_sales: true,
      can_view_financial_kpis: true,
      can_add_purchase: true,
      can_add_customer: true,
      can_receive_payment: true,
      can_edit_customer: true,
      can_delete_customer: true,
      can_discount: true,
      can_backup: true,
      can_restore: true,
      can_shift_close: true,
      can_manage_shifts: true,
      can_stock_zero: true,
      can_manage_users: true,
      can_manage_roles: true
    };

    const cashierPerms = {
      dashboard: false,
      pos: true,
      sales: true,
      khata: true,
      masters: true,
      purchases: false,
      reports: false,
      utilities: false,
      settings: false,
      can_add_product: true,
      can_edit_product: false,
      can_delete_product: false,
      can_add_company: true,
      can_edit_company: false,
      can_delete_company: false,
      can_delete_invoice: false,
      can_return_sale: true,
      can_view_all_sales: false,
      can_view_financial_kpis: false,
      can_add_purchase: false,
      can_add_customer: true,
      can_receive_payment: true,
      can_edit_customer: false,
      can_delete_customer: false,
      can_discount: true,
      can_backup: false,
      can_restore: false,
      can_shift_close: true,
      can_manage_shifts: false,
      can_stock_zero: false,
      can_manage_users: false,
      can_manage_roles: false
    };

    const pharmacistPerms = {
      dashboard: true,
      pos: true,
      sales: true,
      khata: true,
      masters: true,
      purchases: true,
      reports: false,
      utilities: false,
      settings: false,
      can_add_product: true,
      can_edit_product: true,
      can_delete_product: false,
      can_add_company: true,
      can_edit_company: true,
      can_delete_company: false,
      can_delete_invoice: false,
      can_return_sale: true,
      can_view_all_sales: true,
      can_view_financial_kpis: false,
      can_add_purchase: true,
      can_add_customer: true,
      can_receive_payment: true,
      can_edit_customer: true,
      can_delete_customer: false,
      can_discount: true,
      can_backup: false,
      can_restore: false,
      can_shift_close: true,
      can_manage_shifts: false,
      can_stock_zero: false,
      can_manage_users: false,
      can_manage_roles: false
    };

    insertRole.run('developer', 'System Developer', 'Master system configuration, security rules, and TOTP authentication', 1, JSON.stringify(adminPerms));
    insertRole.run('admin', 'Administrator', 'Full system access and master privileges', 1, JSON.stringify(adminPerms));
    insertRole.run('cashier', 'Counter Cashier', 'POS sales, customer credit recoveries, and view/add medicines. Cannot delete/edit records.', 0, JSON.stringify(cashierPerms));
    insertRole.run('pharmacist', 'Pharmacist', 'Dispensing, master coding, and inventory purchases.', 0, JSON.stringify(pharmacistPerms));
  } else {
    // Ensure developer role exists even on existing databases
    const insertOrIgnoreRole = db.prepare(`
      INSERT OR IGNORE INTO roles (name, display_name, description, is_system, permissions)
      VALUES (?, ?, ?, ?, ?)
    `);
    const devPerms = (db.prepare("SELECT permissions FROM roles WHERE name = 'admin'").get() as any)?.permissions || '{}';
    insertOrIgnoreRole.run('developer', 'System Developer', 'Master system configuration, security rules, and TOTP authentication', 1, devPerms);
  }

  // 2b. No default staff accounts: the Developer creates the Admin (with its password) in the setup wizard,
  // and the Admin creates cashiers. Shipping fixed passwords such as admin123 would leave a backdoor.

  // 3. Seed Companies
  const companyCount = (db.prepare('SELECT COUNT(*) as count FROM companies').get() as { count: number }).count;
  if (companyCount === 0) {
    const insertCompany = db.prepare(`
      INSERT INTO companies (code, name, contact_person, phone, email, address)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertCompany.run('GSK', 'GlaxoSmithKline Healthcare', 'Tariq Mehmood', '+92 321 1112233', 'orders@gsk.local', 'Plot 35, Industrial Area, Karachi');
    insertCompany.run('ABT', 'Abbott Laboratories', 'Saleem Raza', '+92 333 4445566', 'dist@abbott.local', 'Landhi Industrial Estate, Karachi');
    insertCompany.run('SEARLE', 'The Searle Company Limited', 'Kamran Sheikh', '+92 300 7778899', 'supply@searle.local', 'F-224, S.I.T.E, Karachi');
    insertCompany.run('GETZ', 'Getz Pharma (Pvt) Ltd', 'Nadeem Akhtar', '+92 345 2223344', 'sales@getzpharma.local', '29-30/27, Korangi Industrial Area');
    insertCompany.run('SANO', 'Sanofi-Aventis Pakistan', 'Zahid Hussain', '+92 312 9990011', 'order@sanofi.local', 'Plot 23, Korangi Sector 22');
    insertCompany.run('BOSC', 'Bosch Pharmaceuticals', 'Faisal Latif', '+92 322 8887766', 'info@bosch.local', 'Federal B Area, Karachi');
    insertCompany.run('BAY', 'Bayer Healthcare', 'Imran Siddiqui', '+92 301 5554433', 'orders@bayer.local', 'Clifton Corporate Towers');
  }

  // 4. Seed Products
  const productCount = (db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }).count;
  if (productCount === 0) {
    const getCompanyId = db.prepare('SELECT id FROM companies WHERE code = ?');

    const products = [
      {
        c_code: 'GSK',
        p_code: 'GSK-PAN-500',
        barcode: '89640001001',
        name: 'Panadol 500mg Tablets',
        generic_name: 'Paracetamol',
        unit_type: 'Tablets',
        packing: 200,
        box_trade_price: 425.00,
        box_retail_price: 500.00,
        unit_trade_price: 2.12,
        unit_retail_price: 2.50,
        default_discount_pct: 5.0,
        location_rack: 'Rack-A1',
        stock_boxes: 35,
        stock_loose: 60,
        min_stock_alert: 10,
        batches: [
          { batch_no: 'B-PAN-2024A', expiry_date: '2027-08-30', boxes: 35, loose: 60, cost: 425.0, retail: 500.0 }
        ]
      },
      {
        c_code: 'GSK',
        p_code: 'GSK-AUG-625',
        barcode: '89640001002',
        name: 'Augmentin 625mg Tablets',
        generic_name: 'Amoxicillin + Clavulanic Acid',
        unit_type: 'Tablets',
        packing: 14,
        box_trade_price: 295.00,
        box_retail_price: 345.00,
        unit_trade_price: 21.07,
        unit_retail_price: 24.64,
        default_discount_pct: 5.0,
        location_rack: 'Rack-A2',
        stock_boxes: 45,
        stock_loose: 0,
        min_stock_alert: 15,
        batches: [
          { batch_no: 'B-AUG-9921', expiry_date: '2026-12-15', boxes: 45, loose: 0, cost: 295.0, retail: 345.0 }
        ]
      },
      {
        c_code: 'ABT',
        p_code: 'ABT-BRU-400',
        barcode: '89640002001',
        name: 'Brufen 400mg Tablets',
        generic_name: 'Ibuprofen',
        unit_type: 'Tablets',
        packing: 300,
        box_trade_price: 680.00,
        box_retail_price: 810.00,
        unit_trade_price: 2.27,
        unit_retail_price: 2.70,
        default_discount_pct: 5.0,
        location_rack: 'Rack-B1',
        stock_boxes: 20,
        stock_loose: 150,
        min_stock_alert: 8,
        batches: [
          { batch_no: 'B-BRU-332', expiry_date: '2028-03-31', boxes: 20, loose: 150, cost: 680.0, retail: 810.0 }
        ]
      },
      {
        c_code: 'ABT',
        p_code: 'ABT-ARI-FORTE',
        barcode: '89640002002',
        name: 'Arinac Forte Tablets',
        generic_name: 'Ibuprofen + Pseudoephedrine',
        unit_type: 'Tablets',
        packing: 100,
        box_trade_price: 360.00,
        box_retail_price: 430.00,
        unit_trade_price: 3.60,
        unit_retail_price: 4.30,
        default_discount_pct: 0.0,
        location_rack: 'Rack-B2',
        stock_boxes: 28,
        stock_loose: 20,
        min_stock_alert: 10,
        batches: [
          { batch_no: 'B-ARI-771', expiry_date: '2027-05-15', boxes: 28, loose: 20, cost: 360.0, retail: 430.0 }
        ]
      },
      {
        c_code: 'SANO',
        p_code: 'SAN-FLA-400',
        barcode: '89640003001',
        name: 'Flagyl 400mg Tablets',
        generic_name: 'Metronidazole',
        unit_type: 'Tablets',
        packing: 200,
        box_trade_price: 390.00,
        box_retail_price: 465.00,
        unit_trade_price: 1.95,
        unit_retail_price: 2.32,
        default_discount_pct: 5.0,
        location_rack: 'Rack-B3',
        stock_boxes: 25,
        stock_loose: 40,
        min_stock_alert: 10,
        batches: [
          { batch_no: 'B-FLA-401', expiry_date: '2027-10-30', boxes: 25, loose: 40, cost: 390.0, retail: 465.0 }
        ]
      },
      {
        c_code: 'GETZ',
        p_code: 'GTZ-RIS-40',
        barcode: '89640004001',
        name: 'Risek 40mg Capsules',
        generic_name: 'Omeprazole',
        unit_type: 'Capsules',
        packing: 14,
        box_trade_price: 460.00,
        box_retail_price: 545.00,
        unit_trade_price: 32.85,
        unit_retail_price: 38.92,
        default_discount_pct: 7.0,
        location_rack: 'Rack-C1',
        stock_boxes: 30,
        stock_loose: 7,
        min_stock_alert: 10,
        batches: [
          { batch_no: 'B-RIS-550', expiry_date: '2026-11-20', boxes: 30, loose: 7, cost: 460.0, retail: 545.0 }
        ]
      },
      {
        c_code: 'SEARLE',
        p_code: 'SRL-HYD-SYR',
        barcode: '89640005001',
        name: 'Hydryllin Syrup 120ml',
        generic_name: 'Aminophylline Compound',
        unit_type: 'Syrup',
        packing: 1,
        box_trade_price: 98.00,
        box_retail_price: 118.00,
        unit_trade_price: 98.00,
        unit_retail_price: 118.00,
        default_discount_pct: 0.0,
        location_rack: 'Syrup-Rack-1',
        stock_boxes: 50,
        stock_loose: 0,
        min_stock_alert: 12,
        batches: [
          { batch_no: 'B-HYD-102', expiry_date: '2026-09-10', boxes: 50, loose: 0, cost: 98.0, retail: 118.0 }
        ]
      },
      {
        c_code: 'GSK',
        p_code: 'GSK-VEN-INH',
        barcode: '89640001003',
        name: 'Ventolin Inhaler 200 Dose',
        generic_name: 'Salbutamol',
        unit_type: 'Inhaler',
        packing: 1,
        box_trade_price: 275.00,
        box_retail_price: 325.00,
        unit_trade_price: 275.00,
        unit_retail_price: 325.00,
        default_discount_pct: 0.0,
        location_rack: 'Inhaler-Sec',
        stock_boxes: 16,
        stock_loose: 0,
        min_stock_alert: 5,
        batches: [
          { batch_no: 'B-VEN-441', expiry_date: '2027-02-28', boxes: 16, loose: 0, cost: 275.0, retail: 325.0 }
        ]
      },
      {
        c_code: 'BAY',
        p_code: 'BAY-CIP-500',
        barcode: '89640007001',
        name: 'Ciproxin 500mg Tablets',
        generic_name: 'Ciprofloxacin',
        unit_type: 'Tablets',
        packing: 10,
        box_trade_price: 430.00,
        box_retail_price: 510.00,
        unit_trade_price: 43.00,
        unit_retail_price: 51.00,
        default_discount_pct: 5.0,
        location_rack: 'Rack-E1',
        stock_boxes: 22,
        stock_loose: 0,
        min_stock_alert: 8,
        batches: [
          { batch_no: 'B-CIP-881', expiry_date: '2027-07-20', boxes: 22, loose: 0, cost: 430.0, retail: 510.0 }
        ]
      },
      {
        c_code: 'GSK',
        p_code: 'GSK-POL-OINT',
        barcode: '89640001005',
        name: 'Polyfax Skin Ointment 20g',
        generic_name: 'Polymyxin B + Bacitracin',
        unit_type: 'Ointment',
        packing: 1,
        box_trade_price: 88.00,
        box_retail_price: 108.00,
        unit_trade_price: 88.00,
        unit_retail_price: 108.00,
        default_discount_pct: 0.0,
        location_rack: 'Rack-Ointment',
        stock_boxes: 42,
        stock_loose: 0,
        min_stock_alert: 15,
        batches: [
          { batch_no: 'B-POL-209', expiry_date: '2026-10-01', boxes: 42, loose: 0, cost: 88.0, retail: 108.0 }
        ]
      },
      {
        c_code: 'SEARLE',
        p_code: 'SRL-GRA-SYR',
        barcode: '89640005002',
        name: 'Gravinate Syrup 120ml',
        generic_name: 'Dimenhydrinate',
        unit_type: 'Syrup',
        packing: 1,
        box_trade_price: 110.00,
        box_retail_price: 132.00,
        unit_trade_price: 110.00,
        unit_retail_price: 132.00,
        default_discount_pct: 0.0,
        location_rack: 'Syrup-Rack-1',
        stock_boxes: 4, // Intentionally low stock
        stock_loose: 0,
        min_stock_alert: 10,
        batches: [
          { batch_no: 'B-GRA-099', expiry_date: '2026-10-25', boxes: 4, loose: 0, cost: 110.0, retail: 132.0 }
        ]
      },
      {
        c_code: 'BOSC',
        p_code: 'BSC-CEF-400',
        barcode: '89640008001',
        name: 'Cefspan 400mg Capsules',
        generic_name: 'Cefixime',
        unit_type: 'Capsules',
        packing: 5,
        box_trade_price: 490.00,
        box_retail_price: 580.00,
        unit_trade_price: 98.00,
        unit_retail_price: 116.00,
        default_discount_pct: 5.0,
        location_rack: 'Rack-C2',
        stock_boxes: 0, // Intentionally finished / out of stock
        stock_loose: 0,
        min_stock_alert: 5,
        batches: [
          { batch_no: 'B-CEF-110', expiry_date: '2026-08-15', boxes: 0, loose: 0, cost: 490.0, retail: 580.0 }
        ]
      }
    ];

    const insertProd = db.prepare(`
      INSERT INTO products (
        company_id, c_code, p_code, barcode, name, generic_name, unit_type,
        packing, box_trade_price, box_retail_price, unit_trade_price, unit_retail_price,
        default_discount_pct, location_rack, stock_boxes, stock_loose, min_stock_alert,
        allow_open_sale, min_sale_qty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBatch = db.prepare(`
      INSERT INTO product_batches (
        product_id, batch_no, expiry_date, purchase_cost, retail_price, quantity_boxes, quantity_loose
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of products) {
      const comp = getCompanyId.get(p.c_code) as { id: number } | undefined;
      const compId = comp ? comp.id : null;
      const allowOpen = p.packing > 1 ? 1 : 0;
      const minQty = 1;

      const res = insertProd.run(
        compId, p.c_code, p.p_code, p.barcode, p.name, p.generic_name, p.unit_type,
        p.packing, p.box_trade_price, p.box_retail_price, p.unit_trade_price, p.unit_retail_price,
        p.default_discount_pct, p.location_rack, p.stock_boxes, p.stock_loose, p.min_stock_alert,
        allowOpen, minQty
      );

      const prodId = res.lastInsertRowid;
      for (const b of p.batches) {
        insertBatch.run(prodId, b.batch_no, b.expiry_date, b.cost, b.retail, b.boxes, b.loose);
      }
    }
  }

  // 5. Seed Customers
  const customerCount = (db.prepare('SELECT COUNT(*) as count FROM customers').get() as { count: number }).count;
  if (customerCount === 0) {
    const insertCust = db.prepare('INSERT INTO customers (name, phone, address, credit_limit, current_balance) VALUES (?, ?, ?, ?, ?)');
    insertCust.run('Walk-in Customer', '', 'Over the counter', 0, 0);
    insertCust.run('Dr. Naeem Ward-5 Clinic', '+92 300 5551234', 'Opposite Civil Hospital', 50000, 12400);
    insertCust.run('Al-Kareem Maternity Home', '+92 321 8884433', 'Plot 44, Block C, Satellite Town', 100000, 35000);
  }
}
