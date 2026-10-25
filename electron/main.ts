import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import express from 'express';
import type { Server } from 'http';
import appIcon from '../build/icon.png?asset';

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
    icon: appIcon,
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

// IPC: printers installed on this computer, for the per-computer receipt printer setting
ipcMain.handle('printers:list', async () => {
  if (!mainWindow) return [];
  const printers = await mainWindow.webContents.getPrintersAsync();
  return printers.map(p => ({ name: p.name, displayName: p.displayName || p.name }));
});

const MAX_RECEIPT_HTML_BYTES = 5 * 1024 * 1024;
const MICRONS_PER_CSS_PX = 25400 / 96;

/**
 * IPC: thermal receipt printing. The renderer sends the receipt as a standalone HTML document;
 * it is printed from a hidden window sized to the receipt, so nothing else on screen is printed,
 * the roll is cut at the receipt's real length, and with `silent` no print dialog is shown.
 */
ipcMain.handle('print:thermal', async (_event, options: unknown) => {
  if (!mainWindow) return { success: false, error: 'No active window' };
  const opts = (options ?? {}) as { html?: unknown; silent?: unknown; printerName?: unknown; paperWidthMm?: unknown };
  if (typeof opts.html !== 'string' || !opts.html || Buffer.byteLength(opts.html) > MAX_RECEIPT_HTML_BYTES) {
    return { success: false, error: 'Nothing to print' };
  }
  const widthMm = opts.paperWidthMm === 58 ? 58 : 80;

  // Only a printer that exists on this computer; anything else prints to the system default
  const printers = await mainWindow.webContents.getPrintersAsync();
  const deviceName = typeof opts.printerName === 'string' && printers.some(p => p.name === opts.printerName) ? opts.printerName : '';

  const file = path.join(app.getPath('temp'), `pharmacare-receipt-${process.pid}-${Date.now()}.html`);
  const printWindow = new BrowserWindow({
    show: false,
    width: Math.round((widthMm / 25.4) * 96),
    height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false }
  });
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  printWindow.webContents.on('will-navigate', event => event.preventDefault());

  try {
    await fs.writeFile(file, opts.html, 'utf8');
    await printWindow.loadFile(file);
    const heightPx = Number(await printWindow.webContents.executeJavaScript(
      "Math.ceil((document.getElementById('thermal-receipt-printable') || document.body).getBoundingClientRect().height)"
    )) || 1000;

    return await new Promise<{ success: boolean; error?: string }>(resolve => {
      printWindow.webContents.print(
        {
          silent: opts.silent === true,
          printBackground: true,
          deviceName,
          // Roll width × receipt length (+ 8 mm so the cutter clears the last line), in microns
          pageSize: { width: widthMm * 1000, height: Math.round(heightPx * MICRONS_PER_CSS_PX) + 8000 },
          margins: { marginType: 'none' }
        },
        (success, failureReason) => resolve({ success, error: success ? undefined : failureReason })
      );
    });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Printing failed' };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
    fs.rm(file, { force: true }).catch(() => { /* temp file; the OS cleans it up */ });
  }
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

// IPC: Open the Google sign-in page (online backups) in the system browser. Only that page is allowed.
ipcMain.handle('cloud:open-sign-in', async (_event, url: unknown) => {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'accounts.google.com') return false;
  await shell.openExternal(parsed.toString());
  return true;
});

// IPC: Open a WhatsApp message (receipt, khata reminder, supplier order). Only https://wa.me/<digits> is allowed.
ipcMain.handle('whatsapp:open', async (_event, url: unknown) => {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'wa.me' || !/^\/\d{7,15}$/.test(parsed.pathname)) return false;
  await shell.openExternal(parsed.toString());
  return true;
});
