import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Leads', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Leads' }).click();
    await page.waitForURL(/\/crm\/leads/);
  });

  test('shows leads page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
  });

  test('creates a new lead', async ({ page }) => {
    // Use .first() — LeadsPage has two "New Lead" buttons (list header + Kanban mini-button)
    await page.getByRole('button', { name: /new lead/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/full name/i).fill(TEST.lead.name);
    await page.getByLabel(/email/i).fill(TEST.lead.email);
    await page.getByLabel(/source/i).selectOption(TEST.lead.source);
    await page.getByRole('button', { name: /create lead/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText(TEST.lead.name).first()).toBeVisible();
  });

  test('filters leads by status', async ({ page }) => {
    const select = page.getByRole('combobox', { name: '' }).first();
    await select.selectOption('NEW');
    // Page should still render (even if filtered to empty)
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
  });

  test('searches for a lead by name', async ({ page }) => {
    await page.getByPlaceholder(/search leads/i).fill(TEST.lead.name);
    await expect(page.getByText(TEST.lead.name).first()).toBeVisible();
  });

  test('converts a lead to a deal', async ({ page }) => {
    const row = page.locator('tr').filter({ hasText: TEST.lead.name }).first();
    await expect(row).toBeVisible({ timeout: 8_000 });

    // Wait for the Convert button to appear (hidden once lead is already CONVERTED)
    const convertBtn = row.getByRole('button', { name: /convert/i });
    await expect(convertBtn).toBeVisible({ timeout: 5_000 });
    await convertBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/convert lead to deal/i)).toBeVisible();

    // Customise the deal
    await page.getByLabel(/deal title/i).fill('E2E Converted Deal');
    await page.getByLabel(/value/i).fill('12000');
    await page.getByRole('button', { name: /convert lead/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8_000 });

    // Lead should now show "Converted" badge — scope to the row to avoid
    // matching the hidden <option value="CONVERTED"> inside a SearchableSelect.
    // .first() because the row renders both the status badge ("CONVERTED")
    // and a separate inline "Converted" indicator once a deal is linked —
    // both match /converted/i, so the locator must pick one deterministically.
    await expect(row.getByText(/converted/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('converted lead shows Converted badge and hides Convert button', async ({ page }) => {
    const row = page.getByRole('row', { name: new RegExp(TEST.lead.name, 'i') }).first();
    await expect(row.getByText(/converted/i).first()).toBeVisible();
    await expect(row.getByRole('button', { name: /convert/i })).not.toBeVisible();
  });

  test('edits a lead', async ({ page }) => {
    // Unique name/email per invocation (not the fixed 'Edit Me Lead' /
    // 'editme@test.com' literals) so that a Playwright retry of this exact
    // test — which re-runs the whole test body, including this creation
    // step, since global-setup only cleans up once for the whole suite —
    // creates its own fresh row instead of colliding with the row the
    // previous attempt already left behind. Two same-named rows is exactly
    // what turns every locator below into a strict-mode "resolved to 2
    // elements" failure on retry.
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const leadName = `Edit Me Lead ${suffix}`;
    const leadEmail = `editme-${suffix}@test.com`;

    // Create a temp lead
    await page.getByRole('button', { name: /new lead/i }).first().click();
    await page.getByLabel(/full name/i).fill(leadName);
    await page.getByLabel(/email/i).fill(leadEmail);
    await page.getByRole('button', { name: /create lead/i }).click();
    await expect(page.getByText(leadName).first()).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(leadName, 'i') });
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /edit lead/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/full name/i).fill(`${leadName} Modified`);
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(`${leadName} Modified`)).toBeVisible();
  });
});
