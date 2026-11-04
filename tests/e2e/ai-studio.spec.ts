import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * E2E tests for AI Studio (/ai-studio)
 * Covers:
 *   - Navigation + page load
 *   - Tab 1: Business Context (save domain settings)
 *   - Tab 2: Custom AI Functions (CRUD + toggle + inline test panel)
 *   - Tab 3: Custom Scripts  (CRUD + toggle + validate syntax)
 */

test.describe('AI Studio', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/ai-studio');
    await page.waitForURL(/\/ai-studio/, { timeout: 10_000 });
  });

  // ── Page load ────────────────────────────────────────────────────────────────

  test('AI Studio page loads with header', async ({ page }) => {
    await expect(page.getByText(/AI Studio/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test('shows all three tab buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Business Context/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /Custom Functions/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /Custom Scripts/i })).toBeVisible({ timeout: 5_000 });
  });

  test('AI Studio link appears in sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByRole('link', { name: /AI Studio/i }).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('sidebar AI Studio link navigates correctly', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /AI Studio/i }).first().click();
    await page.waitForURL(/\/ai-studio/, { timeout: 8_000 });
    await expect(page.getByText(/AI Studio/i).first()).toBeVisible();
  });

  // ── Tab 1: Business Context ──────────────────────────────────────────────────

  test.describe('Business Context tab', () => {
    test('Business Context tab is active by default', async ({ page }) => {
      // Industry select should be visible on first load (no tab click needed)
      await expect(page.getByText(/Industry/i).first()).toBeVisible({ timeout: 5_000 });
    });

    test('shows Industry selector', async ({ page }) => {
      const industrySelect = page.locator('select').first();
      await expect(industrySelect).toBeVisible({ timeout: 5_000 });
    });

    test('shows Company Description textarea', async ({ page }) => {
      await expect(
        page.getByPlaceholder(/briefly describe what your company does/i)
      ).toBeVisible({ timeout: 5_000 });
    });

    test('shows tone buttons: professional, casual, technical', async ({ page }) => {
      await expect(page.getByRole('button', { name: /professional/i })).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('button', { name: /casual/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /technical/i })).toBeVisible();
    });

    test('can select an industry from the dropdown', async ({ page }) => {
      const industrySelect = page.locator('select').first();
      await industrySelect.selectOption('Healthcare');
      await expect(industrySelect).toHaveValue('Healthcare');
    });

    test('can fill company description', async ({ page }) => {
      const textarea = page.getByPlaceholder(/briefly describe what your company does/i);
      await textarea.fill('We provide healthcare software to clinics across North America.');
      await expect(textarea).toHaveValue(/healthcare software/i);
    });

    test('can switch tone to casual', async ({ page }) => {
      await page.getByRole('button', { name: /casual/i }).click();
      // After clicking, the button should have active styling (bg-brand-600)
      const casualBtn = page.getByRole('button', { name: /casual/i });
      await expect(casualBtn).toHaveClass(/bg-brand/);
    });

    test('can add a domain terminology entry', async ({ page }) => {
      const inputs = page.locator('input[placeholder*="Term"]');
      const meansInput = page.locator('input[placeholder*="Means"]');
      await inputs.fill('patient');
      await meansInput.fill('a customer with an active insurance policy');
      await page.getByRole('button', { name: /^Add$/i }).click();
      await expect(page.getByText('patient').first()).toBeVisible({ timeout: 3_000 });
    });

    test('can save business context and see success message', async ({ page }) => {
      // Fill minimal data and save
      const descTextarea = page.getByPlaceholder(/briefly describe what your company does/i);
      await descTextarea.fill('E2E test company description.');
      await page.getByRole('button', { name: /Save Business Context/i }).click();
      await expect(
        page.getByText(/Saved|saved/i).first()
      ).toBeVisible({ timeout: 8_000 });
    });
  });

  // ── Tab 2: Custom AI Functions ───────────────────────────────────────────────

  test.describe('Custom AI Functions tab', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: /Custom Functions/i }).click();
      await expect(page.getByRole('button', { name: /New Function/i })).toBeVisible({ timeout: 5_000 });
    });

    test('shows New Function button', async ({ page }) => {
      await expect(page.getByRole('button', { name: /New Function/i })).toBeVisible();
    });

    test('shows empty state when no functions exist', async ({ page }) => {
      const count = await page.locator('[class*="rounded-xl"][class*="border"][class*="shadow"]').count();
      if (count === 0) {
        await expect(page.getByText(/No custom functions yet/i)).toBeVisible({ timeout: 3_000 });
      }
    });

    test('clicking New Function opens the modal', async ({ page }) => {
      await page.getByRole('button', { name: /New Function/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(/New Custom AI Function/i)).toBeVisible();
    });

    test('modal contains name, description, system prompt, and output type fields', async ({ page }) => {
      await page.getByRole('button', { name: /New Function/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByPlaceholder(/Classify Patient Urgency/i)).toBeVisible();
      await expect(dialog.getByPlaceholder(/What does this function do/i)).toBeVisible();
      await expect(dialog.getByPlaceholder(/You are a helpful assistant/i)).toBeVisible();
      await expect(dialog.locator('select').first()).toBeVisible();
    });

    test('can create a custom AI function', async ({ page }) => {
      await page.getByRole('button', { name: /New Function/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      await dialog.getByPlaceholder(/Classify Patient Urgency/i).fill('E2E Classify Urgency');
      await dialog.getByPlaceholder(/What does this function do/i).fill('Classifies ticket urgency');
      await dialog.getByPlaceholder(/You are a helpful assistant/i).fill(
        'You are a support classifier. Given a ticket, return LOW, MEDIUM, or HIGH urgency.'
      );

      await dialog.getByRole('button', { name: /Create Function/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 8_000 });
      await expect(page.getByText('E2E Classify Urgency')).toBeVisible({ timeout: 5_000 });
    });

    test('can add an input field to a function', async ({ page }) => {
      await page.getByRole('button', { name: /New Function/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Fill required fields first
      await dialog.getByPlaceholder(/Classify Patient Urgency/i).fill('E2E Input Field Test');
      await dialog.getByPlaceholder(/You are a helpful assistant/i).fill('You are a test assistant.');

      // Add an input field
      await dialog.locator('input[placeholder="field_name"]').fill('ticket_text');
      await dialog.locator('input[placeholder="Label"]').fill('Ticket Text');
      await dialog.getByRole('button', { name: /^Add$/i }).click();

      // Field should appear in the list above
      await expect(dialog.getByText('Ticket Text')).toBeVisible({ timeout: 3_000 });
    });

    test('cancel button closes modal without saving', async ({ page }) => {
      await page.getByRole('button', { name: /New Function/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByRole('button', { name: /Cancel/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 3_000 });
    });

    test.describe('with existing function', () => {
      async function createFunction(page: any, name = 'E2E Test Function') {
        await page.getByRole('button', { name: /New Function/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        await dialog.getByPlaceholder(/Classify Patient Urgency/i).fill(name);
        await dialog.getByPlaceholder(/You are a helpful assistant/i).fill(
          'You are a test assistant. Respond with "OK".'
        );
        await dialog.getByRole('button', { name: /Create Function/i }).click();
        await expect(dialog).not.toBeVisible({ timeout: 8_000 });
        await expect(page.getByText(name).first()).toBeVisible({ timeout: 5_000 });
      }

      test('created function shows output type badge', async ({ page }) => {
        await createFunction(page, 'Badge Test Function');
        await expect(page.getByText('text').first()).toBeVisible({ timeout: 3_000 });
      });

      test('toggle button disables a function', async ({ page }) => {
        await createFunction(page, 'Toggle Test Function');
        // Scoped to the specific function card — a bare 'div' + filter({hasText})
        // also matches the outer list wrapper (which "has" every card's text and
        // buttons too), so .first() would grab the wrong element once more than
        // one function exists.
        const card = page.locator('[data-testid="ai-function-card"]').filter({ hasText: 'Toggle Test Function' }).first();
        // The ToggleRight button (active state) should be visible
        const toggleBtn = card.locator('button[title]').first();
        if (await toggleBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await toggleBtn.click();
          // Card should become visually dimmed (opacity-60)
          await expect(card).toHaveClass(/opacity-60/, { timeout: 3_000 });
        }
      });

      test('edit pencil button opens pre-filled modal', async ({ page }) => {
        await createFunction(page, 'Edit Test Function');
        const card = page.locator('[data-testid="ai-function-card"]').filter({ hasText: 'Edit Test Function' }).first();
        // Pencil icon button — second-to-last button in card actions
        const editBtn = card.locator('button').nth(-2);
        await editBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByText(/Edit Function/i)).toBeVisible();
        const nameInput = dialog.getByPlaceholder(/Classify Patient Urgency/i);
        await expect(nameInput).toHaveValue('Edit Test Function');
      });

      test('delete button removes the function', async ({ page }) => {
        await createFunction(page, 'Delete Test Function');
        await expect(page.getByText('Delete Test Function')).toBeVisible();
        page.once('dialog', d => d.accept());
        const card = page.locator('[data-testid="ai-function-card"]').filter({ hasText: 'Delete Test Function' }).first();
        const deleteBtn = card.locator('button').last();
        await deleteBtn.click();
        await expect(page.getByText('Delete Test Function')).not.toBeVisible({ timeout: 5_000 });
      });
    });
  });

  // ── Tab 3: Custom Scripts ────────────────────────────────────────────────────

  test.describe('Custom Scripts tab', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: /Custom Scripts/i }).click();
      await expect(page.getByRole('button', { name: /New Script/i })).toBeVisible({ timeout: 5_000 });
    });

    test('shows New Script button', async ({ page }) => {
      await expect(page.getByRole('button', { name: /New Script/i })).toBeVisible();
    });

    test('shows empty state when no scripts exist', async ({ page }) => {
      const count = await page.locator('[class*="rounded-xl"][class*="border"][class*="shadow"]').count();
      if (count === 0) {
        await expect(page.getByText(/No custom scripts yet/i)).toBeVisible({ timeout: 3_000 });
      }
    });

    test('clicking New Script opens the modal', async ({ page }) => {
      await page.getByRole('button', { name: /New Script/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(/New Custom Script/i)).toBeVisible();
    });

    test('modal contains name, entity type, trigger, and code editor', async ({ page }) => {
      await page.getByRole('button', { name: /New Script/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByPlaceholder(/auto-set priority/i)).toBeVisible();
      // Entity type + trigger selects
      const selects = dialog.locator('select');
      await expect(selects.first()).toBeVisible();
      // Code textarea (dark background)
      await expect(dialog.locator('textarea[class*="font-mono"]')).toBeVisible();
    });

    test('code editor pre-fills with template', async ({ page }) => {
      await page.getByRole('button', { name: /New Script/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      const codeArea = dialog.locator('textarea[class*="font-mono"]');
      const val = await codeArea.inputValue();
      expect(val.length).toBeGreaterThan(20);
    });

    test('validate syntax button appears in modal', async ({ page }) => {
      await page.getByRole('button', { name: /New Script/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByRole('button', { name: /Validate syntax/i })).toBeVisible();
    });

    test('validate syntax reports OK for valid script', async ({ page }) => {
      await page.getByRole('button', { name: /New Script/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Replace template with simple valid script
      const codeArea = dialog.locator('textarea[class*="font-mono"]');
      await codeArea.fill('const x = 1 + 1;');

      await dialog.getByRole('button', { name: /Validate syntax/i }).click();
      await expect(dialog.getByText(/Syntax OK/i)).toBeVisible({ timeout: 8_000 });
    });

    test('validate syntax reports error for invalid script', async ({ page }) => {
      await page.getByRole('button', { name: /New Script/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      const codeArea = dialog.locator('textarea[class*="font-mono"]');
      await codeArea.fill('const x = (((;');  // deliberate syntax error

      await dialog.getByRole('button', { name: /Validate syntax/i }).click();
      await expect(dialog.getByText(/Unexpected|SyntaxError|error/i).first()).toBeVisible({ timeout: 8_000 });
    });

    test('can create a custom script', async ({ page }) => {
      await page.getByRole('button', { name: /New Script/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      await dialog.getByPlaceholder(/auto-set priority/i).fill('E2E Auto-Priority Script');
      // Entity type stays at default (ticket)
      // Script stays as template

      await dialog.getByRole('button', { name: /Create Script/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 8_000 });
      await expect(page.getByText('E2E Auto-Priority Script')).toBeVisible({ timeout: 5_000 });
    });

    test('cancel closes modal without saving', async ({ page }) => {
      await page.getByRole('button', { name: /New Script/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByRole('button', { name: /Cancel/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 3_000 });
    });

    test.describe('with existing script', () => {
      async function createScript(page: any, name = 'E2E Test Script') {
        await page.getByRole('button', { name: /New Script/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        await dialog.getByPlaceholder(/auto-set priority/i).fill(name);
        await dialog.getByRole('button', { name: /Create Script/i }).click();
        await expect(dialog).not.toBeVisible({ timeout: 8_000 });
        await expect(page.getByText(name).first()).toBeVisible({ timeout: 5_000 });
      }

      test('created script shows entity type and trigger badges', async ({ page }) => {
        await createScript(page, 'Badge Script Test');
        // Badges: entity type (e.g. "ticket") and trigger (e.g. "onLoad")
        await expect(page.getByText('ticket').first()).toBeVisible({ timeout: 3_000 });
        await expect(page.getByText('onLoad').first()).toBeVisible({ timeout: 3_000 });
      });

      test('toggle button disables a script', async ({ page }) => {
        await createScript(page, 'Toggle Script Test');
        // Scoped to the specific script card — see comment on the matching
        // function-tab test above for why a bare 'div' filter isn't safe here.
        const card = page.locator('[data-testid="ai-script-card"]').filter({ hasText: 'Toggle Script Test' }).first();
        const toggleBtn = card.locator('button[title]').first();
        if (await toggleBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await toggleBtn.click();
          await expect(card).toHaveClass(/opacity-60/, { timeout: 3_000 });
        }
      });

      test('edit pencil button opens pre-filled modal', async ({ page }) => {
        await createScript(page, 'Edit Script Test');
        const card = page.locator('[data-testid="ai-script-card"]').filter({ hasText: 'Edit Script Test' }).first();
        const editBtn = card.locator('button').nth(-2);
        await editBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByText(/Edit Script/i)).toBeVisible();
        const nameInput = dialog.getByPlaceholder(/auto-set priority/i);
        await expect(nameInput).toHaveValue('Edit Script Test');
      });

      test('delete button removes the script', async ({ page }) => {
        await createScript(page, 'Delete Script Test');
        await expect(page.getByText('Delete Script Test')).toBeVisible();
        page.once('dialog', d => d.accept());
        const card = page.locator('[data-testid="ai-script-card"]').filter({ hasText: 'Delete Script Test' }).first();
        const deleteBtn = card.locator('button').last();
        await deleteBtn.click();
        await expect(page.getByText('Delete Script Test')).not.toBeVisible({ timeout: 5_000 });
      });

      test('fieldTarget input appears when trigger is onFieldChange', async ({ page }) => {
        await page.getByRole('button', { name: /New Script/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        // Select onFieldChange trigger
        const triggerSelect = dialog.locator('select').nth(1);
        await triggerSelect.selectOption('onFieldChange');
        await expect(dialog.getByPlaceholder(/e.g. priority/i)).toBeVisible({ timeout: 3_000 });
      });
    });
  });

  // ── Context API reference ────────────────────────────────────────────────────

  test('context API reference expands in script editor', async ({ page }) => {
    await page.getByRole('button', { name: /Custom Scripts/i }).click();
    await page.getByRole('button', { name: /New Script/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByText(/Available context API/i).click();
    await expect(dialog.getByText(/context\.entity/i).first()).toBeVisible({ timeout: 3_000 });
  });
});
