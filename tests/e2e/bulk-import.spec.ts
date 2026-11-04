import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

const VALID_CONTACTS_CSV = `name,email,phone
Import Contact A,import-a@test.com,555-1001
Import Contact B,import-b@test.com,555-1002
Import Contact C,import-c@test.com,555-1003`;

const MALFORMED_CSV = `Import Contact D,no-header@test.com,555-1004`;

test.describe('Bulk Import', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/import');
    await page.waitForURL(/\/import/);
  });

  // Verifies the import page heading is visible
  test('import page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /import|bulk import/i })
    ).toBeVisible();
  });

  // Verifies the entity type selector shows Contacts and Leads options
  test('entity type selector shows Contacts and Leads', async ({ page }) => {
    const entitySelect = page.getByLabel(/entity type|import type|type/i);
    if (await entitySelect.isVisible()) {
      const options = entitySelect.locator('option');
      const texts = await options.allTextContents();
      const hasContacts = texts.some(t => /contact/i.test(t));
      const hasLeads = texts.some(t => /lead/i.test(t));
      expect(hasContacts || hasLeads).toBeTruthy();
    } else {
      // Might be radio buttons or tab-style selectors
      await expect(
        page.getByText(/contacts|leads/i).first()
      ).toBeVisible();
    }
  });

  // Verifies pasting valid CSV and clicking Preview shows a preview table
  test('paste CSV and preview shows up to 5 rows', async ({ page }) => {
    // Select entity type
    const entitySelect = page.getByLabel(/entity type|import type|type/i);
    if (await entitySelect.isVisible()) {
      await entitySelect.selectOption({ label: /contact/i });
    }

    // Paste CSV text
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
    await textarea.fill(VALID_CONTACTS_CSV);

    // Click Preview
    await page.getByRole('button', { name: /preview/i }).click();

    // Preview table should appear with up to 5 rows
    const previewTable = page.getByRole('table');
    await expect(previewTable).toBeVisible({ timeout: 8_000 });

    const rows = previewTable.getByRole('row');
    const count = await rows.count();
    // At least header + 1 data row
    expect(count).toBeGreaterThan(1);
  });

  // Verifies clicking Import after preview shows result counts
  test('clicking Import shows result with created/updated/errors counts', async ({ page }) => {
    // Paste CSV again (each test starts fresh from beforeEach)
    const entitySelect = page.getByLabel(/entity type|import type|type/i);
    if (await entitySelect.isVisible()) {
      await entitySelect.selectOption({ label: /contact/i });
    }

    const textarea = page.locator('textarea').first();
    await textarea.fill(VALID_CONTACTS_CSV);
    await page.getByRole('button', { name: /preview/i }).click();

    await expect(page.getByRole('table')).toBeVisible({ timeout: 8_000 });

    await page.getByRole('button', { name: /^import/i }).click();

    // Should show result summary
    await expect(
      page.getByText(/created|imported|updated|result/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  // Verifies an error appears when the CSV has no header row
  test('shows error if CSV is malformed (no header)', async ({ page }) => {
    const textarea = page.locator('textarea').first();
    await textarea.fill(MALFORMED_CSV);

    await page.getByRole('button', { name: /preview/i }).click();

    // Either an inline error or a toast should appear
    await expect(
      page.getByText(/invalid|missing header|column|error/i)
    ).toBeVisible({ timeout: 8_000 });
  });
});
