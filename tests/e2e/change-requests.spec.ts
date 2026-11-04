import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Change Requests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/change-requests');
    await page.waitForURL(/\/change-requests/);
  });

  test('change requests page loads', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /change request/i })
    ).toBeVisible();
  });

  test('creates a new change request', async ({ page }) => {
    await page.getByRole('button', { name: /new request/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/title/i).fill(TEST.changeRequest.title);
    await dialog.getByLabel(/description/i).fill(TEST.changeRequest.description);

    // Type select: aria-label="Type" — option values are uppercase ('NORMAL', 'STANDARD', 'EMERGENCY')
    await dialog.getByLabel(/^type$/i).selectOption(TEST.changeRequest.type);

    // Risk Level select: aria-label="Risk Level" maps to Priority field — option values are 'LOW','MEDIUM','HIGH','CRITICAL'
    const riskSelect = dialog.getByLabel(/risk level/i);
    if (await riskSelect.isVisible()) {
      await riskSelect.selectOption(TEST.changeRequest.riskLevel);
    }

    await dialog.getByRole('button', { name: /create/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    // exact: true — "Reject"/"Delete" variant titles created by other tests in this
    // file start with the same string and would otherwise also match here.
    await expect(page.getByText(TEST.changeRequest.title, { exact: true })).toBeVisible({ timeout: 8_000 });
  });

  test('change request appears with DRAFT status', async ({ page }) => {
    // Status is DRAFT (not PENDING) when first created
    const card = page.locator('[data-testid="cr-card"]').filter({
      hasText: TEST.changeRequest.title,
    }).first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.getByText(/draft/i)).toBeVisible();
  });

  test('approves a change request', async ({ page }) => {
    const card = page.locator('[data-testid="cr-card"]').filter({
      hasText: TEST.changeRequest.title,
    }).first();
    await expect(card).toBeVisible();

    // Must advance from DRAFT → SUBMITTED before Approve button appears
    await card.getByRole('button', { name: /→ SUBMITTED/i }).click();
    await expect(card.getByText(/submitted/i)).toBeVisible({ timeout: 5_000 });

    // Now Approve button is visible
    await card.getByRole('button', { name: /approve/i }).click();
    await expect(card.getByText(/approved/i)).toBeVisible({ timeout: 8_000 });
  });

  test('rejects a change request', async ({ page }) => {
    // Create a second CR specifically to reject
    await page.getByRole('button', { name: /new request/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const rejectTitle = TEST.changeRequest.title + ' Reject';
    await dialog.getByLabel(/title/i).fill(rejectTitle);
    await dialog.getByLabel(/description/i).fill('CR to be rejected');
    await dialog.getByRole('button', { name: /create/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    const newCard = page.locator('[data-testid="cr-card"]').filter({
      hasText: rejectTitle,
    }).first();
    await expect(newCard).toBeVisible({ timeout: 5_000 });

    // Advance DRAFT → SUBMITTED so Reject button appears
    await newCard.getByRole('button', { name: /→ SUBMITTED/i }).click();
    await expect(newCard.getByText(/submitted/i)).toBeVisible({ timeout: 5_000 });

    // Click Reject
    await newCard.getByRole('button', { name: /reject/i }).click();

    // Reject modal appears — fill in reason and confirm
    const rejectDialog = page.getByRole('dialog');
    await expect(rejectDialog).toBeVisible({ timeout: 3_000 });
    await rejectDialog.locator('textarea').fill('Not approved at this time');
    await rejectDialog.getByRole('button', { name: /^reject$/i }).click();

    // Exact, case-sensitive match on the status badge only. A loose
    // /rejected/i match hit 3 elements in the same card: the "REJECTED"
    // badge, this test's own description text "CR to be rejected", and the
    // rejection-reason line "Rejected: Not approved..." — all legitimately
    // contain the substring, which turned a real pass into a strict-mode
    // violation.
    await expect(newCard.getByText('REJECTED', { exact: true })).toBeVisible({ timeout: 8_000 });
  });

  test('deletes a DRAFT change request', async ({ page }) => {
    // Create a CR to delete (the original CR is now APPROVED so delete btn is hidden)
    await page.getByRole('button', { name: /new request/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const deleteTitle = TEST.changeRequest.title + ' Delete';
    await dialog.getByLabel(/title/i).fill(deleteTitle);
    await dialog.getByLabel(/description/i).fill('CR to be deleted');
    await dialog.getByRole('button', { name: /create/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    const card = page.locator('[data-testid="cr-card"]').filter({
      hasText: deleteTitle,
    }).first();
    await expect(card).toBeVisible({ timeout: 5_000 });

    page.on('dialog', d => d.accept());
    await card.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete change request/i }).click();

    await expect(page.getByText(deleteTitle)).not.toBeVisible({ timeout: 8_000 });
  });
});
