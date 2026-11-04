import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Asset Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/itdesk/assets');
    await page.waitForURL(/\/itdesk\/assets/);
  });

  test('assets page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /assets/i })
    ).toBeVisible();
  });

  test('creates a new asset', async ({ page }) => {
    await page.getByRole('button', { name: /add asset/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/name/i).fill(TEST.asset.name);
    await dialog.getByLabel(/serial number/i).fill(TEST.asset.serialNumber);

    // Type select — use exact option text (valid values: Laptop, Desktop, etc.)
    await dialog.getByLabel(/^type$/i).selectOption(TEST.asset.assetType);

    // Status select — value is lowercase 'active', label is 'Active'
    await dialog.getByLabel(/status/i).selectOption('active');

    await dialog.getByRole('button', { name: /save changes|save asset/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.asset.name)).toBeVisible({ timeout: 8_000 });
  });

  test('asset appears in the table', async ({ page }) => {
    const row = page.locator('tbody tr').filter({ hasText: TEST.asset.name });
    await expect(row).toBeVisible({ timeout: 5_000 });
  });

  test('edits an asset', async ({ page }) => {
    const row = page.locator('tbody tr').filter({ hasText: TEST.asset.name });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /edit asset/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const nameInput = dialog.getByLabel(/name/i);
    await nameInput.fill(TEST.asset.name + ' Updated');
    await dialog.getByRole('button', { name: /save changes|save asset/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.asset.name + ' Updated')).toBeVisible({ timeout: 5_000 });
  });

  test('deletes an asset and verifies removal', async ({ page }) => {
    const assetName = TEST.asset.name + ' Updated';
    const row = page.locator('tbody tr').filter({ hasText: assetName });
    await expect(row).toBeVisible();

    page.on('dialog', d => d.accept());
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete asset/i }).click();

    await expect(page.getByText(assetName)).not.toBeVisible({ timeout: 8_000 });
  });
});
