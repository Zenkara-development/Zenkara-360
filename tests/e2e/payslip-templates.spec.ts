import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/auth';

const API = 'http://localhost:4000';
const token = (page: Page) => page.evaluate(() => localStorage.getItem('accessToken'));

test.describe('Payslip templates (phase 4)', () => {
  test('a default template exists, layouts and fields are listed', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const body = await (await page.request.get(`${API}/api/hr/payroll/templates`, { headers })).json();
    expect(body.templates.some((t: any) => t.isDefault)).toBeTruthy();
    expect(body.layouts.map((l: any) => l.key)).toEqual(expect.arrayContaining(['STANDARD', 'MODERN', 'MINIMAL', 'DETAILED', 'COMPACT', 'CORPORATE', 'BRANCH', 'STATEMENT']));
    expect(body.fields.length).toBeGreaterThan(10);
  });

  test('create, preview (HTML + PDF), assign, duplicate and delete a template', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const name = `E2E ${Date.now().toString(36)}`;
    const created = await page.request.post(`${API}/api/hr/payroll/templates`, { headers, data: { name, layout: 'CORPORATE', primaryColor: '#7c3aed', headerTitle: 'Salary Statement', signatoryName: 'E2E Bot', showFields: { amountInWords: true, bankDetails: true }, applicability: { employmentTypes: ['CONTRACT'] } } });
    expect(created.status()).toBe(201);
    const t = await created.json();
    expect(t.isDefault).toBe(false);

    const html = await (await page.request.get(`${API}/api/hr/payroll/templates/${t.id}/preview`, { headers })).json();
    expect(html.html).toContain('SALARY STATEMENT');
    expect(html.html).toContain('E2E Bot');
    expect(html.html).toMatch(/Rupees|Dollars|Only/);

    const pdf = await page.request.get(`${API}/api/hr/payroll/templates/${t.id}/preview?format=pdf`, { headers });
    expect(pdf.ok()).toBeTruthy();
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');

    // unsaved draft preview
    const draft = await page.request.post(`${API}/api/hr/payroll/templates/preview`, { headers, data: { layout: 'STATEMENT', primaryColor: '#000000', headerTitle: 'Draft Slip' } });
    expect(draft.ok()).toBeTruthy();
    expect((await draft.json()).html).toContain('DRAFT SLIP');

    const dup = await (await page.request.post(`${API}/api/hr/payroll/templates/${t.id}/duplicate`, { headers })).json();
    expect(dup.name).toBe(`${name} (copy)`);

    const del1 = await page.request.delete(`${API}/api/hr/payroll/templates/${dup.id}`, { headers });
    expect(del1.ok()).toBeTruthy();
    const del2 = await page.request.delete(`${API}/api/hr/payroll/templates/${t.id}`, { headers });
    expect(del2.ok()).toBeTruthy();
  });

  test('the default template cannot be deleted and legacy /template still works', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const legacy = await (await page.request.get(`${API}/api/hr/payroll/template`, { headers })).json();
    expect(legacy.isDefault).toBe(true);
    const del = await page.request.delete(`${API}/api/hr/payroll/templates/${legacy.id}`, { headers });
    expect(del.status()).toBe(400);
  });

  test('an issued payslip renders as HTML and PDF', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const payslips = await (await page.request.get(`${API}/api/hr/payroll/payslips?scope=org`, { headers })).json();
    const p = payslips.find((x: any) => x.status !== 'DRAFT');
    test.skip(!p, 'No issued payslip to render');
    const html = await (await page.request.get(`${API}/api/hr/payroll/payslips/${p.id}/html?embed=1`, { headers })).json();
    expect(html.html).toContain(p.payslipNumber);
    const pdf = await page.request.get(`${API}/api/hr/payroll/payslips/${p.id}/pdf`, { headers });
    expect(pdf.ok()).toBeTruthy();
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
  });
});
