import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * HR-005 — Face ID re-enrolment with Super Admin approval.
 *
 * The rule under test: an employee who already has a Face ID cannot remove
 * or replace it themselves. They submit a request; a Super Admin approves
 * or rejects it; the face that works today keeps working the whole time the
 * request is outstanding.
 */

const API = 'http://localhost:4000';
const token = (page: Page) => page.evaluate(() => localStorage.getItem('accessToken'));
const unitDescriptor = (seed: number) => {
  const v = Array.from({ length: 128 }, (_, i) => Math.sin(seed * 7 + i));
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / n);
};
/** A tiny but genuine JPEG data URL — the server only accepts that shape. */
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

test.describe('Face ID re-enrolment — Super Admin approval', () => {
  test.afterEach(async ({ page }) => {
    const headers = { Authorization: `Bearer ${await token(page)}` };
    // Close out anything still pending so the next test starts from a clean slate.
    const list = await page.request.get(`${API}/api/hr/attendance/face/reenroll/requests`, { headers });
    if (list.ok()) {
      const body = await list.json();
      for (const r of body?.data ?? []) {
        await page.request.post(`${API}/api/hr/attendance/face/reenroll/requests/${r.id}/reject`, {
          headers, data: { reason: 'test cleanup' },
        });
      }
    }
    await page.request.delete(`${API}/api/hr/attendance/face/me`, { headers });
  });

  test('first-time enrolment still works and the enrolment endpoint cannot overwrite an active Face ID', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };

    const first = await page.request.post(`${API}/api/hr/attendance/face/enrol`, {
      headers,
      data: {
        descriptors: [unitDescriptor(1), unitDescriptor(2), unitDescriptor(3)],
        referenceSelfie: JPEG,
        sampleImages: [JPEG],
      },
    });
    expect(first.ok()).toBeTruthy();
    expect((await first.json()).samples).toBe(3);

    // A second enrolment must not silently replace the active one.
    const second = await page.request.post(`${API}/api/hr/attendance/face/enrol`, {
      headers,
      data: { descriptors: [unitDescriptor(4)], referenceSelfie: JPEG },
    });
    expect(second.status()).toBe(409);

    const state = await (await page.request.get(`${API}/api/hr/attendance/face/reenroll/me`, { headers })).json();
    expect(state.effectiveStatus).toBe('VERIFIED');
    expect(state.enrollment.samples).toBe(3);
    // Nothing is waiting for approval. (An earlier run may have left a
    // decided request behind — the history is kept, but it is not pending.)
    expect(state.reEnrollment?.status ?? 'NONE').not.toBe('PENDING');
  });

  test('a re-enrolment request waits for approval and leaves the active Face ID alone', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };

    await page.request.post(`${API}/api/hr/attendance/face/enrol`, {
      headers,
      data: {
        descriptors: [unitDescriptor(1), unitDescriptor(2), unitDescriptor(3)],
        referenceSelfie: JPEG,
        sampleImages: [JPEG],
      },
    });

    const submitted = await page.request.post(`${API}/api/hr/attendance/face/reenroll`, {
      headers,
      data: {
        descriptors: [unitDescriptor(5), unitDescriptor(6), unitDescriptor(7)],
        sampleImages: [JPEG, JPEG, JPEG],
      },
    });
    expect(submitted.status()).toBe(201);
    expect((await submitted.json()).status).toBe('PENDING');

    // The employee's own status: pending, and the live enrolment untouched.
    const state = await (await page.request.get(`${API}/api/hr/attendance/face/reenroll/me`, { headers })).json();
    expect(state.effectiveStatus).toBe('PENDING_VERIFICATION');
    expect(state.reEnrollment.status).toBe('PENDING');
    expect(state.enrollment.samples).toBe(3);
    expect(state.enrollment.sampleImages.length).toBe(1);

    // No second request while one is pending.
    const duplicate = await page.request.post(`${API}/api/hr/attendance/face/reenroll`, {
      headers,
      data: { descriptors: [unitDescriptor(8)], sampleImages: [JPEG] },
    });
    expect(duplicate.status()).toBe(409);

    // The review queue carries the real employee details and the images.
    const list = await (await page.request.get(`${API}/api/hr/attendance/face/reenroll/requests`, { headers })).json();
    expect(list.total).toBe(1);
    const row = list.data[0];
    expect(row.status).toBe('PENDING');
    expect(row.employee.name).toBeTruthy();
    expect(row.employee.employeeCode).toBe('EMP-0001');
    expect(row.sampleCount).toBe(3);

    const detail = await (await page.request.get(`${API}/api/hr/attendance/face/reenroll/requests/${row.id}`, { headers })).json();
    expect(detail.submitted.sampleImages.length).toBe(3);
    expect(detail.current.sampleImages.length).toBe(1);
    // Descriptors are never handed to the browser.
    expect(detail.descriptors).toBeUndefined();
  });

  test('only a Super Admin can review, approve or reject a request', async ({ page, browser }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };

    await page.request.post(`${API}/api/hr/attendance/face/enrol`, {
      headers,
      data: { descriptors: [unitDescriptor(1)], referenceSelfie: JPEG, sampleImages: [JPEG] },
    });
    const submitted = await page.request.post(`${API}/api/hr/attendance/face/reenroll`, {
      headers,
      data: { descriptors: [unitDescriptor(9)], sampleImages: [JPEG] },
    });
    const id = (await submitted.json()).id;

    // A manager is not a Super Admin. A separate browser context, so the
    // admin session in `page` is left alone.
    const ctx = await browser.newContext();
    const manager = await ctx.newPage();
    await login(manager, 'crm@crmitdesk.com', 'Admin@123');
    const mgrHeaders = { Authorization: `Bearer ${await manager.evaluate(() => localStorage.getItem('accessToken'))}` };
    expect((await manager.request.get(`${API}/api/hr/attendance/face/reenroll/requests`, { headers: mgrHeaders })).status()).toBe(403);
    expect((await manager.request.get(`${API}/api/hr/attendance/face/reenroll/requests/${id}`, { headers: mgrHeaders })).status()).toBe(403);
    expect((await manager.request.post(`${API}/api/hr/attendance/face/reenroll/requests/${id}/approve`, { headers: mgrHeaders })).status()).toBe(403);
    expect((await manager.request.post(`${API}/api/hr/attendance/face/reenroll/requests/${id}/reject`, { headers: mgrHeaders })).status()).toBe(403);
    await ctx.close();
  });

  test('approving activates the new Face ID; rejecting leaves the old one in place', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };

    await page.request.post(`${API}/api/hr/attendance/face/enrol`, {
      headers,
      data: {
        descriptors: [unitDescriptor(1), unitDescriptor(2), unitDescriptor(3)],
        referenceSelfie: JPEG,
        sampleImages: [JPEG],
      },
    });

    // ── Approve ────────────────────────────────────────────────────────────
    const first = await page.request.post(`${API}/api/hr/attendance/face/reenroll`, {
      headers,
      data: { descriptors: [unitDescriptor(10), unitDescriptor(11)], sampleImages: [JPEG, JPEG] },
    });
    const firstId = (await first.json()).id;

    const approved = await page.request.post(`${API}/api/hr/attendance/face/reenroll/requests/${firstId}/approve`, { headers });
    expect(approved.ok()).toBeTruthy();
    expect((await approved.json()).status).toBe('APPROVED');

    let state = await (await page.request.get(`${API}/api/hr/attendance/face/reenroll/me`, { headers })).json();
    expect(state.effectiveStatus).toBe('VERIFIED');
    expect(state.reEnrollment.status).toBe('APPROVED');
    // The approved enrolment is now the live one.
    expect(state.enrollment.samples).toBe(2);
    expect(state.enrollment.sampleImages.length).toBe(2);

    // A decided request cannot be decided again.
    const again = await page.request.post(`${API}/api/hr/attendance/face/reenroll/requests/${firstId}/approve`, { headers });
    expect(again.status()).toBe(409);

    // ── Reject ─────────────────────────────────────────────────────────────
    const second = await page.request.post(`${API}/api/hr/attendance/face/reenroll`, {
      headers,
      data: { descriptors: [unitDescriptor(12)], sampleImages: [JPEG] },
    });
    const secondId = (await second.json()).id;

    const rejected = await page.request.post(`${API}/api/hr/attendance/face/reenroll/requests/${secondId}/reject`, {
      headers, data: { reason: 'The photo does not look like the person on file' },
    });
    expect(rejected.ok()).toBeTruthy();
    expect((await rejected.json()).status).toBe('REJECTED');

    state = await (await page.request.get(`${API}/api/hr/attendance/face/reenroll/me`, { headers })).json();
    // The old Face ID survived untouched and is still the effective one.
    expect(state.effectiveStatus).toBe('VERIFIED');
    expect(state.enrollment.samples).toBe(2);
    expect(state.enrollment.sampleImages.length).toBe(2);
    expect(state.reEnrollment.status).toBe('REJECTED');
    expect(state.reEnrollment.rejectionReason).toBe('The photo does not look like the person on file');

    // The rejected request is out of the pending queue.
    const list = await (await page.request.get(`${API}/api/hr/attendance/face/reenroll/requests`, { headers })).json();
    expect(list.total).toBe(0);
  });

  test('the Attendance page shows Pending Verification and People has a Face Approvals tab', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };

    // Face verification on, so the Face ID card is shown at all.
    await page.request.patch(`${API}/api/hr/attendance/policy`, {
      headers,
      data: { checkInRule: { location: true, network: true, face: true, mode: 'ALL', enforce: true } },
    });
    await page.request.post(`${API}/api/hr/attendance/face/enrol`, {
      headers,
      data: { descriptors: [unitDescriptor(1)], referenceSelfie: JPEG, sampleImages: [JPEG] },
    });
    await page.request.post(`${API}/api/hr/attendance/face/reenroll`, {
      headers,
      data: { descriptors: [unitDescriptor(2)], sampleImages: [JPEG] },
    });

    await page.goto('/hr/attendance');
    await page.getByRole('tab', { name: /my attendance/i }).click();
    await expect(page.getByText('Pending Verification').first()).toBeVisible({ timeout: 10_000 });
    // No Re-enrol button while a request is outstanding.
    await expect(page.getByRole('button', { name: /^re-enrol$/i })).toHaveCount(0);

    await page.goto('/people');
    const tab = page.getByRole('tab', { name: /face approvals/i });
    await expect(tab).toBeVisible({ timeout: 10_000 });
    await tab.click();
    await expect(page.getByText('Alex Admin').first()).toBeVisible({ timeout: 10_000 });

    // The review popup shows the employee, the old samples and the new ones.
    await page.getByText('Alex Admin').first().click();
    await expect(page.getByRole('heading', { name: /face id re-enrollment review/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/old face samples/i)).toBeVisible();
    await expect(page.getByText(/new face samples/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^approve$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^reject$/i })).toBeVisible();
  });
});
