import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test.describe('Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/analytics');
    await page.waitForURL(/\/analytics/);
  });

  // Verifies the Analytics page loads without JS errors
  test('analytics page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await expect(
      page.getByRole('heading', { name: /analytics/i })
    ).toBeVisible({ timeout: 8_000 });

    expect(errors.length).toBe(0);
  });

  // Verifies charts section is visible
  test('charts or metrics section is visible', async ({ page }) => {
    // Look for chart containers (recharts, canvas, or SVG elements)
    const chartArea = page
      .locator('svg, canvas, [class*="chart"], [class*="Chart"]')
      .first();
    await expect(chartArea).toBeVisible({ timeout: 8_000 });
  });

  // Verifies a date range filter is present
  test('date range filter is visible', async ({ page }) => {
    // AnalyticsPage uses a bare <select> with "Last 7 days" options
    const dateFilter = page.getByRole('combobox').first()
      .or(page.getByLabel(/date range|period|from date/i))
      .or(page.getByRole('button', { name: /date range|last 7|last 30/i }));
    await expect(dateFilter.first()).toBeVisible();
  });

  // Verifies at least one of the key metrics (revenue, ticket volume, conversions) is visible
  test('revenue, ticket volume or conversion metric is visible', async ({ page }) => {
    await expect(
      page.getByText(/revenue|ticket volume|conversion|leads|deals|pipeline/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
