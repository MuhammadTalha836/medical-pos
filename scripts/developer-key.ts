/**
 * Creates the developer master TOTP key (.env.developer) and prints its QR code for the authenticator app.
 *
 *   npm run developer:key            create the key (refuses if one exists)
 *   npm run developer:key -- --show  print the QR for the existing key again (e.g. a new phone)
 *   npm run developer:key -- --rotate  replace the key (old builds keep the old key; see docs/DEVELOPER_RECOVERY.md)
 *   npm run developer:key -- --google <client-id> <client-secret>
 *       save the Google sign-in client (a "Desktop app" OAuth client) that enables online backups to Google Drive
 *
 * The key is baked into every packaged build. Never commit .env.developer; keep a copy in a password manager.
 */
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { generateTotpSecret, generateTotpUri } from '../server/security/totp';
import { DEFAULT_DEVELOPER_EMAIL, DEVELOPER_KEY_FILE } from '../server/security/developerKey';

const file = path.resolve(process.cwd(), DEVELOPER_KEY_FILE);
const argv = process.argv.slice(2);
const args = new Set(argv);
const GOOGLE_KEYS = ['PHARMACARE_GOOGLE_CLIENT_ID', 'PHARMACARE_GOOGLE_CLIENT_SECRET'] as const;

/** Optional Google sign-in lines kept when the key is created again or rotated */
function googleLines(text: string): string {
  return GOOGLE_KEYS.map(key => new RegExp(`^${key}=.*$`, 'm').exec(text)?.[0]).filter(Boolean).join('\n');
}

function saveGoogleClient(clientId: string | undefined, clientSecret: string | undefined) {
  if (!clientId || !clientSecret || clientId.startsWith('--') || clientSecret.startsWith('--')) {
    throw new Error('Usage: npm run developer:key -- --google <client-id> <client-secret>');
  }
  if (!fs.existsSync(file)) throw new Error(`${DEVELOPER_KEY_FILE} not found. Run "npm run developer:key" first.`);
  const kept = fs.readFileSync(file, 'utf8').split('\n').filter(line => !GOOGLE_KEYS.some(key => line.startsWith(`${key}=`)));
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  kept.push(`PHARMACARE_GOOGLE_CLIENT_ID=${clientId}`, `PHARMACARE_GOOGLE_CLIENT_SECRET=${clientSecret}`, '');
  fs.writeFileSync(file, kept.join('\n'), { mode: 0o600 });
  console.log(`Saved the Google sign-in client in ${DEVELOPER_KEY_FILE}. Rebuild the app so it can back up to Google Drive.`);
}

function readExisting(): { secret: string; email: string } | null {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const secret = /^PHARMACARE_DEV_TOTP_SECRET=(.+)$/m.exec(text)?.[1]?.trim();
  const email = /^PHARMACARE_DEVELOPER_EMAIL=(.+)$/m.exec(text)?.[1]?.trim() || DEFAULT_DEVELOPER_EMAIL;
  return secret ? { secret, email } : null;
}

async function printQr(secret: string, email: string) {
  const uri = generateTotpUri(email, secret, 'PharmaCare Pro Developer');
  console.log(await QRCode.toString(uri, { type: 'terminal', small: true }));
  console.log(`Account : ${email}`);
  console.log(`Manual key (Base32): ${secret.match(/.{1,4}/g)?.join(' ')}`);
}

async function main() {
  const existing = readExisting();

  if (args.has('--google')) {
    const at = argv.indexOf('--google');
    saveGoogleClient(argv[at + 1], argv[at + 2]);
    return;
  }

  if (args.has('--show')) {
    if (!existing) throw new Error(`${DEVELOPER_KEY_FILE} not found. Run "npm run developer:key" first.`);
    await printQr(existing.secret, existing.email);
    return;
  }

  if (existing && !args.has('--rotate')) {
    console.log(`${DEVELOPER_KEY_FILE} already exists. Use --show to print its QR again or --rotate to replace it.`);
    return;
  }

  const email = existing?.email || DEFAULT_DEVELOPER_EMAIL;
  const secret = generateTotpSecret();
  const google = existing ? googleLines(fs.readFileSync(file, 'utf8')) : '';
  fs.writeFileSync(
    file,
    `# PharmaCare Pro developer master key. NEVER commit or share this file.\nPHARMACARE_DEV_TOTP_SECRET=${secret}\nPHARMACARE_DEVELOPER_EMAIL=${email}\n${google ? `${google}\n` : ''}`,
    { mode: 0o600 }
  );
  console.log(`${existing ? 'Rotated' : 'Created'} ${DEVELOPER_KEY_FILE}. Scan this QR with your authenticator app:\n`);
  await printQr(secret, email);
  console.log('\nKeep a copy of the manual key in a password manager. Rebuild the app so new installs use this key.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
