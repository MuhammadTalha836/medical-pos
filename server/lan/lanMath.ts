// Multi-PC LAN mode (M11): pure rules for telling the main computer from counter PCs, the routes only the main
// computer may use, pairing codes and versions. No database or network imports (unit-tested).

export const LAN_MODES = ['standalone', 'server', 'client'] as const;
export type LanMode = (typeof LAN_MODES)[number];

export const DEFAULT_LAN_PORT = 4545;
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
export const PAIRING_MAX_ATTEMPTS = 5;
export const PAIRING_LOCK_MS = 15 * 60 * 1000;
export const TERMINAL_NAME_MAX = 40;
export const SERVER_TERMINAL_NAME = 'Main computer';
/** Header a paired counter sends with every request (added by its main process, never by the page) */
export const TERMINAL_KEY_HEADER = 'x-terminal-key';
export const APP_VERSION_HEADER = 'x-app-version';

/** The request came from this computer itself */
export function isLoopback(address: string | undefined | null): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  return a === '::1' || a.startsWith('127.') || a.startsWith('::ffff:127.');
}

/**
 * Routes a counter PC may never call: Developer sign-in and settings, the setup wizard, restore, backup folders
 * and online-backup sign-in, and the LAN set-up itself. These are done sitting at the main computer.
 */
const LOCAL_ONLY_PREFIXES = [
  '/api/setup',
  '/api/auth/developer-login',
  '/api/developer',
  '/api/utilities/restore',
  '/api/utilities/restore-cloud',
  '/api/lan/mode',
  '/api/lan/pairing-code'
];

export function isLocalOnly(path: string): boolean {
  const clean = path.split('?')[0].replace(/\/+$/, '').toLowerCase();
  return LOCAL_ONLY_PREFIXES.some(prefix => clean === prefix || clean.startsWith(`${prefix}/`));
}

/** Settings a counter PC may not change: folders on the main computer's disk */
export const LOCAL_ONLY_SETTING_KEYS = ['auto_backup_dir', 'secondary_backup_dir'];

/** Routes an unpaired PC may reach (to see the server and to pair) */
export function isOpenLanRoute(method: string, path: string): boolean {
  const clean = path.split('?')[0].replace(/\/+$/, '');
  return (method === 'GET' && clean === '/api/lan/health') || (method === 'POST' && clean === '/api/lan/pair');
}

/** A random 6-digit code (leading zeros kept) */
export function newPairingCode(random: () => number = Math.random): string {
  return String(Math.floor(random() * 1_000_000)).padStart(6, '0');
}

export interface PairingCode {
  code: string;
  expiresAt: number;
  used: boolean;
}

export type PairingCheck = 'ok' | 'wrong' | 'expired' | 'used' | 'locked';

export interface PairingAttempts {
  failures: number;
  lockedUntil: number;
}

/** Checks a code typed on a counter; `attempts` belongs to the caller's address */
export function checkPairingCode(active: PairingCode | null, typed: string, attempts: PairingAttempts, now: number): PairingCheck {
  if (attempts.lockedUntil > now) return 'locked';
  if (!active || active.code !== typed.trim()) return 'wrong';
  if (active.used) return 'used';
  if (active.expiresAt <= now) return 'expired';
  return 'ok';
}

/** Counts a failure; the 5th locks the address for 15 minutes */
export function recordPairingFailure(attempts: PairingAttempts, now: number): PairingAttempts {
  const failures = attempts.lockedUntil > 0 && attempts.lockedUntil <= now ? 1 : attempts.failures + 1;
  return failures >= PAIRING_MAX_ATTEMPTS ? { failures: 0, lockedUntil: now + PAIRING_LOCK_MS } : { failures, lockedUntil: 0 };
}

/** Counters must run the same app version as the main computer (the UI comes from the main computer) */
export function versionsMatch(client: string | undefined | null, server: string): boolean {
  if (!client) return true; // older counters that do not send it are checked by the health call
  return client.trim() === server.trim();
}

/** "AB:CD:EF:12" style short form of a SHA-256 fingerprint, for comparing two screens by eye */
export function shortFingerprint(fingerprint: string | null | undefined): string {
  if (!fingerprint) return '';
  const hex = fingerprint.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return (hex.slice(0, 8).match(/.{2}/g) ?? []).join(':');
}

/** Same fingerprint, whatever the separators or case */
export const sameFingerprint = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.replace(/[^0-9a-f]/gi, '').toLowerCase() === b.replace(/[^0-9a-f]/gi, '').toLowerCase();

/** Why a counter name cannot be used, or null */
export function terminalNameError(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'Give this counter a name, e.g. Counter 1.';
  if (name.trim().length > TERMINAL_NAME_MAX) return `The counter name cannot exceed ${TERMINAL_NAME_MAX} characters.`;
  return null;
}

/** A counter is shown as online when it was seen in the last 2 minutes */
export const isOnline = (lastSeenAt: Date | null, now: number) => !!lastSeenAt && now - lastSeenAt.getTime() < 2 * 60 * 1000;
