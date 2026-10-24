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
}

const api: ElectronAPI = {
  printThermal: (options) => ipcRenderer.invoke('print:thermal', options),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  selectBackupDir: () => ipcRenderer.invoke('dialog:select-backup-dir'),
  selectRestoreFile: () => ipcRenderer.invoke('dialog:select-restore-file')
};

contextBridge.exposeInMainWorld('electronAPI', api);

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
