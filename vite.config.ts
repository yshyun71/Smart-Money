import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    /*
      Stamped into the bundle so a screen can say which build it is running.
      A PWA updates on one launch and shows it on the next, and "is the fix in
      yet?" is otherwise unanswerable from the device.
    */
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          // The SQLite engine is a .wasm file — without it in the precache the
          // app cannot open its database offline.
          globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: '스마트 머니 - 자동 가계부 & 지출 절약',
          short_name: '스마트 머니',
          description: '카드 내역과 계좌 입출금을 자동 분석하여 수입/지출 및 고정비·변동비 관리, 절약 항목 추천',
          theme_color: '#10B981',
          background_color: '#F8FAFC',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        devOptions: {
          enabled: true,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      /*
        The port is part of the data's identity, not a detail.

        Everything this app stores lives in IndexedDB, which browsers separate
        by origin — and the port is part of the origin. Moving the dev server
        from :3000 to Vite's default :5173 therefore opened a different, empty
        database, and the app did what an empty database means: it asked for a
        first user. Two users and every account looked deleted; nothing was.

        strictPort so it fails loudly rather than sliding to 3001 when 3000 is
        taken, which would lose sight of the data the same way.
      */
      port: 3000,
      strictPort: true,
      // Set DISABLE_HMR=true to turn off hot reloading.
      hmr: process.env.DISABLE_HMR !== 'true',
      // File watching is also disabled in that case, to save CPU.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
