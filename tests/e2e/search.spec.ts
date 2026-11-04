import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * The app has two search/command entry points:
 *   1. AI Command Bar (modal) — opened by Ctrl+K or the "AI" button in the topbar
 *      placeholder: "Search or ask AI — what would you like to do?..."
 *   2. AISmartSearch — inline topbar input (placeholder: "Find contacts, tickets, deals…")
 *
 * Ctrl+K is handled by AppLayout → sets aiBarOpen=true → shows AiCommandBar.
 * AiCommandBar does NOT show contacts/deals/tickets result sections from keyword input;
 * it shows "Try asking" NL suggestions and routes AI commands.
 */
test.describe('AI Command Bar (Ctrl+K modal)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/dashboard/);
  });

  // Ctrl+K opens the AI command modal
  test('Ctrl+K opens the AI command modal', async ({ page }) => {
    // Click body to ensure page content has keyboard focus
    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    await expect(page.getByPlaceholder(/search or ask/i)).toBeVisible({ timeout: 5_000 });
  });

  // The "AI" button in the topbar also opens the modal
  test('AI button in topbar opens command modal', async ({ page }) => {
    await page.click('[data-testid="ai-command-btn"]');
    await expect(page.getByPlaceholder(/search or ask/i)).toBeVisible({ timeout: 5_000 });
  });

  // Modal shows "Try asking" example suggestions when first opened
  test('AI command modal shows Try Asking suggestions', async ({ page }) => {
    await page.click('[data-testid="ai-command-btn"]');
    const input = page.getByPlaceholder(/search or ask/i);
    await expect(input).toBeVisible();
    // Suggestions section appears before any input is entered
    await expect(page.getByText(/try asking/i)).toBeVisible({ timeout: 5_000 });
  });

  // Modal input accepts typed text
  test('typing in AI modal accepts input without error', async ({ page }) => {
    await page.click('[data-testid="ai-command-btn"]');
    const input = page.getByPlaceholder(/search or ask/i);
    await expect(input).toBeVisible();
    await input.fill('Create a ticket about VPN issues');
    await expect(input).toHaveValue('Create a ticket about VPN issues');
    // "Ask AI" button should become enabled (text length >= 3)
    await expect(page.getByRole('button', { name: /ask ai/i })).not.toBeDisabled();
  });

  // Escape closes the modal
  test('Escape closes the AI command modal', async ({ page }) => {
    await page.click('[data-testid="ai-command-btn"]');
    const input = page.getByPlaceholder(/search or ask/i);
    await expect(input).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(input).not.toBeVisible({ timeout: 3_000 });
  });

  // Clicking the backdrop closes the modal
  test('clicking backdrop closes the AI command modal', async ({ page }) => {
    await page.click('[data-testid="ai-command-btn"]');
    const input = page.getByPlaceholder(/search or ask/i);
    await expect(input).toBeVisible();
    // The modal backdrop is the fixed inset-0 div; click its top-left corner (outside the modal box)
    await page.locator('div.fixed.inset-0.z-50').click({ position: { x: 5, y: 5 }, force: true });
    await expect(input).not.toBeVisible({ timeout: 3_000 });
  });
});
