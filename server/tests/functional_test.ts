/**
 * PharmaCare Pro - End-to-End Functional Test Suite
 * Covers: Auth, Cashier Shifts, POS Sales (Box + Loose), Returns, Khata, Purchases, Reports, Multi-Destination Backups & SHA-256
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const BASE_URL = 'http://localhost:3001/api';

// ANSI color helpers
const colors = {
  green: (t: string) => `\x1b[32m${t}\x1b[0m`,
  red: (t: string) => `\x1b[31m${t}\x1b[0m`,
  cyan: (t: string) => `\x1b[36m${t}\x1b[0m`,
  yellow: (t: string) => `\x1b[33m${t}\x1b[0m`,
  bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
};

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function request(url: string, options?: RequestInit) {
  const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
  const res = await fetch(fullUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function runTestSuite() {
  console.log(colors.bold(colors.cyan('\n======================================================')));
  console.log(colors.bold(colors.cyan('  PharmaCare Pro - Automated Functional Test Suite   ')));
  console.log(colors.bold(colors.cyan('======================================================\n')));

  let testsPassed = 0;
  let testsTotal = 0;

  async function step(name: string, fn: () => Promise<void>) {
    testsTotal++;
    process.stdout.write(`[Test ${testsTotal}] ${name} ... `);
    try {
      await fn();
      console.log(colors.green('PASSED ✓'));
      testsPassed++;
    } catch (err: any) {
      console.log(colors.red('FAILED ✗'));
      console.error(colors.red(`   Error: ${err.message}`));
      throw err;
    }
  }

  try {
    // ---------------------------------------------------------
    // 1. Settings & Server Health
    // ---------------------------------------------------------
    await step('Verify Server Status and System Settings', async () => {
      const settings = await request('/settings');
      assert(settings && typeof settings === 'object', 'Settings object returned');
      assert(settings.max_bill_discount_pct !== undefined, 'Max discount pct present');
    });

    // ---------------------------------------------------------
    // 2. Authentication
    // ---------------------------------------------------------
    let adminUser: any;
    await step('Authenticate Cashier / Admin User', async () => {
      const authRes = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      });
      assert(authRes.user && authRes.user.id, 'User object with ID returned');
      assert(authRes.user.role === 'admin', 'Role is admin');
      adminUser = authRes.user;
    });

    // ---------------------------------------------------------
    // 3. Shift Management: Start Shift
    // ---------------------------------------------------------
    let testShift: any;
    await step('Start Cashier Register Shift with Opening Cash', async () => {
      // First check if active shift already exists; if so, close it to ensure clean state
      const existing = await request(`/shifts/active?user_id=${adminUser.id}`);
      if (existing.activeShift) {
        await request(`/shifts/${existing.activeShift.id}/close`, {
          method: 'POST',
          body: JSON.stringify({
            actual_cash: existing.summary?.expected_cash || existing.activeShift.opening_cash,
            notes: 'Automated test shift reset',
            user_id: adminUser.id,
            user_name: adminUser.full_name,
          }),
        });
      }

      // Start new shift
      const startRes = await request('/shifts/start', {
        method: 'POST',
        body: JSON.stringify({
          user_id: adminUser.id,
          user_name: adminUser.full_name,
          opening_cash: 5000.00,
          notes: 'Test shift opening',
        }),
      });

      assert(startRes.success, 'Shift started successfully');
      assert(startRes.shift.status === 'open', 'Shift status is open');
      assert(Number(startRes.shift.opening_cash) === 5000, 'Opening cash recorded as 5000');
      testShift = startRes.shift;
    });

    // ---------------------------------------------------------
    // 4. Products Baseline & Catalog Verification
    // ---------------------------------------------------------
    let testProduct: any;
    await step('Fetch Product Master and Verify Stock Baseline', async () => {
      const products = await request('/products');
      assert(Array.isArray(products) && products.length > 0, 'Products list returned');

      // Pick first product with packing >= 10
      testProduct = products.find((p: any) => p.packing >= 10) || products[0];
      assert(testProduct && testProduct.id, 'Test product selected');
      assert(testProduct.packing > 0, 'Product has valid packing unit size');
    });

    // ---------------------------------------------------------
    // 5. POS Counter Sale: Dual Unit Sale (Box + Loose) & Cash Calculation
    // ---------------------------------------------------------
    let createdInvoice: any;
    const initialBoxes = testProduct.stock_boxes;
    const initialLoose = testProduct.stock_loose;
    const initialTotalUnits = (initialBoxes * testProduct.packing) + initialLoose;

    await step('Execute Dual-Unit POS Sale (Box + Loose) with Discounts', async () => {
      const salePayload = {
        customer_name: 'Walk-in Cash Test',
        customer_phone: '0300-1234567',
        payment_type: 'Cash',
        bill_discount_pct: 5,
        bill_discount_amt: 0,
        tendered_amount: 5000,
        user_id: adminUser.id,
        user_name: adminUser.full_name,
        shift_id: testShift.id,
        items: [
          {
            product_id: testProduct.id,
            batch_id: null,
            is_loose: 0, // 1 Full Box
            quantity: 1,
            unit_price: testProduct.box_retail_price,
            discount_pct: 0,
            discount_amt: 0,
          },
          {
            product_id: testProduct.id,
            batch_id: null,
            is_loose: 1, // 2 Loose tablets
            quantity: 2,
            unit_price: testProduct.unit_retail_price,
            discount_pct: 0,
            discount_amt: 0,
          },
        ],
      };

      const saleRes = await request('/sales', {
        method: 'POST',
        body: JSON.stringify(salePayload),
      });

      assert(saleRes.success, 'Sale completed successfully');
      assert(saleRes.invoiceNo && saleRes.invoiceNo.startsWith('INV-'), 'Valid invoice number assigned');
      assert(saleRes.changeDue >= 0, 'Change due calculated correctly');
      createdInvoice = saleRes;

      // Verify inventory deducted correctly
      const updatedProduct = await request(`/products/${testProduct.id}`);
      const newTotalUnits = (updatedProduct.stock_boxes * updatedProduct.packing) + updatedProduct.stock_loose;
      const soldUnits = testProduct.packing + 2; // 1 box + 2 loose
      assert(initialTotalUnits - newTotalUnits === soldUnits, `Exact stock deducted: expected ${soldUnits} units reduction`);
    });

    // ---------------------------------------------------------
    // 6. Shift Summary Check (Sales Real-time Accumulation)
    // ---------------------------------------------------------
    await step('Verify Shift Reconciliation & Cash Summary', async () => {
      const summaryRes = await request(`/shifts/${testShift.id}/summary`);
      assert(summaryRes.summary, 'Summary object present');
      assert(summaryRes.summary.invoices_count >= 1, 'Invoices count incremented');
      assert(summaryRes.summary.total_sales_cash > 0, 'Cash sales accumulated');
      assert(summaryRes.summary.expected_cash > 5000, 'Expected cash includes opening cash + sales');
    });

    // ---------------------------------------------------------
    // 7. Sales Return Engine: Restores Stock & Deducts from Shift
    // ---------------------------------------------------------
    await step('Process Line-Item Sale Return & Verify Stock Restoration', async () => {
      const preReturnProduct = await request(`/products/${testProduct.id}`);
      const preReturnTotalUnits = (preReturnProduct.stock_boxes * preReturnProduct.packing) + preReturnProduct.stock_loose;

      const returnPayload = {
        sale_id: createdInvoice.invoiceId,
        original_invoice_no: createdInvoice.invoiceNo,
        customer_name: 'Walk-in Cash Test',
        shift_id: testShift.id,
        reason: 'Customer returned 1 loose unit',
        return_items: [
          {
            product_id: testProduct.id,
            is_loose: 1,
            quantity: 1,
            unit_refund_price: testProduct.unit_retail_price,
            total_refund: testProduct.unit_retail_price,
          },
        ],
      };

      const returnRes = await request('/sales/return', {
        method: 'POST',
        body: JSON.stringify(returnPayload),
      });

      assert(returnRes.success, 'Return voucher created successfully');
      assert(returnRes.returnNo && (returnRes.returnNo.startsWith('SR-') || returnRes.returnNo.startsWith('RET-')), 'Return number assigned');

      // Verify stock restored
      const postReturnProduct = await request(`/products/${testProduct.id}`);
      const postReturnTotalUnits = (postReturnProduct.stock_boxes * postReturnProduct.packing) + postReturnProduct.stock_loose;
      assert(postReturnTotalUnits - preReturnTotalUnits === 1, 'Stock units restored by 1');
    });

    // ---------------------------------------------------------
    // 8. Customer Credit (Khata) & Recovery
    // ---------------------------------------------------------
    let testCustomer: any;
    await step('Record Customer Credit (Udhar) Sale and Recovery Payment', async () => {
      // Create or find customer
      const customers = await request('/customers');
      testCustomer = customers[0];
      if (!testCustomer) {
        testCustomer = await request('/customers', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Dr. Test Clinic',
            phone: '0312-9876543',
            credit_limit: 50000,
          }),
        });
      }

      // 1. Execute Credit Sale to increase customer balance
      const creditSale = await request('/sales', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: testCustomer.id,
          customer_name: testCustomer.name,
          payment_type: 'Credit',
          shift_id: testShift.id,
          items: [
            {
              product_id: testProduct.id,
              is_loose: 0,
              quantity: 1,
              unit_price: 500,
            },
          ],
        }),
      });
      assert(creditSale.success, 'Credit sale recorded');

      const allCusts = await request('/customers');
      const custAfterCredit = allCusts.find((c: any) => c.id === testCustomer.id);
      const balanceAfterCredit = Number(custAfterCredit.current_balance);
      assert(balanceAfterCredit >= 500, 'Customer current_balance increased from credit sale');

      // 2. Record recovery payment
      const paymentRes = await request(`/customers/${testCustomer.id}/payment`, {
        method: 'POST',
        body: JSON.stringify({
          amount: 250.00,
          payment_method: 'Cash',
          notes: 'Test recovery payment',
          shift_id: testShift.id,
        }),
      });

      assert(paymentRes.success, 'Customer payment recorded');
      assert(paymentRes.new_balance === balanceAfterCredit - 250.00, 'Customer balance updated correctly');
    });

    // ---------------------------------------------------------
    // 9. Supplier Purchases & Stock Inward
    // ---------------------------------------------------------
    await step('Record Supplier Purchase Inward with Bonus Stock', async () => {
      const companies = await request('/companies');
      assert(companies.length > 0, 'Supplier companies available');
      const testCompany = companies[0];

      const beforeStock = await request(`/products/${testProduct.id}`);
      const beforeBoxes = beforeStock.stock_boxes;

      const purchaseRes = await request('/purchases', {
        method: 'POST',
        body: JSON.stringify({
          company_id: testCompany.id,
          invoice_no: `SUPP-TEST-${Date.now().toString().slice(-6)}`,
          purchase_date: new Date().toISOString(),
          payment_status: 'Paid',
          items: [
            {
              product_id: testProduct.id,
              batch_no: 'BATCH-TEST-01',
              expiry_date: '2028-12-31',
              boxes: 5,
              bonus_boxes: 1, // 5 + 1 bonus = 6 total boxes added
              box_trade_price: testProduct.box_trade_price || 100,
              box_retail_price: testProduct.box_retail_price || 120,
              discount_pct: 0,
            },
          ],
        }),
      });

      assert(purchaseRes.success, 'Purchase inward recorded');

      // Verify stock incremented by 6 boxes
      const afterStock = await request(`/products/${testProduct.id}`);
      assert(afterStock.stock_boxes - beforeBoxes === 6, 'Inventory incremented by (boxes + bonus)');
    });

    // ---------------------------------------------------------
    // 10. Reports & Financial Intelligence
    // ---------------------------------------------------------
    await step('Generate Financial Profit & Loss (P&L) Report', async () => {
      const pnl = await request('/reports/financial/pnl-summary');
      assert(pnl && typeof pnl === 'object', 'P&L summary returned');
      assert(pnl.total_revenue !== undefined || pnl.grossRevenue !== undefined, 'Revenue field present');
      assert(pnl.gross_profit !== undefined || pnl.netProfit !== undefined, 'Gross profit field present');
    });

    // ---------------------------------------------------------
    // 11. Multi-Destination Backup & SHA-256 Verification
    // ---------------------------------------------------------
    await step('Create Multi-Destination Atomic Backup with SHA-256 Checksum', async () => {
      const secondaryVault = path.resolve(process.cwd(), 'backups/test_secondary_vault');
      if (!fs.existsSync(secondaryVault)) {
        fs.mkdirSync(secondaryVault, { recursive: true });
      }

      const backupRes = await request('/utilities/backup', {
        method: 'POST',
        body: JSON.stringify({
          customDir: './backups',
          secondaryDir: secondaryVault,
        }),
      });

      assert(backupRes.success, 'Backup created successfully');
      assert(fs.existsSync(backupRes.filepath), 'Primary backup file exists on disk');
      assert(backupRes.checksumSha256 && backupRes.checksumSha256.length === 64, 'Valid 64-char SHA-256 returned');

      // Check SHA-256 sidecar file
      const shaFile = `${backupRes.filepath}.sha256`;
      assert(fs.existsSync(shaFile), 'SHA-256 sidecar file created');
      const shaContent = fs.readFileSync(shaFile, 'utf8');
      assert(shaContent.includes(backupRes.checksumSha256), 'Sidecar contains exact SHA-256 hash');

      // Verify secondary destination copy
      if (backupRes.secondaryPath) {
        assert(fs.existsSync(backupRes.secondaryPath), 'Secondary destination backup file exists');
        const secFileBuffer = fs.readFileSync(backupRes.secondaryPath);
        const secHash = crypto.createHash('sha256').update(secFileBuffer).digest('hex');
        assert(secHash === backupRes.checksumSha256, 'Secondary destination copy has identical SHA-256 checksum');
      }

      // Cleanup test secondary folder
      try {
        fs.rmSync(secondaryVault, { recursive: true, force: true });
      } catch {}
    });

    // ---------------------------------------------------------
    // 12. Close Shift & Trigger Automated Shift Backup
    // ---------------------------------------------------------
    await step('Close Cashier Shift and Trigger Automated Backup', async () => {
      const summary = await request(`/shifts/${testShift.id}/summary`);
      const expectedCash = summary.summary.expected_cash;

      const closeRes = await request(`/shifts/${testShift.id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          actual_cash: expectedCash, // Balanced closing
          notes: 'Automated test shift closing',
          user_id: adminUser.id,
          user_name: adminUser.full_name,
        }),
      });

      assert(closeRes.success, 'Shift closed successfully');
      assert(closeRes.shift.status === 'closed', 'Shift status updated to closed');
      assert(closeRes.shift.cash_difference === 0, 'Zero cash difference for balanced closing');
      assert(closeRes.backup && closeRes.backup.filename, 'Automated shift-closing backup triggered');
    });

    console.log(colors.bold(colors.green('\n======================================================')));
    console.log(colors.bold(colors.green(`  ALL ${testsPassed}/${testsTotal} FUNCTIONAL TESTS PASSED SUCCESSFULLY!  `)));
    console.log(colors.bold(colors.green('======================================================\n')));

  } catch (error: any) {
    console.log(colors.bold(colors.red('\n======================================================')));
    console.log(colors.bold(colors.red(`  TEST SUITE TERMINATED WITH ERROR (${testsPassed}/${testsTotal} passed)  `)));
    console.log(colors.bold(colors.red('======================================================\n')));
    process.exit(1);
  }
}

runTestSuite();
