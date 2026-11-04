import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Custom module builder', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/custom-modules');
  });

  test('create a module, add a field, and create a record', async ({ page }) => {
    const moduleName = `E2E Module ${Date.now()}`;

    await page.getByRole('button', { name: /new module/i }).click();
    await page.getByLabel('Module Name').fill(moduleName);
    await page.getByLabel('Description').fill('Created by the E2E suite');
    await page.getByRole('button', { name: /create module/i }).click();

    // Landing on the Fields tab for the newly created module
    await expect(page.getByRole('heading', { name: moduleName })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'fields' })).toHaveAttribute('aria-selected', 'true');

    // Add a text field, marked as the record's title field
    await page.getByRole('button', { name: /add field/i }).click();
    await page.getByLabel('Field Label').fill('Reference Number');
    await page.getByLabel('Field Type').selectOption({ label: 'Text' });
    await page.getByText('Use as record title').click();
    await page.getByRole('button', { name: /^add field$/i }).click();
    await expect(page.getByText('Reference Number')).toBeVisible({ timeout: 10_000 });

    // Switch to Records and create one
    await page.getByRole('tab', { name: 'records' }).click();
    await page.getByRole('button', { name: /add record/i }).click();
    await page.getByLabel('Reference Number').fill('REF-001');
    await page.getByRole('button', { name: /create record/i }).click();

    await expect(page.getByRole('cell', { name: 'REF-001' })).toBeVisible({ timeout: 10_000 });
  });

  test('sync tab saves an external polling configuration', async ({ page }) => {
    // Use the seeded module from techcorp's demo data — see seedDemoData.ts customModule for the techcorp vertical.
    await page.getByText('API Usage Logs').click();
    await page.getByRole('tab', { name: 'sync' }).click();

    await page.getByLabel('API URL').fill('https://example.com/api/usage');
    await page.getByLabel('Record Path').fill('data.items');
    await page.getByLabel('External ID Field').fill('id');
    await page.getByRole('button', { name: /save sync config/i }).click();

    await expect(page.getByText(/never synced|last sync/i)).toBeVisible({ timeout: 10_000 });
  });
});
