import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Terminal } from '../generated/prisma/client';
import { prisma } from '../database/prisma';
import { sendError } from '../http/context';
import {
  APP_VERSION_HEADER, isLocalOnly, isLoopback, isOpenLanRoute, SERVER_TERMINAL_NAME, TERMINAL_KEY_HEADER, versionsMatch
} from './lanMath';

// Multi-PC LAN mode (M11). Every request is either from this computer (the main computer, trusted as before) or
// from a counter PC on the shop network, which must carry its paired key. Runs before the login check.

export interface RequestTerminal {
  id: number;
  name: string;
  isServer: boolean;
}

/** The app version counters must match (set by the main process; tests and development use a fixed value) */
export const appVersion = () => process.env.PHARMACARE_APP_VERSION || '0.0.0-dev';

export const hashTerminalKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

let serverTerminal: RequestTerminal | null = null;

/** This computer's own terminal row ("Main computer"), created on first use */
export async function getServerTerminal(): Promise<RequestTerminal> {
  if (serverTerminal) return serverTerminal;
  const row = await prisma.terminal.findFirst({ where: { isServer: 1 } })
    ?? await prisma.terminal.create({ data: { name: SERVER_TERMINAL_NAME, isServer: 1, pairedAt: new Date() } });
  serverTerminal = { id: row.id, name: row.name, isServer: true };
  return serverTerminal;
}

/** Forget cached names (after a rename or a restore) */
export function clearTerminalCache(): void {
  serverTerminal = null;
}

/**
 * Remote: the socket is not this computer. Tests may also mark a request remote with "x-test-remote: 1"
 * (only under TEST_MODE); that can only take trust away, never add it.
 */
export function isRemoteRequest(req: Request): boolean {
  if (process.env.TEST_MODE && req.headers['x-test-remote'] === '1') return true;
  return !isLoopback(req.socket.remoteAddress);
}

const lastSeenWrites = new Map<number, number>();

async function touch(terminal: Terminal, req: Request) {
  const now = Date.now();
  if (now - (lastSeenWrites.get(terminal.id) ?? 0) < 60_000) return;
  lastSeenWrites.set(terminal.id, now);
  const version = req.header(APP_VERSION_HEADER);
  await prisma.terminal.update({
    where: { id: terminal.id },
    data: { lastSeenAt: new Date(), lastIp: req.socket.remoteAddress ?? null, ...(version ? { appVersion: version.slice(0, 40) } : {}) }
  });
}

/** Finds the paired, not revoked counter for a key */
export async function terminalForKey(key: string | undefined): Promise<Terminal | null> {
  if (!key || key.length < 20) return null;
  const terminal = await prisma.terminal.findUnique({ where: { keyHash: hashTerminalKey(key) } });
  return terminal && !terminal.revokedAt && terminal.isServer === 0 ? terminal : null;
}

export async function lanGate(req: Request, res: Response, next: NextFunction) {
  try {
    if (!isRemoteRequest(req)) {
      res.locals.lanRemote = false;
      res.locals.terminal = await getServerTerminal();
      return next();
    }
    res.locals.lanRemote = true;
    res.locals.terminal = null;
    if (isOpenLanRoute(req.method, req.path)) return next();

    const terminal = await terminalForKey(req.header(TERMINAL_KEY_HEADER));
    if (!terminal) {
      return res.status(401).json({ error: 'This computer is not connected to the main computer. Pair it again.', code: 'TERMINAL_NOT_PAIRED' });
    }
    const version = req.header(APP_VERSION_HEADER);
    if (!versionsMatch(version, appVersion())) {
      return res.status(426).json({
        error: `This counter runs version ${version}, the main computer ${appVersion()}. Update this computer.`,
        code: 'VERSION_MISMATCH',
        server_version: appVersion()
      });
    }
    if (isLocalOnly(req.path)) {
      return res.status(403).json({ error: 'This can only be done on the main computer.', code: 'MAIN_COMPUTER_ONLY' });
    }
    await touch(terminal, req);
    res.locals.terminal = { id: terminal.id, name: terminal.name, isServer: false } satisfies RequestTerminal;
    next();
  } catch (error: unknown) {
    sendError(res, error);
  }
}

/** The terminal of the current request (the main computer for local calls) */
export function requestTerminal(res: Response): RequestTerminal | null {
  return (res.locals.terminal as RequestTerminal | null) ?? null;
}
