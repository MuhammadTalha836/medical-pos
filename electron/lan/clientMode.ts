import { X509Certificate } from 'crypto';
import { app, safeStorage, session, type BrowserWindow, type Certificate } from 'electron';
import { readLanConfig, writeLanConfig, type LanConfig } from '../../server/lan/lanConfig';
import { sameFingerprint, shortFingerprint, terminalNameError } from '../../server/lan/lanMath';
import { verifyTotpStep } from '../../server/security/totp';
import { getDeveloperSecret } from '../../server/security/developerKey';
import { connectPageUrl, type ConnectState } from './connectPage';
import { FingerprintMismatchError, httpsJson } from './httpsJson';
import { restartApp } from '../restart';

// Counter PC (LAN mode, M11): no database here. The window shows the main computer's app; this process adds the
// counter key to its requests (the page never sees it) and accepts only the main computer's pinned certificate.

const encrypt = (text: string) => (safeStorage.isEncryptionAvailable()
  ? `enc:${safeStorage.encryptString(text).toString('base64')}`
  : `plain:${Buffer.from(text).toString('base64')}`);

function decrypt(stored: string | undefined): string | null {
  if (!stored) return null;
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  } catch { /* unreadable: pair again */ }
  return null;
}

const certificateFingerprint = (certificate: Certificate) => {
  try {
    return new X509Certificate(certificate.data).fingerprint256;
  } catch {
    return null;
  }
};

const serverOrigin = (config: Pick<LanConfig, 'serverHost' | 'serverPort'>) => `https://${config.serverHost}:${config.serverPort}`;

/** Friendly reason for a failed connection */
function reason(error: unknown): string {
  if (error instanceof FingerprintMismatchError) return error.message;
  const code = (error as { code?: string })?.code;
  if (code === 'ECONNREFUSED') return 'The main computer refused the connection. Is PharmaCare Pro open on it?';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'The main computer cannot be reached. Check the network cable or Wi-Fi.';
  if (code === 'ENOTFOUND') return 'That address was not found. Check the main computer address.';
  return error instanceof Error ? error.message : 'Could not connect.';
}

export class CounterMode {
  private window: BrowserWindow | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private hooked = false;

  constructor(private readonly dataDir: string) {}

  get config(): LanConfig {
    return readLanConfig(this.dataDir);
  }

  /** Origins the counter window may navigate to */
  allowedOrigin(): string | null {
    const c = this.config;
    return c.mode === 'client' && c.serverHost ? serverOrigin(c) : null;
  }

  private show(state: ConnectState) {
    void this.window?.loadURL(connectPageUrl(state));
  }

  /** Shows the pairing form; `fromApp` when a working single-PC app asked for it */
  showSetup(window: BrowserWindow, options: { fromApp?: boolean; message?: string } = {}) {
    this.window = window;
    const c = this.config;
    this.show({ view: 'setup', host: c.serverHost, port: c.serverPort, name: c.terminalName, fromApp: options.fromApp, paired: c.mode === 'client', message: options.message });
  }

  /** Counter start-up: sets up the pinned certificate and the key header, then connects */
  start(window: BrowserWindow) {
    this.window = window;
    const c = this.config;
    const key = decrypt(c.terminalKeyEnc);
    if (!c.serverHost || !c.serverPort || !c.fingerprint || !key) {
      this.showSetup(window, { message: c.serverHost ? 'This counter needs to be paired again.' : undefined });
      return;
    }
    if (!this.hooked) {
      this.hooked = true;
      const origin = serverOrigin(c);
      // Only the main computer's own certificate is trusted, and only for its address
      app.on('certificate-error', (event, _contents, url, _error, certificate, callback) => {
        if (url.startsWith(`${origin}/`) && sameFingerprint(certificateFingerprint(certificate), this.config.fingerprint)) {
          event.preventDefault();
          callback(true);
        } else {
          callback(false);
        }
      });
      session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
        details.requestHeaders['X-Terminal-Key'] = key;
        details.requestHeaders['X-App-Version'] = app.getVersion();
        callback({ requestHeaders: details.requestHeaders });
      });
      window.webContents.on('did-fail-load', (_e, _code, _desc, url, isMainFrame) => {
        if (isMainFrame && url.startsWith(origin)) this.scheduleRetry('The connection was lost.');
      });
    }
    void this.connect();
  }

  /** Checks the main computer, then loads its app (or shows why not) */
  async connect() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const c = this.config;
    const key = decrypt(c.terminalKeyEnc);
    if (!c.serverHost || !c.serverPort || !key) return this.showSetup(this.window!);
    try {
      const health = await httpsJson({
        host: c.serverHost,
        port: c.serverPort,
        path: '/api/lan/health',
        pinnedFingerprint: c.fingerprint,
        headers: { 'X-Terminal-Key': key, 'X-App-Version': app.getVersion() }
      });
      if (health.status !== 200) throw new Error(`The main computer answered with an error (${health.status}).`);
      if (!health.body.paired) {
        return this.showSetup(this.window!, { message: 'This counter was removed on the main computer. Make a new pairing code there and pair again.' });
      }
      if (health.body.version !== app.getVersion()) {
        return this.show({ view: 'update', clientVersion: app.getVersion(), serverVersion: health.body.version });
      }
      this.attempt = 0;
      await this.window?.loadURL(`${serverOrigin(c)}/`);
    } catch (error) {
      if (error instanceof FingerprintMismatchError) {
        return this.showSetup(this.window!, { message: error.message });
      }
      this.scheduleRetry(reason(error));
    }
  }

  private scheduleRetry(detail: string) {
    const c = this.config;
    const delay = Math.min(30, 2 ** Math.min(this.attempt, 5)) * 1000;
    this.attempt++;
    const text = `${detail} Trying again in ${Math.round(delay / 1000)} seconds.`;
    const currentUrl = this.window?.webContents.getURL() ?? '';
    if (currentUrl.startsWith('data:')) {
      void this.window?.webContents.executeJavaScript(`window.updateStatus && window.updateStatus(${JSON.stringify(text)})`).catch(() => undefined);
      if (!currentUrl.includes('connecting')) this.show({ view: 'connecting', host: c.serverHost, port: c.serverPort, message: text, paired: true });
    } else {
      this.show({ view: 'connecting', host: c.serverHost, port: c.serverPort, message: text, paired: true });
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  /** Step 1 of pairing: reach the main computer and read its certificate's fingerprint */
  async checkServer(host: string, port: number) {
    if (!host || !Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, error: 'Enter a valid address and port.' };
    try {
      const res = await httpsJson({ host, port, path: '/api/lan/health' });
      if (res.status !== 200 || res.body?.app !== 'PharmaCare Pro') return { ok: false, error: 'That computer is not a PharmaCare Pro main computer.' };
      if (res.body.mode !== 'server') return { ok: false, error: 'That computer is not set up as the main computer (Developer → Network).' };
      if (res.body.version !== app.getVersion()) {
        return { ok: false, error: `Versions differ: this computer ${app.getVersion()}, main computer ${res.body.version}. Install the same version first.` };
      }
      return { ok: true, serverName: String(res.body.server_name || 'Main computer'), fingerprintShort: shortFingerprint(res.fingerprint), fingerprint: res.fingerprint };
    } catch (error) {
      return { ok: false, error: reason(error) };
    }
  }

  /** Step 2: sends the code; on success saves the pinned fingerprint and the key, then restarts as a counter */
  async pair(input: { host: string; port: number; code: string; name: string }) {
    const nameError = terminalNameError(input.name);
    if (nameError) return { ok: false, error: nameError };
    const check = await this.checkServer(input.host, input.port);
    if (!check.ok || !check.fingerprint) return { ok: false, error: check.error };
    try {
      const res = await httpsJson({
        host: input.host,
        port: input.port,
        path: '/api/lan/pair',
        method: 'POST',
        pinnedFingerprint: check.fingerprint,
        body: { code: input.code, name: input.name.trim(), version: app.getVersion() }
      });
      if (res.status !== 200 || typeof res.body?.key !== 'string') return { ok: false, error: res.body?.error || 'Pairing failed.' };
      if (res.body.fingerprint && !sameFingerprint(res.body.fingerprint, check.fingerprint)) {
        return { ok: false, error: 'The security code changed while pairing. Check the network and try again.' };
      }
      writeLanConfig(this.dataDir, {
        ...this.config,
        mode: 'client',
        serverHost: input.host,
        serverPort: input.port,
        fingerprint: check.fingerprint,
        terminalName: res.body.terminal_name,
        terminalKeyEnc: encrypt(res.body.key)
      });
      restartApp(600);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: reason(error) };
    }
  }

  /** Back to a single-PC app, after the Developer authenticator code (checked with the master key in this build) */
  leaveCounterMode(code: string) {
    let secret: string;
    try {
      secret = getDeveloperSecret();
    } catch {
      return { ok: false, error: 'This build has no Developer key.' };
    }
    if (verifyTotpStep(secret, code) === null) return { ok: false, error: 'Wrong or expired authenticator code.' };
    const c = this.config;
    writeLanConfig(this.dataDir, { mode: 'standalone', port: c.port });
    restartApp(300);
    return { ok: true };
  }
}
