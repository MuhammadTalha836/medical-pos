import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import express from 'express';
import type { Server } from 'http';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;
// The API only listens on loopback so other machines on the network cannot reach it
const API_HOST = '127.0.0.1';
const API_PORT = Number(process.env.PHARMACARE_API_PORT || 3001);

// Installed app keeps the database and backups in the per-user folder (never next to the executable)
if (app.isPackaged) {
  process.env.PHARMACARE_DATA_DIR ??= path.join(app.getPath('userData'), 'data');
  process.env.PHARMACARE_BACKUP_DIR ??= path.join(app.getPath('userData'), 'backups');
}

/**
 * Starts the Express API inside the main process. In the packaged app it also serves the built
 * renderer from the same origin, so the UI's relative /api calls work unchanged.
 */
async function startApi(): Promise<Server> {
  // Imported after the data folders are set, because the database opens on import
  const { app: api } = await import('../server/api');

  if (!isDev) {
    const rendererDir = path.join(import.meta.dirname, '../renderer');
    api.use(express.static(rendererDir));
    api.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(rendererDir, 'index.html')));
  }

  return new Promise((resolve, reject) => {
    const server = api.listen(API_PORT, API_HOST, () => resolve(server));
    server.on('error', reject);
  });
}

// Production hardening: no reload, DevTools or zoom-reset shortcuts in the installed app
function blockDevShortcuts(window: BrowserWindow) {
  window.webContents.on('before-input-event', (event, input) => {
    if (isDev || input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const ctrl = input.control || input.meta;
    if (key === 'f5' || key === 'f12' || (ctrl && key === 'r') || (ctrl && input.shift && (key === 'i' || key === 'j' || key === 'c'))) {
      event.preventDefault();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b1120',
    title: 'PharmaCare Pro – 100% Offline POS',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      devTools: isDev
    },
    show: false
  });

  blockDevShortcuts(mainWindow);

  // Keep navigation inside the app; never open new windows
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? process.env.ELECTRON_RENDERER_URL : `http://${API_HOST}:${API_PORT}`;
    if (allowed && !url.startsWith(allowed)) event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadURL(`http://${API_HOST}:${API_PORT}`);
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

  app.whenReady().then(async () => {
    // No application menu: F10/Alt must never open a window menu over the POS
    Menu.setApplicationMenu(null);

    try {
      await startApi();
    } catch (err) {
      console.error('[PharmaCare] API failed to start:', err);
      dialog.showErrorBox(
        'PharmaCare Pro could not start',
        'The database service failed to start. Close any other copy of PharmaCare Pro and open it again.'
      );
      app.quit();
      return;
    }

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
      { name: 'PharmaCare Backups', extensions: ['db', 'sqlite', 'sqlite3'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    title: 'Select Backup Database to Restore'
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
