# Feature Roadmap: pharmacy modules M1–M11

The owner approved these modules on 2026-10-24, after a market review of Pakistani medical stores. Each module is its own phase:

1. Plan the phase in detail.
2. Build it.
3. Test it.
4. Report it in Roman Urdu + English.
5. Wait for the owner's approval before starting the next phase.

Status: ⬜ not started · 🟡 in progress · ✅ done

| Phase | Module | Status |
|---|---|---|
| M1 | Supplier / distributor ledger (payables) | ✅ |
| M2 | Purchase returns and expiry claims | ✅ |
| M3 | Reorder / short list | ✅ |
| M4 | Batch-wise expiry (FEFO) and near-expiry alerts | ✅ |
| M5 | Prescription and controlled-medicine register | ✅ |
| M6 | Generic / substitute search | ✅ |
| M7 | WhatsApp receipts and khata reminders | ✅ |
| M8 | Expenses and day close (cash book) | ✅ |
| M9 | Physical stock count and stock adjustment | ✅ |
| M10 | Loyalty points / regular-customer discount | 🟡 built and tested; waiting for the owner's check |
| M11 | Multi-PC LAN mode (see `MULTI_PC_LAN_MODE.md`) | ⬜ |

FBR POS integration is left out: it needs the internet and FBR registration, which breaks the "100% Offline" promise.

## Rules for every phase

**Database.** Schema changes are additive only. A change needs all of:
- `prisma/schema.prisma`;
- the `CREATE TABLE` in `server/database/schema.ts`;
- `COLUMN_MIGRATIONS` for new columns;
- `npm run prisma:generate`.

Nothing is dropped or renamed.

**Server.** One router in `server/routes/`.
- Money is calculated on the server; client totals are never trusted.
- Write routes call `requirePermission`.
- Request bodies are validated with zod (`server/validation/schemas.ts`).
- Pure maths lives in its own module with a `*.spec.ts`.

**Permissions.** New keys go in `shared/permissions.ts`. Admin defaults get every key; cashier defaults get only counter work. The Developer still controls what the Admin has.

**UI.**
- Design-system classes only (`field-*`, `btn-*`, `text-2xs` and up).
- Light and dark mode.
- No all-caps labels.
- Visible error and empty states.
- User-visible text never names technology.

**Tests.** Each phase adds a `server/tests/mN_test.ts` suite (`npm run test:mN`). `npm run lint`, `npm test` and every existing suite must still pass.

**Docs.** Update CHANGELOG, CLAUDE.md, `docs/PROJECT_GUIDE.md`, `docs/NPM_SCRIPTS.md` and the status in this file.

---

## M1: Supplier / distributor ledger
**Goal.** The store knows what it owes each distributor, records payments, and prints a supplier statement.

**Data.**
- Companies are the suppliers.
- New table `supplier_payments`:
  - `id`, `company_id`, `amount`, `payment_method` (cash | bank | cheque | online), `reference` (cheque or transaction no.), `notes`, `payment_date`;
  - `user_id`, `user_name`, `created_at`.
- A purchase keeps `payment_status` / `paid_amount` (money paid at the time of the purchase).

**Rules (server).**
- Balance owed = Σ purchase `net_total` − Σ `paid_amount` at purchase − Σ supplier payments − Σ purchase-return credits (credits added in M2).
- It is worked out from the rows every time, never stored, so it cannot drift.
- Payments settle the oldest unpaid purchase first. Each purchase's status (Paid / Partial / Pending) and amount due are worked out the same way.
- A payment must be more than 0 and no more than the balance owed.
- Purchases: the server recalculates totals and validates `paid_amount` (0 ≤ paid ≤ net) and `payment_status`.

**API.**
- `GET /api/suppliers`: every company with total bought, paid, returns, balance and last purchase.
- `GET /api/suppliers/:id/ledger`: purchases, payments and returns in date order, with a running balance and the due purchases.
- `POST /api/suppliers/:id/payments`: needs `can_pay_supplier`.

**Permissions.**
- Viewing uses the existing `purchases` module key.
- New key `can_pay_supplier`: Admin yes, cashier no.

**UI.**
- Purchases page gets two tabs: **Purchases** (as today) and **Suppliers**.
- The Suppliers tab lists payables with a search box.
- Each row has Pay and Statement.
- The statement opens in a modal with Print.
- The new-purchase form gets "Paid now" (amount) instead of only a status.

**Built (2026-10-24):**
- `server/suppliers/ledgerMath.ts` (pure, with spec) and `loadLedger.ts`;
- `server/routes/suppliers.ts`;
- the `supplier_payments` table;
- `createPurchaseSchema` / `supplierPaymentSchema`;
- the Purchases page Suppliers tab, `SupplierPaymentModal` and `SupplierStatementModal`;
- `src/utils/printDocument.ts` for page-sized prints.

Supplier payments are not taken from a shift's cash drawer: owners usually pay distributors from the safe or the bank. M8 can link a cash payment to the drawer if wanted.

**Tests (`test:m1`):**
- balance after purchases, payments and partial payments;
- overpayment refused;
- permission needed;
- statement running balance;
- tampered purchase totals recalculated.

## M2: Purchase returns and expiry claims
**Goal.** Send damaged, expired or near-expiry stock back to the distributor. Stock goes down and the supplier owes the store (credit).

**Data.** The tables `purchase_returns` / `purchase_return_items` already exist. Add `batch_no` and `is_expiry_claim` columns.

**Rules.**
- A return quantity cannot exceed current stock.
- If it is linked to a purchase, it cannot exceed that line minus earlier returns.
- The credit is cost price × quantity, and it lowers the supplier balance from M1.

**API.**
- `POST /api/purchase-returns`: needs the new key `can_return_purchase`.
- `GET /api/purchase-returns`.

**UI.**
- Purchases → **Returns** tab with a new return form: pick the supplier, then the purchase or medicine.
- An **Expiry claim** list of expired and near-expiry batches, grouped by supplier, that can be added to a return in one click.

**Built (2026-10-24):**
- `server/purchaseReturns/returnMath.ts` (pure, with spec);
- `server/routes/purchaseReturns.ts`:
  - list;
  - details;
  - `expiry-candidates`;
  - create.
- `GET /api/purchases/:id` (lines with `returned_boxes` / `returnable_boxes`);
- new columns:
  - `purchase_returns.is_expiry_claim` / `user_id` / `user_name`;
  - `purchase_return_items.product_name` / `purchase_item_id` / `batch_no`.
- Purchases → **Returns to Supplier** tab (`PurchaseReturnsTab`, `PurchaseReturnModal`), with a printable return note;
- the purchase voucher now lists its lines and prints.

**Credit rate:**
- A line linked to a purchase is credited at its cost after the line discount, bonus boxes included.
- Unlinked stock is credited at the current trade price.

**Since M4:** batches follow every sale (FEFO), so the expiry list shows real quantities. The stock cap stays only as a safety net.

**Tests (`test:m2`):**
- stock goes down;
- supplier balance goes down;
- over-return refused;
- permission needed.

## M3: Reorder / short list
**Goal.** Every morning, a ready order list for each distributor.

**Rules.**
- Suggested quantity = max(`min_stock_alert` × 2 − stock, average daily sales over the last 30 days × cover days − stock), in boxes, rounded up.
- Only active medicines.
- Cover days is a setting, default 7.

**API.** `GET /api/reorder?company_id=&cover_days=`.

**UI.** Purchases → **Reorder** tab:
- grouped by supplier, with editable quantities;
- Print;
- "Send on WhatsApp" opens a `wa.me` link with the list text (uses the M7 helper; until M7 exists, Copy text);
- "Create purchase" fills a new purchase draft.

**Built (2026-10-25):**
- `server/reorder/reorderMath.ts` (pure, with spec);
- `server/routes/reorder.ts` (`GET /api/reorder`, `purchases` permission);
- setting `reorder_cover_days`;
- Purchases → **Reorder List** tab (`src/components/reorder/ReorderTab.tsx`):
  - editable boxes;
  - Print order list;
  - Copy as text (pasted into WhatsApp by hand until M7);
  - Create purchase.
- New Purchase draft lines now have editable batch, expiry and boxes. Posting needs a batch and an expiry on every line; the fake `B-xxxx` / `2027-12-31` defaults are gone.

**How a medicine gets listed.** It is listed when stock is at or below `min_stock_alert`, or when it will run out within the cover days at the last 30 days' sales speed (returns taken off). The quantity is max(minimum × 2 − stock, sales × cover days − stock), rounded up in boxes.

**Tests:** suggestion maths (unit spec) and the list API (`test:m3`).

## M4: Batch-wise expiry (FEFO) and near-expiry alerts
**Goal.** Sell the batch that expires first. Correct expired and near-expiry reports.

**Rules.**
- A sale takes stock from batches with the earliest expiry first, recorded on `sale_items.batch_id`; a line can span batches, split by quantity.
- A return puts stock back into its batch.
- Opening stock and stock adjustments create or adjust a batch.
- `products.stock_*` stays the total and always equals the sum of its batches.

**Data.** New table `sale_item_batches` (`sale_item_id`, `batch_id`, `units`). A startup fix creates an "opening" batch for any product whose stock is not covered by batches.

**UI.**
- Expiry alerts at 30/60/90 days on the Dashboard and Reports.
- Medicines → batch list for each medicine.

**Owner decision:** expired batches are never sold. A sale that would need them is refused with a message pointing to Returns to Supplier.

**Built (2026-10-25):**
- `server/stock/batchMath.ts` (pure, with spec: FEFO order, allocate, reconcile) and `server/stock/batchStock.ts`:
  - `takeUnits` and `takeUnitsFromBatch`;
  - `returnUnits`;
  - `syncProductBatches`;
  - `reconcileAllProductBatches`, run from `initPrisma`.
- New table `sale_item_batches`. Sales record their batches there, and returns put units back into them (`returned_units`).
- Supplier returns take the named batch first, then the earliest expiry.
- Product create/edit keeps batches in step:
  - opening stock goes into the `OPENING` batch;
  - lowered stock is trimmed by earliest expiry.
- `GET /api/products/:id/batches` and `PUT /api/products/:id/batches/:batchId` (batch number / expiry only).
- Medicines → batch button (`BatchListModal`).
- The expired report counts loose units and marks expired vs expiring.
- The Dashboard shows 30/60/90-day near-expiry counts.

**Tests:**
- FEFO order;
- split across batches;
- a return goes back to its batch;
- the totals invariant;
- the expired report.

## M5: Prescription and controlled-medicine register
**Goal.** Meet the drug-law record keeping for psychotropic and narcotic medicines.

**Data.**
- Product column `schedule` (none | rx | controlled).
- New table `prescription_records`:
  - `sale_id`, `sale_item_id`;
  - patient name, phone, CNIC (optional), doctor name, doctor reg. no., prescription no., notes, `created_at`.

**Rules.** The server refuses a sale of a `controlled` medicine without patient, doctor and prescription number. `rx` shows a reminder only.

**UI.**
- POS asks for the details in a modal before saving.
- Reports → **Controlled register** with a date filter and Print.

**Built (2026-10-25):**
- `shared/schedule.ts` (+ spec): the schedule values and labels, plus `missingPrescriptionFields` and `isValidCnic`.
- Data: column `products.schedule` and table `prescription_records`.
- `POST /api/sales` takes one `prescription` per invoice and writes a register row for each controlled line.
- `GET /api/reports/controlled-register`.
- UI:
  - the Medicines form Schedule select, with an Rx / Controlled tag;
  - POS `PrescriptionModal`, with the draft kept per invoice tab;
  - Reports → **Controlled Register** with a date filter and Print.

**Choices:**
- One prescription per invoice.
- The register uses the `reports` permission.
- Returns do not delete register rows; the register shows the returned quantity.
- The prescription is not printed on the receipt.

**Tests (`test:m5`):**
- refused without details;
- saved with details;
- the register lists them.

## M6: Generic / substitute search
**Goal.** When a medicine is out of stock, show medicines with the same generic formula that are in stock.

**Rules.** Match on normalized `generic_name` (lower case, extra spaces removed); in-stock items first.

**API.** `GET /api/products/:id/substitutes`.

**UI.**
- POS search shows a "Substitutes" button on out-of-stock results, and on `F7` for the highlighted medicine.
- Medicines form: a generic name field with suggestions.

**Built (2026-10-25):**
- `shared/generic.ts` (+ spec): `genericKey` and `rankSubstitutes`.
  - The key ignores case, extra spaces and ingredient order (split on `+`, `,`, `&`, "and"). "500 mg" counts as "500mg".
  - A different strength is not a substitute. `/` is not a separator, because strengths use it (120mg/5ml).
  - Order: in stock first, then same unit type, then more stock, then name.
- `GET /api/products/:id/substitutes` and `GET /api/products/generics?q=`, both login only.
- POS:
  - `SubstitutesModal`;
  - a **Substitutes** button on out-of-stock results and **Alternatives** on the others;
  - **F7** for the highlighted result or the newest cart line.
- Medicines form: formula suggestions, and a count of other medicines with the same formula.
- No schema change.

**Tests:** matching and ordering (`test:m6`).

## M7: WhatsApp receipts and khata reminders
**Goal.** Send the receipt or the udhaar balance on WhatsApp, with no paid service.

**How.**
- A `wa.me/<phone>?text=` link opened through a new IPC that only allows `https://wa.me/`.
- The phone is normalized to 92XXXXXXXXXX (`shared/customers.ts`).
- The text templates live in one shared module.

**UI.**
- Receipt modal: **WhatsApp** button, shown when the customer has a phone.
- Khata tab: **Send reminder** on each customer with a balance.
- Settings: message templates.

**Tests:** template and phone formatting (unit spec).

**Built (2026-10-25):**
- `shared/whatsapp.ts` (+ spec): `whatsappPhone`, `fillTemplate`, `whatsappLink`, `receiptMessage` (items capped at 25 lines) and `reminderMessage`, with the default texts.
- IPC `whatsapp:open` (only `https://wa.me/<digits>`) and `window.electronAPI.openWhatsApp`.
- Settings `whatsapp_receipt_template` / `whatsapp_reminder_template`:
  - saved with the `settings` permission;
  - at most 1000 characters;
  - blank means the default.
- `WhatsAppButton` on:
  - the POS receipt;
  - the invoice reprint;
  - Khata (**Send reminder**);
  - the Reorder List (**Send on WhatsApp** to the supplier; the list now carries `company_phone`).
- Settings → Store → **WhatsApp Messages** editor.
- **Developer line:** every message ends with the developer's details. Developer → Developer Profile → **WhatsApp Advertising** sets:
  - the lead text (`developer_whatsapp_lead`, max 60);
  - the details (`developer_info_whatsapp`);
  - with a preview.

  Staff cannot change or remove it.
- No schema change.

**Choices:**
- Sending a reminder needs no extra permission; whoever can see the khata can send it.
- If WhatsApp cannot be opened, the text is copied instead.
- `test:m7` covers the settings and the supplier phone.

## M8: Expenses and day close (cash book)
**Goal.** Record shop expenses and close the day with the real profit.

**Data.**
- New table `expenses`: `id`, `category`, `amount`, `payment_method`, `notes`, `expense_date`, `shift_id`, user, `created_at`.
- The existing `daily_closings` table holds the day close.

**Rules.**
- Cash expenses paid during a shift lower that shift's expected cash (in `shiftTotals.ts`).
- Day close = sales − returns − cost of goods − expenses.
- A closed day locks expense edits for that date.

**Permissions.** `can_add_expense` and `can_day_close`.

**UI.**
- **Expenses** page: categories, list and add.
- Reports → **Day close** with Print.

**Tests:**
- expense lowers shift cash;
- day-close maths;
- the lock.

**Owner decisions (2026-10-25):**
- Cashiers may record expenses (`can_add_expense` by default) and see only their own.
- A day can be closed while a shift is still open; a warning lists the open shifts.
- Anyone with `can_day_close` may reopen a closed day; both are audit-logged.
- Expenses is its own sidebar page; Day close is in Reports.

**Built (2026-10-25):**
- Data:
  - new table `expenses` (`expense_date` is the local day, `shift_id` for cash paid from a drawer);
  - `cashier_shifts.total_expenses_cash`;
  - new `daily_closings` columns `invoices_count`, `total_cost_of_goods`, `customer_payments_cash`, `net_profit`, `open_shifts_at_close`.
- `shared/expenses.ts`: payment methods, suggested categories, limits.
- `computeShiftTotals` takes the shift's expenses. Cash ones lower the expected cash.
- `server/dayClose/dayCloseMath.ts` (pure, with spec) and `loadDayClose.ts`:
  - sales by payment, counted on the sale day;
  - returns, counted on the refund day;
  - cost of goods sold, minus the cost of returned lines (the sale line's `unit_cost`);
  - expenses by category and net profit;
  - the day's shifts (opening, expected, counted, difference);
  - khata cash and supplier payments (information only).
- `server/routes/expenses.ts`:
  - list (own entries without `can_day_close`), add, edit, delete;
  - 409 on a closed day or a closed shift.
- `server/routes/dayClose.ts`: `GET /api/day-close`, `GET /api/day-close/history`, `POST /api/day-close`, `POST /api/day-close/:date/reopen`.
- New permission keys: `expenses` (module), `can_add_expense`, `can_day_close`. `backfillRolePermissions` adds them to existing roles with the built-in defaults.
- UI:
  - **Expenses** page;
  - Reports → **Day Close** with Print and the recent closes;
  - "Cash expenses" on the shift close, shift slip, shift details (Expenses tab) and the shift CSV.

- **Automatic day close** (owner request 2026-10-26):
  - after midnight the scheduler closes every finished day with activity (catch-up over 31 days; reopened days close again);
  - `auto_closed` column; setting `auto_day_close` to switch it off.
- **Day / Month / Date-range** report:
  - `GET /api/day-close/range`;
  - totals plus a day-by-day table;
  - Print and CSV.

**Tests:** `dayCloseMath.spec.ts`, `shiftTotals.spec.ts`, and `test:m8` (8 tests).

## M9: Physical stock count and stock adjustment
**Goal.** Count the shelves and fix differences, with an audit trail. This also replaces stock editing in the medicine form (audit phase 3).

**Data.**
- `stock_counts` (session: date, user, status).
- `stock_count_items` (product, system units, counted units).
- `stock_adjustments` (product, delta units, reason, user, date).

**Rules.**
- Counting does not change stock until "Apply".
- Apply writes the adjustments and updates the stock (and the batches, after M4).
- A single adjustment needs `can_adjust_stock`.

**UI.**
- Medicines → **Stock count** with scanner input, a difference column and Apply.
- **Adjust stock** action on a medicine.

**Tests:**
- apply;
- deltas;
- audit rows;
- permission needed.

**Owner decisions (2026-10-26):**
- The medicine form keeps opening stock for a new medicine; on edit the stock is locked and changes only through Adjust stock or a count.
- Staff count (`can_count_stock`, cashier and pharmacist by default); Apply and single adjustments need `can_adjust_stock` (Admin).
- The loss value is shown only in the Adjustments history; Day Close profit is unchanged.

**Built (2026-10-26):**
- Data: tables `stock_counts`, `stock_count_items`, `stock_adjustments` (reason, delta, before/after, batch, unit cost, count, user).
- `shared/stockAdjust.ts` (reasons, labels, direction, `unitsText`) and `server/stock/adjustMath.ts` (pure, with spec).
- `server/stock/adjustStock.ts`: `adjustProductStock`, the one path for stock changes outside sales and purchases; batches stay equal to stock.
- `server/routes/stock.ts`: counts (list, detail, create with optional company list, add/count lines by barcode, code or id, remove line, apply, cancel), single adjustment, adjustment history.
- A product edit ignores stock; a new product's opening stock and Stock Zero resets write adjustment rows.
- UI: Medicines → **Stock Count** (scan input, counted boxes + loose, difference and value, filters, Apply, Cancel, printable count sheet), **Adjustments** (filters, totals, Print, CSV) and **Adjust stock** on each medicine.
- **Apply rule:** stock = current + (counted − system when counted), so sales made after counting stay sold; lines not counted are skipped.

**Tests:** `adjustMath.spec.ts` and `test:m9` (8 tests).

## M10: Loyalty points / regular-customer discount
**Goal.** Reward regular and chronic-care customers.

**Data.**
- Customer columns `loyalty_points` and `discount_pct`.
- Settings `loyalty_points_per_100`, `loyalty_point_value`, `loyalty_enabled`.

**Rules.**
- Points are earned on the paid net amount of a saved customer's sale, and taken back on returns.
- Redeeming points lowers the bill (worked out on the server and shown on the receipt).
- A customer's own discount % applies within the store maximum discount.

**UI.** The POS customer picker shows points with a Redeem option; the Customers page shows points.

**Tests:**
- earn;
- redeem;
- return reversal;
- cap.

**Owner decisions (2026-10-26):**
- The Developer allows loyalty first; only then does the Admin see it, switch it on and set the rules.
- The Admin builds plans (templates): Regular, Silver, Gold, Chronic Care or their own, each with its own rules, and can put a customer on a plan by hand. A plan can move customers up automatically after a buying amount in 12 months.
- Any cashier may use a customer's points at the counter, within the plan's limits (checked on the server).
- Expiry is set per plan (0 = never); the earliest-expiring points are used first.
- Udhaar sales earn points only when the plan says so.

**Built (2026-10-26):**
- Settings `loyalty_feature_allowed` (Developer) and `loyalty_enabled` (Admin); permission `can_manage_loyalty`.
- Data: tables `loyalty_plans` and `loyalty_transactions`; columns `customers.loyalty_plan_id` / `loyalty_points` and `sales.member_discount_pct` / `member_discount_amt` / `points_redeemed` / `points_redeemed_value` / `points_earned` / `points_balance` / `loyalty_plan_name`.
- `shared/loyalty.ts` (pure, with spec), `server/loyalty/loyaltyStore.ts`, `server/routes/loyalty.ts`.
- Sales: member discount within the store maximum, points used (`redeem_points`) and earned on what was paid; returns take back and give back points in proportion.
- UI: Developer toggle; Settings → **Loyalty Points** (switch, plans, templates with examples); POS member line, member discount and **Use points**; receipt and WhatsApp lines; Customers → **Loyalty Points** tab and the **Points** window.

**Tests:** `shared/loyalty.spec.ts` and `test:m10` (10 tests).

## M11: Multi-PC LAN mode
Follows `docs/MULTI_PC_LAN_MODE.md` (audit-first, with its own phases). It is started only after M1–M10, because every module above must work with several counters.
