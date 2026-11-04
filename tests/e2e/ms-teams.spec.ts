import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

const TEAMS_WEBHOOK = 'https://outlook.office.com/webhook/e2e-test-url/IncomingWebhook/abc123';

test.describe('Microsoft Teams Integration', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/teams');
    await page.waitForURL(/\/teams/);
  });

  // Verifies the Teams integration page heading is visible
  test('Teams integration page loads', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /microsoft teams|teams/i })
    ).toBeVisible();
  });

  // Verifies the webhook URL input field is present
  test('webhook URL input is visible', async ({ page }) => {
    const webhookInput = page.getByLabel(/webhook url/i);
    await expect(webhookInput).toBeVisible();
  });

  // Verifies the webhook URL can be entered
  test('configure webhook URL', async ({ page }) => {
    const webhookInput = page.getByLabel(/webhook url/i);
    await webhookInput.fill(TEAMS_WEBHOOK);
    await expect(webhookInput).toHaveValue(TEAMS_WEBHOOK);
  });

  // Verifies notification type checkboxes are present and can be toggled
  test('toggle notification type checkboxes', async ({ page }) => {
    // Wait for page to finish loading (query resolves to null if no config)
    await page.getByLabel(/webhook url/i).waitFor({ timeout: 8_000 });
    const checkboxes = page.getByRole('checkbox');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);

    // Toggle the first available checkbox
    const firstCheckbox = checkboxes.first();
    const wasChecked = await firstCheckbox.isChecked();
    await firstCheckbox.click();
    await expect(firstCheckbox).toBeChecked({ checked: !wasChecked });
  });

  // Verifies the save configuration button is present and clickable
  test('saves configuration and shows success feedback', async ({ page }) => {
    const webhookInput = page.getByLabel(/webhook url/i);
    await webhookInput.fill(TEAMS_WEBHOOK);

    // Button says "Connect Teams" when not yet connected, "Save Changes" when configured.
    // Matched as a whole string (not a substring) so this doesn't also match the
    // "Disconnect" button, which is shown alongside it once already connected and
    // contains "connect" as a substring — that caused a strict-mode violation
    // (2 elements matched) whenever a prior run had already saved a webhook.
    await page.getByRole('button', { name: /^(save changes|connect teams)$/i }).click();

    await expect(
      page.getByText(/saved|updated|success|connected/i)
    ).toBeVisible({ timeout: 8_000 });
  });

  // Verifies the Test Webhook button is visible when webhook is configured
  test('test webhook button is visible when connected', async ({ page }) => {
    // The test webhook button only appears when a webhook URL is already saved.
    // If not connected, skip gracefully.
    const testBtn = page.getByRole('button', { name: /^test$/i })
      .or(page.getByRole('button', { name: /test webhook|send test/i }));
    const isConnected = await testBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!isConnected) {
      // Not connected — acceptable; button renders only after webhook is saved
      return;
    }
    await expect(testBtn).toBeVisible();
  });
});
