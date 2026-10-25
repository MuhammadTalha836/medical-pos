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

export interface ElectronAPI {
  printThermal: (options: ThermalPrintOptions) => Promise<{ success: boolean; error?: string }>;
  listPrinters: () => Promise<PrinterInfo[]>;
  selectBackupDir: () => Promise<string | null>;
  selectRestoreFile: () => Promise<string | null>;
  /** Opens the Google sign-in page for online backups in the system browser */
  openCloudSignIn: (url: string) => Promise<boolean>;
  /** Opens a https://wa.me/ link (message ready to send) in WhatsApp */
  openWhatsApp: (url: string) => Promise<boolean>;
}

const api: ElectronAPI = {
  printThermal: (options) => ipcRenderer.invoke('print:thermal', options),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  selectBackupDir: () => ipcRenderer.invoke('dialog:select-backup-dir'),
  selectRestoreFile: () => ipcRenderer.invoke('dialog:select-restore-file'),
  openCloudSignIn: (url) => ipcRenderer.invoke('cloud:open-sign-in', url),
  openWhatsApp: (url) => ipcRenderer.invoke('whatsapp:open', url)
};

contextBridge.exposeInMainWorld('electronAPI', api);

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
