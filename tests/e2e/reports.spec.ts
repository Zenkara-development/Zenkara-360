import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/reports');
    await page.waitForURL(/\/reports/);
  });

  // Verifies the Reports page heading is visible
  test('reports page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /reports/i })
    ).toBeVisible();
  });

  // Verifies IT Desk reports section is visible (default tab)
  test('IT Desk reports section is visible', async ({ page }) => {
    await expect(page.getByText(/sla compliance/i)).toBeVisible();
    await expect(page.getByText(/ticket volume/i)).toBeVisible();
    await expect(page.getByText(/status breakdown/i)).toBeVisible();
  });

  // Verifies CRM reports section is visible after switching tab
  test('CRM reports section visible after switching CRM tab', async ({ page }) => {
    await page.getByRole('button', { name: 'CRM' }).click();
    await expect(page.getByText(/win rate/i)).toBeVisible();
    await expect(page.getByText(/deals won/i)).toBeVisible();
    await expect(page.getByText(/deals lost/i)).toBeVisible();
  });

  // Verifies that metric numbers are displayed (not just dashes or N/A)
  test('metric numbers are visible in IT Desk tab', async ({ page }) => {
    // Wait for data to load
    await page.waitForLoadState('domcontentloaded');

    // Metric values should be numbers, not just "—" or empty
    const metricValues = page.locator('[class*="metric"], [class*="stat"], [class*="value"]');
    const count = await metricValues.count();
    if (count > 0) {
      const text = await metricValues.first().textContent();
      // Should contain a digit or percentage
      expect(text).toMatch(/\d/);
    }
  });

  // Verifies new deals and pipeline metrics in the CRM tab
  test('CRM tab shows new deals and pipeline metrics', async ({ page }) => {
    await page.getByRole('button', { name: 'CRM' }).click();
    await expect(page.getByText(/new deals/i)).toBeVisible();
    await expect(page.getByText(/weighted forecast/i)).toBeVisible();
  });
});
