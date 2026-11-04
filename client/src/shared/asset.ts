/**
 * URL for a file in `public/`, correct whichever base the app is served from.
 *
 * Vite copies public/ to the root of the build, so a literal "/logo.svg"
 * works only when the app is hosted at the domain root. Once it moved to
 * app.zenkara.in/zenkara every one of those became a 404 — the face-api
 * model manifests failed to fetch and every logo rendered broken.
 *
 * import.meta.env.BASE_URL is whatever `base` was at build time ("/" for the
 * Capacitor build, "/zenkara/" for the path-hosted web build), so this stays
 * right for both without a per-target branch.
 *
 * Use it for anything under public/. Files imported from src/ don't need it —
 * Vite rewrites those URLs itself.
 */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
