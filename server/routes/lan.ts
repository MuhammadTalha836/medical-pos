import crypto from 'crypto';
import os from 'os';
import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { DATA_DIR } from '../database/paths';
import { logSecurityAudit } from '../security/audit';
import { revokeTerminalSessions } from '../security/sessions';
import { getActingUser, requirePermission, sendError } from '../http/context';
import { lanPairSchema, lanModeSchema, parseBody, terminalRenameSchema } from '../validation/schemas';
import { readLanConfig, writeLanConfig } from '../lan/lanConfig';
import { appVersion, clearTerminalCache, hashTerminalKey, requestTerminal, terminalForKey } from '../lan/lanGate';
import {
  checkPairingCode, isOnline, newPairingCode, PAIRING_CODE_TTL_MS, recordPairingFailure, shortFingerprint,
  TERMINAL_KEY_HEADER, type PairingAttempts, type PairingCode
} from '../lan/lanMath';

// Multi-PC LAN mode (M11): pairing counters with the main computer, the counters list, and this PC's LAN role.
const router = Router();

const MANAGE_DENIED = 'You do not have permission to manage counters.';

/**
 * Counters exist only after the Developer made this computer the main computer (Developer → Network (LAN)).
 * Until then every counter route answers 403, so a single-PC shop has nothing to see or misuse.
 */
function lanEnabled(res: Response): boolean {
  if (readLanConfig(DATA_DIR).mode === 'server') return true;
  res.status(403).json({ error: 'Several computers are not turned on for this pharmacy. The Developer turns it on in Developer → Network (LAN).', code: 'LAN_OFF' });
  return false;
}

/** The main computer's certificate fingerprint (set by the main process in server mode) */
const certFingerprint = () => process.env.PHARMACARE_CERT_FINGERPRINT || null;

// One pairing code at a time, kept in memory only (a restart cancels it)
let activeCode: PairingCode | null = null;
const attemptsByAddress = new Map<string, PairingAttempts>();

/** This computer's network addresses, for the counters' set-up screen */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

router.get('/api/lan/health', async (req: Request, res: Response) => {
  try {
    const store = await prisma.systemSetting.findUnique({ where: { key: 'store_name' } });
    const key = req.header(TERMINAL_KEY_HEADER);
    res.json({
      app: 'PharmaCare Pro',
      version: appVersion(),
      server_time: new Date().toISOString(),
      server_name: store?.value || 'Main computer',
      mode: readLanConfig(DATA_DIR).mode,
      paired: key ? !!(await terminalForKey(key)) : false
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.post('/api/lan/pair', async (req: Request, res: Response) => {
  try {
    if (!lanEnabled(res)) return;
    const body = parseBody(lanPairSchema, req.body, res);
    if (!body) return;
    const address = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempts = attemptsByAddress.get(address) ?? { failures: 0, lockedUntil: 0 };
    const result = checkPairingCode(activeCode, body.code, attempts, now);
    if (result !== 'ok') {
      if (result !== 'locked') attemptsByAddress.set(address, recordPairingFailure(attempts, now));
      await logSecurityAudit({ action: 'TERMINAL_PAIR', module: 'LAN', status: 'FAILED', details: `Pairing refused for "${body.name}" from ${address}: ${result}` });
      const messages: Record<string, string> = {
        locked: 'Too many wrong codes. Wait 15 minutes, then make a new code on the main computer.',
        wrong: 'Wrong pairing code. Check the code on the main computer.',
        used: 'This code was already used. Make a new code on the main computer.',
        expired: 'This code has expired. Make a new code on the main computer.'
      };
      return res.status(result === 'locked' ? 429 : 401).json({ error: messages[result], code: 'PAIRING_REFUSED' });
    }
    activeCode = { ...activeCode!, used: true };
    attemptsByAddress.delete(address);

    const key = crypto.randomBytes(32).toString('base64url');
    const terminal = await prisma.terminal.create({
      data: {
        name: body.name.trim(),
        keyHash: hashTerminalKey(key),
        isServer: 0,
        pairedAt: new Date(),
        lastSeenAt: new Date(),
        lastIp: address,
        appVersion: body.version ?? null
      }
    });
    await logSecurityAudit({ action: 'TERMINAL_PAIRED', module: 'LAN', details: `Counter "${terminal.name}" paired from ${address}` });
    res.json({ success: true, terminal_id: terminal.id, terminal_name: terminal.name, key, fingerprint: certFingerprint(), version: appVersion() });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

router.get('/api/lan/status', async (req: Request, res: Response) => {
  try {
    if (!(await requirePermission(req, res, 'can_manage_terminals', MANAGE_DENIED))) return;
    if (!lanEnabled(res)) return;
    const config = readLanConfig(DATA_DIR);
    const terminals = await prisma.terminal.findMany({ orderBy: [{ isServer: 'desc' }, { revokedAt: 'asc' }, { name: 'asc' }] });
    const now = Date.now();
    const current = requestTerminal(res);
    res.json({
      mode: config.mode,
      port: config.port,
      addresses: lanAddresses(),
      fingerprint: certFingerprint(),
      fingerprint_short: shortFingerprint(certFingerprint()),
      version: appVersion(),
      this_terminal: current,
      pairing_code_active: !!activeCode && !activeCode.used && activeCode.expiresAt > now,
      terminals: terminals.map(t => ({
        id: t.id,
        name: t.name,
        is_server: t.isServer === 1,
        paired_at: t.pairedAt,
        last_seen_at: t.lastSeenAt,
        last_ip: t.lastIp,
        app_version: t.appVersion,
        revoked: !!t.revokedAt,
        online: t.isServer === 1 || (!t.revokedAt && isOnline(t.lastSeenAt, now))
      }))
    });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// A new 6-digit code for one counter, valid 5 minutes (made on the main computer only)
router.post('/api/lan/pairing-code', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_manage_terminals', MANAGE_DENIED);
    if (!actor) return;
    if (!lanEnabled(res)) return;
    const code = newPairingCode(() => crypto.randomInt(0, 1_000_000) / 1_000_000);
    activeCode = { code, expiresAt: Date.now() + PAIRING_CODE_TTL_MS, used: false };
    await logSecurityAudit({ action: 'TERMINAL_PAIRING_CODE', module: 'LAN', details: 'Pairing code made for a new counter', userId: actor.id, userName: actor.username });
    res.json({ code, expires_at: new Date(activeCode.expiresAt).toISOString(), fingerprint_short: shortFingerprint(certFingerprint()) });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

router.put('/api/lan/terminals/:id', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_manage_terminals', MANAGE_DENIED);
    if (!actor) return;
    if (!lanEnabled(res)) return;
    const body = parseBody(terminalRenameSchema, req.body, res);
    if (!body) return;
    const terminal = await prisma.terminal.findUnique({ where: { id: Number(req.params.id) || 0 } });
    if (!terminal) return res.status(404).json({ error: 'Counter not found' });
    await prisma.terminal.update({ where: { id: terminal.id }, data: { name: body.name.trim() } });
    clearTerminalCache();
    await logSecurityAudit({ action: 'TERMINAL_RENAMED', module: 'LAN', details: `"${terminal.name}" renamed to "${body.name.trim()}"`, userId: actor.id, userName: actor.username });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

// Removes a counter's access at once: its key stops working and everyone signed in there is signed out
router.post('/api/lan/terminals/:id/revoke', async (req: Request, res: Response) => {
  try {
    const actor = await requirePermission(req, res, 'can_manage_terminals', MANAGE_DENIED);
    if (!actor) return;
    if (!lanEnabled(res)) return;
    const terminal = await prisma.terminal.findUnique({ where: { id: Number(req.params.id) || 0 } });
    if (!terminal) return res.status(404).json({ error: 'Counter not found' });
    if (terminal.isServer === 1) return res.status(400).json({ error: 'The main computer cannot be removed.' });
    await prisma.terminal.update({ where: { id: terminal.id }, data: { revokedAt: new Date() } });
    revokeTerminalSessions(terminal.id);
    await logSecurityAudit({ action: 'TERMINAL_REVOKED', module: 'LAN', details: `Counter "${terminal.name}" removed`, userId: actor.id, userName: actor.username });
    res.json({ success: true });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// This computer's LAN role (Developer, on this computer only). Takes effect after a restart.
router.put('/api/lan/mode', async (req: Request, res: Response) => {
  try {
    const actor = await getActingUser(req);
    if (!actor || actor.role !== 'developer') return res.status(403).json({ error: 'Access denied: Developer role required' });
    const body = parseBody(lanModeSchema, req.body, res);
    if (!body) return;
    const before = readLanConfig(DATA_DIR);
    writeLanConfig(DATA_DIR, { ...before, mode: body.mode, port: body.port ?? before.port });
    await logSecurityAudit({
      action: 'LAN_MODE_CHANGED',
      module: 'LAN',
      details: `This computer changed from ${before.mode} to ${body.mode} (port ${body.port ?? before.port})`,
      userId: actor.id,
      userName: actor.username
    });
    res.json({ success: true, restart_needed: true, mode: body.mode, port: body.port ?? before.port });
  } catch (error: unknown) {
    sendError(res, error, 400);
  }
});

export default router;
