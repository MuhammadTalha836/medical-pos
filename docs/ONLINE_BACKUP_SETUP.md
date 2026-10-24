# Online backup (Google Drive): developer setup

When the Developer installs the app at a store, they choose a **backup type**:

| Type | Where backups go |
|---|---|
| **Offline** (default) | The backup folder on this computer, plus the second folder if one is set. Same as before. |
| **Online** | The store owner's Google Drive. Only the newest 2 copies stay on this computer. |
| **Both** | This computer and the owner's Google Drive. This is the safest choice. |

## Which Google account?

Use the **store owner's Gmail**, not the developer's:
- Each store gets its own free 15 GB.
- The pharmacy's data stays with the pharmacy.
- If a PC is stolen, the saved sign-in can only reach that store's own backup folder.
- The owner can recover even if the developer is not available.

The app asks Google only for the `drive.file` permission. With it, the app can see the files it created, in the folder **"100% Offline POS Backups"**. It cannot see anything else in the owner's Drive.

## One-time setup: the Google sign-in client

You do this once for all stores.

1. Open <https://console.cloud.google.com/> and create a project, for example "100% Offline POS".
2. Go to **APIs & Services → Library**, search **Google Drive API**, and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen** (Google Auth Platform).
   - User type: **External**. Enter the app name, support email and developer contact.
   - Scopes: add `.../auth/drive.file`.
   - **Publish the app (set it to "In production").** In "Testing" mode, Google signs the owner out every 7 days and online backups stop. `drive.file` is not a sensitive scope, so Google needs no security review, at most a basic brand check.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Desktop app**.
   - Copy the **Client ID** and the **Client secret**.
5. Save them next to the master key:
   ```bash
   npm run developer:key -- --google <client-id> <client-secret>
   ```
   This adds `PHARMACARE_GOOGLE_CLIENT_ID` / `PHARMACARE_GOOGLE_CLIENT_SECRET` to `.env.developer`. Rotating the master key keeps them.
6. Rebuild (`npm run build:win`). Builds made without these values offer **Offline** only.

Google treats the secret of a Desktop-app client as non-confidential, so it may ship inside the app. The `.env.developer` file is still never committed.

## At the store

1. In the setup wizard's **Backups** step, choose **Online** or **Both**, then click **Connect Google Drive**.
2. The browser opens Google's sign-in page. The **owner** signs in with their Gmail and presses **Allow**.
3. The wizard shows "Connected: owner@gmail.com". Then finish the setup.

You can change any of this later in **Developer → Backup Retention**: the backup type, Connect / Change account / Disconnect, and Upload now. The Admin only sees the status on the Dashboard and can restore from **Backup & Recovery → Online Backups**, with the `can_restore` permission.

## How it behaves

**Encryption.**
- Every online copy is encrypted (AES-256-GCM) with a key derived from the developer master key.
- A file downloaded straight from Drive cannot be opened.
- Any build with the same master key can restore it.
- **If you rotate the master key, older online backups can only be restored by a build that still has the old key.**

**No internet.**
- The backup is still made and checked on this computer. Its upload waits as "pending".
- The upload is retried after 1, 2, 4 … minutes, up to once an hour, and goes up as soon as the internet is back.
- Only the newest waiting backup is uploaded; older waiting ones are skipped.

**Retention.** Drive keeps the newest *N* backups, where *N* is the Developer retention limit. Older ones are deleted from the app's folder.

**Restore from Drive.**
1. The backup is downloaded and decrypted.
2. It is checked against its checksum and verified like a local file.
3. A pre-restore safety copy is taken.
4. The backup is restored.

The current backup type and Google connection are kept, even when the restored backup is older.

**Access removed.** If the owner removes the app from their Google account, uploads fail with "Connect Google Drive again". Backups keep running on this computer in the meantime.
