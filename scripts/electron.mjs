/**
 * Everything runs on Electron's runtime, so better-sqlite3 only ever needs the Electron build.
 *
 *   node scripts/electron.mjs dev            desktop app with hot reload (electron-vite dev --watch)
 *   node scripts/electron.mjs test <file>    run a TypeScript integration suite with Electron as Node
 *
 * Both first check that better-sqlite3 loads in Electron and rebuild it once if it does not
 * (e.g. after `npm install`, which compiles it for plain Node).
 */
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const electronVite = path.join(path.dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js');
const isWindows = process.platform === 'win32';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: isWindows && command === 'npm' });
  return result.status ?? 1;
}

function ensureElectronNative() {
  const probe = spawnSync(electronBinary, ['-e', "new (require('better-sqlite3'))(':memory:').close()"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore'
  });
  if (probe.status === 0) return;

  console.log('[PharmaCare] Building the database module for the desktop runtime (one time)...');
  if (run('npm', ['run', 'rebuild']) !== 0) process.exit(1);
}

const [mode, ...rest] = process.argv.slice(2);
ensureElectronNative();

if (mode === 'dev') {
  // VS Code terminals export ELECTRON_RUN_AS_NODE=1, which would start Electron without a window
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  process.exit(run(process.execPath, [electronVite, 'dev', '--watch', ...rest], env));
} else if (mode === 'test' && rest.length) {
  process.exit(run(electronBinary, ['--import', 'tsx', ...rest], { ...process.env, ELECTRON_RUN_AS_NODE: '1' }));
} else {
  console.error('Usage: node scripts/electron.mjs dev | test <file.ts>');
  process.exit(1);
}
