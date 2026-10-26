# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PharmaCare Pro ("100% Offline POS"): an offline pharmacy management and POS desktop app. It has a React 18 + Vite 6 + Tailwind 4 UI and an Express API backed by SQLite (Prisma 7 through `@prisma/adapter-better-sqlite3`, plus better-sqlite3 12). Electron 42 wraps both. Phased requirements are tracked in `docs/PHASE_REQUIREMENTS.md` (Phases 1–4 done). `docs/IMPLEMENTATION_PLAN.md` is the owner's target plan; `docs/PROGRESS.md` is the audit of the code against it. Work its gaps one phase at a time, only with the owner's approval.

## Commands

```bash
npm run dev              # desktop app with hot reload (electron-vite dev --watch; API in the Electron main process on :3001)
npm run lint             # tsc --noEmit over src/, shared/, server/, electron/ and scripts/ (the only lint/typecheck)
npm run build            # prisma generate && tsc && electron-vite build (into out/)
npm run prisma:generate  # required after editing prisma/schema.prisma (output: server/generated/prisma, gitignored)

npm test                 # vitest unit tests (*.spec.ts, pure logic only, no DB)
npx vitest run server/backup/schedule.spec.ts   # a single unit spec

npm run build:unpack     # packaged app in release/<platform>-unpacked
npm run build:win        # Windows NSIS installer (run on Windows)

npm run test:functional  # end-to-end business flow (15 steps)
npm run test:phase1      # setup wizard + developer TOTP auth
npm run test:phase2      # RBAC, developer settings, audit log
npm run test:phase3      # thermal-only invoices, protected identity, sale snapshots
npm run test:phase4      # backup retention, verification, offline scheduler, backup RBAC
npm run test:phase5      # server sessions, Developer-only admin permissions, Demo/Full license
npm run test:phase6      # khata customers: unique phone, credit sales need a saved customer, credit limit, credit returns
npm run test:phase7      # online backup to Google Drive (Google faked by a fetch stub): mode, sign-in, encrypted upload, retry, restore
npm run test:phase8      # server-side sale pricing, oversell/cash checks, returns, shift cash, khata payments, role escalation, login lockout
npm run test:m1          # supplier ledger: purchases costed on the server, paid now, payments, statement (docs/FEATURE_ROADMAP.md)
npm run test:m2          # returns to supplier and expiry claims: stock, batch and balance go down, over-return checks
npm run test:m3          # reorder list: below minimum / running out by 30-day sales speed, cover days, filters
npm run test:m4          # batches: FEFO sales, splits, returns to batch, expired never sold, opening batch, reconcile
npm run test:m5          # controlled medicines: prescription required, register rows per line, Rx-only free, register filter/returns/access
npm run test:m6          # substitutes: formula matching (case/spacing/order/strength), in-stock first, exclusions, generics list, login
npm run test:m7          # WhatsApp templates: defaults, save, cashier 403, length limit; supplier phone on the reorder list
npm run test:m8          # expenses and day close: cash expense lowers shift cash, closed shift/day locks, own-only list, day-close figures, automatic midnight close, range report
npm run test:m9          # stock count and adjustment: count changes nothing until Apply, later sales kept, batches = stock, adjustments by batch/reason, permissions, history

npm run developer:key    # create .env.developer (developer master TOTP key) and print its QR; --show / --rotate / --google <id> <secret>
npm run rebuild          # compile better-sqlite3 for Electron (dev and the test suites do this on their own when needed)
```

There is no browser mode: the app only runs as the desktop app. `scripts/electron.mjs` launches `dev` and the integration suites.

Testing notes:
- Two kinds of tests. `npm test` runs vitest unit specs next to the code (`server/**/*.spec.ts`, `shared/**/*.spec.ts`, `src/**/*.spec.ts`); keep them free of DB imports (that is why the schedule math lives in `server/backup/schedule.ts`). The `test:*` suites are standalone integration scripts that import `app` from `server/api.ts`. They run on Electron's own Node runtime (`ELECTRON_RUN_AS_NODE=1 electron --import tsx`), so they use the same better-sqlite3 build as the app.
- Run a single integration suite: `node scripts/electron.mjs test server/tests/phase3_test.ts`. There is no per-case filter.
- Every suite imports `./testEnv` **first**. It points `PHARMACARE_DATA_DIR`/`PHARMACARE_BACKUP_DIR` at an OS temp folder (a **fresh** database with the sample catalog, `PHARMACARE_SAMPLE_DATA=true`) and installs a fixed test developer key, so suites never touch real data, backups or the real license. Keep that import first in new suites (ES modules run imports in order).
- Suites always start an in-process server (sessions live in that process) and authenticate with `authHeaders(user)` / `adminAuthHeaders()` from `server/tests/testAuth.ts`, which mint session tokens directly. Fixtures there: `ensureTestAdmin()` (`admin` / `admin123`, test DB only), `ensureTestDeveloper()`, and `useFullTestLicense()` (marks setup completed and signs a Full license). Pass `{ Authorization: '' }` to send a request with no session.
- The backup scheduler does not start when `TEST_MODE` is set, so the suites exit on their own.
- A running `npm run dev` restarts the app when main/server files change, hot-reloads the UI, and keeps using the real database and backups folder (it may run scheduled backups while you work).
- `PHARMACARE_SAMPLE_DATA=true` (set in `.env` for development and by `testEnv.ts`) seeds a demo store, medicines and khata customers into an empty database (`server/database/sampleData.ts`). The packaged app never sets it, so a real install starts empty.

## Architecture

**Server layout.**
- `server/api.ts` is the entry point (Prisma init, backup scheduler) and re-exports `app`; Electron and the tests call `listen` themselves.
- `server/app.ts` builds the Express app: JSON body parser, the session/license gate, `PUBLIC_API_ROUTES`, the routers and a JSON error handler. No CORS: the UI is always same-origin (Vite proxy in dev, served by the API when packaged).
- `server/routes/*.ts`: one `Router` per area (`setup`, `auth`, `users`, `developer`, `license`, `developerAdmin`, `roles`, `companies`, `customers`, `products`, `sales`, `purchases`, `reports`, `utilities`, `shifts`, `settings`, `dashboard`, `expenses`, `dayClose`, ...). Routes keep their full `/api/...` paths.
- `server/http/context.ts`: `getActingUser`, `sessionIdentity`, `hasRolePermission`, `requirePermission(req, res, key, message)`, `isSetupLocked`, and `sendError(res, error, status?)`. Always answer failures with `sendError`: our own `Error` messages pass through, while database/driver errors become a plain message (and are logged), so internals never reach the screen.
- `server/http/formatters.ts`: `formatSale`, `sessionUserPayload` (Prisma camelCase → snake_case client contract). Some list endpoints use `prisma.$queryRaw` with `SELECT *`, so they return DB column names directly. Keep both paths in sync when you add columns.

**Shared code (`shared/`).** Pure modules imported by both the server and the UI: `permissions.ts` (permission keys, labels, role defaults, `parsePermissions`), `invoice.ts` (thermal templates/paper sizes and normalizers), `settingsDefaults.ts` (default `system_settings`). Never duplicate these lists elsewhere.

**Two DB access layers, one SQLite file.**
- `server/database/paths.ts` decides the file: `PHARMACARE_DATA_DIR` or `./data`. Both layers use it; `DATABASE_URL` is only for the Prisma CLI (`prisma.config.ts`).
- `server/database/db.ts` (better-sqlite3) runs `schema.ts`'s raw SQL and the seed data. `backup.ts` uses it for backups and restores.
- `server/database/prisma.ts` is the Prisma 7 client (import it from `../generated/prisma/client`, never `@prisma/client`) connected through the better-sqlite3 adapter.
- Stored dates are in mixed formats (integer ms from Prisma 6, `YYYY-MM-DD HH:MM:SS` from raw SQL, ISO text from Prisma 7). Raw SQL using `DATE(col)` skips the integer rows; see `docs/PROGRESS.md` 1.22.

There is no migration tool. A schema change needs all of:
- the model in `prisma/schema.prisma`;
- the `CREATE TABLE` in `server/database/schema.ts`;
- an entry in `COLUMN_MIGRATIONS` (same file) for a new column, which `db.ts` adds to older databases on startup (it checks `PRAGMA table_info` first);
- `npm run prisma:generate`.

`prisma.ts` imports `db.ts`, so the schema always exists before Prisma connects.

Startup data fixes (e.g. `migrateLegacyInvoiceSettings`) also run from `initPrisma`.

**Settings are key/value strings.** The `system_settings` table holds booleans as `'true'` / `'false'`. Defaults live once in `shared/settingsDefaults.ts` (used by `seed.ts`, `GET /api/settings` and `SettingsPage.tsx`). `GET /api/settings` merges them with the DB rows and also normalizes/forces some values.

**Request validation.** zod schemas in `server/validation/schemas.ts`; handlers call `parseBody(schema, req.body, res)` at the point of their old checks, so status order (e.g. setup lock 403 before input 400) and error messages stay the same.

**Auth and RBAC.**
- **Sessions** (`server/security/sessions.ts`): logins return a random token, held only in the API process (a restart logs everyone out). The client stores `{ user, token }` in `localStorage` (`pharmacare_user_session`), and every call in `src/services/apiService.ts` goes through `apiFetch`, which sends `Authorization: Bearer`. A 401 `SESSION_REQUIRED` or 403 `LICENSE_EXPIRED` fires `SESSION_ENDED_EVENT`, which logs the UI out.
- A middleware at the top of `api.ts` resolves the token into `res.locals.actor`. Every `/api` route needs a session except `PUBLIC_API_ROUTES`. `getActingUser(req)` returns that actor; **never read identity from headers or body fields** (old `user_id`/`admin_id` body fields are overwritten by `sessionIdentity(req)`).
- Logout, password change/reset, disabling and deleting a user revoke sessions (`revokeUserSessions`); a restore revokes every session (`revokeAllSessions`).
- Staff login locks after 5 wrong passwords for 15 minutes (`failedLoginAttempts`/`lockedUntil`; a password reset unlocks). Every staff password uses `PASSWORD_MIN` (`shared/passwords.ts`); the setup wizard asks for 8.
- Roles: a non-Developer cannot grant a permission their own role lacks (`assertGrantable` in `roles.ts`), change their own role, or assign an unknown role.
- Enforcement must be server-side; the UI only hides or locks controls. Users, roles, shifts, sales returns, khata payments, products/companies writes, purchases, reports, dashboard revenue, stock zero, optimize, settings, backups and developer routes check permissions; reading products and creating sales only require a login (`docs/PROGRESS.md` 2.1). New or changed routes must call `requirePermission` / `hasRolePermission`.
- Roles: `developer` (one account, signs in with the fixed developer email + a master-key TOTP code, never a password), `admin`, `cashier`, plus custom roles stored in the `roles` table with JSON `permissions`. Only the Developer bypasses the matrix (client and server). The `admin`/`developer` roles are changed only by the Developer (`/api/developer/admin-permissions`). Permission keys, labels and defaults live in `shared/permissions.ts`; the role checkbox matrix is `src/components/settings/RolePermissionEditor.tsx`.
- Security-relevant actions call `logSecurityAudit` (`server/security/audit.ts`), which redacts secrets.

**Developer master key, setup wizard and license.**
- One developer TOTP key for all installations (`server/security/developerKey.ts`), from `.env.developer` (created by `npm run developer:key`, git-ignored). `electron.vite.config.ts` bakes it into the packaged main bundle and refuses to build without it; dev and tests read it from the env or the file. There is no fallback key.
- `verifyDeveloperCode` (`server/security/developerAuth.ts`) checks codes against the master key and stores the last accepted step in `developer_totp_last_step` (replay protection). `users.totp_secret` is no longer read.
- Setup: `POST /api/setup/unlock` (master code → short-lived setup token) then `POST /api/setup/complete` (store, Admin account, backup, Admin permissions, policies, license) in one transaction. It is locked by `setup_completed`; nothing may write that key through `/api/settings`. Fresh databases have no staff users (`seed.ts`).
- License (`server/security/license.ts`, pure rules in `licenseMath.ts`): `license_*` settings signed with HMAC (key derived from the master key). A missing, tampered or expired license means Admin/Cashier are locked (login 403 and every request 403 `LICENSE_EXPIRED`); the Developer still works. Days count from `max(now, license_last_seen_at)`, so clock rollback does not help. `license_*` and `developer_totp_last_step` are never readable or writable through `/api/settings`.

**Developer-protected settings.**
- `/api/developer/settings` (developer only) manages:
  - store name/address;
  - `developer_invoice_footer`;
  - the developer profile (`shared/developerProfile.ts`: contact fields plus one `developer_info_<placement>` field list per placement `login | sidebar | invoice | about`);
  - backup policy;
  - the `allow_admin_*` toggles.
- Before sign-in, `GET /api/settings` returns only the store identity plus the developer details chosen for the login screen. A sale's `invoice_footer_snapshot` is `composeInvoiceFooter(settings)` (footer text + the receipt developer line).
- `POST /api/settings` strips `DEVELOPER_ONLY_SETTING_KEYS` for non-developers. It also blocks store-identity edits or hiding unless the matching toggle is `'true'`.

**Invoices are thermal-only.**
- `src/components/pos/UnifiedInvoice.tsx` renders three designs (`classic` | `compact` | `detailed`) at `58mm` | `80mm`. `ThermalReceipt.tsx` is a thin wrapper around it.
- The valid values and normalizers live in `shared/invoice.ts`; `server/invoice/invoiceSettings.ts` only holds the startup migration of legacy values. The server rejects anything else with 400.
- Each sale stores `store_name_snapshot`, `store_address_snapshot` and `invoice_footer_snapshot`. Receipts prefer these snapshots over current settings, so reprints match the original.
- Page-sized documents (statements) print with `printDocument` (`src/utils/printDocument.ts`, a hidden frame with plain A4 styles).
- Printing goes through `src/utils/printReceipt.ts`. With "Print without dialog" on (per computer, `localStorage`), the receipt's HTML plus the app CSS is sent to the `print:thermal` IPC, which prints it silently from a hidden sandboxed window sized to the receipt. Otherwise `window.print()` runs, and `@media print` in `src/index.css` hides everything except `#thermal-receipt-printable`.

**Sales and shifts.**
- `POST /api/sales` requires the session user's own open shift (a `shift_id` in the body is ignored).
- **The server prices every sale** (`server/sales/saleMath.ts`, pure + spec): rates come from the product, a changed rate or a line discount above the medicine's default needs `can_discount`, the bill discount is a percentage capped by `max_bill_discount_pct`, and client totals are ignored. It refuses overselling and Cash below the total (blank/0 cash = exact). The response carries the stored sale (`sale`), which the POS prints.
- **Returns** (`POST /api/sales/return`, needs `can_return_sale`) are checked per product + unit type against the invoice minus earlier returns (`priceReturn`); the refund shares the bill discount out. The sale becomes `partially_returned` or `returned`; reports and the dashboard count `completed` + `partially_returned`. `GET /api/sales/:id` adds `returned_qty` to each line.
- **Shift totals** come from one place (`server/shifts/shiftTotals.ts` + `loadShiftTotals`): only refunds of Cash invoices leave the drawer, Online counts with Card. Closing runs in one transaction (`updateMany where status open`), needs the counted cash, and only the owner or `can_manage_shifts` may close.
- Customers: a sale may carry `customer_id` (a saved khata customer; the sale then stores that customer's saved name/phone). A Credit sale **requires** one and is blocked past the customer's `credit_limit` (0 = no limit); returning a credit sale lowers the balance. Customers need a phone, unique by digits (`normalizePhone` in `shared/customers.ts`); a duplicate answers 409 with the existing customer. The POS picks customers with `CustomerPicker.tsx` (`GET /api/customers/search`). The Customers page (`src/pages/CustomersPage.tsx`, tab id `khata`) has a Customers tab and a Khata (Udhaar) tab; a customer can be deleted only with no invoices, payments or balance.
- It generates `INV-YYYYMMDD-NNNN` inside `prisma.$transaction`, with a 5-attempt retry on `SQLITE_BUSY` / unique collisions.
- Stock is tracked as boxes + loose units (`packing` units per box). Products can forbid loose ("open") sales and set a minimum sale quantity.
- **Batches (FEFO).** Invariant: a product's batch units add up to its stock. Rules are in `server/stock/batchMath.ts`; DB helpers in `server/stock/batchStock.ts`, always called inside the caller's transaction.
  - Sales call `takeUnits(..., includeExpired: false)` (expired stock is never sold) and record `sale_item_batches`. Sale returns put units back into those rows (`returned_units`).
  - Supplier returns use `takeUnitsFromBatch` (the named batch, then the earliest expiry).
  - Product create/edit calls `syncProductBatches`: uncovered stock goes to the `OPENING` batch, and an excess is trimmed by earliest expiry.
  - `reconcileAllProductBatches` runs at start-up.
  - **Any new code that changes `stock_boxes` / `stock_loose` must also move batches,** or call `syncProductBatches`.

**Suppliers (payables).** Companies are the suppliers.
- The balance owed is never stored: `buildSupplierLedger` (`server/suppliers/ledgerMath.ts`) works it out from purchases (`paid_amount`; rows marked Paid count as fully paid), `supplier_payments` and purchase-return credits. Payments settle the oldest bill first.
- `GET /api/purchases` shows each bill's derived status and `amount_due`.
- Routes: `GET /api/suppliers`, `GET /api/suppliers/:id/ledger` and `POST /api/suppliers/:id/payments` (`can_pay_supplier`, checked inside the transaction).
- `POST /api/purchases` validates with `createPurchaseSchema` and costs every line itself.
- `GET /api/purchases/:id` returns the lines with `returned_boxes` / `returnable_boxes`.
- **Returns to suppliers** (`server/routes/purchaseReturns.ts`, rules in `server/purchaseReturns/returnMath.ts`, `can_return_purchase`) work in whole boxes.
  - A line linked to a purchase is limited to bought + bonus − earlier returns, and credited at its cost after the line discount. Unlinked stock is limited to the supplier's own medicines and credited at the trade price.
  - Every line is capped by `stock_boxes`. A return lowers stock and the named batch, and its `total_refund` is a credit in the supplier ledger.
  - `GET /api/purchase-returns/expiry-candidates?days=` lists claimable batches, capped by stock until FEFO (M4).
- **Reorder list.**
  - Route: `GET /api/reorder?cover_days=&company_id=` (`purchases` permission).
  - Rules: `suggestReorder` in `server/reorder/reorderMath.ts`. A medicine is listed at or below `min_stock_alert`, or when its stock lasts fewer than the cover days at the last 30 days' units sold. Invoices count when `completed` or `partially_returned`, minus returns.
  - Cover days default to the setting `reorder_cover_days`.
- **Controlled medicines (M5).**
  - `products.schedule` is `none` | `rx` | `controlled` (`shared/schedule.ts`: values, labels, `missingPrescriptionFields`, `isValidCnic`). The product `$queryRaw` lists include it.
  - `POST /api/sales` takes an optional `prescription` object (one per invoice). A controlled line without patient, doctor and prescription number is refused. Each controlled line gets a `prescription_records` row.
  - The POS keeps the draft prescription per invoice tab (`usePosStore.prescription`) and asks for it in `PrescriptionModal` on F9/F10.
  - `GET /api/reports/controlled-register?date_from=&date_to=` (`reports` permission) lists the rows with the returned quantity (`src/components/reports/ControlledRegister.tsx`).
- **Substitutes (M6).** `shared/generic.ts`: `genericKey` (case, spacing and ingredient order ignored, strengths kept) and `rankSubstitutes` (in stock first, then same unit type, then stock, then name).
  - `GET /api/products/:id/substitutes` and `GET /api/products/generics?q=` (login only). They are registered before `/api/products/:id`.
  - In the POS, `SubstitutesModal` opens on F7 or the Substitutes button.
- **WhatsApp (M7).** `shared/whatsapp.ts`: `whatsappPhone` (→ 92XXXXXXXXXX or null), `fillTemplate`, `whatsappLink`, `receiptMessage`, `reminderMessage`.
  - `WhatsAppButton` (`src/components/common/`) opens the link through the `whatsapp:open` IPC, which allows only `https://wa.me/<digits>`. It copies the text when that fails.
  - Used on the POS receipt, the invoice reprint, Khata (Send reminder) and the Reorder List (supplier `company_phone`).
  - Texts: settings `whatsapp_receipt_template` / `whatsapp_reminder_template` (max 1000 characters, blank = default), edited in Settings → Store.
  - Every message (receipts, reminders, supplier orders) ends with `withDeveloperCredit` → `composeWhatsAppCredit` (`shared/developerProfile.ts`). It uses the developer placement `whatsapp` (`developer_info_whatsapp`) plus `developer_whatsapp_lead`, both Developer-only keys. They are edited in the Developer Profile's WhatsApp Advertising section, not in the placement table.
- **Expenses and day close (M8).**
  - `expenses` table, module key `expenses`, `can_add_expense` (cashiers have it) and `can_day_close`. Suggested categories and payment methods are in `shared/expenses.ts`.
  - A **cash** expense dated today is linked to the user's own open shift (`shift_id`), and `computeShiftTotals` subtracts it from the expected cash. A closed shift saves it as `total_expenses_cash`.
  - Without `can_day_close`, users list and change only their own expenses.
  - The day close maths is `server/dayClose/dayCloseMath.ts` (pure + spec), loaded by `loadDayClose.ts`. Sales count on the sale day and returns on the refund day; cost of goods = sold lines' `unit_cost` minus returned lines' cost; net profit = net sales − cost − expenses.
  - `POST /api/day-close` saves a `daily_closings` row with `is_closed = 1`. While it is closed, adding, changing or deleting that day's expenses gets 409. So does changing an expense of a closed shift.
  - `POST /api/day-close/:date/reopen` unlocks the day.
  - **Automatic close** (`server/dayClose/autoClose.ts`): the backup scheduler tick calls `autoDayCloseTick` once per local day. `runAutoDayClose(now)` closes every finished day of the last 31 days that had activity and is not closed (a reopened day is closed again), through the same `closeDay` helper (`closeDay.ts`) as the route, with `user_name` "Automatic" and `auto_closed = 1`. The setting `auto_day_close` (default `'true'`) turns it off.
  - `GET /api/day-close/range?from=&to=` (max 366 days) returns the period totals plus one row per active day; `loadPeriod` (`loadDayClose.ts`) loads the range once and splits it with `inputForDay` / `activeDays` (`dayCloseMath.ts`).
  - The UI is `src/pages/ExpensesPage.tsx` and Reports → Day Close (`DayCloseReport.tsx`).
- **Stock count and adjustment (M9).**
  - Tables `stock_counts`, `stock_count_items`, `stock_adjustments` (no foreign key to products, so history outlives a deleted medicine). Keys `can_count_stock` (cashier/pharmacist have it) and `can_adjust_stock` (Admin). Reasons and their direction are in `shared/stockAdjust.ts`; pure rules in `server/stock/adjustMath.ts` (+ spec).
  - **Every stock change outside sales, purchases and returns goes through `adjustProductStock`** (`server/stock/adjustStock.ts`, inside the caller's transaction): it moves the product total and its batches together (a chosen batch, else `syncProductBatches`) and writes a `stock_adjustments` row with the unit cost.
  - `PUT /api/products/:id` no longer changes stock; `POST /api/products` records opening stock as an `opening` adjustment. `resetStockZero` writes `stock_zero` rows by raw SQL (with `created_at` in Prisma's ISO format).
  - Routes (`server/routes/stock.ts`): `/api/stock/counts` (list, detail, create, `PUT .../items`, `DELETE .../items/:productId`, `apply`, `cancel`), `POST /api/products/:id/adjust`, `GET /api/stock/adjustments`. Apply uses stock = current + (counted − system at count), so sales made after counting stay sold.
  - UI: Medicines → Stock Count / Adjustments tabs and the Adjust stock action (`src/components/stock/`).
- The module roadmap (M1–M11) is `docs/FEATURE_ROADMAP.md`.

**Frontend.**
- There is no router. `src/App.tsx` switches pages on `currentTab` (`TabType` in `components/layout/Sidebar.tsx`) and passes the shared `settings` object to the pages.
- Global state uses zustand stores in `src/store/`.
- Every API call goes through `src/services/apiService.ts` (`get`/`post`/`put`/`del` helpers over one `request`; `API_BASE` is `/api`).
- Money and durations are formatted with `src/utils/format.ts` (`moneyFormatter(settings)`, `formatMoney`, `formatDuration`); the running shift timer is `src/hooks/useShiftElapsed.ts`.
- `SettingsPage.tsx` keeps the Store and Invoice tabs; the Users and Roles tabs are `src/components/settings/UsersTab.tsx` / `RolesTab.tsx`.
- `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters` on, so `npm run lint` fails on dead imports and variables.
- Shared types live in `src/types/index.ts`.

**Backups** (`server/database/backup.ts`, `server/backup/scheduler.ts`):
- `createBackup` writes `*.partial`, verifies it (`integrity_check` + core tables), renames it into place, records `backup_history` (`verified`, `checksum_sha256`), and only then prunes.
- Retention is per folder, based on `backup_history` rows; `pre_restore` snapshots are kept separately (newest 3).
- `computeSchedule` is pure (catch-up, backoff, clock rollback). `runRecordedBackup` / `recordBackupOutcome` update the `last_backup_*` settings that the Dashboard status endpoint reads.
- The Developer owns the frequency; the Admin can change only `backup_scheduled_time`.
- **Online backup** (`server/backup/cloud/`, guide `docs/ONLINE_BACKUP_SETUP.md`). `backup_mode` (`shared/backup.ts`) is one of:
  - `offline`;
  - `online` (local retention capped at 2 by `getLocalRetentionLimit`);
  - `both`.

  The mode is Developer-only.

  **Upload queue.** `runRecordedBackup` marks the new `backup_history` row `cloud_status = 'pending'`, and `runCloudUploads` uploads the newest pending row. It skips older pending rows and retries with backoff on every scheduler tick.

  **Google Drive.** `googleDrive.ts` uses plain `fetch` (no SDK) with the `drive.file` scope.
  - Sign-in runs through the system browser with a one-shot loopback listener on 127.0.0.1 + PKCE.
  - The `cloud:open-sign-in` IPC only opens `accounts.google.com`.
  - The client ID/secret come from `.env.developer` (`getGoogleOAuthClient`) and are baked into the build like the master key. Without them, only Offline is offered.

  **Encryption.** Files and the stored refresh token are encrypted with HKDF keys derived from the master key (`cloudCrypto.ts`).

  **Protected settings.** `gdrive_*` keys (`CLOUD_SETTING_KEYS`) are never readable or writable through `/api/settings`.

  **Restore.** Every restore runs inside `keepingCloudConnection`, so restoring an older backup never brings back a revoked sign-in.

  **Setup wizard.** It connects Drive through `POST /api/setup/cloud/{connect,status}`, which is authorized by the setup token.

**Electron** (`electron/main.ts`, `preload.ts`, `electron.vite.config.ts`, `electron-builder.yml`):
- Main dynamically imports `server/api.ts` after setting `PHARMACARE_DATA_DIR` / `PHARMACARE_BACKUP_DIR` to the per-user folder (packaged only), and listens on `127.0.0.1:${PHARMACARE_API_PORT || 3001}`.
- Packaged: the same Express app serves `out/renderer`, so the window loads `http://127.0.0.1:3001` and relative `/api` calls work. Dev: the window loads electron-vite's dev server, which proxies `/api`.
- Hardened when packaged: no menu, no DevTools, reload/inspector keys blocked, navigation locked. Exposes `window.electronAPI` (thermal print, backup/restore file dialogs, `openWhatsApp`) via a CommonJS preload.
- **Native module ABI:** better-sqlite3 is compiled for one runtime at a time, and everything (dev, integration suites, builds) runs on Electron's runtime, so it always stays the Electron build. `scripts/electron.mjs` probes it and runs `npm run rebuild` once if it does not load (e.g. after `npm install`, which builds it for plain Node). `rebuild`/`build:unpack`/`build:win` clear `node_modules/better-sqlite3/build/Release/.forge-meta` (`native:reset`); a stale marker makes electron-builder skip its rebuild and ship the Node binary.
- `build:unpack`/`build:win` need `.env.developer`; the key ends up inside the build, so never share a build made with a test key.
- **Electron is pinned to 42**: the newest better-sqlite3 on npm accepted by the Prisma adapter (12.11.1) has no binaries for newer Electron. Upgrade once better-sqlite3 12.12+ is published.
- VS Code terminals export `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node; `scripts/electron.mjs dev` removes it before launching.
- `appId` (`com.pharmacarepro.desktop`) must never change after the first client release.

## Conventions

- Keep the POS keyboard shortcuts working (`F2`–`F10`, `Esc`, `Ctrl+Enter`). `F2`/`Ctrl+T` opens a new invoice tab, `Ctrl+←/→`, `Ctrl+(Shift+)Tab` and `Ctrl+1…9` switch tabs, `Ctrl+W` closes one, `F7` shows same-formula substitutes, `F9` saves and `F10` prints. Submission is guarded by `isSubmittingRef` and `e.repeat` checks against duplicate invoices. The POS keydown handler is attached once and reads the latest state through `keyHandlerRef`.
- POS invoice tabs live in `src/store/usePosStore.ts`: the top-level draft fields (`cart`, `customerName`, ...) are always the **active** tab, and `invoices[]` holds the others (`getInvoiceTabs()` returns all of them up to date). Existing cart actions act on the active tab only.
- Print receipts with `printReceipt` / `printReceiptIn` (`src/utils/printReceipt.ts`), never `window.print()` directly: it honours the per-computer printer and "Print without dialog" preference and falls back to the dialog.
- The UI uses a teal/slate dark theme with Tailwind `dark:` variants, `lucide-react` icons, and system fonts only (nothing is downloaded at runtime).
- Design system (`src/index.css`): type scale `text-2xs` 12px / `text-xs` 13px / `text-sm` 15px (nothing smaller outside receipts); controls use `field-input` / `field-select` / `field-textarea` (+ `field-sm` in tables) with `field-label` / `field-hint`; buttons use `btn-primary` / `btn-secondary` / `btn-danger` / `btn-print` (+ `btn-sm`). Don't restyle controls inline, and don't use all-caps labels or gradient buttons. The receipt components keep their own paper-tuned pixel sizes.
- The app icon lives in `build/` (`icon.svg` is the source); `src/components/common/AppLogo.tsx` is the same mark in the UI.
- User-visible text brands the app as "100% Offline POS" and never names the libraries/technology used (no "SQLite", "Electron", "TOTP", "bcrypt", "local", ...). Say "authenticator code", "backup", "database". Code, comments and developer docs may use the real names.
- `docs/PROJECT_GUIDE.md` is the longer project guide, with module-by-module feature notes. Keep it updated when features change.
