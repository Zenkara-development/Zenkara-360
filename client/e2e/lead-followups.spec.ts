import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

// Covers the "leads only convert, no follow-up" gap: leads should support
// scheduling calls/emails/tasks/meetings before conversion, same as deals do.
test.describe('Lead follow-up activities', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('create a lead, schedule a follow-up, and mark it done', async ({ page }) => {
    const uniqueName = `E2E Lead ${Date.now()}`;

    await page.goto('/crm/leads');
    await page.getByRole('button', { name: /new lead/i }).click();

    await page.getByLabel(/full name/i).fill(uniqueName);
    await page.getByLabel('Email').fill(`${uniqueName.replace(/\s+/g, '.').toLowerCase()}@example.com`);
    await page.getByLabel(/source/i).selectOption({ label: 'Web' });
    await page.getByRole('button', { name: /create lead/i }).click();

    const row = page.getByRole('row', { name: new RegExp(uniqueName) });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Open the follow-ups drawer for this lead
    await row.getByTitle('Follow-up activities').click();
    await expect(page.getByRole('heading', { name: 'Follow-up Activities' })).toBeVisible();
    await expect(page.getByText('No follow-ups scheduled yet.')).toBeVisible();

    // Schedule one
    await page.getByLabel(/follow-up type/i).selectOption('CALL');
    await page.getByLabel(/follow-up title/i).fill('Intro call');
    await page.getByRole('button', { name: /^add$/i }).click();

    const followUpRow = page.getByText('Intro call');
    await expect(followUpRow).toBeVisible();

    // Mark it done
    await page.getByLabel('Mark as done').click();
    await expect(page.getByLabel('Mark as not done')).toBeVisible();

    await page.getByRole('button', { name: /close/i }).click();

    // Badge on the row should now show 1 follow-up
    await expect(row.getByTitle('Follow-up activities')).toContainText('1');
  });
});
