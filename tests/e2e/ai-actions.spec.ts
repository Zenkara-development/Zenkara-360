import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

/**
 * Tests the "AI Command" whitelisted action registry — propose an action from
 * a natural-language command, then confirm/cancel before it actually runs.
 * Basic open/close/suggestions coverage for the command bar itself already
 * lives in ai-features-new.spec.ts; this file is scoped to the net-new
 * propose -> confirm -> execute flow (POST /ai/actions/plan + /execute).
 *
 * Like the rest of ai-features*.spec.ts, these hit a real external AI API
 * (Groq/OpenAI) via the app's own endpoints, so assertions stay permissive:
 * an unconfigured or uncertain AI response is a valid, non-crashing outcome
 * (the app degrades gracefully to the legacy "couldn't understand" branch),
 * not a test failure.
 */
test.describe('AI Command — whitelisted actions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await page.waitForURL(/\/dashboard/);
  });

  test('a note-adding command either proposes a confirmable action or degrades gracefully', async ({ page }) => {
    await page.getByTestId('ai-command-btn').click();
    const dialog = page.getByRole('dialog');
    const bar = page.getByPlaceholder(/what would you like to do/i);
    await expect(bar).toBeVisible({ timeout: 5_000 });

    // Targets the ADD_NOTE registry action against a fixture that's already
    // been created by deals.spec.ts elsewhere in the suite.
    await bar.fill(`Add a note on the ${TEST.deal.title} deal saying: automated e2e follow-up`);
    await page.keyboard.press('Enter');

    // Several valid outcomes exist here, by design: a confirmable action
    // proposal (the new registry path), the permission-denied variant of
    // that proposal, the legacy "couldn't understand" fallback — or the
    // *legacy create/update parser winning outright*, since "deal" +
    // "notes"-shaped language is exactly what that 5-entity parser is also
    // primed to recognize, and it intentionally takes precedence when
    // confident (see AiCommandBar's runCommand). All of these render a
    // "NN% confidence" chip unconditionally, so that's the one signal
    // common to every valid outcome — asserting on it instead of the
    // specific action-card copy avoids coupling the test to which parser
    // the model happens to prefer for this exact phrasing.
    await expect(dialog.getByText(/% confidence/i).first()).toBeVisible({ timeout: 30_000 });

    const confirmBtn = dialog.getByRole('button', { name: /confirm & run/i });
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
      // Either a success summary or a surfaced error — never a silent no-op.
      await expect(
        dialog.getByText(/added a note on|couldn't run that action/i).first()
      ).toBeVisible({ timeout: 15_000 });
    }
    await page.keyboard.press('Escape');
  });

  test('cancelling a proposed action does not execute it', async ({ page }) => {
    await page.getByTestId('ai-command-btn').click();
    const dialog = page.getByRole('dialog');
    const bar = page.getByPlaceholder(/what would you like to do/i);
    await expect(bar).toBeVisible({ timeout: 5_000 });

    await bar.fill(`Add a note on the ${TEST.deal.title} deal saying: should never be saved`);
    await page.keyboard.press('Enter');

    const cancelBtn = dialog.getByRole('button', { name: /^cancel$/i });
    if (await cancelBtn.isVisible({ timeout: 30_000 }).catch(() => false)) {
      await cancelBtn.click();
      // Back to the idle/suggestions state — no confirm card, no success banner.
      await expect(dialog.getByText(/added a note on/i)).not.toBeVisible();
    }
    await page.keyboard.press('Escape');
  });
});
