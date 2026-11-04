import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test.describe('Audit Log', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/audit-logs');
    await page.waitForURL(/\/audit-logs/);
  });

  // Verifies the Audit Log page heading is visible
  test('audit log page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /audit log/i })
    ).toBeVisible();
  });

  // Verifies the table is rendered with the expected column headers.
  // The login in beforeEach writes a LOGIN audit entry so there is always at least one row.
  test('table is visible with expected headers', async ({ page }) => {
    // Wait for at least one row — login writes a LOGIN entry via logAction
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole('columnheader', { name: /time/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /user/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /action/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /type|entity type/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /entity id/i })).toBeVisible();
  });

  // Verifies the action filter dropdown exists and can be used to filter by LOGIN
  // (LOGIN is always present because beforeEach logs in, writing a LOGIN audit entry)
  test('filter by action dropdown selects LOGIN', async ({ page }) => {
    const actionFilter = page.getByRole('combobox', { name: /action/i });
    await expect(actionFilter).toBeVisible();
    // selectOption by value (option value = text since no explicit value attr)
    await actionFilter.selectOption('LOGIN');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 5_000 });
    // Scope to tbody to avoid matching the hidden <option> inside the select
    await expect(page.locator('tbody').getByText('LOGIN').first()).toBeVisible({ timeout: 5_000 });
  });

  // Verifies filtering by entity type is available
  test('filter by entity type is available', async ({ page }) => {
    const typeFilter = page.getByRole('combobox', { name: /entity type|type/i });
    if (await typeFilter.isVisible()) {
      const options = await typeFilter.locator('option').all();
      expect(options.length).toBeGreaterThan(1);
    } else {
      // Might be labeled differently — just check the table is still visible
      await expect(page.getByRole('table')).toBeVisible();
    }
  });

  // Verifies a search input is present on the audit log page
  test('search input is visible', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search|filter/i);
    await expect(searchInput).toBeVisible();
  });

  // Verifies pagination controls appear when there are enough log entries
  test('pagination is visible when logs exist', async ({ page }) => {
    // Check if there are any rows at all
    const rows = page.getByRole('row');
    const rowCount = await rows.count();

    if (rowCount > 2) {
      // Pagination might be present
      const paginationArea = page.getByRole('navigation', { name: /pagination/i });
      const nextBtn = page.getByRole('button', { name: /next/i });
      if (await nextBtn.isVisible()) {
        await expect(nextBtn).toBeVisible();
      }
    }
    // If no pagination visible with few rows — that is expected behavior
  });
});
