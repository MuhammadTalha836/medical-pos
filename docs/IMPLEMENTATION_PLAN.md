# Pharmacy POS — Phase-wise Implementation Plan

> Offline Pharmacy Management Software (Windows desktop)
> Source requirements: `docs/REQUIREMENTS.md` (main document + addendum)

---

## 0. How to use this document (instructions for the AI agent)

1. Read this whole file and `docs/REQUIREMENTS.md` before writing any code.
2. Work on **one phase at a time**. At the end of each phase **stop** and report:
   - files created/changed,
   - migrations created (with their SQL reviewed),
   - test results,
   - open questions.
   Then wait for approval before starting the next phase.
3. Never remove or break existing features. After each phase, re-check previously working flows.
4. If a requirement conflicts with the architecture, **do not silently change behaviour**.
   Document the conflict and propose a secure alternative (see Appendix D for known conflicts).
5. Explain summaries to the owner in simple **Roman Urdu**. Code, comments and UI text stay in **English**.
6. Prefer simple, readable JavaScript. Do not add libraries beyond Section 1.2 without asking.

---

## 1. Project context

### 1.1 Product
Offline pharmacy POS for a single Windows PC. Roles: **Developer**, **Admin**, **Cashier**.
Must keep working with no internet. Data must survive PC failure via backups.

### 1.2 Tech stack (fixed)
| Area | Choice |
|---|---|
| Desktop shell | Electron + electron-vite |
| UI | React (JavaScript) + Tailwind CSS v4 (`@tailwindcss/vite`) |
| Database | SQLite via Prisma 7 + `@prisma/adapter-better-sqlite3` + `better-sqlite3` |
| Auth | `bcryptjs` (passwords), `otplib` v12 (TOTP), `qrcode` |
| Validation | `zod` (main process) |
| Icons | `lucide-react` |
| Tests | `vitest` for pure business logic |
| Packaging | electron-builder, Windows NSIS installer |

### 1.3 Architecture rules (non-negotiable)
- The **main process** owns the database, authentication, permissions, business rules, printing and backups.
- The **renderer** is UI only. `contextIsolation: true`, `nodeIntegration: false`. No direct DB or Node access.
- All communication via IPC: preload exposes `window.api`. Every handler returns
  `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
- Every IPC input is validated in main with `zod`.
- The current session (user id + role) lives **only in main**. The renderer never sends `userId` or `role`.
- Every protected handler calls a central `requirePermission('<key>')`. **Deny by default.**
- Hiding/disabling a button is never the security control. The backend check is.
- Production build: disable reload shortcuts (Ctrl+R, F5), DevTools, and the default menu.

### 1.4 Data conventions
- **Money:** integers in **paisa** (1 PKR = 100 paisa). Never floats. Format only in the UI.
- **Stock:** integers in **base units** (tablet, capsule, ml…). Packs are derived via `unitsPerPack`.
- **Time:** store as DateTime (UTC); display in local time (Asia/Karachi).
- **No hard deletes** for records referenced by invoices (products, users, customers). Use `isActive`.
- **Snapshots:** invoice lines store product name, barcode, unit and price at time of sale.
  Invoices store a snapshot of store identity and developer footer.

### 1.5 Migration rules
- Create migrations with `npx prisma migrate dev --create-only --name <name>`, **review the SQL**, then apply.
- New columns must be optional (`?`) or have `@default(...)`.
- Renaming a column: replace generated SQL with `ALTER TABLE ... RENAME COLUMN ...` (Prisma otherwise drops data).
- Never edit or delete a migration that has been released. Never use `prisma db push`.
- Client databases are updated by the app's own migration runner (`src/main/migrate.js`):
  backup first → apply pending migrations in transactions → record them.
- `appId` and `productName` must not change after the first client release.

---

## 2. Phase overview

| Phase | Name | Main requirement sections |
|---|---|---|
| 0 | Audit and foundation | 1 |
| 1 | Database schema | 1, 3, 6, 9, Addendum 2 |
| 2 | Security: roles, permissions, setup wizard, Developer TOTP, audit log | Addendum 2, 3 |
| 3 | Design system and app shell | 2, 5.1, 8.1 |
| 4 | Products and inventory with open-sale rules | 6 |
| 5 | Cashier shifts | 3 |
| 6 | POS sales screen, keyboard shortcuts, payments, returns | 6, 7 |
| 7 | Thermal invoice templates, invoice settings, printing, store identity, footer | 8, 9, Addendum 1, 2.3, 2.4 |
| 8 | Admin panel: shift management, user management, dashboard | 4, Addendum 2.2 |
| 9 | Backup, scheduler, restore, disaster recovery | 5.3, Addendum 2.1, 3.4 |
| 10 | Full redesign pass, testing, release | 5, 10, Addendum 4 |

---

## Phase 0 — Audit and foundation

**Goal:** understand the current project and prepare a clean base.

Tasks:
- Inspect the existing code. Write `docs/ARCHITECTURE.md`: folders, IPC channels, models, pages, existing features.
- Confirm Prisma 7 + SQLite + better-sqlite3 adapter works in dev and in a packaged build (`npm run build:unpack`).
  This is the answer to Requirement 1 (“confirm whether we can use Prisma”).
- Dependencies: move `tailwindcss` and `@tailwindcss/vite` to devDependencies; add `zod`, `lucide-react`;
  add `vitest` (dev). Ask before adding anything else.
- Set final `name`, `productName`, `appId`.
- Organise main process code:
  `src/main/{db.js, migrate.js, session.js, permissions.js, audit.js, ipc/, services/, printing/, backup/}`.
- Create a shared IPC helper (`handle(channel, permissionKey, zodSchema, fn)`).
- Create `CHANGELOG.md`.

Acceptance:
- [ ] App runs in dev and as an unpacked build with Prisma working.
- [ ] Architecture document written.
- [ ] No existing feature broken.

---

## Phase 1 — Database schema

**Goal:** one coherent schema for all features. Existing data must be preserved (defaults for new fields).

Models (adjust names to existing code where they already exist):

- **User**: id, name, username (unique), email (optional, unique), role (`DEVELOPER | ADMIN | CASHIER`),
  passwordHash (nullable for Developer), isActive, failedLoginCount, lockedUntil, createdById, createdAt, updatedAt.
- **DeveloperAuth**: userId (unique), email, totpSecretEncrypted, lastUsedTimeStep, setupCompletedAt.
- **RecoveryCode**: id, userId, codeHash, usedAt.
- **Policy** (single row, Developer-controlled): adminCanCreateCashiers, adminCanCreateAdmins, multiAdminEnabled,
  adminCanEditStoreIdentity, adminCanHideStoreIdentity, adminCanEditFooter, adminCanReopenShifts,
  cashierCanStartNewShiftSameDay, backupRetentionCount, backupFrequency.
- **StoreIdentity** (single row): storeName, address, phone, licenseNo, updatedById, updatedAt.
- **DeveloperFooter** (single row): companyName, supportEmail, phone, website, message, updatedAt.
- **InvoiceSettings** (single row): templateId, paperWidthMm (58 | 80), printerName, field visibility flags, termsText, customFooterText, returnPolicyText.
- **BackupSettings** (single row): destinationPath, secondaryDestinationPath, scheduledTime (HH:mm), lastScheduledRunAt.
- **Product**: id, name, genericName, barcode (unique, nullable), packUnit (BOX/STRIP/BOTTLE/…), baseUnit (TABLET/CAPSULE/ML/…),
  unitsPerPack (int ≥ 1, default 1), allowOpenSale (default false), minSaleQty (int, base units, default 1),
  packPrice (paisa), unitPrice (paisa, nullable, required if allowOpenSale), costPrice (paisa), stockBaseUnits (int),
  reorderLevel, isActive, timestamps.
- **StockMovement** (ledger): id, productId, changeBaseUnits (+/−), reason (`SALE | RETURN | ADJUSTMENT | PURCHASE | OPENING`),
  refType, refId, userId, note, createdAt.
- **Customer**: id, name, phone, createdAt.
- **Shift**: id, shiftNo (unique, human-readable), cashierId, status (`OPEN | CLOSED`), openedAt, closedAt,
  openingCash, expectedCash, countedCash, difference, totals at close (sales, cash, card, other, refunds), notes, closedById.
- **CashMovement** (optional pay-in/pay-out within a shift): id, shiftId, amount, type, reason, userId, createdAt.
- **Invoice**: id, invoiceNo (unique), shiftId, cashierId, customerId, status (`FINALIZED | VOID`),
  clientRequestId (unique, idempotency), grossTotal, discountTotal, taxTotal, netTotal, received, change,
  storeIdentitySnapshot (JSON), footerSnapshot (JSON), createdAt, finalizedAt.
- **InvoiceLine**: id, invoiceId, productId, nameSnapshot, barcodeSnapshot, saleMode (`PACK | UNIT`), qty, baseUnits,
  unitPrice, discount, tax, lineTotal.
- **Payment**: id, invoiceId, method (`CASH | CARD | OTHER`), amount.
- **Return** / **ReturnLine**: link to original invoice and line, shiftId (current shift), qty, baseUnits, refund amount, reason, userId.
- **AuditLog**: id, actorUserId, action, targetType, targetId, details (JSON, never secrets), result (`SUCCESS | DENIED | FAILED`), createdAt.
- **BackupRecord**: id, filePath, destination, sizeBytes, trigger (`MANUAL | SCHEDULED | PRE_MIGRATION | PRE_RESTORE`),
  status (`SUCCESS | FAILED`), verified, error, startedAt, finishedAt.

Rules:
- "One open shift per cashier" is enforced in the service layer inside a transaction (do not rely on custom indexes that Prisma might drop later).
- Existing products get `unitsPerPack = 1`, `allowOpenSale = false`. Existing users are mapped to ADMIN/CASHIER.

Acceptance:
- [ ] Migration SQL reviewed; no column drops or data loss.
- [ ] Migration applied to a **copy of real data** without losing records.
- [ ] Migration runner applies it correctly on a packaged build.

---

## Phase 2 — Security foundation

**Goal:** roles, permissions, first-run setup, Developer TOTP login, audit log.

### 2.1 Permissions
- Implement the matrix in **Appendix A** in `permissions.js`. Policy flags make some Admin permissions conditional.
- Nobody can change their own role. Admin/Cashier can never create, edit or see Developer credentials.

### 2.2 First-run setup wizard
Shown when no completed `DeveloperAuth` exists. Steps:
1. Welcome.
2. Developer email (validated format).
3. TOTP setup: QR code + manual key (Google Authenticator compatible).
4. Verify a valid code.
5. Show **10 one-time recovery codes** once (print/save). Store only hashes.
6. Store identity: name and address (Requirement Addendum 2.3).
7. Create the first Admin account.
8. Finish → set `setupCompletedAt`.

After completion, all setup IPC handlers reject. The wizard cannot be rerun by Admin/Cashier.

### 2.3 Developer login
- Email + current TOTP code. No password, no email sending, works offline.
- Accept ±1 time step. Store `lastUsedTimeStep`; reject reused codes.
- 5 failed attempts → 15 minute lockout, **persisted in the DB** (survives restart).
- Generic error messages ("Invalid email or code").
- TOTP secret encrypted with Electron `safeStorage` (Windows DPAPI). Never in plain config files, logs, IPC responses or the Admin panel.

### 2.4 Developer recovery
- Email + one unused recovery code → re-enroll a new TOTP secret, issue new recovery codes, invalidate old ones, write audit log.
- If `safeStorage` cannot decrypt the secret (e.g. database restored on a new PC), show the recovery flow.
- No master password, no hidden backdoor. Document in `docs/DEVELOPER_RECOVERY.md`.

### 2.5 Admin and Cashier login
- Username + password (bcrypt). Persistent lockout after repeated failures. Keep existing optional TOTP for Admin if present.

### 2.6 Audit log and clock check
- `audit.js` service used by every sensitive action. Never log passwords, codes or secrets.
- Store `lastSeenTime`; if the system clock goes back by more than 5 minutes, show a warning and log it (affects TOTP and shift times).

### 2.7 Developer Settings page (skeleton)
- Route visible only to Developer; handlers check the role. Later phases add sections to it.

Acceptance:
- [ ] Fresh install shows the wizard; finished setup cannot be rerun.
- [ ] Developer login works offline; wrong, expired and reused codes are rejected; lockout survives restart.
- [ ] Recovery works and is documented.
- [ ] Calling Developer IPC handlers as Admin/Cashier returns access denied and is audited.

---

## Phase 3 — Design system and app shell

**Goal:** professional, consistent look (Requirement 2) and a clear navigation structure (Requirement 5.1).

Tasks:
- Write `docs/DESIGN_SYSTEM.md` (the required color-scheme artifact): palette with HEX codes (Appendix B),
  typography, spacing, button variants, status colors, table and form styles.
- Implement the palette as Tailwind v4 theme tokens (`@theme` in the main CSS). No hard-coded colors in components.
- Reusable components: Button (save, edit, delete, cancel, print, primary, secondary), Input, Select, Checkbox,
  Table, Modal, ConfirmDialog, Toast, Badge, EmptyState, Spinner/Skeleton, PageHeader, Sidebar, TopBar.
- Role-based navigation:
  - Cashier: Sales, My Shift.
  - Admin: Dashboard, Products, Inventory, Sales History, Returns, Shifts, Users (if permitted), Invoice Settings, Backup, About.
  - Developer: everything Admin has + Developer Settings.
- About Software page (Requirement 8.1): name, version, developer info from `DeveloperFooter`, copyright.
- Minimum supported resolution: 1366×768.

Acceptance:
- [ ] Design document delivered with HEX codes.
- [ ] Text contrast at least WCAG AA (4.5:1).
- [ ] All shared components used by new pages.

---

## Phase 4 — Products and inventory with open-sale rules

**Goal:** Requirement 6.1–6.4.

Product form fields: sale pack unit, base unit, units per pack, allow open sale, minimum sale quantity,
pack price, unit price (required when open sale is allowed), cost price, barcode, reorder level.
Show a live explanation, e.g. "1 Box = 24 Tablets. Selling 3 tablets reduces stock by 3 tablets (3/24 box)."

Shared validation in main (`services/saleRules.js`) used by cart, finalize, returns and adjustments:
- `PACK` mode: qty is an integer ≥ 1 → baseUnits = qty × unitsPerPack.
- `UNIT` mode: only if `allowOpenSale`; qty integer ≥ `minSaleQty` → baseUnits = qty.
- If `allowOpenSale = false`: baseUnits must be a multiple of `unitsPerPack`; UNIT mode is rejected with a clear message.
- Stock must never go negative.
- Price: PACK uses `packPrice`, UNIT uses `unitPrice`. All in paisa.

Other tasks:
- Stock shown as "2 Box + 5 Tablets".
- Stock adjustments with reason → StockMovement + audit log.
- Changing `allowOpenSale` requires permission `products.editOpenSale` and is audited.
- Fast search by name, generic name and barcode.

Acceptance:
- [ ] Example 6.2 (24 tablets, sell 3 → stock −3) passes.
- [ ] Example 6.3 (open sale = No) is blocked in every path, including direct IPC calls.
- [ ] Unit tests for `saleRules.js`.

---

## Phase 5 — Cashier shifts

**Goal:** Requirement 3.

Rules:
- Start shift: records `openedAt` and opening cash. One open shift per cashier.
- A cashier cannot sell without an open shift owned by them (checked in main on every sale/return).
- Close shift: cashier enters counted cash; system computes
  expected cash = opening cash + cash sales − cash refunds ± cash movements; difference = counted − expected.
  Records `closedAt`, totals and duration. Confirmation dialog before closing.
- A closed shift can never be reopened by a cashier. All writes referencing a closed shift are rejected in main.
- State is in the DB, so refresh, logout/login or restart cannot bypass it. If the app crashes during an open shift, the same open shift resumes.
- Starting another shift after closing depends on policy `cashierCanStartNewShiftSameDay`.
- Exceptional reopen/correction: only Developer, or Admin when `adminCanReopenShifts` is granted. Mandatory reason. Audited.

Acceptance:
- [ ] Bypass tests: refresh, logout/login, app restart, direct IPC call.
- [ ] Duration and cash difference correct.
- [ ] Unit tests for shift calculations.

---

## Phase 6 — POS sales screen, shortcuts, payments, returns

**Goal:** fast, clear cashier workflow (Requirements 5.1, 6, 7).

Layout: product search + cart on the left; customer, totals, payment on the right; shortcut bar at the bottom.

Sales:
- Barcode scanners act as keyboards: scanning into the search field + Enter adds the product.
- Quantity with mode selector (Pack/Unit). Unit is disabled when open sale is not allowed, **and** main still validates.
- Validate when a line is added (IPC) and again at finalize.
- Discounts need permission `sales.discount`; Admin-configurable maximum discount.
- Payments: cash, card, other; split payments; change calculation.

Finalize (single DB transaction):
1. Verify the user has an open shift.
2. Re-validate every line with `saleRules.js` and current stock.
3. Create invoice, lines, payments, stock movements; decrement stock; save snapshots.
4. `clientRequestId` is unique → pressing F9 twice returns the same invoice instead of creating a duplicate.

Returns: against an original invoice; cannot exceed sold quantity; follows the product's unit rules; restocks;
recorded in the current shift; cash refunds reduce expected cash.

Keyboard shortcuts:
| Key | Action |
|---|---|
| F2 | New invoice |
| F3 | Focus product search |
| F4 | Focus customer field |
| F6 | Discount (permission) |
| F8 | Payment section |
| F9 | Finalize (validated, no duplicates) |
| F10 | Print invoice |
| Esc | Close dialog / cancel where safe |

- Central keyboard handler; shortcuts disabled while a modal is open (except Esc).
- Check that F10 does not activate a Windows/Electron menu; remove or override the menu if needed.
- Shortcuts must not interfere with typing in inputs.

Acceptance:
- [ ] Full sale using keyboard only.
- [ ] No duplicate invoice on repeated F9.
- [ ] Open-sale restriction holds for search, scanning, manual entry and shortcuts.

---

## Phase 7 — Thermal invoices, settings, printing, store identity, footer

**Goal:** Requirements 8, 9 and Addendum 1, 2.3, 2.4.

Templates (thermal only, **no A3/A4/A5**):
- Three designs: **Compact**, **Standard**, **Detailed**, each for **58 mm** and **80 mm**.
- One invoice data model rendered by all templates.
- Typical printable width: about 48 mm on 58 mm paper and about 72 mm on 80 mm paper. Verify on the real printer.
  Do not label a template 58/80 mm until tested at that width.

Printing:
- Render receipt HTML in a hidden window; print with `webContents.print({ silent: true, deviceName, margins: none, pageSize: { width, height } })`.
- Printer chosen in settings from the list of installed printers.

Invoice Settings (Admin):
- Preview each template; select default template, paper width and printer; live preview.
- Visibility checkboxes for all optional fields in Requirement 9.2. Hiding changes visibility only, never calculations or stored data.
- Persistent across restarts.

Protected content (enforced in main's render function, not only the UI):
- **Developer footer** always printed on every template. Admin cannot hide or edit it unless `adminCanEditFooter`.
- **Store name and address** always printed. Admin cannot edit/hide them unless the Developer grants permission.
- Long text wraps within the printable width.
- One footer configuration used by all templates (no hard-coding per template).

Reprints: use the invoice's stored snapshots (store identity, footer, lines) with the current template layout. Document this policy.

Acceptance:
- [ ] Six template variants previewed and printed on a real thermal printer.
- [ ] Footer and store identity cannot be removed by Admin, including via direct IPC.
- [ ] Reprints show historical data correctly.

---

## Phase 8 — Admin panel

**Goal:** Requirement 4 and Addendum 2.2.

Shift Management page:
- Columns: cashier name and ID, shift number, start, close, duration, opening cash, total sales,
  cash/card/other totals, expected cash, counted cash, shortage/excess, status badge.
- Filters: cashier, date range, status. Open a shift to see its invoices, returns and cash movements.

User Management:
- Developer: create/edit/deactivate Admin and Cashier accounts and reset their passwords.
- Admin: create Cashiers only if `adminCanCreateCashiers`; create Admins only if `adminCanCreateAdmins` and `multiAdminEnabled`.
- No one except the Developer can change Developer credentials. Role escalation is blocked.
- All actions audited (actor, target, action, time, result).

Dashboard: today's sales, active shifts, low stock, last backup status.

Developer Settings additions: policy toggles, store identity, developer footer.

Acceptance:
- [ ] All columns and filters work.
- [ ] Unauthorized account actions are denied by the backend and audited.

---

## Phase 9 — Backup, scheduler, restore, disaster recovery

**Goal:** Requirement 5.3 and Addendum 2.1, 3.4. Build on the existing `backup.js`.

Settings:
- Developer: retention count N (minimum 1), frequency (Daily, Every 2 days, Every 3 days, Weekly).
- Admin: time of day only (HH:mm), destination folder(s). Admin cannot change N or frequency unless granted.

Backup algorithm:
1. Create backup with the SQLite online backup API to a temporary file in the destination.
2. Run `PRAGMA integrity_check`. On success rename to the final name; on failure delete the temp file.
3. Write a BackupRecord.
4. **Only after success**, delete the oldest managed backups beyond N. If the backup failed, delete nothing.
5. Optional secondary destination (e.g. Google Drive folder + USB) gets its own copy and retention.

Scheduler (local, offline):
- Check every minute. Compute the next run from frequency, Admin time and last scheduled run.
- If the PC was off or the app closed at the scheduled time: run **one** catch-up backup at next start.
- If the destination is unavailable: mark failed, show a clear warning; do not delete existing backups.

Status UI: last backup time/result/location, next scheduled time, number of retained backups, error messages.
Dashboard warning when the last successful backup is older than two intervals.

Restore (Admin/Developer, permission `backup.restore`):
- Choose file → integrity check → refuse if the backup was made by a newer app version →
  pre-restore backup → close DB → replace file, remove `-wal/-shm/-journal` → relaunch → migration runner updates older backups. Audited.

Protection: backups contain password hashes and the encrypted TOTP secret. Recommend a private folder.
Optional encrypted backups (ask before implementing; a lost backup password means an unusable backup).

Docs: `docs/BACKUP_RECOVERY.md` — install on a new PC, restore a backup, scheduler behaviour, Developer recovery after restore on a new PC.

Acceptance:
- [ ] With N = 4, only the latest four successful backups remain.
- [ ] A failed backup never deletes existing backups.
- [ ] Daily schedule runs at the Admin's time; missed run handled once.
- [ ] Full restore tested on a different PC or virtual machine.

---

## Phase 10 — Redesign pass, testing, release

Redesign:
- Apply the design system to every remaining page. Consistent spacing, labels, empty states, loading states, errors and confirmations.

Testing:
- Unit tests (vitest): sale rules, pricing, shift totals, retention, scheduler next-run, TOTP replay/lockout.
- `docs/TEST_PLAN.md` and `docs/TEST_REPORT.md` covering Requirement 5.2 and Addendum 3.3/4:
  pages and navigation, products, inventory, sales, discounts, payments, returns, shifts and restrictions,
  permissions, invoice printing and settings, backup/restore, shortcuts, input validation,
  first install, Developer login (valid, wrong, expired, reused, lockout, offline, recovery).
- Unauthorized paths: call protected IPC handlers directly as Cashier/Admin in dev.
- Upgrade test: install the previous version, add data, install the new version → data intact, migrations applied.

Release:
- Bump version, update CHANGELOG, build NSIS installer, migrations included in `extraResources`, `appId` unchanged.

Acceptance: every item in Appendix C is checked.

---

## Appendix A — Permission matrix

| Action | Developer | Admin | Cashier |
|---|---|---|---|
| Developer Settings | Yes | No | No |
| Edit store name/address | Yes | Only if granted | No |
| Hide store name/address on invoice | Yes | Only if granted | No |
| Edit developer footer | Yes | Only if granted | No |
| Create Cashier | Yes | Only if granted | No |
| Create Admin | Yes | Only if granted + multi-admin | No |
| Reset Admin/Cashier password | Yes | Cashiers only if granted | No |
| Change Developer credentials | Yes (self) | No | No |
| Products / inventory | Yes | Yes | View only |
| Change open-sale setting | Yes | Yes | No |
| Sell / returns | Yes | Yes | Yes (own open shift) |
| Discount | Yes | Yes | Only with permission |
| View all shifts | Yes | Yes | Own shift only |
| Reopen/correct shift | Yes | Only if granted | No |
| Invoice settings | Yes | Yes (protected fields excluded) | No |
| Backup retention / frequency | Yes | No | No |
| Backup time / destination | Yes | Yes | No |
| Manual backup | Yes | Yes | No |
| Restore | Yes | Yes | No |
| Audit log | Yes | Read only | No |

---

## Appendix B — Proposed color palette (light theme)

| Token | HEX | Usage |
|---|---|---|
| primary | #0F766E | Main actions, Save, active nav |
| primary-hover | #115E59 | Hover for primary |
| primary-soft | #CCFBF1 | Selected rows, highlights |
| secondary | #1E3A5F | Print button, headers |
| secondary-hover | #172E4B | Hover for secondary |
| background | #F8FAFC | App background |
| surface | #FFFFFF | Cards, tables, dialogs |
| surface-muted | #F1F5F9 | Table header, sidebar |
| border | #E2E8F0 | Borders, dividers |
| text | #0F172A | Main text |
| text-secondary | #475569 | Labels, secondary text |
| text-muted | #64748B | Hints, placeholders |
| success | #15803D | Success messages, Active badge |
| success-soft | #DCFCE7 | Success background |
| warning | #B45309 | Warnings, low stock |
| warning-soft | #FEF3C7 | Warning background |
| danger | #B91C1C | Delete, errors, shortage |
| danger-soft | #FEE2E2 | Error background |
| info | #1D4ED8 | Edit button, info messages |
| info-soft | #DBEAFE | Info background |

Buttons: Save = primary, Edit = info, Delete = danger, Cancel = white with border #CBD5E1 and text #334155, Print = secondary.
Shift status: Active = success, Closed = text-muted gray badge.

---

## Appendix C — Final acceptance checklist

- [ ] Prisma integration confirmed and working in packaged build.
- [ ] Consistent color scheme applied; `docs/DESIGN_SYSTEM.md` with HEX codes delivered.
- [ ] Closed shifts cannot be reopened by cashiers; admins can review all shifts.
- [ ] Whole application redesigned for clarity.
- [ ] Open-sale restrictions enforced in every sales path and in the backend.
- [ ] Keyboard shortcuts work safely; no duplicate invoices.
- [ ] Developer info in the software and on every invoice; cannot be hidden by Admin.
- [ ] Only 58 mm and 80 mm thermal templates; preview and default selection persist.
- [ ] Invoice field toggles work without affecting calculations.
- [ ] Developer role, protected settings page, permissions and audit log working.
- [ ] Store identity protected unless the Developer grants permission.
- [ ] First-run wizard with Developer email + verified TOTP; cannot be rerun.
- [ ] Every Developer login needs a current TOTP code and works offline.
- [ ] Backup retention, schedule, failure handling and restore tested.
- [ ] All existing features still work; regression and upgrade tests passed.

---

## Appendix D — Known requirement conflicts and chosen resolutions

1. **Invoice formats:** the main document asks for standard/detailed invoices; the addendum allows thermal only.
   → Three designs (Compact, Standard, Detailed), each for 58 mm and 80 mm. No A3/A4/A5.
2. **Backup count:** "minimum copies to retain" vs "maximum backups to retain".
   → One Developer setting N: keep the latest N successful, verified backups; never delete when a new backup fails.
3. **"Software owner" configures developer info** → this is the Developer role.
4. **TOTP secret must not be exposed in backups** vs full database backups.
   → Secret stored encrypted with Windows DPAPI (`safeStorage`); unreadable on another PC. After restore on a new PC, the Developer re-enrolls using a recovery code.
5. **Developer email** is an identifier only; login never depends on email delivery or internet.
6. **F10** may activate the window menu on Windows → menu removed/overridden and tested.
7. **Unavailable backup destination** → backup marked failed with a warning; existing backups untouched; secondary destination used if configured.
