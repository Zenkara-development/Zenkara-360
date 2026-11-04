import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Lead to deal conversion', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('converting a lead creates a deal using the pipeline\'s current stages', async ({ page }) => {
    const uniqueName = `E2E Convert ${Date.now()}`;

    await page.goto('/crm/leads');
    await page.getByRole('button', { name: /new lead/i }).click();
    await page.getByLabel(/full name/i).fill(uniqueName);
    await page.getByLabel('Email').fill(`${uniqueName.replace(/\s+/g, '.').toLowerCase()}@example.com`);
    await page.getByRole('button', { name: /create lead/i }).click();

    const row = page.getByRole('row', { name: new RegExp(uniqueName) });
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.getByRole('button', { name: /convert/i }).click();
    await expect(page.getByRole('heading', { name: 'Convert Lead to Deal' })).toBeVisible();

    const dealTitle = `Deal for ${uniqueName}`;
    await page.getByLabel('Deal Title').fill(dealTitle);
    await page.getByLabel('Value ($)').fill('5000');
    // Stage dropdown is populated from the live pipeline (not hardcoded) —
    // just confirm it has at least one real option and leave the default.
    const stageOptions = await page.getByLabel('Stage').locator('option').allTextContents();
    expect(stageOptions.filter(Boolean).length).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^convert lead$/i }).click();

    // Lead should now show as Converted
    await expect(row.getByText('Converted')).toBeVisible({ timeout: 10_000 });

    // New deal should appear on the pipeline board
    await page.goto('/crm/deals');
    await expect(page.getByText(dealTitle)).toBeVisible({ timeout: 10_000 });
  });
});
