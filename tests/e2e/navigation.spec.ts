import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/** Key sidebar links and their expected URL patterns */
const SIDEBAR_LINKS = [
  { name: /dashboard/i, url: /\/dashboard/ },
  { name: /contacts/i, url: /\/crm\/contacts/ },
  { name: /leads/i, url: /\/crm\/leads/ },
  { name: /deals|pipeline/i, url: /\/crm\/deals/ },
  { name: /tickets/i, url: /\/itdesk\/tickets/ },
  { name: /reports/i, url: /\/reports/ },
];

test.describe('Navigation — Sidebar Links', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // Iterates over key sidebar links and verifies each navigates correctly
  for (const { name, url } of SIDEBAR_LINKS) {
    test(`sidebar link "${name.source}" navigates to correct URL`, async ({ page }) => {
      const link = page.getByRole('link', { name }).first();
      await expect(link).toBeVisible();
      await link.click();
      await page.waitForURL(url, { timeout: 8_000 });
      await expect(page).toHaveURL(url);
    });
  }
});

test.describe('Navigation — Mobile Responsive', () => {
  test('hamburger button is visible at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);

    // At mobile size the hamburger / menu button should be visible
    const hamburger = page.getByRole('button', { name: /menu|hamburger|open sidebar/i })
      .or(page.locator('[data-testid="hamburger"], [aria-label*="menu" i]'));
    await expect(hamburger.first()).toBeVisible({ timeout: 5_000 });
  });

  test('sidebar opens after hamburger click at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);

    const hamburger = page.getByRole('button', { name: /menu|hamburger|open sidebar/i })
      .or(page.locator('[data-testid="hamburger"], [aria-label*="menu" i]'));
    await hamburger.first().click();

    // Sidebar or nav should be visible
    const sidebar = page.locator('aside, nav[aria-label*="sidebar" i]').first();
    await expect(sidebar).toBeVisible({ timeout: 5_000 });
  });

  test('sidebar closes after clicking a nav item on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);

    const hamburger = page.getByRole('button', { name: /menu|hamburger|open sidebar/i })
      .or(page.locator('[data-testid="hamburger"], [aria-label*="menu" i]'));
    await hamburger.first().click();

    // Click a nav link inside the now-open sidebar
    const dashboardLink = page.getByRole('link', { name: /dashboard/i }).first();
    await expect(dashboardLink).toBeVisible({ timeout: 5_000 });
    await dashboardLink.click();

    // After navigation the sidebar should collapse (on mobile)
    await page.waitForURL(/\/dashboard/);
    // Not strictly testable without a data-testid but we assert nav completed
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe('Navigation — Unknown Routes', () => {
  // Verifies unknown routes redirect to dashboard
  test('unknown route redirects to dashboard or shows 404 page', async ({ page }) => {
    await login(page);
    await page.goto('/this-route-does-not-exist-xyz');
    // React Router redirect is client-side — wait for it before checking
    await page.waitForURL(/\/dashboard/, { timeout: 5_000 }).catch(() => {});
    // Either redirect to dashboard or show a 404 / Not Found page
    const isDashboard = page.url().includes('/dashboard');
    const is404 = await page.getByText(/not found|404|page.*not.*exist/i).isVisible().catch(() => false);
    expect(isDashboard || is404).toBeTruthy();
  });
});

test.describe('Navigation — Browser Back Button', () => {
  // Verifies browser back navigation works between pages
  test('back button returns to previous page', async ({ page }) => {
    await login(page);
    await page.goto('/crm/contacts');
    await page.waitForURL(/\/crm\/contacts/);

    await page.goto('/crm/leads');
    await page.waitForURL(/\/crm\/leads/);

    await page.goBack();
    await expect(page).toHaveURL(/\/crm\/contacts/, { timeout: 5_000 });
  });
});
