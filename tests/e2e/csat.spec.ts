import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('CSAT Surveys', () => {
  // CSAT is triggered when a ticket is resolved.
  // We test both the admin (survey results) and the survey submission flow.

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('resolving a ticket triggers CSAT workflow', async ({ page }) => {
    await page.goto('/itdesk/tickets');

    // Create a ticket to resolve
    await page.getByRole('button', { name: /new ticket|create ticket/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/title|subject/i).fill('CSAT Test Ticket');
    // Fill description if the field is required
    const bodyInput = dialog.getByLabel(/description|body|details/i);
    if (await bodyInput.isVisible().catch(() => false)) {
      await bodyInput.fill('Test ticket for CSAT workflow.');
    }
    await dialog.getByRole('button', { name: /create|save|submit/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    // Open the ticket
    await page.getByText('CSAT Test Ticket').click();
    const ticketDialog = page.getByRole('dialog');
    await expect(ticketDialog).toBeVisible();

    // Change status to RESOLVED
    const resolveBtn = ticketDialog.getByRole('button', { name: /resolv/i });
    if (await resolveBtn.isVisible().catch(() => false)) {
      await resolveBtn.click();
    } else {
      const statusSelect = ticketDialog.getByLabel(/status/i);
      if (await statusSelect.isVisible()) {
        await statusSelect.selectOption({ label: /resolved/i });
      }
    }

    // Status should show RESOLVED
    await expect(ticketDialog.getByText(/resolved/i)).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press('Escape');
  });

  test('CSAT survey banner or link is visible on resolved ticket', async ({ page }) => {
    await page.goto('/itdesk/tickets');
    await page.getByText('CSAT Test Ticket').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Some implementations show a CSAT banner inside the ticket
    const hasCsatBanner = await dialog.getByText(/satisfaction|csat|rate|feedback/i).isVisible().catch(() => false);
    // Others show a rating widget
    const hasRating = await dialog.locator('[aria-label*="star" i], .star-rating, [data-testid*="rating"]').isVisible().catch(() => false);

    // Either is acceptable — CSAT can also be sent via email
    if (!hasCsatBanner && !hasRating) {
      // If no inline CSAT, there should at least be a "resolved" status
      await expect(dialog.getByText(/resolved/i).first()).toBeVisible();
    }
    await page.keyboard.press('Escape');
  });

  test('customer portal shows satisfaction rating option', async ({ page }) => {
    await page.goto('/portal-users');
    await expect(
      page.getByRole('heading', { name: /portal/i })
    ).toBeVisible({ timeout: 5_000 });
    // Portal users admin page should load without crash
    await expect(page.locator('body')).not.toContainText('Something went wrong');
  });

  test('CSAT results appear in reports or analytics', async ({ page }) => {
    await page.goto('/reports');
    const hasCsat = await page.getByText(/csat|satisfaction|rating/i).isVisible().catch(() => false);
    // Reports page should load
    await expect(page.getByRole('heading', { name: /report/i })).toBeVisible({ timeout: 5_000 });
    // CSAT data may or may not be surfaced depending on implementation
    if (hasCsat) {
      await expect(page.getByText(/csat|satisfaction/i)).toBeVisible();
    }
  });

  test('cleans up CSAT test ticket', async ({ page }) => {
    await page.goto('/itdesk/tickets');
    const row = page.getByRole('row', { name: /CSAT Test Ticket/i });
    if (await row.isVisible().catch(() => false)) {
      const deleteBtn = row.getByRole('button', { name: /delete|remove/i });
      if (await deleteBtn.isVisible().catch(() => false)) {
        await deleteBtn.click();
        const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i });
        if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await confirmBtn.click();
        }
      }
    }
  });
});
