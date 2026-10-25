# Changelog

All notable changes to PharmaCare Pro. Dates are in the store's local calendar.

## [Unreleased] — 2026-10-24

### Added
- Online backup to Google Drive: the Developer picks the backup type at install (setup wizard → Backups) or later (Developer → Backup Retention): **Offline** (this computer, as before), **Online** (the store owner's Google Drive; only the newest 2 copies stay on the PC) or **Both**. The owner signs in once with their Gmail; the app can only see its own "100% Offline POS Backups" folder. Copies are encrypted, uploads wait for the internet and retry on their own, Drive keeps the retention limit, and Backup & Recovery → Online Backups restores any of them. The Dashboard backup card shows the online status. Needs a Google sign-in client in the build (`docs/ONLINE_BACKUP_SETUP.md`).
- Customers page (sidebar "Customers", replaces "Customer Khata"): a **Customers** tab listing every customer with Edit and Delete; the arrow on a row shows that customer's invoices, and clicking one opens the full invoice with Print (reprint). A **Khata (Udhaar)** tab shows who owes how much, Receive Payment, and each customer's credit invoices and payments. Customers with invoices, payments or udhaar cannot be deleted.
- POS customer picker: the customer field searches saved customers by name or phone, shows their khata balance and limit, and saves a new customer (name + phone) on the spot. It stays "Counter Customer" by default; a phone that already belongs to someone offers that customer instead of a copy.
- Customer history: Khata → Ledger lists every invoice of the customer (cash or credit) with a View button showing the items, plus totals bought, on credit and paid.
- POS invoice tabs: up to 10 open invoices at once, like browser tabs, so a paused customer's order waits while the next customer is served. `F2`/`Ctrl+T` new, `Ctrl+←/→` (or `Ctrl+Tab`) switch, `Ctrl+1…9` jump, `Ctrl+W` close (asks if the invoice has items). Saving a sale closes only its tab. Open invoices survive an app restart and are cleared on sign-out.
- Print without dialog: Settings → Invoice → Receipt Printer (per computer) picks the printer and turns on direct printing; receipts then go straight to the printer, cut at their real length. A test print button is included. Without it, or if the printer fails, the normal print dialog opens.
- App icon (`build/icon.png`, source `build/icon.svg`): installer, `.exe`, window, taskbar and the in-app logo.
- Developer profile & advertising: the Developer enters name, company, phone, WhatsApp, email, website and a message (Developer → Developer Profile) and picks which details show on the login screen, the sidebar, the sale receipt and the new Support window (Header → Support). Staff cannot change or hide them; each sale keeps the receipt line it was printed with.

### Added (M2: returns to supplier and expiry claims)
- Purchases → **Returns to Supplier** tab.
  - **Expiry claims** lists expired and soon-expiring stock (30/60/90/180 days) by supplier; **Create claim** fills a claim with those boxes in one click.
  - **New Return** sends boxes back from one of the supplier's purchases (credited at what was paid, after the line discount) or from any of its medicines in stock (credited at the trade price).
  - Stock and the batch go down, and the credit lowers what is owed to that supplier. When credits pass what is owed, the Suppliers tab shows "They owe you".
  - You cannot return more than was bought (bonus included) minus earlier returns, more than is in stock, or another supplier's medicine.
  - Every return has a printable return note.
- New permission "Return Goods to Supplier" (`can_return_purchase`): Admin yes, Cashier no.
- The purchase voucher now lists its medicines, batches, discounts and returned boxes, and prints on A4 (it printed a blank page before).

### Added (M1: supplier ledger, see docs/FEATURE_ROADMAP.md)
- Purchases → **Suppliers (payables)** tab: what the store owes each distributor, total owed, a search box and an "only suppliers I owe" filter. **Pay** records a cash, bank, cheque or online payment (with a cheque or transaction number); it settles the oldest unpaid bill first and cannot be more than what is owed. **Statement** shows the unpaid bills and every purchase, payment and return with a running balance, and prints on A4.
- New purchase: **Payment** is now Paid in full / On credit / Part paid now (with the amount). The purchase list shows each bill's real status (Paid, Partial, Pending) and the amount still due, including later payments.
- New permission "Pay Suppliers" (`can_pay_supplier`): Admin yes, Cashier no. "New Purchase Inward" shows only with "Record Supplier Purchases".

### Fixed (purchases)
- Purchases are costed on the server: totals sent by the screen are ignored, quantities must be whole boxes (at least 1), prices cannot be negative, an unknown medicine stops the purchase instead of being skipped, and the purchase number uses the local date. The Post button cannot be pressed twice.

### Fixed (audit phase 1: money and security on the server)
- Sales are priced by the server from the medicine record. Tampered rates, discounts or totals are refused or recalculated; the receipt shows the sale exactly as stored. Changing a rate or giving a discount needs the "Give Discounts" permission, and the bill discount stays within the store maximum.
- A sale that needs more stock than is on the shelf is refused (before, stock silently dropped to 0). Cash less than the bill total is refused; leaving cash empty still means exact payment. Quantities must be whole numbers.
- Sales, returns and khata payments always go to the signed-in user's own open shift.
- Returns: each invoice line (box or loose) is returned separately, loose units go back as loose units, at most what was sold (minus earlier returns), and the refund is what the customer paid (bill discount included). A partial return marks the invoice "Part returned" so the rest can still come back; returns need the "Process Sale Returns" permission.
- Shift cash: refunds of credit and card invoices no longer lower the expected cash in the drawer; Online sales count with Card/digital. Closing needs the counted cash, is done once (two closes at once cannot both win), and only by the shift's own cashier or a shift manager. A shift is not reopened while the cashier has another open one.
- Khata payments: the balance is read and updated in one step (two payments at once no longer overwrite each other); a payment above the balance is refused; it needs the "Receive Cash Recoveries" permission.
- Roles: an Admin can no longer create or edit a role with permissions their own account does not have, change their own role, or assign a role that does not exist.
- Medicines, companies, purchases, reports, the Dashboard revenue figures and database optimization now check the role's permissions on the server.
- Restore: one restore at a time, and everyone is signed out afterwards (the restored data may have other users and roles).
- Staff sign-in: five wrong passwords in a row lock the account for 15 minutes (an Admin password reset unlocks it). One minimum password length (6) for every staff password.
- Invoice, return and shift numbers use the local date (after midnight they used yesterday's date).

### Fixed
- Credit sales now reach the customer's khata: they require a saved customer, raise the balance and appear in the ledger (before, the POS never linked the customer, so khata balances did not change). Credit sales past the customer's credit limit are blocked (0 = no limit). Returning goods from a credit sale lowers the balance.
- New and edited khata customers need a phone number, unique per customer.

### Changed (design system, phase A)
- Larger type everywhere (nothing under 12px; body text 15px), 40px inputs/selects/buttons with one shared style (`field-input`, `field-select`, `field-textarea`, `btn-primary`/`btn-secondary`/`btn-danger`/`btn-print`, `btn-sm`, `field-sm`), bigger icons, no all-caps labels, flat buttons without gradients.
- Plain sidebar names (New Sale, Sales & Returns, Customer Khata, Dashboard, Shifts, Medicines, Purchases, Reports, Backup & Recovery, Settings, Developer) with a high-contrast active item.
- Receipts and shift slips no longer print sample phone/license/address text when the store has not filled them in.
- F10 reprint of the last sale now also works after leaving and returning to the POS.

### Clean-up (refactor, no feature change)
- `server/api.ts` (4,358 lines) split into `server/app.ts`, `server/routes/*` (17 routers) and `server/http/*` helpers; routes, status codes and responses are unchanged (all suites pass).
- One source for permission matrices, invoice rules and settings defaults in `shared/` (they were copied 3–5 times and had drifted apart).
- One column-migration list (`COLUMN_MIGRATIONS`) applied by `db.ts`; no more `duplicate column` errors at startup.
- Database and driver errors are no longer shown to users (`sendError`); malformed requests get a plain message.
- Removed: hard-coded fallback encryption seed and unused TOTP encryption helpers, the unused daily-closing route, CORS (the UI is same-origin), the receipt wrapper component, dead state and 40+ unused imports. `noUnusedLocals` is now on.
- UI: one API request helper, shared money/duration formatters, a shared shift timer hook, and the Settings page split (Users and Roles tabs, one role permission editor).
- Fresh installs no longer contain demo medicines, fake khata balances or a sample store identity; demo data is opt-in (`PHARMACARE_SAMPLE_DATA=true`, used by `npm run dev` and the tests).
- Tests run on a fresh database with fixtures instead of a copy of the real one.
- User-visible text now says "100% Offline POS" and no longer names libraries or says "local"; the app no longer downloads web fonts.

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
- Integration suites run on a fresh temporary database and backup folder (`server/tests/testEnv.ts`), so they never change real data.
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
