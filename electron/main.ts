import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b1120',
    title: 'PharmaCare Pro - Pharmacy Management & POS System',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    autoHideMenuBar: true,
    show: false
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Check if running in dev mode
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC: Native Thermal Printing
ipcMain.handle('print:thermal', async (_event, options = {}) => {
  if (!mainWindow) return { success: false, error: 'No active window' };

  return new Promise((resolve) => {
    mainWindow?.webContents.print(
      {
        silent: options.silent || false,
        printBackground: true,
        deviceName: options.printerName || '',
        pageSize: {
          width: (options.paperWidthMm === 58 ? 58 : 80) * 1000, // roll width in microns
          height: 297000
        },
        margins: {
          marginType: 'none'
        }
      },
      (success, failureReason) => {
        resolve({ success, error: failureReason });
      }
    );
  });
});

// IPC: Select Folder for Backup
ipcMain.handle('dialog:select-backup-dir', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Destination Folder for Pharmacy Backups'
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// IPC: Select .db file for Restore
ipcMain.handle('dialog:select-restore-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'SQLite Database Backups', extensions: ['db', 'sqlite', 'sqlite3'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    title: 'Select Backup Database to Restore'
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
