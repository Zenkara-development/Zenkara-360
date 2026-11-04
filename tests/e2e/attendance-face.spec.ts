import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/auth';

const API = 'http://localhost:4000';
const token = (page: Page) => page.evaluate(() => localStorage.getItem('accessToken'));
const unitDescriptor = (seed: number) => {
  const v = Array.from({ length: 128 }, (_, i) => Math.sin(seed * 7 + i));
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / n);
};

test.describe('Attendance — face verification', () => {
  test.afterEach(async ({ page }) => {
    // Leave the org as we found it: policy off, own enrolment removed.
    const headers = { Authorization: `Bearer ${await token(page)}` };
    await page.request.patch(`${API}/api/hr/attendance/policy`, { headers, data: {
      checkInRule:  { location: true, network: true, face: false, mode: 'ALL', enforce: true },
      checkOutRule: { location: true, network: true, face: false, mode: 'ALL', enforce: false },
      autoCheckoutOnLeave: false, heartbeatTimeoutMinutes: 0, shareLiveLocation: false,
    } });
    await page.request.delete(`${API}/api/hr/attendance/face/me`, { headers });
  });

  test('policy defaults to location AND network, and rules are editable by a manager', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    let res = await page.request.get(`${API}/api/hr/attendance/policy`, { headers });
    expect(res.ok()).toBeTruthy();
    const before = await res.json();
    expect(before.checkInRule).toMatchObject({ location: true, network: true, mode: 'ALL', enforce: true });
    expect(before.checkOutRule).toMatchObject({ enforce: false });
    expect(typeof before.faceVerificationRequired).toBe('boolean');
    res = await page.request.patch(`${API}/api/hr/attendance/policy`, { headers, data: {
      checkInRule: { location: true, network: false, face: true, mode: 'ANY', enforce: true }, faceMatchThreshold: 0.55,
    } });
    expect(res.ok()).toBeTruthy();
    const after = await res.json();
    expect(after.checkInRule).toEqual({ location: true, network: false, face: true, mode: 'ANY', enforce: true });
    expect(after.faceVerificationRequired).toBe(true);
    expect(after.faceMatchThreshold).toBeCloseTo(0.55);
    // Invalid rule shape is rejected
    const bad = await page.request.patch(`${API}/api/hr/attendance/policy`, { headers, data: { checkInRule: { location: true } } });
    expect(bad.status()).toBe(400);
  });

  test('check-in without enrolment is rejected with FACE_NOT_ENROLLED when required', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    // Face-only, enforced: no geofence involved, so the outcome is deterministic
    await page.request.patch(`${API}/api/hr/attendance/policy`, { headers, data: { checkInRule: { location: false, network: false, face: true, mode: 'ALL', enforce: true } } });
    await page.request.delete(`${API}/api/hr/attendance/face/me`, { headers });
    const res = await page.request.post(`${API}/api/hr/attendance/check-in`, { headers, data: { lat: 0, lng: 0 } });
    const body = await res.json();
    if (res.status() === 400 && /already checked in/i.test(body.error)) test.skip(true, 'admin already has an open session');
    expect(res.status()).toBe(428);
    expect(body.code).toBe('FACE_NOT_ENROLLED');
  });

  test('enrolment stores samples and can be listed and reset by a manager', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const res = await page.request.post(`${API}/api/hr/attendance/face/enrol`, {
      headers, data: { descriptors: [unitDescriptor(1), unitDescriptor(2), unitDescriptor(3)] },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).samples).toBe(3);

    const policy = await (await page.request.get(`${API}/api/hr/attendance/policy`, { headers })).json();
    expect(policy.myEnrollment?.samples).toBe(3);

    const list = await (await page.request.get(`${API}/api/hr/attendance/face`, { headers })).json();
    const mine = list.find((r: any) => r.samples === 3);
    expect(mine).toBeTruthy();

    const del = await page.request.delete(`${API}/api/hr/attendance/face/${mine.userId}`, { headers });
    expect(del.ok()).toBeTruthy();
    const after = await (await page.request.get(`${API}/api/hr/attendance/policy`, { headers })).json();
    expect(after.myEnrollment).toBeNull();
  });

  test('bad descriptors are rejected', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    let res = await page.request.post(`${API}/api/hr/attendance/face/enrol`, { headers, data: { descriptors: [Array(100).fill(0.1)] } });
    expect(res.status()).toBe(400);
    res = await page.request.post(`${API}/api/hr/attendance/face/enrol`, { headers, data: { descriptors: [Array(128).fill(0)] } });
    expect(res.status()).toBe(400);
  });

  test('HR Settings shows the check-in / check-out rule editors', async ({ page }) => {
    await login(page);
    await page.goto('/hr/settings');
    await expect(page.getByText(/check-in \/ check-out verification/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('rule-check-in')).toBeVisible();
    await expect(page.getByTestId('rule-check-out')).toBeVisible();
    await expect(page.getByTestId('rule-check-in').getByRole('radio', { name: /any \(or\)/i })).toBeVisible();
    await expect(page.getByTestId('rule-check-in').getByRole('checkbox', { name: /face verification/i })).toBeVisible();
  });

  test('auto check-out settings are editable and heartbeat answers for no open session', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    let res = await page.request.patch(`${API}/api/hr/attendance/policy`, { headers, data: { autoCheckoutOnLeave: true, autoCheckoutAfterMinutes: 3, heartbeatTimeoutMinutes: 30 } });
    expect(res.ok()).toBeTruthy();
    const p = await res.json();
    expect(p.autoCheckoutOnLeave).toBe(true);
    expect(p.autoCheckoutAfterMinutes).toBe(3);
    expect(p.heartbeatTimeoutMinutes).toBe(30);
    const bad = await page.request.patch(`${API}/api/hr/attendance/policy`, { headers, data: { autoCheckoutAfterMinutes: 0 } });
    expect(bad.status()).toBe(400);

    res = await page.request.post(`${API}/api/hr/attendance/heartbeat`, { headers, data: { lat: 12.97, lng: 77.59, accuracy: 20 } });
    expect(res.ok()).toBeTruthy();
    const hb = await res.json();
    expect(typeof hb.open).toBe('boolean');
    if (hb.open) expect(['boolean', 'object']).toContain(typeof hb.inside); // null when no usable fix
  });

  test('HR Settings shows the auto check-out toggle', async ({ page }) => {
    await login(page);
    await page.goto('/hr/settings');
    await expect(page.getByTestId('auto-checkout')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('switch', { name: /check out automatically when someone leaves/i })).toBeVisible();
  });

  test('live location: off by default (403), then live/trail/locate work once enabled', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    await page.request.patch(`${API}/api/hr/attendance/policy`, { headers, data: { shareLiveLocation: false } });
    let res = await page.request.get(`${API}/api/hr/attendance/live`, { headers });
    expect(res.status()).toBe(403);

    await page.request.patch(`${API}/api/hr/attendance/policy`, { headers, data: { shareLiveLocation: true, locationRetentionDays: 14 } });
    res = await page.request.get(`${API}/api/hr/attendance/live`, { headers });
    expect(res.ok()).toBeTruthy();
    const live = await res.json();
    expect(Array.isArray(live.people)).toBeTruthy();
    expect(Array.isArray(live.offices)).toBeTruthy();

    const me = await (await page.request.get(`${API}/api/auth/me`, { headers })).json();
    const myId = me.id ?? me.user?.id;
    res = await page.request.get(`${API}/api/hr/attendance/trail/${myId}`, { headers, params: { date: new Date().toISOString().slice(0, 10) } });
    expect(res.ok()).toBeTruthy();
    const trail = await res.json();
    expect(Array.isArray(trail.pings)).toBeTruthy();

    res = await page.request.post(`${API}/api/hr/attendance/locate/${myId}`, { headers });
    expect(res.ok()).toBeTruthy();
    const loc = await res.json();
    expect(loc.requested).toBe(true);
    expect(['sse', 'push']).toContain(loc.via);
    const nudge = await page.request.patch(`${API}/api/hr/attendance/policy`, { headers, data: { nudgeAfterMinutes: 15, nudgeRepeatMinutes: 45 } });
    expect((await nudge.json()).nudgeAfterMinutes).toBe(15);

    // Live map tab appears for managers once sharing is on
    await page.goto('/hr/attendance');
    await expect(page.getByRole('tab', { name: /live map/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: /live map/i }).click();
    await expect(page.getByTestId('live-map')).toBeVisible({ timeout: 10_000 });
  });
});
