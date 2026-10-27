import { app, dialog } from 'electron';
import { utimesSync } from 'fs';
import path from 'path';

/**
 * Restarts the app after a LAN role change. In development `npm run dev` (electron-vite) stops its renderer dev
 * server as soon as this process exits, so `app.relaunch()` would leave an empty window. There the main source
 * file is touched instead: the `--watch` build sees it and electron-vite restarts the app itself.
 */
export function restartApp(delayMs = 0) {
  setTimeout(() => {
    if (!app.isPackaged) {
      try {
        const now = new Date();
        utimesSync(path.join(app.getAppPath(), 'electron', 'main.ts'), now, now);
        return;
      } catch {
        dialog.showMessageBoxSync({
          type: 'info',
          title: 'Restart needed',
          message: 'The setting is saved. The app will close now.',
          detail: 'Run "npm run dev" again to open it with the new setting.'
        });
        app.exit(0);
        return;
      }
    }
    app.relaunch();
    app.exit(0);
  }, delayMs);
}
