import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Knowledge Base', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/itdesk/articles');
    await page.waitForURL(/\/itdesk\/articles/);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  });

  test('knowledge base page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /knowledge base|articles/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  test('shows empty state or article list', async ({ page }) => {
    // Page is already settled via beforeEach networkidle wait
    const hasEmpty = await page.getByText(/no articles|empty|create your first/i).isVisible().catch(() => false);
    const hasCards = await page.locator('[data-testid="article-card"]').first().isVisible().catch(() => false);
    const hasTable = await page.getByRole('table').isVisible().catch(() => false);
    expect(hasEmpty || hasCards || hasTable).toBeTruthy();
  });

  test('creates a new article', async ({ page }) => {
    await page.getByRole('button', { name: /new article|create article|add article/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/title/i).fill(TEST.article.title);
    await dialog.getByLabel(/body/i).fill(TEST.article.body);

    await dialog.getByRole('button', { name: /create article/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.article.title)).toBeVisible({ timeout: 8_000 });
  });

  test('created article appears in list', async ({ page }) => {
    await expect(page.getByText(TEST.article.title)).toBeVisible({ timeout: 5_000 });
  });

  test('edits an article title', async ({ page }) => {
    // Articles use card layout with opacity-0 hover buttons
    const card = page.locator('[data-testid="article-card"]').filter({
      hasText: TEST.article.title,
    }).first();
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /edit article/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const titleInput = dialog.getByLabel(/title/i);
    await titleInput.fill(TEST.article.title + ' Updated');
    await dialog.getByRole('button', { name: /save changes/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.article.title + ' Updated')).toBeVisible({ timeout: 5_000 });
  });

  test('searches for an article', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search articles/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill(TEST.article.title);
      await expect(
        page.getByText(new RegExp(TEST.article.title, 'i'))
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test('deletes an article', async ({ page }) => {
    const title = TEST.article.title + ' Updated';
    const card = page.locator('[data-testid="article-card"]').filter({
      hasText: title,
    }).first();
    await expect(card).toBeVisible();

    page.on('dialog', d => d.accept());
    await card.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete article/i }).click();

    await expect(page.getByText(title)).not.toBeVisible({ timeout: 8_000 });
  });
});
