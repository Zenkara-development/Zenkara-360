import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test.describe('Org Branding', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/branding');
    await page.waitForURL(/\/branding/);
  });

  // Verifies the Branding settings page loads with a heading
  test('branding page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /branding|organization branding/i })
    ).toBeVisible();
  });

  // Verifies all expected form fields are visible
  test('form fields are visible: primary color, logo URL, favicon URL, portal welcome text', async ({ page }) => {
    // Primary color input (could be text input or color picker)
    const colorInput = page.getByLabel(/primary color|brand color/i);
    await expect(colorInput).toBeVisible();

    // Logo URL
    const logoInput = page.getByLabel(/logo url/i);
    await expect(logoInput).toBeVisible();

    // Favicon URL
    const faviconInput = page.getByLabel(/favicon url/i);
    await expect(faviconInput).toBeVisible();

    // Portal welcome text
    const welcomeInput = page.getByLabel(/portal welcome|welcome text|welcome message/i);
    await expect(welcomeInput).toBeVisible();
  });

  // Verifies filling the form and saving shows success feedback
  test('fills form fields and saves with success feedback', async ({ page }) => {
    const colorInput = page.getByLabel(/primary color|brand color/i);
    await colorInput.fill('#3b82f6');

    const logoInput = page.getByLabel(/logo url/i);
    await logoInput.fill('https://example.com/logo.png');

    const faviconInput = page.getByLabel(/favicon url/i);
    await faviconInput.fill('https://example.com/favicon.ico');

    const welcomeInput = page.getByLabel(/portal welcome|welcome text|welcome message/i);
    await welcomeInput.fill('Welcome to our support portal!');

    await page.getByRole('button', { name: /save|update/i }).click();

    // Success toast or inline success message
    await expect(
      page.getByText(/saved|updated|success/i)
    ).toBeVisible({ timeout: 8_000 });
  });

  // Verifies a preview panel is present (may update with logo/color)
  test('preview panel is visible', async ({ page }) => {
    const preview = page.getByText(/preview|portal preview/i);
    await expect(preview).toBeVisible();
  });
});
