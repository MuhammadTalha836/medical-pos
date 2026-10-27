import { contextBridge, ipcRenderer } from 'electron';

export interface PrinterInfo {
  name: string;
  displayName: string;
}

export interface ThermalPrintOptions {
  /** A complete HTML document holding the receipt (#thermal-receipt-printable) */
  html: string;
  silent?: boolean;
  printerName?: string;
  paperWidthMm?: 58 | 80;
}

export interface LanInfo {
  /** The role this run started with */
  mode: 'standalone' | 'server' | 'client';
  /** The role saved by the Developer (used after the next restart) */
  savedMode: 'standalone' | 'server' | 'client';
  port: number;
  terminalName: string | null;
  serverHost: string | null;
  serverPort: number | null;
}

export interface ElectronAPI {
  printThermal: (options: ThermalPrintOptions) => Promise<{ success: boolean; error?: string }>;
  listPrinters: () => Promise<PrinterInfo[]>;
  selectBackupDir: () => Promise<string | null>;
  selectRestoreFile: () => Promise<string | null>;
  /** Opens the Google sign-in page for online backups in the system browser */
  openCloudSignIn: (url: string) => Promise<boolean>;
  /** Opens a https://wa.me/ link (message ready to send) in WhatsApp */
  openWhatsApp: (url: string) => Promise<boolean>;

  // LAN mode (M11)
  lanInfo: () => Promise<LanInfo>;
  /** Shows this computer's counter pairing screen */
  lanOpenCounterSetup: () => Promise<boolean>;
  lanCancelSetup: () => Promise<unknown>;
  lanCheckServer: (host: string, port: number) => Promise<{ ok: boolean; error?: string; serverName?: string; fingerprintShort?: string }>;
  lanPair: (input: { host: string; port: number; code: string; name: string }) => Promise<{ ok: boolean; error?: string }>;
  /** Counter: check the main computer again (after it was unreachable or this counter was removed) */
  lanRetry: () => Promise<unknown>;
  lanLeaveCounter: (code: string) => Promise<{ ok: boolean; error?: string }>;
  /** Main computer: opens the counters' port in Windows Firewall (asks for administrator approval) */
  lanAllowFirewall: () => Promise<{ success: boolean; error?: string }>;
  lanGetAutoStart: () => Promise<boolean>;
  lanSetAutoStart: (on: boolean) => Promise<boolean>;
  relaunch: () => Promise<void>;
}

const api: ElectronAPI = {
  printThermal: (options) => ipcRenderer.invoke('print:thermal', options),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  selectBackupDir: () => ipcRenderer.invoke('dialog:select-backup-dir'),
  selectRestoreFile: () => ipcRenderer.invoke('dialog:select-restore-file'),
  openCloudSignIn: (url) => ipcRenderer.invoke('cloud:open-sign-in', url),
  openWhatsApp: (url) => ipcRenderer.invoke('whatsapp:open', url),
  lanInfo: () => ipcRenderer.invoke('lan:info'),
  lanOpenCounterSetup: () => ipcRenderer.invoke('lan:open-counter-setup'),
  lanCancelSetup: () => ipcRenderer.invoke('lan:cancel-setup'),
  lanCheckServer: (host, port) => ipcRenderer.invoke('lan:check-server', host, port),
  lanPair: (input) => ipcRenderer.invoke('lan:pair', input),
  lanRetry: () => ipcRenderer.invoke('lan:retry'),
  lanLeaveCounter: (code) => ipcRenderer.invoke('lan:leave-counter', code),
  lanAllowFirewall: () => ipcRenderer.invoke('lan:allow-firewall'),
  lanGetAutoStart: () => ipcRenderer.invoke('lan:get-auto-start'),
  lanSetAutoStart: (on) => ipcRenderer.invoke('lan:set-auto-start', on),
  relaunch: () => ipcRenderer.invoke('app:relaunch')
};

contextBridge.exposeInMainWorld('electronAPI', api);

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
