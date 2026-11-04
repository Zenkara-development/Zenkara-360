import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('IT Desk Categories', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/itdesk/categories');
    await page.waitForURL(/\/itdesk\/categories/);
  });

  test('categories page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /categor/i })
    ).toBeVisible();
  });

  test('creates a new category', async ({ page }) => {
    await page.getByRole('button', { name: /new category|create category|add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/name/i).fill(TEST.category.name);

    const descInput = dialog.getByLabel(/description/i);
    if (await descInput.isVisible()) {
      await descInput.fill(TEST.category.description);
    }

    await dialog.getByRole('button', { name: /create|save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.category.name)).toBeVisible({ timeout: 8_000 });
  });

  test('created category appears in list', async ({ page }) => {
    await expect(page.getByText(TEST.category.name)).toBeVisible({ timeout: 5_000 });
  });

  test('edits a category', async ({ page }) => {
    // Categories use card-based layout with RowActions dropdown
    const card = page.locator('[data-testid="category-card"]').filter({
      hasText: TEST.category.name,
    }).first();
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: /row actions/i }).click();
    const editBtn = page.getByRole('button', { name: /edit category/i });
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const nameInput = dialog.getByLabel(/name/i);
    await nameInput.fill(TEST.category.name + ' Edited');
    await dialog.getByRole('button', { name: /save|update/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.category.name + ' Edited')).toBeVisible({ timeout: 5_000 });
  });

  test('category is available when creating a ticket', async ({ page }) => {
    await page.goto('/itdesk/tickets');
    await page.getByRole('button', { name: /new ticket|create ticket/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const categorySelect = dialog.getByLabel(/category/i);
    if (await categorySelect.isVisible()) {
      const options = await categorySelect.locator('option').allTextContents();
      const hasCategory = options.some(o => o.toLowerCase().includes('e2e') || o.toLowerCase().includes('test'));
      expect(hasCategory).toBeTruthy();
    }
    await page.keyboard.press('Escape');
  });

  test('deletes a category', async ({ page }) => {
    const categoryName = TEST.category.name + ' Edited';
    const card = page.locator('[data-testid="category-card"]').filter({
      hasText: categoryName,
    }).first();
    await expect(card).toBeVisible();

    page.on('dialog', d => d.accept());
    await card.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete category/i }).click();

    await expect(page.getByText(categoryName)).not.toBeVisible({ timeout: 8_000 });
  });
});
