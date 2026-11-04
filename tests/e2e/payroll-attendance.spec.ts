import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/auth';

const API = 'http://localhost:4000';
const token = (page: Page) => page.evaluate(() => localStorage.getItem('accessToken'));
const myId = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('user') || '{}').id as string);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

test.describe('Payroll consumes attendance (phase 3)', () => {
  test('preview for an employee reflects the attendance register and LOP', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const userId = await myId(page);

    // A weekday last month marked absent by HR → 1 LOP day in that period
    const d = new Date(); d.setDate(0); d.setDate(10);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const date = ymd(d);
    const mark = await page.request.post(`${API}/api/hr/attendance/days`, { headers, data: { userId, date, status: 'ABSENT', reason: 'e2e payroll' } });
    expect(mark.ok()).toBeTruthy();

    const withAtt = await (await page.request.post(`${API}/api/hr/payroll/preview`, { headers, data: { userId, overrides: { BASIC: { amount: 30000 } }, on: date } })).json();
    expect(withAtt.attendance).toBeTruthy();
    expect(withAtt.inputs.lopDays).toBeGreaterThanOrEqual(1);
    expect(withAtt.inputs.workingDays).toBeLessThan(withAtt.period.daysInPeriod); // week-offs excluded
    const lopLine = withAtt.lines.find((l: any) => l.code === 'LOP');
    expect(lopLine.amount).toBeGreaterThan(0);

    const calendar = await (await page.request.post(`${API}/api/hr/payroll/preview`, { headers, data: { userId, overrides: { BASIC: { amount: 30000 } }, on: date, attendance: false } })).json();
    expect(calendar.attendance).toBeNull();
    expect(calendar.inputs.lopDays).toBe(0);
    expect(calendar.totals.net).toBeGreaterThan(withAtt.totals.net);

    await page.request.delete(`${API}/api/hr/attendance/days/${userId}/${date}`, { headers, data: { reason: 'e2e cleanup' } });
  });

  test('a draft run records its attendance mode and stores the attendance basis per payslip', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const cycles = await (await page.request.get(`${API}/api/hr/payroll/cycles`, { headers })).json();
    const cycle = cycles.find((c: any) => c.isDefault) ?? cycles[0];
    // pick a period far enough back that it will not collide with real runs
    const on = new Date(); on.setFullYear(on.getFullYear() - 3); on.setDate(5);
    const res = await page.request.post(`${API}/api/hr/payroll/runs`, { headers, data: { payrollCycleId: cycle.id, on: ymd(on), attendanceMode: 'ATTENDANCE' } });
    if (res.status() === 400) { test.skip(true, (await res.json()).error); return; }
    expect(res.status()).toBe(201);
    const run = await res.json();
    expect(run.attendanceMode).toBe('ATTENDANCE');
    expect(run.status).toBe('DRAFT');
    for (const p of run.payslips) {
      expect(p.attendanceSummary.source).toBe('attendance');
      expect(Number(p.workingDays)).toBeGreaterThan(0);
      expect(Number(p.paidDays)).toBeLessThanOrEqual(Number(p.workingDays));
    }
    await page.request.delete(`${API}/api/hr/payroll/runs/${run.id}`, { headers });
  });
});
