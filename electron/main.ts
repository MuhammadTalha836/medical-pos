import { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import express from 'express';
import type { Server } from 'http';
import type { Server as HttpsServer } from 'https';
import appIcon from '../build/icon.png?asset';
import { readLanConfig } from '../server/lan/lanConfig';
import { CounterMode } from './lan/clientMode';
import { allowThroughFirewall, startLanServer, stopLanServer } from './lan/serverMode';
import { restartApp } from './restart';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;
// The local API only listens on loopback; in LAN server mode a separate HTTPS listener serves the counters
const API_HOST = '127.0.0.1';
const API_PORT = Number(process.env.PHARMACARE_API_PORT || 3001);

// Installed app keeps the database and backups in the per-user folder (never next to the executable)
if (app.isPackaged) {
  process.env.PHARMACARE_DATA_DIR ??= path.join(app.getPath('userData'), 'data');
  process.env.PHARMACARE_BACKUP_DIR ??= path.join(app.getPath('userData'), 'backups');
}
// Counters must run the same version as the main computer
process.env.PHARMACARE_APP_VERSION ??= app.getVersion();

// This computer's LAN role (M11): standalone (single PC), server (main computer) or client (counter, no database)
const DATA_DIR = path.resolve(process.env.PHARMACARE_DATA_DIR || path.join(process.cwd(), 'data'));
const lanConfig = readLanConfig(DATA_DIR);
const counter = new CounterMode(DATA_DIR);
let lanServer: HttpsServer | null = null;
let tray: Tray | null = null;
let isQuitting = false;

/**
 * Starts the Express API inside the main process. In the packaged app it also serves the built
 * renderer from the same origin, so the UI's relative /api calls work unchanged. The main computer of a
 * multi-PC store also serves the UI to its counters (when the built renderer exists).
 */
async function startApi(): Promise<{ server: Server; api: express.Express }> {
  // Imported after the data folders are set, because the database opens on import
  const { app: api } = await import('../server/api');

  const rendererDir = path.join(import.meta.dirname, '../renderer');
  if (!isDev || (lanConfig.mode === 'server' && existsSync(path.join(rendererDir, 'index.html')))) {
    api.use(express.static(rendererDir));
    api.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(rendererDir, 'index.html')));
  }

  return new Promise((resolve, reject) => {
    const server = api.listen(API_PORT, API_HOST, () => resolve({ server, api }));
    server.on('error', reject);
  });
}

const localAppUrl = () => (isDev && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : `http://${API_HOST}:${API_PORT}`);

/** Main computer: closing the window keeps serving the counters from the tray; Quit asks first */
function setUpTray() {
  tray = new Tray(appIcon);
  tray.setToolTip('PharmaCare Pro – main computer (counters connected)');
  const open = () => { mainWindow?.show(); mainWindow?.focus(); };
  tray.on('click', open);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open PharmaCare Pro', click: open },
    { type: 'separator' },
    {
      label: 'Quit (counters stop working)',
      click: async () => {
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          buttons: ['Keep running', 'Quit'],
          defaultId: 0,
          cancelId: 0,
          title: 'Quit PharmaCare Pro?',
          message: 'Counter computers cannot sell while the main computer is closed.',
          detail: 'Quit only at closing time, after the counters have finished.'
        });
        if (response !== 1) return;
        isQuitting = true;
        await stopLanServer(lanServer);
        app.quit();
      }
    }
  ]));
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
    const allowed = lanConfig.mode === 'client' ? counter.allowedOrigin() : localAppUrl();
    if (allowed && !url.startsWith(allowed)) event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (lanConfig.mode === 'client') {
    counter.start(mainWindow);
  } else {
    mainWindow.loadURL(localAppUrl());
  }

  // Main computer: the window hides to the tray, so the counters keep working. Not in development, where a
  // hidden copy would keep the single-instance lock and every new `npm run dev` would close at once.
  mainWindow.on('close', event => {
    if (lanConfig.mode === 'server' && !isQuitting && !isDev) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

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
      // A main computer hidden to the tray comes back too
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // No application menu: F10/Alt must never open a window menu over the POS
    Menu.setApplicationMenu(null);

    try {
      // A counter has no database and no API of its own
      if (lanConfig.mode !== 'client') {
        const { api } = await startApi();
        if (lanConfig.mode === 'server') {
          try {
            lanServer = await startLanServer(api, DATA_DIR, lanConfig.port);
            setUpTray();
          } catch (err) {
            console.error('[PharmaCare] LAN server failed to start:', err);
            dialog.showErrorBox(
              'Counters cannot connect',
              `This main computer could not open port ${lanConfig.port} for the counters. Another program may be using it. Change the port in Developer → Network, then restart.`
            );
          }
        }
      }
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

app.on('before-quit', () => {
  isQuitting = true;
});

// IPC: LAN mode (M11)
// The role this run started with (a changed role takes effect after the restart)
ipcMain.handle('lan:info', () => {
  const c = readLanConfig(DATA_DIR);
  return { mode: lanConfig.mode, savedMode: c.mode, port: lanConfig.port, terminalName: c.terminalName ?? null, serverHost: c.serverHost ?? null, serverPort: c.serverPort ?? null };
});
// Opens the counter pairing screen from a single-PC app (setup wizard or Developer page)
ipcMain.handle('lan:open-counter-setup', () => {
  if (mainWindow) counter.showSetup(mainWindow, { fromApp: lanConfig.mode !== 'client' });
  return true;
});
ipcMain.handle('lan:cancel-setup', () => {
  if (lanConfig.mode === 'client') return counter.connect();
  return mainWindow?.loadURL(localAppUrl());
});
ipcMain.handle('lan:check-server', (_e, host: unknown, port: unknown) => counter.checkServer(String(host ?? '').trim(), Number(port)));
ipcMain.handle('lan:pair', (_e, input: unknown) => {
  const i = (input ?? {}) as Record<string, unknown>;
  return counter.pair({ host: String(i.host ?? '').trim(), port: Number(i.port), code: String(i.code ?? ''), name: String(i.name ?? '') });
});
ipcMain.handle('lan:retry', () => (lanConfig.mode === 'client' ? counter.connect() : null));
ipcMain.handle('lan:leave-counter', (_e, code: unknown) => (lanConfig.mode === 'client' ? counter.leaveCounterMode(String(code ?? '')) : { ok: false, error: 'This computer is not a counter.' }));
ipcMain.handle('lan:allow-firewall', () => (lanConfig.mode === 'server' ? allowThroughFirewall(lanConfig.port) : { success: false, error: 'Only the main computer needs this.' }));
ipcMain.handle('lan:get-auto-start', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('lan:set-auto-start', (_e, on: unknown) => {
  app.setLoginItemSettings({ openAtLogin: on === true });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('app:relaunch', () => {
  isQuitting = true;
  restartApp();
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
