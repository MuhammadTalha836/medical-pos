# PharmaCare Pro - System Instruction & Development Guide (GEMINI.md)

Welcome to **PharmaCare Pro**, a complete, production-ready, 100% offline desktop Pharmacy Management & Point-of-Sale (POS) System built for retail pharmacies and medical distributors.

This document serves as the master guide for developers and AI agents working on this codebase. Adhere strictly to the architecture, conventions, and rules detailed below.

---

## 1. Product Overview

PharmaCare Pro is designed for high-speed, reliable pharmacy operations with **zero internet reliance**. All data persists locally in an embedded SQLite database using Write-Ahead Logging (WAL) for maximum reliability and concurrent read/write performance.

### Core Modules & Features:
1. **POS Counter Sales (`PosPage.tsx`, `usePosStore.ts`)**:
   - Keyboard-first workflow with dedicated hotkeys (`F1` Clear/POS, `F2` Search, `F4` Bill Discount, `F6` Tendered, `F9` Save & Print).
   - Barcode scanning & instant search across Brand Name, Generic Formula, C-Code, and P-Code.
   - Dual-unit sales: sell by **Full Box/Pack** or **Loose Units** (tablets/capsules/ml) with real-time price translation.
   - Item-level discounts, bill-level discounts, cash received & change calculation.
   - Dual-width thermal receipt generation (80mm & 58mm) with drug license details, location rack, item table, and terms.
2. **Sales History & Returns (`SalesHistoryPage.tsx`)**:
   - Filterable invoice history by invoice number, customer, and date range.
   - Thermal receipt reprint capability.
   - Line-item and full sale return engine that automatically restores returned units back into SQLite inventory.
3. **Coding & Masters (`MastersPage.tsx`)**:
   - Pharmaceutical Company Management (distributors/manufacturers with unique **C-Codes**).
   - Medicine Master with linked C-Code, P-Code (SKU/Barcode), unit type, packaging size, Box Trade Price (T-Price), Box Retail Price (MRP), calculated Per-Unit Price (PP Unit), discount rules, shelf rack locations (`Loc`), and low stock thresholds.
4. **Purchase & Stock Inward (`PurchasesPage.tsx`)**:
   - Supplier purchase invoice recording with batch numbers, expiry dates, purchase cost, bonus boxes, and retail rates.
   - Automatic inventory increment (`boxes + bonus`) and real-time update of product master prices (T-Price, MRP, and Unit Prices).
   - Expiry tracking via `product_batches`.
5. **Reports & Financial Intelligence (`ReportsPage.tsx`)**:
   - Available Stock Valuation (evaluated at both T-Price cost and MRP retail).
   - Expired and Near-Expiry Batches (window filters: 0, 30, 60, 90 days).
   - Finished / Out-of-Stock priority report.
   - Profit & Loss (P&L) Summary Report ($\text{Gross Profit} = \text{Revenue} - \text{COGS} - \text{Discounts}$).
   - Invoice-Wise Profit & Loss (individual invoice margin %, cost basis, net profit).
   - Product-Wise and Company-Wise sales analytics.
   - CSV export for all reports.
6. **Local Backup & System Utilities (`UtilitiesPage.tsx`, `backup.ts`)**:
   - One-click atomic SQLite backup to timestamped local `.db` files (`./backups`).
   - Daily / Shift closing reconciliation that triggers automated local backups.
   - Database restore with safety rollback snapshots (`pre_restore`) and integrity validation.
   - Stock Zero audit utility (protected by confirmation code `RESET-ZERO-CONFIRM`).
   - Database optimization (`VACUUM`, `PRAGMA optimize`, `ANALYZE`).
7. **System Settings & User Access (`SettingsPage.tsx`)**:
   - Pharmacy business info, drug license number, tax/NTN number, custom receipt headers/footers/terms, currency symbol, and user accounts (Admin, Pharmacist, Cashier).

---

## 2. Tech Stack & Dependencies

| Area | Technology / Dependency | Purpose |
| :--- | :--- | :--- |
| **Runtime Environment** | Node.js (ES Module: `"type": "module"`) | Unified runtime for local API, desktop scripts, and build tooling. |
| **Frontend Framework** | React 18 (`react`, `react-dom`) | Declarative, component-driven user interface. |
| **Build & Bundler** | Vite 6 (`vite`, `@vitejs/plugin-react`) | Ultra-fast dev server and optimized production packaging. |
| **Styling & CSS** | Tailwind CSS 3, PostCSS, Autoprefixer | Utility-first styling with custom medical dark theme and thermal print CSS. |
| **Icons** | Lucide React (`lucide-react`) | Clean, accessible iconography. |
| **State Management** | Zustand 5 (`zustand`) | Lightweight reactive stores for POS cart, auth, and cache. |
| **Local Database** | SQLite via `better-sqlite3` | Zero-latency, ACID embedded database executing locally on machine. |
| **Server Bridge** | Express 4 (`express`, `cors`) | Local REST backend running on `localhost:3001` bridging client and SQLite. |
| **Server Dev Tooling** | `tsx` (`tsx watch`) | TypeScript execution with hot-reload for the server process. |
| **Desktop Wrapper** | Electron (`electron`) | Native Windows desktop wrapper with IPC for silent printing and native file dialogs. |
| **Language** | TypeScript 5 (`typescript`) | Strict type safety across client, server, and desktop layers. |

---

## 3. Code Architecture & Conventions

### Directory Structure

```
/
├── backups/                    # Local atomic SQLite database snapshots (*.db)
├── data/                       # Active local database (pharmacy.db, pharmacy.db-wal)
├── dist/                       # Compiled production frontend assets (generated by vite build)
├── electron/                   # Desktop native wrapper
│   ├── main.ts                 # Main Electron process (window, IPC, silent printing, dialogs)
│   └── preload.ts              # Preload script exposing window.electronAPI via contextBridge
├── server/                     # Local backend and database layer
│   ├── api.ts                  # Express REST API (endpoints for all pharmacy modules)
│   └── database/
│       ├── backup.ts           # Backup, restore, stock-zero, and optimization logic
│       ├── db.ts               # better-sqlite3 connection, pragmas, WAL mode setup
│       ├── schema.ts           # Complete SQLite DDL (17 tables, indexes, constraints)
│       └── seed.ts             # Initial realistic seed data (companies, medicines, users)
├── src/                        # React Frontend
│   ├── components/
│   │   ├── common/             # Reusable UI primitives (Modal.tsx, Button, etc.)
│   │   ├── layout/             # App shell (Header.tsx, Sidebar.tsx)
│   │   └── pos/                # POS specialized components (ThermalReceipt.tsx)
│   ├── pages/                  # Page-level route views
│   │   ├── Dashboard.tsx       # KPI overview and urgent stock alerts
│   │   ├── MastersPage.tsx     # Companies & Products coding management
│   │   ├── PosPage.tsx         # Fast POS counter sale with hotkeys
│   │   ├── PurchasesPage.tsx   # Supplier purchases & stock inward
│   │   ├── ReportsPage.tsx     # Stock valuation, P&L, sales reports, CSV export
│   │   ├── SalesHistoryPage.tsx# Invoices history, returns, receipt reprints
│   │   ├── SettingsPage.tsx    # Store profile, drug license, receipt config, users
│   │   └── UtilitiesPage.tsx   # Backup, restore, shift closing, stock zero
│   ├── services/
│   │   └── apiService.ts       # Typed client API abstraction interacting with /api
│   ├── store/
│   │   ├── useAuthStore.ts     # Logged-in cashier/admin session state
│   │   └── usePosStore.ts      # POS cart, calculations, customer, discount state
│   ├── types/
│   │   └── index.ts            # Domain TypeScript interfaces and types
│   ├── App.tsx                 # Root layout, tab switcher, global shortcut listeners
│   ├── index.css               # Tailwind directives, custom scrollbars, @media print rules
│   └── main.tsx                # React DOM mount point
├── index.html                  # HTML entry point with Google Fonts (Inter, JetBrains Mono)
├── package.json                # Project dependencies, scripts, and module declaration
├── tailwind.config.js          # Custom colors (pharmacy teal palette, slate-850), typography
├── tsconfig.json               # Strict compiler options and @/* alias mapping
└── vite.config.ts              # Vite configuration and /api proxy mapping to port 3001
```

### Naming Conventions:
- **Files & Folders**:
  - React components & pages: PascalCase (e.g., `PosPage.tsx`, `ThermalReceipt.tsx`, `Header.tsx`).
  - Stores, services, and utilities: camelCase (e.g., `usePosStore.ts`, `apiService.ts`, `db.ts`, `backup.ts`).
  - Type definitions: `types/index.ts` or `[domain].ts`.
- **Database Identifiers**:
  - Tables: snake_case plural (e.g., `products`, `companies`, `sale_items`, `product_batches`).
  - Columns: snake_case (e.g., `box_trade_price`, `c_code`, `p_code`, `is_loose`).
  - Indexes: `idx_[table]_[column]` (e.g., `idx_products_p_code`).
- **TypeScript Interfaces**:
  - PascalCase singular (e.g., `Product`, `Company`, `SaleInvoice`, `SystemSettings`).
- **Variables & Functions**:
  - camelCase for functions and variables (e.g., `handleCompleteSale`, `totalGrossDraft`).
  - CONST_CASE for true constants (e.g., `DB_PATH`, `DEFAULT_BACKUP_DIR`).

---

## 4. Development Rules & Guidelines

When modifying or extending this project, you **MUST** follow these strict rules:

### 1. 100% Offline Integrity (CRITICAL)
- The application must remain **100% offline-first**. Never introduce dependencies on external cloud APIs, CDN scripts, remote fonts, or network-required auth services.
- All database queries must execute locally against `data/pharmacy.db` via `better-sqlite3`.
- Backups must write to the local file system (`./backups`).

### 2. SQLite Database & SQL Rules
- **Pragmas**: Always ensure `PRAGMA foreign_keys = ON;`, `PRAGMA journal_mode = WAL;`, and `PRAGMA busy_timeout = 5000;` are respected.
- **SQL String Literals**: In SQLite, string literals **MUST** use single quotes (e.g., `WHERE status = 'active'`). Double quotes (e.g., `"active"`) are interpreted by SQLite as column identifiers and will cause syntax errors.
- **Transactions**: Multi-table operations (e.g., creating a sale and deducting stock, creating a purchase and updating product trade prices, processing returns) **MUST** be wrapped in `db.transaction(() => { ... })` to ensure complete ACID atomicity.
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
- **Theme**: Medical-grade dark interface using the tailored `pharmacy` Teal/Emerald palette (`#14b8a6`, `#0d9488`) combined with high-contrast `slate-900` / `slate-950` backgrounds.
- **POS Ergonomics**: Pharmacy sales staff work under high transaction volume. Keep inputs autofocus-ready, provide visual stock warnings (Green = in stock, Amber = low stock, Red = out of stock), and preserve keyboard shortcuts (`F1`-`F9`).
- **Thermal Printing Integrity**:
  - Thermal receipts must remain strictly formatted for 80mm and 58mm POS roll widths.
  - Receipt styles in `@media print` must hide the app chrome (`body * { visibility: hidden; }`) and isolate `#thermal-receipt-printable`.
  - Use monospace typography (`JetBrains Mono` / `Courier`) for columnar receipts to ensure tabular numbers align perfectly.

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

### Type Checking & Linting
```bash
npm run lint
```
*(Runs `tsc --noEmit` across `src` and `server`)*

### Production Build
```bash
npm run build
```
*(Executes `tsc` type-checking and builds production bundles into `dist/`)*

### Starting Electron Desktop App
```bash
npm start
```
*(Packages and launches via Electron wrapper)*
