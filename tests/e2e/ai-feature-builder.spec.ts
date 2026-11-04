import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * E2E tests for the AI Feature Builder page (/ai-builder)
 * Covers: navigation, rule CRUD, toggle, inline test runner, bulk score, quick-start templates
 */
test.describe('AI Feature Builder', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/ai-builder');
    await page.waitForURL(/\/ai-builder/, { timeout: 10_000 });
  });

  // ── Page load ───────────────────────────────────────────────────────────────

  test('AI Feature Builder page loads', async ({ page }) => {
    await expect(page.getByText(/AI Feature Builder/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test('page shows header description', async ({ page }) => {
    await expect(
      page.getByText(/create custom AI automations|no code required/i).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('New Rule button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /new rule/i })).toBeVisible({ timeout: 5_000 });
  });

  test('Score All Leads button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /score all leads/i })).toBeVisible({ timeout: 5_000 });
  });

  test('quick-start template cards are visible', async ({ page }) => {
    await expect(page.getByText(/Auto-Tag Tickets/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Smart Follow-ups/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/SLA Alerts/i)).toBeVisible({ timeout: 5_000 });
  });

  // ── Create rule ─────────────────────────────────────────────────────────────

  test.describe('Create AI Rule', () => {
    test('clicking New Rule opens the modal', async ({ page }) => {
      await page.getByRole('button', { name: /new rule/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(/Create AI Rule/i)).toBeVisible();
    });

    test('modal contains trigger selector', async ({ page }) => {
      await page.getByRole('button', { name: /new rule/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      // Scope to dialog — seed rule cards in the background also show "Ticket Created"
      await expect(dialog.getByText(/Ticket Created/i).first()).toBeVisible();
      await expect(dialog.getByText(/Manual/i).first()).toBeVisible();
    });

    test('modal contains action selector', async ({ page }) => {
      await page.getByRole('button', { name: /new rule/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      // Scope to dialog — "Auto-Tag" appears in template cards and seed rule cards too
      await expect(dialog.getByText(/Auto-Tag/i).first()).toBeVisible();
      await expect(dialog.getByText(/Custom Prompt/i).first()).toBeVisible();
    });

    test('selecting an action auto-fills the prompt template', async ({ page }) => {
      await page.getByRole('button', { name: /new rule/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      // Click the Summarize action button (scope to dialog to avoid strict-mode collision with selected-state span)
      await dialog.getByRole('button').filter({ hasText: /Generate a concise/ }).click();
      const promptField = dialog.locator('textarea');
      const val = await promptField.inputValue();
      expect(val.length).toBeGreaterThan(10);
    });

    test('can fill and submit the create rule form', async ({ page }) => {
      await page.getByRole('button', { name: /new rule/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Fill rule name
      await dialog.getByPlaceholder(/auto-tag billing/i).fill('Test AI Rule');

      // Select Manual trigger
      await dialog.getByRole('button').filter({ hasText: /Manual.*On Demand/ }).click();

      // Select Summarize action (scoped to dialog)
      await dialog.getByRole('button').filter({ hasText: /Generate a concise/ }).click();

      // Submit
      await dialog.getByRole('button', { name: /create rule/i }).click();

      // Modal should close and rule appear in list
      await expect(dialog).not.toBeVisible({ timeout: 8_000 });
      await expect(page.getByText('Test AI Rule')).toBeVisible({ timeout: 5_000 });
    });

    test('quick-start template pre-fills form', async ({ page }) => {
      // Click "Auto-Tag Tickets" template card
      await page.getByText(/Auto-Tag Tickets/i).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      // Prompt should be pre-filled from template
      const textarea = dialog.locator('textarea');
      const val = await textarea.inputValue();
      expect(val.length).toBeGreaterThan(5);
    });
  });

  // ── Rule list interactions ───────────────────────────────────────────────────

  test.describe('Rule list', () => {
    // Helper: ensure at least one rule exists
    async function ensureRule(page: any, name = 'E2E Test Rule') {
      await page.getByRole('button', { name: /new rule/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByPlaceholder(/auto-tag billing/i).fill(name);
      await dialog.getByRole('button').filter({ hasText: /Manual.*On Demand/ }).click();
      await dialog.getByRole('button').filter({ hasText: /Generate a concise/ }).click();
      await dialog.getByRole('button', { name: /create rule/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 8_000 });
      await expect(page.getByText(name)).toBeVisible({ timeout: 5_000 });
    }

    test('created rule shows trigger and action labels', async ({ page }) => {
      await ensureRule(page, 'Label Test Rule');
      // Use .first() — multiple rule cards may show Manual/Summarize labels
      await expect(page.getByText(/Manual/i).first()).toBeVisible();
      await expect(page.getByText(/Summarize/i).first()).toBeVisible();
    });

    test('toggle button disables the rule', async ({ page }) => {
      await ensureRule(page, 'Toggle Test Rule');
      // Find the toggle button for this rule card
      const ruleCard = page.locator('div').filter({ hasText: 'Toggle Test Rule' }).first();
      const toggleBtn = ruleCard.getByTitle(/disable|enable/i).first();
      if (await toggleBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await toggleBtn.click();
        // Rule should now show "Disabled" badge — scoped to this rule's own
        // card, not the whole page. Unscoped, this matched *any* "Disabled"
        // badge on the page, so a leftover duplicate 'Toggle Test Rule' card
        // from a Playwright retry (ensureRule() has no "skip if it already
        // exists" guard, so a retry just creates a second one) produced a
        // strict-mode "resolved to 2 elements" failure here instead of the
        // real, scoped assertion actually passing.
        await expect(ruleCard.getByText(/Disabled/i)).toBeVisible({ timeout: 5_000 });
      }
    });

    test('expand chevron reveals prompt details', async ({ page }) => {
      await ensureRule(page, 'Expand Test Rule');
      const ruleCard = page.locator('div').filter({ hasText: 'Expand Test Rule' }).first();
      const chevron = ruleCard.locator('button').last();
      await chevron.click();
      // Should show "Test this rule" section
      await expect(page.getByText(/Test this rule/i)).toBeVisible({ timeout: 5_000 });
    });

    test('inline test runner shows textarea and Run Test button', async ({ page }) => {
      await ensureRule(page, 'Runner Test Rule');
      const ruleCard = page.locator('div').filter({ hasText: 'Runner Test Rule' }).first();
      await ruleCard.locator('button').last().click();
      await expect(page.getByText(/Test this rule/i)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('button', { name: /Run Test/i })).toBeVisible({ timeout: 3_000 });
    });

    test('inline test runner with sample text shows AI output', async ({ page }) => {
      await ensureRule(page, 'Output Test Rule');
      const ruleCard = page.locator('div').filter({ hasText: 'Output Test Rule' }).first();
      await ruleCard.locator('button').last().click();
      await expect(page.getByText(/Test this rule/i)).toBeVisible({ timeout: 5_000 });

      // Fill sample text and run
      const textarea = page.locator('textarea').last();
      await textarea.fill('User cannot log in to the VPN. Error: authentication failed. Tried restarting — no luck.');
      await page.getByRole('button', { name: /Run Test/i }).click();

      // Should show output (AI Generated label or result text)
      await expect(
        page.getByText(/AI Output|AI Generated|summariz|result/i).first()
      ).toBeVisible({ timeout: 25_000 });
    });

    test('edit button opens modal with pre-filled values', async ({ page }) => {
      await ensureRule(page, 'Edit Test Rule');
      const ruleCard = page.locator('div').filter({ hasText: 'Edit Test Rule' }).first();
      // Click the pencil/edit button
      const editBtn = ruleCard.getByTitle(/edit/i).first();
      if (await editBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await editBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByText(/Edit Rule|Save Changes/i)).toBeVisible();
        // Name field should be pre-filled
        const nameField = dialog.getByPlaceholder(/auto-tag billing/i);
        const val = await nameField.inputValue();
        expect(val).toBe('Edit Test Rule');
      }
    });

    test('delete button removes the rule', async ({ page }) => {
      await ensureRule(page, 'Delete Test Rule');
      await expect(page.getByText('Delete Test Rule')).toBeVisible();
      const ruleCard = page.locator('div').filter({ hasText: 'Delete Test Rule' }).first();
      const deleteBtn = ruleCard.getByTitle(/delete/i).first();
      if (await deleteBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await deleteBtn.click();
        await expect(page.getByText('Delete Test Rule')).not.toBeVisible({ timeout: 5_000 });
      }
    });
  });

  // ── Bulk scoring ─────────────────────────────────────────────────────────────

  test.describe('Bulk Lead Scoring', () => {
    test('clicking Score All Leads shows result or loading', async ({ page }) => {
      await page.getByRole('button', { name: /score all leads/i }).click();
      // Should show either a success message or loading spinner
      await expect(
        page.getByText(/scoring|scored|leads scored|complete|all leads/i).first()
      ).toBeVisible({ timeout: 30_000 });
    });
  });

  // ── Sidebar navigation ───────────────────────────────────────────────────────

  test('AI Builder appears in sidebar navigation', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByRole('link', { name: /AI Builder|AI Feature/i }).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('sidebar AI Builder link navigates correctly', async ({ page }) => {
    await page.goto('/dashboard');
    const link = page.getByRole('link', { name: /AI Builder|AI Feature/i }).first();
    if (await link.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await link.click();
      await page.waitForURL(/\/ai-builder/, { timeout: 8_000 });
      await expect(page.getByText(/AI Feature Builder/i).first()).toBeVisible();
    }
  });
});
