import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The developer master TOTP key (and the optional Google sign-in client) is baked into the main bundle at build time
// (never read from the user's PC).
// A release cannot be built without it; `npm run developer:key` creates .env.developer.
function developerKeyDefines(command: 'build' | 'serve'): Record<string, string> {
  const file = resolve('.env.developer');
  if (!existsSync(file)) {
    if (command === 'build') {
      throw new Error('.env.developer is missing. Run "npm run developer:key" first, then build again.');
    }
    return {};
  }
  const env = parse(readFileSync(file));
  if (!env.PHARMACARE_DEV_TOTP_SECRET) {
    throw new Error('.env.developer has no PHARMACARE_DEV_TOTP_SECRET. Run "npm run developer:key -- --rotate".');
  }
  return {
    'process.env.PHARMACARE_DEV_TOTP_SECRET': JSON.stringify(env.PHARMACARE_DEV_TOTP_SECRET),
    'process.env.PHARMACARE_DEVELOPER_EMAIL': JSON.stringify(env.PHARMACARE_DEVELOPER_EMAIL || 'muhammadtalhatalha425@gmail.com'),
    // Optional Google sign-in client for online backups; empty means offline backups only
    'process.env.PHARMACARE_GOOGLE_CLIENT_ID': JSON.stringify(env.PHARMACARE_GOOGLE_CLIENT_ID || ''),
    'process.env.PHARMACARE_GOOGLE_CLIENT_SECRET': JSON.stringify(env.PHARMACARE_GOOGLE_CLIENT_SECRET || '')
  };
}

// Desktop build: Electron main (runs the Express API in-process), preload bridge, and the React renderer.
export default defineConfig(({ command }) => ({
  main: {
    define: developerKeyDefines(command),
    build: {
      outDir: 'out/main',
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve('electron/main.ts') }
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve('electron/preload.ts') },
        // CommonJS preload works with contextIsolation regardless of the package "type"
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': resolve('src') }
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true }
      }
    },
    build: {
      outDir: 'out/renderer',
      minify: true,
      rollupOptions: {
        input: { index: resolve('index.html') }
      }
    }
  }
}));
