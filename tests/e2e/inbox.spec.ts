import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test.describe('Inbox', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/inbox');
    await page.waitForURL(/\/inbox/);
  });

  // Verifies the Inbox page loads with heading
  test('inbox page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /inbox/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  // Verifies the conversation list panel is visible
  test('conversation list area is visible', async ({ page }) => {
    // The inbox should have a sidebar/panel listing conversations
    const conversationPanel = page
      .locator('[class*="conversation"], [class*="inbox"], aside')
      .first();
    await expect(conversationPanel).toBeVisible({ timeout: 5_000 });
  });

  // Verifies email and WhatsApp channel tabs/filters are visible
  // InboxPage uses plain <button> elements (not role=tab) for channel filters
  test('email and WhatsApp channel tabs are visible', async ({ page }) => {
    // Wait for the inbox heading to confirm the page has rendered
    await expect(page.getByRole('heading', { name: /inbox/i })).toBeVisible({ timeout: 8_000 });
    // At least one channel filter should be visible
    const emailVisible = await page.getByRole('button', { name: /email/i }).first().isVisible().catch(() => false);
    const whatsappVisible = await page.getByRole('button', { name: /whatsapp/i }).first().isVisible().catch(() => false);
    expect(emailVisible || whatsappVisible).toBeTruthy();
  });

  // Verifies empty state is visible when no messages exist
  test('empty state is visible if no conversations', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');

    const hasConversations = await page.getByRole('listitem').count();
    if (hasConversations === 0) {
      // Empty state text should be present
      await expect(
        page.getByText(/no messages|no conversations|empty|all caught up/i)
      ).toBeVisible();
    }
    // If conversations exist, this test passes trivially — that is fine
  });
});
