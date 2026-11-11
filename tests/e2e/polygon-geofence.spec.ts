import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * Polygon geofencing.
 *
 * The circular geofence is the product's original behaviour and must keep
 * working exactly as it did — that is the first test here, and it is a
 * regression guard rather than a description of the new code.
 *
 * The polygon tests use the API rather than the map editor, because the
 * editor's own drawing is a UI concern (covered by the settings-page test at
 * the end) and the rules that matter are the server's: a boundary is
 * validated on the server, and the same geometry decides check-in.
 */

const API = 'http://localhost:4000';
const token = (page: Page) => page.evaluate(() => localStorage.getItem('accessToken'));

/** A ~200 m square near the seeded office in Bengaluru. */
const SQUARE = [
  { lat: 12.9716, lng: 77.5946 },
  { lat: 12.9716, lng: 77.5964 },
  { lat: 12.9734, lng: 77.5964 },
  { lat: 12.9734, lng: 77.5946 },
];
const toGeoJson = (pts: { lat: number; lng: number }[]) => ({
  type: 'Polygon',
  coordinates: [[...pts.map(p => [p.lng, p.lat]), [pts[0].lng, pts[0].lat]]],
});
const INSIDE = { lat: 12.9725, lng: 77.5955 };
/** Just west of the western edge — well inside a 150 m radius of the centre. */
const OUTSIDE = { lat: 12.9725, lng: 77.5941 };
/** Exactly on the southern edge. */
const ON_EDGE = { lat: 12.9716, lng: 77.5955 };

test.describe('Polygon geofencing', () => {
  /**
   * A check-in that is never checked out leaves an open session, and the
   * next check-in is then refused with "you're already checked in". Every
   * test therefore starts and ends with the session closed.
   */
  async function closeOpenSession(page: Page) {
    const h = { Authorization: `Bearer ${await token(page)}` };
    await page.request.post(`${API}/api/hr/attendance/check-out`, { headers: h, data: { lat: 12.9716, lng: 77.5946 } });
  }

  test.afterEach(async ({ page }) => {
    const h = { Authorization: `Bearer ${await token(page)}` };
    await closeOpenSession(page);
    await page.request.patch(`${API}/api/hr/attendance/policy`, {
      headers: h,
      data: {
        checkInRule: { location: true, network: true, face: false, mode: 'ALL', enforce: true },
        checkOutRule: { location: true, network: true, face: false, mode: 'ALL', enforce: false },
        shareLiveLocation: false,
        autoCheckoutOnLeave: false,
      },
    });
    const list = await page.request.get(`${API}/api/hr/attendance/office-locations`, { headers: h });
    if (list.ok()) {
      for (const loc of await list.json()) {
        await page.request.delete(`${API}/api/hr/attendance/office-locations/${loc.id}`, { headers: h });
      }
    }
  });

  test('a circular office still works exactly as before', async ({ page }) => {
    await login(page);
    await closeOpenSession(page);
    const h = { Authorization: `Bearer ${await token(page)}` };
    // Geofence only — no network, no face.
    await page.request.patch(`${API}/api/hr/attendance/policy`, {
      headers: h,
      data: { checkInRule: { location: true, network: false, face: false, mode: 'ALL', enforce: true } },
    });

    const created = await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h,
      data: { name: 'Circular Office', latitude: 12.9716, longitude: 77.5946, radiusMeters: 200, geofenceType: 'CIRCLE' },
    });
    expect(created.ok()).toBeTruthy();
    const office = await created.json();
    expect(office.geofenceType).toBe('CIRCLE');
    expect(office.polygon).toBeNull();

    // Inside the radius → allowed.
    let res = await page.request.post(`${API}/api/hr/attendance/check-in`, { headers: h, data: { lat: 12.9720, lng: 77.5950 } });
    expect(res.ok()).toBeTruthy();
    const record = await res.json();
    expect(record.checkInLocationOk).toBe(true);

    // Outside the radius → refused.
    res = await page.request.post(`${API}/api/hr/attendance/check-out`, { headers: h, data: { lat: 12.9800, lng: 77.5946 } });
    expect(res.ok()).toBeTruthy();
    res = await page.request.post(`${API}/api/hr/attendance/check-in`, { headers: h, data: { lat: 12.9800, lng: 77.5946 } });
    expect(res.status()).toBe(403);
  });

  test('a polygon office is created, stored and read back', async ({ page }) => {
    await login(page);
    const h = { Authorization: `Bearer ${await token(page)}` };

    const created = await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h,
      data: { name: 'Polygon Campus', geofenceType: 'POLYGON', polygon: toGeoJson(SQUARE) },
    });
    expect(created.ok()).toBeTruthy();
    const office = await created.json();

    expect(office.geofenceType).toBe('POLYGON');
    expect(office.polygon.type).toBe('Polygon');
    // The centre is derived from the boundary, and the area is cached.
    expect(office.latitude).toBeCloseTo(12.9725, 3);
    expect(office.longitude).toBeCloseTo(77.5955, 3);
    expect(office.areaSquareMeters).toBeGreaterThan(30_000);
    expect(office.areaSquareMeters).toBeLessThan(50_000);

    // It survives a round trip through the database unchanged.
    const list = await (await page.request.get(`${API}/api/hr/attendance/office-locations`, { headers: h })).json();
    const stored = list.find((o: any) => o.id === office.id);
    expect(stored.polygon.coordinates[0].length).toBe(SQUARE.length + 1);
  });

  test('an invalid polygon is refused by the server', async ({ page }) => {
    await login(page);
    const h = { Authorization: `Bearer ${await token(page)}` };

    // Fewer than three points.
    let res = await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h, data: { name: 'Too few', geofenceType: 'POLYGON', polygon: toGeoJson(SQUARE.slice(0, 2)) },
    });
    expect(res.status()).toBe(400);

    // A boundary that crosses itself.
    const bowTie = {
      type: 'Polygon',
      coordinates: [[[77.5946, 12.9716], [77.5964, 12.9734], [77.5946, 12.9734], [77.5964, 12.9716], [77.5946, 12.9716]]],
    };
    res = await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h, data: { name: 'Bow tie', geofenceType: 'POLYGON', polygon: bowTie },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/crosses itself/i);

    // A coordinate outside the world.
    res = await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h,
      data: { name: 'Off the map', geofenceType: 'POLYGON', polygon: { type: 'Polygon', coordinates: [[[195, 12.97], [77.6, 12.97], [77.6, 12.98]]] } },
    });
    expect(res.status()).toBe(400);

    // Not a polygon at all.
    res = await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h, data: { name: 'Rubbish', geofenceType: 'POLYGON', polygon: { type: 'Polygon', coordinates: 'nonsense' } },
    });
    expect(res.status()).toBe(400);

    // Nothing was created by any of those.
    const list = await (await page.request.get(`${API}/api/hr/attendance/office-locations`, { headers: h })).json();
    expect(list.length).toBe(0);
  });

  test('a point inside the boundary checks in, a point outside does not', async ({ page }) => {
    await login(page);
    await closeOpenSession(page);
    const h = { Authorization: `Bearer ${await token(page)}` };
    await page.request.patch(`${API}/api/hr/attendance/policy`, {
      headers: h,
      data: { checkInRule: { location: true, network: false, face: false, mode: 'ALL', enforce: true } },
    });
    await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h, data: { name: 'Polygon Office', geofenceType: 'POLYGON', polygon: toGeoJson(SQUARE) },
    });

    // Inside → allowed.
    let res = await page.request.post(`${API}/api/hr/attendance/check-in`, { headers: h, data: INSIDE });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).checkInLocationOk).toBe(true);

    await page.request.post(`${API}/api/hr/attendance/check-out`, { headers: h, data: INSIDE });

    // Outside — but only ~55 m from the centre, which a 150 m radius would
    // have accepted. The boundary decides, not the radius.
    res = await page.request.post(`${API}/api/hr/attendance/check-in`, { headers: h, data: OUTSIDE });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/check-in blocked/i);
  });

  test('a point exactly on the boundary counts as inside', async ({ page }) => {
    await login(page);
    await closeOpenSession(page);
    const h = { Authorization: `Bearer ${await token(page)}` };
    await page.request.patch(`${API}/api/hr/attendance/policy`, {
      headers: h,
      data: { checkInRule: { location: true, network: false, face: false, mode: 'ALL', enforce: true } },
    });
    await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h, data: { name: 'Polygon Office', geofenceType: 'POLYGON', polygon: toGeoJson(SQUARE) },
    });

    const res = await page.request.post(`${API}/api/hr/attendance/check-in`, { headers: h, data: ON_EDGE });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).checkInLocationOk).toBe(true);
  });

  test('the employee sees their own status; office-wide data stays with managers', async ({ page, browser }) => {
    await login(page);
    const h = { Authorization: `Bearer ${await token(page)}` };
    await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h, data: { name: 'Polygon Office', geofenceType: 'POLYGON', polygon: toGeoJson(SQUARE) },
    });

    // Any staff role may ask about their OWN position.
    const mine = await page.request.get(`${API}/api/hr/attendance/my-location`, { headers: h });
    expect(mine.ok()).toBeTruthy();
    const body = await mine.json();
    expect(body.officeCount).toBe(1);
    expect(body.assignedOffice === null || body.assignedOffice.id).toBeTruthy();

    // A non-manager must not be able to read the office list or other
    // people's movements.
    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await login(staff, 'itagent@crmitdesk.com', 'Admin@123');
    const sh = { Authorization: `Bearer ${await staff.evaluate(() => localStorage.getItem('accessToken'))}` };

    expect((await staff.request.get(`${API}/api/hr/attendance/office-locations`, { headers: sh })).status()).toBe(403);
    expect((await staff.request.get(`${API}/api/hr/attendance/office-locations/presence`, { headers: sh })).status()).toBe(403);
    expect((await staff.request.get(`${API}/api/hr/attendance/my-location`, { headers: sh })).status()).toBe(200);
    await ctx.close();
  });

  test('entry and exit are recorded once, not once per GPS reading', async ({ page }) => {
    await login(page);
    const h = { Authorization: `Bearer ${await token(page)}` };
    await page.request.patch(`${API}/api/hr/attendance/policy`, {
      headers: h,
      data: {
        checkInRule: { location: true, network: false, face: false, mode: 'ALL', enforce: true },
        shareLiveLocation: true,
      },
    });
    const office = await (await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h, data: { name: 'Polygon Office', geofenceType: 'POLYGON', polygon: toGeoJson(SQUARE) },
    })).json();
    const eventsOf = async () =>
      (await (await page.request.get(`${API}/api/hr/attendance/office-locations/${office.id}/events`, { headers: h })).json()).events;

    // The history carries over between runs, so the sequence is written to
    // be deterministic whatever the last recorded state was: a reading
    // outside, then a definite crossing to inside.
    await page.request.post(`${API}/api/hr/attendance/my-location`, { headers: h, data: { ...OUTSIDE, accuracy: 12 } });
    await page.request.post(`${API}/api/hr/attendance/check-in`, { headers: h, data: INSIDE });
    const afterEntry = await eventsOf();

    // The same reading again must not produce a second entry…
    await page.request.post(`${API}/api/hr/attendance/my-location`, { headers: h, data: { ...INSIDE, accuracy: 12 } });
    await page.request.post(`${API}/api/hr/attendance/my-location`, { headers: h, data: { ...INSIDE, accuracy: 14 } });
    // …and a reading outside is the exit…
    await page.request.post(`${API}/api/hr/attendance/my-location`, { headers: h, data: { ...OUTSIDE, accuracy: 12 } });
    // …which, repeated, must not produce a second exit.
    await page.request.post(`${API}/api/hr/attendance/my-location`, { headers: h, data: { ...OUTSIDE, accuracy: 12 } });

    const events = await eventsOf();
    const types = events.map((e: any) => e.eventType);

    // Every recorded crossing alternates. Two readings from the same side
    // produce one event, not two — that is the whole rule.
    for (let i = 1; i < types.length; i++) {
      expect(types[i]).not.toBe(types[i - 1]);
    }
    // The newest crossing is the exit, and the repeated readings added
    // exactly one event (the exit) and nothing else.
    expect(types[0]).toBe('EXIT');
    expect(events.length).toBe(afterEntry.length + 1);
    expect(types).toContain('ENTER');
    expect(types).toContain('EXIT');
  });

  test('a vague GPS reading does not change the verdict', async ({ page }) => {
    await login(page);
    const h = { Authorization: `Bearer ${await token(page)}` };
    await page.request.post(`${API}/api/hr/attendance/office-locations`, {
      headers: h, data: { name: 'Polygon Office', geofenceType: 'POLYGON', polygon: toGeoJson(SQUARE) },
    });

    // A 900 m-accurate fix is too vague to move anybody across a boundary.
    const res = await page.request.post(`${API}/api/hr/attendance/my-location`, {
      headers: h, data: { ...INSIDE, accuracy: 900 },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.usable).toBe(false);
    expect(body.inside).toBeNull();
  });

  test('the settings page offers the polygon editor', async ({ page }) => {
    await login(page);
    await page.goto('/hr/settings');
    // The section pills scroll to a section; the whole page is one long scroll.
    await page.getByRole('tab', { name: /office locations/i }).click();
    await page.getByRole('button', { name: /add location/i }).first().click();

    // Both geofence types are offered.
    await expect(page.getByTestId('geofence-circle')).toBeVisible();
    await expect(page.getByTestId('geofence-polygon')).toBeVisible();

    // Choosing the polygon opens the editor, which refuses to hand over an
    // empty boundary.
    await page.getByTestId('geofence-polygon').click();
    await page.getByRole('button', { name: /draw boundary/i }).click();
    await expect(page.getByText(/boundary needs at least three points/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /use this boundary/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /undo last point/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /clear shape/i })).toBeVisible();
  });
});
