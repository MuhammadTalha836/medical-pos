import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  printThermal: (options?: { silent?: boolean; printerName?: string; paperWidthMm?: 58 | 80 }) => Promise<{ success: boolean; error?: string }>;
  selectBackupDir: () => Promise<string | null>;
  selectRestoreFile: () => Promise<string | null>;
}

const api: ElectronAPI = {
  printThermal: (options) => ipcRenderer.invoke('print:thermal', options),
  selectBackupDir: () => ipcRenderer.invoke('dialog:select-backup-dir'),
  selectRestoreFile: () => ipcRenderer.invoke('dialog:select-restore-file')
};

contextBridge.exposeInMainWorld('electronAPI', api);

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
