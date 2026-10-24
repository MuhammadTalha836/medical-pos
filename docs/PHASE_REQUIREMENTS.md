# Phase Requirements: Offline Pharmacy Management Software Additions

The phased requirements below are built, tested and refined one phase at a time.

---

## Loop Context & Overview
- **Project:** Offline Pharmacy Management Software (Additional Requirements)
- **Framework:** Ralph Loop (Iterative task breakdown, code generation, testing, and refinement loops)
- **Primary Goals:** Implement 58mm/80mm thermal-only templates, a secure Developer Role with TOTP-based offline login, backup retention & frequency scheduling, protected medical store identity, and backend role-based access control (RBAC).

---

## Phase 1: Core Setup, Database Models, and Developer TOTP Authentication
**Objective:** Set up backend database schemas, first-time installation setup wizard, and offline TOTP authentication for the Developer role.

### Task 1.1: Database Schema & Models
- [x] Create/Update User model to support three distinct roles: `DEVELOPER`, `ADMIN`, and `CASHIER`.
- [x] Implement secure password hashing (e.g., Argon2 or bcrypt) for Admin and Cashier accounts.
- [x] Create system settings storage for Developer configuration (Store name, address, backup retention limits, backup frequency, invoice footer settings, and permission toggles).
- [x] Ensure the TOTP secret key is securely stored and never exposed in plaintext logs, API responses, or backups accessible to non-developers.

### Task 1.2: First-Time Setup Wizard & TOTP Integration
- [x] Create a first-run setup wizard triggered on the initial software launch.
- [x] Capture and validate the Developer email address as the unique Developer identifier.
- [x] Generate a secure TOTP secret, render a QR code, and provide a manual setup key for standard authenticator apps (e.g., Google Authenticator).
- [x] Require a valid TOTP code entry to verify setup completion before unlocking the application.
- [x] Lock out first-run setup permanently once completed, preventing non-developer reset attempts.

### Task 1.3: Offline Developer Login
- [x] Build the Developer Login screen requesting Developer Email and the current dynamic TOTP code.
- [x] Implement offline TOTP verification using standard time windows to handle clock drift.
- [x] Add rate-limiting and temporary account lockouts after repeated failed login attempts.
- [x] Ensure authentication functions seamlessly without internet connectivity.

---

## Phase 2: Role-Based Access Control (RBAC), Audit Logging, and Developer Settings Page
**Objective:** Build the protected Developer Settings page and enforce backend authorization across all roles and actions.

### Task 2.1: Protected Developer Settings Page UI & Logic
- [x] Build a dedicated Developer Settings page accessible *only* to authenticated Developer accounts.
- [x] Implement controls for:
  - Database backup retention limit (number of versions to retain).
  - Admin permissions to create additional Cashier accounts.
  - Admin permissions to create additional Admin accounts (if multi-admin is enabled).
  - Protected Medical Store Name and Address management.
  - Developer-controlled Invoice Footer information.
- [x] Ensure backend validation enforces that only the Developer can alter these configurations.

### Task 2.2: User & Password Management Rules
- [x] Allow the Developer to create, manage, or change passwords for Admin and Cashier accounts.
- [x] Restrict Admin account creation capabilities based on explicit Developer toggles.
- [x] Prevent Admin and Cashier accounts from modifying Developer credentials, granting themselves Developer privileges, or altering restricted settings.

### Task 2.3: Security Audit Log
- [x] Implement a comprehensive security audit log recording sensitive actions:
  - Account creations, deletions, and password changes.
  - Changes to role permissions, store identity, and invoice footers.
  - Timestamp, acting account, affected account, action performed, and result status.
- [x] Ensure plaintext passwords and TOTP secrets are strictly excluded from logs.

---

## Phase 3: Thermal Invoice Templates & Protected Store Identity
**Objective:** Restrict invoice formatting exclusively to thermal receipt printers, integrate the store identity, and apply the dynamic invoice footer.

### Task 3.1: Thermal-Only Invoice Templates (58 mm & 80 mm)
- [x] Remove all A3, A4, and A5 paper-size options and templates from the codebase and settings interface.
- [x] Implement built-in invoice designs targetting strictly **58 mm** and **80 mm** thermal receipt widths.
- [x] Build an administrator preview and selection interface for thermal templates that persists the choice across application restarts.

### Task 3.2: Protected Store Identity & Footer Integration
- [x] Bind the medical store name and address to the protected identity fields configured by the Developer during setup.
- [x] Prevent Admins from hiding or removing the store name/address via Invoice Settings unless explicitly enabled by the Developer.
- [x] Implement a single, unified Developer-controlled invoice footer configuration that dynamically renders across all 58 mm and 80 mm thermal templates.
- [x] Handle long footer text safely via text wrapping and ensure compatibility with future prints and historical records.

---

## Phase 4: Backup Retention Limit and Automatic Backup Scheduler
**Objective:** Implement local offline backup scheduling, retention limits, and verification safeguards.

### Task 4.1: Backup Retention Limits
- [x] Implement backend logic to enforce the Developer-configured backup retention limit (e.g., keeping only the latest $N$ successful backups).
- [x] Ensure automated cleanup deletes oldest backups *only after* a new backup has completed successfully and passed integrity verification checks.
- [x] Prevent deletion of the last known-good backup if a new backup fails.

### Task 4.2: Backup Frequency & Execution Time Scheduling
- [x] Allow the Developer to define the automatic backup frequency (e.g., daily).
- [x] Allow the Admin to configure only the time of day for the backup execution, bounded by the Developer's frequency rule.
- [x] Implement a local offline scheduler to handle execution, power-off states, and missed scheduled runs gracefully.
- [x] Expose backup statuses, last backup time, next scheduled time, and failure messages in the dashboard.

---

## Phase 5: Testing, Verification, and Acceptance Review
**Objective:** Thoroughly test all security boundaries, offline capabilities, and acceptance criteria.

### Acceptance Criteria Checklist
- [x] **TC-01:** Only 58 mm and 80 mm thermal invoice templates are offered; A3/A4/A5 are removed.
- [x] **TC-02:** Admin can preview/select thermal templates, persisting across restarts.
- [x] **TC-03:** Developer has a dedicated protected settings page with valid input validations.
- [x] **TC-04:** Backup retention limits and Admin account-creation permissions are strictly controlled by the Developer.
- [x] **TC-05:** Developer manages Admin/Cashier passwords; unauthorized roles cannot modify Developer credentials.
- [x] **TC-06:** Medical store name, address, and invoice footer are protected by Developer settings and enforced on backend rendering.
- [x] **TC-07:** RBAC is enforced on backend API endpoints/actions, with actions recorded in the audit log.
- [x] **TC-08:** Initial setup captures Developer email and successfully validates TOTP authenticator setup.
- [x] **TC-09:** Developer login requires a valid current TOTP code and operates fully offline.
- [x] **TC-10:** Setup wizard cannot be re-run by unauthorized users to overwrite credentials.
- [x] **TC-11:** Backup retention (e.g., keeping exactly 4 backups) and scheduling execute reliably offline without compromising safe recovery states.

---

## Recommended Workflow:
1. **Feed Phase by Phase:** Implement one phase at a time (e.g., *"Implement Phase 1 completely, including tests"*).
2. **Review Security Boundaries:** Verify that no security checks rely solely on frontend hiding/UI disabling.
3. **Run Iterative Loops:** Use prompt loops to test edge cases like offline clock drift, failed database backups, and permission override attempts by Admin accounts.