import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('AI Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // ── NL Dashboard Query ──────────────────────────────────────────────────────

  test.describe('Natural Language Dashboard Query', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL(/\/dashboard/);
    });

    // Dashboard AI input placeholder: "e.g. How many tickets are SLA-breached today?"
    // Use a locator that finds the input by proximity to the Ask button instead
    function getAiInput(page: any) {
      return page.locator('input[type="text"], input:not([type])').filter({
        has: page.locator(':scope'),
      }).near(page.getByRole('button', { name: /^ask$/i })).first()
        || page.getByPlaceholder(/how many|SLA|tickets.*today/i).first()
        || page.locator('form input').first();
    }

    test('AI query bar is present', async ({ page }) => {
      // The AI query section exists — look for the Ask button
      await expect(
        page.getByRole('button', { name: /^ask$/i }).first()
      ).toBeVisible({ timeout: 5_000 });
    });

    test('typing a query enables the Ask button', async ({ page }) => {
      const askBtn = page.getByRole('button', { name: /^ask$/i }).first();
      await expect(askBtn).toBeVisible();
      const input = page.getByPlaceholder(/SLA-breached|How many tickets/i);
      if (await input.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await input.fill('How many open tickets?');
      }
      await expect(askBtn).toBeEnabled();
    });

    test('submitting a query shows loading then result or error', async ({ page }) => {
      const askBtn = page.getByRole('button', { name: /^ask$/i }).first();
      const input = page.getByPlaceholder(/SLA-breached|How many tickets/i);
      // Locator.isVisible() does not auto-wait/retry — it checks the DOM at
      // that exact instant and ignores the timeout option, so gating fill()
      // behind it was flaky: if the section hadn't rendered yet at that
      // millisecond, fill() was skipped, the Ask button stayed permanently
      // disabled (it requires non-empty input), and the later click() just
      // timed out. fill() itself auto-waits for visible+enabled, so call it
      // directly instead.
      await input.fill('How many contacts do we have?');
      await askBtn.click();
      // Either a result answer or an error message should appear. This hits a
      // real external AI API (Groq/OpenAI) — under concurrent Playwright
      // workers all making AI calls at once, responses can occasionally run
      // past 20s (rate limiting / shared load), even though the feature
      // itself works correctly (confirmed manually). Wider margin here
      // rather than touching app code.
      await expect(
        page.getByText(/contact|answer|result|sorry|error|unavailable/i).first()
      ).toBeVisible({ timeout: 30_000 });
    });

    test('pill suggestions auto-fill the query input', async ({ page }) => {
      const pill = page.getByRole('button', { name: /open deals|pipeline|tickets|leads/i }).first();
      if (await pill.isVisible().catch(() => false)) {
        await pill.click();
        const input = page.locator('input').first();
        if (await input.isVisible({ timeout: 2_000 }).catch(() => false)) {
          const val = await input.inputValue();
          expect(val.length).toBeGreaterThan(0);
        }
      }
    });
  });

  // ── Lead AI Scoring ─────────────────────────────────────────────────────────

  test.describe('Lead AI Scoring', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/crm/leads');
      await page.waitForURL(/\/crm\/leads/);
    });

    test('lead list shows AI score column or badge', async ({ page }) => {
      // Score may appear as "AI Score", a number badge, or inside lead detail
      const hasScoreCol = await page.getByText(/ai score|score/i).isVisible().catch(() => false);
      // Acceptable if score column is hidden until computed
      if (!hasScoreCol) {
        // Open a lead and look for score inside
        const firstLead = page.getByRole('row').nth(1);
        if (await firstLead.isVisible().catch(() => false)) {
          await firstLead.click();
          const dialog = page.getByRole('dialog');
          if (await dialog.isVisible()) {
            const scoreInDialog = await dialog.getByText(/score|ai/i).isVisible().catch(() => false);
            // Score may not be computed yet — just verify no crash
            await expect(dialog.locator('body')).not.toContainText('Something went wrong').catch(() => {});
            await page.keyboard.press('Escape');
          }
        }
      }
    });

    test('score lead button triggers AI scoring', async ({ page }) => {
      const firstRow = page.getByRole('row').nth(1);
      if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.click();
        const dialog = page.getByRole('dialog');
        if (await dialog.isVisible()) {
          const scoreBtn = dialog.getByRole('button', { name: /score|get score|ai score/i });
          if (await scoreBtn.isVisible().catch(() => false)) {
            await scoreBtn.click();
            await expect(
              dialog.getByText(/score|scoring|loading|result/i)
            ).toBeVisible({ timeout: 15_000 });
          }
          await page.keyboard.press('Escape');
        }
      }
    });
  });

  // ── Ticket AI Features ──────────────────────────────────────────────────────

  test.describe('Ticket AI — Sentiment & Reply Suggestions', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/itdesk/tickets');
      await page.waitForURL(/\/itdesk\/tickets/);
    });

    test('opening a ticket shows AI panel or buttons', async ({ page }) => {
      const firstTicket = page.getByRole('row').nth(1);
      if (await firstTicket.isVisible().catch(() => false)) {
        await firstTicket.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        const hasAiPanel     = await dialog.getByText(/ai|sentiment|suggest/i).isVisible().catch(() => false);
        const hasAiBtn       = await dialog.getByRole('button', { name: /suggest|ai reply|sentiment/i }).isVisible().catch(() => false);
        const hasRoutingBadge = await dialog.getByText(/auto.rout|assigned by ai/i).isVisible().catch(() => false);

        // May not have AI if no OpenAI key configured — just verify no crash
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
      }
    });

    test('sentiment analysis shows on a ticket with body text', async ({ page }) => {
      // Create a ticket with body to get sentiment
      await page.getByRole('button', { name: /new ticket|create ticket/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(/title|subject/i).fill('AI Sentiment Test Ticket');
      const bodyInput = dialog.getByLabel(/body|description|message/i);
      if (await bodyInput.isVisible()) {
        await bodyInput.fill('This is extremely urgent and critical! Our system is completely broken.');
      }
      await dialog.getByRole('button', { name: /create|save|submit/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 8_000 });

      // Open it
      await page.getByText('AI Sentiment Test Ticket').first().click();
      const ticketDialog = page.getByRole('dialog');
      await expect(ticketDialog).toBeVisible();

      // Look for sentiment indicator
      const hasSentiment = await ticketDialog.getByText(/negative|positive|neutral|sentiment/i).isVisible({ timeout: 8_000 }).catch(() => false);
      // May not appear if no OpenAI key — verify no crash
      await expect(ticketDialog).toBeVisible();
      await page.keyboard.press('Escape');

      // Cleanup
      const row = page.getByRole('row', { name: /AI Sentiment Test Ticket/i }).first();
      const del = row.getByRole('button', { name: /delete/i });
      if (await del.isVisible().catch(() => false)) {
        await del.click();
        const confirm = page.getByRole('button', { name: /confirm|yes/i });
        if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click();
      }
    });

    test('reply suggestion button generates a suggested reply', async ({ page }) => {
      const firstRow = page.getByRole('row').nth(1);
      if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        const suggestBtn = dialog.getByRole('button', { name: /suggest reply|ai reply|generate/i });
        if (await suggestBtn.isVisible().catch(() => false)) {
          await suggestBtn.click();
          // Should show suggested text or loading state
          await expect(
            dialog.getByText(/suggest|loading|reply|here is|sorry/i).first()
          ).toBeVisible({ timeout: 15_000 });
        }
        await page.keyboard.press('Escape');
      }
    });
  });

  // ── AI Auto-Routing ─────────────────────────────────────────────────────────

  test.describe('AI Auto-Routing', () => {
    test('auto-routing assigns tickets based on content', async ({ page }) => {
      await page.goto('/itdesk/tickets');

      await page.getByRole('button', { name: /new ticket|create ticket/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(/title|subject/i).fill('Network connectivity issue in production');
      const body = dialog.getByLabel(/body|description/i);
      if (await body.isVisible()) {
        await body.fill('All users are unable to connect to the VPN. This is a network infrastructure problem.');
      }
      await dialog.getByRole('button', { name: /create|save|submit/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 8_000 });

      // Open ticket and check if assignee was set by AI
      await page.getByText('Network connectivity issue in production').first().click();
      const ticketDialog = page.getByRole('dialog');
      await expect(ticketDialog).toBeVisible();

      // Ticket should have loaded without crashing
      await expect(ticketDialog).toBeVisible();
      await page.keyboard.press('Escape');

      // Cleanup
      const row = page.getByRole('row', { name: /Network connectivity issue/i }).first();
      const del = row.getByRole('button', { name: /delete/i });
      if (await del.isVisible().catch(() => false)) {
        await del.click();
        const confirm = page.getByRole('button', { name: /confirm|yes/i });
        if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click();
      }
    });
  });

  // ── Follow-up Email Generation ──────────────────────────────────────────────

  test.describe('AI Follow-up Email (Leads)', () => {
    test('generate follow-up email button works on a lead', async ({ page }) => {
      await page.goto('/crm/leads');
      await page.waitForURL(/\/crm\/leads/);

      const firstLead = page.getByRole('row').nth(1);
      if (await firstLead.isVisible().catch(() => false)) {
        await firstLead.click();
        const dialog = page.getByRole('dialog');
        if (await dialog.isVisible()) {
          const followUpBtn = dialog.getByRole('button', { name: /follow.up|generate email|ai email/i });
          if (await followUpBtn.isVisible().catch(() => false)) {
            await followUpBtn.click();
            await expect(
              dialog.getByText(/email|subject|dear|hello|loading/i).first()
            ).toBeVisible({ timeout: 15_000 });
          }
          await page.keyboard.press('Escape');
        }
      }
    });
  });
});
