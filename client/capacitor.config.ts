import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor turns this same React app into native Android and iOS builds.
 * The web deployment is untouched: `npm run build` still produces the exact
 * `dist/` nginx serves today. A native build is the same `dist/`, copied
 * into a native shell by `npx cap sync`.
 *
 * ── Two things a native build must do differently ───────────────────────
 *
 * 1. THE API URL MUST BE ABSOLUTE.
 *    On the web, VITE_API_URL is "/api" and nginx proxies it. Inside the
 *    app the WebView's origin is http://localhost (Android), so "/api"
 *    would resolve to the device itself and 404. Build native with:
 *
 *      VITE_API_URL=https://<your-domain>/api npm run build
 *
 * 2. CORS WOULD OTHERWISE BLOCK EVERY REQUEST.
 *    That WebView origin (http://localhost) is not the server's single
 *    CORS_ORIGIN value, so the browser would refuse every call. Enabling
 *    CapacitorHttp below routes requests through the NATIVE HTTP stack
 *    instead of the WebView — no preflight, no CORS, and no change needed
 *    on the server. It patches fetch and XMLHttpRequest, so the existing
 *    axios client in src/api/client.ts is carried along unmodified.
 */
const config: CapacitorConfig = {
  appId: 'com.zenkara.app',
  appName: 'Zenkara 360',
  webDir: 'dist',

  plugins: {
    // See note 2 above — this is what makes the app work against a server
    // whose CORS_ORIGIN names only the web front end.
    CapacitorHttp: {
      enabled: true,
    },
  },

  android: {
    // Plain http://localhost rather than the https scheme: the API is
    // currently served over http, and a secure WebView origin would block
    // it as mixed content. Switch this to 'https' once the backend is
    // behind TLS.
    androidScheme: 'http',
  },
};

export default config;
