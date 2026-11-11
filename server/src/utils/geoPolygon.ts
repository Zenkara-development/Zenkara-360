// ─── Polygon geofence geometry ──────────────────────────────────────────────
//
// The circular geofence (a centre point + a radius in metres) can't describe
// an office whose footprint isn't a circle — a campus spread over two
// buildings, a car park that follows a road, a floor plate of an irregular
// building. This module is the polygon equivalent: a closed ring of
// coordinates that says exactly where the office *is*.
//
// ── Coordinate format ───────────────────────────────────────────────────────
//
// One format everywhere, documented once, used by the API, the database and
// the map editor:
//
//     GeoJSON Polygon, RFC 7946
//     { "type": "Polygon", "coordinates": [ [ [lng, lat], [lng, lat], ... ] ] }
//
//   • `coordinates[0]` is the outer ring.
//   • The ring is CLOSED: the first position is repeated as the last one.
//   • Positions are [longitude, latitude] — GeoJSON's order, longitude first.
//     (The database's latitude/longitude columns are the opposite order, so
//     the conversion happens here, in one place.)
//   • No more than one ring is supported: an office boundary has no holes.
//     A polygon with holes is rejected rather than silently half-honoured.
//
// Everything below is pure maths with no database and no I/O, so it is
// unit-testable in isolation and safe to call on every check-in.

export interface LatLng {
  lat: number;
  lng: number;
}

/** The stored shape of a polygon office. */
export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

/** A point within ON_BOUNDARY_TOLERANCE_M of the boundary counts as inside. */
export const ON_BOUNDARY_TOLERANCE_M = 0.5;

/** Minimum number of distinct vertices a usable polygon needs. */
export const MIN_POLYGON_POINTS = 3;

/** Upper bound on vertices — a defence against a pathological payload. */
export const MAX_POLYGON_POINTS = 200;

const EARTH_RADIUS_M = 6371008.8;

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

/**
 * Reads a stored polygon into a ring of {lat,lng} points.
 *
 * Accepts the canonical GeoJSON Polygon, and — for convenience when the
 * client posts a bare array of points — a plain array of [lng,lat] pairs.
 * Returns null for anything it cannot make sense of, so a corrupt row can
 * never crash a check-in; callers decide what to do about it.
 */
export function parsePolygon(value: unknown): LatLng[] | null {
  let raw: unknown = value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const geom = value as { type?: unknown; coordinates?: unknown };
    if (geom.type !== 'Polygon') return null;
    raw = geom.coordinates;
  }
  if (!Array.isArray(raw) || raw.length === 0) return null;

  // GeoJSON nests the ring one level deeper: coordinates[0] is the ring.
  let ring: unknown = raw;
  if (Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0])) {
    ring = raw[0];
    if (raw.length > 1) return null; // holes are not supported
  }
  if (!Array.isArray(ring)) return null;

  const points: LatLng[] = [];
  for (const p of ring as unknown[]) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const lng = Number(p[0]);
    const lat = Number(p[1]);
    if (!isValidLatLng(lat, lng)) return null;
    points.push({ lat, lng });
  }
  if (!points.length) return null;

  // GeoJSON closes the ring by repeating the first position at the end. The
  // duplicate is an artefact of the format, not a second corner — drop it,
  // or every stored polygon would look like it had a repeated point.
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) points.pop();
  }
  return points;
}

/** Builds the canonical GeoJSON Polygon for a ring of {lat,lng} points. */
export function toGeoJsonPolygon(points: LatLng[]): GeoJsonPolygon {
  const ring = points.map(p => [p.lng, p.lat]);
  // GeoJSON requires the ring to be closed.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Projects lat/lng onto a local flat plane (metres) around the ring.
 *
 * An equirectangular projection centred on the ring is accurate to well
 * under a metre for any office-sized shape, and it makes the area and
 * distance maths ordinary 2-D geometry instead of spherical trigonometry.
 */
function project(points: LatLng[], originLat: number, originLng: number) {
  const lat0 = (originLat * Math.PI) / 180;
  const kx = (EARTH_RADIUS_M * Math.PI) / 180 * Math.cos(lat0);
  const ky = (EARTH_RADIUS_M * Math.PI) / 180;
  return points.map(p => ({
    x: (p.lng - originLng) * kx,
    y: (p.lat - originLat) * ky,
  }));
}

/** Shoelace area of a projected ring, in square metres (absolute value). */
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

/** Perimeter of a projected ring, in metres. */
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

/** Area-weighted centroid of a ring; falls back to the vertex average. */
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

/** Orientation of the ordered triple a→b→c: >0 counter-clockwise, <0 clockwise. */
function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

/** True when the point lies on the segment a→b (collinear and within bounds). */
function onSegment(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): boolean {
  return (
    Math.min(a.x, b.x) - 1e-9 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-9
  );
}

/** True when segments a1a2 and b1b2 cross or touch. */
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

/**
 * Is the ring simple — i.e. no edge crosses another edge?
 *
 * Adjacent edges share a vertex, which is fine, but they must not *overlap*
 * (a "spike" where the boundary doubles back on itself is not a valid
 * outline). Non-adjacent edges must not touch at all.
 */
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
        // They share exactly one endpoint; the only illegal case is a
        // back-tracking spike, i.e. the two edges overlapping.
        const shared = j === i + 1 ? a2 : a1;
        const other = j === i + 1 ? b2 : b1;
        // Overlap happens when the two non-shared ends are on the same line.
        const cross = orientation(a1, a2, b1) === 0 && orientation(a1, a2, b2) === 0;
        if (cross) {
          const d = Math.hypot(other.x - shared.x, other.y - shared.y);
          if (d > 1e-6) return true;
        }
      } else if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Is a point inside the polygon?
 *
 * Ray casting in the projected plane: a horizontal ray from the point is
 * counted where it crosses the boundary. A point *on* the boundary (within
 * ON_BOUNDARY_TOLERANCE_M) counts as inside — somebody standing exactly on
 * the fence line is at the office, not outside it.
 */
export function pointInPolygon(point: LatLng, points: LatLng[]): boolean {
  if (points.length < 3) return false;
  const origin = points[0];
  const xy = project(points, origin.lat, origin.lng);
  const kx = (EARTH_RADIUS_M * Math.PI) / 180 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = (EARTH_RADIUS_M * Math.PI) / 180;
  const p = { x: (point.lng - origin.lng) * kx, y: (point.lat - origin.lat) * ky };

  // On the boundary?
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i], b = xy[(i + 1) % xy.length];
    if (pointToSegmentDistance(p, a, b) <= ON_BOUNDARY_TOLERANCE_M) return true;
  }

  let inside = false;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const a = xy[i], b = xy[j];
    if ((a.y > p.y) !== (b.y > p.y)) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

function pointToSegmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Distance from a point to the nearest edge of the polygon, in metres.
 *
 * This is the distance to the BOUNDARY, whatever side the point is on — for
 * a point inside, it is how far the nearest edge is, not zero. Callers that
 * want "inside means zero" should test pointInPolygon() first (that is what
 * distanceFromOffice() in attendanceVerification.ts does).
 */
export function distanceToPolygonMeters(point: LatLng, points: LatLng[]): number {
  if (points.length < 2) return Infinity;
  const origin = points[0];
  const xy = project(points, origin.lat, origin.lng);
  const kx = (EARTH_RADIUS_M * Math.PI) / 180 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = (EARTH_RADIUS_M * Math.PI) / 180;
  const p = { x: (point.lng - origin.lng) * kx, y: (point.lat - origin.lat) * ky };
  let best = Infinity;
  for (let i = 0; i < xy.length; i++) {
    const d = pointToSegmentDistance(p, xy[i], xy[(i + 1) % xy.length]);
    if (d < best) best = d;
  }
  return best;
}

export type PolygonValidation =
  | { ok: true; areaSquareMeters: number; perimeterMeters: number; centroid: LatLng; points: number }
  | { ok: false; error: string };

/**
 * Validates a ring before it is stored.
 *
 * Rejects: too few points, out-of-range coordinates, duplicate consecutive
 * points, self-intersecting outlines, and a zero-area shape. This runs on
 * the server for every write — the map editor's own check is a convenience
 * for the user, never the guarantee.
 */
export function validatePolygon(points: LatLng[]): PolygonValidation {
  if (!Array.isArray(points) || points.length < MIN_POLYGON_POINTS) {
    return { ok: false, error: `A polygon needs at least ${MIN_POLYGON_POINTS} points.` };
  }
  if (points.length > MAX_POLYGON_POINTS) {
    return { ok: false, error: `A polygon can have at most ${MAX_POLYGON_POINTS} points.` };
  }
  for (const p of points) {
    if (!isValidLatLng(p.lat, p.lng)) {
      return { ok: false, error: 'Every point must have a latitude between -90 and 90 and a longitude between -180 and 180.' };
    }
  }
  for (let i = 1; i < points.length; i++) {
    if (points[i].lat === points[i - 1].lat && points[i].lng === points[i - 1].lng) {
      return { ok: false, error: 'Two points are in exactly the same place — remove the duplicate.' };
    }
  }
  if (isSelfIntersecting(points)) {
    return { ok: false, error: 'The boundary crosses itself. Move the points so the outline does not cross.' };
  }
  const area = polygonAreaSquareMeters(points);
  if (area < 1) {
    return { ok: false, error: 'The shape has no area — the points are in a straight line.' };
  }
  return {
    ok: true,
    areaSquareMeters: Math.round(area),
    perimeterMeters: Math.round(polygonPerimeterMeters(points)),
    centroid: polygonCentroid(points),
    points: points.length,
  };
}
