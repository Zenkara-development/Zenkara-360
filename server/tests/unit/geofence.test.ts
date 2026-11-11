/**
 * Guards for polygon geofencing.
 *
 * The circular geofence is the product's original behaviour and must keep
 * working exactly as it did — every assertion below about circles is a
 * regression guard, not a description of the new code.
 *
 * The polygon work has three halves, and each needs its own kind of test:
 *
 *   • the geometry (pure maths, no database) — is a point inside a shape?
 *     does the shape cross itself? how big is it?
 *   • the decision (does this reading change the person's state, or is it
 *     the same state again?) — this is what stops a burst of GPS fixes from
 *     turning into a burst of attendance events.
 *   • the wiring (does the schema carry the boundary, are the routes
 *     mounted, does the editor exist and get used?) — the failure this
 *     codebase has actually suffered from before is a feature that exists
 *     on paper and nowhere else.
 *
 *     npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parsePolygon, toGeoJsonPolygon, validatePolygon, pointInPolygon,
  polygonAreaSquareMeters, polygonCentroid, distanceToPolygonMeters,
  isSelfIntersecting, isValidLatLng, MIN_POLYGON_POINTS,
} from '../../src/utils/geoPolygon';
import { verifyAgainstOffices, distanceMeters, isInsideOffice } from '../../src/utils/attendanceVerification';
import { decideGeofenceEvent, isUsableAccuracy, MAX_USABLE_ACCURACY_M } from '../../src/utils/attendanceGeofenceEvents';

const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const CLIENT = path.join(ROOT, '../client/src');

function read(...p: string[]): string {
  return fs.readFileSync(path.join(...p), 'utf8');
}
function code(...p: string[]): string {
  return read(...p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// A square roughly 200 m on a side, near the seed office in Bengaluru.
const SQUARE = [
  { lat: 12.9716, lng: 77.5946 },
  { lat: 12.9716, lng: 77.5964 },
  { lat: 12.9734, lng: 77.5964 },
  { lat: 12.9734, lng: 77.5946 },
];

// ─── Geometry ────────────────────────────────────────────────────────────────

test('a polygon needs at least three points', () => {
  const two = validatePolygon(SQUARE.slice(0, 2));
  assert.equal(two.ok, false);
  assert.match((two as any).error, /at least 3 points/i);

  const three = validatePolygon(SQUARE.slice(0, 3));
  assert.equal(three.ok, true);
  assert.equal(MIN_POLYGON_POINTS, 3);
});

test('out-of-range coordinates are rejected', () => {
  assert.equal(isValidLatLng(91, 0), false);
  assert.equal(isValidLatLng(-91, 0), false);
  assert.equal(isValidLatLng(0, 181), false);
  assert.equal(isValidLatLng(0, -181), false);
  assert.equal(isValidLatLng(Number.NaN, 0), false);
  assert.equal(isValidLatLng(12.9716, 77.5946), true);

  const bad = validatePolygon([
    { lat: 12.9716, lng: 77.5946 },
    { lat: 12.9716, lng: 195 },      // longitude out of range
    { lat: 12.9734, lng: 77.5946 },
  ]);
  assert.equal(bad.ok, false);
  assert.match((bad as any).error, /latitude between -90 and 90|longitude between -180 and 180/i);
});

test('duplicate points and self-intersecting outlines are rejected', () => {
  const duplicate = validatePolygon([
    { lat: 12.9716, lng: 77.5946 },
    { lat: 12.9716, lng: 77.5946 },
    { lat: 12.9734, lng: 77.5946 },
  ]);
  assert.equal(duplicate.ok, false);
  assert.match((duplicate as any).error, /same place/i);

  // A bow-tie: the outline crosses itself.
  const bowTie = validatePolygon([
    { lat: 12.9716, lng: 77.5946 },
    { lat: 12.9734, lng: 77.5964 },
    { lat: 12.9734, lng: 77.5946 },
    { lat: 12.9716, lng: 77.5964 },
  ]);
  assert.equal(bowTie.ok, false);
  assert.match((bowTie as any).error, /crosses itself/i);
  assert.equal(isSelfIntersecting(bowTie.ok ? [] : [
    { lat: 12.9716, lng: 77.5946 },
    { lat: 12.9734, lng: 77.5964 },
    { lat: 12.9734, lng: 77.5946 },
    { lat: 12.9716, lng: 77.5964 },
  ]), true);
});

test('a point inside the polygon is inside, and a point outside is outside', () => {
  assert.equal(pointInPolygon({ lat: 12.9725, lng: 77.5955 }, SQUARE), true);
  assert.equal(pointInPolygon({ lat: 12.9800, lng: 77.5955 }, SQUARE), false);
  assert.equal(pointInPolygon({ lat: 12.9725, lng: 77.6000 }, SQUARE), false);
  // Far away in every direction.
  assert.equal(pointInPolygon({ lat: 0, lng: 0 }, SQUARE), false);
});

test('a point exactly on the boundary counts as inside', () => {
  // On the western edge of the square.
  assert.equal(pointInPolygon({ lat: 12.9725, lng: 77.5946 }, SQUARE), true);
  // On the southern edge.
  assert.equal(pointInPolygon({ lat: 12.9716, lng: 77.5955 }, SQUARE), true);
  // Exactly on a corner.
  assert.equal(pointInPolygon({ lat: 12.9716, lng: 77.5946 }, SQUARE), true);
});

test('the covered area is about right for a known shape', () => {
  // 0.0018° of latitude is ~200 m; 0.0018° of longitude at 13°N is ~195 m.
  const area = polygonAreaSquareMeters(SQUARE);
  assert.ok(area > 35_000 && area < 42_000, `expected ~39,000 m², got ${Math.round(area)}`);
});

test('the centroid sits inside the shape', () => {
  const c = polygonCentroid(SQUARE);
  assert.equal(pointInPolygon(c, SQUARE), true);
  assert.ok(Math.abs(c.lat - 12.9725) < 0.0005);
  assert.ok(Math.abs(c.lng - 77.5955) < 0.0005);
});

test('distance to a polygon boundary is measured to the nearest edge', () => {
  // Inside, the distance is to the nearest EDGE — not zero. A caller that
  // wants "inside means zero" tests pointInPolygon() first.
  const inside = distanceToPolygonMeters({ lat: 12.9725, lng: 77.5955 }, SQUARE);
  assert.ok(inside > 90 && inside < 105, `expected ~98 m to the nearest edge, got ${Math.round(inside)}`);

  // Outside, and the distance grows as the point moves away.
  const outside = distanceToPolygonMeters({ lat: 12.9716, lng: 77.5936 }, SQUARE);
  assert.ok(outside > 90 && outside < 120, `expected ~110 m, got ${Math.round(outside)}`);
  assert.ok(outside > inside);
});

test('polygons are read and written in one documented format', () => {
  // GeoJSON: longitude first, ring closed.
  const geo = toGeoJsonPolygon(SQUARE);
  assert.equal(geo.type, 'Polygon');
  assert.equal(geo.coordinates.length, 1);
  assert.equal(geo.coordinates[0].length, SQUARE.length + 1, 'the ring must be closed');
  assert.deepEqual(geo.coordinates[0][0], [77.5946, 12.9716], 'longitude comes first');

  const back = parsePolygon(geo);
  assert.ok(back);
  // The closing position GeoJSON repeats is dropped again, so a stored
  // polygon round-trips without picking up a duplicate point.
  assert.equal(back!.length, SQUARE.length);
  assert.ok(Math.abs(back![0].lat - SQUARE[0].lat) < 1e-9);
  assert.ok(Math.abs(back![0].lng - SQUARE[0].lng) < 1e-9);
  assert.equal(validatePolygon(back!).ok, true, 'a stored polygon must survive its own validation');

  // A bare array of [lng,lat] pairs is accepted too.
  const bare = parsePolygon(geo.coordinates[0]);
  assert.ok(bare);
  assert.equal(bare!.length, SQUARE.length);
});

test('unreadable geometry is rejected rather than half-honoured', () => {
  assert.equal(parsePolygon(null), null);
  assert.equal(parsePolygon({ type: 'Point', coordinates: [1, 2] }), null);
  assert.equal(parsePolygon({ type: 'Polygon', coordinates: [] }), null);
  assert.equal(parsePolygon({ type: 'Polygon', coordinates: [[[200, 200]]] }), null, 'out-of-range position');
  assert.equal(parsePolygon({ type: 'Polygon', coordinates: [[[77.59, 12.97]], [[77.60, 12.97]]] }), null, 'fewer than two positions');
});

// ─── The geofence decision ───────────────────────────────────────────────────

test('a circular office behaves exactly as it always did', () => {
  const offices = [{ name: 'Main Office', latitude: 12.9716, longitude: 77.5946, radiusMeters: 150, allowedIps: null }];

  // Inside the radius.
  let res = verifyAgainstOffices(offices, 12.9720, 77.5950, '');
  assert.equal(res.locationOk, true);
  assert.equal(res.passed, true);
  assert.equal(res.matchedLocationName, 'Main Office');

  // Outside the radius.
  res = verifyAgainstOffices(offices, 12.9800, 77.5946, '');
  assert.equal(res.locationOk, false);
  assert.equal(res.passed, false);
  assert.equal(res.matchedLocationName, 'Main Office', 'the closest office is still reported');
  assert.ok((res.nearestDistanceMeters ?? 0) > 150);

  // The distance the circle reports is to the CENTRE — that number has
  // always been centre-based and must not move.
  const d = distanceMeters(12.9716, 77.5946, 12.9716, 77.5946);
  assert.equal(Math.round(d), 0);
});

test('a circular office still enforces the IP allowlist the way it always did', () => {
  const offices = [{ name: 'Main Office', latitude: 12.9716, longitude: 77.5946, radiusMeters: 150, allowedIps: '203.0.113.4' }];

  let res = verifyAgainstOffices(offices, 12.9720, 77.5950, '203.0.113.4');
  assert.equal(res.locationOk, true);
  assert.equal(res.networkStatus, 'matched');
  assert.equal(res.passed, true);

  res = verifyAgainstOffices(offices, 12.9720, 77.5950, '198.51.100.7');
  assert.equal(res.locationOk, true);
  assert.equal(res.networkStatus, 'not_matched');
  assert.equal(res.passed, false, 'a configured allowlist must still be required');

  // No allowlist configured means GPS alone decides.
  const open = [{ name: 'Main Office', latitude: 12.9716, longitude: 77.5946, radiusMeters: 150, allowedIps: null }];
  assert.equal(verifyAgainstOffices(open, 12.9720, 77.5950, '198.51.100.7').passed, true);
});

test('a polygon office is entered by the boundary, not by a radius', () => {
  const polygon = toGeoJsonPolygon(SQUARE);
  const offices = [{
    id: 'off_1', name: 'Campus', latitude: 12.9725, longitude: 77.5955,
    radiusMeters: 150, allowedIps: null, geofenceType: 'POLYGON', polygon,
  }];

  // Inside the boundary.
  let res = verifyAgainstOffices(offices, 12.9725, 77.5955, '');
  assert.equal(res.locationOk, true);
  assert.equal(res.passed, true);
  assert.equal(res.matchedLocationName, 'Campus');
  assert.equal(res.matchedLocationId, 'off_1');

  // Outside it — even though this point is well within 150 m of the centre,
  // which is exactly what a radius office would have accepted. It sits just
  // west of the boundary.
  res = verifyAgainstOffices(offices, 12.9725, 77.5941, '');
  assert.equal(res.locationOk, false);
  assert.equal(res.passed, false);
  assert.ok((res.nearestDistanceMeters ?? 0) > 0);
  assert.ok((res.nearestDistanceMeters ?? 0) < 150, 'but it is only metres from the boundary');
});

test('an office with a broken boundary falls back to its circle rather than locking people out', () => {
  const offices = [{
    name: 'Broken', latitude: 12.9716, longitude: 77.5946, radiusMeters: 150,
    allowedIps: null, geofenceType: 'POLYGON', polygon: { type: 'Polygon', coordinates: 'nonsense' },
  }];
  const res = verifyAgainstOffices(offices, 12.9720, 77.5950, '');
  assert.equal(res.locationOk, true, 'a corrupt row must not lock an office out of attendance');
});

test('the circle and the polygon can coexist in one organisation', () => {
  const offices = [
    { id: 'a', name: 'Circle Office', latitude: 12.9000, longitude: 77.5000, radiusMeters: 100, allowedIps: null },
    { id: 'b', name: 'Polygon Office', latitude: 12.9725, longitude: 77.5955, radiusMeters: 100, allowedIps: null, geofenceType: 'POLYGON', polygon: toGeoJsonPolygon(SQUARE) },
  ];
  const res = verifyAgainstOffices(offices, 12.9725, 77.5955, '');
  assert.equal(res.passed, true);
  assert.equal(res.matchedLocationName, 'Polygon Office');

  // And the circle still works on its own.
  const res2 = verifyAgainstOffices([offices[0]], 12.9000, 77.5000, '');
  assert.equal(res2.passed, true);
  assert.equal(res2.matchedLocationName, 'Circle Office');
});

test('isInsideOffice answers the same question for both shapes', () => {
  const circle = { name: 'C', latitude: 12.9716, longitude: 77.5946, radiusMeters: 150, allowedIps: null };
  assert.equal(isInsideOffice(circle, { lat: 12.9720, lng: 77.5950 }), true);
  assert.equal(isInsideOffice(circle, { lat: 12.9900, lng: 77.5946 }), false);

  const poly = { name: 'P', latitude: 12.9725, longitude: 77.5955, radiusMeters: 150, allowedIps: null, geofenceType: 'POLYGON', polygon: toGeoJsonPolygon(SQUARE) };
  assert.equal(isInsideOffice(poly, { lat: 12.9725, lng: 77.5955 }), true);
  assert.equal(isInsideOffice(poly, { lat: 12.9725, lng: 77.5941 }), false, 'just outside the western edge');
});

// ─── Entry / exit events ─────────────────────────────────────────────────────

test('an event is recorded only when the state actually changes', () => {
  // First sighting, inside → an entry.
  assert.equal(decideGeofenceEvent(null, true), 'ENTER');
  // First sighting, outside → nothing: there is no boundary to have left.
  assert.equal(decideGeofenceEvent(null, false), null);
  // Still inside → no duplicate.
  assert.equal(decideGeofenceEvent('ENTER', true), null);
  // Left → an exit.
  assert.equal(decideGeofenceEvent('ENTER', false), 'EXIT');
  // Still outside → no duplicate.
  assert.equal(decideGeofenceEvent('EXIT', false), null);
  // Back inside → an entry.
  assert.equal(decideGeofenceEvent('EXIT', true), 'ENTER');
});

test('an unusable reading never produces an event', () => {
  assert.equal(decideGeofenceEvent('ENTER', null), null);
  assert.equal(decideGeofenceEvent(null, null), null);
  assert.equal(decideGeofenceEvent('EXIT', null), null);
});

test('a vague GPS reading is ignored', () => {
  assert.equal(isUsableAccuracy(null), true, 'a missing accuracy is treated as usable');
  assert.equal(isUsableAccuracy(10), true);
  assert.equal(isUsableAccuracy(MAX_USABLE_ACCURACY_M), true);
  assert.equal(isUsableAccuracy(MAX_USABLE_ACCURACY_M + 1), false);
  assert.equal(isUsableAccuracy(Number.NaN), false);
});

// ─── Wiring ──────────────────────────────────────────────────────────────────

test('the schema carries the polygon boundary and the event table', () => {
  const schema = read(ROOT, 'prisma/schema.prisma');

  assert.match(schema, /model AttendanceGeofenceEvent \{/, 'the entry/exit event table must exist');
  assert.match(schema, /geofenceType\s+String\s+@default\("CIRCLE"\)/, 'offices need a geofence type that defaults to the circle');
  assert.match(schema, /polygon\s+Json\?/, 'offices need somewhere to keep the boundary');
  assert.match(schema, /@@unique\(\[userId, seq\]\)/, 'the event table needs a duplicate guard');
});

test('a migration exists for the polygon change, with its rollback kept separate', () => {
  const dir = path.join(ROOT, 'prisma/migrations');
  const migrations = fs.readdirSync(dir).filter(d => fs.statSync(path.join(dir, d)).isDirectory());
  const poly = migrations.filter(m => m.includes('polygon_geofencing'));
  assert.equal(poly.length, 1, 'exactly one polygon migration');
  const sql = read(dir, poly[0], 'migration.sql');
  assert.match(sql, /CREATE TABLE "attendance_geofence_events"/);
  assert.match(sql, /ADD COLUMN\s+"geofence_type"/);
  assert.ok(fs.existsSync(path.join(dir, poly[0], 'ROLLBACK.sql')), 'the rollback must travel with the migration');
});

test('the geofence routes are mounted', () => {
  const routes = code(ROOT, 'src/modules/hr/attendance/attendance.routes.ts');
  assert.match(routes, /\/my-location/, 'the caller needs their own geofence status');
  assert.match(routes, /office-locations\/:id\/events/, 'the entry/exit history needs a route');
  assert.match(routes, /office-locations\/presence/);
  assert.match(routes, /\/geocode/);
  // The employee's own status is open to every staff role; the office-wide
  // ones are scoped inside the controller, because a team lead may review
  // their own team's movements.
  assert.match(routes, /requireRole\(\.\.\.ALL_USERS\),\s*g\.myLocation/);
  assert.match(routes, /requireRole\(\.\.\.ALL_USERS\),\s*g\.officeEvents/);
});

test('movement history is scoped, not merely gated', () => {
  const controller = code(ROOT, 'src/modules/hr/attendance/attendanceGeofence.controller.ts');
  assert.match(controller, /reviewScope/, 'there must be a scope, not just a role check');
  assert.match(controller, /lead:\s*\{\s*userId\s*\}/, 'a team lead is matched through their employee record');
  assert.match(controller, /Only managers and team leads/);
});

test('the office endpoints validate the polygon on the server', () => {
  const controller = code(ROOT, 'src/modules/hr/attendance/attendance.controller.ts');
  assert.match(controller, /validatePolygon/, 'the server must check the polygon, not trust the browser');
  assert.match(controller, /parsePolygon/);
  assert.match(controller, /geofenceType/);
});

test('the client has an editor, and the settings page uses it', () => {
  const editor = read(CLIENT, 'modules/hr/attendance/PolygonGeofenceEditor.tsx');
  assert.match(editor, /MapContainer/, 'the editor must use the map library the app already has');
  assert.match(editor, /Undo last point/);
  assert.match(editor, /Clear shape/);
  assert.match(editor, /Finish polygon/);
  assert.match(editor, /Use my location/);
  assert.match(editor, /Search for a place/);

  const section = read(CLIENT, 'modules/hr/attendance/OfficeLocationsSection.tsx');
  assert.match(section, /PolygonGeofenceEditor/, 'the section must offer the editor');
  assert.match(section, /geofence-polygon/);
  assert.match(section, /geofence-circle/);

  const settings = read(CLIENT, 'modules/hr/HRSettingsPage.tsx');
  assert.match(settings, /OfficeLocationsSection/);
  assert.ok(!/function OfficeLocationsSection\(\)/.test(settings), 'the old inline section must be gone, not duplicated');
});
