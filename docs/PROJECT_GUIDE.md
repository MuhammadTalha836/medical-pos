# PharmaCare Pro - System Instruction & Development Guide

Welcome to **PharmaCare Pro**, a complete, production-ready, 100% offline desktop Pharmacy Management & Point-of-Sale (POS) System built for retail pharmacies and medical distributors.

This document serves as the master guide for developers and AI agents working on this codebase. Adhere strictly to the architecture, conventions, and rules detailed below.

---

## 1. Product Overview

PharmaCare Pro is designed for high-speed, reliable pharmacy operations with **zero internet reliance**. All data persists locally in an embedded SQLite database using Write-Ahead Logging (WAL) mode for maximum reliability, ACID compliance, and zero-latency concurrent read/write performance.

### Core Modules & Features:

1. **POS Counter Sales (`PosPage.tsx`, `usePosStore.ts`)**:
   - **Keyboard-First Workflow**: High-speed counter checkout powered by dedicated hotkeys:
     - `F2` / `Ctrl+T`: Open a new invoice tab (the current invoice stays open).
     - `Ctrl+→` / `Ctrl+Tab`, `Ctrl+←` / `Ctrl+Shift+Tab`: Next / previous invoice tab (wraps around); `Ctrl+1`…`Ctrl+9`: jump to tab N.
     - `Ctrl+W`: Close the current invoice tab (asks first if it has items).
     - `F3`: Focus and select Product / Barcode Search input.
     - `F4`: Focus Customer Name / Phone input.
     - `F6`: Focus Bill Discount (%) input (strictly guarded by `can_discount` cashier permission).
     - `F8`: Focus Tendered / Cash Received input.
     - `F9`: Save Invoice without printing (anti-duplicate lock protected).
     - `F10`: Save & Print Receipt (or reprint most recently completed sale).
     - `Esc`: Safely close modal dialogs or dismiss search results.
   - **Invoice tabs (`InvoiceTabs.tsx`)**: Up to 10 open invoices, like browser tabs, so a customer who pauses (e.g. takes a call) keeps their order while the next customer is served. Each tab has its own cart, customer, discount, payment and cash received. Saving a sale closes only its tab. Open tabs are saved on the computer (`localStorage` key `pharmacare_pos_invoices_v1`, zustand `persist`) and come back after a restart; they belong to the user who opened them (another user starts with one empty tab) and are cleared on sign-out. The server re-checks stock and prices when a restored invoice is saved.
   - **Visual Shortcut Ribbon & HUD**: Persistent bottom ribbon displaying active shortcut hotkeys and an interactive **Shortcuts Guide** dialog. High-contrast `<kbd>` badge pills across all key form inputs.
   - **Anti-Duplicate Invoice Lock & Concurrency Defense**: Synchronous frontend submission lock (`isSubmittingRef`) and `e.repeat` suppression prevent double-submissions from rapid clicks or held keys. Backend moves invoice sequence calculation inside `prisma.$transaction` with a 5-attempt retry loop handling SQLite locks (`SQLITE_BUSY`) and collision retries.
   - **Instant Barcode & Text Search**: Real-time matching across Brand Name, Generic Formula, C-Code, and P-Code/Barcode.
   - **Dual-Unit Sales**: Sell by **Full Box/Pack** or **Loose Units** (tablets/capsules/ml) with real-time price translation.

2. **Cashier Register & Shift Management (`ShiftsAdminPage.tsx`, `ShiftClosingModal.tsx`, `ShiftThermalReceipt.tsx`)**:
   - **Active Register Tracking**: Cashiers start shifts with a recorded opening cash float. All POS sales, returns, and payment types are tracked against the active shift.
   - **Multi-Payment Reconciliation**: Tracks Cash, Card/Online (digital) and Credit (Khata) totals in real time. One calculation (`server/shifts/shiftTotals.ts`) serves the live summary, the close, the shift list and details, and the admin force-close. Expected cash = opening + cash sales + cash khata recoveries − refunds of cash invoices (a credit return lowers the khata balance instead).
   - **Cash expenses (M8)**: an expense paid in cash during the cashier's own open shift is linked to it (`expenses.shift_id`) and lowers the expected cash; the close saves it as `total_expenses_cash`. The shift details have an Expenses tab, and the shift slip prints the line.
   - **Closing**: needs the counted cash, runs in one transaction (a second close fails), and only the shift's cashier or a user with `can_manage_shifts` may close it. A closed shift is not reopened while that cashier has another open shift.
   - **Shift Balancing & Discrepancies**: Calculates expected closing cash versus counted cash, recording exact cash shortage or excess.
   - **Admin Shift Hub**: Dedicated admin section with cashier, date range, and status filters, and line-item invoice inspector.
   - **Automated Backup on Shift Closure**: Shift closing triggers a verified `shift_close` backup alongside the timed schedule, unless the Developer has set the backup frequency to Off.

3. **Thermal-Only Invoice Templates & Protected Store Identity (`UnifiedInvoice.tsx`, `SettingsPage.tsx`, `server/invoice/invoiceSettings.ts`)**:
   - **Thermal-only**: Receipts print exclusively on **58 mm** or **80 mm** rolls (`invoice_paper_size`, mirrored into legacy `paper_width`). A3/A4/A5 sheet formats were removed; `POST /api/settings` rejects them with HTTP 400 and startup migration (`migrateLegacyInvoiceSettings`) rewrites old values (`A4` → `80mm`, `thermal`/`standard` → `classic`).
   - **Design 1: Classic (`classic`)**: Full column table on 80 mm, two-line rows on 58 mm, barcode, terms and footer note.
   - **Design 2: Compact (`compact`)**: Paper-saving two-line item rows with net / tendered / change totals only.
   - **Design 3: Detailed (`detailed`)**: Numbered lines with code & rack, split line/bill discounts, terms and return policy.
   - **58 mm layout**: Every design switches to two-line item rows and a smaller font scale so nothing overflows the 48 mm printable width.
   - **Admin selection**: Admins choose the design and roll width in Invoice Settings with a live preview (design + width switches). The choice is stored in SQLite and is authoritative; there is no template switcher at print time.
   - **Protected store identity**: Store name/address come from the Developer-protected settings. Admins cannot hide them unless the Developer enables `allow_admin_hide_store_identity` (enforced in `GET`/`POST /api/settings`).
   - **Developer invoice footer**: `developer_invoice_footer` (max 500 chars, multi-line) prints on every design and width, wrapping long text with `overflow-wrap: anywhere`.
   - **Sale snapshots**: Each sale stores `store_name_snapshot`, `store_address_snapshot` and `invoice_footer_snapshot`, so reprints match the original receipt. Older sales without a snapshot fall back to current settings.
   - **Printing without the dialog (`src/utils/printReceipt.ts`, `ReceiptPrinterCard.tsx`, `electron/main.ts`)**: Each computer picks its receipt printer and can turn on "Print without dialog" (Settings → Invoice → Receipt Printer; stored in `localStorage` key `pharmacare_print_prefs`, because each counter has its own printer). The receipt is sent as a standalone HTML document to the `print:thermal` IPC, which prints it from a hidden, sandboxed window sized to the roll width and the receipt's real length, so the roll is not fed past the end. If the printer fails, or the option is off, the normal print dialog opens. `printers:list` returns the installed printers.
   - **Granular Field Visibility Controls**: Admin checkboxes across Store Info, Cashier/Customer Info, Itemized Table Columns, Financial Summary, and Regulatory Policies.
   - **Settings authorization**: `POST /api/settings` requires the Developer or a role with the `settings` permission (the Developer decides whether the Admin has it); developer-only keys (footer, RBAC toggles, backup policy) are stripped for non-developers and `setup_completed` / `developer_email` can never be written through it.

4. **Product-Level Open-Sale & Minimum Quantity Enforcement (`MastersPage.tsx`, `PosPage.tsx`, `server/api.ts`)**:
   - **Product Creation Settings**: Fields for Sale Unit (`unit_type`), Units per Pack (`packing`), Allow Open Sale switch (`allow_open_sale`), and Minimum Sale Quantity (`min_sale_qty`).
   - **Stock Conversion Card**: Real-time formula card displaying exact pack vs individual-unit inventory deduction.
   - **Multi-Level Enforcement**: Disables `+ Loose` buttons in search and strikes through `[Loose]` cart toggles for non-openable medicines. Automatically clamps quantities to `min_sale_qty`. Backend rejects loose unit sales (HTTP 400), sub-minimum sales (HTTP 400), and loose returns for sealed medicines.

5. **Customers & Khata (`CustomersPage.tsx`, `components/customers/*`)** (sidebar: Customers):
   - **Customers tab (`CustomersTab.tsx`)**: every customer with phone, address, invoice count, total bought and khata balance; Edit (`can_edit_customer`) and Delete (`can_delete_customer`). The arrow at the start of a row expands that customer's invoices; clicking one opens `InvoiceModal.tsx` with the full invoice and Print (reprint). A customer can be deleted only with no invoices, payments or balance (`DELETE /api/customers/:id` answers 409 otherwise).
   - **Khata (Udhaar) tab (`KhataTab.tsx`)**: totals (udhaar to receive, customers with udhaar, over limit), customers with a balance, Receive Payment (`can_receive_payment`), **Send reminder** on WhatsApp (M7), and per customer the credit invoices and payments received (balance before → after).
   - **WhatsApp (M7, `shared/whatsapp.ts`, `components/common/WhatsAppButton.tsx`)**: receipts (POS receipt modal and invoice reprint), khata reminders and supplier order lists open WhatsApp through a `https://wa.me/<number>?text=` link. The `whatsapp:open` IPC (`electron/main.ts`) opens only `wa.me` links. `whatsappPhone` turns local numbers into 92XXXXXXXXXX; the button hides without a usable phone and copies the text if WhatsApp cannot be opened. The texts are the settings `whatsapp_receipt_template` / `whatsapp_reminder_template` (Settings → Store → WhatsApp Messages, `settings` permission, max 1000 characters; blank = default). Every message ends with the developer's line (`composeWhatsAppCredit`): Developer → Developer Profile → WhatsApp Advertising sets the lead text (`developer_whatsapp_lead`) and the details (`developer_info_whatsapp`). These keys are Developer-only, so staff cannot remove the line.
   - **POS customer picker (`CustomerPicker.tsx`)**: the customer field shows "Counter Customer" by default. Typing a name or phone searches saved customers (`GET /api/customers/search`) and shows their khata balance. A new name with a phone can be saved on the spot (`can_add_customer`); a phone that already belongs to someone offers that customer instead (409 from `POST /api/customers`).
   - **Credit (Khata) sales require a saved customer** (checked by the server). The sale raises the customer's balance, is blocked past the customer's credit limit (0 = no limit), and a return on it lowers the balance.
   - Every customer needs a phone number, unique by digits (`normalizePhone` in `shared/customers.ts`).
   - Partial or full cash recovery payment recording.
   - Customer account statements and history export.

6. **Sales History & Returns (`SalesHistoryPage.tsx`)**:
   - Filterable invoice history by invoice number, customer, and date range.
   - Invoice reprints using the store identity & footer snapshot captured at sale time.
   - Line-item and full sale return engine that automatically restores returned units back into SQLite inventory while respecting open-sale restrictions.
   - **Returns are checked by the server** (`priceReturn` in `server/sales/saleMath.ts`): each invoice line (box or loose) is returned on its own, up to what was sold minus earlier returns (`returned_qty` on `GET /api/sales/:id`); loose units go back as loose units; the refund is the price actually paid with the bill discount shared out. A partial return sets the invoice to `partially_returned` ("Part returned"), so the rest can still be returned; once everything is back it is `returned`.
   - **Sales are priced by the server** from the medicine record (`priceSaleLine` / `totalSale` / `settleCash`): a changed rate or extra discount needs `can_discount`, the bill discount is capped by the store maximum, overselling and cash below the total are refused, and the POS prints the sale the server stored.

7. **Coding & Masters (`MastersPage.tsx`)**:
   - Pharmaceutical Company Management (distributors/manufacturers with unique **C-Codes**).
   - Medicine Master with linked C-Code, P-Code (SKU/Barcode), unit type, packaging size, Box Trade Price (T-Price), Box Retail Price (MRP), calculated Per-Unit Price (PP Unit), discount rules, shelf rack locations (`Loc`), and low stock thresholds.
   - **Generic Formula (M6):** the field suggests formulas already in use (`GET /api/products/generics`) and shows how many other medicines share the typed one (`genericKey` in `shared/generic.ts`).
   - **Schedule (M5):** None, Prescription (Rx) or Controlled (`products.schedule`, `shared/schedule.ts`).
     - Controlled medicines need a prescription at the POS (`PrescriptionModal`: patient, doctor and prescription number required; phone, CNIC, doctor reg. no. and notes optional), once per invoice. The server refuses the sale without it and writes one `prescription_records` row per controlled line.
     - Rx medicines only show a reminder on the cart line.

8. **Purchase & Stock Inward (`PurchasesPage.tsx`)**:
   - Supplier purchase invoice recording with batch numbers, expiry dates, purchase cost, bonus boxes, and retail rates.
   - Automatic inventory increment (`boxes + bonus`) and real-time update of product master prices (T-Price, MRP, and Unit Prices).
   - Expiry tracking via `product_batches`. Every unit belongs to a batch (M4).
     - Sales take the earliest expiry first and never sell expired stock; `sale_item_batches` records which batches each line used.
     - Sale returns go back into those batches.
     - Opening stock goes to an `OPENING` batch; lowered stock is trimmed by earliest expiry. A start-up reconcile fixes older databases.
     - Medicines → Batches (`BatchListModal`) lists each batch with its status and lets `can_edit_product` correct the batch number or expiry.
     - The Dashboard shows 30/60/90-day near-expiry counts.
   - Lines are costed on the server (`createPurchaseSchema`): whole boxes, no negative prices, unknown medicines stop the purchase. Payment is Paid in full, On credit or Part paid now (`paid_amount`).
   - **Suppliers (payables) tab (`src/components/suppliers/`)**: what the store owes each company (supplier), from `buildSupplierLedger` (`server/suppliers/ledgerMath.ts`). The balance is worked out every time from purchases, `supplier_payments` and purchase-return credits, never stored. **Pay** (`can_pay_supplier`) records cash/bank/cheque/online payments that settle the oldest bill first and cannot exceed what is owed. **Statement** lists unpaid bills and every entry with a running balance, printed on A4 by `printDocument`. Supplier payments are not part of a shift's drawer cash.
   - **Reorder List tab (`src/components/reorder/ReorderTab.tsx`, `GET /api/reorder`)**: per supplier, medicines at or below `min_stock_alert` or running out within the cover days at the last 30 days' sales speed (`suggestReorder` in `server/reorder/reorderMath.ts`). Boxes = max(minimum × 2 − stock, daily sales × cover days − stock), rounded up, and editable. Each supplier has Print order list, Copy as text, Send on WhatsApp (when the supplier has a phone; `company_phone`) and Create purchase (fills New Purchase). Cover days: 7/15/30, default from `reorder_cover_days`.
   - New Purchase draft lines have editable batch, expiry and boxes; each line needs a batch and an expiry before posting.
   - **Returns to Supplier tab (`src/components/purchaseReturns/`)**: returns of goods and expiry claims (`server/routes/purchaseReturns.ts`, rules in `returnMath.ts`, `can_return_purchase`).
     - Boxes come back from a purchase line (up to bought + bonus − earlier returns, credited at its cost after discount) or from the supplier's stock (credited at trade price), never more than `stock_boxes`.
     - Stock and the named batch go down, and the credit lowers the supplier balance; a negative balance shows as "They owe you".
     - The **Expiry claims** panel lists expired and near-expiry batches by supplier, capped by stock until FEFO (M4); "Create claim" fills the form.
     - Each return prints a return note. The purchase voucher (`GET /api/purchases/:id`) lists its lines with returned boxes.

9. **Reports & Financial Intelligence (`ReportsPage.tsx`)**:
   - Available Stock Valuation (evaluated at both T-Price cost and MRP retail).
   - Expired and Near-Expiry Batches (window filters: 0, 30, 60, 90 days).
   - Finished / Out-of-Stock priority report.
   - Profit & Loss (P&L) Summary Report ($\text{Gross Profit} = \text{Revenue} - \text{COGS} - \text{Discounts}$).
   - Invoice-Wise Profit & Loss (individual invoice margin %, cost basis, net profit).
   - Product-Wise and Company-Wise sales analytics.
   - **Controlled Register (M5)** (`GET /api/reports/controlled-register`): controlled sales with patient, CNIC, doctor, prescription number and the quantity returned since. It has a date filter (this month by default) and an A4 print via `printDocument`.
   - **Day Close (M8)** (`DayCloseReport.tsx`, `GET /api/day-close?date=`, `reports` + `can_view_financial_kpis`): one day's sales by payment, returns (counted on the day of the refund), cost of medicines sold minus the cost of returned ones, gross profit, expenses by category and **net profit**, plus the cash of that day's shifts, khata cash received and payments to suppliers (not in the profit). **Close day** (`can_day_close`) saves the figures in `daily_closings` and locks that day's expenses; **Reopen day** unlocks them. Both are audit-logged. A day can be closed while a shift is open (a warning lists it). Maths: `server/dayClose/dayCloseMath.ts`; loading: `loadDayClose.ts`.
     - **Automatic close:** after midnight every finished day with activity closes on its own ("Closed automatically", `auto_closed`), catching up the last 31 days if the computer was off. A reopened day closes again after the next midnight. The checkbox "Close each day automatically at midnight" (setting `auto_day_close`, `settings` permission) turns it off.
     - **Periods:** Day, **Month** and **Date range** (with Today, Yesterday, Last 7 days, This month, Last month). A month or range shows the totals plus a day-by-day table (invoices, net sales, cost, expenses, net profit, status), with Print and Export CSV (`GET /api/day-close/range`, max 366 days).
   - CSV export for all reports.
10. **Shop Expenses (M8, `ExpensesPage.tsx`, sidebar "Expenses", module key `expenses`)**: add, edit and delete expenses (`can_add_expense`; cashiers have it by default) with a category (suggested list in `shared/expenses.ts` plus any used before), amount, paid by (cash, bank, cheque, online), date (not in the future), bill number and notes. A date-range and category filter shows the total and a by-category summary. Users without `can_day_close` see and change only their own entries. A closed day or a closed shift locks the row (`409`). Routes: `server/routes/expenses.ts`.

11. **Multi-Destination Backup, Vault & Disaster Recovery (`UtilitiesPage.tsx`, `backup.ts`, `docs/DISASTER_RECOVERY_GUIDE.md`)**:
    - **Multi-Destination Vault**: Snapshots go to the saved primary folder (`auto_backup_dir`, default `./backups`) and an optional secondary folder (USB drive / network share), copied only when its SHA-256 matches.
    - **Verify-then-commit backups**: Each backup is written to `*.db.partial`, switched to a self-contained journal mode, checked with `PRAGMA integrity_check` and for the core tables, checksummed, and only then renamed into place and recorded in `backup_history` (`verified = 1`). Failed attempts are recorded with `status = 'failed'` and an error message. A per-process queue makes sure two backups never run at the same time.
    - **Retention limit (Developer)**: `backup_retention_limit` (1–365) keeps the newest N verified routine backups (`manual`, `scheduled`, `shift_close`, legacy `auto_daily`) per folder. Pruning runs only right after a verified success, never deletes the newest good backup, and only touches files recorded in `backup_history`.
    - **Pre-Restore Rollback Snapshot**: A safety snapshot (`pre_restore`) is taken before a restore. These are kept separately from the retention limit (newest 3). A restore is refused if the chosen file fails verification.
    - **Offline Backup Scheduler (`server/backup/scheduler.ts`)**: The Developer sets the frequency (`off` / `twice_daily` / `daily` / `weekly` + weekday); the Admin sets only the time of day (`PUT /api/backups/schedule`). The scheduler checks every minute and 15 s after startup. Runs missed while the PC was off are caught up with a single backup, failures are retried after a 15-minute backoff, and a clock moved backwards cannot stop backups. It is disabled under `TEST_MODE`.
    - **Backup Health dashboard card**: `GET /api/backups/status` reports the last success, next run, retained count / limit, and the last failure message.
    - **Online backup to Google Drive (`server/backup/cloud/`, `docs/ONLINE_BACKUP_SETUP.md`)**: The Developer chooses the backup type (`backup_mode`): Offline, Online (owner's Google Drive; only the newest 2 copies stay on the PC) or Both, in the setup wizard or Developer → Backup Retention, and connects the store owner's Google account (browser sign-in, `drive.file` scope: the app sees only its "100% Offline POS Backups" folder). After every verified backup, the newest one is encrypted (AES-256-GCM, key derived from the master key) and uploaded; without internet it waits as pending and retries with backoff. Drive keeps the retention limit. Backup & Recovery → Online Backups restores any copy (`can_restore`), keeping the current Google connection. The Dashboard card shows last upload / waiting uploads.
    - **Backup permissions**: Listing and creating backups need `can_backup` and restoring needs `can_restore` (the Developer always passes). Denied attempts and every backup or restore outcome are audited.
    - **In-App Disaster Recovery Guide**: Detailed documentation and recovery procedures.
    - **Stock Zero Audit Utility**: Protected by confirmation code `RESET-ZERO-CONFIRM`.
    - **Database Optimization**: `VACUUM`, `PRAGMA optimize`, `ANALYZE`.

12. **System Settings & Granular Staff Roles (`SettingsPage.tsx`)**:
    - Pharmacy business profile, drug license number, tax/NTN number, custom receipt headers/footers/terms, currency symbol, maximum bill discount cap.
    - 32 granular staff permissions covering POS operations, sales, returns, discounts, customer khata, product/company masters, purchases, reports, utilities, user accounts, and shift management.


13. **Developer-Controlled Installation, License & Sessions (`SetupWizardModal.tsx`, `server/security/*`)**:
    - **Developer master key**: one TOTP key (one authenticator entry) for every installation, created with `npm run developer:key` (`.env.developer`, never committed) and baked into packaged builds. Developer sign-in uses the fixed developer email + a code from that key; each code works once (replay protection). Staff (Admin, Cashier, custom roles) sign in with username + password only.
    - **Setup wizard (7 steps)**: unlock with the developer code → store name/address → first Admin (full name, username, password) → backup type (Offline / Online / Both, with Connect Google Drive), folder, frequency and time → Admin permissions and policies → Demo (N days) or Full → review and lock. No default staff accounts exist on a fresh install.
    - **Demo / Full license**: signed `license_*` settings; Developer Settings → License extends the demo, starts a new one or activates Full. When a demo ends, Admin/Cashier cannot sign in (the login screen shows a notice) and signed-in staff are signed out; the Developer still can. Clock rollback and database edits cannot extend it. The header shows a countdown badge.
    - **Server sessions**: login returns a bearer token held only by the API process; every `/api` route (except status, setup, login, license status and the public store identity) needs it. Identity always comes from the session, never from headers or request bodies.
    - See `docs/DEVELOPER_RECOVERY.md` for a lost phone, key rotation and expired demos.
    - **Developer profile & advertising**: Developer → Developer Profile holds the developer's name, company, phone, WhatsApp, email, website and message, plus a checkbox matrix choosing which details appear on the login screen, the sidebar, the sale receipt (snapshotted per sale) and the Support window (Header → Support). Store staff cannot edit or hide them.
---

## 2. Tech Stack & Dependencies

| Area | Technology / Dependency | Purpose |
| :--- | :--- | :--- |
| **Runtime Environment** | Node.js (ES Module: `"type": "module"`) | Unified runtime for local API, desktop scripts, and build tooling. |
| **Frontend Framework** | React 18 (`react`, `react-dom`) | Declarative, component-driven user interface. |
| **Build & Bundler** | Vite 6 (`vite`, `@vitejs/plugin-react`) | Ultra-fast dev server and optimized production packaging. |
| **Styling & CSS** | Tailwind CSS 4 (`tailwindcss`, `@tailwindcss/vite`) | Utility-first styling; theme tokens in `@theme` (`src/index.css`), custom medical dark theme and 58/80mm thermal print CSS. |
| **Icons** | Lucide React (`lucide-react`) | Clean, accessible iconography. |
| **State Management** | Zustand 5 (`zustand`) | Lightweight reactive stores for POS cart, auth, and cache. |
| **Database & ORM** | SQLite via `better-sqlite3` 12 & Prisma 7 (`@prisma/adapter-better-sqlite3`, client generated into `server/generated/prisma`) | Zero-latency, ACID embedded database executing locally on machine with typed queries. |
| **Server Bridge** | Express 4 (`express`) | REST backend on `127.0.0.1:3001` (same origin as the UI, no CORS); one router per area in `server/routes/`. |
| **Server Dev Tooling** | `tsx` (`tsx watch`) | TypeScript execution with hot-reload for the server process. |
| **Desktop Wrapper** | Electron 42, `electron-vite`, `electron-builder` (NSIS) | Desktop app: main process runs the API in-process on 127.0.0.1, serves the UI, IPC for printing and file dialogs; hardened in production. |
| **Validation** | zod 4 (`zod`) | Request-body schemas in `server/validation/schemas.ts`. |
| **Authentication** | `bcryptjs`, `otplib` v12, `qrcode` | Password hashing, RFC 6238 TOTP for the Developer master key, its QR code (`npm run developer:key`). |
| **Unit Testing** | vitest 5 (`vitest`) | `npm test` runs `*.spec.ts` unit tests for pure business logic. |
| **Language** | TypeScript 5 (`typescript`) | Strict type safety across client, server, and desktop layers. |

---

## 3. Code Architecture & Conventions

### Directory Structure

```
/
├── backups/                    # Development backups (*.db + *.sha256); the installed app uses the per-user folder
├── data/                       # Development database (pharmacy.db, -wal, -shm)
├── docs/                       # Plans, progress audit, recovery guides
├── electron/                   # Desktop wrapper
│   ├── main.ts                 # Main process (window, IPC, silent printing, dialogs; runs the API in-process)
│   └── preload.ts              # Exposes window.electronAPI via contextBridge
├── prisma/schema.prisma        # Prisma models (mirror of server/database/schema.ts)
├── scripts/developer-key.ts    # npm run developer:key (developer master authenticator key + QR)
├── shared/                     # Pure code shared by server and UI
│   ├── invoice.ts              # Thermal templates, paper sizes, normalizers
│   ├── permissions.ts          # Permission keys, labels, role defaults
│   └── settingsDefaults.ts     # Default system_settings
├── server/
│   ├── api.ts                  # Entry point (Prisma init, backup scheduler, listen); exports app
│   ├── app.ts                  # Express app: session/license gate, routers, JSON error handler
│   ├── routes/                 # One Router per area (auth, users, roles, sales, shifts, utilities, settings, ...)
│   ├── http/                   # context.ts (actor, permissions, sendError), formatters.ts (snake_case mappers)
│   ├── backup/                 # schedule.ts (pure math), scheduler.ts (offline scheduler), cloud/ (Google Drive online backup)
│   ├── database/
│   │   ├── backup.ts           # Backup, verify, restore, stock zero, optimize
│   │   ├── db.ts               # better-sqlite3 connection, pragmas, schema + column migrations, seed
│   │   ├── prisma.ts           # Prisma 7 client (better-sqlite3 adapter) + startup data fixes
│   │   ├── schema.ts           # CREATE TABLE DDL + COLUMN_MIGRATIONS
│   │   ├── seed.ts             # Default settings and built-in roles (no staff accounts)
│   │   └── sampleData.ts       # Demo store/catalog, only when PHARMACARE_SAMPLE_DATA=true
│   ├── invoice/invoiceSettings.ts # Startup migration of legacy invoice settings
│   ├── security/               # sessions, license, developer key/auth, passwords, totp, audit
│   ├── validation/schemas.ts   # zod request schemas
│   └── tests/                  # Integration suites (fresh temp DB per run) + testEnv/testAuth fixtures
├── src/                        # React UI
│   ├── components/
│   │   ├── auth/, backup/, common/, developer/, layout/, setup/, shifts/
│   │   ├── pos/                # UnifiedInvoice (3 designs × 58/80mm), shift modals, ShiftThermalReceipt
│   │   └── settings/           # UsersTab, RolesTab, RolePermissionEditor
│   ├── hooks/useShiftElapsed.ts # Running shift timer
│   ├── pages/                  # One page per sidebar tab (POS, Dashboard, Sales, Khata, Masters, ...)
│   ├── services/apiService.ts  # get/post/put/del over one request() with the session token
│   ├── store/                  # zustand: auth, POS cart, shift, theme
│   ├── types/index.ts          # Domain interfaces
│   ├── utils/                  # format.ts (money, durations), backup.ts, permissions.ts (UI policy toggles)
│   ├── App.tsx                 # Shell, tab switching, global hotkeys
│   ├── index.css               # Tailwind 4 + @theme tokens, print CSS (system fonts only)
│   └── main.tsx                # React mount; applies the saved theme first
├── index.html                  # HTML entry (no external resources)
├── electron.vite.config.ts     # Desktop build (bakes in the developer key)
├── build/icon.png, icon.svg     # App icon (installer, exe, window, taskbar)
├── electron-builder.yml        # Installer config (appId never changes)
└── tsconfig.json               # Strict, noUnusedLocals/Parameters on
```

### Naming Conventions:
- **Files & Folders**:
  - React components & pages: PascalCase (e.g., `PosPage.tsx`, `UnifiedInvoice.tsx`, `Header.tsx`).
  - Stores, services, and utilities: camelCase (e.g., `usePosStore.ts`, `apiService.ts`, `db.ts`, `backup.ts`).
  - Type definitions: `types/index.ts`.
- **Database Identifiers**:
  - Tables: snake_case plural (e.g., `products`, `companies`, `sale_items`, `cashier_shifts`).
  - Columns: snake_case (e.g., `box_trade_price`, `c_code`, `p_code`, `is_loose`, `allow_open_sale`).
  - Indexes: `idx_[table]_[column]` (e.g., `idx_products_p_code`).
- **TypeScript Interfaces**:
  - PascalCase singular (e.g., `Product`, `Company`, `SaleInvoice`, `SystemSettings`, `CashierShift`).
- **Variables & Functions**:
  - camelCase for functions and variables (e.g., `handleCompleteSale`, `totalGrossDraft`).
  - CONST_CASE for true constants (e.g., `DB_PATH`, `DEFAULT_BACKUP_DIR`).

---

## 4. Development Rules & Guidelines

When modifying or extending this project, you **MUST** follow these strict rules:

### 1. 100% Offline Integrity (CRITICAL)
- The application must remain **100% offline-first**. Never introduce dependencies on external cloud APIs, CDN scripts, remote fonts, or network-required auth services.
- All database queries must execute locally against `data/pharmacy.db` via `better-sqlite3` and `@prisma/client`.
- Backups are always written and verified on the local file system (`./backups`) or attached USB storage first; the optional online copy (Google Drive) is uploaded from that verified file.

### 2. SQLite Database & SQL Rules
- **Pragmas**: Always ensure `PRAGMA foreign_keys = ON;`, `PRAGMA journal_mode = WAL;`, and `PRAGMA busy_timeout = 5000;` are respected.
- **SQL String Literals**: In SQLite, string literals **MUST** use single quotes (e.g., `WHERE status = 'active'`). Double quotes (e.g., `"active"`) are interpreted by SQLite as column identifiers and will cause syntax errors.
- **Transactions**: Multi-table operations (e.g., creating a sale and deducting stock, creating a purchase and updating product trade prices, processing returns, shift reconciliations) **MUST** be wrapped in `prisma.$transaction` or `db.transaction(() => { ... })` to ensure complete ACID atomicity.
- **Concurrency & Sequence Calculation**:
  - Sequence generation (such as invoice numbering) must occur inside transaction boundaries with automatic retries on `SQLITE_BUSY` or constraint collisions.
- **Inventory Synchronization**:
  - Total product units = $(\text{stock\_boxes} \times \text{packing}) + \text{stock\_loose}$.
  - When selling loose units or boxes, recalculate whole boxes and loose remainder using integer division and modulo:
    $$\text{new\_boxes} = \lfloor \text{total\_units} / \text{packing} \rfloor$$
    $$\text{new\_loose} = \text{total\_units} \pmod{\text{packing}}$$
  - Keep both `products` table and `product_batches` in sync.

### 3. Strict TypeScript Standards
- Zero TypeScript errors (`npx tsc --noEmit` must pass with code 0).
- Explicitly type all API request payloads and responses using interfaces from `src/types/index.ts`.
- Avoid using `any` unless dynamically handling raw SQLite query results before mapping to domain interfaces.

### 4. UI/UX & Design Philosophy
- **Design system**: shared control and button classes in `src/index.css` (`field-*`, `btn-*`), 40px controls, a 12/13/15px type scale, sentence-case labels and flat colour used only for meaning (teal = action, rose = danger, amber = attention). See CLAUDE.md → Conventions.
- **Theme**: Medical-grade dark interface using the tailored `pharmacy` Teal/Emerald palette (`#14b8a6`, `#0d9488`) combined with high-contrast `slate-900` / `slate-950` backgrounds, and a calibrated soft light mode for daylight counters.
- **POS Ergonomics**: Pharmacy sales staff work under high transaction volume. Keep inputs autofocus-ready, provide visual stock warnings (Green = in stock, Amber = low stock, Red = out of stock), and preserve keyboard shortcuts (`F2`-`F10`, `Esc`).
- **Invoice & Print Integrity**:
  - Printing is thermal-only: every template must render correctly on both 58mm and 80mm rolls (no sheet formats).
  - Print receipts through `printReceipt` / `printReceiptIn` (`src/utils/printReceipt.ts`), never `window.print()` directly; full-page reports still use `window.print()`.
  - Receipt styles in `@media print` must hide the app chrome (`body * { visibility: hidden; }`) and isolate `#thermal-receipt-printable`.
  - Use monospace typography (`JetBrains Mono` / `Courier`) for tabular receipts.
  - The Developer invoice footer is strictly mandatory and cannot be hidden on printed receipts.

### 5. Error Handling & User Feedback
- Wrap asynchronous operations in `try / catch` blocks.
- On client side, surface human-readable feedback messages or error alerts directly in the UI rather than silent failures.
- When performing destructive actions (e.g., Stock Zero or Database Restore), always require explicit confirmation (e.g., typing `RESET-ZERO-CONFIRM` or triggering automatic safety snapshots before overwriting).

---

## 5. Development Workflow & Commands

### Running Development Mode
The app runs only as a desktop app (there is no browser mode):
```bash
npm run dev
```
This opens the desktop window with hot reload. The API runs inside the app on `127.0.0.1:3001`; edits to `server/` or `electron/` restart it.

### Automated Functional Testing
Execute the complete end-to-end integration test suite (15 core tests covering auth, shifts, dual-unit sales, open-sale rules, returns, khata, purchases, P&L, backups, anti-duplicate concurrency, and invoice settings):
```bash
npm run test:functional
```

Phase-specific security suites:
```bash
npm run test:phase1   # Developer-gated setup wizard, master-key TOTP login, replay & lockout
npm run test:phase2   # RBAC, developer settings, audit log
npm run test:phase3   # Thermal-only templates, protected identity, footer, sale snapshots
npm run test:phase4   # Backup retention, verification, offline scheduler, backup RBAC
npm run test:phase5   # Server sessions, Developer-only admin permissions, Demo/Full license
```
*(All suites run on a fresh temporary database with a test developer key, using the desktop app's runtime; see `server/tests/testEnv.ts` and `scripts/electron.mjs`.)*

### Type Checking & Linting
```bash
npm run lint
```
*(Runs `tsc --noEmit` across `src` and `server`)*

### Production Build
```bash
npm run build
```
*(Executes `prisma generate`, `tsc` type-checking, and builds the desktop bundles into `out/`; needs `.env.developer`)*

### Packaging
```bash
npm run developer:key  # once: create the developer master key (required for packaging)
npm run build:unpack   # unpacked app in release/
npm run build:win      # Windows NSIS installer (run on Windows)
```
*(Electron is pinned to 42 until better-sqlite3 12.12+ with newer Electron binaries is published on npm.)*

### Unit Tests
```bash
npm test
```
