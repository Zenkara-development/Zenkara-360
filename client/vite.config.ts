import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Where this build will be served from.
 *
 * Vite bakes the base path into every asset URL, so it cannot be decided at
 * runtime — one build serves one base. Two targets need different values:
 *
 *   web (root-hosted):  unset                     -> https://<your-domain>/
 *   web (path-hosted):  VITE_BASE_PATH=/sub/      -> https://<host>/sub
 *   Capacitor (APK):    unset                     -> served at http://localhost
 *
 * Hardcoding '/zenkara/' would break the native build, whose WebView always
 * serves the bundle from the root of its own origin. Keep the trailing
 * slash: Vite requires it, and main.tsx derives the router basename from
 * import.meta.env.BASE_URL so the two can never drift apart.
 */
const base = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // Switched from the default "generateSW" strategy to "injectManifest"
      // so we can ship a custom service worker (src/sw.ts) with a 'push'
      // event handler for real browser/OS push notifications — generateSW
      // only supports Workbox's declarative runtime-caching config, not
      // arbitrary event listeners. src/sw.ts reimplements the same
      // NetworkOnly /api/ + /portal/ caching rule this used to declare here.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'logo.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CRM & IT Desk',
        short_name: 'CRM & IT Desk',
        description: 'CRM, IT help desk, HR and attendance in one place',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        // Must track `base`. A PWA installed from /zenkara/ with scope '/'
        // would claim the whole host — breaking any sibling project on the
        // same domain — and its start_url would open a 404.
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}pwa-192x192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${base}maskable-icon-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // Keeps the precache manifest from ballooning with every hashed JS
        // chunk; the app is a JS-heavy SPA where that trade-off (smaller
        // install footprint vs. offline coverage) matches the previous
        // generateSW config's default behavior closely enough.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Regex key so this only matches paths starting with "/api/". A plain
      // string key ('/api') matches by prefix, which also swallows the
      // "/api-keys" client route (it starts with "/api" too) — every
      // navigation to that page was being proxied to Express instead of
      // served by the SPA, 404ing with "Cannot GET /api-keys".
      '^/api/.*': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
});
