import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Custom Fields', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/custom-fields');
    await page.waitForURL(/\/custom-fields/);
  });

  test('custom fields page loads', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /custom fields/i })
    ).toBeVisible();
  });

  test('tab switcher shows TICKET, CONTACT, DEAL, LEAD tabs', async ({ page }) => {
    await expect(page.getByRole('tab', { name: /ticket/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /contact/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /deal/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /lead/i })).toBeVisible();
  });

  test('creates a TEXT custom field for TICKET entity', async ({ page }) => {
    await page.getByRole('tab', { name: /ticket/i }).click();
    await page.getByRole('button', { name: /add field|new field|create/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/label/i).fill(TEST.customField.label);
    await dialog.getByLabel(/api name/i).fill(TEST.customField.name);

    const typeSelect = dialog.getByLabel(/type|field type/i);
    if (await typeSelect.isVisible()) {
      await typeSelect.selectOption('TEXT');
    }

    await dialog.getByRole('button', { name: /create|save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.customField.label)).toBeVisible({ timeout: 8_000 });
  });

  test('created field appears in the list', async ({ page }) => {
    await page.getByRole('tab', { name: /ticket/i }).click();
    await expect(page.getByText(TEST.customField.label)).toBeVisible({ timeout: 8_000 });
  });

  test('edits the field label', async ({ page }) => {
    await page.getByRole('tab', { name: /ticket/i }).click();

    // Custom fields use a real <table> so getByRole('row') works
    const fieldRow = page.locator('tbody tr').filter({ hasText: TEST.customField.label });
    await expect(fieldRow).toBeVisible();

    await fieldRow.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /edit field/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const labelInput = dialog.getByLabel(/label/i);
    await labelInput.fill(TEST.customField.label + ' Edited');
    await dialog.getByRole('button', { name: /save/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.customField.label + ' Edited')).toBeVisible({ timeout: 8_000 });
  });

  test('deletes the field and verifies removal', async ({ page }) => {
    await page.getByRole('tab', { name: /ticket/i }).click();

    const fieldText = TEST.customField.label + ' Edited';
    const fieldRow = page.locator('tbody tr').filter({ hasText: fieldText });
    await expect(fieldRow).toBeVisible();

    page.on('dialog', d => d.accept());
    await fieldRow.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete field/i }).click();

    await expect(page.getByText(fieldText)).not.toBeVisible({ timeout: 8_000 });
  });
});
