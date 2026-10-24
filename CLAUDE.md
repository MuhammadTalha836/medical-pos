# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PharmaCare Pro: an offline-first pharmacy management and POS desktop app. It has a React 18 + Vite 6 + Tailwind 4 UI and an Express API backed by SQLite (Prisma 7 through `@prisma/adapter-better-sqlite3`, plus better-sqlite3 12). Electron 42 wraps both. Phased requirements are tracked in `docs/ralph_loop_prompt_for_antigravity.md` (Phases 1–4 done). `docs/IMPLEMENTATION_PLAN.md` is the owner's target plan; `docs/PROGRESS.md` is the audit of the code against it. Work its gaps one phase at a time, only with the owner's approval.

## Commands

```bash
npm run dev              # API (tsx watch server/api.ts, :3001) + Vite UI (:5173, proxies /api -> :3001)
npm run dev:server       # API only
npm run dev:ui           # UI only
npm run lint             # tsc --noEmit over src/, server/ AND electron/ (the only lint/typecheck)
npm run build            # prisma generate && tsc && vite build
npm run prisma:generate  # required after editing prisma/schema.prisma (output: server/generated/prisma, gitignored)

npm test                 # vitest unit tests (*.spec.ts, pure logic only, no DB)
npx vitest run server/backup/schedule.spec.ts   # a single unit spec

npm run dev:electron     # desktop app in dev (needs `npm run rebuild:electron` first, see below)
npm run build:unpack     # packaged app in release/<platform>-unpacked, then restores the Node build
npm run build:win        # Windows NSIS installer (run on Windows)

npm run test:functional  # end-to-end business flow (15 steps)
npm run test:phase1      # setup wizard + developer TOTP auth
npm run test:phase2      # RBAC, developer settings, audit log
npm run test:phase3      # thermal-only invoices, protected identity, sale snapshots
npm run test:phase4      # backup retention, verification, offline scheduler, backup RBAC
npm run test:phase5      # server sessions, Developer-only admin permissions, Demo/Full license

npm run developer:key    # create .env.developer (developer master TOTP key) and print its QR; --show / --rotate
```

Testing notes:
- Two kinds of tests. `npm test` runs vitest unit specs next to the code (`server/**/*.spec.ts`, `src/**/*.spec.ts`); keep them free of DB imports (that is why the schedule math lives in `server/backup/schedule.ts`). The `test:*` suites are standalone `tsx` integration scripts that import `app` from `server/api.ts`.
- Run a single integration suite directly: `npx tsx server/tests/phase3_test.ts`. There is no per-case filter.
- Every suite imports `./testEnv` **first**. It copies `data/pharmacy.db` (+WAL) into an OS temp folder, sets `PHARMACARE_DATA_DIR`/`PHARMACARE_BACKUP_DIR` there, and installs a fixed test developer key, so suites never touch real data, backups or the real license. Keep that import first in new suites (ES modules run imports in order).
- Suites always start an in-process server (sessions live in that process) and authenticate with `authHeaders(user)` / `adminAuthHeaders()` from `server/tests/testAuth.ts`, which mint session tokens directly. `useFullTestLicense()` signs a Full license on the temp copy. Pass `{ Authorization: '' }` to send a request with no session.
- The backup scheduler does not start when `TEST_MODE` is set, so the suites exit on their own.
- A running `npm run dev` (tsx watch) reloads on every edit and keeps using the real database and backups folder (it may run scheduled backups while you work).
- The `prisma:error ... duplicate column name` lines at startup are expected. They come from the idempotent `ALTER TABLE` migrations.

## Architecture

**Single API file.** Every route lives in `server/api.ts`, a large Express app with section comments. Prisma models are camelCase. The client contract is snake_case, mapped by hand through helpers such as `formatSale` / `formatSaleItem`. Some list endpoints use `prisma.$queryRaw` with `SELECT *`, so they return the DB column names directly. Keep both paths in sync when you add columns.

**Two DB access layers, one SQLite file.**
- `server/database/paths.ts` decides the file: `PHARMACARE_DATA_DIR` or `./data`. Both layers use it; `DATABASE_URL` is only for the Prisma CLI (`prisma.config.ts`).
- `server/database/db.ts` (better-sqlite3) runs `schema.ts`'s raw SQL and the seed data. `backup.ts` uses it for backups and restores.
- `server/database/prisma.ts` is the Prisma 7 client (import it from `../generated/prisma/client`, never `@prisma/client`) connected through the better-sqlite3 adapter.
- Stored dates are in mixed formats (integer ms from Prisma 6, `YYYY-MM-DD HH:MM:SS` from raw SQL, ISO text from Prisma 7). Raw SQL using `DATE(col)` skips the integer rows; see `docs/PROGRESS.md` 1.22.

There is no migration tool. A schema change needs all of:
- the model in `prisma/schema.prisma`;
- the `CREATE TABLE` in `server/database/schema.ts`;
- `try { ALTER TABLE ... } catch {}` lines in **both** `db.ts` and `prisma.ts` (`initPrisma`);
- `npm run prisma:generate`.

Startup data fixes (e.g. `migrateLegacyInvoiceSettings`) also run from `initPrisma`.

**Settings are key/value strings.** The `system_settings` table holds booleans as `'true'` / `'false'`. `GET /api/settings` merges hard-coded defaults with the DB rows and also normalizes/forces some values. Defaults are duplicated in `seed.ts`, the `GET` handler and `SettingsPage.tsx`'s initial state.

**Request validation.** zod schemas in `server/validation/schemas.ts`; handlers call `parseBody(schema, req.body, res)` at the point of their old checks, so status order (e.g. setup lock 403 before input 400) and error messages stay the same.

**Auth and RBAC.**
- **Sessions** (`server/security/sessions.ts`): logins return a random token, held only in the API process (a restart logs everyone out). The client stores `{ user, token }` in `localStorage` (`pharmacare_user_session`), and every call in `src/services/apiService.ts` goes through `apiFetch`, which sends `Authorization: Bearer`. A 401 `SESSION_REQUIRED` or 403 `LICENSE_EXPIRED` fires `SESSION_ENDED_EVENT`, which logs the UI out.
- A middleware at the top of `api.ts` resolves the token into `res.locals.actor`. Every `/api` route needs a session except `PUBLIC_API_ROUTES`. `getActingUser(req)` returns that actor; **never read identity from headers or body fields** (old `user_id`/`admin_id` body fields are overwritten by `sessionIdentity(req)`).
- Logout, password change/reset, disabling and deleting a user revoke sessions (`revokeUserSessions`).
- Enforcement must be server-side; the UI only hides or locks controls. Only users, roles, shift admin actions, stock zero, settings, backups and developer routes check permissions so far; other routes only require a login (`docs/PROGRESS.md` 2.1). New or changed routes must call `hasRolePermission`.
- Roles: `developer` (one account, signs in with the fixed developer email + a master-key TOTP code, never a password), `admin`, `cashier`, plus custom roles stored in the `roles` table with JSON `permissions`. Only the Developer bypasses the matrix (client and server). The `admin`/`developer` roles are changed only by the Developer (`/api/developer/admin-permissions`). Permission defaults live in `server/security/permissions.ts`, labels in `src/utils/permissions.ts`.
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
  - backup policy;
  - the `allow_admin_*` toggles.
- `POST /api/settings` strips `DEVELOPER_ONLY_SETTING_KEYS` for non-developers. It also blocks store-identity edits or hiding unless the matching toggle is `'true'`.

**Invoices are thermal-only.**
- `src/components/pos/UnifiedInvoice.tsx` renders three designs (`classic` | `compact` | `detailed`) at `58mm` | `80mm`. `ThermalReceipt.tsx` is a thin wrapper around it.
- The valid values and normalizers live in `server/invoice/invoiceSettings.ts`, mirrored client-side in `src/utils/invoice.ts`. The server rejects anything else with 400.
- Each sale stores `store_name_snapshot`, `store_address_snapshot` and `invoice_footer_snapshot`. Receipts prefer these snapshots over current settings, so reprints match the original.
- Printing uses `window.print()`. `@media print` in `src/index.css` hides everything except `#thermal-receipt-printable`.

**Sales and shifts.**
- `POST /api/sales` requires an open cashier shift.
- It generates `INV-YYYYMMDD-NNNN` inside `prisma.$transaction`, with a 5-attempt retry on `SQLITE_BUSY` / unique collisions.
- Stock is tracked as boxes + loose units (`packing` units per box). Products can forbid loose ("open") sales and set a minimum sale quantity.

**Frontend.**
- There is no router. `src/App.tsx` switches pages on `currentTab` (`TabType` in `components/layout/Sidebar.tsx`) and passes the shared `settings` object to the pages.
- Global state uses zustand stores in `src/store/`.
- Every API call goes through `src/services/apiService.ts` (`API_BASE` is `/api`).
- Shared types live in `src/types/index.ts`.

**Backups** (`server/database/backup.ts`, `server/backup/scheduler.ts`):
- `createBackup` writes `*.partial`, verifies it (`integrity_check` + core tables), renames it into place, records `backup_history` (`verified`, `checksum_sha256`), and only then prunes.
- Retention is per folder, based on `backup_history` rows; `pre_restore` snapshots are kept separately (newest 3).
- `computeSchedule` is pure (catch-up, backoff, clock rollback). `runRecordedBackup` / `recordBackupOutcome` update the `last_backup_*` settings that the Dashboard status endpoint reads.
- The Developer owns the frequency; the Admin can change only `backup_scheduled_time`.

**Electron** (`electron/main.ts`, `preload.ts`, `electron.vite.config.ts`, `electron-builder.yml`):
- Main dynamically imports `server/api.ts` after setting `PHARMACARE_DATA_DIR` / `PHARMACARE_BACKUP_DIR` to the per-user folder (packaged only), and listens on `127.0.0.1:${PHARMACARE_API_PORT || 3001}`.
- Packaged: the same Express app serves `out/renderer`, so the window loads `http://127.0.0.1:3001` and relative `/api` calls work. Dev: the window loads electron-vite's dev server, which proxies `/api`.
- Hardened when packaged: no menu, no DevTools, reload/inspector keys blocked, navigation locked. Exposes `window.electronAPI` (thermal print, backup/restore file dialogs) via a CommonJS preload.
- **Native module ABI:** better-sqlite3 is compiled for one runtime at a time. `rebuild:electron` before `dev:electron`; `rebuild:node` before `npm run dev` / tests. `build:unpack`/`build:win` restore the Node build automatically. All of these clear `node_modules/better-sqlite3/build/Release/.forge-meta` (`native:reset`); a stale marker makes electron-builder skip its rebuild and ship the Node binary.
- `build:unpack`/`build:win` need `.env.developer`; the key ends up inside the build, so never share a build made with a test key.
- **Electron is pinned to 42**: the newest better-sqlite3 on npm accepted by the Prisma adapter (12.11.1) has no binaries for newer Electron. Upgrade once better-sqlite3 12.12+ is published.
- VS Code terminals export `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node. Run the app with `env -u ELECTRON_RUN_AS_NODE`.
- `appId` (`com.pharmacarepro.desktop`) must never change after the first client release.

## Conventions

- Keep the POS keyboard shortcuts working (`F2`–`F10`, `Esc`, `Ctrl+Enter`). `F9` saves and `F10` prints. Submission is guarded by `isSubmittingRef` and `e.repeat` checks against duplicate invoices.
- The UI uses a teal/slate dark theme with Tailwind `dark:` variants, and `lucide-react` icons.
- `GEMINI.md` is the longer project guide, with module-by-module feature notes. Keep it updated when features change.
