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
- `server/routes/*.ts`: one `Router` per area (`setup`, `auth`, `users`, `developer`, `license`, `developerAdmin`, `roles`, `companies`, `customers`, `products`, `sales`, `purchases`, `reports`, `utilities`, `shifts`, `settings`, `dashboard`). Routes keep their full `/api/...` paths.
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

**Suppliers (payables).** Companies are the suppliers.
- The balance owed is never stored: `buildSupplierLedger` (`server/suppliers/ledgerMath.ts`) works it out from purchases (`paid_amount`; rows marked Paid count as fully paid), `supplier_payments` and purchase-return credits. Payments settle the oldest bill first.
- `GET /api/purchases` shows each bill's derived status and `amount_due`.
- Routes: `GET /api/suppliers`, `GET /api/suppliers/:id/ledger` and `POST /api/suppliers/:id/payments` (`can_pay_supplier`, checked inside the transaction).
- `POST /api/purchases` validates with `createPurchaseSchema` and costs every line itself.
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
- Hardened when packaged: no menu, no DevTools, reload/inspector keys blocked, navigation locked. Exposes `window.electronAPI` (thermal print, backup/restore file dialogs) via a CommonJS preload.
- **Native module ABI:** better-sqlite3 is compiled for one runtime at a time, and everything (dev, integration suites, builds) runs on Electron's runtime, so it always stays the Electron build. `scripts/electron.mjs` probes it and runs `npm run rebuild` once if it does not load (e.g. after `npm install`, which builds it for plain Node). `rebuild`/`build:unpack`/`build:win` clear `node_modules/better-sqlite3/build/Release/.forge-meta` (`native:reset`); a stale marker makes electron-builder skip its rebuild and ship the Node binary.
- `build:unpack`/`build:win` need `.env.developer`; the key ends up inside the build, so never share a build made with a test key.
- **Electron is pinned to 42**: the newest better-sqlite3 on npm accepted by the Prisma adapter (12.11.1) has no binaries for newer Electron. Upgrade once better-sqlite3 12.12+ is published.
- VS Code terminals export `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node; `scripts/electron.mjs dev` removes it before launching.
- `appId` (`com.pharmacarepro.desktop`) must never change after the first client release.

## Conventions

- Keep the POS keyboard shortcuts working (`F2`–`F10`, `Esc`, `Ctrl+Enter`). `F2`/`Ctrl+T` opens a new invoice tab, `Ctrl+←/→`, `Ctrl+(Shift+)Tab` and `Ctrl+1…9` switch tabs, `Ctrl+W` closes one, `F9` saves and `F10` prints. Submission is guarded by `isSubmittingRef` and `e.repeat` checks against duplicate invoices. The POS keydown handler is attached once and reads the latest state through `keyHandlerRef`.
- POS invoice tabs live in `src/store/usePosStore.ts`: the top-level draft fields (`cart`, `customerName`, ...) are always the **active** tab, and `invoices[]` holds the others (`getInvoiceTabs()` returns all of them up to date). Existing cart actions act on the active tab only.
- Print receipts with `printReceipt` / `printReceiptIn` (`src/utils/printReceipt.ts`), never `window.print()` directly: it honours the per-computer printer and "Print without dialog" preference and falls back to the dialog.
- The UI uses a teal/slate dark theme with Tailwind `dark:` variants, `lucide-react` icons, and system fonts only (nothing is downloaded at runtime).
- Design system (`src/index.css`): type scale `text-2xs` 12px / `text-xs` 13px / `text-sm` 15px (nothing smaller outside receipts); controls use `field-input` / `field-select` / `field-textarea` (+ `field-sm` in tables) with `field-label` / `field-hint`; buttons use `btn-primary` / `btn-secondary` / `btn-danger` / `btn-print` (+ `btn-sm`). Don't restyle controls inline, and don't use all-caps labels or gradient buttons. The receipt components keep their own paper-tuned pixel sizes.
- The app icon lives in `build/` (`icon.svg` is the source); `src/components/common/AppLogo.tsx` is the same mark in the UI.
- User-visible text brands the app as "100% Offline POS" and never names the libraries/technology used (no "SQLite", "Electron", "TOTP", "bcrypt", "local", ...). Say "authenticator code", "backup", "database". Code, comments and developer docs may use the real names.
- `docs/PROJECT_GUIDE.md` is the longer project guide, with module-by-module feature notes. Keep it updated when features change.
