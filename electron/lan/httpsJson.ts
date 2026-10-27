import https from 'https';
import type { TLSSocket } from 'tls';
import { sameFingerprint } from '../../server/lan/lanMath';

// JSON over HTTPS to the main computer (LAN mode, M11). Its certificate is self-signed, so it is not checked
// against a public authority; instead its SHA-256 fingerprint must equal the one pinned at pairing.

export interface HttpsJsonResult {
  status: number;
  body: any;
  /** The fingerprint of the certificate the main computer presented ("AB:CD:..") */
  fingerprint: string | null;
}

export class FingerprintMismatchError extends Error {
  constructor() {
    super('The main computer answered with a different security certificate. Pair this counter again.');
  }
}

export function httpsJson(options: {
  host: string;
  port: number;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  /** When set, the request stops before anything is sent if the certificate does not match */
  pinnedFingerprint?: string | null;
  timeoutMs?: number;
}): Promise<HttpsJsonResult> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = https.request({
      host: options.host,
      port: options.port,
      path: options.path,
      method: options.method ?? 'GET',
      rejectUnauthorized: false,
      // A fresh connection every time, so the certificate is always checked before the request is sent
      agent: false,
      timeout: options.timeoutMs ?? 6000,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...options.headers
      }
    });
    let fingerprint: string | null = null;
    req.on('socket', socket => {
      socket.on('secureConnect', () => {
        fingerprint = (socket as TLSSocket).getPeerCertificate()?.fingerprint256 || null;
        if (options.pinnedFingerprint && !sameFingerprint(fingerprint, options.pinnedFingerprint)) {
          req.destroy(new FingerprintMismatchError());
          return;
        }
        if (payload) req.end(payload);
        else req.end();
      });
    });
    req.on('timeout', () => req.destroy(new Error('The main computer did not answer in time.')));
    req.on('error', reject);
    req.on('response', res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) req.destroy(new Error('Answer too large')); });
      res.on('end', () => {
        let body: any = raw;
        try { body = JSON.parse(raw); } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 0, body, fingerprint });
      });
    });
  });
}
