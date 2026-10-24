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
| M1 | Supplier / distributor ledger (payables) | ✅ built and tested; waiting for the owner's check |
| M2 | Purchase returns and expiry claims | ⬜ |
| M3 | Reorder / short list | ⬜ |
| M4 | Batch-wise expiry (FEFO) and near-expiry alerts | ⬜ |
| M5 | Prescription and controlled-medicine register | ⬜ |
| M6 | Generic / substitute search | ⬜ |
| M7 | WhatsApp receipts and khata reminders | ⬜ |
| M8 | Expenses and day close (cash book) | ⬜ |
| M9 | Physical stock count and stock adjustment | ⬜ |
| M10 | Loyalty points / regular-customer discount | ⬜ |
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

**Tests:** suggestion maths (unit spec) and the list API.

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

**Tests:**
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

**Tests:** matching and ordering.

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

## M11: Multi-PC LAN mode
Follows `docs/MULTI_PC_LAN_MODE.md` (audit-first, with its own phases). It is started only after M1–M10, because every module above must work with several counters.
