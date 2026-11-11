// ─── Address search for the geofence map editor ─────────────────────────────
//
// The polygon editor needs to answer "where is the office?" before the
// admin starts clicking points. That is a geocoding question, and the only
// free, key-less, reputable answer available without asking the customer to
// sign up for a Google Maps account is OpenStreetMap's Nominatim.
//
// Nominatim's usage policy is explicit: identify yourself, and make at most
// one request per second. Both are honoured here — a User-Agent that names
// the application, and a single in-flight queue that spaces requests out.
//
// Everything here is best-effort. If the service is unreachable the editor
// still works: the admin can pan the map and click the boundary points
// directly. Search is a convenience, never a dependency of the feature.

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Zenkara360/1.0 (attendance geofence editor)';

/** Nominatim asks for at most one request per second. */
const MIN_INTERVAL_MS = 1_100;
/** How long a result stays usable before we ask again. */
const CACHE_TTL_MS = 10 * 60_000;
/** Don't let a slow service hold the request open forever. */
const REQUEST_TIMEOUT_MS = 6_000;

export interface GeocodeResult {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  /** How large the matched area is, in metres — Leaflet's zoom hint. */
  bounds: { south: number; north: number; west: number; east: number } | null;
}

interface CacheEntry {
  at: number;
  results: GeocodeResult[];
}

const cache = new Map<string, CacheEntry>();

/** Serialises the outgoing requests so we never exceed one per second. */
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the chain alive even if one request rejects.
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Looks an address up.
 *
 * Returns an empty list for anything unusable (blank query, unknown place,
 * service unreachable) rather than throwing — the caller shows "no matches"
 * and the admin carries on with the map.
 */
export async function geocode(query: string, limit = 5): Promise<GeocodeResult[]> {
  const q = (query || '').trim();
  if (q.length < 3) return [];

  const cached = cache.get(q.toLowerCase());
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

  try {
    const results = await schedule(async () => {
      const url = `${ENDPOINT}?format=jsonv2&limit=${limit}&addressdetails=1&q=${encodeURIComponent(q)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
        });
        if (!res.ok) return [];
        const body = (await res.json()) as any[];
        if (!Array.isArray(body)) return [];
        return body.map((r): GeocodeResult => ({
          name: r.name || r.display_name?.split(',')[0] || q,
          displayName: r.display_name || r.name || q,
          lat: Number(r.lat),
          lng: Number(r.lon),
          bounds: r.boundingbox
            ? {
                south: Number(r.boundingbox[0]),
                north: Number(r.boundingbox[1]),
                west: Number(r.boundingbox[2]),
                east: Number(r.boundingbox[3]),
              }
            : null,
        })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
      } finally {
        clearTimeout(timer);
      }
    });
    cache.set(q.toLowerCase(), { at: Date.now(), results });
    return results;
  } catch {
    // Network blocked, DNS failure, timeout — the editor still works without it.
    return [];
  }
}
