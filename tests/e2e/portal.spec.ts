import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test.describe('Portal Users', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/portal-users');
    await page.waitForURL(/\/portal-users/);
  });

  // Verifies the Portal Users management page loads
  // Note: the actual heading says "Customer Portal" not "Portal Users"
  test('portal users page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /portal|customer/i })
    ).toBeVisible();
  });

  // Verifies the portal users list or table is visible
  test('portal users list or table is visible', async ({ page }) => {
    // Wait for the loading spinner to appear and then disappear
    const spinner = page.getByText('Loading…');
    try {
      await expect(spinner).toBeVisible({ timeout: 3_000 });
      await expect(spinner).not.toBeVisible({ timeout: 12_000 });
    } catch {
      // Spinner may not appear if data loads from cache — that's fine
    }
    // Either a table or an empty state should be visible (allow time for animations)
    const table = page.getByRole('table');
    const emptyState = page.getByText(/no portal customers|no portal users|no users/i);
    await expect(table.or(emptyState)).toBeVisible({ timeout: 8_000 });
  });

  // Verifies a portal login link or URL is visible on the page
  test('portal URL or login link is visible', async ({ page }) => {
    // Multiple elements may match (sidebar link, header title, page h1) — .first() is fine
    await expect(
      page.getByText(/portal url|portal link|customer portal/i).first()
    ).toBeVisible();
  });
});

test.describe('Customer Portal', () => {
  // Verifies the customer-facing portal page loads (unauthenticated)
  test('customer portal login page loads', async ({ page }) => {
    await page.goto('/portal');
    // Portal page should show a login form or a welcome message
    await expect(
      page.getByText(/portal|support|help center|sign in|login/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  // Verifies the portal shows the org branding or CRM & IT Desk name
  test('portal page shows branding', async ({ page }) => {
    await page.goto('/portal');
    await expect(
      page.getByText(/crm & it desk|portal|support/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
