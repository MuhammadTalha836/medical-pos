# NPM Scripts Guide (PharmaCare Pro)

PharmaCare Pro runs **only as a desktop app**; there is no browser mode. This guide covers every command in the `scripts` section of `package.json`: what it does, when to run it, how to run it and why it exists.

Run every command from the project root folder (where `package.json` is):

```bash
cd ~/WORK/client/pharmacy
npm run <script-name>
```

> **Note:** `npm test` is short for `npm run test`. Every other script needs `npm run`.

---

## Quick reference

| Kaam (task) | Command |
|---|---|
| Open the app while developing | `npm run dev` |
| Check code for errors | `npm run lint` |
| Unit tests | `npm test` |
| Full integration tests | `npm run test:functional` + `test:phase1` … `test:phase8` |
| After editing `prisma/schema.prisma` | `npm run prisma:generate` |
| First-time developer key setup | `npm run developer:key` |
| Check that the desktop bundle compiles | `npm run build` |
| Make a test desktop build | `npm run build:unpack` |
| Make the Windows installer for the client | `npm run build:win` |
| Fix a "NODE_MODULE_VERSION" error | `npm run rebuild` |

---

## Background: the database module (better-sqlite3)

> **Roman Urdu:** Database library (better-sqlite3) ek native module hai jo ek waqt me sirf ek runtime ke liye compile hota hai. Ab project me sab kuch (app, tests, build) **Electron ke runtime** par chalta hai, is liye library hamesha Electron ke liye build rehti hai, aur Node/Electron ke beech switch karne ki zaroorat nahi.

- `npm run dev` and the `test:*` suites first check that the library loads in Electron. If it doesn't (for example right after `npm install`, which builds it for plain Node), they run `npm run rebuild` **once** by themselves.
- So the old `NODE_MODULE_VERSION 137 / 146` error should not come back. If it ever does, run `npm run rebuild`.

---

## 1. Development

### `npm run dev`
```json
"dev": "node scripts/electron.mjs dev"
```
- **Kya karti hai:** Opens the **PharmaCare Pro desktop window** in development mode.
  - The API runs inside the app on `127.0.0.1:3001`.
  - The screens reload instantly when you save a file in `src/`.
  - The app restarts by itself when you save a file in `server/` or `electron/` (`--watch`).
- **Kab chalayein:** Every day while working on the project. This is the main command.
- **Kaise:** `npm run dev`. To stop, close the window or press `Ctrl+C` in the terminal. It works the same in the VS Code terminal (the script removes VS Code's `ELECTRON_RUN_AS_NODE` setting itself).
- **Kyun:** It lets you see and test the real desktop app, including thermal printing and the backup/restore file dialogs.
- **Notes:**
  - It uses the real development database `data/pharmacy.db` and the `backups/` folder. The backup scheduler also runs, so a backup can appear while you work.
  - With `PHARMACARE_SAMPLE_DATA=true` in `.env`, an empty database gets a demo store, medicines and customers. Remove that line if you want an empty database.
  - Run only **one** copy at a time; a second copy cannot use port 3001 and shows "PharmaCare Pro could not start".

---

## 2. Code checking and build

### `npm run lint`
```json
"lint": "tsc --noEmit"
```
- **Kya karti hai:** Type-checks all TypeScript code (`src/`, `shared/`, `server/`, `electron/`, `scripts/`) without creating any files. Unused imports and variables are also errors.
- **Kab chalayein:**
  - before every commit;
  - after any big change;
  - before making a build.
- **Kaise:** `npm run lint`. No output means everything is OK.
- **Kyun:** It catches type mistakes, wrong function arguments and dead code before they reach the client. This is the project's only lint and typecheck step.

### `npm run build`
```json
"build": "prisma generate && tsc --noEmit && electron-vite build"
```
- **Kya karti hai:** Runs three steps in order:
  1. `prisma generate` creates the database client code;
  2. `tsc` type-checks the code;
  3. `electron-vite build` compiles the desktop app (main process, preload and screens) into `out/`.

  **It does not make an installer.**
- **Kab chalayein:** To check that the whole desktop app compiles, as a final check before a release. `build:unpack` and `build:win` run it first anyway.
- **Kaise:** `npm run build`. It needs `.env.developer` (`npm run developer:key`).
- **Kyun:** It finds build errors quickly without waiting for packaging.

---

## 3. Database

### `npm run prisma:generate`
```json
"prisma:generate": "prisma generate"
```
- **Kya karti hai:** Reads `prisma/schema.prisma` and generates the type-safe database client in `server/generated/prisma` (this folder is not in git).
- **Kab chalayein:**
  - **always after editing `prisma/schema.prisma`**;
  - after a fresh `git clone` + `npm install`;
  - when you see errors like "Cannot find module '../generated/prisma/client'".
- **Kaise:** `npm run prisma:generate`, then restart `npm run dev`.
- **Kyun:** Server code imports the client from `server/generated/prisma`. If it is missing or old, the app will not compile or will use old columns.
- **Adding a new column (complete checklist):**
  1. add the field to the model in `prisma/schema.prisma`;
  2. add it to the `CREATE TABLE` in `server/database/schema.ts`;
  3. add an entry to `COLUMN_MIGRATIONS` in the same file, so old databases get the column on startup;
  4. run `npm run prisma:generate`.

> There is no `prisma migrate` / `db push` in this project on purpose. The app creates and upgrades its own database at startup.

---

## 4. Tests

> **Roman Urdu:** Tests kabhi bhi asli database ya backups ko touch nahi karte. Har test apna naya temporary database banata hai (OS temp folder me), sample data ke sath. Is liye tests kabhi bhi safely chala sakte hain, chahe app khuli ho.

### `npm test`
```json
"test": "vitest run"
```
- **Kya karti hai:** Runs all **unit tests** (`*.spec.ts` files in `server/`, `shared/` and `src/`) once and exits. These test pure logic, such as backup schedule math, license days, invoice settings and authenticator codes. They don't use the database.
- **Kab chalayein:** After changing any logic file, and before every commit. It takes a few seconds.
- **Kaise:**
  - `npm test` runs everything;
  - `npx vitest run server/backup/schedule.spec.ts` runs one file.
- **Kyun:** It is a fast safety net: if a rule (e.g. backup retention, license expiry) breaks, this shows it straight away.

### `npm run test:watch`
```json
"test:watch": "vitest"
```
- **Kya karti hai:** Same unit tests, but it keeps running and re-runs tests every time you save a file.
- **Kab chalayein:** While you are writing or fixing logic and want instant feedback.
- **Kaise:** `npm run test:watch`. Press `q` to quit.
- **Kyun:** It is faster than running `npm test` again and again by hand.

### Integration suites (`test:functional`, `test:phase1` … `test:phase8`)
```json
"test:functional": "node scripts/electron.mjs test server/tests/functional_test.ts",
...
"test:phase5": "node scripts/electron.mjs test server/tests/phase5_test.ts"
"test:phase6": "node scripts/electron.mjs test server/tests/phase6_test.ts",
"test:phase7": "node scripts/electron.mjs test server/tests/phase7_test.ts"
"test:phase8": "node scripts/electron.mjs test server/tests/phase8_test.ts"
"test:m1": "node scripts/electron.mjs test server/tests/m1_test.ts"
"test:m2": "node scripts/electron.mjs test server/tests/m2_test.ts"
```

**What they do:**
- Each one starts the real API in-process on a fresh temp database and calls real `/api` routes, checking status codes and responses end to end.
- They run on the desktop app's own runtime, so they use exactly the same database module as the app.
- They print `✔ PASS` / `✘ FAIL` for each step and exit with an error if anything fails.

**When to run them:**
- after any backend or route change;
- before a commit;
- **always before giving a build to the client**.
- Run the suite that matches the area you changed, or all of them.

**How to run them:**
- `npm run test:phase3` runs one suite.
- To run all of them:
  ```bash
  npm run test:functional && npm run test:phase1 && npm run test:phase2 && npm run test:phase3 && npm run test:phase4 && npm run test:phase5 && npm run test:phase6 && npm run test:phase7 && npm run test:phase8 && npm run test:m1 && npm run test:m2
  ```

**Why:** These prove that the real business flows still work (sale, stock, shifts, permissions, license, backups) and not just single functions.

| Script | Kya check karta hai (what it covers) |
|---|---|
| `test:functional` | The full business flow in 15 steps: products, purchase, stock, POS sale, khata (credit), returns, reports |
| `test:phase1` | First-time setup wizard and developer authenticator-code login (replay protection, setup lock) |
| `test:phase2` | Roles and permissions (RBAC), developer-only settings, security audit log |
| `test:phase3` | Thermal invoice templates (58mm/80mm), protected store identity, sale snapshots for reprints |
| `test:phase4` | Backups: verification, retention/cleanup, offline scheduler, who may back up or restore |
| `test:phase5` | Login sessions, developer-only admin permissions, Demo/Full license lock |
| `test:phase6` | Khata customers: unique phone, credit sale needs a saved customer, credit limit, credit returns |
| `test:phase7` | Online backup: backup type (Developer only), Google sign-in, encrypted upload, offline retry, Drive retention, restore from Drive (Google faked, no internet needed) |
| `test:m1` | Supplier ledger: purchases costed on the server with a paid-now amount, balances, payments settling the oldest bill, statement, overpayment, permissions |
| `test:m2` | Returns to supplier and expiry claims: stock, batch and supplier balance go down, credit at purchase cost or trade price, over-return/stock/supplier checks, expiry list, permissions |
| `test:phase8` | Server as the money/security control: server-side sale pricing, oversell and cash shortfall, returns per unit type with the bill discount, partial returns, shift cash with credit refunds, khata payments, role escalation, inventory/report permissions, shift close ownership, staff login lockout |

---

## 5. Developer key

### `npm run developer:key`
```json
"developer:key": "tsx scripts/developer-key.ts"
```
- **Kya karti hai:**
  - creates the file `.env.developer` with the **developer master key**;
  - prints a QR code in the terminal; scan it with an authenticator app (Google Authenticator, Microsoft Authenticator, etc.).
- **Kab chalayein:**
  - **once**, on first setup of the project, before running the setup wizard or making any build;
  - with `-- --show` on a new phone, to see the QR again;
  - with `-- --rotate` only if the key is leaked or lost;
  - with `-- --google <client-id> <client-secret>` once, to turn on online backups to Google Drive (`docs/ONLINE_BACKUP_SETUP.md`).
- **Kaise:**
  ```bash
  npm run developer:key              # create the key (refuses if one already exists)
  npm run developer:key -- --show    # show the QR of the existing key again
  npm run developer:key -- --rotate  # replace the key (old builds keep the old key)
  npm run developer:key -- --google <client-id> <client-secret>   # Google sign-in client for online backups
  ```
  After creating it, restart `npm run dev`.
- **Kyun:**
  - The Developer account signs in with this authenticator code (no password).
  - The setup wizard on every new install needs it.
  - The license is signed with it.
  - `build`, `build:unpack` and `build:win` **refuse to build** without this file, because the key is baked into the app.
- **Warning:**
  - Never commit `.env.developer` or share it (it is already in `.gitignore`).
  - Keep a copy in a password manager.
  - If you lose it, see `docs/DEVELOPER_RECOVERY.md`.

---

## 6. Packaging (for the client)

### `npm run build:unpack`
```json
"build:unpack": "npm run build && npm run native:reset && electron-builder --dir"
```
- **Kya karti hai:**
  1. runs `npm run build`;
  2. clears the stale native marker;
  3. packages the app as a **ready-to-run folder** (no installer) in `release/<platform>-unpacked/`.
- **Kab chalayein:** To test the real packaged app before making the installer: fresh install behaviour, setup wizard, no sample data, printing, backups.
- **Kaise:**
  ```bash
  npm run build:unpack
  # Linux: run the app
  ./release/linux-unpacked/pharmacy-management-system
  ```
- **Kyun:** It is faster than a full installer and shows exactly what the client will get. The packaged app keeps its data in the user's own folder, not in the project's `data/`.

### `npm run build:win`
```json
"build:win": "npm run build && npm run native:reset && electron-builder --win nsis"
```
- **Kya karti hai:** The same steps as `build:unpack`, but makes the **Windows installer** (`.exe`, NSIS) in `release/`. The installer lets the user choose the install folder.
- **Kab chalayein:** When you are giving a new version to a client (a release).
- **Kaise:** Run it **on a Windows PC** (the native database module must be built for Windows):
  ```bash
  npm run build:win
  ```
- **Kyun:** This is the file you give to the pharmacy to install the app.
- **Before every release:**
  1. `npm run lint`, `npm test`, all `test:*` suites;
  2. update `version` in `package.json` and `CHANGELOG.md`;
  3. make sure `.env.developer` is the real key, **not a test key**;
  4. never change `appId` in `electron-builder.yml`, or Windows will treat the new version as a different app.

---

## 7. Native module helpers

### `npm run rebuild`
```json
"rebuild": "npm run native:reset && electron-builder install-app-deps"
```
- **Kya karti hai:** Recompiles the database module (better-sqlite3) for the desktop app's runtime.
- **Kab chalayein:** You normally don't need it, because `dev` and the tests run it themselves when needed. Run it by hand if you ever see a `NODE_MODULE_VERSION` / `ERR_DLOPEN_FAILED` error.
- **Kaise:** `npm run rebuild`.
- **Kyun:** `npm install` builds native modules for plain Node, but the app runs on Electron's runtime, which needs its own build.

### `npm run native:reset`
```json
"native:reset": "node -e \"require('fs').rmSync('node_modules/better-sqlite3/build/Release/.forge-meta',{force:true})\""
```
- **Kya karti hai:** Deletes one small marker file (`.forge-meta`) inside better-sqlite3's build folder. It is safe and does nothing if the file isn't there.
- **Kab chalayein:** You don't run it yourself; `rebuild`, `build:unpack` and `build:win` call it.
- **Kaise:** `npm run native:reset`.
- **Kyun:** If this marker is stale, electron-builder thinks the module is already built and **skips the rebuild**. The installer could then ship the wrong build, and the app would fail on the client's PC.

---

## Common workflows

**New PC / fresh clone:**
```bash
npm install
npm run prisma:generate
npm run developer:key        # first time only, scan the QR
npm run dev                  # the desktop window opens; complete the setup wizard
```

**Daily work:**
```bash
npm run dev
# ...code...
npm run lint && npm test
```

**Before a commit:**
```bash
npm run lint && npm test && npm run test:functional && npm run test:phase1 && npm run test:phase2 && npm run test:phase3 && npm run test:phase4 && npm run test:phase5 && npm run test:phase6 && npm run test:phase7 && npm run test:phase8 && npm run test:m1 && npm run test:m2
```

**Client release (on Windows):**
```bash
npm run lint && npm test     # plus all test:* suites
npm run build:win            # installer in release/
```

**Fresh database during development:** close the app, delete `data/pharmacy.db*` (and `backups/*` if wanted), then run `npm run dev` again. The database is recreated empty, with sample data if `PHARMACARE_SAMPLE_DATA=true` is in `.env`.
