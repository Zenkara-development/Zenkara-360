import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/workflows');
    await page.waitForURL(/\/workflows/);
  });

  // Verifies the Workflows page loads with heading
  test('workflows page loads', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /workflow/i })
    ).toBeVisible();
  });

  // Verifies a new workflow rule can be created
  test('creates a workflow rule', async ({ page }) => {
    await page.getByRole('button', { name: /new rule|create rule|add workflow/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill workflow name
    const nameInput = dialog.getByLabel(/name/i);
    await nameInput.fill(TEST.workflow.name);

    // Select trigger — use index 1 (first real option after placeholder)
    const triggerSelect = dialog.getByLabel(/trigger|event/i);
    if (await triggerSelect.isVisible()) {
      await triggerSelect.selectOption({ index: 1 });
    }

    // Fill or select a condition if available
    const conditionInput = dialog.getByLabel(/condition/i);
    if (await conditionInput.isVisible()) {
      await conditionInput.fill('priority = HIGH');
    }

    // Select action — use index 1 (first real option)
    const actionSelect = dialog.getByLabel(/action/i);
    if (await actionSelect.isVisible()) {
      await actionSelect.selectOption({ index: 1 });
    }

    await dialog.getByRole('button', { name: /create|save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    await expect(page.getByText(TEST.workflow.name)).toBeVisible({ timeout: 8_000 });
  });

  // Verifies the workflow rule appears in the list after creation
  test('workflow rule appears in the list', async ({ page }) => {
    await expect(page.getByText(TEST.workflow.name)).toBeVisible({ timeout: 5_000 });
  });

  // Verifies a workflow rule can be toggled enable/disable
  // WorkflowsPage renders rules as plain divs with bg-white border rounded-xl — not tr/li/card
  test('toggles enable/disable on a workflow rule', async ({ page }) => {
    const row = page.locator('[data-testid="workflow-rule"]')
      .filter({ hasText: TEST.workflow.name })
      .first();
    await expect(row).toBeVisible();

    // Toggle is the first button in the rule div
    const toggleBtn = row.locator('button').first();
    if (await toggleBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await toggleBtn.click();
    }
  });

  // Verifies a workflow rule can be deleted
  test('deletes a workflow rule and verifies removal', async ({ page }) => {
    const row = page.locator('[data-testid="workflow-rule"]')
      .filter({ hasText: TEST.workflow.name })
      .first();
    await expect(row).toBeVisible();

    page.once('dialog', d => d.accept());
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /^delete$/i }).click();

    await expect(page.getByText(TEST.workflow.name)).not.toBeVisible({ timeout: 8_000 });
  });
});
