import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/auth';

const API = 'http://localhost:4000';
const token = (page: Page) => page.evaluate(() => localStorage.getItem('accessToken'));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const myId = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('user') || '{}').id as string);

test.describe('Attendance policy engine', () => {
  test('a default policy group exists and the register computes a month', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };

    const groups = await (await page.request.get(`${API}/api/hr/attendance/policy-groups`, { headers })).json();
    expect(groups.groups.some((g: any) => g.isDefault)).toBeTruthy();
    expect(groups.defaultLateBands.length).toBeGreaterThan(0);

    const month = ymd(new Date()).slice(0, 7);
    const reg = await page.request.get(`${API}/api/hr/attendance/register?month=${month}`, { headers });
    expect(reg.ok()).toBeTruthy();
    const body = await reg.json();
    expect(body.rows.length).toBeGreaterThan(0);
    const row = body.rows[0];
    expect(row.days.length).toBeGreaterThanOrEqual(28);
    expect(row.summary.workingDays).toBeGreaterThan(0);
    expect(row.summary.paidDays).toBeLessThanOrEqual(row.summary.daysInPeriod);
    // week-offs come from the policy (default Sat/Sun)
    const sunday = row.days.find((d: any) => new Date(d.date + 'T00:00:00').getDay() === 0);
    expect(sunday?.status).toBe('WEEK_OFF');
  });

  test('manual correction wins over the computed status, is audited, and can be reset', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const userId = await myId(page);

    // pick a past weekday in the current month
    const today = new Date();
    const d = new Date(today); d.setDate(1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const date = ymd(d);
    const month = date.slice(0, 7);

    const mark = await page.request.post(`${API}/api/hr/attendance/days`, { headers, data: { userId, date, status: 'WFH', reason: 'e2e regularisation' } });
    expect(mark.ok()).toBeTruthy();

    let reg = await (await page.request.get(`${API}/api/hr/attendance/register?month=${month}&userId=${userId}`, { headers })).json();
    let day = reg.rows[0].days.find((x: any) => x.date === date);
    expect(day.status).toBe('WFH');
    expect(day.source).toBe('MANUAL');
    expect(day.paidFraction).toBe(1);

    const audit = await (await page.request.get(`${API}/api/hr/attendance/audit?userId=${userId}`, { headers })).json();
    expect(audit.some((a: any) => a.reason === 'e2e regularisation')).toBeTruthy();

    const reset = await page.request.delete(`${API}/api/hr/attendance/days/${userId}/${date}`, { headers, data: { reason: 'e2e cleanup' } });
    expect(reset.ok()).toBeTruthy();
    reg = await (await page.request.get(`${API}/api/hr/attendance/register?month=${month}&userId=${userId}`, { headers })).json();
    day = reg.rows[0].days.find((x: any) => x.date === date);
    expect(day.source).toBe('COMPUTED');
  });

  test('holidays are honoured by the register', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const d = new Date(); d.setDate(15);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const date = ymd(d);
    const created = await (await page.request.post(`${API}/api/hr/attendance/holidays`, { headers, data: { date, name: 'E2E Holiday' } })).json();
    const reg = await (await page.request.get(`${API}/api/hr/attendance/register?month=${date.slice(0, 7)}`, { headers })).json();
    expect(reg.rows[0].days.find((x: any) => x.date === date).status).toBe('HOLIDAY');
    await page.request.delete(`${API}/api/hr/attendance/holidays/${created.id}`, { headers });
  });

  test('admin can apply half-day leave on behalf and cancel approved leave', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const userId = await myId(page);
    const types = await (await page.request.get(`${API}/api/hr/leave/types`, { headers })).json();
    const type = types[0];
    const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(3);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const date = ymd(d);

    const res = await page.request.post(`${API}/api/hr/leave/requests/on-behalf`, { headers, data: { userId, leaveTypeId: type.id, startDate: date, endDate: date, halfDay: true, halfDayPeriod: 'AM', reason: 'e2e', autoApprove: true } });
    expect(res.ok()).toBeTruthy();
    const req = await res.json();
    expect(req.status).toBe('APPROVED');
    expect(Number(req.days)).toBe(0.5);

    const bal = await (await page.request.get(`${API}/api/hr/leave/balance?userId=${userId}&year=${d.getFullYear()}`, { headers })).json();
    const b = bal.find((x: any) => x.leaveType.id === type.id);
    expect(b.used).toBeGreaterThanOrEqual(0.5);

    const cancel = await page.request.post(`${API}/api/hr/leave/requests/${req.id}/admin-cancel`, { headers, data: { reason: 'e2e cleanup' } });
    expect(cancel.ok()).toBeTruthy();
    expect((await cancel.json()).status).toBe('CANCELLED');
  });
});
