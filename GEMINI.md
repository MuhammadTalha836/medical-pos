# PharmaCare Pro - System Instruction & Development Guide (GEMINI.md)

Welcome to **PharmaCare Pro**, a complete, production-ready, 100% offline desktop Pharmacy Management & Point-of-Sale (POS) System built for retail pharmacies and medical distributors.

This document serves as the master guide for developers and AI agents working on this codebase. Adhere strictly to the architecture, conventions, and rules detailed below.

---

## 1. Product Overview

PharmaCare Pro is designed for high-speed, reliable pharmacy operations with **zero internet reliance**. All data persists locally in an embedded SQLite database using Write-Ahead Logging (WAL) mode for maximum reliability, ACID compliance, and zero-latency concurrent read/write performance.

### Core Modules & Features:

1. **POS Counter Sales (`PosPage.tsx`, `usePosStore.ts`)**:
   - **Keyboard-First Workflow**: High-speed counter checkout powered by dedicated hotkeys:
     - `F2`: Start New Invoice (with confirmation prompt if unsaved cart items exist).
     - `F3`: Focus and select Product / Barcode Search input.
     - `F4`: Focus Customer Name / Phone input.
     - `F6`: Focus Bill Discount (%) input (strictly guarded by `can_discount` cashier permission).
     - `F8`: Focus Tendered / Cash Received input.
     - `F9`: Save Invoice without printing (anti-duplicate lock protected).
     - `F10`: Save & Print Receipt (or reprint most recently completed sale).
     - `Esc`: Safely close modal dialogs or dismiss search results.
   - **Visual Shortcut Ribbon & HUD**: Persistent bottom ribbon displaying active shortcut hotkeys and an interactive **Shortcuts Guide** dialog. High-contrast `<kbd>` badge pills across all key form inputs.
   - **Anti-Duplicate Invoice Lock & Concurrency Defense**: Synchronous frontend submission lock (`isSubmittingRef`) and `e.repeat` suppression prevent double-submissions from rapid clicks or held keys. Backend moves invoice sequence calculation inside `prisma.$transaction` with a 5-attempt retry loop handling SQLite locks (`SQLITE_BUSY`) and collision retries.
   - **Instant Barcode & Text Search**: Real-time matching across Brand Name, Generic Formula, C-Code, and P-Code/Barcode.
   - **Dual-Unit Sales**: Sell by **Full Box/Pack** or **Loose Units** (tablets/capsules/ml) with real-time price translation.

2. **Cashier Register & Shift Management (`ShiftsAdminPage.tsx`, `ShiftClosingModal.tsx`, `ShiftThermalReceipt.tsx`)**:
   - **Active Register Tracking**: Cashiers start shifts with a recorded opening cash float. All POS sales, returns, and payment types are tracked against the active shift.
   - **Multi-Payment Reconciliation**: Tracks Cash, Card, Credit (Khata), and Online payment totals in real-time.
   - **Shift Balancing & Discrepancies**: Calculates expected closing cash versus counted cash, recording exact cash shortage or excess.
   - **Admin Shift Hub**: Dedicated admin section with cashier, date range, and status filters, and line-item invoice inspector.
   - **Automated Backup on Shift Closure**: Shift closing automatically triggers an atomic SQLite snapshot backup to the local filesystem.

3. **Advanced Invoice Settings & Three Professional Templates (`UnifiedInvoice.tsx`, `SettingsPage.tsx`)**:
   - **Design 1: Thermal Receipt (`thermal`)**: Optimized for 80mm and 58mm continuous roll POS printers with monospace typography (`JetBrains Mono`), dashed section dividers, barcode simulation, and paper-saving compact tables.
   - **Design 2: Standard Invoice (`standard`)**: Full-page / half-page sheet format (A4 / A5) featuring branded pharmacy header banner, customer "Bill To" card, striped product table, financial summary block, and customer signature line.
   - **Design 3: Detailed Invoice (`detailed`)**: Enterprise pharmaceutical layout with full store contact, drug license & tax NTN headers, dual-column customer metadata, rack locations (`Loc`), unit conversion details, detailed financial audit breakdown, dual regulatory policy boxes, and pharmacist stamp block.
   - **Granular Field Visibility Controls**: Admin checkboxes across Store Info, Cashier/Customer Info, Itemized Table Columns, Financial Summary, and Regulatory Policies.
   - **Mandatory Developer Attribution**: Permanently locked and enforced on both frontend and backend (`show_developer_info = 'true'`), displaying the developer credit banner unconditionally across all templates.
   - **Live Interactive Preview**: Split-screen preview panel inside Admin Settings updating in real time with template switcher tabs and direct "Test Print" action.
   - **Multi-Paper Print Stylesheets**: Responsive `@media print` rules for `.print-paper-80mm`, `.print-paper-58mm`, `.print-paper-a4`, and `.print-paper-a5`.

4. **Product-Level Open-Sale & Minimum Quantity Enforcement (`MastersPage.tsx`, `PosPage.tsx`, `server/api.ts`)**:
   - **Product Creation Settings**: Fields for Sale Unit (`unit_type`), Units per Pack (`packing`), Allow Open Sale switch (`allow_open_sale`), and Minimum Sale Quantity (`min_sale_qty`).
   - **Stock Conversion Card**: Real-time formula card displaying exact pack vs individual-unit inventory deduction.
   - **Multi-Level Enforcement**: Disables `+ Loose` buttons in search and strikes through `[Loose]` cart toggles for non-openable medicines. Automatically clamps quantities to `min_sale_qty`. Backend rejects loose unit sales (HTTP 400), sub-minimum sales (HTTP 400), and loose returns for sealed medicines.

5. **Customer Khata (Credit / Udhar) Management (`CustomerKhataPage.tsx`)**:
   - Customer ledger and balance tracking.
   - Customer selection required for Credit POS sales.
   - Partial or full cash recovery payment recording.
   - Customer account statements and history export.

6. **Sales History & Returns (`SalesHistoryPage.tsx`)**:
   - Filterable invoice history by invoice number, customer, and date range.
   - Multi-format invoice reprint capability inheriting current settings.
   - Line-item and full sale return engine that automatically restores returned units back into SQLite inventory while respecting open-sale restrictions.

7. **Coding & Masters (`MastersPage.tsx`)**:
   - Pharmaceutical Company Management (distributors/manufacturers with unique **C-Codes**).
   - Medicine Master with linked C-Code, P-Code (SKU/Barcode), unit type, packaging size, Box Trade Price (T-Price), Box Retail Price (MRP), calculated Per-Unit Price (PP Unit), discount rules, shelf rack locations (`Loc`), and low stock thresholds.

8. **Purchase & Stock Inward (`PurchasesPage.tsx`)**:
   - Supplier purchase invoice recording with batch numbers, expiry dates, purchase cost, bonus boxes, and retail rates.
   - Automatic inventory increment (`boxes + bonus`) and real-time update of product master prices (T-Price, MRP, and Unit Prices).
   - Expiry tracking via `product_batches`.

9. **Reports & Financial Intelligence (`ReportsPage.tsx`)**:
   - Available Stock Valuation (evaluated at both T-Price cost and MRP retail).
   - Expired and Near-Expiry Batches (window filters: 0, 30, 60, 90 days).
   - Finished / Out-of-Stock priority report.
   - Profit & Loss (P&L) Summary Report ($\text{Gross Profit} = \text{Revenue} - \text{COGS} - \text{Discounts}$).
   - Invoice-Wise Profit & Loss (individual invoice margin %, cost basis, net profit).
   - Product-Wise and Company-Wise sales analytics.
   - CSV export for all reports.

10. **Multi-Destination Backup, Vault & Disaster Recovery (`UtilitiesPage.tsx`, `backup.ts`, `docs/DISASTER_RECOVERY_GUIDE.md`)**:
    - **Multi-Destination Vault**: Simultaneous atomic SQLite snapshots to primary local disk (`./backups`) and secondary external USB flash drives.
    - **Cryptographic SHA-256 Sidecars**: Companion `.sha256` files generated for every backup to verify cryptographic integrity offline.
    - **Pre-Restore Rollback Snapshot**: Automatic safety snapshot (`pre_restore`) created prior to database restore.
    - **Background Auto-Backup Daemon**: Scheduler triggering automated local backups at configured hourly intervals.
    - **In-App Disaster Recovery Guide**: Detailed documentation and recovery procedures.
    - **Stock Zero Audit Utility**: Protected by confirmation code `RESET-ZERO-CONFIRM`.
    - **Database Optimization**: `VACUUM`, `PRAGMA optimize`, `ANALYZE`.

11. **System Settings & Granular Staff Roles (`SettingsPage.tsx`)**:
    - Pharmacy business profile, drug license number, tax/NTN number, custom receipt headers/footers/terms, currency symbol, maximum bill discount cap.
    - 32 granular staff permissions covering POS operations, sales, returns, discounts, customer khata, product/company masters, purchases, reports, utilities, user accounts, and shift management.

---

## 2. Tech Stack & Dependencies

| Area | Technology / Dependency | Purpose |
| :--- | :--- | :--- |
| **Runtime Environment** | Node.js (ES Module: `"type": "module"`) | Unified runtime for local API, desktop scripts, and build tooling. |
| **Frontend Framework** | React 18 (`react`, `react-dom`) | Declarative, component-driven user interface. |
| **Build & Bundler** | Vite 6 (`vite`, `@vitejs/plugin-react`) | Ultra-fast dev server and optimized production packaging. |
| **Styling & CSS** | Tailwind CSS 3, PostCSS, Autoprefixer | Utility-first styling with custom medical dark theme and thermal/sheet print CSS. |
| **Icons** | Lucide React (`lucide-react`) | Clean, accessible iconography. |
| **State Management** | Zustand 5 (`zustand`) | Lightweight reactive stores for POS cart, auth, and cache. |
| **Database & ORM** | SQLite via `better-sqlite3` & Prisma (`@prisma/client`) | Zero-latency, ACID embedded database executing locally on machine with typed queries. |
| **Server Bridge** | Express 4 (`express`, `cors`) | Local REST backend running on `localhost:3001` bridging client and SQLite. |
| **Server Dev Tooling** | `tsx` (`tsx watch`) | TypeScript execution with hot-reload for the server process. |
| **Desktop Wrapper** | Electron (`electron`) | Native Windows desktop wrapper with IPC for silent printing and native file dialogs. |
| **Language** | TypeScript 5 (`typescript`) | Strict type safety across client, server, and desktop layers. |

---

## 3. Code Architecture & Conventions

### Directory Structure

```
/
├── backups/                    # Local atomic SQLite database snapshots (*.db, *.sha256)
├── data/                       # Active local database (pharmacy.db, pharmacy.db-wal)
├── dist/                       # Compiled production frontend assets (generated by vite build)
├── docs/                       # System documentation and disaster recovery guides
│   └── DISASTER_RECOVERY_GUIDE.md # Hardware replacement, USB backup retrieval & SHA-256 validation
├── electron/                   # Desktop native wrapper
│   ├── main.ts                 # Main Electron process (window, IPC, silent printing, dialogs)
│   └── preload.ts              # Preload script exposing window.electronAPI via contextBridge
├── prisma/                     # Prisma ORM schema
│   └── schema.prisma           # Complete SQLite schema (tables, relations, indexes)
├── server/                     # Local backend and database layer
│   ├── api.ts                  # Express REST API (endpoints for all pharmacy modules)
│   ├── database/
│   │   ├── backup.ts           # Backup, restore, stock-zero, and optimization logic
│   │   ├── db.ts               # better-sqlite3 connection, pragmas, WAL mode setup
│   │   ├── schema.ts           # Complete SQLite DDL
│   │   └── seed.ts             # Initial realistic seed data (companies, medicines, users, settings)
│   └── tests/
│       └── functional_test.ts  # End-to-end automated test suite (15 core functional tests)
├── src/                        # React Frontend
│   ├── components/
│   │   ├── common/             # Reusable UI primitives (Modal.tsx, etc.)
│   │   ├── layout/             # App shell (Header.tsx, Sidebar.tsx)
│   │   ├── pos/                # POS specialized components
│   │   │   ├── ShiftClosingModal.tsx  # Shift reconciliation & cash difference modal
│   │   │   ├── ShiftStartModal.tsx    # Shift opening float modal
│   │   │   ├── ShiftThermalReceipt.tsx# Printable shift summary receipt
│   │   │   ├── ThermalReceipt.tsx     # Backwards-compatible receipt wrapper
│   │   │   └── UnifiedInvoice.tsx     # Multi-template renderer (Thermal, Standard, Detailed)
│   │   └── shifts/
│   │       └── ShiftHistoryHub.tsx    # Shift history inspection hub
│   ├── pages/                  # Page-level route views
│   │   ├── CustomerKhataPage.tsx# Customer credit (udhar) accounts, ledger & payments
│   │   ├── Dashboard.tsx       # KPI overview and urgent stock alerts
│   │   ├── MastersPage.tsx     # Companies & Products coding management
│   │   ├── PosPage.tsx         # Fast POS counter sale with hotkeys & keyboard ribbon
│   │   ├── PurchasesPage.tsx   # Supplier purchases & stock inward
│   │   ├── ReportsPage.tsx     # Stock valuation, P&L, sales reports, CSV export
│   │   ├── SalesHistoryPage.tsx# Invoices history, returns, receipt reprints
│   │   ├── SettingsPage.tsx    # Store profile, drug license, invoice settings & templates, users, roles
│   │   ├── ShiftsAdminPage.tsx # Admin cashier shift management & discrepancy auditing
│   │   └── UtilitiesPage.tsx   # Backup, restore, shift closing, stock zero, disaster recovery guide
│   ├── services/
│   │   └── apiService.ts       # Typed client API abstraction interacting with /api
│   ├── store/
│   │   ├── useAuthStore.ts     # Logged-in cashier/admin session state & permissions
│   │   ├── usePosStore.ts      # POS cart, calculations, customer, discount state
│   │   └── useThemeStore.ts    # Soft Light / Medical Dark theme state
│   ├── types/
│   │   └── index.ts            # Domain TypeScript interfaces and types
│   ├── App.tsx                 # Root layout, role-aware navigation, global hotkeys
│   ├── index.css               # Tailwind directives, print stylesheets, custom scrollbars
│   └── main.tsx                # React DOM mount point
├── index.html                  # HTML entry point with Google Fonts (Inter, JetBrains Mono)
├── package.json                # Project dependencies, scripts, and module declaration
├── tailwind.config.js          # Custom colors (pharmacy teal palette, slate-850), typography
├── tsconfig.json               # Strict compiler options and @/* alias mapping
└── vite.config.ts              # Vite configuration and /api proxy mapping to port 3001
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
- Backups must write to the local file system (`./backups`) or attached local USB storage.

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
- **Theme**: Medical-grade dark interface using the tailored `pharmacy` Teal/Emerald palette (`#14b8a6`, `#0d9488`) combined with high-contrast `slate-900` / `slate-950` backgrounds, and a calibrated soft light mode for daylight counters.
- **POS Ergonomics**: Pharmacy sales staff work under high transaction volume. Keep inputs autofocus-ready, provide visual stock warnings (Green = in stock, Amber = low stock, Red = out of stock), and preserve keyboard shortcuts (`F2`-`F10`, `Esc`).
- **Invoice & Print Integrity**:
  - Multi-template printing must remain strictly formatted for 80mm/58mm thermal rolls and A4/A5 sheets.
  - Receipt styles in `@media print` must hide the app chrome (`body * { visibility: hidden; }`) and isolate `#thermal-receipt-printable`.
  - Use monospace typography (`JetBrains Mono` / `Courier`) for tabular receipts.
  - Software developer attribution is strictly mandatory and cannot be hidden on printed receipts.

### 5. Error Handling & User Feedback
- Wrap asynchronous operations in `try / catch` blocks.
- On client side, surface human-readable feedback messages or error alerts directly in the UI rather than silent failures.
- When performing destructive actions (e.g., Stock Zero or Database Restore), always require explicit confirmation (e.g., typing `RESET-ZERO-CONFIRM` or triggering automatic safety snapshots before overwriting).

---

## 5. Development Workflow & Commands

### Running Development Mode
Run both backend API and Vite UI concurrently:
```bash
npm run dev
```
Or run individually:
- **Backend API**: `npm run dev:server` (runs on `http://localhost:3001` with `tsx watch`)
- **Frontend UI**: `npm run dev:ui` (runs on `http://localhost:5173`)

### Automated Functional Testing
Execute the complete end-to-end integration test suite (15 core tests covering auth, shifts, dual-unit sales, open-sale rules, returns, khata, purchases, P&L, backups, anti-duplicate concurrency, and invoice settings):
```bash
npm run test:functional
```

### Type Checking & Linting
```bash
npm run lint
```
*(Runs `tsc --noEmit` across `src` and `server`)*

### Production Build
```bash
npm run build
```
*(Executes `prisma generate`, `tsc` type-checking, and builds production bundles into `dist/`)*

### Starting Electron Desktop App
```bash
npm start
```
*(Packages and launches via Electron wrapper)*
