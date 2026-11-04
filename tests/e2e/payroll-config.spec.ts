import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/auth';

const API = 'http://localhost:4000';
const token = (page: Page) => page.evaluate(() => localStorage.getItem('accessToken'));

test.describe('Configurable payroll', () => {
  test('default components are seeded and include statutory presets', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const res = await page.request.get(`${API}/api/hr/payroll/components`, { headers });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const codes = body.components.map((c: any) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['BASIC', 'HRA', 'PF_EMP', 'PT', 'LOP']));
    expect(Object.keys(body.statutoryPresets)).toEqual(expect.arrayContaining(['PF_EMP', 'ESI_EMP', 'PT', 'TDS']));
  });

  test('a custom formula component is validated and previewed', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const code = `E2E_${Date.now().toString(36).toUpperCase()}`;
    const bad = await page.request.post(`${API}/api/hr/payroll/components`, { headers, data: { code, name: 'E2E Bad', category: 'EARNING', calcType: 'FORMULA', formula: 'NOPE * 2' } });
    expect(bad.status()).toBe(400);
    const ok = await page.request.post(`${API}/api/hr/payroll/components`, { headers, data: { code, name: 'E2E Allowance', category: 'EARNING', calcType: 'FORMULA', formula: 'BASIC * 0.1', prorate: true } });
    expect(ok.status()).toBe(201);
    const created = await ok.json();

    const preview = await (await page.request.post(`${API}/api/hr/payroll/preview`, { headers, data: { overrides: { BASIC: { amount: 20000 } } } })).json();
    const line = preview.lines.find((l: any) => l.code === code);
    expect(line.amount).toBe(2000);
    expect(preview.lines.find((l: any) => l.code === 'HRA').amount).toBe(8000);
    expect(preview.lines.find((l: any) => l.code === 'PF_EMP').amount).toBe(1800);
    expect(preview.totals.net).toBeGreaterThan(0);

    // LOP what-if: LOP line appears as a deduction
    const lop = await (await page.request.post(`${API}/api/hr/payroll/preview`, { headers, data: { overrides: { BASIC: { amount: 30000 } }, inputs: { lopDays: 2 } } })).json();
    expect(lop.lines.find((l: any) => l.code === 'LOP').amount).toBeGreaterThan(0);

    await page.request.delete(`${API}/api/hr/payroll/components/${created.id}`, { headers });
  });

  test('cycles: default monthly exists; weekly cycle computes a 7-day period', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const cycles = await (await page.request.get(`${API}/api/hr/payroll/cycles`, { headers })).json();
    expect(cycles.some((c: any) => c.isDefault && c.frequency === 'MONTHLY')).toBeTruthy();
    const res = await page.request.post(`${API}/api/hr/payroll/cycles`, { headers, data: { name: `E2E weekly ${Date.now()}`, frequency: 'WEEKLY', startWeekday: 1 } });
    expect(res.ok()).toBeTruthy();
    const c = await res.json();
    expect(c.currentPeriod.daysInPeriod).toBe(7);
    await page.request.put(`${API}/api/hr/payroll/cycles/${c.id}`, { headers, data: { name: c.name, frequency: 'WEEKLY', startWeekday: 1, isActive: false } });
  });

  test('employee salary → draft run → adjust → finalise', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const me = await (await page.request.get(`${API}/api/auth/me`, { headers })).json();
    const myId = me.id ?? me.user?.id;

    // Isolated custom cycle so we never collide with an existing monthly run
    const cycle = await (await page.request.post(`${API}/api/hr/payroll/cycles`, { headers, data: { name: `E2E run ${Date.now()}`, frequency: 'CUSTOM', anchorDate: '2026-01-01', lengthDays: 10 } })).json();
    const sal = await page.request.post(`${API}/api/hr/payroll/employee-salaries`, { headers, data: { userId: myId, payrollCycleId: cycle.id, overrides: { BASIC: { amount: 30000 }, TDS: { amount: 500, enabled: true } }, effectiveFrom: '2026-01-01' } });
    expect(sal.status()).toBe(201);

    const run = await page.request.post(`${API}/api/hr/payroll/runs`, { headers, data: { payrollCycleId: cycle.id, on: '2026-03-05' } });
    expect(run.status()).toBe(201);
    const draft = await run.json();
    expect(draft.status).toBe('DRAFT');
    const slip = draft.payslips.find((p: any) => p.userId === myId);
    expect(slip.status).toBe('DRAFT');
    expect(slip.lines.length).toBeGreaterThan(3);

    // Draft payslips are hidden from the employee's own list
    const mine = await (await page.request.get(`${API}/api/hr/payroll/payslips`, { headers })).json();
    expect(mine.some((p: any) => p.id === slip.id)).toBeFalsy();

    // Adjust a line, totals re-derive
    const adj = await page.request.patch(`${API}/api/hr/payroll/runs/${draft.id}/payslips/${slip.id}`, { headers, data: { code: 'BASIC', amount: 31000 } });
    expect(adj.ok()).toBeTruthy();
    const adjusted = await adj.json();
    expect(adjusted.lines.find((l: any) => l.code === 'BASIC').adjusted).toBe(true);
    expect(Number(adjusted.grossPay)).toBeGreaterThan(Number(slip.grossPay));

    // Recalculate keeps the adjustment
    const recalc = await (await page.request.post(`${API}/api/hr/payroll/runs/${draft.id}/recalculate`, { headers })).json();
    const after = recalc.payslips.find((p: any) => p.userId === myId);
    expect(after.lines.find((l: any) => l.code === 'BASIC').amount).toBe('31000');

    // Finalise → GENERATED, visible to the employee, then mark paid
    const fin = await (await page.request.post(`${API}/api/hr/payroll/runs/${draft.id}/finalize`, { headers })).json();
    expect(fin.status).toBe('PROCESSED');
    const mine2 = await (await page.request.get(`${API}/api/hr/payroll/payslips`, { headers })).json();
    expect(mine2.some((p: any) => p.payrollRunId === draft.id || p.payrollRun?.id === draft.id)).toBeTruthy();
    const paid = await (await page.request.patch(`${API}/api/hr/payroll/runs/${draft.id}/mark-paid`, { headers })).json();
    expect(paid.status).toBe('PAID');

    // Duplicate period rejected; a second draft can be discarded
    const dup = await page.request.post(`${API}/api/hr/payroll/runs`, { headers, data: { payrollCycleId: cycle.id, on: '2026-03-05' } });
    expect(dup.status()).toBe(400);
    const d2 = await (await page.request.post(`${API}/api/hr/payroll/runs`, { headers, data: { payrollCycleId: cycle.id, on: '2026-03-15' } })).json();
    const del = await page.request.delete(`${API}/api/hr/payroll/runs/${d2.id}`, { headers });
    expect(del.ok()).toBeTruthy();
  });

  test('payroll page shows the new tabs', async ({ page }) => {
    await login(page);
    await page.goto('/hr/payroll');
    for (const t of ['Employee Salaries', 'Salary Components', 'Cycles', 'Payroll Runs']) {
      await expect(page.getByRole('tab', { name: t })).toBeVisible({ timeout: 10_000 });
    }
    await page.getByRole('tab', { name: 'Salary Components' }).click();
    await expect(page.getByText('Basic Salary')).toBeVisible({ timeout: 10_000 });
  });
});
