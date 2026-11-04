import { test, expect, Page } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * End-to-end coverage for the custom-fields <-> entity-module integration.
 *
 * custom-fields.spec.ts only exercises the admin "Custom Fields" definitions
 * page (create/edit/delete a definition) — it never checks that a defined
 * field actually shows up anywhere. That gap is exactly what let this bug
 * ship: admin-defined custom fields for TICKET/CONTACT/DEAL/LEAD were never
 * rendered on those entities' create/edit forms and never persisted, because
 * no frontend code read from or wrote to the /custom-fields/values endpoint.
 *
 * These tests define a field for each entity type, confirm it renders as an
 * input on that entity's create form, fill it in, save, and confirm the
 * value is actually persisted and redisplayed afterwards. Each test cleans
 * up its own field definition so it doesn't affect other spec files.
 */

async function createFieldDef(page: Page, tabName: string, label: string, fieldKey: string) {
  await page.goto('/custom-fields');
  await page.waitForURL(/\/custom-fields/);
  await page.getByRole('tab', { name: new RegExp(tabName, 'i') }).click();
  await page.getByRole('button', { name: /add field|new field|create/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^label$/i).fill(label);
  await dialog.getByLabel(/api name/i).fill(fieldKey);
  // Field type defaults to TEXT — no need to touch the Type select.
  await dialog.getByRole('button', { name: /create field|create|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(label)).toBeVisible({ timeout: 8_000 });
}

async function deleteFieldDef(page: Page, tabName: string, label: string) {
  await page.goto('/custom-fields');
  await page.waitForURL(/\/custom-fields/);
  await page.getByRole('tab', { name: new RegExp(tabName, 'i') }).click();
  const row = page.locator('tbody tr').filter({ hasText: label });
  if (await row.count()) {
    page.on('dialog', d => d.accept());
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete field/i }).click();
    await expect(page.getByText(label)).not.toBeVisible({ timeout: 8_000 });
  }
}

test.describe('Custom Fields — Entity Integration', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('custom field renders on the ticket form and persists to the ticket detail view', async ({ page }) => {
    const LABEL = 'E2E Ticket Custom Field';
    const KEY = 'e2e_ticket_field';
    await createFieldDef(page, 'ticket', LABEL, KEY);

    await page.goto('/itdesk/tickets');
    await page.waitForURL(/\/itdesk\/tickets/);
    await page.getByRole('button', { name: /new ticket/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The custom field must actually appear on the form — this is the core
    // regression check.
    await expect(dialog.getByLabel(LABEL)).toBeVisible({ timeout: 8_000 });

    const TICKET_TITLE = 'E2E Integration Ticket';
    await dialog.getByLabel(/^title$/i).fill(TICKET_TITLE);
    await dialog.getByLabel(/description/i).fill('Verifies custom field values persist on tickets.');
    await dialog.getByLabel(LABEL).fill('custom-ticket-value');
    await dialog.getByRole('button', { name: /submit ticket/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    await page.getByText(TICKET_TITLE).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('custom-ticket-value')).toBeVisible({ timeout: 8_000 });

    await deleteFieldDef(page, 'ticket', LABEL);
  });

  test('custom field renders on the contact form and persists to the contact detail page', async ({ page }) => {
    const LABEL = 'E2E Contact Custom Field';
    const KEY = 'e2e_contact_field';
    await createFieldDef(page, 'contact', LABEL, KEY);

    await page.goto('/crm/contacts');
    await page.waitForURL(/\/crm\/contacts$/);
    await page.getByRole('button', { name: /new contact/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(LABEL)).toBeVisible({ timeout: 8_000 });

    const CONTACT_NAME = 'E2E Integration Contact';
    await dialog.getByLabel(/^name$/i).fill(CONTACT_NAME);
    await dialog.getByLabel(/email/i).fill('e2e-integration-contact@test.com');
    await dialog.getByLabel(LABEL).fill('custom-contact-value');
    await dialog.getByRole('button', { name: /create contact/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    await page.getByText(CONTACT_NAME).first().click();
    await page.waitForURL(/\/crm\/contacts\/.+/);
    // Scoped to main — the sidebar has its own "Custom Fields" nav link, so
    // the unscoped locator was a strict-mode violation (2 matches) on every
    // single run, not a flake.
    await expect(page.getByRole('main').getByText('Custom Fields')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('custom-contact-value')).toBeVisible({ timeout: 8_000 });

    // Re-opening edit should pre-populate the saved value, not a blank input.
    await page.getByRole('button', { name: /edit/i }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByLabel(LABEL)).toHaveValue('custom-contact-value');
    await editDialog.getByRole('button', { name: /close/i }).click();

    await deleteFieldDef(page, 'contact', LABEL);
  });

  test('custom field renders on the deal form and persists to the deal detail modal', async ({ page }) => {
    const LABEL = 'E2E Deal Custom Field';
    const KEY = 'e2e_deal_field';
    await createFieldDef(page, 'deal', LABEL, KEY);

    await page.goto('/crm/deals');
    await page.waitForURL(/\/crm\/deals/);
    await page.getByRole('button', { name: /new deal/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(LABEL)).toBeVisible({ timeout: 8_000 });

    const DEAL_TITLE = 'E2E Integration Deal';
    await dialog.getByLabel(/deal title/i).fill(DEAL_TITLE);
    await dialog.getByLabel(/value/i).fill('1000');
    await dialog.getByLabel(LABEL).fill('custom-deal-value');
    await dialog.getByRole('button', { name: /create deal/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    await page.getByText(DEAL_TITLE).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('custom-deal-value')).toBeVisible({ timeout: 8_000 });

    await deleteFieldDef(page, 'deal', LABEL);
  });

  test('custom field renders on the lead form and persists across edits', async ({ page }) => {
    // Suffixed per invocation — CustomField has a @@unique([orgId, entityType,
    // fieldKey]) constraint, so a Playwright retry reusing the same fixed
    // key hits a 409 on createFieldDef() (the field from attempt 1 is still
    // there), and *that* dialog never closing was the retry's real failure —
    // a different symptom than attempt 1's own (separate, load-related)
    // failure further down this same test, which made both look unrelated
    // at a glance. global-setup.ts's `fieldKey: { startsWith: 'e2e_' }` /
    // `label: { startsWith: 'E2E ' }` cleanup still catches this regardless
    // of the suffix.
    const suffix = Date.now();
    const LABEL = `E2E Lead Custom Field ${suffix}`;
    const KEY = `e2e_lead_field_${suffix}`;
    await createFieldDef(page, 'lead', LABEL, KEY);

    await page.goto('/crm/leads');
    await page.waitForURL(/\/crm\/leads/);
    await page.getByRole('button', { name: /new lead/i }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(LABEL)).toBeVisible({ timeout: 8_000 });

    const LEAD_NAME = 'E2E Integration Lead';
    await dialog.getByLabel(/full name/i).fill(LEAD_NAME);
    await dialog.getByLabel(/email/i).fill('e2e-integration-lead@test.com');
    await dialog.getByLabel(LABEL).fill('custom-lead-value');
    await dialog.getByRole('button', { name: /create lead/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    await expect(page.getByText(LEAD_NAME).first()).toBeVisible({ timeout: 8_000 });
    const row = page.getByRole('row', { name: new RegExp(LEAD_NAME, 'i') });
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /edit lead/i }).click();

    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();
    // Confirms the saved value round-trips back into the form on edit,
    // rather than the field silently resetting to blank.
    await expect(editDialog.getByLabel(LABEL)).toHaveValue('custom-lead-value');
    await page.keyboard.press('Escape');

    await deleteFieldDef(page, 'lead', LABEL);
  });
});
