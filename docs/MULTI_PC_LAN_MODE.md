# Multi-PC LAN Mode — Audit-First Implementation Plan

> Add-on to `IMPLEMENTATION_PLAN.md`. Same project: offline Pharmacy POS
> (Electron + React + Prisma 7 + SQLite, Windows).
> Goal: one store with several PCs (e.g. 1 Admin PC + 2 Cashier PCs) sharing ONE database over the local network.

---

## 0. READ FIRST — Instructions for the AI agent

1. Read this file, `IMPLEMENTATION_PLAN.md` and `docs/REQUIREMENTS.md` before starting.
2. Follow the **same mandatory workflow** as `IMPLEMENTATION_PLAN.md` Section 1:
   git safety commit → audit → gap report → **STOP for owner approval** → implement gaps → verify → report → update `docs/PROGRESS.md`.
3. Use the same statuses: ✅ Done, 🟡 Partial, ⚠️ Done but wrong/insecure, ❌ Missing, ➖ Not applicable.
4. Skip only verified ✅ items. Reuse existing code; never build a second version of an existing system.
5. Follow the dependency policy, architecture rules, data conventions and migration rules of `IMPLEMENTATION_PLAN.md`.
6. Explain reports in simple **Roman Urdu**; code, comments and UI text in **English**.
7. Phases are named **L0–L8**. Run only when the owner says "Run LAN Phase LX".
8. Add a "LAN Mode" section to `docs/PROGRESS.md` with IDs L0.1, L0.2, …

**Prerequisite:** Phases 0–2 of `IMPLEMENTATION_PLAN.md` must be ✅ (foundation, schema, security).
Ideally all main phases are complete. If not, report this in L0 and ask the owner how to proceed.

---

## 1. Goals and non-goals

### Goals
- One **Server PC** holds the only database (`app.db`), runs migrations, backups and the scheduler.
- **Client PCs** (cashier terminals) have no database; they use the server over the LAN.
- Works with **no internet**; only a local router/switch is needed.
- **Standalone mode** (single PC, current behaviour) keeps working for single-PC stores.
- All business rules, permissions and validation run **on the server** only.

### Non-goals (do not implement unless the owner approves)
- Selling while the server is unreachable (offline queue / sync). This is complex and risky for stock accuracy.
- Internet/cloud sync between branches.
- Switching from SQLite to PostgreSQL.

### Never do this
- Never share `app.db` through a Windows shared/network folder. SQLite locking is unreliable on network
  file systems and can corrupt the database.

---

## 2. Target architecture

### 2.1 Three app modes (chosen at first run, changeable only by Developer)
| Mode | Database | Business logic | Used for |
|---|---|---|---|
| `STANDALONE` | Local | Local main process | Single-PC store (current behaviour) |
| `SERVER` | Local (the only one) | Local + HTTP API for clients | Admin/main PC in a multi-PC store |
| `CLIENT` | None | Remote, via server API | Cashier terminals |

### 2.2 Data flow
```
Standalone / Server PC:  React → IPC → main → Operation Registry → services → SQLite
Client PC:               React → IPC → main → HTTP (LAN) → Server API → Operation Registry → services → SQLite
```

### 2.3 Operation Registry (the key design)
One registry describes every operation once:
`name → { permission, zodSchema, handler, localOnly }`

- IPC handlers (standalone/server) and HTTP routes (server) both call the same registry.
- Client-mode IPC handlers forward the same operation name and arguments to the server.
- The renderer and `window.api` stay **unchanged** in all modes.
- `localOnly: true` operations run only on the server PC itself and are rejected from remote clients
  (Developer login and Developer settings, setup wizard, backup destination/restore, mode change, file dialogs).

### 2.4 HTTP API style
- RPC style: `POST /api/v1/op/:operationName` with a JSON body of arguments.
- Same response shape as IPC: `{ ok: true, data }` / `{ ok: false, error: { code, message } }`.
- `GET /api/v1/health` returns server status, app version and server time (no secrets).

---

## 3. Libraries

| Package / API | Purpose | Notes |
|---|---|---|
| `fastify` | HTTP API server in the server PC's main process | dependency |
| `selfsigned` | Generate a self-signed TLS certificate for HTTPS on the LAN | dependency, **ask owner** (see L4.6) |
| Node built-in `fetch` | Client → server requests | no library needed |
| Electron `Tray`, `app.setLoginItemSettings`, `powerSaveBlocker`, `safeStorage` | Server lifecycle and secret storage | built-in |

Follow the dependency policy of `IMPLEMENTATION_PLAN.md` Section 2 (record versions, ask before majors).
Live updates use polling first; Server-Sent Events are optional and need no extra library.

---

## 4. Schema additions (safe migrations only: optional columns or defaults)

| ID | Model / change |
|---|---|
| S1 | **Terminal**: id, name (e.g. "Counter 1"), credentialHash, pairedAt, lastSeenAt, appVersion, revokedAt, printerName, paperWidthMm. The server PC itself is also a terminal. |
| S2 | **Session**: id, tokenHash, userId, terminalId, createdAt, lastActivityAt, expiresAt, revokedAt. |
| S3 | **PairingCode**: codeHash, createdById, expiresAt, usedAt (or kept in server memory; document choice). |
| S4 | `terminalId` (optional) on Shift, Invoice, Return, CashMovement, AuditLog. |
| S5 | App settings: mode, serverHost, serverPort, serverCertFingerprint (client), stored locally per PC (not in the shared DB). |

---

## Phase L0 — Readiness audit

| ID | Requirement |
|---|---|
| L0.1 | Main plan Phases 0–2 status confirmed; blockers reported. |
| L0.2 | List every IPC channel with its permission key and validation. Mark channels without backend permission checks (⚠️). |
| L0.3 | Find any IPC handler that contains business logic or direct Prisma calls instead of calling a service (needs refactor in L1). |
| L0.4 | Confirm the renderer never accesses the DB/Node directly. |
| L0.5 | Identify operations that must be `localOnly` (file dialogs, backup/restore, developer, setup, printing hardware access). |
| L0.6 | Identify places that use the local PC clock for stored timestamps (must use server time in LAN mode). |
| L0.7 | Report how invoice numbers and shift numbers are generated today. |
| L0.8 | Write `docs/LAN_ARCHITECTURE.md`: current state, planned changes, operation list with permission and localOnly flag. |

**Verification:** audit document reviewed by owner; no code changes in L0 except documentation.

---

## Phase L1 — Service layer and Operation Registry

| ID | Requirement |
|---|---|
| L1.1 | All business logic lives in services (`src/main/services/`); IPC handlers contain no business logic. |
| L1.2 | Operation Registry created; every existing IPC channel registered with permission, zod schema, handler, localOnly. |
| L1.3 | Services receive an explicit context `{ user, terminalId, now }` instead of reading global session state. |
| L1.4 | A single `getNow()` time source used by services for stored timestamps. |
| L1.5 | Standalone mode works exactly as before (regression check of all main features). |

**Verification:** full manual regression in standalone mode; unit tests still pass; no renderer changes needed.

---

## Phase L2 — App modes and setup

| ID | Requirement |
|---|---|
| L2.1 | First-run wizard asks for mode: Standalone, Server, or Client (before Developer setup on Standalone/Server). |
| L2.2 | Client setup: server IP/host, port, pairing code, terminal name. No Developer setup or database on clients. |
| L2.3 | Mode stored in a local settings file; changing mode later requires Developer authentication on that PC. |
| L2.4 | Converting an existing Standalone installation to Server keeps its database and data. |
| L2.5 | Switching a PC that has a database to Client mode: warn clearly, keep the old database file untouched (renamed backup), ask for confirmation. |
| L2.6 | `docs/LAN_SETUP.md` section: "Upgrading a single-PC store to multi-PC" (existing admin PC becomes Server, cashier PCs installed as Clients). |

**Verification:** fresh install in each mode; Standalone → Server conversion keeps all data.

---

## Phase L3 — Server mode

| ID | Requirement |
|---|---|
| L3.1 | Fastify server starts in Server mode on a configurable port (default `4545`), listening on the LAN. |
| L3.2 | Routes: `POST /api/v1/op/:name` (registry) and `GET /api/v1/health`. Unknown operations rejected. |
| L3.3 | `localOnly` operations rejected for remote requests. |
| L3.4 | SQLite configured for concurrency: WAL journal mode, `busy_timeout`; all writes in transactions. |
| L3.5 | Server time is authoritative for all stored timestamps and TOTP checks. |
| L3.6 | Invoice numbers and shift numbers generated on the server inside transactions (no collisions between terminals). |
| L3.7 | Lifecycle: closing the window minimises to the system tray; server keeps running; "Quit" in tray menu stops it after confirmation. |
| L3.8 | Option to start automatically with Windows (`app.setLoginItemSettings`). |
| L3.9 | Prevent system suspension while the server runs (`powerSaveBlocker`), plus documentation to disable Sleep and use a UPS. |
| L3.10 | Graceful shutdown: stop accepting requests, finish running transactions, close the database. |
| L3.11 | Request log without secrets (no passwords, codes, tokens), with size-based rotation. |
| L3.12 | Server PC can also be used as a normal terminal (Admin and, if needed, sales) through the local IPC path. |

**Verification:** health endpoint reachable from another PC; server survives window close; graceful quit leaves the DB consistent.

---

## Phase L4 — LAN security

| ID | Requirement |
|---|---|
| L4.1 | **Pairing:** Admin/Developer generates a 6-digit pairing code on the server (valid 5 minutes, single use). The client sends it with its terminal name. |
| L4.2 | On successful pairing the server creates a Terminal and returns a random device secret (32+ bytes). Server stores only its hash; client stores it encrypted with `safeStorage`. |
| L4.3 | Every request must carry a valid, non-revoked device credential. Unknown or revoked devices are rejected. |
| L4.4 | **User sessions:** login on a client returns a random session token, kept only in the client's main process (never in the renderer). Server stores the hash with idle timeout and expiry; logout revokes it. The server derives the user from the token and never trusts a client-sent userId or role. |
| L4.5 | Existing lockout and rate limits apply to remote logins and pairing attempts. |
| L4.6 | **Encryption (owner decision):** HTTPS with a self-signed certificate generated on the server; the client pins the certificate fingerprint during pairing. Without it, passwords travel unencrypted over the shop network. Recommend HTTPS. |
| L4.7 | Developer login, Developer settings, setup wizard, mode change, backup destination and restore are available **only on the server PC itself**. |
| L4.8 | Terminal management page (Admin/Developer): list terminals, last seen, app version, rename, revoke. Revocation ends that terminal's sessions immediately. All actions audited. |

**Verification:** unpaired device rejected; revoked device rejected immediately; Cashier token cannot call Admin operations;
`localOnly` operations rejected remotely; with HTTPS enabled, a client refuses a server with a different certificate.

---

## Phase L5 — Client mode

| ID | Requirement |
|---|---|
| L5.1 | Client-mode IPC handlers forward operations to the server; `window.api` unchanged. |
| L5.2 | Connection status indicator always visible (Connected / Reconnecting / Server unavailable). |
| L5.3 | When the server is unavailable: clear banner, automatic retry with backoff, sale-finalising actions disabled, current cart kept on screen. |
| L5.4 | Request timeouts; finalize retried with the **same `clientRequestId`** so a timeout never creates a duplicate invoice. |
| L5.5 | Version check on connect: client and server app versions must match; otherwise show "Please update this PC" and block operations. |
| L5.6 | Clock check: warn if the client clock differs from server time by more than 2 minutes (server time is still used for records). |
| L5.7 | Session expiry handled gracefully: ask the user to log in again without losing the cart. |

**Verification:** unplug network during a sale → clear message → reconnect → finalize once; version mismatch blocked with a clear message.

---

## Phase L6 — Multi-terminal business rules

| ID | Requirement |
|---|---|
| L6.1 | Every shift, invoice, return and cash movement records its `terminalId`. |
| L6.2 | A cashier's open shift is bound to the terminal where it was opened; the cashier cannot sell from another terminal during that shift. |
| L6.3 | A cashier cannot be logged in on two terminals at the same time (new login ends the old session, or is refused; document the choice). |
| L6.4 | Stock checks and decrements happen in server transactions: two terminals selling the last unit → only one succeeds, the other gets a clear "insufficient stock" message. |
| L6.5 | Printer name and paper width stored per terminal; each terminal prints on its own local printer. Receipt rendering happens on the client from server-provided invoice data and settings. |
| L6.6 | Admin Shift Management, invoice lists and dashboard show the terminal name; filter by terminal. |
| L6.7 | Admin dashboard refreshes live data (polling every 10–15 seconds; Server-Sent Events optional). |
| L6.8 | Backups, scheduler and migrations run only on the server; clients can view backup status. |

**Verification:** two clients sell the last unit simultaneously → exactly one sale; shift-terminal binding enforced via direct API calls;
each terminal prints to its own printer.

---

## Phase L7 — Network setup, installer and documentation

| ID | Requirement |
|---|---|
| L7.1 | `docs/LAN_SETUP.md`: hardware (router/switch, cables preferred over WiFi for the server), assigning a **fixed IP** to the server (router DHCP reservation), setting the Windows network profile to **Private**. |
| L7.2 | Firewall: document the rule, e.g. `netsh advfirewall firewall add rule name="MedicalPOS Server" dir=in action=allow protocol=TCP localport=4545 profile=private`. Optionally add it in the NSIS installer for Server installs (ask owner). |
| L7.3 | Server PC checklist: UPS, Sleep disabled, auto-start enabled, tray behaviour explained to staff. |
| L7.4 | Step-by-step: install Server → complete setup → generate pairing code → install each Client → pair → test sale and print on each terminal. |
| L7.5 | Troubleshooting guide: cannot connect (IP, firewall, profile, server not running), version mismatch, certificate mismatch, slow network. |
| L7.6 | Updating a multi-PC store: update the Server first, then every Client; clients are blocked until updated (L5.5). |
| L7.7 | Disaster recovery for multi-PC: restore the backup on a new Server PC, then re-pair clients if the server identity changed. |

**Verification:** a non-developer can follow `docs/LAN_SETUP.md` to set up 1 server + 2 clients.

---

## Phase L8 — Testing and release

| ID | Requirement |
|---|---|
| L8.1 | Test setup: 1 server + at least 2 clients (real PCs or virtual machines on one network). |
| L8.2 | Concurrency: both clients scanning and finalising quickly for 10 minutes; no errors, stock and totals correct. |
| L8.3 | Last-unit race test (L6.4). |
| L8.4 | Network failure during finalize; server restart while clients are open; client restart mid-shift. |
| L8.5 | Security: unpaired device, revoked device, expired session, Cashier calling Admin operations, remote call to `localOnly` operations. |
| L8.6 | Version mismatch and update order test (L7.6). |
| L8.7 | Backup on server while clients are selling; restore test on a new server PC and re-pairing. |
| L8.8 | Standalone mode full regression (single-PC stores must keep working). |
| L8.9 | Results recorded in `docs/TEST_REPORT.md` (LAN section). |

---

## Appendix — LAN acceptance checklist

- [ ] Standalone, Server and Client modes install and work; Standalone unchanged.
- [ ] Only the Server PC has a database; no shared-folder database anywhere.
- [ ] All business rules and permissions enforced on the server.
- [ ] Pairing, device revocation and secure sessions working; HTTPS decision recorded.
- [ ] Developer, setup, backup destination and restore operations work only on the server PC.
- [ ] Server time used for all records; invoice and shift numbers never collide.
- [ ] Stock remains correct under simultaneous sales.
- [ ] Shifts bound to terminals; each terminal prints locally.
- [ ] Clear behaviour when the server is unavailable; no duplicate invoices after retries.
- [ ] Client/server version mismatch blocked with a clear message.
- [ ] `docs/LAN_SETUP.md` complete and tested by following it step by step.
- [ ] All LAN tests passed and recorded.
