/**
 * Browser-side polygon geometry — the live feedback in the map editor.
 *
 * The authoritative validation is the server's (utils/geoPolygon.ts): every
 * polygon is checked again before it is stored, and the client is never
 * trusted. This copy exists only so the editor can tell the admin "that's
 * three points — one more and the shape is a boundary" while they click,
 * instead of after they press Save.
 *
 * The same split already exists for face descriptors (client/src/shared/
 * face.ts and server/src/utils/faceVerification.ts) — the browser needs a
 * copy to work with, the server needs its own to be the judge.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371008.8;

/** Projects lat/lng onto a local flat plane (metres) around the ring. */
function project(points: LatLng[], originLat: number, originLng: number) {
  const kx = (EARTH_RADIUS_M * Math.PI) / 180 * Math.cos((originLat * Math.PI) / 180);
  const ky = (EARTH_RADIUS_M * Math.PI) / 180;
  return points.map(p => ({
    x: (p.lng - originLng) * kx,
    y: (p.lat - originLat) * ky,
  }));
}

/** Area of the ring in square metres. */
export function polygonAreaSquareMeters(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const origin = points[0];
  const xy = project(points, origin.lat, origin.lng);
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Perimeter of the ring in metres. */
export function polygonPerimeterMeters(points: LatLng[]): number {
  if (points.length < 2) return 0;
  const origin = points[0];
  const xy = project(points, origin.lat, origin.lng);
  let total = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Area-weighted centroid — the point that goes in the office's lat/lng. */
export function polygonCentroid(points: LatLng[]): LatLng {
  if (!points.length) return { lat: 0, lng: 0 };
  if (points.length < 3) {
    const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
    return { lat: sum.lat / points.length, lng: sum.lng / points.length };
  }
  const origin = points[0];
  const xy = project(points, origin.lat, origin.lng);
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
    return { lat: sum.lat / points.length, lng: sum.lng / points.length };
  }
  area *= 0.5;
  cx /= 6 * area;
  cy /= 6 * area;
  const kx = (EARTH_RADIUS_M * Math.PI) / 180 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = (EARTH_RADIUS_M * Math.PI) / 180;
  return { lat: origin.lat + cy / ky, lng: origin.lng + cx / kx };
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function onSegment(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): boolean {
  return (
    Math.min(a.x, b.x) - 1e-9 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-9
  );
}

function segmentsIntersect(
  a1: { x: number; y: number }, a2: { x: number; y: number },
  b1: { x: number; y: number }, b2: { x: number; y: number },
): boolean {
  const d1 = orientation(a1, a2, b1);
  const d2 = orientation(a1, a2, b2);
  const d3 = orientation(b1, b2, a1);
  const d4 = orientation(b1, b2, a2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(a1, a2, b1)) return true;
  if (d2 === 0 && onSegment(a1, a2, b2)) return true;
  if (d3 === 0 && onSegment(b1, b2, a1)) return true;
  if (d4 === 0 && onSegment(b1, b2, a2)) return true;
  return false;
}

/** Does the outline cross itself? */
export function isSelfIntersecting(points: LatLng[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  const origin = points[0];
  const xy = project(points, origin.lat, origin.lng);
  for (let i = 0; i < n; i++) {
    const a1 = xy[i], a2 = xy[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const b1 = xy[j], b2 = xy[(j + 1) % n];
      const adjacent = (j === i + 1) || (i === 0 && j === n - 1);
      if (adjacent) {
        const shared = j === i + 1 ? a2 : a1;
        const other = j === i + 1 ? b2 : b1;
        if (orientation(a1, a2, b1) === 0 && orientation(a1, a2, b2) === 0) {
          if (Math.hypot(other.x - shared.x, other.y - shared.y) > 1e-6) return true;
        }
      } else if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A short, human-readable description of the shape for the editor.
 *
 * Returns the reason the shape can't be saved yet, or null when it is fine.
 */
export function polygonProblem(points: LatLng[]): string | null {
  if (points.length < 3) {
    const missing = 3 - points.length;
    return `Add ${missing} more point${missing === 1 ? '' : 's'} — a boundary needs at least three points.`;
  }
  for (let i = 1; i < points.length; i++) {
    if (points[i].lat === points[i - 1].lat && points[i].lng === points[i - 1].lng) {
      return 'Two points are in exactly the same place — remove the duplicate.';
    }
  }
  if (isSelfIntersecting(points)) {
    return 'The boundary crosses itself. Move the points so the outline does not cross.';
  }
  if (polygonAreaSquareMeters(points) < 1) {
    return 'The shape has no area — the points are in a straight line.';
  }
  return null;
}

/** Human-readable area: hectares above a square kilometre, m² below that. */
export function formatArea(squareMeters: number): string {
  if (!Number.isFinite(squareMeters) || squareMeters <= 0) return '—';
  if (squareMeters >= 1_000_000) return `${(squareMeters / 1_000_000).toFixed(2)} km²`;
  if (squareMeters >= 10_000) return `${(squareMeters / 10_000).toFixed(2)} ha`;
  return `${Math.round(squareMeters).toLocaleString()} m²`;
}

/** Human-readable distance. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
