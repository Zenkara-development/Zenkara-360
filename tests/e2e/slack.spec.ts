import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

const SLACK_WEBHOOK = 'https://hooks.slack.com/services/E2E/TEST/playwright123';

test.describe('Slack Integration', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/slack');
    await page.waitForURL(/\/slack/);
  });

  // Verifies the Slack integration page loads with heading
  test('slack integration page loads', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /slack/i })
    ).toBeVisible();
  });

  // Verifies the webhook URL input is visible
  test('webhook URL input is visible', async ({ page }) => {
    const webhookInput = page.getByLabel(/webhook url/i);
    await expect(webhookInput).toBeVisible();
  });

  // Verifies toggling notification types works
  // SlackPage uses sr-only checkboxes inside <label> elements — click the label, not the input
  test('toggle notification type checkboxes', async ({ page }) => {
    // Wait for the notification section to be rendered
    await page.waitForSelector('input[type="checkbox"]', { timeout: 8_000 });
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);

    // Click the <label> wrapper since the inputs are sr-only (off-screen)
    const firstLabel = page.locator('label').filter({ has: page.locator('input[type="checkbox"]') }).first();
    const firstCheckbox = checkboxes.first();
    const wasChecked = await firstCheckbox.isChecked();
    await firstLabel.click();
    await expect(firstCheckbox).toBeChecked({ checked: !wasChecked });
  });

  // Verifies saving configuration shows success feedback
  test('saves slack configuration with success feedback', async ({ page }) => {
    const webhookInput = page.getByLabel(/webhook url/i);
    await webhookInput.fill(SLACK_WEBHOOK);

    // Button text: "Connect Slack" (not connected) or "Update Configuration" (connected).
    // Matched as a whole string (not a substring) so this doesn't also match the
    // "Disconnect" button shown alongside it once already connected — "Disconnect"
    // contains "connect" as a substring, causing a strict-mode violation (2 elements
    // matched) whenever a prior run had already saved a webhook.
    await page.getByRole('button', { name: /^(connect slack|update configuration)$/i }).click();

    await expect(
      page.getByText(/saved|updated|success/i)
    ).toBeVisible({ timeout: 8_000 });
  });
});
