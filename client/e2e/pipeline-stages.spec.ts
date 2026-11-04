import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Customizable pipeline stages', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/crm/deals');
  });

  test('add, rename, and delete a pipeline stage', async ({ page }) => {
    const stageName = `E2E Stage ${Date.now()}`;
    const renamed = `${stageName} Renamed`;

    await page.getByRole('button', { name: /manage stages/i }).click();
    await expect(page.getByRole('heading', { name: 'Manage Pipeline Stages' })).toBeVisible();

    // Add a new stage
    await page.getByLabel('New stage name').fill(stageName);
    await page.getByRole('button', { name: /add stage/i }).click();
    await expect(page.getByDisplayValue(stageName)).toBeVisible({ timeout: 10_000 });

    // New stage should now be selectable on the deal form's stage dropdown
    await page.getByRole('button', { name: /^close$/i }).click().catch(() => {}); // some Modal impls close via backdrop/X only
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /new deal/i }).click();
    const stageOptionLabels = await page.getByLabel('Stage').locator('option').allTextContents();
    expect(stageOptionLabels).toContain(stageName);
    await page.keyboard.press('Escape');

    // Rename it
    await page.getByRole('button', { name: /manage stages/i }).click();
    const nameInput = page.getByDisplayValue(stageName);
    await nameInput.fill(renamed);
    await page.getByRole('button', { name: /^save$/i }).first().click();
    await expect(page.getByDisplayValue(renamed)).toBeVisible({ timeout: 10_000 });

    // Delete it (no deals reference this brand-new stage, so it should delete cleanly)
    const row = page.locator('div').filter({ has: page.getByDisplayValue(renamed) }).first();
    await row.getByRole('button').last().click(); // trash icon button
    await expect(page.getByDisplayValue(renamed)).toHaveCount(0, { timeout: 10_000 });
  });

  test('kanban board renders one column per current pipeline stage', async ({ page }) => {
    await page.getByRole('button', { name: /manage stages/i }).click();
    const stageNames = await page.locator('input[aria-label^="Stage name"]').evaluateAll(
      (inputs) => inputs.map(i => (i as HTMLInputElement).value)
    );
    await page.keyboard.press('Escape');

    for (const name of stageNames) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
  });
});
