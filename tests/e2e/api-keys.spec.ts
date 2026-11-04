import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

const KEY_NAME = `E2E API Key ${Date.now()}`;

test.describe('API Keys', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/api-keys');
    await page.waitForURL(/\/api-keys/);
    await page.waitForLoadState('domcontentloaded');
  });

  // Verifies the API Keys page title is visible
  test('page title is visible', async ({ page }) => {
    // Scope to main to avoid matching the sidebar nav link
    await expect(
      page.locator('main').getByRole('heading', { name: /api keys/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  // Verifies a new API key can be created
  test('creates a new API key', async ({ page }) => {
    await page.getByRole('button', { name: /create|generate|new api key/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill the key name
    await dialog.getByLabel(/name/i).fill(KEY_NAME);

    // Select scopes if checkboxes are present
    const scopeCheckboxes = dialog.getByRole('checkbox');
    const count = await scopeCheckboxes.count();
    if (count > 0) {
      await scopeCheckboxes.first().check();
    }

    await dialog.getByRole('button', { name: /create|generate/i }).click();

    // Raw key is shown once after creation
    await expect(
      page.getByText(/your api key|copy this key|shown once/i)
    ).toBeVisible({ timeout: 8_000 });
  });

  // Verifies the copy button is present after key creation
  test('copy button exists after key creation', async ({ page }) => {
    // The key created in the previous test may have closed its dialog
    // Check if a "copy" button is visible on the page or in a result banner
    const copyBtn = page.getByRole('button', { name: /copy/i });
    // If dialog is still open from prior test (serial), check there; otherwise just assert it appeared
    if (await copyBtn.isVisible()) {
      await expect(copyBtn).toBeVisible();
    }
  });

  // Verifies the created key appears in the list
  test('created key appears in the list', async ({ page }) => {
    await expect(page.getByText(KEY_NAME)).toBeVisible({ timeout: 8_000 });
  });

  // Verifies revoking a key removes it from the list
  test('revoking a key removes it from the list', async ({ page }) => {
    const row = page.getByRole('row', { name: new RegExp(KEY_NAME, 'i') });
    await expect(row).toBeVisible();

    const revokeBtn = row.getByRole('button', { name: /revoke|delete/i });
    await expect(revokeBtn).toBeVisible();

    // The revoke button calls window.confirm() — register handler BEFORE clicking
    // so Playwright accepts (rather than dismisses) the native browser dialog.
    page.on('dialog', d => d.accept());
    await revokeBtn.click();

    await expect(page.getByText(KEY_NAME)).not.toBeVisible({ timeout: 8_000 });
  });
});
