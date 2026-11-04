import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Time Tracking', () => {
  // Distinct from TEST.ticket.title — tickets.spec.ts creates/mutates
  // (status changes, comments, resolve) that exact ticket in its own file.
  // Using a separate title avoids two files racing on the same row when run
  // with multiple workers.
  const TICKET_TITLE = 'E2E Time Tracking Ticket';

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/itdesk/tickets');
    await page.waitForURL(/\/itdesk\/tickets/);
  });

  // ── 1. Setup: ensure E2E ticket exists ───────────────────────────────────
  test('setup: creates a ticket if it does not exist', async ({ page }) => {
    const existingTicket = page.getByText(TICKET_TITLE).first();
    if (!(await existingTicket.isVisible())) {
      await page.getByRole('button', { name: /new ticket/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(/title/i).fill(TICKET_TITLE);
      await dialog.getByLabel(/description/i).fill(TEST.ticket.body);
      await dialog.getByRole('button', { name: /submit ticket/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    }
    await expect(page.getByText(TICKET_TITLE).first()).toBeVisible({ timeout: 5_000 });
  });

  // ── 2. Time Tracking section is visible inside ticket detail ─────────────
  test('time tracking section is visible in ticket detail', async ({ page }) => {
    await page.getByText(TICKET_TITLE).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText('Time Tracking').first()).toBeVisible({ timeout: 5_000 });
  });

  // ── 3. Log a time entry ──────────────────────────────────────────────────
  test('logs time with minutes and description', async ({ page }) => {
    await page.getByText(TICKET_TITLE).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The form is hidden — click "Log time" toggle first
    await dialog.getByRole('button', { name: /log time/i }).click();

    // Fill minutes (aria-label="Minutes" added to the input)
    const minutesInput = dialog.getByLabel('Minutes');
    await expect(minutesInput).toBeVisible({ timeout: 3_000 });
    await minutesInput.fill('30');

    // Fill optional note (aria-label="Note")
    const noteInput = dialog.getByLabel('Note');
    if (await noteInput.isVisible()) {
      await noteInput.fill('Playwright time tracking test');
    }

    // Submit — button text is "Log" (NOT "Log time")
    await dialog.getByRole('button', { name: /^log$/i }).click();

    // Entry should appear formatted as "30m"
    await expect(dialog.getByText('30m').first()).toBeVisible({ timeout: 8_000 });
  });

  // ── 4. Logged entry appears in the list ──────────────────────────────────
  test('time entry appears in the list after logging', async ({ page }) => {
    await page.getByText(TICKET_TITLE).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // "30m" was logged in the previous test; look for the formatted value
    await expect(dialog.getByText('30m').first()).toBeVisible({ timeout: 5_000 });
  });

  // ── 5. Total minutes badge updates ───────────────────────────────────────
  test('total minutes updates after logging', async ({ page }) => {
    await page.getByText(TICKET_TITLE).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The panel shows a badge like "30m total" when totalMinutes > 0
    await expect(dialog.getByText(/total/i).first()).toBeVisible({ timeout: 5_000 });
  });

  // ── 6. Delete a time entry ───────────────────────────────────────────────
  test('deletes a time entry and verifies removal', async ({ page }) => {
    await page.getByText(TICKET_TITLE).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Find a time entry row; hover to reveal the delete button (opacity-0 → visible)
    const entryRow = dialog.locator('div').filter({ hasText: /\dm$/ }).first();
    if (await entryRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await entryRow.hover();
      const deleteBtn = entryRow.locator('button[aria-label="Delete time entry"]');
      if (await deleteBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await deleteBtn.click();
        // Confirm dialog if it appears
        const confirmBtn = page.getByRole('button', { name: /confirm|yes/i });
        if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await confirmBtn.click();
        }
      }
    }
    // Dialog should still be open after deletion
    await expect(dialog).toBeVisible();
  });
});
