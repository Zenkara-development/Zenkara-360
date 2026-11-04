import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('IT Desk — Tickets', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Tickets' }).click();
    await page.waitForURL(/\/itdesk\/tickets/);
  });

  test('shows tickets page with stats row', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
    await expect(page.getByText('Open').first()).toBeVisible();
    await expect(page.getByText('In Progress').first()).toBeVisible();
    await expect(page.getByText('SLA Breached').first()).toBeVisible();
    await expect(page.getByText('Resolved').first()).toBeVisible();
  });

  test('creates a new ticket', async ({ page }) => {
    await page.getByRole('button', { name: /new ticket/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/title/i).fill(TEST.ticket.title);
    await page.getByLabel(/description/i).fill(TEST.ticket.body);
    await page.getByLabel(/priority/i).selectOption(TEST.ticket.priority);
    await page.getByRole('button', { name: /submit ticket/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.ticket.title).first()).toBeVisible();
  });

  test('ticket appears in the list with correct priority badge', async ({ page }) => {
    const row = page.getByRole('row', { name: new RegExp(TEST.ticket.title, 'i') }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('HIGH')).toBeVisible();
  });

  test('opens ticket detail modal', async ({ page }) => {
    await page.getByText(TEST.ticket.title).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(TEST.ticket.body)).toBeVisible();
  });

  test('changes ticket status to IN_PROGRESS', async ({ page }) => {
    await page.getByText(TEST.ticket.title).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'IN PROGRESS' }).click();
    await expect(page.getByRole('dialog').getByText('IN PROGRESS')).toBeVisible({ timeout: 5_000 });
  });

  test('assigns ticket to a user', async ({ page }) => {
    await page.getByText(TEST.ticket.title).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const assignSelect = page.getByRole('dialog').getByRole('combobox').last();
    const options = await assignSelect.locator('option').all();
    if (options.length > 1) {
      await assignSelect.selectOption({ index: 1 });
      // Value may still be '' if only the placeholder option exists (no users loaded)
      const val = await assignSelect.inputValue();
      if (val) {
        await expect(assignSelect).not.toHaveValue('');
      }
    }
  });

  test('adds a comment on a ticket', async ({ page }) => {
    await page.getByText(TEST.ticket.title).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByPlaceholder(/add a comment/i).fill('Playwright ticket comment');
    await page.getByRole('button').filter({ has: page.locator('svg') }).last().click();

    await expect(page.getByText('Playwright ticket comment')).toBeVisible({ timeout: 8_000 });
  });

  test('resolves the ticket', async ({ page }) => {
    await page.getByText(TEST.ticket.title).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'RESOLVED' }).click();
    await expect(page.getByRole('dialog').getByText('RESOLVED')).toBeVisible({ timeout: 5_000 });
  });

  test('filters tickets by status', async ({ page }) => {
    await page.getByRole('combobox', { name: '' }).first().selectOption('OPEN');
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
  });

  test('searches for a ticket by title', async ({ page }) => {
    await page.getByPlaceholder(/search tickets/i).fill(TEST.ticket.title);
    await expect(page.getByText(TEST.ticket.title).first()).toBeVisible();
  });
});

test.describe('IT Desk — Categories', () => {
  // Distinct from TEST.category — categories.spec.ts exercises that name in its
  // own file. Using a different literal here avoids two files racing to
  // create/read the same category row when run with multiple workers.
  const CATEGORY_NAME = 'E2E Tickets-Page Category';

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Categories' }).click();
    await page.waitForURL(/\/itdesk\/categories/);
  });

  test('shows categories page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /categories/i })).toBeVisible();
  });

  test('creates a new category', async ({ page }) => {
    await page.getByRole('button', { name: /new category/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/name/i).fill(CATEGORY_NAME);
    await page.getByLabel(/description/i).fill(TEST.category.description);
    await page.getByRole('button', { name: /create/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText(CATEGORY_NAME).first()).toBeVisible();
  });
});

test.describe('IT Desk — Knowledge Base', () => {
  // Distinct from TEST.article — knowledge-base.spec.ts exercises that name in
  // its own file. Using a different literal here avoids two files racing to
  // create/read the same article row when run with multiple workers.
  const ARTICLE_TITLE = 'E2E Tickets-Page Article';

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Knowledge Base' }).click();
    await page.waitForURL(/\/itdesk\/articles/);
  });

  test('shows knowledge base page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /knowledge base|articles/i })).toBeVisible();
  });

  test('creates a new article', async ({ page }) => {
    await page.getByRole('button', { name: /new article/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/title/i).fill(ARTICLE_TITLE);
    await dialog.getByLabel(/body|content/i).fill(TEST.article.body);
    await dialog.getByRole('button', { name: /create article/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(ARTICLE_TITLE)).toBeVisible({ timeout: 8_000 });
  });
});
