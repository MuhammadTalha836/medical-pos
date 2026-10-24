# Changelog

All notable changes to PharmaCare Pro. Dates are in the store's local calendar.

## [Unreleased] — 2026-10-24

### Added
- Developer-gated installation: the first-run wizard opens only with a code from the developer's master authenticator key (baked into the build with `npm run developer:key`). The developer creates the Admin (username + password), backup folder and schedule, Admin permissions and policies, and chooses Demo (N days) or Full.
- Demo / Full license (`server/security/license.ts`): signed with a key derived from the developer key, protected against clock rollback; an expired demo blocks Admin and Cashier sign-in. Developer Settings → License can extend the demo, start a new one or activate Full.
- Developer Settings → Admin Permissions; the Admin can no longer edit their own role.
- Demo countdown badge in the header for the Admin and Developer.
- `docs/DEVELOPER_RECOVERY.md`; `npm run test:phase5` (sessions and license).
- Desktop packaging: Electron 42 + electron-vite + electron-builder (`npm run build:unpack`, `npm run build:win`, `npm run dev:electron`). The Electron main process runs the API in-process on `127.0.0.1` only, serves the UI from the same origin, and keeps data in the per-user folder.
- Production hardening in the desktop app: no application menu (F10/Alt cannot open it), no DevTools, reload and inspector shortcuts blocked, navigation locked to the app.
- zod request validation for setup, logins, users, settings, developer settings, backup schedule, sales and shift reopen (`server/validation/schemas.ts`).
- vitest unit tests (`npm test`): backup scheduler, invoice rules, TOTP, passwords, request schemas, UI helpers.
- `docs/PROGRESS.md`: requirement-by-requirement audit against `docs/IMPLEMENTATION_PLAN.md`.
- `PHARMACARE_DATA_DIR`, `PHARMACARE_BACKUP_DIR`, `PHARMACARE_API_PORT` environment overrides.

### Changed
- Integration suites run on a temporary copy of `data/pharmacy.db` and a temp backup folder (`server/tests/testEnv.ts`), so they no longer change real data.
- Packaging scripts clear better-sqlite3's `.forge-meta` before rebuilding; previously a stale marker made electron-builder ship the Node build, so the packaged app could not open its database.
- Prisma 6.19 → 7.10 with `@prisma/adapter-better-sqlite3`; client generated into `server/generated/prisma`; datasource URL moved to `prisma.config.ts`.
- better-sqlite3 11.10 → 12.11.1 (one copy shared with the Prisma adapter).
- Tailwind CSS 3.4 → 4.3 via `@tailwindcss/vite`; theme moved to `@theme` in `src/index.css`; `tailwind.config.js`, `postcss.config.js` and autoprefixer removed.
- TOTP now uses otplib v12 (same secrets and codes; RFC 6238 vectors verified).
- Pure backup-schedule math moved to `server/backup/schedule.ts`.
- Relative backup folders resolve against the app's base folder instead of the process working directory.

### Security
- Server-side login sessions (bearer tokens). The server no longer trusts the `x-user-id` header; every `/api` route except a small public list needs a session, and `user_id`/`admin_id` fields in request bodies are replaced by the signed-in user.
- Developer TOTP codes cannot be reused (replay protection). The developer cannot sign in with a password.
- Fresh installs no longer create `admin/admin123`, `cashier/cash123` or `pharmacist/pharma123`; the UI no longer falls back to a built-in Admin user or pre-fills credentials.
- Users, roles, shift admin actions and stock zero now check permissions; the last active Admin cannot be disabled or deleted.
- body-parser patched (`npm audit` reports 0 vulnerabilities).
