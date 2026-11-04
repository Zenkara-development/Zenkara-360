import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Deals / Pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Pipeline' }).click();
    await page.waitForURL(/\/crm\/deals/);
  });

  test('shows kanban board with stage columns', async ({ page }) => {
    await expect(page.getByText('Prospecting')).toBeVisible();
    await expect(page.getByText('Proposal')).toBeVisible();
    await expect(page.getByText('Negotiation')).toBeVisible();
  });

  test('creates a new deal', async ({ page }) => {
    await page.getByRole('button', { name: /new deal/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/deal title/i).fill(TEST.deal.title);
    await page.getByLabel(/value/i).fill(TEST.deal.value);
    await page.getByRole('button', { name: /create deal/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText(TEST.deal.title).first()).toBeVisible();
  });

  test('deal card shows value', async ({ page }) => {
    await expect(page.getByText(TEST.deal.title).first()).toBeVisible();
    await expect(page.getByText('5,000').first()).toBeVisible();
  });

  test('opens deal detail modal with comments', async ({ page }) => {
    await page.getByText(TEST.deal.title).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/comments/i)).toBeVisible();
  });

  test('adds a comment to a deal', async ({ page }) => {
    await page.getByText(TEST.deal.title).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByPlaceholder(/add a comment/i).fill('Playwright test comment on deal');
    await page.getByRole('button').filter({ has: page.locator('svg') }).last().click(); // send button

    await expect(page.getByText('Playwright test comment on deal')).toBeVisible({ timeout: 8_000 });
  });

  test('switches to Reports tab and shows funnel', async ({ page }) => {
    await page.getByRole('button', { name: /reports/i }).click();
    await expect(page.getByText('Pipeline Funnel')).toBeVisible();
    await expect(page.getByText('Weighted Forecast')).toBeVisible();
  });

  test('deletes a deal', async ({ page }) => {
    // Create a deal to delete
    await page.getByRole('button', { name: /new deal/i }).click();
    await page.getByLabel(/deal title/i).fill('Delete Me Deal');
    await page.getByLabel(/value/i).fill('100');
    await page.getByRole('button', { name: /create deal/i }).click();
    await expect(page.getByText('Delete Me Deal')).toBeVisible();

    // Hover over the card to reveal trash icon
    const card = page.getByText('Delete Me Deal').locator('..').locator('..');
    await card.hover();
    await card.getByRole('button').click();

    await expect(page.getByText('Delete Me Deal')).not.toBeVisible({ timeout: 5_000 });
  });
});
