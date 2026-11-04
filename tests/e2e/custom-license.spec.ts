import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/auth';

const API = 'http://localhost:4000';

async function token(page: Page) {
  return page.evaluate(() => localStorage.getItem('accessToken'));
}

test.describe('Custom licence builder', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/billing/custom');
    await page.waitForURL(/\/billing\/custom/);
  });

  test('page loads with seats, billing cycle and modules', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /build a custom licence/i })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByLabel(/number of seats/i)).toBeVisible();
    await expect(page.getByRole('radio', { name: /monthly/i })).toBeVisible();
    await expect(page.getByTestId('module-core')).toBeDisabled();
    await expect(page.getByTestId('module-ai_advanced')).toBeVisible();
    await expect(page.getByTestId('quote-total')).toBeVisible({ timeout: 10_000 });
  });

  test('toggling a module changes the live total', async ({ page }) => {
    const total = page.getByTestId('quote-total');
    await expect(total).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^clear$/i }).click();
    await page.getByTestId('module-workflow_automation').click();
    await expect(page.getByTestId('module-workflow_automation')).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(500);
    const before = await total.textContent();
    await page.getByTestId('module-ai_advanced').click();
    await expect(page.getByTestId('module-ai_advanced')).toHaveAttribute('aria-checked', 'true');
    await expect(total).not.toHaveText(before!, { timeout: 10_000 });
  });

  test('changing seats and switching to yearly updates the total', async ({ page }) => {
    const total = page.getByTestId('quote-total');
    await expect(total).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '25', exact: true }).click();
    await expect(page.getByLabel(/number of seats/i)).toHaveValue('25');
    await page.waitForTimeout(500);
    const monthly = await total.textContent();
    await page.getByRole('radio', { name: /yearly/i }).click();
    await expect(page.getByTestId('license-summary')).toContainText('/year', { timeout: 10_000 });
    await expect(total).not.toHaveText(monthly!, { timeout: 10_000 });
    await expect(page.getByTestId('license-summary')).toContainText(/you save/i);
  });

  test('checkout is disabled when no module is selected', async ({ page }) => {
    await page.getByRole('button', { name: /^clear$/i }).click();
    await expect(page.getByRole('button', { name: /continue to checkout|update licence/i })).toBeDisabled();
    await expect(page.getByText(/select at least one module/i)).toBeVisible();
  });
});

test.describe('Licensing API', () => {
  test('pricing catalogue exposes modules, plans and tiers', async ({ page }) => {
    await login(page);
    const res = await page.request.get(`${API}/api/billing/pricing`, { headers: { Authorization: `Bearer ${await token(page)}` } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.modules.map((m: any) => m.key)).toEqual(
      expect.arrayContaining(['ai_advanced', 'workflow_automation', 'customer_portal', 'advanced_analytics', 'custom_branding', 'hosted_storage']),
    );
    expect(body.plans.map((p: any) => p.key)).toEqual(['FREE', 'PRO', 'ENTERPRISE']);
    expect(body.volumeTiers.length).toBeGreaterThan(0);
  });

  test('quote maths: base + modules, volume discount, yearly months', async ({ page }) => {
    await login(page);
    const headers = { Authorization: `Bearer ${await token(page)}` };
    const pricing = await (await page.request.get(`${API}/api/billing/pricing`, { headers })).json();
    const wf = pricing.modules.find((m: any) => m.key === 'workflow_automation').pricePerSeatCents;
    const base = pricing.baseSeatPriceCents;

    let q = await (await page.request.post(`${API}/api/billing/quote`, { headers, data: { seats: 10, modules: ['workflow_automation'], interval: 'month' } })).json();
    expect(q.perSeatMonthlyCents).toBe(base + wf);
    expect(q.totalMonthlyCents).toBe((base + wf) * 10);
    expect(q.volumeDiscountPct).toBe(0);
    expect(q.totalPerIntervalCents).toBe(q.totalMonthlyCents);

    q = await (await page.request.post(`${API}/api/billing/quote`, { headers, data: { seats: 100, modules: ['workflow_automation'], interval: 'year' } })).json();
    expect(q.volumeDiscountPct).toBe(10);
    const perSeat = Math.round((base + wf) * 0.9);
    expect(q.unitAmountPerIntervalCents).toBe(perSeat * pricing.yearlyMonthsCharged);
    expect(q.totalPerIntervalCents).toBe(perSeat * pricing.yearlyMonthsCharged * 100);

    q = await (await page.request.post(`${API}/api/billing/quote`, { headers, data: { seats: 5, modules: ['workflow_automation', 'not-a-module'], interval: 'month' } })).json();
    expect(q.modules).not.toContain('not-a-module');
    const bad = await page.request.post(`${API}/api/billing/quote`, { headers, data: { seats: 0, modules: [], interval: 'month' } });
    expect(bad.status()).toBe(400);
  });

  test('entitlements endpoint reports access level, features and seats', async ({ page }) => {
    await login(page);
    const res = await page.request.get(`${API}/api/billing/entitlements`, { headers: { Authorization: `Bearer ${await token(page)}` } });
    expect(res.ok()).toBeTruthy();
    const e = await res.json();
    expect(['full', 'grace', 'lapsed']).toContain(e.access);
    expect(Array.isArray(e.features)).toBeTruthy();
    expect(e.seats).toBeGreaterThan(0);
    expect(typeof e.storageQuotaGB).toBe('number');
  });

  test('custom checkout rejects a licence with no modules', async ({ page }) => {
    await login(page);
    const res = await page.request.post(`${API}/api/billing/custom-checkout`, {
      headers: { Authorization: `Bearer ${await token(page)}` },
      data: { seats: 5, modules: [], interval: 'month' },
    });
    expect(res.status()).toBe(400);
  });
});
