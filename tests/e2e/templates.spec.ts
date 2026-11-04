import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * Coverage for the Templates feature: admin-managed Record templates
 * (pre-fill Ticket/Contact/Deal/Lead create forms), Reply templates (ticket
 * canned responses), Email templates (campaigns), and Quote templates.
 *
 * Each test defines a template via the /templates admin page, then confirms
 * it actually shows up and works where it's supposed to — the same kind of
 * end-to-end check that would have caught the earlier custom-fields bug
 * (definitions existing in an admin page but never wired into the real
 * create forms).
 */

test.describe('Templates admin page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/templates');
    await page.waitForURL(/\/templates/);
  });

  test('templates page loads with top-level tabs', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /templates/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Records' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Replies' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Emails' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Quotes' })).toBeVisible();
  });

  test('Records tab shows entity sub-tabs', async ({ page }) => {
    await expect(page.getByRole('tab', { name: /tickets/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /contacts/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /deals/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /leads/i })).toBeVisible();
  });
});

test.describe('Templates — Entity Integration', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('a Ticket record template pre-fills the New Ticket form', async ({ page }) => {
    const NAME = 'E2E Ticket Record Template';

    await page.goto('/templates');
    await page.waitForURL(/\/templates/);
    await page.getByRole('tab', { name: /tickets/i }).click();
    await page.getByRole('button', { name: /new template/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^name$/i).fill(NAME);
    await dialog.getByLabel('Priority').selectOption('HIGH');
    await dialog.getByLabel(/description boilerplate/i).fill('Please attach a screenshot of the error.');
    await dialog.getByRole('button', { name: /create template/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(NAME)).toBeVisible({ timeout: 8_000 });

    // Now confirm it actually shows up on the ticket create form and prefills it.
    await page.goto('/itdesk/tickets');
    await page.waitForURL(/\/itdesk\/tickets/);
    await page.getByRole('button', { name: /new ticket/i }).click();

    const ticketDialog = page.getByRole('dialog');
    await expect(ticketDialog).toBeVisible();
    await expect(ticketDialog.getByLabel('Template')).toBeVisible({ timeout: 8_000 });
    await ticketDialog.getByLabel('Template').selectOption({ label: NAME });

    await expect(ticketDialog.getByLabel('Priority')).toHaveValue('HIGH');
    await expect(ticketDialog.getByLabel(/description/i).first()).toHaveValue('Please attach a screenshot of the error.');

    // Clean up: close without submitting, then delete the template definition.
    await page.keyboard.press('Escape');
    await page.goto('/templates');
    await page.waitForURL(/\/templates/);
    await page.getByRole('tab', { name: /tickets/i }).click();
    const row = page.locator('tbody tr').filter({ hasText: NAME });
    page.on('dialog', d => d.accept());
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete template/i }).click();
    await expect(page.getByText(NAME)).not.toBeVisible({ timeout: 8_000 });
  });

  test('a Reply template can be inserted into a ticket comment', async ({ page }) => {
    const NAME = 'E2E Password Reset Reply';
    const BODY = 'Hi, please try resetting your password via the link in your email.';

    await page.goto('/templates');
    await page.waitForURL(/\/templates/);
    await page.getByRole('tab', { name: 'Replies' }).click();
    await page.getByRole('button', { name: /new reply template/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^name$/i).fill(NAME);
    await dialog.getByLabel(/message/i).fill(BODY);
    await dialog.getByRole('button', { name: /create template/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    // Create a ticket to attach the reply to.
    await page.goto('/itdesk/tickets');
    await page.waitForURL(/\/itdesk\/tickets/);
    await page.getByRole('button', { name: /new ticket/i }).click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel(/^title$/i).fill('E2E Reply Template Ticket');
    await createDialog.getByLabel(/^description$/i).fill('Testing reply templates.');
    await createDialog.getByRole('button', { name: /submit ticket/i }).click();
    await expect(createDialog).not.toBeVisible({ timeout: 8_000 });

    await page.getByText('E2E Reply Template Ticket').first().click();
    const ticketDialog = page.getByRole('dialog');
    await expect(ticketDialog).toBeVisible();

    await expect(ticketDialog.getByLabel(/canned response/i)).toBeVisible({ timeout: 8_000 });
    await ticketDialog.getByLabel(/canned response/i).selectOption({ label: NAME });
    await expect(ticketDialog.getByPlaceholder(/add a comment/i)).toHaveValue(BODY);

    // Clean up the template definition.
    await page.goto('/templates');
    await page.waitForURL(/\/templates/);
    await page.getByRole('tab', { name: 'Replies' }).click();
    const row = page.locator('tbody tr').filter({ hasText: NAME });
    page.on('dialog', d => d.accept());
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete template/i }).click();
    await expect(page.getByText(NAME)).not.toBeVisible({ timeout: 8_000 });
  });

  test('an Email template pre-fills the New Campaign form', async ({ page }) => {
    const NAME = 'E2E Welcome Email Template';
    const SUBJECT = 'Welcome aboard!';
    const BODY = 'Thanks for signing up — here is what happens next.';

    await page.goto('/templates');
    await page.waitForURL(/\/templates/);
    await page.getByRole('tab', { name: 'Emails' }).click();
    await page.getByRole('button', { name: /new email template/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^name$/i).fill(NAME);
    await dialog.getByLabel(/^subject$/i).fill(SUBJECT);
    await dialog.getByLabel(/^body$/i).fill(BODY);
    await dialog.getByRole('button', { name: /create template/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    await page.goto('/campaigns');
    await page.waitForURL(/\/campaigns/);
    await page.getByRole('button', { name: /new campaign/i }).click();

    const campaignDialog = page.getByRole('dialog');
    await expect(campaignDialog).toBeVisible();
    await expect(campaignDialog.getByLabel('Template')).toBeVisible({ timeout: 8_000 });
    await campaignDialog.getByLabel('Template').selectOption({ label: NAME });

    await expect(campaignDialog.getByLabel(/^subject$/i)).toHaveValue(SUBJECT);
    await expect(campaignDialog.getByLabel(/^body$/i)).toHaveValue(BODY);

    await campaignDialog.getByRole('button', { name: /cancel/i }).click();

    await page.goto('/templates');
    await page.waitForURL(/\/templates/);
    await page.getByRole('tab', { name: 'Emails' }).click();
    const row = page.locator('tbody tr').filter({ hasText: NAME });
    page.on('dialog', d => d.accept());
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete template/i }).click();
    await expect(page.getByText(NAME)).not.toBeVisible({ timeout: 8_000 });
  });

  test('a Quote template pre-fills line items on the New Quote form', async ({ page }) => {
    const NAME = 'E2E Support Package Template';

    await page.goto('/templates');
    await page.waitForURL(/\/templates/);
    await page.getByRole('tab', { name: 'Quotes' }).click();
    await page.getByRole('button', { name: /new quote template/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^name$/i).fill(NAME);
    await dialog.getByLabel(/template description/i).fill('Standard onboarding + support');
    // First line item is present by default — fill it in. { exact: true } avoids
    // matching "Template Description" above (which contains "Description" as a substring).
    await dialog.getByLabel('Description', { exact: true }).fill('Onboarding Setup');
    await dialog.getByLabel('Qty').fill('1');
    await dialog.getByLabel('Price').fill('500');
    await dialog.getByRole('button', { name: /create template/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    await page.goto('/quotes');
    await page.waitForURL(/\/quotes/);
    await page.getByRole('button', { name: /new quote/i }).click();

    const quoteDialog = page.getByRole('dialog');
    await expect(quoteDialog).toBeVisible();
    await expect(quoteDialog.getByLabel('Template')).toBeVisible({ timeout: 8_000 });
    await quoteDialog.getByLabel('Template').selectOption({ label: NAME });

    await expect(quoteDialog.getByLabel('Description')).toHaveValue('Onboarding Setup');
    await expect(quoteDialog.getByLabel('Price')).toHaveValue('500');

    await quoteDialog.getByRole('button', { name: /cancel/i }).click();

    await page.goto('/templates');
    await page.waitForURL(/\/templates/);
    await page.getByRole('tab', { name: 'Quotes' }).click();
    const row = page.locator('tbody tr').filter({ hasText: NAME });
    page.on('dialog', d => d.accept());
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete template/i }).click();
    await expect(page.getByText(NAME)).not.toBeVisible({ timeout: 8_000 });
  });
});
