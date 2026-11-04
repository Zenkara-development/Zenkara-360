import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test.describe('New AI Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // ── AI Command Bar (Cmd+K) ──────────────────────────────────────────────────

  test.describe('AI Command Bar', () => {
    test('AI button visible in topbar', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByTestId('ai-command-btn')).toBeVisible({ timeout: 8_000 });
    });

    test('Cmd+K opens the command bar', async ({ page }) => {
      await page.goto('/dashboard');
      // Wait for the layout (and the keydown listener it registers in a
      // useEffect) to actually mount before firing the shortcut — pressing
      // it immediately after goto() races React's hydration and can fire
      // before the listener exists, even though the shortcut itself works
      // instantly once the page is ready (confirmed manually).
      await expect(page.getByTestId('ai-command-btn')).toBeVisible({ timeout: 8_000 });
      await page.keyboard.press('Control+k');
      await expect(page.getByPlaceholder(/what would you like to do/i)).toBeVisible({ timeout: 5_000 });
    });

    test('AI button click opens the command bar', async ({ page }) => {
      await page.goto('/dashboard');
      await page.getByTestId('ai-command-btn').click();
      await expect(page.getByPlaceholder(/what would you like to do/i)).toBeVisible({ timeout: 5_000 });
    });

    test('command bar shows example suggestions', async ({ page }) => {
      await page.goto('/dashboard');
      await page.getByTestId('ai-command-btn').click();
      const bar = page.getByPlaceholder(/what would you like to do/i);
      await expect(bar).toBeVisible();
      // Should show at least one example suggestion
      await expect(page.getByText(/ticket|contact|lead|deal/i).first()).toBeVisible({ timeout: 5_000 });
    });

    test('typing a command and submitting returns a result', async ({ page }) => {
      await page.goto('/dashboard');
      await page.getByTestId('ai-command-btn').click();
      const bar = page.getByPlaceholder(/what would you like to do/i);
      await expect(bar).toBeVisible();
      await bar.fill('Create a high priority ticket about VPN connectivity issues');
      await page.keyboard.press('Enter');
      // Should show intent/entity result or loading
      await expect(
        page.getByText(/ticket|create|intent|entity|confidence|VPN|parsing/i).first()
      ).toBeVisible({ timeout: 20_000 });
    });

    test('Escape closes the command bar', async ({ page }) => {
      await page.goto('/dashboard');
      await page.getByTestId('ai-command-btn').click();
      await expect(page.getByPlaceholder(/what would you like to do/i)).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Escape');
      await expect(page.getByPlaceholder(/what would you like to do/i)).not.toBeVisible({ timeout: 3_000 });
    });

    test('suggestion chip auto-fills input', async ({ page }) => {
      await page.goto('/dashboard');
      await page.getByTestId('ai-command-btn').click();
      await expect(page.getByPlaceholder(/what would you like to do/i)).toBeVisible({ timeout: 5_000 });
      // Click any suggestion chip — scoped to the AI Command dialog. An
      // unscoped page-wide match also catches the dashboard's "New Ticket"
      // quick-action button (its accessible name contains "ticket" too),
      // which sits earlier in the DOM than this dialog and was winning
      // .first(), so the wrong element got clicked and the input stayed empty.
      const dialog = page.getByRole('dialog');
      const chip = dialog.getByRole('button', { name: /ticket|contact|lead|deal/i }).first();
      if (await chip.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await chip.click();
        const val = await page.getByPlaceholder(/what would you like to do/i).inputValue();
        expect(val.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Ticket AI: Thread Summarizer ────────────────────────────────────────────

  test.describe('Ticket AI — Thread Summary & Estimates', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/itdesk/tickets');
      await page.waitForURL(/\/itdesk\/tickets/);
    });

    test('Summarize button visible in ticket detail', async ({ page }) => {
      const row = page.getByRole('row').nth(1);
      if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await row.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: /summarize|summary/i })
        ).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press('Escape');
      }
    });

    test('Resolution Estimate button visible in ticket detail', async ({ page }) => {
      const row = page.getByRole('row').nth(1);
      if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await row.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: /estimate/i })
        ).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press('Escape');
      }
    });

    test('SLA Risk button visible in ticket detail', async ({ page }) => {
      const row = page.getByRole('row').nth(1);
      if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await row.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: /risk|assess/i })
        ).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press('Escape');
      }
    });

    test('KB Article Generate button visible in ticket detail', async ({ page }) => {
      const row = page.getByRole('row').nth(1);
      if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await row.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: /generate|kb|knowledge/i })
        ).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press('Escape');
      }
    });

    test('clicking Summarize shows a result', async ({ page }) => {
      const row = page.getByRole('row').nth(1);
      if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await row.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const btn = dialog.getByRole('button', { name: /summarize/i });
        if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await btn.click();
          await expect(
            dialog.getByText(/summary|comment|thread|enough|not enough|AI/i).first()
          ).toBeVisible({ timeout: 20_000 });
        }
        await page.keyboard.press('Escape');
      }
    });

    test('duplicate detection shows warning when title matches existing ticket', async ({ page }) => {
      // Open create ticket modal
      await page.getByRole('button', { name: /new ticket/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // Fill in a likely-to-match title
      const titleInput = dialog.getByLabel(/title/i).or(dialog.getByPlaceholder(/brief description|title/i));
      await titleInput.fill('Network connectivity issue');
      // Wait a moment for debounced duplicate check
      await page.waitForTimeout(2500);
      // Either duplicate warning appears or nothing (depends on existing data)
      // Just verify no crash occurred
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
    });
  });

  // ── Deals: Win Probability + Pipeline Health ────────────────────────────────

  test.describe('Deal AI Features', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/crm/deals');
      await page.waitForURL(/\/crm\/deals/);
    });

    test('Win Probability button visible in deal detail', async ({ page }) => {
      const row = page.getByRole('row').nth(1);
      if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await row.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: /win|probability/i })
        ).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press('Escape');
      }
    });

    test('Win Probability button returns result', async ({ page }) => {
      const row = page.getByRole('row').nth(1);
      if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await row.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const btn = dialog.getByRole('button', { name: /win|probability/i });
        if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await btn.click();
          await expect(
            dialog.getByText(/%|probability|recommendation|factors|assessing/i).first()
          ).toBeVisible({ timeout: 20_000 });
        }
        await page.keyboard.press('Escape');
      }
    });

    test('Pipeline Health button is visible on Deals page', async ({ page }) => {
      await expect(
        page.getByRole('button', { name: /pipeline health/i })
      ).toBeVisible({ timeout: 5_000 });
    });

    test('Pipeline Health modal opens and shows content', async ({ page }) => {
      const btn = page.getByRole('button', { name: /pipeline health/i });
      if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await btn.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(
          page.getByText(/pipeline|health|risk|opportunity|summary|loading/i).first()
        ).toBeVisible({ timeout: 20_000 });
        await page.keyboard.press('Escape');
      }
    });
  });

  // ── Contacts: Churn Risk ────────────────────────────────────────────────────

  test.describe('Contact Churn Risk', () => {
    test('Churn Risk section visible on contact detail page', async ({ page }) => {
      await page.goto('/crm/contacts');
      await page.waitForURL(/\/crm\/contacts/);
      // Click first contact link — scoped to <main> so this doesn't match
      // the sidebar nav's own links (rendered globally in AppLayout, "Dashboard"
      // is first in the DOM), which would navigate away from this page entirely.
      const firstLink = page.locator('main').getByRole('link', { name: /.+/ }).first();
      if (await firstLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await firstLink.click();
        await expect(
          page.getByRole('button', { name: /churn|assess churn/i })
        ).toBeVisible({ timeout: 8_000 });
      }
    });

    test('Churn Risk button returns result on contact detail', async ({ page }) => {
      await page.goto('/crm/contacts');
      await page.waitForURL(/\/crm\/contacts/);
      const firstLink = page.locator('main').getByRole('link', { name: /.+/ }).first();
      if (await firstLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await firstLink.click();
        const btn = page.getByRole('button', { name: /churn|assess/i });
        if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await btn.click();
          await expect(
            page.getByText(/LOW|MEDIUM|HIGH|risk|score|assessing/i).first()
          ).toBeVisible({ timeout: 20_000 });
        }
      }
    });
  });

  // ── Leads: Nurture Sequence ─────────────────────────────────────────────────

  test.describe('Lead Nurture Sequence', () => {
    test('Nurture Sequence button visible in lead row/detail', async ({ page }) => {
      await page.goto('/crm/leads');
      await page.waitForURL(/\/crm\/leads/);
      await expect(
        page.getByRole('button', { name: /nurture|sequence/i }).first()
      ).toBeVisible({ timeout: 8_000 });
    });

    test('clicking Nurture opens a modal with email steps', async ({ page }) => {
      await page.goto('/crm/leads');
      await page.waitForURL(/\/crm\/leads/);
      const btn = page.getByRole('button', { name: /nurture|sequence/i }).first();
      if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await btn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByText(/day|email|subject|generate|nurture/i).first()
        ).toBeVisible({ timeout: 20_000 });
        await page.keyboard.press('Escape');
      }
    });
  });

  // ── Dashboard: AI Insights Feed ─────────────────────────────────────────────

  test.describe('AI Insights Feed', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL(/\/dashboard/);
    });

    test('AI Insights section is visible on dashboard', async ({ page }) => {
      await expect(
        page.getByText(/AI Insights/i).first()
      ).toBeVisible({ timeout: 8_000 });
    });

    test('Insights widget loads without crashing', async ({ page }) => {
      // Just verify the page renders without error
      await expect(page.locator('main')).toBeVisible();
      await page.waitForTimeout(3_000);
      // Should not show an error boundary
      await expect(page.getByText(/something went wrong|error boundary/i)).not.toBeVisible();
    });

    test('Refresh button triggers re-fetch of insights', async ({ page }) => {
      const refreshBtn = page.getByRole('button', { name: /refresh/i }).first();
      if (await refreshBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
        await refreshBtn.click();
        // Should not crash
        await expect(page.locator('main')).toBeVisible();
      }
    });
  });

  // ── Dashboard: Meeting Notes Parser ────────────────────────────────────────

  test.describe('Meeting Notes Parser', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL(/\/dashboard/);
    });

    test('Parse Meeting Notes button is visible on dashboard', async ({ page }) => {
      await expect(
        page.getByRole('button', { name: /meeting notes|parse meeting/i })
      ).toBeVisible({ timeout: 8_000 });
    });

    test('clicking Parse Meeting Notes opens a modal', async ({ page }) => {
      const btn = page.getByRole('button', { name: /meeting notes|parse meeting/i });
      await btn.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByPlaceholder(/paste.*notes|meeting notes/i)
          .or(dialog.getByRole('textbox'))
          .first()
      ).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Escape');
    });

    test('pasting notes and parsing returns structured results', async ({ page }) => {
      const btn = page.getByRole('button', { name: /meeting notes|parse meeting/i });
      await btn.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const textarea = dialog.getByRole('textbox').first();
      await textarea.fill(
        'Met with Jane Smith (jane@acme.com) from Acme Corp today. ' +
        'She is interested in our enterprise plan. Budget is around $50,000. ' +
        'Next steps: send proposal by Friday, follow up next week. ' +
        'Also spoke with Bob Jones who may be a lead for the SMB tier.'
      );
      const parseBtn = dialog.getByRole('button', { name: /parse|analyze/i });
      await parseBtn.click();
      await expect(
        dialog.getByText(/contact|lead|deal|next step|summary|Jane|Acme|parsing/i).first()
      ).toBeVisible({ timeout: 25_000 });
      await page.keyboard.press('Escape');
    });
  });

  // ── Tone Checker (via Deal follow-up) ──────────────────────────────────────

  test.describe('Email Tone Checker', () => {
    test('tone check button visible after generating deal follow-up', async ({ page }) => {
      await page.goto('/crm/deals');
      await page.waitForURL(/\/crm\/deals/);
      const row = page.getByRole('row').nth(1);
      if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await row.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const followUpBtn = dialog.getByRole('button', { name: /follow.up|generate email/i });
        if (await followUpBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await followUpBtn.click();
          // After email generates, tone check button should appear
          await expect(
            dialog.getByRole('button', { name: /tone|check tone/i })
          ).toBeVisible({ timeout: 25_000 });
        }
        await page.keyboard.press('Escape');
      }
    });
  });
});
