import fs from 'fs';
import path from 'path';
import { DEFAULT_LAN_PORT, LAN_MODES, type LanMode } from './lanMath';

// This computer's LAN role (M11), kept in a small file next to the database (never inside it, so a restored
// backup cannot change which computer is the main one). The main process and the API both read it.

export interface LanConfig {
  mode: LanMode;
  /** Server mode: the port counters connect to */
  port: number;
  /** Counter mode: where the main computer is */
  serverHost?: string;
  serverPort?: number;
  /** Counter mode: the main computer's certificate fingerprint (SHA-256), pinned at pairing */
  fingerprint?: string;
  terminalName?: string;
  /** Counter mode: the counter key, encrypted by the operating system (base64) */
  terminalKeyEnc?: string;
}

export const DEFAULT_LAN_CONFIG: LanConfig = { mode: 'standalone', port: DEFAULT_LAN_PORT };

/** The folder holding the database; `lan-config.json` lives here */
export function lanConfigPath(dataDir: string): string {
  return path.join(dataDir, 'lan-config.json');
}

/** A missing or unreadable file means standalone (today's single-PC behaviour) */
export function readLanConfig(dataDir: string): LanConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(lanConfigPath(dataDir), 'utf8')) as Partial<LanConfig>;
    const mode = (LAN_MODES as readonly string[]).includes(String(raw.mode)) ? (raw.mode as LanMode) : 'standalone';
    const port = Number.isInteger(raw.port) && raw.port! >= 1024 && raw.port! <= 65535 ? raw.port! : DEFAULT_LAN_PORT;
    return { ...raw, mode, port };
  } catch {
    return { ...DEFAULT_LAN_CONFIG };
  }
}

export function writeLanConfig(dataDir: string, config: LanConfig): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = lanConfigPath(dataDir);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(`${file}.tmp`, file);
}
