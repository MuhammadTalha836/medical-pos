# PROGRESS — Audit against `docs/IMPLEMENTATION_PLAN.md`

Audit date: 2026-10-24 · Commit audited: `f0bc939` (after Phases 1–4 of `ralph_loop_prompt_for_antigravity.md`)

Status legend (from `IMPLEMENTATION_PLAN1.md`): ✅ Done · 🟡 Partial · ⚠️ Done but wrong/insecure · ❌ Missing · ➖ Not applicable

---

## Khulasa (Roman Urdu)

- **Kya theek hai:** Developer setup wizard aur TOTP login offline chal rahe hain. Lockout restart ke baad bhi rehta hai. Role permissions aur audit log mojood hain. Sirf 58/80 mm thermal invoices hain, aur purani sale ka reprint wohi store naam/footer dikhata hai jo sale ke waqt tha. Backup verify hota hai, retention (N backups) aur offline scheduler kaam kar rahe hain. Keyboard shortcuts F2–F10 mojood hain.
- **Security (is round mein theek hua):** Ab har API request ke liye login session (token) zaroori hai; `x-user-id` header ka koi asar nahi. Setup sirf developer ke authenticator code se khulta hai. Developer Admin banata hai, us ka password, backup, permissions aur Demo/Full set karta hai. Demo khatam hone par Admin/Cashier login nahi kar sakte. **Abhi baqi:** kuch routes (jaise product delete, sale return) sirf login dekhte hain, un ki alag permission check abhi nahi.
- **Paisa aur stock:** Rupay `Float` mein save hote hain, jabke plan integer paisa kehta hai. Stock "boxes + loose" mein hai, jabke plan "base units" kehta hai. Sale ki keemat aur discount client se aate hain aur server dobara hisaab nahi karta. Return ka refund amount bhi client bhejta hai, aur server check nahi karta ke bechi gayi miqdaar se zyada return na ho.
- **Missing:** Recovery codes, `safeStorage` encryption (abhi ek fixed key code mein likhi hai), duplicate invoice se bachne ka `clientRequestId`, stock ledger, split payment, About page, printer selection, docs (ARCHITECTURE, DESIGN_SYSTEM, CHANGELOG waghera).
- **Libraries (is round mein ho gaya):** Plan ki stack lag gayi hai: Prisma 7 + better-sqlite3 adapter, Tailwind 4, zod, otplib, vitest, aur Electron + electron-vite + electron-builder. Saare purane tests pass hain aur Linux par packaged app chal kar dekh liya gaya. Windows installer abhi aap ko apne Windows PC par bana kar check karna hai. Electron 42 rakha gaya hai kyun ke database driver abhi naye Electron ko support nahi karta (Note E dekhein).
- **Naya masla mila:** Purani 64 sales ki tareekh database mein alag format mein hai, is liye Sales History ki date filter unhein nahi dikhati. Theek karne ke liye data convert karna padega. Is ke liye aap ki ijazat chahiye.
- **Agla qadam:** Pehle ⚠️ security items (Phase 2 gaps). Har phase aap ki approval ke baad.

---

## Library stack (plan Section 1.2)

| Library | Plan | Before this round | After this round | Where it is used |
|---|---|---|---|---|
| Electron | required | `electron/main.ts`, `preload.ts` exist, but **no `electron` dependency** | ✅ **42.11.18** (see note E) | `electron/main.ts` (starts the API in-process, hardening), `electron/preload.ts` |
| electron-vite | required | missing | ✅ 6.0.0 | `electron.vite.config.ts` |
| electron-builder (NSIS) | required | missing | ✅ 26.18.0 | `electron-builder.yml` (`appId: com.pharmacarepro.desktop`) |
| Prisma 7 + `@prisma/adapter-better-sqlite3` | required | Prisma 6.19, no adapter | ✅ 7.10.1 + adapter 7.10.1 | `prisma/schema.prisma` (generator `prisma-client` → `server/generated/prisma`), `prisma.config.ts`, `server/database/prisma.ts`, `server/api.ts`, `server/invoice/invoiceSettings.ts` |
| better-sqlite3 | required | 11.10 | ✅ 12.11.1 (one shared copy with the adapter) | `server/database/db.ts`, `backup.ts`, Prisma adapter |
| Tailwind v4 + `@tailwindcss/vite` | required | Tailwind 3.4 + PostCSS + autoprefixer | ✅ 4.3.3 via `@tailwindcss/vite`; config moved to `@theme` in `src/index.css` | `vite.config.ts`, `electron.vite.config.ts`, `src/index.css`, 23 `src/**/*.tsx` files (class renames by the official codemod) |
| bcryptjs | required | 3.0.3 | ✅ unchanged | `server/security/passwords.ts` |
| otplib v12 | required | hand-written HMAC TOTP | ✅ 12.0.1 (RFC 6238 vectors verified) | `server/security/totp.ts` |
| qrcode | required | 1.5.4 | ✅ unchanged | `server/api.ts` (setup QR) |
| zod | required | missing | ✅ 4.6.7 | `server/validation/schemas.ts` → setup, logins, users, settings, developer settings, backup schedule, sales, shift reopen |
| lucide-react | required | 0.475 | ✅ unchanged (1.x is a new major; not in this round) | 24 files in `src/` |
| vitest | required | missing | ✅ 5.0.5, 28 unit tests | `vitest.config.ts`, `server/**/*.spec.ts`, `src/**/*.spec.ts` |
| JavaScript | plan says JS | TypeScript | ➖ kept TypeScript by owner decision | — |

**Note E — Electron version.** Prisma 7's adapter requires `better-sqlite3 ^12.6`. The newest published 12.x (12.11.1) has prebuilt binaries up to Electron 42 (ABI 146); compiling it for Electron 45 fails (`GetPrototypeV2`/`HolderV2` V8 changes). better-sqlite3 12.12.0 adds Electron 43 binaries on GitHub but is not on npm yet. Owner chose Electron 42 now; move to 43+ once better-sqlite3 12.12 is published. Electron 42 is outside Electron's 3-version security window; risk is limited because the window only loads the app's own loopback pages.

---

## Phase 0 — Audit and foundation

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 0.1 | `docs/ARCHITECTURE.md` | ❌ | Not present. `CLAUDE.md`/`GEMINI.md` cover part of it | Write it (folders, routes/IPC, models, pages) |
| 0.2 | Prisma works in dev **and packaged build** | ✅ (Linux) | `npm run build:unpack` → `release/linux-unpacked`; the packaged app served `/api/status`, settings via Prisma 7 and the renderer on 127.0.0.1. Windows NSIS build not run on this machine | Owner: run `npm run build:win` on Windows and smoke-test |
| 0.3 | Dependencies: zod, lucide-react, vitest; tailwind in devDeps | ✅ | All installed; tailwind and `@tailwindcss/vite` are devDependencies | — |
| 0.4 | Final `name`, `productName`, `appId` | 🟡 | `electron-builder.yml`: `appId: com.pharmacarepro.desktop`, `productName: PharmaCare Pro`. `name` still `pharmacy-management-system` | **Owner must confirm appId before the first client release** (it can never change) |
| 0.5 | Main-process layout `src/main/{db, migrate, session, permissions, audit, ipc, services, printing, backup}` | ⚠️ | Logic lives in one 3,900-line `server/api.ts` behind HTTP | Phase-0/2 decision: move the API into Electron main + IPC, or keep Express with a real session token |
| 0.6 | Shared IPC helper `handle(channel, permission, zodSchema, fn)` | ❌ | No IPC. Ad-hoc checks per route | Central `requirePermission` + zod middleware |
| 0.7 | `CHANGELOG.md` | ✅ | Created this round | — |
| 0.8 | Production hardening (no DevTools, menu, reload keys) | ✅ | `electron/main.ts`: `devTools: isDev`, `Menu.setApplicationMenu(null)`, F5/Ctrl+R/F12/Ctrl+Shift+I blocked when packaged, navigation locked to the app origin | — |

## Phase 1 — Database schema

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 1.1 | User: role, isActive, failedLoginCount, lockedUntil, email | 🟡 | `prisma/schema.prisma` User has role/status/lockout/email. No `createdById`; `password` is required (Developer gets a dummy hash) | Add `createdById`; nullable passwordHash for Developer |
| 1.2 | DeveloperAuth (secret, lastUsedTimeStep, setupCompletedAt) | 🟡 | One developer master key baked into the build (`server/security/developerKey.ts`); last accepted time step in `developer_totp_last_step`; `setup_completed` setting | `setupCompletedAt` timestamp |
| 1.3 | RecoveryCode | ❌ | Missing | Phase 2 |
| 1.4 | Policy (single row) | 🟡 | Key/value settings: `allow_admin_create_cashier/admin`, `allow_admin_edit/hide_store_identity`, `backup_retention_limit`, `backup_frequency`. **Missing:** `multiAdminEnabled`, `adminCanEditFooter`, `adminCanReopenShifts`, `cashierCanStartNewShiftSameDay` | Add the missing flags |
| 1.5 | StoreIdentity | 🟡 | `store_name`/`store_address`/`store_phone`/`drug_license_no` settings; no `updatedById` | Audit log already records changes; acceptable |
| 1.6 | DeveloperFooter (company, email, phone, website, message) | 🟡 | One free-text `developer_invoice_footer` | Structured fields if required |
| 1.7 | InvoiceSettings incl. printerName | 🟡 | Template, width, visibility flags ✅. **No printer name** | Phase 7 |
| 1.8 | BackupSettings | ✅ | `auto_backup_dir`, `secondary_backup_dir`, `backup_scheduled_time`, `last_*` | — |
| 1.9 | Product: unitsPerPack, allowOpenSale **default false**, minSaleQty, prices **in paisa**, stockBaseUnits | ⚠️ | `packing`, `allowOpenSale` **default 1 (true)**, prices `Float`, stock `stockBoxes + stockLoose` | Money → paisa migration; stock → base units; default false. Data-converting migration, needs your OK |
| 1.10 | StockMovement ledger | ❌ | Missing. Stock is mutated directly | Phase 4 |
| 1.11 | Customer | ✅ | Plus credit (khata) fields | — |
| 1.12 | Shift (all totals) | ✅ | `CashierShift` has full totals | Money is Float (see 1.9) |
| 1.13 | CashMovement (pay-in/out) | ❌ | Missing | Phase 5 (optional) |
| 1.14 | Invoice: status, **clientRequestId**, snapshots | 🟡 | `Sale` with identity/footer snapshots ✅. **No clientRequestId**; status `completed/returned/cancelled` | Phase 6 |
| 1.15 | InvoiceLine with saleMode, baseUnits, snapshots | 🟡 | `SaleItem` has name/code/unit snapshots and `isLoose`. Money is Float | — |
| 1.16 | Payment (split) | ❌ | One `paymentType` per sale | Phase 6 |
| 1.17 | Return / ReturnLine linked to original line | 🟡 | `SaleReturn`/`SaleReturnItem` linked to the sale, not the line | Phase 6 |
| 1.18 | AuditLog result `SUCCESS/DENIED/FAILED` | 🟡 | `SUCCESS/FAILED` only | Add `DENIED` |
| 1.19 | BackupRecord | ✅ | `backup_history` with type, status, verified, checksum, error | — |
| 1.20 | Migration rules (`prisma migrate`, runner `migrate.js`, backup before migrate) | ⚠️ | No migrations. Idempotent `ALTER TABLE` in `db.ts` + `prisma.ts`; no pre-migration backup | Introduce a migration runner with a pre-migration backup |
| 1.22 | Time stored as DateTime (one format) | ⚠️ | Mixed formats in the DB: Prisma 6 wrote integer ms, raw SQL wrote `YYYY-MM-DD HH:MM:SS`, Prisma 7 writes ISO text. `DATE(sale_date)` filters return NULL for the integer rows, so the **64 older sales are invisible to the Sales History date filter** | Data-converting migration to ISO text (needs owner OK, backup first) |
| 1.21 | No hard deletes for referenced records | ⚠️ | `prisma.user.delete` (`api.ts:1118`), `product.delete` (`:1983`), `company.delete` (`:1606`) | Soft-delete via `status`/`isActive` |

## Phase 2 — Security foundation

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 2.1 | Central permission matrix, **deny by default** | 🟡 | Every `/api` route now needs a login session (deny by default, public allow-list in `api.ts`). Permission checks added to users, roles, shift admin actions and stock zero. Other routes (e.g. product delete, sale return, purchases) still check only that someone is logged in | `requirePermission(key)` on every remaining route |
| 2.2 | Session only in main; renderer never sends userId/role | ✅ | Server-side sessions (`server/security/sessions.ts`): random bearer token, held in the API process (Electron main when packaged); `x-user-id` ignored; `user_id`/`admin_id` in bodies replaced by the session user. Logout, password reset/change and disabling revoke sessions | — |
| 2.3 | Nobody changes own role / escalation blocked | 🟡 | Blocked in user routes (Phase 2 tests). But `PUT /api/roles/:id` has no auth, so anyone can give the cashier role every permission | Covered by 2.1 |
| 2.4 | Setup wizard (8 steps incl. recovery codes, store identity, first Admin) | 🟡 | 7 steps: developer master-code unlock → store → first Admin (username + password) → backup folder/schedule → Admin permissions + policies → Demo/Full license → review. Permanent lock ✅ | Recovery codes |
| 2.5 | Developer login: email + TOTP, ±1 step, offline | ✅ | Fixed developer email + master key code, window ±1; phase1 tests | — |
| 2.6 | Reject reused TOTP codes (`lastUsedTimeStep`) | ✅ | `verifyDeveloperCode` stores the matched step and rejects ≤ it (setup unlock and login) | — |
| 2.7 | 5 failures → 15 min lockout, persisted | ✅ | `failed_login_attempts`, `locked_until` | — |
| 2.8 | TOTP secret encrypted with `safeStorage` (DPAPI) | ⚠️ | AES-GCM with a **hard-coded default seed** (`server/security/totp.ts:150`). Anyone with the DB file can decrypt | Electron `safeStorage` once the API runs in main |
| 2.9 | Developer recovery (recovery codes, re-enroll) + `docs/DEVELOPER_RECOVERY.md` | ❌ | Missing | Phase 2 |
| 2.10 | Admin/Cashier login, bcrypt, persistent lockout | ✅ | `server/security/passwords.ts` | — |
| 2.11 | Audit log, never secrets | ✅ | `server/security/audit.ts` redaction | — |
| 2.12 | Clock-rollback check (`lastSeenTime`) | 🟡 | Signed `license_last_seen_at`: demo days count from the highest time seen; a rollback over 10 min is audited (`LICENSE_CLOCK_ROLLBACK`). No UI warning yet | Warning banner |
| 2.13 | Developer Settings page, role-checked | ✅ | `/api/developer/*` check the role | — |

## Phase 3 — Design system and app shell

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 3.1 | `docs/DESIGN_SYSTEM.md` with HEX codes | ❌ | Missing | Write it (Appendix B palette) |
| 3.2 | Palette as Tailwind v4 `@theme` tokens; no hard-coded colors | ❌ | Tailwind 3. Components hard-code `slate`/`teal`/`#111827` | Tokens arrive with the Tailwind 4 upgrade (this round); the redesign pass is Phase 10 |
| 3.3 | Shared components (Button, Table, ConfirmDialog, Toast, …) | 🟡 | `Modal` exists. Many pages use `alert()`/`confirm()` | Phase 3/10 |
| 3.4 | Role-based navigation | 🟡 | Module flags per role (`useAuthStore`); not the exact plan menu | Phase 3 |
| 3.5 | About Software page | ❌ | Missing | Phase 3 |
| 3.6 | Min. resolution 1366×768 | ✅ | `electron/main.ts` minWidth 1024 / window 1366×820 | — |

## Phase 4 — Products and inventory with open-sale rules

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 4.1 | Product form: pack/base unit, unitsPerPack, allowOpenSale, minSaleQty, prices, barcode, reorder | ✅ | `MastersPage.tsx` | — |
| 4.2 | Shared `saleRules` used by cart, finalize, returns, adjustments | 🟡 | Open-sale and min-qty checks in `POST /api/sales` and returns. No shared module; quantities parsed as floats | Extract `saleRules.ts` and require integer quantities |
| 4.3 | Stock never negative | ⚠️ | Clamped with `Math.max(0, …)`, so overselling succeeds silently | Reject the sale when stock is insufficient |
| 4.4 | Price from product (pack/unit) | ⚠️ | Server trusts client `unit_price`, `gross_amount`, `discount_amount`, `net_amount` | Recompute every line server-side |
| 4.5 | Stock display "2 Box + 5 Tablets" | ✅ | boxes + loose | — |
| 4.6 | Stock adjustments with reason → ledger + audit | ❌ | Only stock-zero utility (unauthenticated) | Phase 4 |
| 4.7 | `allowOpenSale` change needs permission + audit | ⚠️ | `PUT /api/products/:id` unauthenticated | Covered by 2.1 |
| 4.8 | Unit tests for sale rules | ❌ | — | vitest (this round adds the runner) |

## Phase 5 — Cashier shifts

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 5.1 | One open shift per cashier | ✅ | `POST /api/shifts/start` | — |
| 5.2 | Sell only in **own** open shift | ⚠️ | Shift found by `user_id` from the request body | Use the session user |
| 5.3 | Close: expected = opening + cash sales − cash refunds; difference; confirm | ✅ | `ShiftClosingModal.tsx`, close route | — |
| 5.4 | Closed shift never reopened by cashier; writes to closed shift rejected | ✅ | Writes rejected; reopen/correct/force-close need `can_manage_shifts` and audit the session user | — |
| 5.5 | `cashierCanStartNewShiftSameDay` policy | ❌ | Missing | Phase 5 |
| 5.6 | Reopen/correct only Developer or permitted Admin, reason, audited | ⚠️ | Reason ✅, audit ✅, but `admin_id`/`admin_name` from the body (`api.ts:3520`) | Session identity + policy flag |
| 5.7 | Unit tests for shift calculations | ❌ | Integration test only | vitest |

## Phase 6 — POS, shortcuts, payments, returns

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 6.1 | Barcode scan into search + Enter | ✅ | `PosPage.tsx` | — |
| 6.2 | Pack/Unit selector; validated on add and at finalize | 🟡 | Validated at finalize; add is client-side only | Optional add-line check |
| 6.3 | Discount needs permission; Admin max discount | ⚠️ | `max_bill_discount_pct` enforced only in the UI | Enforce server-side |
| 6.4 | Split payments (cash/card/other) | ❌ | One payment type | Phase 6 |
| 6.5 | Finalize in one transaction | ✅ | `prisma.$transaction` | — |
| 6.6 | `clientRequestId` → repeated F9 returns the same invoice | 🟡 | UI lock (`isSubmittingRef`, `e.repeat`) only; no server idempotency | Add `client_request_id` unique column |
| 6.7 | Returns ≤ sold qty; follow unit rules; restock; current shift | ⚠️ | Unit rules ✅, shift ✅. **No check against the sold quantity**; refund amount from the client | Validate against the original line and compute the refund server-side |
| 6.8 | Shortcuts F2, F3, F4, F6, F8, F9, F10, Esc | ✅ | `PosPage.tsx:198-240` | — |
| 6.9 | F10 must not open the Electron/Windows menu | ✅ | `Menu.setApplicationMenu(null)` in `electron/main.ts` | Verify on Windows |

## Phase 7 — Thermal invoices, printing, identity, footer

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 7.1 | Thermal only; three designs × 58/80 mm | ✅ | `UnifiedInvoice.tsx` (classic/compact/detailed); A3/A4/A5 rejected (phase3 tests) | Naming: plan says "Standard" for our "Classic" |
| 7.2 | Silent print in hidden window, printer chosen from installed list | ❌ | `window.print()`; `print:thermal` IPC unused; no printer list | Phase 7 |
| 7.3 | Invoice settings preview, default, width, persistence | ✅ | `SettingsPage.tsx` | — |
| 7.4 | Visibility toggles don't affect calculations | ✅ | Display only | — |
| 7.5 | Footer always printed; Admin edits only if `adminCanEditFooter` | 🟡 | Always printed ✅, Developer-only ✅. No grant flag | Add the flag |
| 7.6 | Store name/address protected unless granted | ✅ | Phase 3 hide/edit locks, server-enforced | — |
| 7.7 | Reprints use snapshots; policy documented | ✅ | `*_snapshot` columns; GEMINI.md | — |
| 7.8 | Tested on a real thermal printer | ❌ | Not possible here | Owner hardware test |

## Phase 8 — Admin panel

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 8.1 | Shift management columns + filters + drill-down | ✅ | `ShiftHistoryHub.tsx`, `ShiftsAdminPage.tsx` | — |
| 8.2 | User management rules (Developer/Admin grants, no escalation) | 🟡 | Enforced on user routes ✅; `multiAdminEnabled` missing; roles routes unauthenticated | 2.1 + 1.4 |
| 8.3 | Dashboard: today's sales, active shifts, low stock, last backup | 🟡 | Sales, low stock ✅, Backup Health ✅. No active-shifts count | Add a card |
| 8.4 | Developer Settings: policies, identity, footer | ✅ | `DeveloperSettingsPage.tsx` | — |

## Phase 9 — Backup, scheduler, restore

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 9.1 | Developer: retention N ≥ 1, frequency | 🟡 | ✅ N, but frequencies are Off/12h/Daily/Weekly; plan wants **Daily / Every 2 days / Every 3 days / Weekly** | Add 2- and 3-day options |
| 9.2 | Admin: time of day + destination | ✅ | `PUT /api/backups/schedule`, folders in Utilities | — |
| 9.3 | Temp file → integrity_check → rename → record → prune only after success | ✅ | `server/database/backup.ts` (phase4 tests) | — |
| 9.4 | Secondary destination with its **own** retention | 🟡 | Copies go with the primary's retention | Separate pruning per destination |
| 9.5 | Scheduler every minute, one catch-up | ✅ | `server/backup/scheduler.ts` | — |
| 9.6 | Destination unavailable → failed + warning, nothing deleted | ✅ | Phase 4 tests | — |
| 9.7 | Dashboard warning if last success older than two intervals | 🟡 | Shows Overdue/Failed, not "2 intervals" | Adjust rule |
| 9.8 | Restore: integrity check ✅, **reject newer app version**, pre-restore ✅, close DB, remove `-wal/-shm`, relaunch, run migrations | ⚠️ | Copies over the **open** DB file (`backup.ts` `restoreDatabase`); risk of corruption | Close connections, swap the file, remove WAL/SHM, relaunch |
| 9.9 | `docs/BACKUP_RECOVERY.md` | 🟡 | `docs/DISASTER_RECOVERY_GUIDE.md` exists; no Developer-recovery-on-new-PC section | Extend |
| 9.10 | Full restore tested on another PC | ❌ | Not possible here | Owner test |

## Phase 10 — Redesign, testing, release

| # | Requirement | Status | Evidence / gap | Proposed fix |
|---|---|---|---|---|
| 10.1 | Design system applied everywhere | ❌ | Depends on 3.x | Phase 10 |
| 10.2 | vitest unit tests (rules, pricing, shifts, retention, scheduler, TOTP) | 🟡 | vitest runs 28 specs (scheduler, invoice rules, TOTP, passwords, schemas, UI helpers). No specs yet for sale rules / shift totals (that logic is still inside `api.ts`) | Add specs when `saleRules.ts` is extracted |
| 10.3 | `TEST_PLAN.md`, `TEST_REPORT.md` | ❌ | Missing | Phase 10 |
| 10.4 | Upgrade test, NSIS installer, `extraResources` migrations | ❌ | No packaging yet | After Electron tooling (this round) |

---

## Appendix A — Permission matrix (server-side enforcement)

| Action | Plan | Current | Status |
|---|---|---|---|
| Developer Settings | Dev only | Dev only | ✅ |
| Edit store name/address | Dev; Admin if granted | Same | ✅ |
| Hide store name/address | Dev; Admin if granted | Same | ✅ |
| Edit developer footer | Dev; Admin if granted | Dev only (no grant flag) | 🟡 |
| Create Cashier / Admin | Grants + multi-admin | Grants ✅, no multi-admin flag | 🟡 |
| Reset passwords | Dev; Admin cashiers if granted | Dev reset ✅; `change-password` unauthenticated | ⚠️ |
| Products / inventory | Dev, Admin; Cashier view | **No server check** | ⚠️ |
| Change open-sale setting | Dev, Admin | **No server check** | ⚠️ |
| Sell / returns | Own open shift | Shift from body `user_id`; no auth | ⚠️ |
| Discount | Permission | UI only | ⚠️ |
| View all shifts | Dev, Admin; Cashier own | **No server check** | ⚠️ |
| Reopen/correct shift | Dev; Admin if granted | **No server check** | ⚠️ |
| Invoice settings | Dev, Admin (protected excluded) | Server-checked (Phase 3) | ✅ |
| Backup retention/frequency | Dev | Dev | ✅ |
| Backup time/destination | Dev, Admin | `can_backup` | ✅ |
| Manual backup / Restore | Dev, Admin | `can_backup` / `can_restore` | ✅ |
| Audit log | Dev; Admin read-only | Dev only | 🟡 |

## Appendix C — Final acceptance checklist

| Item | Status |
|---|---|
| Prisma confirmed in packaged build | ✅ Linux unpacked build; Windows NSIS pending owner test |
| Color scheme + `DESIGN_SYSTEM.md` | ❌ |
| Closed shifts not reopenable by cashiers; admins review all | ✅ |
| Whole app redesigned | ❌ |
| Open-sale restrictions in every path and backend | 🟡 (finalize ✅, returns ✅, prices client-trusted) |
| Shortcuts safe; no duplicate invoices | 🟡 (no server idempotency) |
| Developer info in software and on every invoice | 🟡 (invoice ✅, About page ❌) |
| Only 58/80 mm templates; preview and default persist | ✅ |
| Invoice toggles don't affect calculations | ✅ |
| Developer role, protected page, permissions, audit log | 🟡 (login required everywhere; per-route permissions on part of the routes) |
| Store identity protected unless granted | ✅ |
| First-run wizard with email + verified TOTP; cannot rerun | ✅ (only the developer master key unlocks it) |
| Every Developer login needs current TOTP, offline | ✅ (replay blocked) |
| Backup retention, schedule, failure handling, restore tested | 🟡 (restore swap unsafe) |
| Regression and upgrade tests | 🟡 (regression ✅, upgrade ❌) |

## Appendix D — Known conflicts

| # | Conflict | Status |
|---|---|---|
| D1 | Invoice formats → 3 designs × 58/80 | ✅ (Classic/Compact/Detailed) |
| D2 | Backup count → one N, never delete on failure | ✅ |
| D3 | "Software owner" = Developer role | ✅ |
| D4 | TOTP secret in backups → DPAPI + recovery codes | ⚠️ hard-coded key, no recovery codes |
| D5 | Email is an identifier only, offline | ✅ |
| D6 | F10 vs window menu | ✅ (menu removed; verify on Windows) |
| D7 | Unavailable destination → failed, nothing deleted | ✅ |

---

## Recommended order for the next phases (each needs your approval)

0. **Dates (1.22):** normalize stored dates so the Sales History date filter sees all sales.
1. **Security (Phase 2 gaps):** ~~session token instead of `x-user-id`~~ (done), `requirePermission` on the remaining routes, ~~body `user_id`/`admin_id` replaced by the session~~ (done), ~~TOTP replay block~~ (done), encryption key via `safeStorage`.
2. **Sales integrity (Phase 4/6):** server-side pricing and discount cap, stock-insufficient rejection, return-quantity limits, `clientRequestId`.
3. **Restore safety (Phase 9.8)** and soft deletes (1.21).
4. **Money → paisa, stock → base units:** data-converting migration with a backup and a dry run on a copy.
5. Recovery codes, policy flags, About page, printer selection, docs, design system.

---

## Round log

| Date | Round | Result |
|---|---|---|
| 2026-10-24 | Audit + plan-stack library upgrade | Gap report written. Libraries upgraded (table above). Verified: `npm run lint` clean, `npm test` 28/28, `npm run build` OK, `test:phase1-4` + `test:functional` 98/98, packaged Linux app smoke-tested, `npm audit` 0 vulnerabilities (body-parser patched via `npm audit fix`). No phase gaps fixed yet — waiting for owner approval. |
| 2026-10-24 | Test hygiene | `server/tests/phase2_test.ts` called `pruneBackupsByRetentionLimit(30)` on the real `backups/` folder; every run trimmed it to 30 backups (some of the oldest 2026-10-21 `auto_daily` test-period backups were deleted and cannot be recovered). Now prunes an empty temp folder. Still open: Phase 2 and functional suites write test users/sales into `data/pharmacy.db`, and Phase 2 sets `backup_retention_limit` to 45 (a real prune if more than 45 backups exist). |
| 2026-10-24 | Developer-controlled install, demo license, server sessions (owner's `future-feature.txt`) | Setup unlocks only with the developer master key (built into the exe, `npm run developer:key`); developer creates the Admin + password, backup folder/time, Admin permissions, Demo (N days) or Full. Signed license with clock-rollback protection; expired demo locks Admin/Cashier. Bearer-token sessions replace `x-user-id`; TOTP replay blocked; no default staff passwords on fresh installs. Integration suites now run on a temp copy of the DB. Packaging fix: stale `.forge-meta` made electron-builder ship the Node build of better-sqlite3. Verified: lint, `npm test` 41/41, build, phase1–5 + functional 110/110, packaged Linux app (fresh install gated, runtime key ignored). |
