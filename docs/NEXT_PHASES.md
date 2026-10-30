# Next Phases: gaps found in the docs audit (A–E)

On 2026-10-27 every doc in `docs/` was compared with the code at commit `58fec9e`:
- `FEATURE_ROADMAP.md`
- `IMPLEMENTATION_PLAN.md`
- `IMPLEMENTATION_PLAN1.md`
- `PHASE_REQUIREMENTS.md`
- `PROGRESS.md`
- `PROJECT_GUIDE.md`
- `future-feature.txt`

M1–M11 and Phases 1–8 are almost all built. This file lists what is still missing or only half built, as phases, plus the owner's new request: **Print Quotation** (C8).

> **Roman Urdu:** Docs ki har requirement ko code se mila kar dekha gaya. Jo cheezein abhi system mein nahi hain ya adhoori hain, wo yahan phases mein likhi hain. Owner ki nayi request **Print Quotation** (C8) bhi isi mein shamil hai.

Each phase follows the same steps as `FEATURE_ROADMAP.md`:
1. Plan it in detail.
2. Build it.
3. Test it.
4. Report in Roman Urdu + English.
5. Wait for the owner's approval before the next phase.

**Rules for every phase:**
- The backend is the security control.
- Schema changes are additive only.
- No feature may break.
- No new library without asking.

Status: ⬜ not started · 🟡 in progress · ✅ done

| Phase | Area | Status |
|---|---|---|
| A | Security and correctness (server) | 🟡 built and tested; waiting for the owner's check |
| B | Visible bugs and small gaps | 🟡 built and tested; waiting for the owner's check |
| C | New features (owner picks), including **C8 Print Quotation** | 🟡 all of C1–C8 built and tested; waiting for the owner's check |
| D | Large structural changes (owner decision; not recommended now) | ⬜ |
| E | Docs that are out of date | ⬜ |

**Recommended order:** A → B → E → C (the items the owner picks; C8 can go first) → D (only approved items).

**Built differently on purpose (no action, docs only):**
- One baked-in Developer master key instead of a per-install TOTP, recovery codes and safeStorage.
- An Express API over loopback HTTP instead of IPC.
- The receipt printer saved per computer.
- Classic / Compact / Detailed template names.
- Admin abilities set through the Developer's Admin-permission matrix.

---

## Phase A: Security and correctness

> **Roman Urdu:** Server par woh rok-tok jo abhi sirf screen par hai. Ek cashier ki do shifts ek saath na khulein, inkaar (403) audit log mein likha jaye, restore mehfooz ho, purani tareekhon wali sales reports mein aayein, aur medicine form ki server par jaanch ho.

### A1. Read permissions on the server
Today any login can read other staff's data.

| Route | Rule |
|---|---|
| `GET /api/shifts`, `/api/shifts/:id`, `/api/shifts/:id/summary` | Own shifts only, unless the `shifts` module or `can_manage_shifts` |
| `GET /api/shifts/active?user_id=` | Ignore `user_id` and use the session user |
| `GET /api/sales`, `/api/sales/:id` | Own invoices only, unless `can_view_all_sales` |
| `GET /api/customers`, `/api/customers/:id/ledger` | `khata` module (`/api/customers/search` stays open for the POS) |
| `GET /api/stock/counts`, `/api/stock/counts/:id` | `can_count_stock` |
| `POST /api/shifts/:id/close` | `can_shift_close` (today it is checked only in the UI) |

Use `requirePermission` / `hasRolePermission` from `server/http/context.ts`.

### A2. One open shift per cashier, race-safe
- Start the shift inside a transaction.
- Add a partial unique index `cashier_shifts(user_id) WHERE status = 'open'` in `POST_MIGRATION_SQL` (`server/database/schema.ts`).
- With LAN counters, two counters can otherwise open two shifts at the same moment.

### A3. Denials in the audit log
- `requirePermission` and `requireDeveloper` write a `DENIED` row through `logSecurityAudit`.
- Throttle it per user and route, so the log does not flood.

### A4. Restore safety
Files: `server/database/backup.ts` (`restoreDatabase`) and `server/routes/utilities.ts`.
- Stamp `app_version` in settings on every start, and refuse a backup made by a newer version.
- Close both database connections and remove `-wal` / `-shm`.
- Copy the file, run the column migrations, then restart the app (`electron/restart.ts`).
- ~~The main restore path uses a file picker instead of `prompt()`.~~ Already done: `UtilitiesPage.tsx` uses the desktop file picker; `prompt()` is only a fallback outside the desktop app.

### A5. Mixed date formats (PROGRESS 1.22)
- `DATE(sale_date)` filters in `server/routes/sales.ts` and `server/routes/reports.ts` skip rows stored as integer milliseconds.
- Replace them with range comparisons on parsed dates. This changes no data.

### A6. Product input checks
Files: `server/routes/products.ts` and `server/routes/companies.ts`.
- zod schemas for create and edit.
- A duplicate barcode gets 409.
- A unit price is required when loose sale is on.
- Product create, edit and delete are written to the audit log.

**Tests:** a new integration suite covering A1–A6, plus the full regression.

### Built (2026-10-27)
- **A1:**
  - Scoped reads in `server/routes/sales.ts`, `shifts.ts` and `customers.ts` (`hasAnyPermission` in `server/http/context.ts`).
  - The return exception: a full invoice number.
  - A Sales History hint.
  - Stock counts were already checked.
- **A2:** `idx_shifts_one_open` (`ONE_OPEN_SHIFT_INDEX_SQL`); a raced start gets the usual 400. Reopen already refused a second open shift.
- **A3:** `logDenied` in `server/security/audit.ts`, called by `requirePermission`, `requireDeveloper` and the new checks, plus a `DENIED` filter on the Developer audit page.
- **A4:**
  - `app_version` stamp, through `upgradeSchema` in `db.ts`.
  - `restoreVersionError` in `server/database/restoreMath.ts`, with a spec.
  - Restore through SQLite's online backup, then `upgradeSchema` and the batch reconcile.
- **A5:**
  - `localDateSql` (`server/http/sqlDates.ts`) in the sales and report filters.
  - Shift list dates use local midnight.
  - **Extra fix found during the work:** the P&L Summary subtracted a bill discount once per line; now once per bill.
- **A6:**
  - `productSchema` / `companySchema`.
  - Duplicate barcode 409.
  - Loose unit price from the box price.
  - `allow_open_sale` kept on edit.
  - Product create/edit/delete audit.
- **Tests:** `test:phaseA` (9 tests) and `restoreMath.spec.ts`.

---

## Phase B: Visible bugs and small gaps

> **Roman Urdu:** Woh ghaltiyan jo user ko nazar aati hain:
> - Reports ka print khali aata hai.
> - P&L ka CSV ghalat hai.
> - Customer ka statement print nahi hota.
> - Sales History mein customer aur dawai se search nahi hai.

| Id | Gap | Fix |
|---|---|---|
| B1 | Reports → **Print Report** prints a blank page (`ReportsPage.tsx` uses `window.print()`; the print CSS shows only receipts) | Print with `printDocument` (`src/utils/printDocument.ts`), like Day Close |
| B2 | P&L Summary **Export CSV** exports the previous report's rows | Its own CSV export |
| B3 | No customer **statement** | Print + CSV from the Khata ledger, like the supplier statement |
| B4 | Sales History: no customer filter, no search by medicine, only 100 rows | Customer filter (the server takes `customer_id`); **medicine search** listing every invoice with that item (`future-feature.txt`); paging |
| B5 | Product-wise sales report has no date range | From/To in the UI; the route already takes `date_from` / `date_to` |
| B6 | POS: F3/F4/F6–F9 still work while a modal is open | Gate them with `anyModalOpen`, including the shift modals |
| B7 | Dashboard has no active shifts | **Active shifts** card |
| B8 | Admin cannot read the audit log | Read-only `GET /api/audit-logs` with a new permission `can_view_audit_log` |
| B9 | No version on screen | **About** window: app name, version, copyright, developer details (extend `SupportModal.tsx`) |

### Built (2026-10-27)
- **B1:** the report body prints as an A4 page through `printDocument`, with a heading (store, report, period, printed at). Controlled Register and Day Close keep their own print.
- **B2:** the P&L Summary exports its own figures; new helper `downloadCsv` (`src/utils/csv.ts`).
- **B3:**
  - The ledger now includes credit-bill returns.
  - `customerStatement` (`shared/customers.ts`, with a spec) gives the running balance and an "Opening / other changes" line.
  - `CustomerStatementModal` (Print + CSV) opens from **Statement** on every Khata row.
- **B4:** `GET /api/sales` takes `customer`, `medicine` (name or P-Code), `limit` and `offset`. Sales History has Customer and Medicine fields and **Load more**.
- **B5:** product-wise and company-wise reports filter by local date on the server (they had no filter at all) and in the UI. Product-wise says "Top 50".
- **B6:** POS F3/F4/F6–F9 do nothing while any dialog is open, the shift dialogs included.
- **B7:**
  - **Active shifts** card (managers only; no cash figures).
  - **Extra fix:** the Dashboard's "today" was in UTC and missed sales stored as integers; it now uses `localDateSql`.
- **B8:**
  - New permission `can_view_audit_log` (Admin by default).
  - `GET /api/audit-logs` without the Developer account's rows (owner decision); shared `queryAuditLogs` (`server/security/auditQuery.ts`).
  - The audit table is now `AuditLogPanel`, used by the Developer page and the new Settings → **Audit Log** tab.
- **B9:** `GET /api/status` returns the real version. **About & Support** shows the logo, version and copyright; the header badge shows the version.
- **Tests:** `test:phaseB` (6 tests) and the `customerStatement` spec.

---

## Phase C: New features (the owner picks)

> **Roman Urdu:** Naye features. Owner jo chahe wo chune. **C8 Print Quotation** owner ki nayi request hai.

### C1. Bill round-off
- Example: Rs 198 becomes Rs 200.
- A setting `round_off_to` (0 = off, 1, 5, 10).
- Applied on the server in `server/sales/saleMath.ts` after the total, stored as `round_off`, and shown on the receipt.

### C2. Medicine unit types the Admin can add
- Examples: ml, litre, sachet.
- A list in settings instead of the fixed list in the medicine form (`MastersPage.tsx`).

### C3. Shortage note and warning
- A per-medicine "short" flag with a note.
- The POS warns when it is sold, and the reorder list shows it.

### C4. Split payment and cash in/out
- One bill can be paid partly in cash and partly by card or on credit.
- **Cash pay-in / pay-out** during a shift.
- Shift totals include both.

### C5. Backup options
- "Every 2 days" and "Every 3 days" frequencies.
- The secondary folder keeps its own copies, and is used when the primary fails.
- The overdue warning appears after two missed intervals, not one.

### C6. Second shift on the same day
- A policy: may a cashier start a second shift on the same day?
- The plans' other policy flags are already covered by the Developer's Admin-permission matrix:
  - multi-admin;
  - Admin edits the footer;
  - Admin reopens shifts.

### C7. Void an invoice
- Uses `can_delete_invoice`, which exists but is unused today.
- Void with a reason: stock goes back and it is audited. The invoice is never deleted.

### C8. Print Quotation (owner request, 2026-10-27)

A customer asks "how much will this cost?" before buying. The cashier prints the price list of the current bill as a **quotation**.

> **Roman Urdu:** Customer pehle poochta hai ke kitne paise banenge. Cashier POS mein dawaiyan daal kar **Print Quotation** dabata hai. Printer se quotation nikalti hai jis par saaf likha hota hai **QUOTATION**.
>
> Ye **sale nahi hai**:
> - stock kam nahi hota;
> - shift ya day close mein count nahi hoti;
> - reports, khata aur loyalty points mein nahi aati.
>
> Bill POS mein waise hi rehta hai. Customer maan jaye to F9 se asal sale ho jati hai.

**Rules:**
- A **Print Quotation** button on the POS, next to Save / Print.
  - Proposed shortcut **F11** (free today).
  - It works with any cart that has at least one line.
- **Nothing is saved as a sale.** These do not change:
  - stock and batches;
  - shift cash and shift totals;
  - day close;
  - reports and dashboard;
  - khata balance and loyalty points;
  - the `INV-` invoice number sequence.
- **Prices come from the server.**
  - A new `POST /api/sales/quote` prices the cart with the same rules as a sale: `server/sales/saleMath.ts`, the discount permission and the bill-discount cap.
  - It writes nothing and returns the priced lines and totals. So a quotation always shows the real current prices and never a price the cashier is not allowed to give.
- **No shift needed.** A quotation can be printed without an open shift.
- Stock is **not reserved**. Lines with less stock than asked are still quoted, marked "low stock".
- **Printed slip:** the same thermal layouts (`UnifiedInvoice.tsx`: classic / compact / detailed, 58 / 80 mm), with these changes:
  - a large **QUOTATION** heading at the top, and "This is not a receipt / not a sale" at the bottom;
  - a quotation number `QT-YYYYMMDD-HHMMSS`, made from the date and time, with no stored sequence;
  - date and time, the store's name and address, and the cashier;
  - the customer, if one is picked;
  - lines (medicine, quantity, rate, discount, amount), the bill discount and the **net total**;
  - "Prices valid today only", or a validity in days from a setting `quotation_valid_days` (default 1);
  - **not** shown: payment type, cash tendered and change, points earned/used, the khata balance;
  - the developer footer line stays, as on every receipt.
- It prints through `printReceipt` (`src/utils/printReceipt.ts`), so the per-computer printer and "print without dialog" work.
- **After printing,** the cart stays in its invoice tab. Pressing **F9** later makes the real sale as usual.
- **Audit:** none; a quotation is not a money action.
- **Optional later:** keeping printed quotations so they can be reopened. Not in the first version.

**Tests:**
- A quotation does not change stock, shift totals, the invoice count, khata or loyalty.
- Server pricing matches what the sale would charge.
- A changed rate without `can_discount` is refused.
- It works without an open shift.

**Owner answers (2026-10-27):** F11 is fine; validity is a setting in days (1 = today only); no khata balance on the slip.

### Built (2026-10-28)
The owner picked all of C1–C8. Owner rules: a bill is voided only while its shift is open, its day is not closed and nothing was returned; cash pay-in / pay-out is Admin-only by default; a split bill's refund lowers the khata part first, then the rest is cash.

- **C1:**
  - Setting `round_off_to` (0 / 1 / 5 / 10, default off).
  - `roundOff` in `saleMath.ts` runs after loyalty, before the cash and credit-limit checks; the result is stored in `sales.round_off`.
  - The receipt and the POS show a "Round off" line. A full return refunds the rounded amount.
- **C2:**
  - Setting `medicine_unit_types` (a JSON list) through `shared/unitTypes.ts`, which checks 1–50 unique names.
  - Edited in Settings → Store → Billing & Counter Rules.
  - The medicine form reads the list and keeps a medicine's unlisted unit.
- **C3:**
  - `products.shortage_flag` / `shortage_note`, set in the medicine form.
  - The POS shows a badge and a notice; the reorder list always shows the medicine (reason `shortage`).
  - A purchase clears the mark.
- **C4 split:**
  - Payment type `Split`, with `sales.paid_cash` / `paid_card` / `paid_credit` filled on every new bill.
  - `tenderSplit` / `checkSplit` / `refundTenders` (`saleMath.ts`) feed shift totals, the day close, khata and returns.
  - Returns store `sale_returns.refund_cash`.
  - The POS has a Split button with Card and Khata parts; cash is the rest.
- **C4 cash in/out:**
  - Table `cash_movements`, permission `can_cash_in_out` (Admin) and `POST/GET /api/shifts/:id/cash-movements`.
  - Expected cash = … + in − out, saved on close as `total_cash_in` / `total_cash_out`. It is not part of the day-close profit.
  - A **Cash In / Out** button in the POS shift bar; the lines appear on the close window, the shift slip and Shifts admin.
- **C5:**
  - Frequencies `every_2_days` / `every_3_days`, on fixed calendar days.
  - `isOverdue` means two missed slots in a row; the dashboard uses it.
  - If the backup folder fails, the backup goes to the secondary folder, with a dashboard warning.
  - The secondary folder keeps its own newest copies (`pruneSecondaryFolder`); pruning the main folder keeps the copy.
- **C6:**
  - Setting `allow_second_shift_same_day` (default on); only shift managers change it.
  - When it is off, a second shift on the same day gets 409. A manager reopen still works.
- **C7:**
  - `POST /api/sales/:id/void` (`can_delete_invoice`, now labelled "Void Invoices") with a reason.
  - Stock goes back to its batches; khata and loyalty are reversed; the bill becomes `cancelled` with `void_reason` / `voided_by` / `voided_at`. Audited as `SALE_VOIDED`.
  - Shift totals, the khata list and the statement leave voided bills out; the controlled register marks them.
  - Sales History has a **Void** button; receipts and the invoice window show VOID.
- **C8:**
  - `POST /api/sales/quote` (login only, no shift) reuses the sale pricing (`server/sales/priceCart.ts`) and writes nothing.
  - `QT-YYYYMMDD-HHMMSS`, low-stock lines, validity from `quotation_valid_days`.
  - **Print Quotation (F11)** on the POS; `UnifiedInvoice` has a `quotation` mode (QUOTATION heading; "not a receipt, not a sale"; no payment, cash, points or barcode).
  - The POS screen itself still needs an open shift (unchanged), so in practice a quotation is printed during a shift.
- **Tests:**
  - `test:phaseC` (9 tests).
  - Specs for round-off, tenders, split refunds, unit types, shift totals with split and cash in/out, the every-2/3-days slots, overdue, and the day close with split.

---

## Phase D: Large structural changes (owner decision; not recommended now)

> **Roman Urdu:** Ye bade kaam hain jo sari database aur routes ko chhote hain. Abhi ka tareeqa kaam kar raha hai. Owner ki ijazat ke baghair ye nahi honge.

| Item | Note |
|---|---|
| Money as integer paisa | Today Float + `round2`; touches every table and route |
| Stock as one `stockBaseUnits` | Today boxes + loose; touches every stock path |
| One stock-movement ledger | Sales, returns and purchases would also write movement rows |
| Soft delete | Products and companies are already protected by foreign keys; recommended for users only |
| Migration runner with a backup before migrating | Today `COLUMN_MIGRATIONS` only |
| Return lines linked to the original sale line | Today matched by product + unit type |
| Design system | Semantic colour tokens; shared Table / ConfirmDialog / Toast / Badge / EmptyState; replace 52 `alert` / `confirm` calls in 17 files |
| `allow_open_sale` default false | Only for new medicines, so existing ones are not changed |
| Release | Final `package.json` name, a version beyond 1.0.0, an upgrade test, a Windows build check |

---

## Phase E: Docs that are out of date

> **Roman Urdu:** Purane docs ko code ke mutabiq theek karna; koi code nahi badlega.

- `PHASE_REQUIREMENTS.md`: Task 1.1 / 1.2 and TC-08 still describe a Developer email and a QR code in the setup wizard.
- `CLAUDE.md`: "Phases 1–4 done" is out of date.
- `FEATURE_ROADMAP.md`: the M10 data bullets (the fields moved to `loyalty_plans`).
- `PROJECT_GUIDE.md`:
  - permission count 32 → 42;
  - the `@prisma/client` import path;
  - `tsx watch`;
  - the test list (phase6–8, m1–m11);
  - lint scope;
  - directory tree;
  - the shift cash formula;
  - JetBrains Mono.
- `PROGRESS.md`: mark the fixed items (1.14, 2.3, 2.8, 4.2–4.4, 4.6, 4.8, 5.2, 6.3, 6.6, 6.7, 7.2, …).
- `DISASTER_RECOVERY_GUIDE.md`:
  - "zero cloud dependency" is outdated now that online backup exists;
  - add a section on Developer access on a new PC.
- New docs:
  - `ARCHITECTURE.md` and `TEST_REPORT.md` (recommended);
  - `DESIGN_SYSTEM.md` with Phase D;
  - `BACKUP_RECOVERY.md`, which `DISASTER_RECOVERY_GUIDE.md` covers.
- The unused setting `low_stock_threshold`: remove it or document it.

---

## Owner checks on real hardware (still open)
- Two-PC LAN checklist: `docs/LAN_SETUP_GUIDE.md` §13.
- A real 58 / 80 mm thermal printer.
- A full restore on another PC.
- A Windows installer build.
