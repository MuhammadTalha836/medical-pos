import { X509Certificate } from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { spawn } from 'child_process';
import type { RequestListener } from 'http';
import { powerSaveBlocker } from 'electron';
import selfsigned from 'selfsigned';

// Main computer of a multi-PC store (LAN mode, M11): the same API also listens on the shop network over HTTPS,
// with a certificate this computer makes once. Counters pin its fingerprint when they pair.

export interface LanCertificate {
  key: string;
  cert: string;
  /** SHA-256 fingerprint, "AB:CD:..." */
  fingerprint: string;
}

/** Loads this computer's certificate, making it the first time (valid 10 years) */
export async function ensureCertificate(dataDir: string): Promise<LanCertificate> {
  const dir = path.join(dataDir, 'lan-cert');
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    const now = new Date();
    const notAfter = new Date(now);
    notAfter.setFullYear(now.getFullYear() + 10);
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'PharmaCare Pro Main Computer' }], {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate: now,
      notAfterDate: notAfter
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
    fs.writeFileSync(certFile, pems.cert);
  }
  const key = fs.readFileSync(keyFile, 'utf8');
  const cert = fs.readFileSync(certFile, 'utf8');
  return { key, cert, fingerprint: new X509Certificate(cert).fingerprint256 };
}

let blockerId: number | null = null;

/** Starts the LAN listener for counters and keeps the computer from sleeping while it runs */
export async function startLanServer(handler: RequestListener, dataDir: string, port: number): Promise<https.Server> {
  const certificate = await ensureCertificate(dataDir);
  process.env.PHARMACARE_CERT_FINGERPRINT = certificate.fingerprint;
  const server = https.createServer({ key: certificate.key, cert: certificate.cert }, handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });
  blockerId = powerSaveBlocker.start('prevent-app-suspension');
  return server;
}

/** Stops taking new counter requests and lets running ones finish */
export function stopLanServer(server: https.Server | null): Promise<void> {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
  blockerId = null;
  if (!server) return Promise.resolve();
  return new Promise(resolve => {
    server.close(() => resolve());
    setTimeout(resolve, 5000);
  });
}

export const FIREWALL_RULE_NAME = 'PharmaCare Pro Server';

/** The command a technician can run by hand (also shown in the guide) */
export const firewallCommand = (port: number) =>
  `netsh advfirewall firewall add rule name="${FIREWALL_RULE_NAME}" dir=in action=allow protocol=TCP localport=${port} profile=private`;

/**
 * Opens the counters' port in Windows Firewall for private networks. Windows asks for administrator approval
 * (UAC); an existing rule with the same name is replaced.
 */
export function allowThroughFirewall(port: number): Promise<{ success: boolean; error?: string }> {
  if (process.platform !== 'win32') return Promise.resolve({ success: false, error: 'This is needed only on Windows.' });
  const commands = `netsh advfirewall firewall delete rule name="${FIREWALL_RULE_NAME}" & ${firewallCommand(port)}`;
  const script = `Start-Process -FilePath cmd.exe -ArgumentList '/c', '${commands.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    child.on('error', err => resolve({ success: false, error: err.message }));
    child.on('exit', code => resolve(code === 0
      ? { success: true }
      : { success: false, error: 'Windows did not allow it. Approve the administrator prompt, or run the command from the guide.' }));
  });
}
