# Developer key, license and recovery

How the developer master key works, and what to do when something goes wrong.

## 1. The master key

- One TOTP key (one entry in the developer's authenticator app) unlocks **every** installation.
- It is created once with `npm run developer:key`, which writes `.env.developer` and prints a QR code. Scan it with Google Authenticator, Microsoft Authenticator or Aegis.
- `.env.developer` is git-ignored. **Keep a copy of the manual key in a password manager.** Without it, you cannot sign in as the developer or extend a demo on stores that run your builds.
- `npm run build:unpack` / `npm run build:win` bake the key and the developer email into the app. A build without `.env.developer` fails on purpose, so a release can never ship without a key.
- The key is used for:
  - unlocking the first-run setup wizard;
  - developer sign-in;
  - signing the Demo/Full license record.
- Every code works once. Reusing a code, even within its 30 seconds, is rejected, so wait for the next code.

## 2. Installing at a pharmacy

1. Install the app and start it. The setup screen asks only for the code from your authenticator app.
2. Enter the store name and address.
3. Create the Admin: full name, username and a password of at least 8 characters. The owner signs in with these.
4. Choose the backup folder (preferably a second drive or a USB/cloud folder), the frequency and the time.
5. Choose what the Admin may do, and the Admin policies. For example, Admin can create cashiers; Admin cannot create other admins.
6. Choose **Demo** (number of days) or **Full**.
7. Review, then **Complete & Lock Setup**. The wizard can never run again on that installation.

After setup, the Admin creates cashiers (username + password) under Settings → Users. Only the developer uses an authenticator.

## 3. Demo period

- When a demo ends, Admin and Cashier cannot sign in. Anyone already signed in is signed out on their next action. All data is kept.
- To extend it: sign in as Developer (login screen → Developer tab), then go to **Developer Settings → License**:
  - **Extend demo**: adds days. An expired demo is extended from today.
  - **New demo from today**: replaces the license.
  - **Activate Full**: removes the time limit.
- Setting the PC clock back does not add days. Days are counted from the latest time the app has seen, and the attempt is written to the audit log.
- Editing the database to change the license (for example `license_mode`) breaks its signature. The app then treats the license as ended until the developer sets it again.

## 4. Lost phone, or the key leaked

- **Lost phone, key copy available:** run `npm run developer:key -- --show` on your PC and scan the QR on the new phone.
- **Lost phone, no copy of the key:** you cannot sign in as developer on stores running the old builds.
  1. Create a new key with `npm run developer:key -- --rotate`.
  2. Build again.
  3. Update each store's app. Their data and license stay, but the license is signed with the old key, so after the update it shows as ended; sign in as developer and set Demo/Full again.
- **Key leaked:** rotate it in the same way and update every store. Until a store is updated, whoever has the old key can unlock developer functions there.
- **Known limit:** the key is inside the installed program. A determined person with reverse-engineering skills could extract it. This is why the key must be rotated if a build is ever shared publicly.

## 5. Existing installations after this update

- The developer signs in with the **master key** code from now on; the old per-installation QR codes no longer work.
- An installation that was set up before the license existed has no license record, so Admin and Cashier sign-in stays blocked until the developer signs in and sets Demo or Full once in Developer Settings → License.
