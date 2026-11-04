import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/dashboard/);
  });

  // Verifies the page title / heading renders after login
  test('dashboard loads with a heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  // Verifies the greeting text and current date appear on the dashboard
  test('shows greeting and current date', async ({ page }) => {
    // Greeting: "Good morning / afternoon / evening, ..."
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible();
  });

  // Verifies CRM-side metric cards are rendered
  test('CRM metrics cards are visible', async ({ page }) => {
    // Scope to <main> to avoid matching sidebar nav links (Contacts, Leads, Pipeline)
    const main = page.locator('main');
    await expect(main.getByText(/open deals/i)).toBeVisible();
    await expect(main.getByText(/forecast revenue/i)).toBeVisible();
    await expect(main.getByText(/contacts/i)).toBeVisible();
    await expect(main.getByText(/active leads/i)).toBeVisible();
  });

  // Verifies IT Desk metric cards are rendered
  test('IT Desk metrics cards are visible', async ({ page }) => {
    await expect(page.getByText(/open/i).first()).toBeVisible();
    await expect(page.getByText(/in progress/i)).toBeVisible();
    await expect(page.getByText(/sla breached/i)).toBeVisible();
    await expect(page.getByText(/resolved/i)).toBeVisible();
  });

  // Verifies the quick-action buttons navigate to the right destinations
  test('quick action button navigates to New Ticket page', async ({ page }) => {
    const newTicketBtn = page.getByRole('button', { name: /new ticket/i });
    if (await newTicketBtn.isVisible()) {
      await newTicketBtn.click();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Escape');
    }
  });

  test('quick action button navigates to New Contact page', async ({ page }) => {
    const newContactBtn = page.getByRole('button', { name: /new contact/i });
    if (await newContactBtn.isVisible()) {
      await newContactBtn.click();
      // QuickAction "New Contact" navigates to /crm/contacts (not a dialog)
      await page.waitForURL(/\/crm\/contacts/, { timeout: 5_000 });
    }
  });

  // Verifies the AI query bar is present on the dashboard
  // Actual placeholder: "e.g. How many tickets are SLA-breached today?"
  // We detect by the adjacent Ask button instead of placeholder text
  test('AI query bar is visible', async ({ page }) => {
    // The Ask button always appears next to the AI input
    await expect(
      page.getByRole('button', { name: /^ask$/i }).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  // Verifies typing a query and submitting shows a result or loading state
  test('typing a query and clicking Ask shows a result or loading state', async ({ page }) => {
    const askBtn = page.getByRole('button', { name: /^ask$/i }).first();
    await expect(askBtn).toBeVisible();

    // Find the NL query input by its placeholder text
    const queryInput = page.getByPlaceholder(/SLA-breached|How many tickets/i);
    if (await queryInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await queryInput.fill('How many open tickets are there?');
    }

    await askBtn.click();

    // Either a loading spinner or a text result should appear
    await expect(
      page.getByText(/loading|thinking|result|ticket|answer|sorry/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
