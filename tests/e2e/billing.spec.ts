import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test.describe('Billing', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/billing');
    await page.waitForURL(/\/billing/);
  });

  // Verifies the Billing page loads with heading
  test('billing page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /billing|subscription/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  // Verifies the subscription status or plan name is visible
  test('subscription status or plan name is visible', async ({ page }) => {
    await expect(
      page.getByText(/plan|subscription|starter|pro|enterprise|free|trial/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // Verifies an upgrade / switch / manage action is present
  test('upgrade or manage button is visible', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /upgrade|switch to|manage|subscribe|billing portal/i }).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // Licensed modules come from the effective-licence engine
  test('shows licensed modules for the current plan', async ({ page }) => {
    await expect(page.getByTestId('licensed-modules')).toContainText(/CRM \+ IT Desk core/);
  });

  // All four plan cards render, with the custom licence entry point
  test('renders plan cards, yearly toggle and custom licence link', async ({ page }) => {
    for (const plan of ['FREE', 'PRO', 'ENTERPRISE', 'CUSTOM']) {
      await expect(page.getByTestId(`plan-card-${plan}`)).toBeVisible();
    }
    await page.getByRole('radio', { name: /yearly/i }).click();
    await expect(page.getByTestId('plan-card-PRO')).toContainText(/billed \$\d+\/year/);
    await page.getByTestId('build-custom-licence').click();
    await page.waitForURL(/\/billing\/custom/);
  });
});
