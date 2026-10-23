# Pharmacy POS — Audit-First, Phase-wise Implementation Plan

> Offline Pharmacy Management Software for Windows (Electron + React + Prisma + SQLite)
> Full client requirements: `docs/REQUIREMENTS.md`
> Progress tracking: `docs/PROGRESS.md` (created and maintained by the agent)

---

## 0. READ FIRST — Instructions for the AI agent

**Context:** This project has already been partly built by an AI agent. The owner does not know exactly
which features exist, which are incomplete, and which are missing. Your job in every phase is to
**audit first, then fill only the gaps**.

Rules:
1. Work on **one phase at a time**, only when the owner says "Run Phase X".
2. **Never assume** a feature exists or is missing. Search the code: Prisma schema, migrations,
   IPC channels, preload API, services, React pages and components, settings files.
3. Give every requirement in the phase one status:
   - ✅ **Done**: code exists, works, and passes the phase's verification checks.
   - 🟡 **Partial**: exists but incomplete.
   - ⚠️ **Done but wrong/insecure**: e.g. restriction only in the UI, money stored as float, data-loss risk.
   - ❌ **Missing**.
   - ➖ **Not applicable**: explain why.
4. **Skip only ✅ items.** A feature that only hides a button but has no backend check is NOT done (⚠️).
5. **Reuse existing code.** Do not build a second version of something that exists (second backup system,
   second auth system, duplicate tables). Names in this plan are suggestions; adapt to existing names.
6. Do not refactor working code only for style.
7. Follow the migration rules (Section 5) for every database change.
8. **Ask the owner before:** deleting files, destructive or data-converting migrations, major version
   upgrades, adding libraries not listed in Section 2, or changing behaviour described in the requirements.
9. Explain reports to the owner in simple **Roman Urdu**. Code, comments and UI text stay in **English**.
10. Update `docs/PROGRESS.md` at the end of every phase.

---

## 1. Mandatory workflow for EVERY phase

**Step 0 — Safety point**
- Make sure the project is a git repository. If not, run `git init`.
- Commit the current state: `git commit -am "Before Phase X"` (add untracked files first).

**Step 1 — Audit**
- For each requirement ID in the phase, search the code and collect evidence
  (file paths, function names, IPC channels, Prisma models, components).
- Run the app (`npm run dev`) when needed to confirm behaviour.

**Step 2 — Gap report (then STOP)**
Show a table to the owner:

| ID | Requirement | Status | Evidence (files) | Planned action |
|---|---|---|---|---|

Also list: library changes needed, migrations needed (with reason), questions.
**Stop and wait for the owner's OK** before changing code.

**Step 3 — Implement**
- Work only on ❌, 🟡 and ⚠️ items, in the order listed.
- Keep changes small and focused.

**Step 4 — Verify**
- Run every check in the phase's "Verification" section.
- Run `npm run lint`, `npm run build`, and unit tests (`npx vitest run`) if they exist.
- Confirm previously working features still work.

**Step 5 — Report**
- Final table with updated statuses, files changed, migrations created, test results, remaining issues.
- Update `docs/PROGRESS.md`. Commit: `git commit -am "Phase X complete"`.

---

## 2. Dependency and version policy

### 2.1 Required libraries
| Package | Purpose | Type | Needed from |
|---|---|---|---|
| electron, electron-vite, electron-builder, vite, @vitejs/plugin-react | Desktop app, build, installer | dev | Phase 0 |
| react, react-dom | UI | dev (bundled by Vite) | Phase 0 |
| @electron-toolkit/preload, @electron-toolkit/utils | Template helpers | dependency | Phase 0 |
| tailwindcss, @tailwindcss/vite | Styling (Tailwind v4) | **dev** | Phase 0 |
| prisma | Prisma CLI | dev | Phase 0 |
| @prisma/client, @prisma/adapter-better-sqlite3 | Prisma 7 client + SQLite adapter | dependency | Phase 0 |
| better-sqlite3 | SQLite driver, backups, migration runner | dependency | Phase 0 |
| bcryptjs | Password hashing | dependency | Phase 2 |
| otplib (v12 API) | TOTP 2FA | dependency | Phase 2 |
| qrcode | TOTP QR code | dependency | Phase 2 |
| zod | Input validation in main process | dependency | Phase 0 |
| lucide-react | Icons | dev (bundled) | Phase 3 |
| vitest | Unit tests for business logic | dev | Phase 0 |
| dotenv | Only if `prisma.config.ts` loads `.env` | dev | Phase 0 |
| electron-updater | Auto-update (optional) | dependency | Ask owner |

No extra libraries are needed for printing (Electron `webContents.print`), scheduling (timers),
or secret encryption (Electron `safeStorage`).

### 2.2 Procedure (Phase 0, and whenever a phase needs a library)
1. Run `npm ls --depth=0` and `npm outdated`. Record results in `docs/PROGRESS.md`.
2. Install any missing required library from 2.1 with the correct type (dependency/dev).
3. Move packages to the correct section if misplaced (e.g. Tailwind must be in devDependencies).
4. **Patch/minor updates:** allowed if the app still runs and tests pass.
5. **Major updates:** ask the owner first, read the library's migration guide, update all affected code.
6. **Prisma:** `prisma`, `@prisma/client` and `@prisma/adapter-better-sqlite3` must have the **same version**.
   After any Prisma change run `npx prisma generate` and test the app.
7. **Native modules:** after changing `electron` or `better-sqlite3`, run `npx electron-builder install-app-deps`.
8. **otplib:** keep the v12 API. Upgrading to a newer major changes the API; only do it with owner approval
   and after updating and testing all TOTP code.
9. Remove unused packages only after confirming there are no imports, and with owner approval.
10. After any dependency change confirm: `npm run dev`, `npm run build`, `npm run build:unpack` all work.

---

## 3. Architecture rules (non-negotiable)

- The **main process** owns the database, authentication, permissions, business rules, printing and backups.
- The **renderer** is UI only: `contextIsolation: true`, `nodeIntegration: false`, no direct DB or Node access.
- IPC only through the preload API (`window.api`). Every handler returns
  `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
- Every IPC input is validated in main (`zod`).
- The session (current user id and role) lives **only in main**. The renderer never sends `userId` or `role`.
- Every protected handler checks permissions centrally (e.g. `requirePermission('<key>')`). **Deny by default.**
- UI hiding/disabling is never the security control; the backend check is.
- Production build: DevTools disabled, reload shortcuts (Ctrl+R, F5) disabled, default menu removed.

If the existing project uses a different but equivalent pattern, keep it and note it in the report.

---

## 4. Data conventions

- **Money:** integers in **paisa** (1 PKR = 100 paisa). No floats for money.
- **Stock:** integers in **base units** (tablet, capsule, ml…). Packs are derived via `unitsPerPack`.
- **Time:** stored as DateTime; displayed in local time (Asia/Karachi).
- **No hard deletes** for records referenced by invoices (products, users, customers): use `isActive`.
- **Snapshots:** invoice lines store product name, barcode, unit and price at sale time; invoices store
  a snapshot of store identity and developer footer.

If existing code stores money as Float/Decimal, mark ⚠️ and propose a safe conversion migration
(multiply by 100 and round) **for owner approval**, tested on a copy of real data.

---

## 5. Migration rules

- Create with `npx prisma migrate dev --create-only --name <name>`, **show and review the SQL**, then apply.
- New columns must be optional (`?`) or have `@default(...)`.
- Column rename: replace generated SQL with `ALTER TABLE "X" RENAME COLUMN "a" TO "b";` (Prisma would drop data).
- Never edit or delete a migration that has already been released to a client. Never use `prisma db push`.
- Client databases are upgraded by the app's own migration runner (`src/main/migrate.js` or equivalent):
  backup first → apply pending migrations in transactions (foreign keys OFF outside the transaction,
  `PRAGMA foreign_key_check` inside) → record applied names.
- Migrations folder must be shipped via electron-builder `extraResources`.
- `appId` and `productName` must never change after the first client release.
- Before applying a schema change, test it on a **copy of a real client backup** when available.

---

## 6. `docs/PROGRESS.md` template (create in Phase 0, update every phase)

```markdown
# Project Progress
Last updated: <date>

## Phase status
| Phase | Status | Date | Notes |
|---|---|---|---|

## Requirement status
| ID | Status | Evidence | Notes |
|---|---|---|---|

## Dependency log
| Package | Old version | New version | Reason | Verified |
|---|---|---|---|---|

## Migrations log
| Migration | Purpose | SQL reviewed | Data-safe | Tested on real data copy |
|---|---|---|---|---|

## Decisions and open questions
-
```

---

## Phase 0 — Full audit, dependencies and baseline

**Goal:** know exactly what exists, fix the foundation, and give the owner a full picture.

| ID | Requirement |
|---|---|
| P0.1 | Git repository exists; baseline commit made. |
| P0.2 | `docs/REQUIREMENTS.md` exists (owner provides the client document). |
| P0.3 | `docs/ARCHITECTURE.md` describes the current project: folders, Prisma models, IPC channels, pages, roles, existing features. |
| P0.4 | Dependency audit done per Section 2; missing libraries installed; misplaced ones moved; versions recorded. |
| P0.5 | App runs with `npm run dev`; `npm run build:unpack` works; Prisma queries work in the unpacked build (this answers Requirement 1: Prisma compatibility). |
| P0.6 | Shared IPC pattern with standard response shape and zod validation (keep existing equivalent if present). |
| P0.7 | Security baseline from Section 3 (context isolation, no node integration, production lockdown). |
| P0.8 | Migration runner exists, ships migrations via `extraResources`, and creates a backup before migrating. |
| P0.9 | Final `name`, `productName`, `appId` set (ask owner for the final names). |
| P0.10 | `docs/PROGRESS.md` created with a **quick status of every requirement ID in Phases 1–10** (high-level scan), so the owner sees the whole picture. |
| P0.11 | `vitest` configured with at least one passing sample test. |

**Verification:** dev and unpacked build start; a Prisma read and write works in the unpacked build;
`npm run lint` passes or remaining issues are listed.

---

## Phase 1 — Database schema

**Goal:** one coherent schema for all features. Compare the existing schema with the capabilities below;
add only what is missing using safe migrations. Existing data must be preserved.

| ID | Capability (adapt names to existing schema) |
|---|---|
| P1.1 | **User**: name, username (unique), optional email, role (`DEVELOPER`/`ADMIN`/`CASHIER`), passwordHash (nullable for Developer), isActive, failedLoginCount, lockedUntil, createdById, timestamps. |
| P1.2 | **DeveloperAuth**: userId, email, encrypted TOTP secret, lastUsedTimeStep, setupCompletedAt. |
| P1.3 | **RecoveryCode**: userId, codeHash, usedAt. |
| P1.4 | **Policy** (Developer-controlled, single row): adminCanCreateCashiers, adminCanCreateAdmins, multiAdminEnabled, adminCanEditStoreIdentity, adminCanHideStoreIdentity, adminCanEditFooter, adminCanReopenShifts, cashierCanStartNewShiftSameDay, backupRetentionCount, backupFrequency. |
| P1.5 | **StoreIdentity** (single row): storeName, address, phone, licenseNo, updatedById, updatedAt. |
| P1.6 | **DeveloperFooter** (single row): companyName, supportEmail, phone, website, message. |
| P1.7 | **InvoiceSettings** (single row): templateId, paperWidthMm (58/80), printerName, field visibility flags, terms, custom footer text, return policy text. |
| P1.8 | **BackupSettings**: destination, optional secondary destination, scheduledTime (HH:mm), lastScheduledRunAt. |
| P1.9 | **Product**: name, genericName, barcode, packUnit, baseUnit, unitsPerPack (≥1, default 1), allowOpenSale (default false), minSaleQty (default 1), packPrice, unitPrice (nullable), costPrice, stockBaseUnits, reorderLevel, isActive. |
| P1.10 | **StockMovement** ledger: productId, change (base units), reason (SALE/RETURN/ADJUSTMENT/PURCHASE/OPENING), reference, userId, note, createdAt. |
| P1.11 | **Customer**: name, phone. |
| P1.12 | **Shift**: shiftNo (unique), cashierId, status (OPEN/CLOSED), openedAt, closedAt, openingCash, expectedCash, countedCash, difference, totals at close, notes, closedById. |
| P1.13 | **CashMovement** (optional pay-in/pay-out in a shift). |
| P1.14 | **Invoice**: invoiceNo (unique), shiftId, cashierId, customerId, status, clientRequestId (unique, idempotency), totals, received, change, storeIdentitySnapshot, footerSnapshot, timestamps. |
| P1.15 | **InvoiceLine**: product snapshots, saleMode (PACK/UNIT), qty, baseUnits, unitPrice, discount, tax, lineTotal. |
| P1.16 | **Payment**: invoiceId, method (CASH/CARD/OTHER), amount. |
| P1.17 | **Return / ReturnLine**: original invoice/line, current shift, qty, baseUnits, refund, reason, userId. |
| P1.18 | **AuditLog**: actorUserId, action, target, details (no secrets), result (SUCCESS/DENIED/FAILED), createdAt. |
| P1.19 | **BackupRecord**: filePath, destination, size, trigger, status, verified, error, timestamps. |
| P1.20 | Money stored as integers (Section 4). |
| P1.21 | Defaults for existing data: existing products get unitsPerPack = 1, allowOpenSale = false; existing users mapped to ADMIN/CASHIER. |

**Verification:** every migration's SQL reviewed (no drops of data columns); migration applied to a copy of
real data with record counts unchanged; migration runner applies it in an unpacked build.

---

## Phase 2 — Security: roles, permissions, setup wizard, Developer TOTP, audit log

| ID | Requirement |
|---|---|
| P2.1 | Central permission system implementing **Appendix A**; policy flags control conditional Admin permissions; deny by default. |
| P2.2 | No user can change their own role or grant themselves Developer rights. Admin/Cashier can never view or change Developer credentials. |
| P2.3 | **First-run wizard** when no completed Developer setup exists: welcome → Developer email (validated) → TOTP QR + manual key → verify code → show 10 one-time recovery codes (store hashes only) → store name and address → create first Admin → finish. |
| P2.4 | After setup completes, all setup handlers reject; ordinary users cannot rerun setup. |
| P2.5 | **Developer login:** email + current TOTP code; works offline; no email sending; ±1 time step window. |
| P2.6 | Reused codes rejected (`lastUsedTimeStep`). |
| P2.7 | 5 failed attempts → 15-minute lockout, **stored in the database** (survives restart). Generic error messages. |
| P2.8 | TOTP secret encrypted with Electron `safeStorage`; never in plain files, logs, IPC responses or the Admin panel. |
| P2.9 | **Recovery:** email + unused recovery code → re-enroll TOTP, new recovery codes, old ones invalidated, audited. Also used when the secret cannot be decrypted (e.g. restore on a new PC). No master password or backdoor. Documented in `docs/DEVELOPER_RECOVERY.md`. |
| P2.10 | Admin/Cashier login: username + password (bcrypt), persistent lockout. Keep existing Admin TOTP if present. |
| P2.11 | Audit log service used for all sensitive actions; never logs passwords, codes or secrets. |
| P2.12 | Clock check: if the system time moves back more than 5 minutes compared to the last seen time, warn and audit (TOTP and shifts depend on correct time). Document that PC time must be accurate. |
| P2.13 | Developer Settings page visible only to Developer; its handlers check the role on the backend. |

**Verification:** fresh install shows the wizard; wizard cannot be reopened after completion; Developer login
works with network disabled; wrong, expired and reused codes rejected; lockout survives restart; recovery
works; Developer handlers called as Admin/Cashier return access denied and create audit entries.

---

## Phase 3 — Design system and app shell

| ID | Requirement |
|---|---|
| P3.1 | `docs/DESIGN_SYSTEM.md` (the required color-scheme artifact): palette with HEX codes (Appendix B as a starting point), primary/secondary, backgrounds, text, button and status colors, typography, spacing. |
| P3.2 | Palette implemented as Tailwind v4 theme tokens (`@theme`); no hard-coded colors in components. |
| P3.3 | Shared components: Button variants (save, edit, delete, cancel, print, primary, secondary), Input, Select, Checkbox, Table, Modal, ConfirmDialog, Toast, Badge, EmptyState, loading state, PageHeader, Sidebar, TopBar. |
| P3.4 | Role-based navigation — Cashier: Sales, My Shift. Admin: Dashboard, Products, Inventory, Sales History, Returns, Shifts, Users (if permitted), Invoice Settings, Backup, About. Developer: all Admin pages + Developer Settings. |
| P3.5 | About Software page: software name, version, developer info (from DeveloperFooter), contact, website, copyright. |
| P3.6 | Text contrast meets WCAG AA (4.5:1); layout works at 1366×768 and above. |

**Verification:** pages use the shared components and tokens; screenshots at 1366×768 and 1920×1080.

---

## Phase 4 — Products and inventory with open-sale rules

| ID | Requirement |
|---|---|
| P4.1 | Product form: pack unit, base unit, units per pack, allow open sale, minimum sale quantity, pack price, unit price (required when open sale is allowed), cost price, barcode, reorder level. |
| P4.2 | Live explanation in the form, e.g. "1 Box = 24 Tablets; selling 3 tablets reduces stock by 3". |
| P4.3 | Shared validation in main (e.g. `services/saleRules.js`) used by cart, finalize, returns and adjustments. |
| P4.4 | PACK mode: integer qty ≥ 1 → baseUnits = qty × unitsPerPack. |
| P4.5 | UNIT mode only when allowOpenSale; qty ≥ minSaleQty → baseUnits = qty. |
| P4.6 | allowOpenSale = false: UNIT mode rejected with a clear message; baseUnits must be a multiple of unitsPerPack. |
| P4.7 | Stock can never go negative; prices in paisa; correct price for pack vs unit. |
| P4.8 | Stock displayed as packs + loose units (e.g. "2 Box + 5 Tablets"). |
| P4.9 | Stock adjustments with reason → StockMovement + audit log. |
| P4.10 | Changing allowOpenSale requires permission and is audited. |
| P4.11 | Fast search by name, generic name, barcode. |

**Verification:** example 6.2 (box of 24, sell 3 tablets → stock −3) passes; example 6.3 (open sale = No)
blocked via UI **and** direct IPC call; unit tests for the sale rules.

---

## Phase 5 — Cashier shifts

| ID | Requirement |
|---|---|
| P5.1 | Start shift records start time and opening cash; one open shift per cashier (checked in a transaction). |
| P5.2 | Sales and returns require an open shift owned by the current user (backend check). |
| P5.3 | Close shift: counted cash entered; expected cash = opening + cash sales − cash refunds ± cash movements; difference calculated; closing time, totals and duration stored; confirmation dialog. |
| P5.4 | Closed shift can never be reopened by a cashier; all writes linked to a closed shift rejected in main. |
| P5.5 | No bypass via refresh, logout/login or restart (state in DB). After a crash, the same open shift resumes. |
| P5.6 | Starting a new shift after closing follows `cashierCanStartNewShiftSameDay`. |
| P5.7 | Exceptional reopen/correction only by Developer, or Admin if granted; mandatory reason; audited. |

**Verification:** bypass tests (refresh, re-login, restart, direct IPC); duration and difference correct;
unit tests for shift calculations.

---

## Phase 6 — POS sales screen, shortcuts, payments, returns

| ID | Requirement |
|---|---|
| P6.1 | Clear layout: search + cart left; customer, totals, payment right; shortcut bar visible. |
| P6.2 | Barcode scanner input (keyboard wedge) adds products on Enter. |
| P6.3 | Quantity with Pack/Unit selector; Unit disabled when not allowed, and main still validates. |
| P6.4 | Validation when a line is added and again at finalize. |
| P6.5 | Discounts require permission; Admin-configurable maximum. |
| P6.6 | Payments: cash, card, other, split payments, change calculation. |
| P6.7 | Finalize in a single transaction: verify open shift, revalidate lines and stock, create invoice/lines/payments/stock movements, save snapshots. |
| P6.8 | Idempotency: unique `clientRequestId`; repeated F9 never creates duplicate invoices. |
| P6.9 | Returns against original invoice: not more than sold, respects unit rules, restocks, recorded in current shift, refunds affect expected cash. |
| P6.10 | Shortcuts: F2 new invoice, F3 product search, F4 customer, F6 discount (permission), F8 payment, F9 finalize, F10 print, Esc close/cancel where safe. |
| P6.11 | Shortcuts don't interfere with typing; disabled behind open modals (except Esc); F10 must not activate a window menu. |
| P6.12 | Clear success, error and confirmation messages. |

**Verification:** complete a sale using only the keyboard; press F9 rapidly → one invoice; open-sale
restriction holds for search, scanning, manual entry and shortcuts; return flow updates stock and shift.

---

## Phase 7 — Thermal invoices, invoice settings, printing, store identity, footer

| ID | Requirement |
|---|---|
| P7.1 | Only thermal templates: three designs (Compact, Standard, Detailed) × 58 mm and 80 mm. **Remove A3/A4/A5** from templates and the selection UI. |
| P7.2 | One invoice data model rendered by all templates; long text wraps within printable width (~48 mm on 58 mm paper, ~72 mm on 80 mm; verify on the real printer). |
| P7.3 | Printing via hidden window + `webContents.print` (silent, selected printer, no margins, correct page width). Printer chosen in settings. |
| P7.4 | Invoice Settings: preview each template, choose default template, width and printer, live preview, saved persistently. |
| P7.5 | Visibility toggles for all optional fields in Requirement 9.2; hiding never changes stored data or calculations. |
| P7.6 | **Developer footer** printed on every template; Admin cannot hide/edit it unless granted. One configuration used by all templates. |
| P7.7 | **Store name and address** always printed; Admin cannot edit or hide unless granted. Enforced in main's rendering, not only the UI. |
| P7.8 | Reprints use the invoice's stored snapshots with the current template layout; policy documented. |
| P7.9 | Developer can edit store identity and footer in Developer Settings; changes audited. |

**Verification:** all six variants previewed and printed on a real thermal printer; footer and store identity
cannot be removed as Admin, including through direct IPC calls; reprint of an old invoice shows its original data.

---

## Phase 8 — Admin panel: shifts, users, dashboard

| ID | Requirement |
|---|---|
| P8.1 | Shift Management page columns: cashier name and ID, shift number, start, close, duration, opening cash, total sales, cash/card/other totals, expected cash, counted cash, shortage/excess, status. |
| P8.2 | Filters: cashier, date range, status. Shift detail view with invoices, returns and cash movements. |
| P8.3 | Developer can create, edit, deactivate Admin/Cashier accounts and reset their passwords. |
| P8.4 | Admin creates Cashiers only if granted; creates Admins only if granted and multi-admin enabled. |
| P8.5 | Role escalation blocked; Developer credentials untouchable by others; all actions audited (actor, target, action, time, result). |
| P8.6 | Dashboard: today's sales, active shifts, low stock, last backup status. |
| P8.7 | Developer Settings: policy toggles (Appendix A conditions). |

**Verification:** filters work; unauthorized account actions denied by the backend and audited.

---

## Phase 9 — Backup, scheduler, restore, disaster recovery

Build on the existing backup code; do not create a second system.

| ID | Requirement |
|---|---|
| P9.1 | Developer sets retention count N (minimum 1) and frequency (Daily, Every 2 days, Every 3 days, Weekly). Admin cannot change them unless granted. |
| P9.2 | Admin sets the time of day (HH:mm) and destination folder(s) only. |
| P9.3 | Backup uses the SQLite online backup API to a temp file → `PRAGMA integrity_check` → rename to final name → BackupRecord. |
| P9.4 | Retention applied **only after a successful, verified backup**: keep latest N successful backups. A failed backup deletes nothing. |
| P9.5 | Optional secondary destination (e.g. Google Drive folder + USB) with its own copy and retention. |
| P9.6 | Local offline scheduler: checks every minute; runs at Admin time per Developer frequency; if missed (PC off/app closed), runs **one** catch-up backup at next start. |
| P9.7 | Destination unavailable → backup marked failed with a clear warning; existing backups untouched. |
| P9.8 | Status UI: last backup time/result/location, next scheduled time, retained count, error messages; dashboard warning if last success is older than two intervals. |
| P9.9 | Manual backup button. |
| P9.10 | Restore (permission-based): choose file → integrity check → refuse backups from a newer app version → pre-restore backup → close DB → replace file and remove `-wal/-shm/-journal` → relaunch → migration runner upgrades older backups. Audited. Confirmation dialog. |
| P9.11 | `docs/BACKUP_RECOVERY.md`: installing on a new PC, restoring, scheduler behaviour, Developer recovery after restore on a new PC, recommendation for off-site/cloud copy. |
| P9.12 | Backups contain sensitive data: recommend a private folder. Optional encrypted backups only with owner approval. |

**Verification:** with N = 4 only the latest four successful backups remain; a forced failure deletes nothing;
schedule runs at the set time; missed run handled once; full restore tested on another PC or virtual machine.

---

## Phase 10 — Redesign pass, full testing, release

| ID | Requirement |
|---|---|
| P10.1 | Every page uses the design system: consistent spacing, labels, empty, loading and error states, confirmations. Cashier screens kept simple. |
| P10.2 | Unit tests: sale rules, pricing, shift totals, backup retention, scheduler next-run, TOTP replay and lockout. |
| P10.3 | `docs/TEST_PLAN.md` and `docs/TEST_REPORT.md` covering Requirement 5.2 and the addendum test list (first install, Developer login valid/wrong/expired/reused/lockout/offline/recovery). |
| P10.4 | Unauthorized-path tests: call protected IPC handlers directly as Cashier and Admin. |
| P10.5 | Upgrade test: install the previous release, add data, install the new build → data intact, migrations applied. |
| P10.6 | Release: version bumped, CHANGELOG updated, NSIS installer built, migrations included, `appId` unchanged. |
| P10.7 | Every item in Appendix C checked. |

---

## Appendix A — Permission matrix

| Action | Developer | Admin | Cashier |
|---|---|---|---|
| Developer Settings | Yes | No | No |
| Edit store name/address | Yes | If granted | No |
| Hide store name/address on invoice | Yes | If granted | No |
| Edit developer footer | Yes | If granted | No |
| Create Cashier | Yes | If granted | No |
| Create Admin | Yes | If granted + multi-admin | No |
| Reset Admin/Cashier passwords | Yes | Cashiers, if granted | No |
| Change Developer credentials | Yes (self) | No | No |
| Products / inventory | Yes | Yes | View only |
| Change open-sale setting | Yes | Yes | No |
| Sell / returns | Yes | Yes | Yes (own open shift) |
| Discount | Yes | Yes | Only with permission |
| View all shifts | Yes | Yes | Own shift only |
| Reopen / correct shift | Yes | If granted | No |
| Invoice settings | Yes | Yes (protected fields excluded) | No |
| Backup retention / frequency | Yes | No | No |
| Backup time / destination | Yes | Yes | No |
| Manual backup / restore | Yes | Yes | No |
| Audit log | Yes | Read only | No |

---

## Appendix B — Proposed color palette (light theme, starting point)

| Token | HEX | Usage |
|---|---|---|
| primary | #0F766E | Main actions, Save, active navigation |
| primary-hover | #115E59 | Primary hover |
| primary-soft | #CCFBF1 | Selected rows, highlights |
| secondary | #1E3A5F | Print button, headers |
| secondary-hover | #172E4B | Secondary hover |
| background | #F8FAFC | App background |
| surface | #FFFFFF | Cards, tables, dialogs |
| surface-muted | #F1F5F9 | Table headers, sidebar |
| border | #E2E8F0 | Borders, dividers |
| text | #0F172A | Main text |
| text-secondary | #475569 | Labels |
| text-muted | #64748B | Hints, placeholders |
| success / success-soft | #15803D / #DCFCE7 | Success, Active status |
| warning / warning-soft | #B45309 / #FEF3C7 | Warnings, low stock |
| danger / danger-soft | #B91C1C / #FEE2E2 | Delete, errors, shortage |
| info / info-soft | #1D4ED8 / #DBEAFE | Edit, information |

Buttons: Save = primary, Edit = info, Delete = danger, Cancel = white with #CBD5E1 border and #334155 text,
Print = secondary. If the project already has a palette, compare it with this and propose the final one.

---

## Appendix C — Final acceptance checklist

- [ ] Prisma confirmed and working in the packaged build.
- [ ] Consistent color scheme; `docs/DESIGN_SYSTEM.md` with HEX codes.
- [ ] Closed shifts cannot be reopened by cashiers; admins can review all shifts with filters.
- [ ] Whole application redesigned for clarity.
- [ ] Open-sale restrictions enforced in every sales path and in the backend.
- [ ] Keyboard shortcuts work safely; no duplicate invoices.
- [ ] Developer info in the software and on every invoice; not hideable by Admin.
- [ ] Only 58 mm and 80 mm thermal templates; preview and default selection persist.
- [ ] Invoice field toggles do not affect calculations or stored data.
- [ ] Developer role, protected settings page, permissions and audit log working.
- [ ] Store identity protected unless the Developer grants permission.
- [ ] First-run wizard with Developer email + verified TOTP; cannot be rerun.
- [ ] Every Developer login requires a current TOTP code and works offline.
- [ ] Backup retention, schedule, failure handling and restore tested.
- [ ] All existing features still work; regression and upgrade tests passed.

---

## Appendix D — Known requirement conflicts and chosen resolutions

1. **Invoice formats:** main document mentions standard/detailed invoices; addendum allows thermal only.
   → Three designs (Compact, Standard, Detailed), each for 58 mm and 80 mm. No A3/A4/A5.
2. **Backup count:** "minimum copies" vs "maximum to retain".
   → One Developer setting N: keep the latest N successful verified backups; never delete when a new backup fails.
3. **"Software owner" configures developer info** → the Developer role.
4. **TOTP secret must not be exposed in backups** vs full database backups.
   → Secret encrypted with Windows DPAPI (`safeStorage`), unreadable on another PC; after restore on a new PC, the Developer re-enrolls with a recovery code.
5. **Developer email** is only an identifier; login never depends on email delivery or internet.
6. **F10** may activate the window menu on Windows → menu removed/overridden and tested.
7. **Unavailable backup destination** → backup marked failed with warning; existing backups untouched; secondary destination used if configured.
