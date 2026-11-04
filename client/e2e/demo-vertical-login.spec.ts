import { test, expect } from '@playwright/test';

test.describe('Public demo — industry vertical picker', () => {
  test('default landing page is the login screen, not the demo page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('demo page lists multiple industry verticals and logs in as the chosen one', async ({ page }) => {
    await page.goto('/demo');

    // Vertical picker chips (industry names) should render once /api/demo/verticals resolves.
    const chips = page.getByRole('button', { name: /technology|healthcare|retail|financial|manufacturing|salon|automotive/i });
    await expect(chips.first()).toBeVisible({ timeout: 10_000 });
    const count = await chips.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Pick a non-default vertical (Healthcare) if present, else just use whatever's selected.
    const healthcare = page.getByRole('button', { name: /healthcare/i });
    if (await healthcare.count()) {
      await healthcare.click();
      await expect(healthcare).toHaveAttribute('aria-pressed', 'true');
    }

    await page.getByRole('button', { name: /try the live demo/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('Sign in link on the demo page returns to the login form', async ({ page }) => {
    await page.goto('/demo');
    await page.getByRole('link', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
