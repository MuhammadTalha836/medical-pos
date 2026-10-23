# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PharmaCare Pro: an offline-first pharmacy management and POS desktop app. It has a React 18 + Vite + Tailwind UI and an Express API backed by SQLite (Prisma, plus better-sqlite3). An Electron shell wraps both. Phased requirements are tracked in `docs/ralph_loop_prompt_for_antigravity.md`. Phases 1–4 are done; Phase 5 (final acceptance review) is still open.

## Commands

```bash
npm run dev              # API (tsx watch server/api.ts, :3001) + Vite UI (:5173, proxies /api -> :3001)
npm run dev:server       # API only
npm run dev:ui           # UI only
npm run lint             # tsc --noEmit over src/ AND server/ (the only lint/typecheck)
npm run build            # prisma generate && tsc && vite build
npm run prisma:generate  # required after editing prisma/schema.prisma

npm run test:functional  # end-to-end business flow (15 steps)
npm run test:phase1      # setup wizard + developer TOTP auth
npm run test:phase2      # RBAC, developer settings, audit log
npm run test:phase3      # thermal-only invoices, protected identity, sale snapshots
npm run test:phase4      # backup retention, verification, offline scheduler, backup RBAC
```

Testing notes:
- There is no test framework. Each suite is a standalone `tsx` script that imports `app` from `server/api.ts`.
- Run a single suite directly: `npx tsx server/tests/phase3_test.ts`. There is no per-case filter.
- **Tests hit the real database** at `data/pharmacy.db`. Back it up before experimenting. `phase3_test.ts` and `phase4_test.ts` restore what they touch (phase4 writes its backups to an OS temp folder); the functional suite leaves sales, purchases and backups behind.
- `phase2_test.ts` and `functional_test.ts` use an already-running server on `:3001` if there is one; otherwise they start an ephemeral one.
- The backup scheduler does not start when `TEST_MODE` is set, so the suites exit on their own. Never call `createBackup` or `POST /api/utilities/backup` in a test without pointing it at a temp folder, because pruning would delete real backups.
- The `prisma:error ... duplicate column name` lines at startup are expected. They come from the idempotent `ALTER TABLE` migrations.

## Architecture

**Single API file.** Every route lives in `server/api.ts`, a large Express app with section comments. Prisma models are camelCase. The client contract is snake_case, mapped by hand through helpers such as `formatSale` / `formatSaleItem`. Some list endpoints use `prisma.$queryRaw` with `SELECT *`, so they return the DB column names directly. Keep both paths in sync when you add columns.

**Two DB access layers, one SQLite file.**
- `server/database/db.ts` (better-sqlite3) runs `schema.ts`'s raw SQL and the seed data. `backup.ts` uses it for backups and restores.
- `server/database/prisma.ts` is the Prisma client that the API uses.

There is no migration tool. A schema change needs all of:
- the model in `prisma/schema.prisma`;
- the `CREATE TABLE` in `server/database/schema.ts`;
- `try { ALTER TABLE ... } catch {}` lines in **both** `db.ts` and `prisma.ts` (`initPrisma`);
- `npm run prisma:generate`.

Startup data fixes (e.g. `migrateLegacyInvoiceSettings`) also run from `initPrisma`.

**Settings are key/value strings.** The `system_settings` table holds booleans as `'true'` / `'false'`. `GET /api/settings` merges hard-coded defaults with the DB rows and also normalizes/forces some values. Defaults are duplicated in `seed.ts`, the `GET` handler and `SettingsPage.tsx`'s initial state.

**Auth and RBAC.**
- The client stores the session in `localStorage` (`pharmacare_user_session`). `getAuthHeaders()` in `src/services/apiService.ts` sends an `x-user-id` header.
- The server resolves that header with `getActingUser(req)` and checks `role` itself. Enforcement must be server-side; the UI only hides or locks controls.
- Roles: `developer` (one account, logs in with email + TOTP and no password), `admin`, `cashier`, plus custom roles stored in the `roles` table with JSON `permissions`.
- Security-relevant actions call `logSecurityAudit` (`server/security/audit.ts`), which redacts secrets.
- TOTP secrets are encrypted at rest (`server/security/totp.ts`) and must never appear in responses or logs.
- The first-run setup wizard is locked by `setup_completed`. Nothing may write that key through `/api/settings`.

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

**Electron** (`electron/main.ts`, `preload.ts`): loads the Vite dev server when unpackaged and `dist/index.html` when packaged. It exposes `window.electronAPI` (thermal print, backup/restore file dialogs) over IPC with `contextIsolation`.

## Conventions

- Keep the POS keyboard shortcuts working (`F2`–`F10`, `Esc`, `Ctrl+Enter`). `F9` saves and `F10` prints. Submission is guarded by `isSubmittingRef` and `e.repeat` checks against duplicate invoices.
- The UI uses a teal/slate dark theme with Tailwind `dark:` variants, and `lucide-react` icons.
- `GEMINI.md` is the longer project guide, with module-by-module feature notes. Keep it updated when features change.
