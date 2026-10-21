# PharmaCare Pro - Complete Disaster Recovery & Hardware Failure Guide

**Document Version:** 2.0  
**Target Audience:** Pharmacy Owners, Cashiers, System Administrators, IT Field Technicians  
**System Architecture:** 100% Offline Desktop POS with Embedded SQLite WAL Engine

---

## 1. Overview & Disaster Recovery Architecture

PharmaCare Pro operates entirely offline with zero cloud dependency. All store data—including inventory batches, sales invoices, cashier shifts, customer khata balances, and audit logs—is stored in a single embedded SQLite database:

```
./data/pharmacy.db
./data/pharmacy.db-wal  (Write-Ahead Log)
./data/pharmacy.db-shm  (Shared Memory Index)
```

Because there is no external cloud dependency, **the safety of the pharmacy's data depends entirely on regular local and multi-destination backups**.

### Backup Mechanisms Supported
1. **Automated Shift-Closing Backups**: Triggered automatically every time a cashier closes their register shift (`pharmacy_backup_auto_shift_[timestamp].db`).
2. **Automated Scheduled Backups**: Configurable background daemon running every 2, 4, 8, 12, or 24 hours.
3. **Multi-Destination Dual Backup**: Automatically creates copies simultaneously to the local SSD (`./backups`) and an external destination (e.g. USB flash drive, external hard drive, or local network NAS mount).
4. **Safety Rollback Snapshots**: Before any restore operation takes place, a snapshot of the current database is automatically created (`pharmacy_backup_pre_restore_[timestamp].db`).
5. **SHA-256 Checksum Verification**: Every backup generates a cryptographic `.sha256` sidecar file to verify that the file has not suffered bit rot, truncation, or disk corruption.

---

## 2. Hardware Failure & Emergency Recovery Scenarios

### Scenario A: Complete Hardware Failure (Computer Broken / Burned / Stolen)

If the main POS computer experiences catastrophic failure (motherboard failure, drive death, physical theft):

#### Step 1: Procure Replacement Hardware
- Any PC running Windows 10/11, Ubuntu Linux 20.04+, or macOS with 4GB+ RAM and 20GB+ storage.
- Connect POS peripherals: Receipt printer (80mm/58mm thermal USB), barcode scanner.

#### Step 2: Install PharmaCare Pro Software
1. Transfer the application package or clone the repository to the new computer.
2. Ensure Node.js (v18 or v20 LTS) is installed.
3. Run in terminal:
   ```bash
   npm install
   npx prisma generate
   ```

#### Step 3: Locate Backup Media
1. Plug in the external USB drive or open the secondary backup folder where automated backups were synced.
2. Locate the most recent valid backup file:
   Example: `pharmacy_backup_auto_daily_2026-10-21T18-00-00.db` and its companion `pharmacy_backup_auto_daily_2026-10-21T18-00-00.db.sha256`.

#### Step 4: Verify SHA-256 Checksum Integrity (Offline)
Before restoring, verify the cryptographic hash to confirm the file is not corrupted:

- **On Windows (PowerShell)**:
  ```powershell
  Get-FileHash -Algorithm SHA256 .\pharmacy_backup_auto_daily_2026-10-21T18-00-00.db
  ```
  Compare the output hash with the contents of the `.sha256` file:
  ```powershell
  Get-Content .\pharmacy_backup_auto_daily_2026-10-21T18-00-00.db.sha256
  ```

- **On Linux / macOS (Bash)**:
  ```bash
  sha256sum -c pharmacy_backup_auto_daily_2026-10-21T18-00-00.db.sha256
  # Expected output: pharmacy_backup_auto_daily_2026-10-21T18-00-00.db: OK
  ```

#### Step 5: Restore the Database

##### Method 1: Using the PharmaCare Pro Interface (Recommended)
1. Start the application:
   ```bash
   npm run dev
   # or
   npm start
   ```
2. Navigate to **Backup & Recovery** in the sidebar.
3. Click **"Restore from Custom File..."**.
4. Use the native file picker to select the verified `.db` backup file from your USB or folder.
5. Click **Confirm Restore**. The application will automatically take a pre-restore safety snapshot and replace the active database with full referential integrity.

##### Method 2: Manual Cold Restore (If App is Stopped)
1. Ensure the PharmaCare Pro server and Electron process are completely closed.
2. Navigate to the project root directory.
3. Remove or rename the existing data folder:
   ```bash
   # Windows PowerShell
   Rename-Item -Path .\data\pharmacy.db -NewName pharmacy.db.old -ErrorAction SilentlyContinue
   Remove-Item -Path .\data\pharmacy.db-wal, .\data\pharmacy.db-shm -ErrorAction SilentlyContinue

   # Linux / macOS Bash
   mv data/pharmacy.db data/pharmacy.db.old 2>/dev/null || true
   rm -f data/pharmacy.db-wal data/pharmacy.db-shm
   ```
4. Copy the verified backup file into `./data/pharmacy.db`:
   ```bash
   # Windows PowerShell
   Copy-Item -Path "E:\PharmacyBackups\pharmacy_backup_xxxx.db" -Destination .\data\pharmacy.db

   # Linux / macOS Bash
   cp "/media/usb/pharmacy_backup_xxxx.db" ./data/pharmacy.db
   ```
5. Launch the application:
   ```bash
   npm start
   ```

---

### Scenario B: Accidental Data Corruption or Erroneous Audit Reset

If an operator mistakenly deleted invoices or executed a Stock Zero audit reset by accident:

1. Open **Backup & Recovery** in the sidebar.
2. Under **Available Local Backups**, find the snapshot taken immediately prior to the event (or the `pre_restore` snapshot created automatically before changes).
3. Click the **Restore** button next to that snapshot.
4. Confirm the prompt. The system will swap in the pristine database snapshot and restart database connections.

---

## 3. Configuring Multi-Destination Dual Backups (USB Flash Drive)

For bulletproof disaster recovery, the pharmacy should **always** have an external USB drive plugged into the POS terminal.

### Setting up USB Auto-Sync:
1. Plug an external USB flash drive into the POS computer (e.g. Assigned Drive Letter `E:\` on Windows or `/media/usb` on Linux).
2. Create a folder on the USB drive named `PharmaCare_Vault`.
3. Open PharmaCare Pro as **Admin**.
4. In the sidebar, navigate to **Backup & Recovery**.
5. Under **Multi-Destination Storage**:
   - Primary Backup Folder: `./backups` (default local SSD)
   - Secondary / External Folder: Click **"Browse External Drive..."** and select `E:\PharmaCare_Vault` (or type the path).
6. Under **Automated Background Schedule**:
   - Select **Interval**: e.g., "Every 4 Hours" or "Every 12 Hours".
   - Check **"Enable Background Auto-Backup"**.
   - Click **Save Backup Preferences**.

Whenever a backup is created (manual, shift close, or scheduled), the engine atomically saves to `./backups` and concurrently syncs a copy with `.sha256` checksum to the USB drive!

---

## 4. Disaster Recovery Checklist for Pharmacy Staff

| Step | Action | Frequency | Responsible Person |
| :--- | :--- | :--- | :--- |
| 1 | Keep USB backup flash drive connected to POS terminal | Always | Cashier / Pharmacist |
| 2 | Verify "Last Backup Status" shows green checkmark on Dashboard | Daily at opening | Cashier |
| 3 | Close Cashier Shift at end of working hours (triggers auto-backup) | Every Shift End | Shift Cashier |
| 4 | Rotate or copy USB backup to home / off-site storage | Weekly | Pharmacy Owner |
| 5 | Run Database Optimization (VACUUM & defragmentation) | Monthly | Administrator |

---

## 5. Technical Verification & Integrity Tests

To verify that an SQLite database file has not been damaged:
```sql
PRAGMA integrity_check;
PRAGMA quick_check;
PRAGMA foreign_key_check;
```
If the output of `PRAGMA integrity_check;` is `ok`, the database B-Tree, indexes, and tables are 100% physically intact.
PharmaCare Pro's restore engine runs this verification check automatically before finalizing any database restore.
