# NPM Scripts Guide (PharmaCare Pro)

This guide covers every command in the `scripts` section of `package.json`: what it does, when to run it, how to run it and why it exists.

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
| Daily development (UI + API) | `npm run dev` |
| Check code for errors | `npm run lint` |
| Unit tests | `npm test` |
| Full integration tests | `npm run test:functional` + `test:phase1` … `test:phase5` |
| After editing `prisma/schema.prisma` | `npm run prisma:generate` |
| First-time developer key setup | `npm run developer:key` |
| Run the desktop app in dev | `npm run rebuild:electron` then `npm run dev:electron` |
| Make a test desktop build | `npm run build:unpack` |
| Make the Windows installer for the client | `npm run build:win` |
| Go back to normal dev after Electron | `npm run rebuild:node` |

---

## Important background: the better-sqlite3 "ABI" problem

> **Roman Urdu:** Database library (better-sqlite3) ek waqt me sirf ek runtime ke liye compile hoti hai: ya **Node** (dev server/tests) ya **Electron** (desktop app). Galat runtime ke liye compiled ho to app start nahi hoti aur `NODE_MODULE_VERSION` wali error aati hai.

- `npm run dev`, `npm test` and every `test:*` suite need the **Node** build. Use `npm run rebuild:node`.
- `npm run dev:electron` needs the **Electron** build. Use `npm run rebuild:electron`.
- `build:unpack` and `build:win` switch to Electron themselves and switch back to Node when they finish.

If you see an error like `was compiled against a different Node.js version (NODE_MODULE_VERSION ...)`, run the matching rebuild command above.

---

## 1. Development

### `npm run dev`
```json
"dev": "concurrently \"npm run dev:server\" \"npm run dev:ui\""
```
- **Kya karti hai:** Starts the API server (port `3001`) and the UI (port `5173`) together in one terminal.
- **Kab chalayein:** Every day while working on the project. This is the main command.
- **Kaise:** Run `npm run dev`, then open `http://localhost:5173` in the browser. Press `Ctrl+C` to stop.
- **Kyun:** The UI calls `/api/...`, and Vite forwards those calls to the API on port 3001. Both must run together.
- **Notes:**
  - It uses the real database in `data/pharmacy.db` and the real `backups/` folder. The backup scheduler also runs, so a backup can appear while you work.
  - The API restarts by itself whenever you save a server file.
  - With `PHARMACARE_SAMPLE_DATA=true` in `.env`, an empty database gets a demo store, medicines and customers. Remove that line if you want an empty database.
  - Needs the Node build of better-sqlite3 (`npm run rebuild:node` if you ran Electron before).

### `npm run dev:server`
```json
"dev:server": "tsx watch server/api.ts"
```
- **Kya karti hai:** Starts **only the API server** on `http://localhost:3001`, restarting on every server file change (`tsx watch`).
- **Kab chalayein:** When you are working only on backend code, or want the server logs in a separate terminal.
- **Kaise:** `npm run dev:server`. Use a different port with `PORT=4000 npm run dev:server`.
- **Kyun:** It is lighter than `dev` when you don't need the UI. `npm run dev` also uses it internally.

### `npm run dev:ui`
```json
"dev:ui": "vite"
```
- **Kya karti hai:** Starts **only the React UI** (Vite dev server) on `http://localhost:5173`, with instant reload on save.
- **Kab chalayein:** When the API is already running in another terminal (`dev:server`) and you only want to restart the UI.
- **Kaise:** `npm run dev:ui`.
- **Kyun:** The UI on its own cannot load data; without the API every `/api` call fails. Normally just use `npm run dev`.

---

## 2. Code checking and build

### `npm run lint`
```json
"lint": "tsc --noEmit"
```
- **Kya karti hai:** Type-checks all TypeScript code (`src/`, `server/`, `shared/`, `electron/`) without creating any files. Unused imports and variables are also errors.
- **Kab chalayein:**
  - before every commit;
  - after any big change;
  - before making a build.
- **Kaise:** `npm run lint`. No output means everything is OK.
- **Kyun:** It catches type mistakes, wrong function arguments and dead code before they reach the client. This is the project's only lint and typecheck step.

### `npm run build`
```json
"build": "prisma generate && tsc && vite build"
```
- **Kya karti hai:** Runs three steps in order:
  1. `prisma generate` creates the database client code;
  2. `tsc` type-checks the code;
  3. `vite build` builds the production UI into `dist/`.
- **Kab chalayein:** To check that the web UI builds cleanly in production mode. It is a good final check before a release.
- **Kaise:** `npm run build`.
- **Kyun:** It confirms the whole project compiles. **Note:** this is *not* the desktop app; for that use `build:unpack` / `build:win`. The `dist/` folder is only for checking and can be deleted.

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
- **Kyun:** Server code imports the client from `server/generated/prisma`. If it is missing or old, the server will not compile or will use old columns.
- **Adding a new column (complete checklist):**
  1. add the field to the model in `prisma/schema.prisma`;
  2. add it to the `CREATE TABLE` in `server/database/schema.ts`;
  3. add an entry to `COLUMN_MIGRATIONS` in the same file, so old databases get the column on startup;
  4. run `npm run prisma:generate`.

> There is no `prisma migrate` / `db push` in this project on purpose. The app creates and upgrades its own database at startup.

---

## 4. Tests

> **Roman Urdu:** Tests kabhi bhi asli database ya backups ko touch nahi karte. Har test apna naya temporary database banata hai (OS temp folder me), sample data ke sath. Is liye tests safely kabhi bhi chala sakte hain.
>
> Tests ke liye better-sqlite3 ka **Node** build chahiye (`npm run rebuild:node`).

### `npm test`
```json
"test": "vitest run"
```
- **Kya karti hai:** Runs all **unit tests** (`*.spec.ts` files in `server/`, `shared/` and `src/`) once and exits. These test pure logic, such as backup schedule math, license days, invoice settings and TOTP.
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

### Integration suites (`test:functional`, `test:phase1` … `test:phase5`)
```json
"test:functional": "tsx server/tests/functional_test.ts",
"test:phase1": "tsx server/tests/phase1_test.ts",
...
"test:phase5": "tsx server/tests/phase5_test.ts"
```

**What they do:**
- Each one starts the real API in-process on a fresh temp database and calls real `/api` routes, checking status codes and responses end to end.
- They print `✓` / `✗` for each step and exit with an error if anything fails.

**When to run them:**
- after any backend or route change;
- before a commit;
- **always before giving a build to the client**.
- Run the suite that matches the area you changed, or all of them.

**How to run them:**
- `npm run test:phase3` runs one suite.
- To run all of them:
  ```bash
  npm run test:functional && npm run test:phase1 && npm run test:phase2 && npm run test:phase3 && npm run test:phase4 && npm run test:phase5
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
  - with `-- --rotate` only if the key is leaked or lost.
- **Kaise:**
  ```bash
  npm run developer:key              # create the key (refuses if one already exists)
  npm run developer:key -- --show    # show the QR of the existing key again
  npm run developer:key -- --rotate  # replace the key (old builds keep the old key)
  ```
  After creating it, restart `npm run dev`.
- **Kyun:**
  - The Developer account signs in with this authenticator code (no password).
  - The setup wizard on every new install needs it.
  - The license is signed with it.
  - `build:unpack` / `build:win` **refuse to build** without this file, because the key is baked into the build.
- **Warning:**
  - Never commit `.env.developer` or share it (it is already in `.gitignore`).
  - Keep a copy in a password manager.
  - If you lose it, see `docs/DEVELOPER_RECOVERY.md`.

---

## 6. Desktop app (Electron)

### `npm run dev:electron`
```json
"dev:electron": "electron-vite dev"
```
- **Kya karti hai:** Opens the real **desktop window** in development mode. The UI reloads live and the API runs inside the desktop app.
- **Kab chalayein:** When you need to test desktop-only features: thermal printing, backup/restore file dialogs, window behaviour.
- **Kaise:**
  ```bash
  npm run rebuild:electron                      # once, before (switches the DB library to Electron)
  env -u ELECTRON_RUN_AS_NODE npm run dev:electron
  ```
  In the VS Code terminal, use `env -u ELECTRON_RUN_AS_NODE`: VS Code sets that variable, and it makes Electron run like plain Node with no window.
  When you finish, run `npm run rebuild:node` before going back to `npm run dev` or tests.
- **Kyun:** The browser (`npm run dev`) cannot test native desktop features.

### `npm run build:electron`
```json
"build:electron": "electron-vite build"
```
- **Kya karti hai:** Compiles the desktop app code (main process, preload, renderer UI and API) into the `out/` folder. **It does not make an installer.**
- **Kab chalayein:** Rarely by hand. Use it to check that the desktop bundle compiles. `build:unpack` and `build:win` run this step themselves.
- **Kaise:** `npm run build:electron` (needs `.env.developer`).
- **Kyun:** It is the first step of packaging. It is useful on its own to find bundle errors quickly.

### `npm run build:unpack`
```json
"build:unpack": "electron-vite build && npm run native:reset && electron-builder --dir && npm run rebuild:node"
```
- **Kya karti hai:**
  1. builds the app into `out/`;
  2. clears the stale native marker;
  3. packages it as a **ready-to-run folder** (no installer) in `release/<platform>-unpacked/`;
  4. switches better-sqlite3 back to Node, so `npm run dev` and the tests keep working.
- **Kab chalayein:** To test the real packaged app before making the installer: fresh install behaviour, setup wizard, no sample data, printing, backups.
- **Kaise:**
  ```bash
  npm run build:unpack
  # Linux: run the app
  ./release/linux-unpacked/pharmacy-management-system
  ```
- **Kyun:** It is faster than a full installer and shows exactly what the client will get.
- **Needs:** `.env.developer` (`npm run developer:key`).

### `npm run build:win`
```json
"build:win": "electron-vite build && npm run native:reset && electron-builder --win nsis && npm run rebuild:node"
```
- **Kya karti hai:** The same steps as `build:unpack`, but makes the **Windows installer** (`.exe`, NSIS) in `release/`. The installer lets the user choose the install folder.
- **Kab chalayein:** When you are giving a new version to a client (a release).
- **Kaise:** Run it **on a Windows PC** (the native database library must be built for Windows):
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

## 7. Native module helpers (better-sqlite3)

### `npm run rebuild:electron`
```json
"rebuild:electron": "npm run native:reset && electron-builder install-app-deps"
```
- **Kya karti hai:** Recompiles better-sqlite3 for **Electron**.
- **Kab chalayein:** Once, before `npm run dev:electron`, or when Electron shows a `NODE_MODULE_VERSION` error.
- **Kaise:** `npm run rebuild:electron`.
- **Kyun:** Electron uses a different internal Node version, so the database library must be compiled for it.
- **After it:** `npm run dev` and the tests **will not work** until you run `npm run rebuild:node`.

### `npm run rebuild:node`
```json
"rebuild:node": "npm rebuild better-sqlite3 && npm run native:reset"
```
- **Kya karti hai:** Recompiles better-sqlite3 for normal **Node**.
- **Kab chalayein:**
  - after using `dev:electron` / `rebuild:electron`;
  - when `npm run dev` or the tests show a `NODE_MODULE_VERSION` error;
  - after updating Node.js.
- **Kaise:** `npm run rebuild:node`.
- **Kyun:** It brings the dev server and tests back to a working state. `build:unpack` / `build:win` run it automatically at the end.

### `npm run native:reset`
```json
"native:reset": "node -e \"require('fs').rmSync('node_modules/better-sqlite3/build/Release/.forge-meta',{force:true})\""
```
- **Kya karti hai:** Deletes one small marker file (`.forge-meta`) inside better-sqlite3's build folder. It is safe and does nothing if the file isn't there.
- **Kab chalayein:** You normally don't run it yourself; the rebuild and build scripts call it. Run it by hand only if a packaged app crashes on start with a database library error.
- **Kaise:** `npm run native:reset`.
- **Kyun:** If this marker is stale, electron-builder thinks the library is already built for Electron and **skips the rebuild**. The installer then ships the Node version and the app fails on the client's PC.

---

## Common workflows

**New PC / fresh clone:**
```bash
npm install
npm run prisma:generate
npm run developer:key        # first time only, scan the QR
npm run dev                  # open http://localhost:5173 and complete the setup wizard
```

**Daily work:**
```bash
npm run dev
# ...code...
npm run lint && npm test
```

**Before a commit:**
```bash
npm run lint && npm test && npm run test:functional && npm run test:phase1 && npm run test:phase2 && npm run test:phase3 && npm run test:phase4 && npm run test:phase5
```

**Testing the desktop app:**
```bash
npm run rebuild:electron
env -u ELECTRON_RUN_AS_NODE npm run dev:electron
npm run rebuild:node         # when finished
```

**Client release (on Windows):**
```bash
npm run lint && npm test     # plus all test:* suites
npm run build:win            # installer in release/
```

**Fresh database during development:** stop `npm run dev`, delete `data/pharmacy.db*` (and `backups/*` if wanted), then start `npm run dev` again. The database is recreated empty, with sample data if `PHARMACARE_SAMPLE_DATA=true` is in `.env`.
